import json,uuid
from pathlib import Path
core=Path('n8n/publishing/prepare-preview.cjs').read_text().split('module.exports =')[0]
nodes=[];connections={}
def node(name,typ,params,x,y=0,version=1,**kw):
 n={'parameters':params,'id':str(uuid.uuid4()),'name':name,'type':'n8n-nodes-base.'+typ,'typeVersion':version,'position':[x,y],**kw};nodes.append(n);return n
def edge(a,b,port=0):
 arr=connections.setdefault(a,{'main':[]})['main']
 while len(arr)<=port:arr.append([])
 arr[port].append({'node':b,'type':'main','index':0})
def code(name,s,x,y=0,**kw):return node(name,'code',{'jsCode':s},x,y,2,**kw)
def cond(name,expr,x,y=0):return node(name,'if',{'conditions':{'options':{'caseSensitive':True,'leftValue':'','typeValidation':'strict','version':3},'conditions':[{'id':str(uuid.uuid4()),'leftValue':expr,'rightValue':'','operator':{'type':'boolean','operation':'true','singleValue':True}}],'combinator':'and'},'options':{}},x,y,2.3)
http={'method':'POST','sendBody':True,'specifyBody':'json','options':{'redirect':{'redirect':{'followRedirects':False}},'timeout':20000}}
node('Textvorschau anfordern','webhook',{'httpMethod':'POST','path':'sma-publication-preview-v1','responseMode':'responseNode','options':{'allowedOrigins':'https://sma-automation.com'}},0,version=2.1,webhookId=str(uuid.uuid4()))
code('Eingabe prüfen',core+"\ntry { const raw=$input.first().json; const auth=raw.headers?.authorization; if(typeof auth!=='string'||!/^Bearer [A-Za-z0-9._-]{20,8000}$/.test(auth)) throw Error('AUTH_REQUIRED'); if(JSON.stringify(raw.body||{}).length>40000) throw Error('INVALID_INPUT'); const input=requireInput(raw.body); return [{json:{valid:true,input,auth}}]; } catch(e) { return [{json:{valid:false,ok:false,code:e.message==='AUTH_REQUIRED'?'AUTH_REQUIRED':'INVALID_INPUT'}}]; }",240)
cond('Eingabe gültig?','={{ $json.valid === true }}',480)
node('Konto und Shop prüfen','httpRequest',{**http,'url':'https://bnvnmdxosbnuzedokqgh.supabase.co/rest/v1/rpc/sma_publication_preview_v1','sendHeaders':True,'headerParameters':{'parameters':[{'name':'apikey','value':'sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW'},{'name':'Authorization','value':'={{ $json.auth }}'}]},'jsonBody':"={{ {p_action:'prepare',p_input:$json.input} }}"},720,version=4.5,onError='continueErrorOutput')
cond('Neue Vorschau?','={{ $json.ok === true && $json.start_generation === true }}',960)
code('Textauftrag vorbereiten',core+"\nreturn [{json:{request:modelRequest($input.first().json)}}];",1200,onError='continueErrorOutput')
node('Portaltexte erstellen','httpRequest',{**http,'url':'https://api.openai.com/v1/responses','authentication':'predefinedCredentialType','nodeCredentialType':'openAiApi','jsonBody':'={{ $json.request }}','options':{'redirect':{'redirect':{'followRedirects':False}},'timeout':85000}},1440,version=4.5,credentials={'openAiApi':{'id':'yjrYph78fR5JjBW3','name':'OpenAI account'}},onError='continueErrorOutput')
code('Text und Shop-Link prüfen',core+"\nconst ctx=$('Konto und Shop prüfen').first().json; return [{json:{p_id:ctx.id,p_lease:ctx.lease_id,p_preview:makePreview($input.first().json,ctx)}}];",1680,onError='continueErrorOutput')
cred={'httpHeaderAuth':{'id':'FZk3cg0UNdbolH4q','name':'SMA Supabase Secret'}}
node('Vorschau speichern','httpRequest',{**http,'url':'https://bnvnmdxosbnuzedokqgh.supabase.co/rest/v1/rpc/sma_publication_preview_finish_v1','authentication':'genericCredentialType','genericAuthType':'httpHeaderAuth','jsonBody':'={{ $json }}'},1920,version=4.5,credentials=cred,onError='continueErrorOutput')
code('Fehler zuordnen',"const ctx=$('Konto und Shop prüfen').first().json; return [{json:{p_id:ctx.id,p_lease:ctx.lease_id,p_error:'PREPARATION_FAILED'}}];",1440,300)
node('Fehler speichern','httpRequest',{**http,'url':'https://bnvnmdxosbnuzedokqgh.supabase.co/rest/v1/rpc/sma_publication_preview_finish_v1','authentication':'genericCredentialType','genericAuthType':'httpHeaderAuth','jsonBody':'={{ $json }}'},1680,300,4.5,credentials=cred,onError='continueErrorOutput')
code('Sichere Fehlermeldung',"return [{json:{ok:false,code:'PREPARATION_UNAVAILABLE'}}];",1920,500)
code('Antwort bereinigen',"const r=$input.first().json; const out={ok:r.ok===true}; for(const k of ['status','id','preview','revision','code','error_code']) if(r[k]!==undefined)out[k]=r[k]; return [{json:out}];",2160,100)
node('Antwort','respondToWebhook',{'respondWith':'json','responseBody':'={{ $json }}','options':{'responseCode':200,'responseHeaders':{'entries':[{'name':'Cache-Control','value':'no-store'},{'name':'Access-Control-Allow-Origin','value':'https://sma-automation.com'},{'name':'Vary','value':'Origin'}]}}},2400,100,1.5)
for a,b,port in [('Textvorschau anfordern','Eingabe prüfen',0),('Eingabe prüfen','Eingabe gültig?',0),('Eingabe gültig?','Konto und Shop prüfen',0),('Eingabe gültig?','Antwort bereinigen',1),('Konto und Shop prüfen','Neue Vorschau?',0),('Konto und Shop prüfen','Sichere Fehlermeldung',1),('Neue Vorschau?','Textauftrag vorbereiten',0),('Neue Vorschau?','Antwort bereinigen',1),('Textauftrag vorbereiten','Portaltexte erstellen',0),('Textauftrag vorbereiten','Fehler zuordnen',1),('Portaltexte erstellen','Text und Shop-Link prüfen',0),('Portaltexte erstellen','Fehler zuordnen',1),('Text und Shop-Link prüfen','Vorschau speichern',0),('Text und Shop-Link prüfen','Fehler zuordnen',1),('Vorschau speichern','Antwort bereinigen',0),('Vorschau speichern','Sichere Fehlermeldung',1),('Fehler zuordnen','Fehler speichern',0),('Fehler speichern','Antwort bereinigen',0),('Fehler speichern','Sichere Fehlermeldung',1),('Sichere Fehlermeldung','Antwort bereinigen',0),('Antwort bereinigen','Antwort',0)]:edge(a,b,port)
w={'name':'SMA – Portaltexte und Shop-Link – Vorschau V1','nodes':nodes,'connections':connections,'pinData':{},'settings':{'executionOrder':'v1','saveDataErrorExecution':'none','saveDataSuccessExecution':'none','saveManualExecutions':False,'saveExecutionProgress':False,'executionTimeout':150,'callerPolicy':'workflowsFromSameOwner','availableInMCP':False},'active':False}
Path('n8n/publishing/preview-workflow.json').write_text(json.dumps(w,ensure_ascii=False,indent=2))
print(len(nodes),'nodes; no publishing nodes')
