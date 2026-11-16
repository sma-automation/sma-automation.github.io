'use strict';
const crypto=require('node:crypto');
const {createThumbnailBatchRuntime}=require('./build-thumbnail-batch.cjs');

function createNativeProbeRuntime(){
 const probe='sma-thumbnail-batch-native-v1',operation='media.thumbnail.single';
 const fixtureText='SMA synthetic thumbnail batch: no customer data';
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0b8AAAAASUVORK5CYII=';
 const asset=index=>({asset_id:'a0000000-0000-4000-8000-'+String(index).padStart(12,'0'),asset_revision:'synthetic-revision-1'});
 const fail=code=>{throw Error('SYNTHETIC_THUMBNAIL_PROBE_'+code);};
 const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
 const samePayload=(left,right)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
 function initial(executionId,workflowId,dispatcherHash){
  if(!executionId||!workflowId)fail('EXISTING_WORKFLOW_REQUIRED');
  return {
   headers:{authorization:'Bearer synthetic-token-without-permissions'},query:{},params:{},
   body:{assets:Array.from({length:10},(_,i)=>asset(i+1))},
   _probe:{name:probe,synthetic:true,parent_execution_id:String(executionId),workflow_id:String(workflowId),dispatcher_sha256:dispatcherHash},
  };
 }
 function childInput(input,executionId,workflowId,now){
  const binding=input?.body,index=Number(binding?.asset_id?.slice(-12)),saved=input?._probe;
  if(saved?.name!==probe||saved.synthetic!==true||saved.workflow_id!==String(workflowId)||saved.parent_execution_id===String(executionId)||!String(executionId))fail('CHILD_CONTEXT');
  if(!Number.isInteger(index)||index<1||index>10||JSON.stringify(binding)!==JSON.stringify(asset(index))||input._thumbnail_internal!==true)fail('CHILD_BINDING');
  if(input._thumbnail_mode!=='single'||!Number.isFinite(input._thumbnail_deadline)||now>=input._thumbnail_deadline)fail('CHILD_DEADLINE');
  return {index,started_at:now};
 }
 function fakeResult(binding,index){
  return index===5?{ok:false,code:'FILE_UNAVAILABLE',can_publish:false}:
   {ok:true,...binding,media_kind:'video',mime_type:'image/png',image_base64:png,can_publish:false};
 }
 function evidence(items,work,parentExecutionId,workflowId,binaryText){
  if(items.length!==10||work.length!==10||binaryText.length!==10)fail('RESULT_COUNT');
  const traces=items.map(item=>item.json?._probe_trace),ids=new Set();let previousEnd=0;
  for(let i=0;i<10;i++){
   const trace=traces[i],binding=work[i].body;
   if(!trace||trace.probe!==probe||trace.synthetic!==true||trace.workflow_id!==String(workflowId)||trace.parent_execution_id!==String(parentExecutionId)||trace.index!==i+1||trace.input_count!==1)fail('TRACE_BINDING');
   if(trace.execution_id===String(parentExecutionId)||ids.has(trace.execution_id)||typeof trace.execution_id!=='string'||!trace.execution_id)fail('CHILD_EXECUTION_ID');ids.add(trace.execution_id);
   if(!Number.isFinite(trace.started_at)||!Number.isFinite(trace.finished_at)||trace.finished_at-trace.started_at<20||trace.started_at<previousEnd||trace.finished_at>=work[i]._thumbnail_deadline)fail('SEQUENTIAL_WINDOW');previousEnd=trace.finished_at;
   if(trace.binary_text!==fixtureText||binaryText[i]!==fixtureText)fail('BINARY_CHANGED');
   if(trace.inherited_deadline_at!==work[i]._thumbnail_deadline||trace.effective_deadline_at!==trace.inherited_deadline_at)fail('PARENT_DEADLINE_CHANGED');
   if(trace.restored_payload_unchanged!==true)fail('RESTORED_PAYLOAD_CHANGED');
   if(items[i].pairedItem?.item!==i)fail('PARENT_PAIRED_ITEM');
   if(items[i].json.asset_id!==binding.asset_id||items[i].json.asset_revision!==binding.asset_revision||items[i].json.can_publish!==false||items[i].json.ok!==(i!==4))fail('RESULT_BINDING');
  }
  return {
   probe,synthetic:true,parent_execution_id:String(parentExecutionId),workflow_id:String(workflowId),
   dispatcher_sha256:work[0]._probe.dispatcher_sha256,operation,
   native_children:10,child_execution_ids:[...ids],native_sequential:true,mapped_1_to_1:true,
   synthetic_successes:9,partial_denials:1,denied_asset_id:asset(5).asset_id,unchanged_binary:true,restored_payload_unchanged:true,
   parent_paired_items:items.map(item=>item.pairedItem.item),child_effective_paired_items:traces.map(trace=>trace.received_paired_item),inherited_deadline_at:traces[0].inherited_deadline_at,
   child_input_counts:traces.map(trace=>trace.input_count),
   child_windows:traces.map(({index,started_at,finished_at})=>({index,started_at,finished_at})),external_effects:0,
  };
 }
 return {probe,operation,fixtureText,initial,childInput,fakeResult,evidence,samePayload};
}

function buildNativeProbe(dispatcherSource){
 if(typeof dispatcherSource!=='string'||!dispatcherSource.includes('// @exports'))throw Error('DISPATCHER_SOURCE_REQUIRED');
 if(!dispatcherSource.includes('deadlineAt'))throw Error('DEADLINE_CONTEXT_DISPATCHER_REQUIRED');
 const dispatcher=dispatcherSource.split('// @exports')[0],dispatcherHash=crypto.createHash('sha256').update(dispatcher).digest('hex');
 for(const name of ['consolidationWrap','consolidationValidate','consolidationBeginInternal','consolidationRestore'])if(!dispatcher.includes('function '+name+'('))throw Error('DISPATCHER_ADAPTER_MISSING');
 const runtime='const batch=('+createThumbnailBatchRuntime.toString()+')();\n',probe='const probe=('+createNativeProbeRuntime.toString()+')();\n';
 const nodes=[],connections={};
 function add(name,type,typeVersion,parameters,extra={}){
  const i=nodes.length+1,node={id:'a1300000-0000-4000-8000-'+String(i).padStart(12,'0'),name,type:'n8n-nodes-base.'+type,typeVersion,
   position:[(i<=8?i-1:i-9)*250,i<=8?0:400],parameters,...extra};nodes.push(node);return name;
 }
 const connect=(from,to)=>{connections[from]={main:[[{node:to,type:'main',index:0}]]};};
 const manual=add('Probe · Manuell beginnen','manualTrigger',1,{});
 const initialize=add('Probe · Synthetisches Paket','code',2,{jsCode:runtime+probe+
  'const json=batch.normalize(probe.initial($execution.id,$workflow.id,'+JSON.stringify(dispatcherHash)+'),Date.now());\n'+
  "return [{json,binary:{fixture:{data:Buffer.from(probe.fixtureText,'utf8').toString('base64'),mimeType:'text/plain',fileName:'synthetic-thumbnail-batch.txt'}}}];"});
 const prepare=add('Probe · Einzelanfragen vorbereiten','code',2,{jsCode:runtime+'const item=$input.first();return batch.workItems(item.json).map(json=>({json,...(item.binary?{binary:item.binary}:{})}));'});
 const wrap=add('Probe · Tatsächliches Envelope','code',2,{jsCode:dispatcher+'\nreturn consolidationWrap($input.all(), "media.thumbnail.single", $('+JSON.stringify(initialize)+').first().json._thumbnail_deadline);'});
 const execute=add('Probe · Native Selbstaufrufe','executeWorkflow',1.3,{source:'database',workflowId:{__rl:true,value:'={{ $workflow.id }}',mode:'id'},mode:'each',options:{waitForSubWorkflow:true}},
  {onError:'continueRegularOutput',notes:'Reuse this existing inactive QA workflow. Dynamic self-ID; never create another workflow. Ten native synthetic children, no public webhook.'});
 const verify=add('Probe · Native Belege prüfen','code',2,{jsCode:runtime+probe+
  "const items=$input.all(),binaryText=[];for(let i=0;i<items.length;i++)binaryText.push((await this.helpers.getBinaryDataBuffer(i,'fixture')).toString('utf8'));\n"+
  'const receipt=probe.evidence(items,$('+JSON.stringify(prepare)+').all().map(item=>item.json),$execution.id,$workflow.id,binaryText);\n'+
  'return items.map((item,index)=>batch.copyItem(item,index===0?{...item.json,_probe_parent_receipt:receipt}:item.json));'});
 const collect=add('Probe · Tatsächlicher Collector','code',2,{jsCode:runtime+'return [{json:batch.collect($input.all(),$('+JSON.stringify(prepare)+').all().map(item=>item.json))}];'});
 const finish=add('Probe · Prüfergebnis','code',2,{jsCode:
  'const result=$input.first().json,receipt=$('+JSON.stringify(verify)+').first().json._probe_parent_receipt;\n'+
  "if(result.ok!==true||result.can_publish!==false||result.assets.length!==10||result.assets.filter(row=>row.ok).length!==9||result.assets[4].code!=='FILE_UNAVAILABLE')throw Error('SYNTHETIC_THUMBNAIL_PROBE_COLLECTOR');\n"+
  'return [{json:{...receipt,result}}];'});
 for(const [from,to] of [[manual,initialize],[initialize,prepare],[prepare,wrap],[wrap,execute],[execute,verify],[verify,collect],[collect,finish]])connect(from,to);

 const trigger=add('Probe · Einziger interner Trigger','executeWorkflowTrigger',1.1,{inputSource:'passthrough'});
 const validate=add('Probe · Tatsächlicher Validator','code',2,{jsCode:dispatcher+'\nreturn consolidationValidate($input.all(), ["media.thumbnail.single"]);'});
 const marker=add('Probe · Tatsächlicher Fristmarker','code',2,{jsCode:dispatcher+'\nreturn consolidationBeginInternal($input.all(), "media.thumbnail.single", 120);'});
 const unwrap=add('Probe · Tatsächlicher Singleadapter','code',2,{jsCode:dispatcher+'\nreturn consolidationRestore($input.all());'});
 const mark=add('Probe · Interne Anfrage markieren','code',2,{jsCode:runtime+'const item=$input.first();return [batch.copyItem(item,{...item.json,_thumbnail_internal:true})];'});
 const normalize=add('Probe · Tatsächliche Einzelanfrage','code',2,{jsCode:runtime+'const item=$input.first();return [batch.copyItem(item,batch.normalize(item.json,Date.now()))];'});
 const synthetic=add('Probe · Synthetisches Einzelbild','code',2,{jsCode:runtime+probe+
  "const item=$input.first();if($input.all().length!==1)throw Error('SYNTHETIC_THUMBNAIL_PROBE_NOT_SINGLE');\n"+
  "const state=probe.childInput(item.json,$execution.id,$workflow.id,Date.now()),binaryText=(await this.helpers.getBinaryDataBuffer(0,'fixture')).toString('utf8');\n"+
  "if(binaryText!==probe.fixtureText)throw Error('SYNTHETIC_THUMBNAIL_PROBE_BINARY');\n"+
  'const unchanged=probe.samePayload($('+JSON.stringify(unwrap)+').first().json,$('+JSON.stringify(validate)+').first().json.payload);\n'+
  "if(!unchanged)throw Error('SYNTHETIC_THUMBNAIL_PROBE_RESTORED_PAYLOAD');\n"+
  'await new Promise(resolve=>setTimeout(resolve,100));\n'+
  'return [batch.copyItem(item,{...probe.fakeResult(item.json.body,state.index),_probe_trace:{probe:probe.probe,synthetic:true,index:state.index,execution_id:String($execution.id),parent_execution_id:item.json._probe.parent_execution_id,workflow_id:String($workflow.id),input_count:1,received_paired_item:item.pairedItem??null,inherited_deadline_at:$('+JSON.stringify(validate)+').first().json.context.deadlineAt,effective_deadline_at:$('+JSON.stringify(marker)+').first().json.deadlineAt,restored_payload_unchanged:unchanged,binary_text:binaryText,started_at:state.started_at,finished_at:Date.now()}})];'});
 const returned=add('Probe · Tatsächliche Einzelrückgabe','code',2,{jsCode:runtime+
  'const item=$input.first(),json=batch.internalResult(item.json,$('+JSON.stringify(normalize)+').first().json,Date.now());\n'+
  'return [batch.copyItem(item,{...json,_probe_trace:item.json._probe_trace})];'});
 for(const [from,to] of [[trigger,validate],[validate,marker],[marker,unwrap],[unwrap,mark],[mark,normalize],[normalize,synthetic],[synthetic,returned]])connect(from,to);
 const workflow={name:'QA · Native Thumbnailpakete · nur synthetisch',active:false,nodes,connections,
  settings:{executionOrder:'v1',binaryMode:'separate',callerPolicy:'workflowsFromSameOwner',availableInMCP:false,executionTimeout:120,saveManualExecutions:true,saveDataSuccessExecution:'all',saveDataErrorExecution:'all'},pinData:{}};
 return {workflow,provenance:{probe:'sma-thumbnail-batch-native-v1',dispatcherSha256:dispatcherHash,nodes:nodes.length,manualTriggers:1,executeWorkflowTriggers:1,syntheticAssets:10,expectedSuccesses:9,expectedDenials:1,nativeSelfCalls:true,operation:'media.thumbnail.single',externalEffects:0,liveEngineStatus:'not_executed'}};
}
module.exports={createNativeProbeRuntime,buildNativeProbe};

if(require.main===module){
 const fs=require('node:fs'),path=require('node:path'),[runtimeFile,outputFile]=process.argv.slice(2);
 if(!runtimeFile||!outputFile||process.argv.length!==4)throw Error('Usage: node thumbnail-batch-native-probe.cjs DISPATCHER_RUNTIME PRIVATE_WORKFLOW_OUTPUT');
 const {workflow,provenance}=buildNativeProbe(fs.readFileSync(runtimeFile,'utf8'));fs.mkdirSync(path.dirname(outputFile),{recursive:true});
 const json=JSON.stringify(workflow,null,2)+'\n';fs.writeFileSync(outputFile,json,{mode:0o600});
 process.stdout.write(JSON.stringify({...provenance,workflowSha256:crypto.createHash('sha256').update(json).digest('hex'),file:path.resolve(outputFile)},null,2)+'\n');
}
