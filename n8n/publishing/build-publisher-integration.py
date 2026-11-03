"""Prepare a private, inactive copy of the existing customer workflow.

The source export may contain private provider settings. Never commit either the
source export or the generated full copy. Only the patch implementation is public.
All old entry points are removed from the executable graph. The new internal
entry ends at a read-only result; there is deliberately no path to an upload.
"""
import argparse
import copy
import json
import uuid
from pathlib import Path

SOURCE_ID = 'qwdTLh2rVmMkwhxb'
HANDOFF_ID = 'LxayneKkUusok0Q8'
PREP = 'SMA – Portaltext bereitstellen'
ENTRY = 'SMA – Gespeicherten Beitrag vorbereiten'
SELECT = 'SMA – Ausgewählten Stand prüfen'
CALL = 'SMA – Gespeicherten Portaltext laden'
END = 'SMA – Freigabestand zurückgeben'

def expression(path):
    return "={{ $('"+PREP+"').first().json.adapter_fields."+path+" }}"

def prepare_copy(source, handoff_core, text_core):
    if source.get('id') != SOURCE_ID or source.get('active') is not False:
        raise ValueError('EXPECTED_INACTIVE_CUSTOMER_WORKFLOW')
    w=copy.deepcopy(source)
    for key in ['id','versionId','activeVersionId','versionMetadata','meta','tags','shared','staticData','triggerCount','createdAt','updatedAt']:
        w.pop(key,None)
    w['name']='SMA – Kunden-Publishing – Portaltext-Anbindung V1'
    w['active']=False
    w['pinData']={}
    w['settings']={'executionOrder':'v1','binaryMode':'separate','timeSavedMode':'fixed',
        'saveDataErrorExecution':'none','saveDataSuccessExecution':'none','saveManualExecutions':False,
        'saveExecutionProgress':False,'executionTimeout':90,'callerPolicy':'workflowsFromSameOwner','availableInMCP':False}
    old_nodes={n['name']:n for n in w['nodes']}
    required=['Kundendaten – Publishing','YouTube – Upload starten','Instagram – Media Container erstellen',
        'Instagram – Bild Container erstellen','Facebook – Bild veröffentlichen','Facebook – Video veröffentlichen','TikTok – Video-Upload initialisieren']
    if any(n not in old_nodes for n in required): raise ValueError('PUBLISHER_NODES_CHANGED')
    removed=[]
    # Triggers are not merely disabled: a disabled trigger can still be used in
    # manual editor runs. Remove old entry points and every edge they owned.
    for n in w['nodes']:
        if n['type'].endswith(('.webhook','.formTrigger','.manualTrigger','.scheduleTrigger','.googleDriveTrigger')):
            removed.append(n['name'])
    w['nodes']=[n for n in w['nodes'] if n['name'] not in removed]
    w['connections']={k:{kind:[[e for e in port if e['node'] not in removed] for port in ports] for kind,ports in edges.items()}
                      for k,edges in w['connections'].items() if k not in removed}
    # Retain the old core for review, but make every legacy node in the copy
    # inactive. Only the new, narrowly scoped preparation path can execute.
    for n in w['nodes']:
        n['disabled']=True
        n.pop('webhookId',None)
    def add_parameter(name,container,field,value):
        p=old_nodes[name]['parameters'].setdefault(container,{}).setdefault('parameters',[])
        if any(x['name']==field for x in p): raise ValueError('TEXT_FIELD_ALREADY_EXISTS: '+name)
        p.append({'name':field,'value':value})
    # Keep provider-specific choices intact in the dormant copy. Text alone is
    # changed; privacy/account/media decisions are not manufactured here.
    yt=old_nodes['YouTube – Upload starten']['parameters']['jsonBody']
    title="$('Kundendaten – Publishing').item.json.title || $('Kundendaten – Publishing').item.json.name || 'SMA Kunden-Video'"
    description="$('Kundendaten – Publishing').item.json.description || ''"
    if yt.count(title)!=1 or yt.count(description)!=1: raise ValueError('YOUTUBE_TEMPLATE_CHANGED')
    old_nodes['YouTube – Upload starten']['parameters']['jsonBody']=yt.replace(title,"$('"+PREP+"').first().json.adapter_fields.snippet.title").replace(description,"$('"+PREP+"').first().json.adapter_fields.snippet.description")
    for name in ['Instagram – Media Container erstellen','Instagram – Bild Container erstellen']:
        add_parameter(name,'queryParameters','caption',expression('caption'))
    add_parameter('Facebook – Bild veröffentlichen','bodyParameters','message',expression('message'))
    add_parameter('Facebook – Video veröffentlichen','bodyParameters','description',expression('description'))
    tt=old_nodes['TikTok – Video-Upload initialisieren']['parameters']['jsonBody']
    if tt.count('post_info: {')!=1: raise ValueError('TIKTOK_TEMPLATE_CHANGED')
    old_nodes['TikTok – Video-Upload initialisieren']['parameters']['jsonBody']=tt.replace('post_info: {',"post_info: {\n    title: $('"+PREP+"').first().json.adapter_fields.post_info.title,")
    assignments=old_nodes['Kundendaten – Publishing']['parameters']['assignments']['assignments']
    for field,path in [('title','title'),('description','caption'),('caption','caption')]:
        if any(a['name']==field for a in assignments): raise ValueError('PUBLISHING_ASSIGNMENT_CHANGED')
        assignments.append({'id':str(uuid.uuid4()),'name':field,'type':'string',
            'value':"={{ $('"+PREP+"').first().json.draft."+path+" }}"})
    # Position preparation above the retained core, separate from its entry paths.
    top=min(n['position'][1] for n in w['nodes'])-700
    def node(name,kind,params,x,version=1,**extra):
        n={'id':str(uuid.uuid4()),'name':name,'type':'n8n-nodes-base.'+kind,
           'typeVersion':version,'parameters':params,'position':[x,top],**extra}
        w['nodes'].append(n)
    node(ENTRY,'executeWorkflowTrigger',{'inputSource':'passthrough'},0,1.1)
    node(SELECT,'code',{'jsCode':handoff_core+"\nif($input.all().length!==1)throw Error('INVALID_HANDOFF_INPUT');return [{json:requireHandoffRequest($input.first().json)}];"},288,2)
    node(CALL,'executeWorkflow',{'source':'database','workflowId':{'__rl':True,'value':HANDOFF_ID,'mode':'id'},
         'mode':'once','options':{'waitForSubWorkflow':True}},576,1.3,onError='continueRegularOutput')
    node(PREP,'code',{'jsCode':text_core+"\nif($input.all().length!==1)throw Error('HANDOFF_UNAVAILABLE');return [{json:publisherText($input.first().json,$('"+SELECT+"').first().json)}];"},864,2)
    node(END,'code',{'jsCode':"const r=$input.first().json;if(r.can_upload!==false||r.can_publish!==false)throw Error('APPROVAL_UNAVAILABLE');return [{json:r}];"},1152,2)
    chain=[ENTRY,SELECT,CALL,PREP,END]
    for a,b in zip(chain,chain[1:]): w['connections'][a]={'main':[[{'node':b,'type':'main','index':0}]]}
    w['connections'].pop(END,None)
    return w,{'source_id':SOURCE_ID,'source_version':source.get('versionId'),'removed_entry_points':removed,
              'patched_nodes':required,'handoff_workflow':HANDOFF_ID,'new_nodes':chain,
              'stage':'publisher_preparation','upload_paths_enabled':False}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[2]
    if args.output.resolve().is_relative_to(root): raise ValueError('PRIVATE_EXPORT_MUST_STAY_OUTSIDE_REPOSITORY')
    source=json.loads(args.source.read_text())
    handoff=(root/'n8n/publishing/publisher-handoff.cjs').read_text().split('module.exports =')[0]
    text=(root/'n8n/publishing/publisher-text.cjs').read_text().split('module.exports=')[0]
    workflow,report=prepare_copy(source,handoff,text)
    args.output.write_text(json.dumps(workflow,ensure_ascii=False,indent=2)+'\n')
    args.output.chmod(0o600)
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__': main()
