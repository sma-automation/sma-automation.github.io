"""One fenced provider operation per invocation; never a scheduler or retry loop.

No upload is reachable without an operator-created, order-bound database permit,
all current media gates, and the customer's recorded consent. No permit is created
by this builder, this workflow, or the normal order API.
"""
import importlib.util,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('orders',ROOT/'n8n/publishing/build-publication-orders.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def core(name):return (ROOT/'n8n/publishing'/name).read_text().split('module.exports=')[0].split('module.exports =')[0]
transport=core('provider-transport.cjs')
transport='\n'.join(s for s in transport.splitlines() if not ("require('./provider-" in s))
transport=core('provider-results.cjs')+'\n'+core('provider-upload-plan.cjs')+'\n'+transport
w=m.Builder('SMA – Auftrag – Provider-Ergebnis V1',ROOT/'n8n/publishing/provider-dispatch-workflow.json')
w.node('Providerauftrag fortsetzen','executeWorkflowTrigger',{'inputSource':'passthrough'},0,v=1.1)
w.code('Providerauftrags-ID prüfen',"const r=$input.first().json;if($input.all().length!==1||Object.keys(r).join()!=='id'||! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(r.id||''))throw Error('INVALID_INPUT');return [{json:r}];",240)
def rpc(name,body,x,y=0):
 w.rpc(name,body,x,y);w.nodes[-1]['parameters']['url']=m.BASE+'sma_publication_provider_v1'
rpc('Providerauftrag lesen',"={{ {p_action:'context',p_id:$json.id} }}",480)
w.code('Providerbindung bestätigen',"if($json.ok!==true)throw Error('PROVIDER_CONTEXT_UNAVAILABLE');return $input.all();",720)
w.node('Providerkonto rückprüfen','executeWorkflow',{'source':'database','workflowId':{'__rl':True,'value':'LR2Qng41OIYuVHAR','mode':'id'},'mode':'once','options':{'waitForSubWorkflow':True}},960,v=1.3,onError='continueErrorOutput')
w.customer('Aktuelle Providerverbindung lesen','Providerauftrag lesen',1200)
w.code('Providerverbindung bestätigen',m.CORE+'\n'+m.FOLDERS+'''
const c=$('Providerauftrag lesen').first().json,a=$('Providerkonto rückprüfen').first().json,rows=$input.all().map(x=>x.json);
if(a.ok!==true)throw Error('TARGET_PERMISSIONS_REQUIRED');
const t=orderTarget(rows,c),folders=verifiedFolders(rows,c).folders;
const row=rows.length===1?rows[0]:null,token=row?.[c.binding.platform+'_access_token'];
if(!row||typeof token!=='string'||token.length<10||/[\\r\\n]/.test(token))throw Error('TARGET_RECONNECT_REQUIRED');
return [{json:{...c,...t,account_check:a.account_check,folders,token,drive_file_id:c.binding.drive_file_id}}];
''',1440)
w.condition('Datei für Übertragung prüfen?',"={{ $json.requires_file === true }}",1680)
DRIVE=m.DRIVE
for name,x,download in [('Provider-Dateistand lesen',1920,False),('Provider-Videodatei lesen',2400,True),('Provider-Dateistand rückprüfen',2880,False)]:
 opts={'redirect':{'redirect':{'followRedirects':False}},'timeout':60000}
 if download:opts['response']={'response':{'responseFormat':'file','outputPropertyName':'data'}}
 w.node(name,'httpRequest',{'url':"={{ 'https://www.googleapis.com/drive/v3/files/'+$('Providerverbindung bestätigen').first().json.drive_file_id }}",'authentication':'predefinedCredentialType','nodeCredentialType':'googleDriveOAuth2Api','sendQuery':True,'queryParameters':{'parameters':([{'name':'alt','value':'media'}] if download else [{'name':'fields','value':'id,mimeType,parents,trashed,version,size,sha256Checksum,md5Checksum,capabilities(canDownload)'}])+[{'name':'supportsAllDrives','value':'true'}]},'options':opts},x,v=4.5,credentials=DRIVE,onError='continueErrorOutput')
w.code('Provider-Dateistand bestätigen',m.CORE+"\nconst c=$('Providerverbindung bestätigen').first().json;orderDrive($json,c,c.folders);if($json.mimeType!=='video/mp4'||! /^[1-9][0-9]{0,7}$/.test(String($json.size))||Number($json.size)>24000000)throw Error('FILE_CHANGED');return [{json:{size_bytes:Number($json.size)}}];",2160)
w.code('Provider-Dateiprüfsumme bestätigen',transport+"\nconst c=$('Providerverbindung bestätigen').first().json,bytes=await this.helpers.getBinaryDataBuffer(0,'data');providerBytes(bytes,{binding:c.binding,size_bytes:$('Provider-Dateistand bestätigen').first().json.size_bytes});return [{json:{size_bytes:bytes.length},binary:$input.first().binary}];",2640)
w.code('Provider-Prüfnachweise verbinden',m.CORE+"\nconst c=$('Providerverbindung bestätigen').first().json;orderDrive($json,c,c.folders);if(Number($json.size)!==$('Provider-Dateiprüfsumme bestätigen').first().json.size_bytes)throw Error('FILE_CHANGED');return [{json:{target:c.target,account_check:c.account_check,drive_verified:true,text_verified:true,size_bytes:Number($json.size)}}];",3120)
w.code('Providerstatus ohne Datei lesen',"const c=$('Providerverbindung bestätigen').first().json;return [{json:{target:c.target,account_check:c.account_check,drive_verified:false,text_verified:false}}];",1920,300)
rpc('Provideranfrage atomar reservieren',"={{ {p_action:'begin',p_id:$('Providerauftrag lesen').first().json.id,p_data:$json} }}",3360)
w.condition('Provideranfrage reserviert?',"={{ $json.ok === true && !!$json.lease_id && !!$json.operation }}",3600)
w.code('Provideranfrage erstellen',transport+"\nconst i=$('Provideranfrage atomar reservieren').first().json,c=$('Providerverbindung bestätigen').first().json;return [{json:{request:providerRequest(i,c.token)}}];",3840,onError='continueErrorOutput')
w.code('Provider-Dateirest auswählen',transport+'''
const i=$('Provideranfrage atomar reservieren').first().json;
const source=$('Provider-Dateiprüfsumme bestätigen').first();
if(!source.binary?.data)throw Error('FILE_CHANGED');
const full=await this.helpers.getBinaryDataBuffer(0,'data');providerBytes(full,i);
const request=$('Provideranfrage erstellen').first().json.request;
return [{json:{request},binary:{data:await this.helpers.prepareBinaryData(full.subarray(request.offset),'video.mp4','video/mp4')}}];
''',4320,onError='continueErrorOutput')
# A tiny preceding code node restores source binary for the helper.
w.code('Geprüfte Providerdatei übernehmen',"return [{json:$json,binary:$('Provider-Dateiprüfsumme bestätigen').first().binary}];",4080,-300)
w.condition('Providerdatei übertragen?',"={{ $json.request.body_type === 'binary' }}",4080)
w.condition('Provider-JSON senden?',"={{ $json.request.body_type === 'json' }}",4320,300)
for name,x,y,kind in [('Provider-Dateitransfer',4560,0,'binary'),('Provider-JSON-Anfrage',4560,300,'json'),('Provider-Statusanfrage',4560,600,'none')]:
 p={'method':'={{ $json.request.method }}','url':'={{ $json.request.url }}','sendHeaders':True,'specifyHeaders':'json','jsonHeaders':'={{ $json.request.headers }}','options':{'redirect':{'redirect':{'followRedirects':False}},'timeout':90000,'response':{'response':{'fullResponse':True,'neverError':True,'responseFormat':'text'}}}}
 if kind=='binary':p.update(sendBody=True,contentType='binaryData',inputDataFieldName='data')
 elif kind=='json':p.update(sendBody=True,specifyBody='json',jsonBody='={{ $json.request.body }}')
 else:p['sendBody']=False
 w.node(name,'httpRequest',p,x,y,v=4.5,onError='continueErrorOutput')
w.code('Providerantwort auswerten',transport+"\nreturn [{json:providerObservation($json,$('Provideranfrage atomar reservieren').first().json)}];",4800,onError='continueErrorOutput')
w.code('Unklare Providerantwort',"return [{json:{state:'uncertain',code:'PROVIDER_RESPONSE_UNCERTAIN'}}];",4800,600)
rpc('Providerergebnis speichern',"={{ {p_action:'finish',p_id:$('Provideranfrage atomar reservieren').first().json.id,p_lease:$('Provideranfrage atomar reservieren').first().json.lease_id,p_data:$json} }}",5040)
w.code('Providerstatus sicher zurückgeben',"const r=$json;return [{json:{ok:r.ok===true,state:['session_ready','uploading','processing','complete','failed','uncertain','needs_review'].includes(r.state)?r.state:'blocked',can_upload:false,can_publish:false}}];",5280)
def chain(names):
 for a,b in zip(names,names[1:]):w.edge(a,b)
chain(['Providerauftrag fortsetzen','Providerauftrags-ID prüfen','Providerauftrag lesen','Providerbindung bestätigen','Providerkonto rückprüfen','Aktuelle Providerverbindung lesen','Providerverbindung bestätigen','Datei für Übertragung prüfen?','Provider-Dateistand lesen','Provider-Dateistand bestätigen','Provider-Videodatei lesen','Provider-Dateiprüfsumme bestätigen','Provider-Dateistand rückprüfen','Provider-Prüfnachweise verbinden','Provideranfrage atomar reservieren','Provideranfrage reserviert?','Provideranfrage erstellen','Providerdatei übertragen?','Geprüfte Providerdatei übernehmen','Provider-Dateirest auswählen','Provider-Dateitransfer','Providerantwort auswerten','Providerergebnis speichern','Providerstatus sicher zurückgeben'])
w.edge('Datei für Übertragung prüfen?','Providerstatus ohne Datei lesen',1);w.edge('Providerstatus ohne Datei lesen','Provideranfrage atomar reservieren')
w.edge('Provideranfrage reserviert?','Providerstatus sicher zurückgeben',1)
w.edge('Providerdatei übertragen?','Provider-JSON senden?',1);w.edge('Provider-JSON senden?','Provider-JSON-Anfrage');w.edge('Provider-JSON senden?','Provider-Statusanfrage',1)
for n in ['Provider-JSON-Anfrage','Provider-Statusanfrage']:w.edge(n,'Providerantwort auswerten')
for n in ['Provideranfrage erstellen','Provider-Dateirest auswählen','Provider-Dateitransfer','Provider-JSON-Anfrage','Provider-Statusanfrage','Providerantwort auswerten']:w.edge(n,'Unklare Providerantwort',1)
w.edge('Unklare Providerantwort','Providerergebnis speichern')
for n in ['Providerauftrag lesen','Providerkonto rückprüfen','Aktuelle Providerverbindung lesen','Provider-Dateistand lesen','Provider-Videodatei lesen','Provider-Dateistand rückprüfen','Provideranfrage atomar reservieren','Providerergebnis speichern']:w.edge(n,'Providerstatus sicher zurückgeben',1)
workflow=w.write();workflow['settings']['executionTimeout']=600
w.path.write_text(json.dumps(workflow,ensure_ascii=False,indent=2)+'\n')
print(len(workflow['nodes']),'nodes')
