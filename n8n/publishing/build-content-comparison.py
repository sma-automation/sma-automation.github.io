"""Internal comparison only. No media upload or social provider endpoint."""
import json,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
path=ROOT/'n8n/publishing/content-comparison-workflow.json'
core=(ROOT/'n8n/publishing/portal-content-comparison.cjs').read_text().split('module.exports=')[0]
handoff=(ROOT/'n8n/publishing/publisher-handoff.cjs').read_text().split('module.exports =')[0]
old={n['name']:n for n in json.loads(path.read_text()).get('nodes',[])} if path.exists() else {}
nodes=[];edges={}
def node(name,kind,p,x,y=0,v=2,**extra):
 nodes.append(dict(id=old.get(name,{}).get('id',str(uuid.uuid4())),name=name,type='n8n-nodes-base.'+kind,typeVersion=v,parameters=p,position=[x,y],**extra))
def code(name,body,x,y=0):node(name,'code',{'jsCode':body},x,y,onError='continueErrorOutput')
def edge(a,b,port=0):
 ports=edges.setdefault(a,{'main':[]})['main']
 while len(ports)<=port:ports.append([])
 ports[port].append({'node':b,'type':'main','index':0})
def rpc(name,body,x,y=0):
 node(name,'httpRequest',{'method':'POST','url':'https://bnvnmdxosbnuzedokqgh.supabase.co/rest/v1/rpc/sma_publication_comparison_v1','authentication':'genericCredentialType','genericAuthType':'httpHeaderAuth','sendBody':True,'specifyBody':'json','jsonBody':body,'options':{'timeout':25000,'redirect':{'redirect':{'followRedirects':False}}}},x,y,4.5,credentials={'httpHeaderAuth':{'id':'FZk3cg0UNdbolH4q','name':'SMA Supabase Secret'}},onError='continueErrorOutput')
node('Gespeicherten Beitrag abgleichen','executeWorkflowTrigger',{'inputSource':'passthrough'},0,v=1.1)
code('Auswahl prüfen',handoff+"\nif($input.all().length!==1)throw Error('INVALID_HANDOFF_INPUT');const b=requireHandoffRequest($input.first().json);if(!['youtube','tiktok'].includes(b.platform)||b.media_kind!=='video')throw Error('INVALID_HANDOFF_INPUT');return [{json:b}];",240)
rpc('Abgleich reservieren',"={{ {p_action:'start',p_binding:$json} }}",480)
node('Neuer Abgleich?', 'if',{'conditions':{'options':{'caseSensitive':True,'leftValue':'','typeValidation':'strict','version':3},'conditions':[{'id':old.get('Neuer Abgleich?',{}).get('parameters',{}).get('conditions',{}).get('conditions',[{'id':str(uuid.uuid4())}])[0]['id'],'leftValue':"={{ $json.ok === true && $json.state === 'processing' && !!$json.lease_id }}",'rightValue':'','operator':{'type':'boolean','operation':'true','singleValue':True}}],'combinator':'and'},'options':{}},720,v=2.3)
code('Inhaltsabgleich vorbereiten',core+"\nreturn [{json:{request:comparisonRequest($input.first().json)}}];",960)
node('Gespeicherten Text prüfen','httpRequest',{'method':'POST','url':'https://api.openai.com/v1/responses','authentication':'predefinedCredentialType','nodeCredentialType':'openAiApi','sendBody':True,'specifyBody':'json','jsonBody':'={{ $json.request }}','options':{'timeout':140000,'redirect':{'redirect':{'followRedirects':False}}}},1200,v=4.5,credentials={'openAiApi':{'id':'yjrYph78fR5JjBW3','name':'OpenAI account'}},onError='continueErrorOutput')
code('Abgleichergebnis prüfen',core+"\nconst c=$('Abgleich reservieren').first().json;return [{json:comparisonResult($input.first().json,c)}];",1440)
rpc('Abgleich speichern',"={{ {p_action:'finish',p_binding:$('Auswahl prüfen').first().json,p_lease:$('Abgleich reservieren').first().json.lease_id,p_result:$json} }}",1680)
code('Abgleich sicher zurückgeben',core+"\nconst r=$input.first().json;return [{json:r.ok===true&&r.state==='completed'&&r.result?.policy_version===COMPARISON_POLICY&&r.can_upload===false&&r.can_publish===false?r:comparisonFailure()}];",1920)
rpc('Abgleichfehler speichern',"={{ {p_action:'fail',p_binding:$('Auswahl prüfen').first().json,p_lease:$('Abgleich reservieren').first().json.lease_id} }}",1440,300)
code('Abgleichfehler bereinigen',core+"\nreturn [{json:comparisonFailure()}];",1920,300)
for a,b in zip(nodes[:9],nodes[1:9]):edge(a['name'],b['name'])
edge('Neuer Abgleich?','Abgleich sicher zurückgeben',1)
for name in ['Inhaltsabgleich vorbereiten','Gespeicherten Text prüfen','Abgleichergebnis prüfen']:edge(name,'Abgleichfehler speichern',1)
edge('Abgleichfehler speichern','Abgleichfehler bereinigen')
for name in ['Auswahl prüfen','Abgleich reservieren','Abgleich speichern','Abgleich sicher zurückgeben','Abgleichfehler speichern']:edge(name,'Abgleichfehler bereinigen',1)
path.write_text(json.dumps({'name':'SMA – Portaltext – Inhaltsabgleich V1','nodes':nodes,'connections':edges,'active':False,'pinData':{},'settings':{'executionOrder':'v1','saveDataSuccessExecution':'none','saveDataErrorExecution':'none','saveManualExecutions':False,'saveExecutionProgress':False,'executionTimeout':210,'callerPolicy':'workflowsFromSameOwner','availableInMCP':False}},ensure_ascii=False,indent=2)+'\n')
print(len(nodes),'nodes')
