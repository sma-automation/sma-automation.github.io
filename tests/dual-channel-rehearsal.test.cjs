'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'sma-dual-'));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const bytes=[Buffer.from('0000ftypAAAAvideo'),Buffer.from('0000ftypBBBBvideo')];
const selections=['youtube','tiktok'].map((platform,i)=>({binding:{platform,customer_id:1,media_kind:'video',drive_file_id:'synthetic_file_'+i,asset_revision:'sha256:'+hash(bytes[i])+':1'},
 size_bytes:bytes[i].length,title_sha256:hash('Title '+i),caption_sha256:hash('Caption '+i),bytes_received:bytes[i].length,checksum_matched:true}));
fs.writeFileSync(path.join(dir,'input.json'),JSON.stringify({context:{customer_id:1},selections}));
execFileSync('python3',[path.join(root,'n8n/publishing/build-dual-channel-rehearsal.py'),'--input',path.join(dir,'input.json'),'--output',path.join(dir,'workflow.json')]);
const wf=JSON.parse(fs.readFileSync(path.join(dir,'workflow.json')));
fs.rmSync(dir,{recursive:true,force:true});
const code=name=>wf.nodes.find(n=>n.name===name).parameters.jsCode;
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const invoke=(name,input,upstream,helpers={})=>new AsyncFunction('require','$input','$','$execution',code(name)).call({helpers},require,{all:()=>input.map(json=>({json}))},()=>({all:()=>upstream.map(json=>({json}))}),{id:'synthetic'});
test('rehearsal exposes only a manual trigger, three batched Drive GETs and the existing read-only text workflow',()=>{
 assert.equal(wf.nodes.length,12);assert.equal(wf.active,false);assert.deepEqual(wf.pinData,{});
 const http=wf.nodes.filter(n=>n.type.endsWith('.httpRequest'));assert.equal(http.length,3);
 for(const n of http){assert.equal(n.parameters.method,'GET');assert.match(n.parameters.url,/googleapis.com\/drive\/v3\/files/);assert.doesNotMatch(n.parameters.url,/\$json\.binding/);assert.deepEqual(n.parameters.options.batching.batch,{batchSize:2,batchInterval:0});}
 const sub=wf.nodes.filter(n=>n.type.endsWith('.executeWorkflow'));assert.equal(sub.length,1);assert.equal(sub[0].parameters.mode,'each');assert.equal(sub[0].parameters.workflowId.value,'JZwPbzCpgIByxk94');
 assert.equal(wf.nodes.filter(n=>n.type.endsWith('.dataTable'))[0].parameters.operation,'get');
 assert.equal(wf.settings.saveManualExecutions,false);assert.equal(wf.settings.saveDataErrorExecution,'none');assert.equal(wf.settings.saveDataSuccessExecution,'none');
 for(const n of wf.nodes.filter(n=>n.type.endsWith('.code')))new AsyncFunction(n.parameters.jsCode);
});
test('two different video downloads must both match their own size and checksum',async()=>{
 const run=b=>invoke('Beide Datei-Prüfsummen bestätigen',[{},{}],selections,{getBinaryDataBuffer:async i=>b[i]});
 const out=await run(bytes);assert.equal(out.length,2);assert.ok(out.every(x=>x.json.checksum_matched&&!x.binary));
 await assert.rejects(run([bytes[1],bytes[0]]),/CHECKSUM_MISMATCH/);
 await assert.rejects(run([Buffer.alloc(1),bytes[1]]),/VIDEO_BYTES_CHANGED/);
});
function results(){return selections.map((s,i)=>({ok:true,stage:'publisher_preparation',binding:s.binding,can_upload:false,can_publish:false,
 blockers:['PUBLICATION_APPROVAL_REQUIRED','PUBLICATION_RESERVATION_REQUIRED','CONTENT_APPROVAL_REQUIRED'],draft:{title:'Title '+i},
 adapter_fields:i===0?{snippet:{title:'Title 0',description:'Caption 0'}}:{post_info:{title:'Caption 1'}},checks:{media:[{code:'CONTENT_REVIEW_PENDING',status:'pending'}]}}));}
test('combined result matches each channel by its binding and retains unresolved gates',async()=>{
 const r=(await invoke('Gemeinsames Testergebnis',results().reverse(),selections))[0].json;
 assert.equal(r.ok,true);assert.equal(r.channels.length,2);assert.equal(r.can_publish,false);assert.equal(r.provider_upload_attempted,false);
 for(const c of r.channels){assert.equal(c.saved_text_matched,true);assert.equal(c.open_media_checks[0].status,'pending');}
});
test('crossed captions, changed bindings, duplicate channels or upload approval cannot produce a passing rehearsal',async()=>{
 const run=r=>invoke('Gemeinsames Testergebnis',r,selections);
 let r=results();r[0].adapter_fields.snippet.description='Caption 1';await assert.rejects(run(r),/TEXT_CHANGED/);
 r=results();r[0].binding={...r[0].binding,drive_file_id:'foreign_file'};await assert.rejects(run(r),/HANDOFF_CHANGED/);
 r=results();await assert.rejects(run([r[0],r[0]]),/HANDOFF_CHANGED/);
 r=results();r[0].can_upload=true;await assert.rejects(run(r),/UNEXPECTED_PERMISSION/);
 r=results();r[0].blockers=[];await assert.rejects(run(r),/UNEXPECTED_PERMISSION/);
});
