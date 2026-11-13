"""Add cover delivery to a verified export of the installed PR #57 dispatcher.

No merge of PR #57; no alteration of its provider journal or original workflows.
The input is supplied explicitly. Unknown code, edges or settings are rejected.
"""
import argparse, copy, hashlib, importlib.util, json, uuid, sys
sys.dont_write_bytecode=True
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def normalized(node):
 n=copy.deepcopy(node)
 for k in ('id','position'):n.pop(k,None)
 p=n['parameters']
 if n['type']=='n8n-nodes-base.executeWorkflow':
  p.setdefault('source','database');p.setdefault('mode','once')
 if n['type']=='n8n-nodes-base.httpRequest':
  p.setdefault('sendBody',False)
  r=p.get('options',{}).get('response',{}).get('response',{})
  if r.get('responseFormat')=='file':r.setdefault('outputPropertyName','data')
 if 'conditions' in p:
  for c in p['conditions']['conditions']:c.pop('id',None)
 return n
def core(name):return (HERE/name).read_text().split('module.exports=')[0]
def patch(source):
 manifest=json.loads((HERE/'provider-cover-baseline.json').read_text())
 if len(source['nodes'])!=len(manifest['nodes']) or {n['name']:digest(normalized(n)) for n in source['nodes']}!=manifest['nodes'] or digest(source['connections'])!=manifest['connections']:raise ValueError('PROVIDER_BASELINE_CHANGED')
 for k,v in manifest['settings'].items():
  if source.get('settings',{}).get(k)!=v:raise ValueError('PROVIDER_SETTINGS_CHANGED: '+k)
 if set(source.get('settings',{}))-set(manifest['settings'])-{'binaryMode','timeSavedMode'}:raise ValueError('UNKNOWN_WORKFLOW_SETTING')
 if source.get('pinData'):raise ValueError('PIN_DATA_NOT_ALLOWED')
 spec=importlib.util.spec_from_file_location('orders',HERE/'build-publication-orders.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 w=m.Builder(source['name'],Path('/nonexistent/sma-cover-builder.json'))
 w.nodes=copy.deepcopy(source['nodes']);w.edges=copy.deepcopy(source['connections'])
 nodes={n['name']:n for n in w.nodes}
 for name in ('Providerauftrag lesen','Provideranfrage atomar reservieren'):
  nodes[name]['parameters']['url']=m.BASE+'sma_publication_provider_cover_v1'
 nodes['Provideranfrage atomar reservieren']['parameters']['jsonBody']=nodes['Provideranfrage atomar reservieren']['parameters']['jsonBody'].replace("p_action:'begin'","p_action:'provider_begin'")
 # HTTP Request parses its JSON Headers field as text, including when the
 # request itself has a binary body or no body.
 header_expression='={{ JSON.stringify($json.request.headers) }}'
 for name in ('Provider-JSON-Anfrage','Provider-Dateitransfer','Provider-Statusanfrage'):
  nodes[name]['parameters']['jsonHeaders']=header_expression
 old=nodes['Provideranfrage erstellen']['parameters']['jsCode']
 if old.count('request:providerRequest(i,c.token)')!=1:raise ValueError('PROVIDER_ADAPTER_CHANGED')
 nodes['Provideranfrage erstellen']['parameters']['jsCode']=core('provider-cover.cjs')+'\n'+old.replace('request:providerRequest(i,c.token)','request:withTikTokCover(providerRequest(i,c.token),i)')
 # Upgrade the pinned legacy adapter in the two nodes that use session URLs.
 # Keep the original archived export byte-for-byte reproducible.
 session_code=core('provider-transport.cjs').split('function providerSession(',1)[1].split('function providerHttp(',1)[0]
 for name in ('Provideranfrage erstellen','Providerantwort auswerten'):
  node=nodes[name]['parameters']
  before,tail=node['jsCode'].split('function providerSession(',1)
  _,after=tail.split('function providerHttp(',1)
  node['jsCode']=before+'function providerSession('+session_code+'function providerHttp('+after
 # The task runner exposes helpers on the execution context. Strict-mode
 # Code nodes have no bound JavaScript receiver.
 for name in ('Provider-Dateiprüfsumme bestätigen','Provider-Dateirest auswählen'):
  node=nodes[name]['parameters']
  node['jsCode']=node['jsCode'].replace('this.helpers.', 'helpers.')
 w.condition('Cover bereits abgeschlossen?',"={{ $json.cover_terminal === true }}",800,-700)
 w.code('Gespeicherten Coverstatus zurückgeben',"const c=$('Providerauftrag lesen').first().json;return [{json:{ok:true,state:'complete',cover_state:c.cover_state,can_upload:false,can_publish:false}}];",1080,-700)
 w.edges['Providerbindung bestätigen']['main'][0]=[]
 w.edge('Providerbindung bestätigen','Cover bereits abgeschlossen?');w.edge('Cover bereits abgeschlossen?','Gespeicherten Coverstatus zurückgeben');w.edge('Cover bereits abgeschlossen?','Providerkonto rückprüfen',1)
 w.condition('YouTube-Cover bereit?',"={{ $json.cover_ready === true }}",1680,1000)
 w.edges['Providerverbindung bestätigen']['main'][0]=[]
 w.edge('Providerverbindung bestätigen','YouTube-Cover bereit?');w.edge('YouTube-Cover bereit?','Datei für Übertragung prüfen?',1)
 shared=core('provider-cover.cjs')+'\n'+core('editor-source.cjs')
 ctx="const c=$('Providerverbindung bestätigen').first().json,plan=coverPlan(c.cover,c.binding),source={ok:true,...plan};"
 for name,x,download in [('Cover-Dateistand lesen',1920,False),('Coverdatei laden',2400,True),('Cover-Dateistand rückprüfen',2880,False)]:
  opts={'redirect':{'redirect':{'followRedirects':False}},'timeout':60000}
  if download:opts['response']={'response':{'responseFormat':'file','outputPropertyName':'data'}}
  w.node(name,'httpRequest',{'url':"={{ 'https://www.googleapis.com/drive/v3/files/'+$('Providerauftrag lesen').first().json.cover.drive_file_id }}",'authentication':'predefinedCredentialType','nodeCredentialType':'googleDriveOAuth2Api','sendQuery':True,'queryParameters':{'parameters':([{'name':'alt','value':'media'}] if download else [{'name':'fields','value':'id,mimeType,parents,trashed,version,size,sha256Checksum,md5Checksum,capabilities(canDownload)'}])+[{'name':'supportsAllDrives','value':'true'}]},'options':opts},x,1000,v=4.5,credentials=m.DRIVE,onError='continueErrorOutput')
 w.code('Cover-Metadaten bestätigen',shared+'\n'+ctx+"editorSourceMetadata($json,source,c.folders);return [{json:{ok:true}}];",2160,1000,onError='continueErrorOutput')
 w.code('Coverbytes prüfen',core('provider-cover.cjs')+"\nconst c=$('Providerauftrag lesen').first().json,p=coverPlan(c.cover,c.binding),bytes=await helpers.getBinaryDataBuffer(0,'data');coverBytes(bytes,p);return [{json:{size_bytes:bytes.length,sha256:p.asset_revision.split(':')[1]},binary:$input.first().binary}];",2640,1000,onError='continueErrorOutput')
 w.code('Cover-Prüfnachweise verbinden',shared+'\n'+ctx+"editorSourceMetadata($json,source,c.folders);const b=$('Coverbytes prüfen').first().json;return [{json:{target:c.target,account_check:c.account_check,cover_verified:true,cover_sha256:b.sha256,size_bytes:b.size_bytes}}];",3120,1000,onError='continueErrorOutput')
 def rpc(name,body,x,y=1000):
  w.rpc(name,body,x,y);w.nodes[-1]['parameters']['url']=m.BASE+'sma_publication_provider_cover_v1'
 rpc('Coveranfrage reservieren',"={{ {p_action:'cover_begin',p_id:$('Providerauftrag lesen').first().json.id,p_data:$json} }}",3360)
 w.condition('Coveranfrage reserviert?',"={{ $json.ok === true && $json.operation === 'youtube_thumbnail' && !!$json.lease_id }}",3600,1000)
 w.code('Geprüfte Coverdatei übernehmen',"return [{json:$json,binary:$('Coverbytes prüfen').first().binary}];",3840,1000,onError='continueErrorOutput')
 w.code('Coveranfrage erstellen',core('provider-cover.cjs')+"\nconst i=$('Coveranfrage reservieren').first().json,c=$('Providerverbindung bestätigen').first().json,bytes=await helpers.getBinaryDataBuffer(0,'data');return [{json:{request:youtubeCoverRequest(i,c.token,bytes)},binary:$input.first().binary}];",4080,1000,onError='continueErrorOutput')
 w.node('YouTube-Cover übertragen','httpRequest',{'method':'={{ $json.request.method }}','url':'={{ $json.request.url }}','sendHeaders':True,'specifyHeaders':'json','jsonHeaders':header_expression,'sendBody':True,'contentType':'binaryData','inputDataFieldName':'data','options':{'redirect':{'redirect':{'followRedirects':False}},'timeout':90000,'response':{'response':{'fullResponse':True,'neverError':True,'responseFormat':'text'}}}},4320,1000,v=4.5,onError='continueErrorOutput')
 w.code('Coverantwort auswerten',core('provider-cover.cjs')+'\nreturn [{json:youtubeCoverObservation($json)}];',4560,1000,onError='continueErrorOutput')
 w.code('Unklare Coverantwort',"return [{json:{state:'uncertain',code:'COVER_RESPONSE_UNCERTAIN'}}];",4560,1300)
 rpc('Coverergebnis speichern',"={{ {p_action:'cover_finish',p_id:$('Coveranfrage reservieren').first().json.id,p_lease:$('Coveranfrage reservieren').first().json.lease_id,p_data:$json} }}",4800)
 w.code('Coverstatus zurückgeben',"const allowed=['complete','failed','uncertain'];const ok=$json?.ok===true&&allowed.includes($json.cover_state);return [{json:{ok,state:'complete',cover_state:ok?$json.cover_state:'uncertain',can_upload:false,can_publish:false}}];",5040,1000)
 chain=['YouTube-Cover bereit?','Cover-Dateistand lesen','Cover-Metadaten bestätigen','Coverdatei laden','Coverbytes prüfen','Cover-Dateistand rückprüfen','Cover-Prüfnachweise verbinden','Coveranfrage reservieren','Coveranfrage reserviert?','Geprüfte Coverdatei übernehmen','Coveranfrage erstellen','YouTube-Cover übertragen','Coverantwort auswerten','Coverergebnis speichern','Coverstatus zurückgeben']
 for a,b in zip(chain,chain[1:]):w.edge(a,b)
 w.edge('Coveranfrage reserviert?','Coverstatus zurückgeben',1)
 for name in chain[1:8]+['Coverergebnis speichern']:w.edge(name,'Coverstatus zurückgeben',1)
 for name in chain[9:13]:w.edge(name,'Unklare Coverantwort',1)
 w.edge('Unklare Coverantwort','Coverergebnis speichern')
 for n in w.nodes[29:]:
  n['id']=str(uuid.uuid5(uuid.NAMESPACE_URL,'sma-provider-cover-v1/'+n['name']))
  for c in n['parameters'].get('conditions',{}).get('conditions',[]):c['id']=str(uuid.uuid5(uuid.NAMESPACE_URL,'sma-provider-cover-condition/'+n['name']))
 return {'name':'SMA – Auftrag – Provider und Cover V1','nodes':w.nodes,'connections':w.edges,'settings':source['settings'],'pinData':{},'active':False}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--input',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 result=patch(json.loads(a.input.read_text()));a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(len(result['nodes']),'nodes; input baseline verified')
