"""Dashboard order API and an internal, fail-closed execution gate.

The existing publisher working copy is called with the bound selection.
This builder does not modify that workflow.
No provider write is reachable while the media/account approvals are incomplete.
"""
import argparse,json,uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
CORE=(ROOT/'n8n/publishing/publisher-order.cjs').read_text().split('module.exports=')[0]
FOLDERS=(ROOT/'n8n/publishing/file-catalog.cjs').read_text().split('module.exports=')[0]
SECRET={'httpHeaderAuth':{'id':'FZk3cg0UNdbolH4q','name':'SMA Supabase Secret'}}
DRIVE={'googleDriveOAuth2Api':{'id':'VcVRAhAAnk2YcHNE','name':'Google Drive account 3'}}
BASE='https://bnvnmdxosbnuzedokqgh.supabase.co/rest/v1/rpc/'
OPTS={'redirect':{'redirect':{'followRedirects':False}},'timeout':25000}
SETTINGS={'executionOrder':'v1','saveDataErrorExecution':'none','saveDataSuccessExecution':'none','saveManualExecutions':False,'saveExecutionProgress':False,'executionTimeout':150,'callerPolicy':'workflowsFromSameOwner','availableInMCP':False}

class Builder:
 def __init__(self,name,path):
  self.path=path;self.nodes=[];self.edges={};self.name=name
  self.old={n['name']:n for n in json.loads(path.read_text()).get('nodes',[])} if path.exists() else {}
 def node(self,name,kind,params,x,y=0,v=1,**extra):
  old=self.old.get(name,{})
  if kind=='webhook':extra['webhookId']=old.get('webhookId',str(uuid.uuid4()))
  if 'conditions' in params and old.get('parameters',{}).get('conditions'):
   params['conditions']['conditions'][0]['id']=old['parameters']['conditions']['conditions'][0]['id']
  self.nodes.append({'id':old.get('id',str(uuid.uuid4())),'name':name,'type':'n8n-nodes-base.'+kind,'typeVersion':v,'parameters':params,'position':[x,y],**extra})
 def code(self,name,code,x,y=0,**extra):self.node(name,'code',{'jsCode':code},x,y,2,**extra)
 def edge(self,a,b,port=0):
  m=self.edges.setdefault(a,{'main':[]})['main']
  while len(m)<=port:m.append([])
  m[port].append({'node':b,'type':'main','index':0})
 def condition(self,name,expr,x,y=0):
  self.node(name,'if',{'conditions':{'options':{'caseSensitive':True,'leftValue':'','typeValidation':'strict','version':3},'conditions':[{'id':str(uuid.uuid4()),'leftValue':expr,'rightValue':'','operator':{'type':'boolean','operation':'true','singleValue':True}}],'combinator':'and'},'options':{}},x,y,2.3)
 def rpc(self,name,body,x,y=0,user=False):
  p={'method':'POST','url':BASE+('sma_publication_order_v1' if user else 'sma_publication_order_worker_v1'),'sendBody':True,'specifyBody':'json','jsonBody':body,'options':OPTS}
  if user:p.update({'sendHeaders':True,'headerParameters':{'parameters':[{'name':'apikey','value':'sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW'},{'name':'Authorization','value':"={{ $('Dashboard-Anfrage prüfen').first().json.auth }}"}]}})
  else:p.update({'authentication':'genericCredentialType','genericAuthType':'httpHeaderAuth'})
  self.node(name,'httpRequest',p,x,y,4.5,**({} if user else {'credentials':SECRET}),onError='continueErrorOutput')
 def customer(self,name,context,x,y=0):
  self.node(name,'dataTable',{'operation':'get','dataTableId':{'__rl':True,'value':'oVIgtuR95fFUbMrN','mode':'list','cachedResultName':'SMA_Kunden'},'matchType':'allConditions','filters':{'conditions':[{'keyName':'kunde_id','keyValue':"={{ $('"+context+"').first().json.n8n_kunde_id }}"},{'keyName':'kunde_email','keyValue':"={{ $('"+context+"').first().json.kunde_email }}"},{'keyName':'zugang_aktiv','condition':'isTrue'}]},'limit':2},x,y,1,alwaysOutputData=True,onError='continueErrorOutput')
 def write(self):
  w={'name':self.name,'nodes':self.nodes,'connections':self.edges,'settings':SETTINGS,'pinData':{},'active':False}
  self.path.write_text(json.dumps(w,ensure_ascii=False,indent=2)+'\n');return w

def build_worker(account_id):
 w=Builder('SMA – Veröffentlichungsauftrag – Ausführung V1',ROOT/'n8n/publishing/publication-order-execution-workflow.json')
 w.node('Freigegebenen Auftrag ausführen','executeWorkflowTrigger',{'inputSource':'passthrough'},0,v=1.1)
 w.code('Auftrags-ID prüfen',CORE+"\nconst r=$input.first().json;if($input.all().length!==1||Object.keys(r).join()!=='id'||!ORDER_UUID.test(r.id))throw Error('INVALID_INPUT');return [{json:r}];",240,onError='continueErrorOutput')
 w.rpc('Auftrag exklusiv übernehmen',"={{ {p_action:'claim',p_id:$json.id} }}",480)
 w.condition('Auftrag freigegeben?',"={{ $json.ok === true && !!$json.lease_id }}",720)
 w.customer('Aktuelles Zielkonto laden','Auftrag exklusiv übernehmen',960)
 w.code('Zielkonto und Ordner prüfen',CORE+'\n'+FOLDERS+"\nconst c=$('Auftrag exklusiv übernehmen').first().json;const rows=$input.all().map(i=>i.json);return [{json:{...orderTarget(rows,c),...verifiedFolders(rows,c),drive_file_id:c.binding.drive_file_id}}];",1200,onError='continueErrorOutput')
 w.node('Aktuellen Dateistand lesen','httpRequest',{'url':"={{ 'https://www.googleapis.com/drive/v3/files/'+$('Zielkonto und Ordner prüfen').first().json.drive_file_id }}",'authentication':'predefinedCredentialType','nodeCredentialType':'googleDriveOAuth2Api','sendQuery':True,'queryParameters':{'parameters':[{'name':'fields','value':'id,mimeType,parents,trashed,version,sha256Checksum,md5Checksum,capabilities(canDownload)'},{'name':'supportsAllDrives','value':'true'}]},'options':OPTS},1440,v=4.5,credentials=DRIVE,onError='continueErrorOutput')
 w.code('Dateistand bestätigen',CORE+"\nreturn [{json:orderDrive($input.first().json,$('Auftrag exklusiv übernehmen').first().json,$('Zielkonto und Ordner prüfen').first().json.folders)}];",1680,onError='continueErrorOutput')
 w.code('Gebundenen Portaltext auswählen',"return [{json:$('Auftrag exklusiv übernehmen').first().json.binding}];",1920)
 w.node('Publisher-Arbeitskopie aufrufen','executeWorkflow',{'source':'database','workflowId':{'__rl':True,'value':'JZwPbzCpgIByxk94','mode':'id'},'mode':'once','options':{'waitForSubWorkflow':True}},2160,v=1.3,onError='continueErrorOutput')
 w.code('Ausführungsfreigabe prüfen',CORE+"\nreturn [{json:orderCheck($input.first().json,$('Auftrag exklusiv übernehmen').first().json,$('Zielkonto und Ordner prüfen').first().json,$('Dateistand bestätigen').first().json,$('Portalberechtigung bestätigt').first().json)}];",2400,onError='continueErrorOutput')
 w.rpc('Prüfstand protokollieren','={{ $json }}',2640)
 w.code('Prüffehler protokollieren',CORE+"\nconst c=$('Auftrag exklusiv übernehmen').first().json;return [{json:{p_action:'finish_check',p_id:c.id,p_lease:c.lease_id,p_data:{target:null,drive_verified:false,text_verified:false,blockers:[orderFailure($input.first().json).code]}}}];",2160,300)
 w.code('Auftragsfehler bereinigen',CORE+"\nreturn [{json:orderFailure($input.first().json)}];",2880,300)
 for a,b in zip(w.nodes[:12],w.nodes[1:12]):w.edge(a['name'],b['name'])
 w.edge('Auftrag freigegeben?','Auftragsfehler bereinigen',1)
 for name in ['Auftrags-ID prüfen','Auftrag exklusiv übernehmen','Prüfstand protokollieren']:w.edge(name,'Auftragsfehler bereinigen',1)
 for name in ['Aktuelles Zielkonto laden','Zielkonto und Ordner prüfen','Aktuellen Dateistand lesen','Dateistand bestätigen','Publisher-Arbeitskopie aufrufen','Ausführungsfreigabe prüfen']:w.edge(name,'Prüffehler protokollieren',1)
 w.code('Kontoprüfung auswählen',"return [{json:$('Auftrag exklusiv übernehmen').first().json}];",1320,-500)
 w.node('Portalberechtigung rückprüfen','executeWorkflow',{'source':'database','workflowId':{'__rl':True,'value':account_id,'mode':'id'},'mode':'once','options':{'waitForSubWorkflow':True}},1560,-500,1.3,onError='continueErrorOutput')
 w.code('Portalberechtigung bestätigt',CORE+"\nconst r=$input.first().json;if(r.ok!==true)throw Error(orderFailure(r).code);return [{json:r}];",1800,-500,onError='continueErrorOutput')
 w.edges['Zielkonto und Ordner prüfen']['main'][0]=[]
 w.edge('Zielkonto und Ordner prüfen','Kontoprüfung auswählen');w.edge('Kontoprüfung auswählen','Portalberechtigung rückprüfen');w.edge('Portalberechtigung rückprüfen','Portalberechtigung bestätigt');w.edge('Portalberechtigung bestätigt','Aktuellen Dateistand lesen')
 for name in ['Portalberechtigung rückprüfen','Portalberechtigung bestätigt']:w.edge(name,'Prüffehler protokollieren',1)
 w.edge('Prüffehler protokollieren','Prüfstand protokollieren')
 return w.write()

def build_api(worker_id,account_id,comparison_delivery_id=None,provider_dispatch_id=None):
 w=Builder('SMA – Dashboard – Veröffentlichungsauftrag V1',ROOT/'n8n/publishing/publication-order-api-workflow.json')
 w.node('Dashboard-Auftrag','webhook',{'httpMethod':'POST','path':'sma-publication-order-v1','responseMode':'responseNode','options':{'allowedOrigins':'https://sma-automation.com'}},0,v=2.1)
 w.code('Dashboard-Anfrage prüfen',CORE+"\nreturn [{json:orderRequest($input.first().json)}];",240,onError='continueErrorOutput')
 w.rpc('Eigenen Auftrag bearbeiten',"={{ {p_action:$json.action,p_input:$json.input} }}",480,user=True)
 w.condition('Zielkonto zuordnen?',"={{ $json.ok === true && $json.state === 'preparing' && $('Dashboard-Anfrage prüfen').first().json.action === 'prepare' }}",720)
 w.rpc('Auftragsbindung lesen',"={{ {p_action:'context',p_id:$json.id} }}",960)
 w.condition('Auftragsbindung vorhanden?','={{ $json.ok === true }}',1200)
 w.customer('Kundenzielkonto laden','Auftragsbindung lesen',1440)
 w.code('Kundenzielkonto prüfen',CORE+"\nreturn [{json:orderTarget($input.all().map(i=>i.json),$('Auftragsbindung lesen').first().json)}];",1680,onError='continueErrorOutput')
 w.rpc('Zielkonto festhalten',"={{ {p_action:'bind_target',p_id:$('Auftragsbindung lesen').first().json.id,p_data:$json} }}",1920)
 w.condition('Freigegebenen Auftrag prüfen?',"={{ $json.ok === true && ['approved','blocked'].includes($json.state) && $('Dashboard-Anfrage prüfen').first().json.action === 'approve' }}",960,300)
 w.code('Ausführungsauftrag auswählen',"return [{json:{id:$json.id}}];",1200,300)
 w.node('Auftragsprüfung ausführen','executeWorkflow',{'source':'database','workflowId':{'__rl':True,'value':worker_id,'mode':'id'},'mode':'once','options':{'waitForSubWorkflow':True}},1440,300,1.3,onError='continueErrorOutput')
 w.code('Sichere Auftragsfehlermeldung',CORE+"\nreturn [{json:orderFailure($input.first().json)}];",1920,600)
 w.code('Auftragsantwort prüfen',"const r=$input.first().json;if(r.ok===true&&r.stage==='account'&&r.can_upload===false&&r.can_publish===false)return [{json:r}];if(r.ok===true&&r.can_upload===false&&r.can_publish===false&&r.id&&r.state)return [{json:r}];const codes=['AUTH_REQUIRED','INVALID_INPUT','ORDER_UNAVAILABLE','TARGET_ACCOUNT_REQUIRED','TARGET_ACCOUNT_CHANGED','FILE_CHANGED','FINAL_APPROVAL_REQUIRED','ORDER_RUNNING','FILE_REFRESH_REQUIRED','ORDER_CHANGED','REQUEST_CONFLICT','DUPLICATE_PUBLICATION','ORDER_NOT_PREPARED','ACCESS_INACTIVE','ACCOUNT_UNAVAILABLE','ORDER_RATE_LIMITED','ASSIGNMENT_UNAVAILABLE','ASSIGNMENT_CHANGED','INVALID_CHOICES','TARGET_CONFIGURATION_REQUIRED','TARGET_PERMISSIONS_REQUIRED','TARGET_RECONNECT_REQUIRED','TARGET_CHECK_RUNNING','TARGET_CHECK_UNAVAILABLE','TARGET_REFRESH_UNCERTAIN','TARGET_TOKEN_SAVE_FAILED','TARGET_OPTIONS_CHANGED','TARGET_RATE_LIMITED'];return [{json:{ok:false,can_upload:false,can_publish:false,code:codes.includes(r.code)?r.code:'ORDER_UNAVAILABLE',...(r.code==='DUPLICATE_PUBLICATION'?{existing_order_id:r.existing_order_id}:{})}}];",2160,200)
 w.node('Dashboard-Antwort','respondToWebhook',{'respondWith':'json','responseBody':'={{ $json }}','options':{'responseCode':200,'responseHeaders':{'entries':[{'name':'Cache-Control','value':'no-store'},{'name':'Access-Control-Allow-Origin','value':'https://sma-automation.com'},{'name':'Vary','value':'Origin'}]}}},2400,200,1.5)
 for a,b in zip(w.nodes[:9],w.nodes[1:9]):w.edge(a['name'],b['name'])
 w.edge('Zielkonto zuordnen?','Freigegebenen Auftrag prüfen?',1)
 w.edge('Auftragsbindung vorhanden?','Auftragsantwort prüfen',1)
 w.edge('Zielkonto festhalten','Auftragsantwort prüfen')
 w.edge('Freigegebenen Auftrag prüfen?','Ausführungsauftrag auswählen')
 w.edge('Freigegebenen Auftrag prüfen?','Auftragsantwort prüfen',1)
 w.edge('Ausführungsauftrag auswählen','Auftragsprüfung ausführen')
 w.edge('Auftragsprüfung ausführen','Auftragsantwort prüfen')
 for name in ['Dashboard-Anfrage prüfen','Eigenen Auftrag bearbeiten','Auftragsbindung lesen','Kundenzielkonto laden','Kundenzielkonto prüfen','Zielkonto festhalten','Auftragsprüfung ausführen']:w.edge(name,'Sichere Auftragsfehlermeldung',1)
 # Preparation repeats the provider read and binds only safe evidence.
 w.code('Kontoprüfung zum Auftrag auswählen',"return [{json:$('Auftragsbindung lesen').first().json}];",1680,-500)
 w.node('Auftragskonto rückprüfen','executeWorkflow',{'source':'database','workflowId':{'__rl':True,'value':account_id,'mode':'id'},'mode':'once','options':{'waitForSubWorkflow':True}},1920,-500,1.3,onError='continueErrorOutput')
 w.code('Auftragskonto bestätigt',CORE+"\nconst r=$input.first().json;if(r.ok!==true)throw Error(orderFailure(r).code);return [{json:r}];",2160,-500,onError='continueErrorOutput')
 w.edges['Kundenzielkonto prüfen']['main'][0]=[]
 w.edge('Kundenzielkonto prüfen','Kontoprüfung zum Auftrag auswählen');w.edge('Kontoprüfung zum Auftrag auswählen','Auftragskonto rückprüfen');w.edge('Auftragskonto rückprüfen','Auftragskonto bestätigt');w.edge('Auftragskonto bestätigt','Zielkonto festhalten')
 # Before choices, derive the owner's context using their JWT. This branch never
 # exposes customer-table or token fields in the dashboard response.
 w.condition('Kontooptionen angefordert?',"={{ $json.action === 'account' }}",360,-1000)
 w.rpc('Eigenes Kontoziel lesen',"={{ {p_platform:$('Dashboard-Anfrage prüfen').first().json.input.platform} }}",600,-1000,user=True)
 w.nodes[-1]['parameters']['url']=BASE+'sma_publication_account_context_v1'
 w.code('Eigenes Kontoziel bestätigt',CORE+"\nconst r=$input.first().json;if(r.ok!==true)throw Error(orderFailure(r).code);return [{json:r}];",840,-1000,onError='continueErrorOutput')
 w.node('Aktuelle Kontooptionen laden','executeWorkflow',{'source':'database','workflowId':{'__rl':True,'value':account_id,'mode':'id'},'mode':'once','options':{'waitForSubWorkflow':True}},1080,-1000,1.3,onError='continueErrorOutput')
 w.code('Kontooptionen zurückgeben',CORE+"\nconst r=$input.first().json;if(r.ok!==true||!r.account_check)throw Error(orderFailure(r).code);const {source_revision,...target}=r.target;const {target_revision,...account_check}=r.account_check;return [{json:{ok:true,stage:'account',id:$('Dashboard-Anfrage prüfen').first().json.input.id,target,account_check,can_upload:false,can_publish:false}}];",1320,-1000,onError='continueErrorOutput')
 w.edges['Dashboard-Anfrage prüfen']['main'][0]=[]
 w.edge('Dashboard-Anfrage prüfen','Kontooptionen angefordert?');w.edge('Kontooptionen angefordert?','Eigenes Kontoziel lesen');w.edge('Kontooptionen angefordert?','Eigenen Auftrag bearbeiten',1)
 w.edge('Eigenes Kontoziel lesen','Eigenes Kontoziel bestätigt');w.edge('Eigenes Kontoziel bestätigt','Aktuelle Kontooptionen laden');w.edge('Aktuelle Kontooptionen laden','Kontooptionen zurückgeben');w.edge('Kontooptionen zurückgeben','Auftragsantwort prüfen')
 for name in ['Auftragskonto rückprüfen','Auftragskonto bestätigt','Eigenes Kontoziel lesen','Eigenes Kontoziel bestätigt','Aktuelle Kontooptionen laden','Kontooptionen zurückgeben']:w.edge(name,'Sichere Auftragsfehlermeldung',1)
 w.edge('Sichere Auftragsfehlermeldung','Auftragsantwort prüfen');w.edge('Auftragsantwort prüfen','Dashboard-Antwort')
 if comparison_delivery_id:
  # The durable outbox is inserted by the order transaction. Every successful
  # order read can redeliver a lost kickoff; model calls remain fingerprint-bound.
  w.condition('Auftragsabgleich anstoßen?',"={{ $json.ok === true && !!$json.id && ['preparing','prepared','approved','blocked','checked'].includes($json.state) }}",2400,200)
  w.code('Auftragsantwort merken','return $input.all();',2640,0)
  w.node('Inhaltsabgleich im Hintergrund','executeWorkflow',{'source':'database','workflowId':{'__rl':True,'value':comparison_delivery_id,'mode':'id'},'mode':'once','options':{'waitForSubWorkflow':True}},2880,0,1.3,onError='continueErrorOutput')
  w.code('Unveränderte Auftragsantwort',"return $('Auftragsantwort merken').all();",3120,0)
  # Respond first, then retain a supervised execution for the internal calls.
  # Detached child starts did not deliver reliably in the hosted live test.
  w.edge('Dashboard-Antwort','Auftragsabgleich anstoßen?')
  w.edge('Auftragsabgleich anstoßen?','Auftragsantwort merken')
  w.edge('Auftragsantwort merken','Inhaltsabgleich im Hintergrund')
  w.edge('Inhaltsabgleich im Hintergrund','Unveränderte Auftragsantwort')
  w.edge('Inhaltsabgleich im Hintergrund','Unveränderte Auftragsantwort',1)
 if provider_dispatch_id:
  # Only an already checked order can enter the internal dispatcher. The
  # database still requires the separate operator permit before any upload.
  # A later authenticated get resumes the same journal, never a new attempt.
  w.condition('Geprüften Providerauftrag fortsetzen?',"={{ $json.ok === true && !!$json.id && $json.state === 'checked' && ['approve','get'].includes($('Dashboard-Anfrage prüfen').first().json.action) }}",3360,200)
  w.code('Provider-Auftragsantwort merken','return $input.all();',3600,0)
  w.code('Providerauftrag auswählen','return [{json:{id:$json.id}}];',3840,0)
  w.node('Providerweg im Hintergrund','executeWorkflow',{'source':'database','workflowId':{'__rl':True,'value':provider_dispatch_id,'mode':'id'},'mode':'once','options':{'waitForSubWorkflow':True}},4080,0,1.3,onError='continueErrorOutput')
  w.code('Auftragsantwort nach Providerstart',"return $('Provider-Auftragsantwort merken').all();",4320,0)
  if comparison_delivery_id:
   w.edge('Auftragsabgleich anstoßen?','Geprüften Providerauftrag fortsetzen?',1)
   w.edge('Unveränderte Auftragsantwort','Geprüften Providerauftrag fortsetzen?')
  else:w.edge('Dashboard-Antwort','Geprüften Providerauftrag fortsetzen?')
  w.edge('Geprüften Providerauftrag fortsetzen?','Provider-Auftragsantwort merken')
  w.edge('Provider-Auftragsantwort merken','Providerauftrag auswählen')
  w.edge('Providerauftrag auswählen','Providerweg im Hintergrund')
  w.edge('Providerweg im Hintergrund','Auftragsantwort nach Providerstart')
  w.edge('Providerweg im Hintergrund','Auftragsantwort nach Providerstart',1)
 workflow=w.write()
 if comparison_delivery_id or provider_dispatch_id:
  workflow['settings']={**workflow['settings'],'executionTimeout':600}
  w.path.write_text(json.dumps(workflow,ensure_ascii=False,indent=2)+'\n')
 return workflow

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--worker-id',required=True);p.add_argument('--account-id',required=True);p.add_argument('--comparison-delivery-id');p.add_argument('--provider-dispatch-id');args=p.parse_args()
 print('worker',len(build_worker(args.account_id)['nodes']),'API',len(build_api(args.worker_id,args.account_id,args.comparison_delivery_id,args.provider_dispatch_id)['nodes']))
