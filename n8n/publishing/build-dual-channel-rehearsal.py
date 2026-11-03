"""Build an isolated, manual read-only rehearsal from private selected bindings.

Input and output stay outside the public repository. No approval or provider upload.
"""
import argparse
import copy
import json
from pathlib import Path
import uuid

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--input', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
for filename in (args.input, args.output):
    if Path(filename).resolve().is_relative_to(ROOT.parents[1]):
        raise SystemExit('Private selections and workflow exports must stay outside the repository')
config = json.loads(Path(args.input).read_text())
assert len(config['selections']) == 2
assert sorted(s['binding']['platform'] for s in config['selections']) == ['tiktok', 'youtube']
assert all(s['binding']['customer_id'] == config['context']['customer_id'] for s in config['selections'])
assert all(s['binding']['media_kind'] == 'video' and 0 < s['size_bytes'] <= 24*1024*1024 for s in config['selections'])
catalog = json.loads((ROOT/'file-catalog-workflow.json').read_text())
def core(name):
    return (ROOT/name).read_text().split('module.exports=')[0].split('module.exports =')[0]
nodes = []
def node(name, kind, params, version=2, **extras):
    nodes.append(dict(id=str(uuid.uuid4()), name=name, type='n8n-nodes-base.'+kind,
                      typeVersion=version, position=[len(nodes)*240, 240], parameters=params, **extras))
def code(name, script):
    node(name, 'code', {'jsCode': script})
node('Gemeinsamen Lesetest starten', 'manualTrigger', {}, 1)
code('Ausgewählte Kanalstände', 'return [{json:'+json.dumps(config, ensure_ascii=False)+'}];')
customer = copy.deepcopy(next(n for n in catalog['nodes'] if n['name']=='Kundenordner zuordnen')['parameters'])
customer['filters']['conditions'][0]['keyValue'] = '={{ $json.context.n8n_kunde_id }}'
customer['filters']['conditions'][1]['keyValue'] = '={{ $json.context.kunde_email }}'
node('Kundenbindung lesen', 'dataTable', customer, 1.1)
code('Beide Kanalbindungen prüfen', core('file-catalog.cjs')+'\n'+core('publisher-order.cjs')+'\n'+core('publisher-handoff.cjs')+'''
const cfg=$('Ausgewählte Kanalstände').first().json;
const rows=$input.all().map(x=>x.json);
const folders=verifiedFolders(rows,cfg.context).folders;
return cfg.selections.map(s=>{
 const binding=requireHandoffRequest(s.binding);
 const target=orderTarget(rows,{...cfg.context,binding}).target;
 if(binding.customer_id!==cfg.context.customer_id)throw Error('CUSTOMER_CHANGED');
 return {json:{...s,binding,drive_file_id:binding.drive_file_id,folders,target,started_at:new Date().toISOString()}};
});
''')
creds = next(n for n in catalog['nodes'] if n['name']=='Uploadordner lesen')['credentials']
def drive(name, download=False):
    query=[{'name':'alt','value':'media'}] if download else [{'name':'fields','value':'id,mimeType,parents,trashed,version,size,sha256Checksum,md5Checksum,capabilities(canDownload)'}]
    query.append({'name':'supportsAllDrives','value':'true'})
    options={'redirect':{'redirect':{'followRedirects':False}},'timeout':60000,
             'batching':{'batch':{'batchSize':2,'batchInterval':0}}}
    if download:options['response']={'response':{'responseFormat':'file','outputPropertyName':'data'}}
    node(name,'httpRequest',{'method':'GET','url':"={{ 'https://www.googleapis.com/drive/v3/files/'+$json.drive_file_id }}",
         'authentication':'predefinedCredentialType','nodeCredentialType':'googleDriveOAuth2Api',
         'sendQuery':True,'queryParameters':{'parameters':query},'options':options},4.2,credentials=creds)
drive('Beide Dateistände lesen')
def metadata(name, source, binding_only=False):
    code(name,core('publisher-order.cjs')+f'''
const expected=$('{source}').all();
const actual=$input.all();
if(actual.length!==2||expected.length!==2)throw Error('ITEM_COUNT_CHANGED');
return actual.map((item,i)=>{{
 const s=expected[i].json;
 orderDrive(item.json,{{binding:s.binding}},s.folders);
 if(Number(item.json.size)!==s.size_bytes)throw Error('FILE_SIZE_CHANGED');
 return {{json:{'s.binding' if binding_only else 's'},pairedItem:{{item:i}}}};
}});
''')
metadata('Dateistände bestätigen','Beide Kanalbindungen prüfen')
drive('Beide Videos gemeinsam abrufen',True)
code('Beide Datei-Prüfsummen bestätigen','''
const crypto=require('crypto');
const expected=$('Dateistände bestätigen').all();
if($input.all().length!==2||expected.length!==2)throw Error('ITEM_COUNT_CHANGED');
const out=[];
for(let i=0;i<2;i++){
 const s=expected[i].json;
 const bytes=await this.helpers.getBinaryDataBuffer(i,'data');
 const parts=s.binding.asset_revision.split(':');
 if(!['sha256','md5'].includes(parts[0]))throw Error('CHECKSUM_REQUIRED');
 if(bytes.length!==s.size_bytes||bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp')throw Error('VIDEO_BYTES_CHANGED');
 if(crypto.createHash(parts[0]).update(bytes).digest('hex')!==parts[1])throw Error('CHECKSUM_MISMATCH');
 out.push({json:{...s,bytes_received:bytes.length,checksum_matched:true,download_completed_at:new Date().toISOString()},pairedItem:{item:i}});
}
return out;
''')
drive('Dateistände nach Abruf lesen')
metadata('Unveränderte Auswahl weitergeben','Beide Datei-Prüfsummen bestätigen',True)
node('Gespeicherte Portaltexte vorbereiten','executeWorkflow',{'source':'database','workflowId':{'__rl':True,'value':'JZwPbzCpgIByxk94','mode':'id'},'mode':'each','options':{'waitForSubWorkflow':True}},1.3)
code('Gemeinsames Testergebnis','''
const crypto=require('crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const stable=o=>JSON.stringify(Object.entries(o||{}).sort());
const selected=$('Beide Datei-Prüfsummen bestätigen').all().map(x=>x.json);
const results=$input.all().map(x=>x.json);
if(results.length!==2)throw Error('RESULT_COUNT_CHANGED');
const channels=selected.map(s=>{
 const matches=results.filter(r=>r.binding?.platform===s.binding.platform);
 const r=matches[0];
 if(matches.length!==1||r.ok!==true||r.stage!=='publisher_preparation'||stable(r.binding)!==stable(s.binding))throw Error('HANDOFF_CHANGED');
 if(r.can_upload!==false||r.can_publish!==false||!r.blockers.includes('PUBLICATION_APPROVAL_REQUIRED')||!r.blockers.includes('PUBLICATION_RESERVATION_REQUIRED'))throw Error('UNEXPECTED_PERMISSION');
 const caption=s.binding.platform==='youtube'?r.adapter_fields?.snippet?.description:r.adapter_fields?.post_info?.title;
 if(typeof caption!=='string'||hash(caption)!==s.caption_sha256||hash(r.draft.title)!==s.title_sha256)throw Error('TEXT_CHANGED');
 if(s.binding.platform==='youtube'&&r.adapter_fields.snippet.title!==r.draft.title)throw Error('TITLE_CHANGED');
 return {platform:s.binding.platform,source_account_matched:true,drive_revision_matched:true,bytes_received:s.bytes_received,checksum_matched:s.checksum_matched,
 saved_text_matched:true,started_at:s.started_at,download_completed_at:s.download_completed_at,can_upload:false,can_publish:false,
 open_media_checks:r.checks.media.filter(c=>c.status!=='pass'),blockers:r.blockers};
});
return [{json:{ok:true,stage:'dual_channel_read_rehearsal',execution_id:$execution.id,channels,download_batch_size:2,
 provider_upload_attempted:false,approval_created:false,can_upload:false,can_publish:false}}];
''')
connections={a['name']:{'main':[[{'node':b['name'],'type':'main','index':0}]]} for a,b in zip(nodes,nodes[1:])}
settings={'executionOrder':'v1','saveDataErrorExecution':'none','saveDataSuccessExecution':'none','saveManualExecutions':False,
          'saveExecutionProgress':False,'executionTimeout':150,'callerPolicy':'workflowsFromSameOwner','availableInMCP':False}
workflow={'name':'QA – YouTube und TikTok – Gemeinsamer Dateiabruf','nodes':nodes,'connections':connections,'settings':settings,'active':False,'pinData':{}}
Path(args.output).write_text(json.dumps(workflow,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'nodes':len(nodes),'platforms':['youtube','tiktok'],'download_batch_size':2,'active':False,'writes':False}))
