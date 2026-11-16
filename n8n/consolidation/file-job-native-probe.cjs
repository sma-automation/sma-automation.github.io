'use strict';

// This fixture keeps the pinned parent control graph and all business validators.
// It replaces only service transport and the initial manual-run response. No
// credentials, customer files, provider calls, or database writes are included.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const PREFIX='Datei-Auftrag · ';
const PROBE_PREFIX='Probe · Datei-Auftrag · ';
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');

function createProbeRuntime(){
 const jobId='b1400000-0000-4000-8000-000000000001';
 const commandId=index=>'b1410000-0000-4000-8000-'+String(index).padStart(12,'0');
 const ticket=index=>String(index).repeat(64);
 const operations=['upload_start','magic_photo','magic_video','preview_prepare'];
 const fail=code=>{throw Error('SYNTHETIC_FILE_JOB_PROBE_'+code);};
 const ensure=(value,code)=>{if(!value)fail(code);};
 const keys=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).sort().join(','):'';
 function initial(executionId,workflowId){
  ensure(String(executionId)&&String(workflowId),'EXISTING_NATIVE_CONTEXT');
  return {body:{job_id:jobId,start_ticket:'a'.repeat(64)}};
 }
 function dispatch(index,saved,executionId){
  return {ok:true,job_id:jobId,parent_execution_id:String(executionId),command_id:commandId(index),
   operation:operations[index-1],command_ticket:ticket(index),deadline_at:saved.deadline_at};
 }
 function rpc(request,{node,runIndex,executionId,saved,now}){
  ensure(keys(request)==='p_action,p_input','RPC_ENVELOPE');
  const input=request.p_input;
  ensure(input?.job_id===jobId&&input.execution_id===String(executionId),'RPC_PARENT_BINDING');
  let result;
  if(request.p_action==='bind'){
   ensure(runIndex===0&&input.start_ticket==='a'.repeat(64),'BIND_ONCE');
   result={ok:true,job_id:jobId,already_bound:false,deadline_at:new Date(now+15*60*1000).toISOString()};
  }else{
   ensure(saved?.job_id===jobId&&saved.execution_id===String(executionId)&&Date.parse(saved.deadline_at)>now,'SAVED_BINDING');
   if(request.p_action==='parent_context'){
    ensure(runIndex>=0&&runIndex<=4,'PARENT_CONTEXT_COUNT');
    // The last mocked database state exercises the real phase-limit finish
    // branch. The fixture runs only four commands, then seeds phase 64.
    result={ok:true,job_id:jobId,execution_id:String(executionId),state:'running',
     phase_seq:runIndex<3?0:runIndex===3?1:64,deadline_at:saved.deadline_at,
     terminal:runIndex===4,has_pending:runIndex<2};
   }else if(request.p_action==='wait'){
    ensure(runIndex>=0&&runIndex<=3,'WAIT_RPC_COUNT');
    const phase=runIndex<3?1:2;
    ensure(input.phase_seq===phase&&typeof input.resume_url==='string'&&
     input.resume_url.startsWith('https://johnmusic.app.n8n.cloud/webhook-waiting/'+executionId+'/file-command-'+phase+'?signature='),'SIGNED_WAIT_URL');
    result=runIndex<2?{ok:true,wait:false,phase_seq:0,deadline_at:saved.deadline_at,
     dispatch:dispatch(runIndex+1,saved,executionId)}:
     {ok:true,wait:true,phase_seq:phase,deadline_at:saved.deadline_at,
      qa_resume_url:input.resume_url,qa_resume_body:{job_id:jobId,event_id:commandId(phase+2),phase_seq:phase,ticket:ticket(phase+2)}};
   }else if(request.p_action==='accept'){
    ensure(keys(input)==='event_id,execution_id,job_id,phase_seq,ticket'&&
     input.phase_seq===runIndex+1&&input.event_id===commandId(runIndex+3)&&input.ticket===ticket(runIndex+3),'RESUME_TICKET');
    // Both authoritative-context edges are exercised: the first accept has a
    // synthetic lost acknowledgement; the second returns normally.
    if(runIndex===0)throw Error('SYNTHETIC_COMMITTED_ACCEPT_ACKNOWLEDGEMENT_LOST');
    ensure(runIndex===1,'ACCEPT_COUNT');result={ok:true};
   }else if(request.p_action==='context'){
    ensure(keys(input)==='command_id,execution_id,job_id'&&runIndex>=0&&runIndex<=1&&
     input.command_id===commandId(runIndex+3),'CURRENT_RESUME_ITEM_REQUIRED');
    result=dispatch(runIndex+3,saved,executionId);
   }else if(request.p_action==='finish'){
    ensure(runIndex===0&&keys(input)==='execution_id,job_id','FINISH_ONCE');result={ok:true};
   }else if(request.p_action==='fail')fail('UNEXPECTED_PARENT_FAILURE');
   else fail('UNEXPECTED_RPC_ACTION');
  }
  return {...result,_qa_rpc:{action:request.p_action,node,run_index:runIndex,
   execution_id:String(executionId),request:input}};
 }
 function child(payload,executionId,workflowId){
  ensure(keys(payload)==='command_id,command_ticket,job_id,parent_execution_id','CHILD_PAYLOAD_KEYS');
  const index=Number(payload.command_id?.slice(-12));
  ensure(index>=1&&index<=4&&payload.job_id===jobId&&payload.command_id===commandId(index)&&
   payload.command_ticket===ticket(index)&&String(executionId)!==payload.parent_execution_id,'CHILD_BINDING');
  return {ok:true,synthetic:true,can_publish:false,operation:operations[index-1],
   job_id:jobId,command_id:payload.command_id,parent_execution_id:payload.parent_execution_id,
   child_execution_id:String(executionId),workflow_id:String(workflowId),payload_keys:Object.keys(payload).sort()};
 }
 return {initial,rpc,child,operations,jobId,commandId,ticket};
}

function buildProbe(parent,{sourceHash}){
 if(!/^[a-f0-9]{64}$/.test(sourceHash||''))throw Error('PINNED_PARENT_HASH_REQUIRED');
 const graph=JSON.parse(JSON.stringify(parent));
 const originalCode=Object.fromEntries(parent.nodes.filter(n=>n.type==='n8n-nodes-base.code').map(n=>[n.name,sha(n.parameters.jsCode)]));
 const runtime='const probe=('+createProbeRuntime.toString()+')();\n';
 const added=[];
 const add=(label,type,parameters,typeVersion=2)=>{
  const name=PROBE_PREFIX+label;
  const node={id:'b1420000-0000-4000-8000-'+String(added.length+1).padStart(12,'0'),name,type:'n8n-nodes-base.'+type,
   typeVersion,parameters,position:[-500,added.length*220]};added.push(node);return name;
 };
 const link=(from,to)=>{graph.connections[from]={main:[[{node:to,type:'main',index:0}]]};};
 const hooks=graph.nodes.filter(n=>n.type==='n8n-nodes-base.webhook');
 const waits=graph.nodes.filter(n=>n.type==='n8n-nodes-base.wait');
 const calls=graph.nodes.filter(n=>n.type==='n8n-nodes-base.executeWorkflow');
 if(hooks.length!==1||hooks[0].parameters.path!=='sma-file-job-start-v1'||waits.length!==64||calls.length!==9)throw Error('UNEXPECTED_PARENT_GRAPH');
 if(waits.some((node,index)=>node.parameters.options.webhookSuffix!=='file-command-'+(index+1))||new Set(waits.map(node=>node.webhookId)).size!==64)throw Error('FIXED_PHASE_WAIT_PATHS_REQUIRED');
 const manual=hooks[0];manual.type='n8n-nodes-base.manualTrigger';manual.typeVersion=1;manual.parameters={};delete manual.webhookId;
 const initial=add('Synthetischer Start','code',{jsCode:runtime+'return [{json:probe.initial($execution.id,$workflow.id)}];'});
 const previous=graph.connections[manual.name];link(manual.name,initial);graph.connections[initial]=previous;
 for(const node of graph.nodes){
  delete node.credentials;
  if(node.type==='n8n-nodes-base.httpRequest'){
   if(!node.parameters.url.endsWith('/rpc/sma_file_job_worker_v1'))throw Error('UNEXPECTED_PARENT_SERVICE');
   const expression=node.parameters.jsonBody;
   if(typeof expression!=='string'||!expression.startsWith('={{')||!expression.endsWith('}}'))throw Error('RPC_EXPRESSION_REQUIRED');
   const request=expression.slice(3,-2).trim();
   node.type='n8n-nodes-base.code';node.typeVersion=2;
   node.parameters={jsCode:runtime+'const request=('+request+');\n'+
    'const saved=request.p_action==="bind"?null:$('+JSON.stringify(PREFIX+'Start gebunden')+').first(0,0).json;\n'+
    'return [{json:probe.rpc(request,{node:'+JSON.stringify(node.name)+',runIndex:$runIndex,executionId:$execution.id,saved,now:Date.now()}),pairedItem:{item:0}}];'};
   delete node.retryOnFail;
  }else if(node.type==='n8n-nodes-base.executeWorkflow'){
   node.parameters.workflowId={__rl:true,value:'={{ $workflow.id }}',mode:'id'};
  }else if(node.type==='n8n-nodes-base.respondToWebhook'&&node.name!==PREFIX+'Fortsetzung quittieren'){
   node.type='n8n-nodes-base.code';node.typeVersion=2;
   node.parameters={jsCode:node.name===PREFIX+'Start quittieren'?
    'return $input.all().map((item,index)=>({json:item.json,pairedItem:{item:index}}));':
    'throw Error("SYNTHETIC_FILE_JOB_PROBE_START_REJECTED");'};
  }
 }
 const native=add('Einziger interner Trigger','executeWorkflowTrigger',{inputSource:'passthrough'},1.1);
 const child=add('Synthetischer Fachschritt','code',{jsCode:runtime+'return [{json:probe.child($input.first().json,$execution.id,$workflow.id),pairedItem:{item:0}}];'});
 link(native,child);
 const receipt=add('Native Belege prüfen','code',{jsCode:runtime+
  'const fail=code=>{throw Error("SYNTHETIC_FILE_JOB_PROBE_RECEIPT_"+code);};\n'+
  'const check=(value,code)=>{if(!value)fail(code);};\n'+
  'const node=label=>$('+JSON.stringify(PREFIX)+'+label);\n'+
  'const read=(label,run=0,output=0)=>node(label).all(output,run).map(item=>item.json);\n'+
  'const saved=read("Start gebunden")[0],parentId=String($execution.id),workflowId=String($workflow.id);\n'+
  'check(saved.execution_id===parentId&&$json.stopped===true&&$json.can_publish===false,"FINAL_PARENT_BINDING");\n'+
  'check(!node("Unklaren Ausgang festhalten").isExecuted,"FAILURE_PATH");\n'+
  'const contexts=Array.from({length:5},(_,index)=>read("Fortsetzung lesen",index)[0]);\n'+
  'check(contexts.every((value,index)=>value._qa_rpc.run_index===index&&value.execution_id===parentId),"CONTEXT_LOOPS");\n'+
  'check(contexts[4].phase_seq===64&&contexts[4].terminal===true,"TERMINAL_LIMIT");\n'+
  'const waits=Array.from({length:4},(_,index)=>read("Warten oder nächste Aktion",index)[0]);\n'+
  'check(waits[0].wait===false&&waits[1].wait===false&&waits[2].wait===true&&waits[3].wait===true,"INLINE_THEN_WAIT");\n'+
  'check(waits[2].phase_seq===1&&waits[3].phase_seq===2,"WAIT_PHASES");\n'+
  'check(node("Nächste Dateiaktion · Phase 1").isExecuted&&node("Nächste Dateiaktion · Phase 2").isExecuted&&!node("Nächste Dateiaktion · Phase 3").isExecuted,"FIXED_PHASE_WAIT_NODES");\n'+
  'const resumes=[0,1].map(index=>read("Fortsetzung prüfen",index)[0]);\n'+
  'check(resumes.every((value,index)=>value.expired===false&&value.context.p_input.command_id===probe.commandId(index+3)&&value.context.p_input.execution_id===parentId),"CURRENT_RESUME_BINDING");\n'+
  'const accepted=[0,1].map(index=>read("Angenommene Aktion lesen",index)[0]);\n'+
  'check(accepted.every((value,index)=>value._qa_rpc.request.command_id===probe.commandId(index+3)),"CURRENT_PAIRED_ITEM");\n'+
  'check(read("Aktion annehmen",0,1).length===1&&read("Aktion annehmen",1,0).length===1,"ACK_RECOVERY_BRANCHES");\n'+
  'const children=probe.operations.map(operation=>read(operation+" ausführen")[0]);\n'+
  'check(new Set(children.map(value=>value.child_execution_id)).size===4&&children.every((value,index)=>value.synthetic===true&&value.parent_execution_id===parentId&&value.workflow_id===workflowId&&value.child_execution_id!==parentId&&value.command_id===probe.commandId(index+1)),"NATIVE_CHILDREN");\n'+
  'check(read("Abschluss festhalten")[0]._qa_rpc.action==="finish"&&read("Abschluss prüfen")[0].stopped===true,"FINISH_ONCE");\n'+
  'return [{json:{probe:"sma-file-job-native-v1",synthetic:true,parent_source_sha256:'+JSON.stringify(sourceHash)+',parent_execution_id:parentId,workflow_id:workflowId,'+
  'inline_commands:2,signed_resumes:2,phase_specific_wait_nodes:true,wait_nodes:'+JSON.stringify(waits.slice(0,2).map(node=>node.name))+','+
  'phase_specific_wait_urls:waits.slice(2).map(value=>value.qa_resume_url.split("?")[0]),child_execution_ids:children.map(value=>value.child_execution_id),'+
  'native_children:4,same_parent_across_phases:true,current_resume_item_verified:true,accept_error_and_success_verified:true,phase_limit_finish_verified:true,external_service_calls:0,can_publish:false}}];'});
 link(PREFIX+'Auftrag beendet',receipt);
 graph.nodes.push(...added);
 graph.name='QA · Datei-Auftrag · native Fortsetzungen · nur synthetisch';graph.active=false;
 graph.settings={executionOrder:'v1',binaryMode:'separate',saveManualExecutions:true,
  saveDataErrorExecution:'all',saveDataSuccessExecution:'all',saveExecutionProgress:false,
  callerPolicy:'workflowsFromSameOwner',availableInMCP:false};
 graph.pinData={};
 for(const node of graph.nodes){
  if(node.credentials||node.type==='n8n-nodes-base.httpRequest')throw Error('QA_EXTERNAL_SERVICE_FORBIDDEN');
  if(node.type==='n8n-nodes-base.code')new Function(node.parameters.jsCode);
 }
 for(const [name,hash] of Object.entries(originalCode)){
  if(sha(graph.nodes.find(node=>node.name===name).parameters.jsCode)!==hash)throw Error('PARENT_VALIDATOR_CHANGED');
 }
 return {workflow:graph,metadata:{parent_sha256:sourceHash,parent_nodes:parent.nodes.length,
  probe_nodes:graph.nodes.length,unchanged_parent_code_nodes:Object.keys(originalCode).length,
  unchanged_wait_nodes:waits.map(node=>node.name),expected_native_children:4,expected_wait_resumes:2,
  mocks:['service RPCs','initial manual response','four synthetic native child results','final database phase limit'],
  not_proven:['real database transitions','real provider or file operations','production consolidated child adapters']}};
}

module.exports={createProbeRuntime,buildProbe};
if(require.main===module){
 const [manifestPath,outputDirectory]=process.argv.slice(2);
 if(!manifestPath||!outputDirectory)throw Error('Usage: node file-job-native-probe.cjs PRIVATE_COMPONENT_MANIFEST PRIVATE_QA_DIRECTORY');
 const output=path.resolve(outputDirectory),allowed='/workspace/shared/sma-five-workflows-20261116/qa';
 if(output!==allowed&&!output.startsWith(allowed+'/'))throw Error('PRIVATE_QA_OUTPUT_REQUIRED');
 const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 const component=manifest.components?.find(entry=>entry.id==='file-job-parent');
 if(manifest.version!==1||component?.file!=='file-job-parent.json')throw Error('PARENT_COMPONENT_MANIFEST_REQUIRED');
 const bytes=fs.readFileSync(path.join(path.dirname(manifestPath),component.file));
 if(sha(bytes)!==component.sha256)throw Error('PARENT_SNAPSHOT_CHANGED');
 const result=buildProbe(JSON.parse(bytes),{sourceHash:component.sha256});
 fs.mkdirSync(output,{recursive:true,mode:0o700});
 const text=JSON.stringify(result.workflow,null,2)+'\n';
 fs.writeFileSync(path.join(output,'file-job-native-probe.workflow.json'),text,{mode:0o600});
 fs.writeFileSync(path.join(output,'file-job-native-probe.metadata.json'),JSON.stringify({...result.metadata,sha256:sha(text)},null,2)+'\n',{mode:0o600});
 process.stdout.write(JSON.stringify({...result.metadata,sha256:sha(text)})+'\n');
}
