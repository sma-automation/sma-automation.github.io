"""Private, asynchronous order-bound delivery. No public endpoint or schedule."""
import importlib.util,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('orders',ROOT/'n8n/publishing/build-publication-orders.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
w=m.Builder('SMA – Auftrag – Inhaltsabgleich V1',ROOT/'n8n/publishing/comparison-delivery-workflow.json')
w.node('Auftragsabgleich starten','executeWorkflowTrigger',{'inputSource':'passthrough'},0,v=1.1)
w.code('Auftrag auswählen',"const r=$input.first().json;if($input.all().length!==1||typeof r.id!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(r.id))throw Error('INVALID_INPUT');return [{json:{id:r.id}}];",240)
def rpc(name,body,x):
 w.rpc(name,body,x);w.nodes[-1]['parameters']['url']=m.BASE+'sma_publication_comparison_delivery_v1'
rpc('Abgleichauftrag übernehmen',"={{ {p_action:'claim',p_id:$json.id} }}",480)
w.condition('Abgleichauftrag übernommen?',"={{ $json.ok === true && !!$json.lease_id }}",720)
w.code('Gebundenen Beitrag auswählen',"return [{json:$json.binding}];",960)
w.node('Gespeicherten Beitrag vergleichen','executeWorkflow',{'source':'database','workflowId':{'__rl':True,'value':'1qMj37a5gXlrbCWd','mode':'id'},'mode':'once','options':{'waitForSubWorkflow':True}},1200,v=1.3,onError='continueErrorOutput')
rpc('Abgleichauftrag abschließen',"={{ {p_action:'finish',p_id:$('Abgleichauftrag übernehmen').first().json.id,p_lease:$('Abgleichauftrag übernehmen').first().json.lease_id} }}",1440)
w.code('Abgleichstatus bereinigen',"return [{json:{ok:$json.ok===true,state:['completed','running','needs_review'].includes($json.state)?$json.state:'needs_review',can_upload:false,can_publish:false}}];",1680)
for a,b in zip(w.nodes[:7],w.nodes[1:]):w.edge(a['name'],b['name'])
w.edge('Abgleichauftrag übernommen?','Abgleichstatus bereinigen',1)
w.edge('Gespeicherten Beitrag vergleichen','Abgleichauftrag abschließen',1)
for name in ['Abgleichauftrag übernehmen','Abgleichauftrag abschließen']:w.edge(name,'Abgleichstatus bereinigen',1)
workflow=w.write();workflow['settings']['executionTimeout']=270
w.path.write_text(json.dumps(workflow,ensure_ascii=False,indent=2)+'\n')
print(len(workflow['nodes']),'nodes')
