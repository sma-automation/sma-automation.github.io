'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const {createThumbnailBatchRuntime,transformThumbnailSource}=require('./build-thumbnail-batch.cjs');
const runtime=createThumbnailBatchRuntime();
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)??'undefined').digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0b8AAAAASUVORK5CYII=','base64');
const revision='md5:'+'a'.repeat(32)+':1';
const asset=i=>({asset_id:'a0000000-0000-4000-8000-'+String(i).padStart(12,'0'),asset_revision:revision});
const request=assets=>({headers:{authorization:'Bearer synthetic-token-without-permissions',origin:'https://sma-automation.com'},query:{},params:{},body:assets});
function fixture(){const source=JSON.parse(fs.readFileSync(path.join(__dirname,'../publishing/asset-preview-workflow.json'),'utf8'));source.id='c6ncyk7ZTlQzX7z3';source.versionId='synthetic-version';return source;}
function success(binding,bytes=png){return {ok:true,...binding,media_kind:'video',mime_type:'image/png',image_base64:bytes.toString('base64'),can_publish:false};}

// Deliberately narrow offline interpreter. Only existing Code/IF logic and
// graph edges are evaluated. HTTP/DataTable/native execution are local fakes.
// This does not assert native n8n engine, Cloud timing or billing behaviour.
function engine(workflow,{latency=100,denied=[],missingFolder=false}={}){
 let now=1800000000000,depth=0,childCalls=0,maxDepth=0,executionCount=0;const calls=[],responses=[];
 const prefix=workflow.id==='aEm2khRhdM6EUdoq'?'Vorschaubild · ':'';
 const byName=new Map(workflow.nodes.map(node=>[node.name,node]));
 async function run(input,internal=false,binary=null,pairedItem=null){
  depth++;maxDepth=Math.max(maxDepth,depth);assert.ok(depth<=2,'native single calls may not recurse into another batch');
  const executionId='synthetic-execution-'+(++executionCount),saved=new Map();let data=[{json:clone(input),...(binary?{binary:clone(binary)}:{}),...(pairedItem?{pairedItem:clone(pairedItem)}:{})}],name=internal?workflow.nodes.find(node=>node.type.endsWith('.executeWorkflowTrigger')).name:workflow.nodes.find(node=>node.type.endsWith('.manualTrigger'))?.name||prefix+'Medienvorschau',steps=0;
  const context={helpers:{getBinaryDataBuffer:async(index,key)=>key==='fixture'?Buffer.from(data[index].binary.fixture.data,'base64'):png}};
  const env=()=>({Buffer,helpers:context.helpers,Date:class extends Date{static now(){return now;}},$json:data[0]?.json,$input:{first:()=>data[0],all:()=>data},
   $:nodeName=>({first:()=>saved.get(nodeName)?.[0],all:()=>saved.get(nodeName)||[],isExecuted:saved.has(nodeName)}),$execution:{id:executionId},$workflow:{id:workflow.id||'synthetic-existing-qa'},setTimeout:(callback,delay)=>{now+=delay;queueMicrotask(callback);return 0;},context});
  const expression=value=>typeof value==='string'&&value.startsWith('={{')?vm.runInNewContext(value.slice(3,-2),env(),{timeout:1000}):value;
  try{
   while(name){
    assert.ok(++steps<100,'bounded graph');const node=byName.get(name);assert.ok(node,name);let output=0;
    try{
     if(node.type.endsWith('.code')){
      assert.doesNotMatch(node.parameters.jsCode,/\b(?:fetch|require)\s*\(/,'Code cannot perform an unmocked external call');
      data=await vm.runInNewContext('(async function(){\n'+node.parameters.jsCode+'\n}).call(context)',env(),{timeout:1000});
      // Native Execute Workflow adds metadata.subExecution to its output. A
      // subsequent Code node must not spread that engine-only field back out:
      // n8n 2.47.7 accepts only these five shaped-item keys (result-validation).
      assert.ok(Array.isArray(data),'these Code nodes return shaped n8n items');
      for(const item of data)assert.ok(Object.keys(item).every(key=>['json','binary','pairedItem','error','index'].includes(key)),'Code output contains engine metadata or another invalid item key: '+node.name);
     }else if(node.type.endsWith('.if')){
      const condition=node.parameters.conditions.conditions.every(row=>expression(row.leftValue)===true);output=condition?0:1;
     }else if(node.type.endsWith('.executeWorkflow')){
      assert.equal(node.parameters.mode,'each');assert.equal(node.parameters.options.waitForSubWorkflow,true);
      const results=[];for(let i=0;i<data.length;i++){childCalls++;const rows=await run(data[i].json,true,data[i].binary,{item:0});for(const row of rows)results.push({...row,pairedItem:{item:i},metadata:{subExecution:{executionId:'synthetic-native-child-'+childCalls,workflowId:workflow.id||'synthetic-existing-qa'}}});}data=results;
     }else if(node.type.endsWith('.httpRequest')||node.type.endsWith('.dataTable')){
      const requestData=saved.get(prefix+'Anfrage prüfen')?.[0].json,input=requestData?.input;
      const timeout=node.type.endsWith('.httpRequest')?expression(node.parameters.options.timeout):null;
      calls.push({name:node.name,asset_id:input?.p_asset_id,started:now,timeout});
      if(timeout!==null&&latency>timeout){now+=timeout;throw Error('synthetic timeout');}now+=latency;
      const id=input.p_asset_id;
      const binding={ok:true,asset_id:id,asset_revision:input.p_revision,media_kind:'video',mime_type:'video/mp4',size_bytes:'100',drive_file_id:'drive_'+id.replaceAll('-',''),n8n_kunde_id:'fixture_customer',kunde_email:'fixture@example.invalid'};
      if(node.name.endsWith('Eigene Datei prüfen'))data=[{json:denied.includes(id)?{ok:false,code:'FILE_UNAVAILABLE'}:binding}];
      else if(node.name.endsWith('Kundenordner zuordnen'))data=[{json:missingFolder?{}:{kunde_id:binding.n8n_kunde_id,kunde_email:binding.kunde_email,zugang_aktiv:true,demo_delta_aktiv:true,zahlung_bestaetigt:false,upload_folder_id:'fixture_upload_folder',processing_folder_id:'fixture_processing_folder'}}];
      else if(node.name.endsWith('Dateimetadaten lesen'))data=[{json:{id:binding.drive_file_id,trashed:false,mimeType:binding.mime_type,size:'100',parents:['fixture_upload_folder'],md5Checksum:'a'.repeat(32),thumbnailLink:'https://lh3.googleusercontent.com/syntheticpreview=s220'}}];
      else if(node.name.endsWith('Vorschaubild laden'))data=[{json:{},binary:{data:{id:'synthetic-binary'}}}];
      else assert.fail('Unexpected mocked service node '+node.name);
     }else if(node.type.endsWith('.respondToWebhook')){
      assert.equal(internal,false,'an internal single result must not respond to the batch HTTP request');responses.push(clone(data[0].json));
     }else assert.ok(node.type.endsWith('.webhook')||node.type.endsWith('.executeWorkflowTrigger')||node.type.endsWith('.manualTrigger'),node.type);
    }catch(error){
     if(node.onError!=='continueErrorOutput')throw error;
     data=[{json:{error:'synthetic hidden error'}}];output=1;
    }
    saved.set(name,data);const edges=workflow.connections[name]?.main?.[output]||[];assert.ok(edges.length<=1,'one path per isolated thumbnail operation');name=edges[0]?.node;
   }
   return clone(data);
  }finally{depth--;}
 }
 return {run,calls,responses,get childCalls(){return childCalls;},get maxDepth(){return maxDepth;},get now(){return now;}};
}

test('the transform preserves identity, credentials, public response and all existing business Code bodies',()=>{
 const source=fixture(),before=hash(source),{workflow,metadata}=transformThumbnailSource(source);
 assert.equal(hash(source),before);assert.equal(workflow.id,source.id);assert.equal(workflow.versionId,source.versionId);assert.equal(hash(workflow.settings),hash(source.settings));
 assert.equal(metadata.operation,'media.thumbnail.single');assert.equal(workflow.nodes.filter(node=>node.type.endsWith('.executeWorkflowTrigger')).length,1);
 for(const node of source.nodes){const current=workflow.nodes.find(item=>item.id===node.id);assert.ok(current);assert.equal(hash(current.credentials),hash(node.credentials));
  if(node.type.endsWith('.httpRequest')){const copy=clone(current);copy.parameters.options.timeout=node.parameters.options.timeout;assert.equal(hash(copy),hash(node));}
  else assert.equal(hash(current),hash(node));
 }
 const names=new Set(workflow.nodes.map(node=>node.name));assert.equal(names.size,workflow.nodes.length);
 for(const [name,connection] of Object.entries(workflow.connections)){assert.ok(names.has(name));for(const edges of connection.main||[])for(const edge of edges)assert.ok(names.has(edge.node),edge.node);}
});
test('legacy single success and legacy invalid-body responses are byte-equivalent after the transform',async()=>{
 const source=fixture(),changed=transformThumbnailSource(source).workflow;
 for(const body of [asset(1),{...asset(1),extra:true},{asset_id:'bad'},null]){
  const first=engine(source),second=engine(changed),input=request(body);
  await first.run(input);await second.run(input);assert.equal(hash(second.responses),hash(first.responses));assert.equal(second.childCalls,0);
 }
});
test('ten bound identities take one public response and ten sequential native checks',async()=>{
 const {workflow}=transformThumbnailSource(fixture()),mock=engine(workflow),assets=Array.from({length:10},(_,i)=>asset(i));
 await mock.run(request({assets}));assert.equal(mock.responses.length,1);assert.equal(mock.childCalls,10);assert.equal(mock.maxDepth,2);
 const response=mock.responses[0];assert.equal(response.ok,true);assert.equal(response.can_publish,false);assert.equal(response.assets.length,10);
 assert.deepEqual(response.assets.map(row=>row.asset_id),assets.map(row=>row.asset_id));assert.ok(response.assets.every(row=>row.ok&&row.image_base64===png.toString('base64')));
 assert.equal(mock.calls.filter(call=>call.name.endsWith('Eigene Datei prüfen')).length,10);
});
test('mixed ownership or revision failures cannot bypass the original single-file access path',async()=>{
 const {workflow}=transformThumbnailSource(fixture()),mock=engine(workflow,{denied:[asset(2).asset_id]});
 await mock.run(request({assets:[asset(1),asset(2),asset(3)]}));
 assert.deepEqual(mock.responses[0].assets.map(row=>row.ok),[true,false,true]);assert.equal(mock.responses[0].assets[1].code,'FILE_UNAVAILABLE');
 assert.equal(mock.calls.filter(call=>call.asset_id===asset(2).asset_id).length,1,'a rejected RPC may not reach Drive or the DataTable');
});
test('missing folder mapping stays a per-file error and cannot reach a Drive download',async()=>{
 const {workflow}=transformThumbnailSource(fixture()),mock=engine(workflow,{missingFolder:true});await mock.run(request({assets:[asset(1)]}));
 assert.equal(mock.responses[0].assets[0].ok,false);assert.equal(mock.calls.length,2);assert.equal(mock.responses.length,1);
});
test('batch shape, authentication, duplicate identities and original-video fields fail before native service reads',async()=>{
 const {workflow}=transformThumbnailSource(fixture());
 const cases=[request({assets:[]}),request({assets:Array.from({length:11},(_,i)=>asset(i))}),request({assets:[asset(1),asset(1)]}),request({assets:[{...asset(1),original:true}]}),request({assets:[asset(1)],download_original:true}),{...request({assets:[asset(1)]}),headers:{}}];
 for(const input of cases){const mock=engine(workflow);await mock.run(input);assert.equal(mock.calls.length,0);assert.equal(mock.childCalls,0);assert.equal(mock.responses[0].ok,false);}
});
test('one absolute 35-second budget stops later files and caps every HTTP timeout to the remaining time',async()=>{
 const {workflow}=transformThumbnailSource(fixture()),mock=engine(workflow,{latency:5000}),start=mock.now;
 await mock.run(request({assets:Array.from({length:10},(_,i)=>asset(i))}));
 assert.equal(mock.now,start+35000);assert.ok(mock.calls.every(call=>call.started<start+35000));
 for(const call of mock.calls)if(call.timeout!==null)assert.ok(call.timeout<=Math.min(25000,start+35000-call.started));
 assert.equal(mock.responses[0].assets.length,10);assert.ok(mock.responses[0].assets.slice(1).every(row=>row.ok===false));assert.equal(mock.responses.length,1);
});
test('an internal request can neither renew the inherited deadline nor recurse via assets[]',async()=>{
 const now=1800000000000,input={...request(asset(1)),_thumbnail_internal:true,_thumbnail_deadline:now+35001};
 assert.equal(runtime.allowed(runtime.normalize(input,now),now),false);
 const batchInput={...request({assets:[asset(1)]}),_thumbnail_internal:true,_thumbnail_deadline:now+1000};
 assert.equal(runtime.normalize(batchInput,now)._thumbnail_mode,'single');
 const {workflow}=transformThumbnailSource(fixture()),mock=engine(workflow);await mock.run(batchInput,true);assert.equal(mock.responses.length,0);assert.equal(mock.calls.length,0);assert.equal(mock.childCalls,0);
});
test('full JSON output stays below 8 MiB while remaining identities retain bound errors',()=>{
 const inputs=Array.from({length:10},(_,i)=>request(asset(i))),bytes=Buffer.alloc(2000000,1),items=inputs.map((input,i)=>({json:success(input.body,bytes),pairedItem:{item:i}}));
 const response=runtime.collect(items,inputs);assert.ok(Buffer.byteLength(JSON.stringify(response))<=8*1024*1024);assert.equal(response.assets.length,10);
 assert.ok(response.assets.some(row=>row.ok));assert.ok(response.assets.some(row=>!row.ok));assert.deepEqual(response.assets.map(row=>row.asset_id),inputs.map(input=>input.body.asset_id));
 assert.ok(response.assets.filter(row=>!row.ok).every(row=>!Object.hasOwn(row,'image_base64')));
});
test('collector never exposes a foreign binding, raw child error or credentials',()=>{
 const inputs=[request(asset(1)),request(asset(2))];
 const response=runtime.collect([{json:{...success(asset(999)),auth:'private-token'}},{json:{error:'private upstream credentials'}}],inputs);
 assert.ok(response.assets.every(row=>row.ok===false));assert.doesNotMatch(JSON.stringify(response),/private|999/);
});

const privateDir=process.env.SMA_THUMBNAIL_SOURCE_DIR;
for(const id of ['c6ncyk7ZTlQzX7z3','aEm2khRhdM6EUdoq'])test('fresh private '+id+' overlay preserves public single output and untouched sibling branches',
 {skip:!privateDir?'Optional private exports are kept outside the repository':false},async()=>{
  const parsed=JSON.parse(fs.readFileSync(path.join(privateDir,id+'.json'),'utf8')),source=Array.isArray(parsed)?parsed[0]:parsed,before=hash(source),{workflow}=transformThumbnailSource(source);
  assert.equal(hash(source),before);assert.equal(workflow.id,source.id);assert.equal(workflow.versionId,source.versionId);assert.equal(hash(workflow.settings),hash(source.settings));
  const prefix=id==='aEm2khRhdM6EUdoq'?'Vorschaubild · ':'';
  for(const original of source.nodes){const modified=workflow.nodes.find(node=>node.id===original.id);assert.ok(modified);
   if(original.type.endsWith('.httpRequest')&&original.name.startsWith(prefix)&&['Eigene Datei prüfen','Dateimetadaten lesen','Vorschaubild laden'].some(label=>original.name===prefix+label)){
    const restored=clone(modified);restored.parameters.options.timeout=original.parameters.options.timeout;assert.equal(hash(restored),hash(original),'only remaining-time timeout may change');
   }else assert.equal(hash(modified),hash(original),'existing node unchanged: '+original.name);
  }
  if(prefix)for(const [name,connection] of Object.entries(source.connections))if(!name.startsWith(prefix))assert.equal(hash(workflow.connections[name]),hash(connection),'sibling connection unchanged: '+name);
  const old=engine(source),updated=engine(workflow);await old.run(request(asset(1)));await updated.run(request(asset(1)));assert.equal(hash(updated.responses),hash(old.responses));
  const batch=engine(workflow);await batch.run(request({assets:[asset(1),asset(2),asset(3)]}));assert.equal(batch.responses.length,1);assert.ok(batch.responses[0].assets.every(row=>row.ok));
 });

const dispatcherFile=process.env.SMA_CONSOLIDATION_RUNTIME||path.join(__dirname,'../consolidation/dispatcher-runtime.cjs');
test('the native QA fixture uses the actual adapters and collector, with only synthetic self-calls and an inspectable partial denial',
 {skip:!fs.existsSync(dispatcherFile)?'Consolidation runtime is supplied by the separate builder worktree':false},async()=>{
  const {buildNativeProbe,createNativeProbeRuntime}=require('./thumbnail-batch-native-probe.cjs');
  const source=fs.readFileSync(dispatcherFile,'utf8'),{workflow,provenance}=buildNativeProbe(source),types=workflow.nodes.map(node=>node.type);
  assert.equal(Object.hasOwn(workflow,'id'),false);assert.equal(workflow.active,false);assert.equal(provenance.liveEngineStatus,'not_executed');
  assert.equal(types.filter(type=>type.endsWith('.manualTrigger')).length,1);assert.equal(types.filter(type=>type.endsWith('.executeWorkflowTrigger')).length,1);
  assert.ok(types.every(type=>['manualTrigger','executeWorkflowTrigger','executeWorkflow','code'].some(allowed=>type==='n8n-nodes-base.'+allowed)));
  assert.ok(workflow.nodes.every(node=>!node.credentials&&!node.webhookId));
  const native=workflow.nodes.find(node=>node.type.endsWith('.executeWorkflow'));assert.equal(native.parameters.workflowId.value,'={{ $workflow.id }}');assert.equal(native.parameters.mode,'each');assert.equal(native.parameters.options.waitForSubWorkflow,true);
  for(const label of ['Tatsächliches Envelope','Tatsächlicher Validator','Tatsächlicher Fristmarker','Tatsächlicher Singleadapter'])assert.ok(workflow.nodes.find(node=>node.name==='Probe · '+label).parameters.jsCode.startsWith(source.split('// @exports')[0]));
  const mock=engine(workflow),result=(await mock.run({}))[0].json;
  assert.equal(mock.calls.length,0);assert.equal(mock.responses.length,0);assert.equal(mock.childCalls,10);
  assert.equal(result.native_sequential,true);assert.equal(result.unchanged_binary,true);assert.equal(result.synthetic_successes,9);assert.equal(result.partial_denials,1);assert.equal(result.external_effects,0);
  assert.deepEqual(result.parent_paired_items,[0,1,2,3,4,5,6,7,8,9]);assert.equal(new Set(result.child_execution_ids).size,10);assert.ok(result.child_execution_ids.every(id=>id!==result.parent_execution_id));
  assert.throws(()=>createNativeProbeRuntime().childInput({},'child','synthetic-existing-qa',Date.now()),/SYNTHETIC_THUMBNAIL_PROBE_CHILD_CONTEXT/);
 });
