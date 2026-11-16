'use strict';

// No service calls are made by this builder. The private credential template is
// read only when generating an import in the private staging directory.
const OPERATIONS={upload_start:'lo3Wt6jem0CxCrJF',upload_finish:'lo3Wt6jem0CxCrJF',
 magic_photo:'dheEkIi8KUNqHpmq',magic_video:'a1F5Ps0B3sXMh70S',review:'mWoUMjzxAsfggRHU',
 preview_prepare:'9dNstQ4E2uXpZ18Z',account:'RdtCqCWRi7P4W7B0',order_prepare:'RdtCqCWRi7P4W7B0',order_approve:'RdtCqCWRi7P4W7B0'};

function createParentRuntime(){
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
 const TICKET=/^[a-f0-9]{64}$/;
 const EXEC=/^[A-Za-z0-9_-]{1,80}$/;
 const ops=['upload_start','upload_finish','magic_photo','magic_video','review','preview_prepare','account','order_prepare','order_approve'];
 const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
 const requireValue=v=>{if(!v)throw Error('FILE_JOB_BINDING_REQUIRED');};
 function start(input,executionId){
  const body=input?.body;requireValue(record(body)&&Object.keys(body).sort().join(',')==='job_id,start_ticket'&&UUID.test(body.job_id)&&TICKET.test(body.start_ticket)&&EXEC.test(String(executionId)));
  return {p_action:'bind',p_input:{job_id:body.job_id,start_ticket:body.start_ticket,execution_id:String(executionId)}};
 }
 function bound(result,request,now){
  requireValue(result?.ok===true&&result.job_id===request.job_id&&typeof result.already_bound==='boolean');
  const deadline=Date.parse(result.deadline_at);requireValue(Number.isFinite(deadline)&&deadline>now&&deadline<=now+86400000);
  return {job_id:request.job_id,execution_id:request.execution_id,deadline_at:result.deadline_at};
 }
 function identity(saved,executionId){
  requireValue(UUID.test(saved?.job_id)&&saved.execution_id===String(executionId));
  return {job_id:saved.job_id,execution_id:String(executionId)};
 }
 function context(result,saved,executionId,resumeUrl,now){
  const id=identity(saved,executionId);
  requireValue(result?.ok===true&&result.job_id===id.job_id&&result.execution_id===id.execution_id&&
   Number.isInteger(result.phase_seq)&&result.phase_seq>=0&&result.phase_seq<=64&&
   typeof result.terminal==='boolean'&&typeof result.has_pending==='boolean'&&result.deadline_at===saved.deadline_at);
  if(result.terminal||now>=Date.parse(saved.deadline_at))return {...result,terminal:true,...(now>=Date.parse(saved.deadline_at)?{state:'expired'}:{})};
  const prefix='https://johnmusic.app.n8n.cloud/webhook-waiting/'+id.execution_id;
  requireValue(typeof resumeUrl==='string'&&resumeUrl.startsWith(prefix+'?signature=')&&
   /^[A-Za-z0-9._~=-]{16,1024}$/.test(resumeUrl.slice((prefix+'?signature=').length)));
  const phase=result.phase_seq+1;
  return {...result,terminal:false,rpc:{p_action:'wait',p_input:{...id,phase_seq:phase,
   resume_url:prefix+'/file-command-'+phase+resumeUrl.slice(prefix.length)}}};
 }
 function waitResult(result,saved,executionId){
  identity(saved,executionId);requireValue(result?.ok===true&&typeof result.wait==='boolean'&&result.deadline_at===saved.deadline_at);
  if(result.wait){requireValue(Number.isInteger(result.phase_seq)&&result.phase_seq>=1&&result.phase_seq<=64);return result;}
  return {...result,dispatch:dispatch(result.dispatch,saved,executionId)};
 }
 function resume(input,saved,executionId,now){
  const id=identity(saved,executionId),body=input?.body;
  if(now>=Date.parse(saved.deadline_at))return {expired:true,...id};
  requireValue(record(body)&&Object.keys(body).sort().join(',')==='event_id,job_id,phase_seq,ticket'&&
   body.job_id===id.job_id&&UUID.test(body.event_id)&&TICKET.test(body.ticket)&&Number.isInteger(body.phase_seq)&&body.phase_seq>=1&&body.phase_seq<=64);
  return {expired:false,rpc:{p_action:'accept',p_input:{...body,execution_id:id.execution_id}},
   context:{p_action:'context',p_input:{job_id:id.job_id,command_id:body.event_id,execution_id:id.execution_id}}};
 }
 function dispatch(result,saved,executionId){
  const id=identity(saved,executionId);requireValue(result?.ok===true&&result.job_id===id.job_id&&
   result.parent_execution_id===id.execution_id&&UUID.test(result.command_id)&&TICKET.test(result.command_ticket)&&
   ops.includes(result.operation)&&result.deadline_at===saved.deadline_at);
  return {operation:result.operation,job_id:result.job_id,command_id:result.command_id,
   command_ticket:result.command_ticket,parent_execution_id:id.execution_id};
 }
 function payload(command){
  requireValue(ops.includes(command?.operation)&&UUID.test(command.job_id)&&UUID.test(command.command_id)&&TICKET.test(command.command_ticket)&&EXEC.test(command.parent_execution_id));
  return {job_id:command.job_id,command_id:command.command_id,command_ticket:command.command_ticket,parent_execution_id:command.parent_execution_id};
 }
 return {start,bound,identity,context,waitResult,resume,dispatch,payload};
}

function buildParent({credentialTemplate}){
 if(!credentialTemplate?.credentials?.httpHeaderAuth)throw Error('PRIVATE_CREDENTIAL_TEMPLATE_REQUIRED');
 const nodes=[],connections={},prefix='Datei-Auftrag · ';
 const runtime='const job=('+createParentRuntime.toString()+')();\n';
 const saved="$('"+prefix+"Start gebunden').first().json";
 const add=(label,type,typeVersion,parameters,extra={})=>{
  const i=nodes.length+1,name=prefix+label;
  nodes.push({id:'a1400000-0000-4000-8000-'+String(i).padStart(12,'0'),name,type:'n8n-nodes-base.'+type,typeVersion,
   position:[(i%7)*260,Math.floor(i/7)*210],parameters,...extra});return name;
 };
 const code=(label,body,extra={})=>add(label,'code',2,{jsCode:runtime+body},{onError:'continueErrorOutput',...extra});
 const link=(from,to,index=0)=>{
  const m=(connections[from]??={main:[]}).main;while(m.length<=index)m.push([]);m[index].push({node:to,type:'main',index:0});
 };
 const rpc=(label,expression)=>{
  const template=JSON.parse(JSON.stringify(credentialTemplate));
  return add(label,'httpRequest',template.typeVersion??4.2,{...template.parameters,
   url:'https://bnvnmdxosbnuzedokqgh.supabase.co/rest/v1/rpc/sma_file_job_worker_v1',
   jsonBody:expression,options:{...template.parameters.options,timeout:12000}},
   {credentials:template.credentials,onError:'continueErrorOutput',retryOnFail:false});
 };
 const condition=(label,expression)=>add(label,'if',2.2,{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},
  conditions:[{id:'sma-file-job-condition-'+nodes.length,leftValue:expression,rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}});
 const hook=add('Einmaliger Start','webhook',2.1,{httpMethod:'POST',path:'sma-file-job-start-v1',responseMode:'responseNode',options:{}},
  {webhookId:'a1410000-0000-4000-8000-000000000001'});
 const start=code('Start prüfen','return [{json:job.start($input.first().json,$execution.id)}];');
 const bind=rpc('Start binden','={{ $json }}');
 const bound=code('Start gebunden',"return [{json:job.bound($json,$('"+start+"').first().json.p_input,Date.now())}];");
 const started=add('Start quittieren','respondToWebhook',1.5,{respondWith:'json',responseBody:'={{ JSON.stringify({ok:true,job_id:$json.job_id,accepted:true}) }}',options:{responseCode:202}});
 const parentInput=code('Fortsetzung lesen vorbereiten','return [{json:{p_action:"parent_context",p_input:job.identity('+saved+',$execution.id)}}];');
 const parent=rpc('Fortsetzung lesen','={{ $json }}');
 const prepare=code('Warteschritt vorbereiten','return [{json:job.context($json,'+saved+',$execution.id,$execution.resumeUrl,Date.now())}];');
 const terminal=condition('Auftrag beendet?','={{ $json.terminal }}');
 const terminalWrite=condition('Abschluss festhalten?','={{ $json.state === "running" }}');
 const terminalInput=code('Abschluss vorbereiten','return [{json:{p_action:$json.has_pending?"fail":"finish",p_input:{...job.identity('+saved+',$execution.id),...($json.has_pending?{error_code:"WORKER_FAILED"}:{})}}}];');
 const terminalRpc=rpc('Abschluss festhalten','={{ $json }}');
 const terminalCheck=code('Abschluss prüfen','if($json?.ok!==true)throw Error("FILE_JOB_FINISH_UNAVAILABLE");return [{json:{stopped:true,can_publish:false}}];');
 const done=add('Auftrag beendet','code',2,{jsCode:'return [{json:{stopped:true,can_publish:false}}];'});
 const waitRpc=rpc('Warten oder nächste Aktion','={{ $json.rpc }}');
 const waitChecked=code('Warteschritt prüfen','return [{json:job.waitResult($json,'+saved+',$execution.id)}];');
 const waiting=condition('Auf Aktion warten?','={{ $json.wait }}');
 // n8n 2.47.7 does not resolve data expressions in webhookSuffix when matching
 // waiting callbacks (native probe 7123 returned a matching-path 404). A fixed
 // per-phase suffix also prevents a replay of an earlier signed URL from waking
 // a later phase. All 64 Wait nodes still belong to this one parent execution.
 const phaseRoute=add('Feste Wartephase wählen','switch',3.4,{rules:{values:Array.from({length:64},(_,index)=>({
  conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:3},conditions:[{
   id:'sma-file-job-wait-phase-'+(index+1),leftValue:'={{ $json.phase_seq }}',rightValue:index+1,
   operator:{type:'number',operation:'equals'}}],combinator:'and'},renameOutput:true,outputKey:'phase_'+(index+1)}))},options:{fallbackOutput:'extra'}});
 const nativeWaits=Array.from({length:64},(_,index)=>add('Nächste Dateiaktion · Phase '+(index+1),'wait',1.1,{
  resume:'webhook',incomingAuthentication:'none',httpMethod:'POST',responseMode:'responseNode',
  limitWaitTime:true,limitType:'atSpecifiedTime',maxDateAndTime:'={{ $json.deadline_at }}',options:{webhookSuffix:'file-command-'+(index+1)}},
  {webhookId:'a1410000-0000-4000-8000-'+String(index+2).padStart(12,'0')}));
 const resume=code('Fortsetzung prüfen','return [{json:job.resume($json,'+saved+',$execution.id,Date.now())}];');
 const expired=condition('Wartefrist erreicht?','={{ $json.expired }}');
 const accept=rpc('Aktion annehmen','={{ $json.rpc }}');
 const acceptedContext=rpc('Angenommene Aktion lesen',"={{ $('"+resume+"').item.json.context }}");
 const accepted=code('Aktionsbindung prüfen','return [{json:job.dispatch($json,'+saved+',$execution.id)}];');
 const resumed=add('Fortsetzung quittieren','respondToWebhook',1.5,{respondWith:'json',responseBody:'={{ JSON.stringify({ok:true,accepted:true,job_id:$json.job_id,command_id:$json.command_id}) }}',options:{responseCode:202}});
 const inline=code('Eingereihte Aktion übernehmen','return [{json:$json.dispatch}];');
 const route=add('Feste Aktion wählen','switch',3.4,{rules:{values:Object.keys(OPERATIONS).map((op,i)=>({conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:3},
  conditions:[{id:'sma-file-job-operation-'+i,leftValue:'={{ $json.operation }}',rightValue:op,operator:{type:'string',operation:'equals'}}],combinator:'and'},renameOutput:true,outputKey:op}))},options:{fallbackOutput:'extra'}});
 const failedInput=code('Unklaren Ausgang festhalten','return [{json:{p_action:"fail",p_input:{...job.identity('+saved+',$execution.id),error_code:"WORKER_FAILED"}}}];',{onError:'stopWorkflow'});
 const failed=rpc('Auftrag zur Prüfung anhalten','={{ $json }}');
 const rejected=add('Start abweisen','respondToWebhook',1.5,{respondWith:'json',responseBody:'={{ JSON.stringify({ok:false,code:"FILE_JOB_DENIED"}) }}',options:{responseCode:403}});
 link(hook,start);link(start,bind);link(start,rejected,1);link(bind,bound);link(bind,rejected,1);link(bound,started);link(bound,rejected,1);link(started,parentInput);
 link(parentInput,parent);link(parent,prepare);link(prepare,terminal);link(terminal,terminalWrite,0);link(terminal,waitRpc,1);link(waitRpc,waitChecked);link(waitChecked,waiting);
 link(terminalWrite,terminalInput,0);link(terminalWrite,done,1);link(terminalInput,terminalRpc);link(terminalRpc,terminalCheck);link(terminalCheck,done);
 link(waiting,phaseRoute,0);link(waiting,inline,1);
 nativeWaits.forEach((nativeWait,index)=>{link(phaseRoute,nativeWait,index);link(nativeWait,resume);});
 link(phaseRoute,failedInput,64);link(resume,expired);link(expired,parentInput,0);link(expired,accept,1);
 link(accept,acceptedContext,0);link(accept,acceptedContext,1);link(acceptedContext,accepted);link(accepted,resumed);link(resumed,route);link(inline,route);
 Object.entries(OPERATIONS).forEach(([op,id],i)=>{
  const input=code(op+' binden','return [{json:job.payload($json)}];');
  const child=add(op+' ausführen','executeWorkflow',1.3,{source:'database',workflowId:{__rl:true,value:id,mode:'id'},mode:'once',options:{waitForSubWorkflow:true}},
   {onError:'continueErrorOutput'});
  link(route,input,i);link(input,child);link(input,failedInput,1);link(child,parentInput);link(child,failedInput,1);
 });
 link(route,failedInput,Object.keys(OPERATIONS).length);link(failedInput,failed);link(failed,done,0);link(failed,done,1);
 for(const node of [parentInput,parent,prepare,waitRpc,waitChecked,resume,acceptedContext,accepted,inline,terminalInput,terminalRpc,terminalCheck])link(node,failedInput,1);
 return {name:'SMA – Datei-Auftrag – bestehender Medienworkflow',nodes,connections,settings:{executionOrder:'v1'}};
}

module.exports={OPERATIONS,createParentRuntime,buildParent};
if(require.main===module){
 const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
 const [sourceDir,outputDir]=process.argv.slice(2);if(!sourceDir||!outputDir)throw Error('Usage: node file-job-parent.cjs PRIVATE_BEFORE_DIR PRIVATE_OUTPUT_DIR');
 const source=JSON.parse(fs.readFileSync(path.join(sourceDir,'lo3Wt6jem0CxCrJF.json'),'utf8'));
 const graph=buildParent({credentialTemplate:source.nodes.find(n=>n.name==='Uploadsitzung speichern')});
 fs.mkdirSync(outputDir,{recursive:true});const text=JSON.stringify(graph,null,2)+'\n';fs.writeFileSync(path.join(outputDir,'file-job-parent.json'),text);
 const manifest={version:1,components:[{id:'file-job-parent',target:'aEm2khRhdM6EUdoq',file:'file-job-parent.json',sha256:crypto.createHash('sha256').update(text).digest('hex')}]};
 fs.writeFileSync(path.join(outputDir,'components.manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 process.stdout.write(JSON.stringify({nodes:graph.nodes.length,sha256:manifest.components[0].sha256})+'\n');
}
