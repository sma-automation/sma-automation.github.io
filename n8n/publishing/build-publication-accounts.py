"""Read/refresh existing OAuth connections; never upload or publish media.

Public template uses placeholders for existing application configuration. For
installation only, --private-source takes the protected export as read-only
input and --output writes a private file outside the repository.
"""
import argparse,copy,importlib.util,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('orders',Path(__file__).with_name('build-publication-orders.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ROOT=m.ROOT;CORE=m.CORE
ACCOUNT=(ROOT/'n8n/publishing/publisher-account.cjs').read_text().split('module.exports=')[0]
CODE=CORE+'\n'+ACCOUNT
DEFAULT=ROOT/'n8n/publishing/publication-account-workflow.json'
INPUT="$('Kontozugang auswählen').first().json"
TOKENS="$('Tokenantwort prüfen').first().json"
CTX="$('Kontoprüfung anfordern').first().json"
LEASE="$('Kontoprüfung sperren').first().json.lease_id"

def build():
 w=m.Builder('SMA – Zielkonto und Portalberechtigungen V1',DEFAULT)
 def code(n,c,x,y=0):w.code(n,CODE+'\n'+c,x,y,onError='continueErrorOutput')
 def rpc(n,action,x,y=0):
  body="={{ {p_action:'"+action+"',p_customer_id:"+INPUT+".customer_id,p_platform:"+INPUT+".platform,p_fingerprint:"+INPUT+".fingerprint"+(",p_lease:"+LEASE if action!='claim' else '')+"} }}"
  w.rpc(n,body,x,y);w.nodes[-1]['parameters']['url']=m.BASE+'sma_publication_account_worker_v1'
 def ok(n,x,y=0):code(n,"const r=$input.first().json;if(r.ok!==true)throw Error(ACCOUNT_CODES.includes(r.code)?r.code:'TARGET_CHECK_UNAVAILABLE');return [{json:r}];",x,y)
 def http(n,url,x,y=0,method=None,query=None):
  p={'url':url,'sendHeaders':True,'headerParameters':{'parameters':[{'name':'Authorization','value':"={{ 'Bearer '+"+TOKENS+".access_token }}"}]},'options':{**m.OPTS,'response':{'response':{'fullResponse':True,'neverError':True,'responseFormat':'json'}}}}
  if method:p['method']=method
  if query:p.update({'sendQuery':True,'queryParameters':{'parameters':[{'name':k,'value':v} for k,v in query.items()]}})
  if method=='POST':p['headerParameters']['parameters'].append({'name':'Content-Type','value':'application/json; charset=UTF-8'})
  w.node(n,'httpRequest',p,x,y,4.5,onError='continueErrorOutput')
 w.node('Kontoprüfung anfordern','executeWorkflowTrigger',{'inputSource':'passthrough'},0,v=1.1)
 w.customer('Kundenzugang laden','Kontoprüfung anfordern',240)
 code('Kontozuordnung prüfen',"const c="+CTX+";return [{json:orderTarget($input.all().map(i=>i.json),c)}];",480)
 w.condition('YouTube oder TikTok?',"={{ ['youtube','tiktok'].includes("+CTX+".binding.platform) }}",720)
 code('Kontozugang auswählen',"const configured=false;if(!configured)throw Error('TARGET_CONFIGURATION_REQUIRED');return [{json:accountInput($('Kundenzugang laden').all().map(i=>i.json),"+CTX+",$('Kontozuordnung prüfen').first().json.target)}];",960)
 rpc('Kontoprüfung sperren','claim',1200);ok('Kontosperre bestätigen',1440)
 w.customer('Gesperrten Zugang zurücklesen','Kontoprüfung anfordern',1440,-300)
 code('Gesperrten Zugang bestätigen',"const rows=$input.all().map(i=>i.json);const c="+CTX+";const fresh=accountInput(rows,c,orderTarget(rows,c).target);if(fresh.fingerprint!=="+INPUT+".fingerprint)throw Error('TARGET_CHECK_RUNNING');return [{json:{ok:true}}];",1680,-300)
 rpc('Tokenwechsel vormerken','refresh',1680);ok('Tokenwechsel bestätigt',1920)
 w.condition('YouTube erneuern?',"={{ "+INPUT+".platform === 'youtube' }}",2160)
 for p,label,url,key,y in [('youtube','YouTube','https://oauth2.googleapis.com/token','client_id',0),('tiktok','TikTok','https://open.tiktokapis.com/v2/oauth/token/','client_key',300)]:
  params={'method':'POST','url':url,'sendBody':True,'contentType':'form-urlencoded','bodyParameters':{'parameters':[
   {'name':key,'value':'__SMA_'+p.upper()+'_CLIENT_ID__'},{'name':'client_secret','value':'__SMA_'+p.upper()+'_CLIENT_SECRET__'},
   {'name':'grant_type','value':'refresh_token'},{'name':'refresh_token','value':'={{ '+INPUT+'.refresh_token }}'}]},'options':{**m.OPTS,'response':{'response':{'fullResponse':True,'neverError':True,'responseFormat':'json'}}}}
  w.node(label+'-Zugang erneuern','httpRequest',params,2400,y,4.5,onError='continueErrorOutput')
 code('Tokenantwort prüfen','return [{json:accountRefresh($input.first().json,'+INPUT+')}];',2640)
 w.condition('YouTube-Token speichern?',"={{ "+INPUT+".platform === 'youtube' }}",2880)
 for p,label,y in [('youtube','YouTube',0),('tiktok','TikTok',300)]:
  keys=['access_token','refresh_token','expires_in']+(['refresh_expires_in'] if p=='tiktok' else [])
  w.node(label+'-Token speichern','dataTable',{'operation':'update','dataTableId':{'__rl':True,'value':'oVIgtuR95fFUbMrN','mode':'list','cachedResultName':'SMA_Kunden'},'matchType':'allConditions','filters':{'conditions':[
   {'keyName':'id','keyValue':'={{ '+INPUT+'.row_id }}'},
   {'keyName':'kunde_id','keyValue':'={{ '+INPUT+'.kunde_id }}'},
   {'keyName':p+'_refresh_token','keyValue':'={{ '+INPUT+'.refresh_token }}'},
   {'keyName':p+'_access_token','keyValue':'={{ '+INPUT+'.access_token }}'}]},
   'columns':{'mappingMode':'defineBelow','value':{p+'_'+k:'={{ '+TOKENS+'.'+k+' }}' for k in keys},'matchingColumns':[],
    'schema':[{'id':p+'_'+k,'displayName':p+'_'+k,'required':False,'defaultMatch':False,'display':True,'type':'number' if k.endswith('expires_in') else 'string','readOnly':False,'removed':False} for k in keys],
    'attemptToConvertTypes':False,'convertFieldsToString':False},'options':{}},3120,y,1.1,alwaysOutputData=True,onError='continueErrorOutput')
 w.customer('Gespeicherten Zugang zurücklesen','Kontoprüfung anfordern',3360)
 code('Tokenspeicherung bestätigen','return [{json:accountSaved($input.all().map(i=>i.json),'+INPUT+','+TOKENS+')}];',3600)
 rpc('Tokenwechsel abschließen','saved',3840);ok('Gespeicherten Token verwenden',4080)
 w.condition('YouTube-Konto prüfen?',"={{ "+INPUT+".platform === 'youtube' }}",4320)
 http('YouTube-Kanal rückprüfen','https://www.googleapis.com/youtube/v3/channels',4560,query={'part':'id,snippet','mine':'true','maxResults':'2'})
 http('YouTube-Berechtigung lesen','https://oauth2.googleapis.com/tokeninfo',4800,query={'access_token':'={{ '+TOKENS+'.access_token }}'})
 # tokeninfo is introspection; no Authorization header needed and no token in path.
 w.nodes[-1]['parameters'].pop('sendHeaders');w.nodes[-1]['parameters'].pop('headerParameters')
 http('TikTok-Konto rückprüfen','https://open.tiktokapis.com/v2/user/info/',4560,300,query={'fields':'open_id,display_name'})
 http('TikTok-Optionen lesen','https://open.tiktokapis.com/v2/post/publish/creator_info/query/',4800,300,method='POST')
 code('Portalnachweis erstellen',"const p="+INPUT+".platform;const profile=$(p==='youtube'?'YouTube-Kanal rückprüfen':'TikTok-Konto rückprüfen').first().json;return [{json:{ok:true,target:"+INPUT+".target,account_check:accountEvidence("+INPUT+","+TOKENS+",profile,$input.first().json),can_upload:false,can_publish:false}}];",5040)
 rpc('Kontoprüfung entsperren','release',5280);ok('Entsperrung bestätigen',5520)
 code('Geprüftes Konto zurückgeben',"const r=$('Portalnachweis erstellen').first().json;const c="+CTX+";if(c.choices)accountChoices(r.account_check,c.choices);return [{json:r}];",5760)
 code('Andere Kontozuordnung zurückgeben',"return [{json:{ok:true,...$('Kontozuordnung prüfen').first().json,can_upload:false,can_publish:false}}];",960,600)
 code('Kontofehler bereinigen',"return [{json:accountFailure($input.first().json)}];",5040,900)
 # Refreshing leases intentionally cannot be released on an uncertain error.
 rpc('Kontosperre nach Fehler lösen','release',5280,900)
 code('Kontofehler zurückgeben',"return [{json:$('Kontofehler bereinigen').first().json}];",5520,900)
 def chain(names):
  for a,b in zip(names,names[1:]):w.edge(a,b)
 chain(['Kontoprüfung anfordern','Kundenzugang laden','Kontozuordnung prüfen','YouTube oder TikTok?','Kontozugang auswählen','Kontoprüfung sperren','Kontosperre bestätigen','Gesperrten Zugang zurücklesen','Gesperrten Zugang bestätigen','Tokenwechsel vormerken','Tokenwechsel bestätigt','YouTube erneuern?','YouTube-Zugang erneuern','Tokenantwort prüfen','YouTube-Token speichern?','YouTube-Token speichern','Gespeicherten Zugang zurücklesen','Tokenspeicherung bestätigen','Tokenwechsel abschließen','Gespeicherten Token verwenden','YouTube-Konto prüfen?','YouTube-Kanal rückprüfen','YouTube-Berechtigung lesen','Portalnachweis erstellen','Kontoprüfung entsperren','Entsperrung bestätigen','Geprüftes Konto zurückgeben'])
 w.edge('YouTube oder TikTok?','Andere Kontozuordnung zurückgeben',1)
 w.edge('YouTube erneuern?','TikTok-Zugang erneuern',1);w.edge('TikTok-Zugang erneuern','Tokenantwort prüfen')
 w.edge('YouTube-Token speichern?','TikTok-Token speichern',1);w.edge('TikTok-Token speichern','Gespeicherten Zugang zurücklesen')
 w.edge('YouTube-Konto prüfen?','TikTok-Konto rückprüfen',1);chain(['TikTok-Konto rückprüfen','TikTok-Optionen lesen','Portalnachweis erstellen'])
 for node in w.nodes:
  if node.get('onError')=='continueErrorOutput' and node['name'] not in ['Kontofehler bereinigen','Kontosperre nach Fehler lösen','Kontofehler zurückgeben']:w.edge(node['name'],'Kontofehler bereinigen',1)
 w.edge('Kontofehler bereinigen','Kontosperre nach Fehler lösen');w.edge('Kontosperre nach Fehler lösen','Kontofehler zurückgeben');w.edge('Kontosperre nach Fehler lösen','Kontofehler zurückgeben',1)
 # A failure before the lease exists must still return a sanitized error.
 w.edge('Kontofehler bereinigen','Kontofehler zurückgeben',1)
 return w.write()

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--private-source',type=Path);p.add_argument('--output',type=Path);a=p.parse_args();w=build()
 if a.private_source:
  if not a.output or a.output.resolve().is_relative_to(ROOT):raise SystemExit('Private output must be outside the repository')
  next(n for n in w['nodes'] if n['name']=='Kontozugang auswählen')['parameters']['jsCode']=next(n for n in w['nodes'] if n['name']=='Kontozugang auswählen')['parameters']['jsCode'].replace('const configured=false;','const configured=true;')
  old={n['name']:n for n in json.loads(a.private_source.read_text())['nodes']}
  for platform in ['YouTube','TikTok']:
   source={x['name']:x['value'] for x in old[platform+' – Access Token erneuern']['parameters']['bodyParameters']['parameters']}
   node=next(n for n in w['nodes'] if n['name']==platform+'-Zugang erneuern')
   for param in node['parameters']['bodyParameters']['parameters']:
    if param['name'] in ['client_id','client_key','client_secret']:param['value']=source[param['name']]
  a.output.write_text(json.dumps(w,ensure_ascii=False,indent=2)+'\n');a.output.chmod(0o600)
 print('account nodes',len(w['nodes']))
