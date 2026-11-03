"""Build an internal, read-only subworkflow; never attach it to a publisher automatically."""
import json
import uuid
from pathlib import Path

path = Path('n8n/publishing/publisher-handoff-workflow.json')
previous = json.loads(path.read_text()) if path.exists() else {}
old = {n['name']: n for n in previous.get('nodes', [])}
core = Path('n8n/publishing/publisher-handoff.cjs').read_text().split('module.exports =')[0]
nodes = []

def node(name, kind, parameters, x, version=1, **extra):
    nodes.append({'id':old.get(name, {}).get('id', str(uuid.uuid4())), 'name':name,
                  'type':'n8n-nodes-base.' + kind, 'typeVersion':version,
                  'position':old.get(name, {}).get('position', [x, 0]), 'parameters':parameters, **extra})

node('Gespeicherten Stand prüfen', 'executeWorkflowTrigger', {'inputSource':'passthrough'}, 0, 1.1)
node('Auswahl festhalten', 'code', {'jsCode':core + "\nif($input.all().length!==1)throw Error('INVALID_HANDOFF_INPUT');\nconst selection=requireHandoffRequest($input.first().json);return [{json:{selection,rpc:handoffRpcInput(selection)}}];"}, 280, 2)
node('Gespeicherte Zuordnung lesen', 'httpRequest', {
    'method':'POST', 'url':'https://bnvnmdxosbnuzedokqgh.supabase.co/rest/v1/rpc/sma_publication_assignment_v1',
    'authentication':'genericCredentialType', 'genericAuthType':'httpHeaderAuth',
    'sendBody':True, 'specifyBody':'json', 'jsonBody':'={{ $json.rpc }}',
    'options':{'redirect':{'redirect':{'followRedirects':False}}, 'timeout':25000,
               'response':{'response':{'responseFormat':'json'}}}
}, 560, 4.5, credentials={'httpHeaderAuth':{'id':'FZk3cg0UNdbolH4q', 'name':'SMA Supabase Secret'}}, onError='continueRegularOutput')
node('Übergabe prüfen', 'code', {'jsCode':core + "\nif($input.all().length!==1)throw Error('HANDOFF_UNAVAILABLE');\nreturn [{json:makeHandoff($input.first().json,$('Auswahl festhalten').first().json.selection)}];"}, 840, 2)
connections = {a['name']:{'main':[[{'node':b['name'], 'type':'main', 'index':0}]]} for a,b in zip(nodes,nodes[1:])}
workflow = {'name':'SMA – Gespeicherte Portaltexte – Übergabeprüfung V1', 'nodes':nodes, 'connections':connections,
    'pinData':{}, 'active':False, 'settings':{'executionOrder':'v1', 'binaryMode':'separate', 'timeSavedMode':'fixed', 'saveDataErrorExecution':'none',
    'saveDataSuccessExecution':'none', 'saveManualExecutions':False, 'saveExecutionProgress':False,
    'executionTimeout':60, 'callerPolicy':'workflowsFromSameOwner', 'availableInMCP':False}}
path.write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + '\n')
print(len(nodes), 'nodes')
