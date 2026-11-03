"""Manual QA of two explicit saved selections. Private output only."""
import argparse,json,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def build(source,workflow_id):
 selections=source['selections']
 if len(selections)!=2 or {x['binding']['platform'] for x in selections}!={'youtube','tiktok'}:raise ValueError('Exactly two channel selections required')
 nodes=[]
 def node(name,kind,p,x,v=2):nodes.append({'id':str(uuid.uuid4()),'name':name,'type':'n8n-nodes-base.'+kind,'typeVersion':v,'parameters':p,'position':[x,0]})
 node('Abgleich manuell prüfen','manualTrigger',{},0,1)
 node('Ausgewählte Kanalbeiträge','code',{'jsCode':'return '+json.dumps([{'json':x['binding']} for x in selections],ensure_ascii=False)+';'},240)
 node('Inhaltsabgleich je Portal','executeWorkflow',{'workflowId':{'__rl':True,'value':workflow_id,'mode':'id'},'mode':'each','options':{'waitForSubWorkflow':True}},480,1.3)
 node('Beide Ergebnisse prüfen','code',{'jsCode':"const rows=$input.all().map(i=>i.json);if(rows.length!==2||rows.some(r=>r.ok!==true||r.state!=='completed'||r.can_upload!==false||r.can_publish!==false||!r.result||r.result.can_upload!==false||r.result.can_publish!==false))throw Error('COMPARISON_REHEARSAL_FAILED');const bindings=$('Ausgewählte Kanalbeiträge').all().map(i=>i.json);return rows.map((r,i)=>({json:{platform:bindings[i].platform,verdict:r.result.verdict,issues:r.result.issues.length,scope:r.result.scope,can_upload:false,can_publish:false}}));"},720)
 edges={a['name']:{'main':[[{'node':b['name'],'type':'main','index':0}]]} for a,b in zip(nodes,nodes[1:])}
 return {'name':'QA – YouTube und TikTok – Inhaltsabgleich','nodes':nodes,'connections':edges,'pinData':{},'active':False,'settings':{'executionOrder':'v1','saveDataErrorExecution':'none','saveDataSuccessExecution':'none','saveManualExecutions':False,'saveExecutionProgress':False,'executionTimeout':450,'callerPolicy':'workflowsFromSameOwner','availableInMCP':False}}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--workflow-id',required=True);a=p.parse_args();out=Path(a.output).resolve()
 if out.is_relative_to(ROOT):raise ValueError('Private output must stay outside repository')
 out.write_text(json.dumps(build(json.loads(Path(a.input).read_text()),a.workflow_id),ensure_ascii=False,indent=2)+'\n')
