'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createParentRuntime,buildParent,OPERATIONS}=require('./file-job-parent.cjs');
const rt=createParentRuntime(),job='10000000-0000-4000-8000-000000000001',command='20000000-0000-4000-8000-000000000001';
const now=1794848400000,deadline=new Date(now+86400000).toISOString(),ticket='a'.repeat(64),execution='7112';
const saved={job_id:job,execution_id:execution,deadline_at:deadline};
const dispatch={ok:true,job_id:job,command_id:command,operation:'magic_photo',command_ticket:ticket,parent_execution_id:execution,deadline_at:deadline};
test('start accepts only a bound private ticket and actual native execution',()=>{
 assert.equal(rt.start({body:{job_id:job,start_ticket:ticket}},execution).p_input.execution_id,execution);
 assert.throws(()=>rt.start({body:{job_id:job,start_ticket:ticket,approved:true}},execution));
 assert.throws(()=>rt.start({body:{job_id:job,start_ticket:'bad'}},execution));
});
test('server phase and native signed URL determine the next wait',()=>{
 const r=rt.context({ok:true,...saved,phase_seq:2,terminal:false,has_pending:false},saved,execution,'https://johnmusic.app.n8n.cloud/webhook-waiting/7112?signature='+ticket,now);
 assert.equal(r.rpc.p_input.phase_seq,3);assert.equal(r.rpc.p_input.resume_url,'https://johnmusic.app.n8n.cloud/webhook-waiting/7112/file-command-3?signature='+ticket);
 assert.throws(()=>rt.context({...saved,ok:true,phase_seq:2,terminal:false,has_pending:false},saved,execution,'https://evil.invalid/?signature='+ticket,now));
});
test('inline queued command retains the same parent and never needs a webhook',()=>{
 const r=rt.waitResult({ok:true,wait:false,phase_seq:0,deadline_at:deadline,dispatch},saved,execution);
 assert.equal(r.dispatch.parent_execution_id,execution);assert.deepEqual(Object.keys(rt.payload(r.dispatch)).sort(),['command_id','command_ticket','job_id','parent_execution_id']);
});
test('foreign command, changed deadline and changed native ID are rejected',()=>{
 for(const replacement of [{job_id:command},{parent_execution_id:'7113'},{operation:'rpc'},{deadline_at:new Date(now+1000).toISOString()}])assert.throws(()=>rt.dispatch({...dispatch,...replacement},saved,execution));
});
test('expired timer resume never accepts an incoming approval or dispatches',()=>{
 assert.equal(rt.resume({},saved,execution,now+86400001).expired,true);
 assert.throws(()=>rt.resume({body:{job_id:job,event_id:command,phase_seq:1,ticket,approved:true}},saved,execution,now));
});
test('native graph preserves fixed child targets and has no overall wait timeout',()=>{
 const graph=buildParent({credentialTemplate:{typeVersion:4.2,parameters:{method:'POST',authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',options:{}},credentials:{httpHeaderAuth:{id:'synthetic',name:'synthetic'}}}});
 assert.equal(Object.hasOwn(graph.settings,'executionTimeout'),false);
 const waits=graph.nodes.filter(n=>n.type.endsWith('.wait'));
 assert.equal(waits.length,64);assert.equal(new Set(waits.map(node=>node.webhookId)).size,64);
 assert.deepEqual(waits.map(node=>node.parameters.options.webhookSuffix),Array.from({length:64},(_,index)=>'file-command-'+(index+1)));
 const phaseRoute=graph.nodes.find(node=>node.name==='Datei-Auftrag · Feste Wartephase wählen');
 assert.deepEqual(phaseRoute.parameters.rules.values.map(rule=>rule.conditions.conditions[0].rightValue),Array.from({length:64},(_,index)=>index+1));
 waits.forEach((node,index)=>{
  assert.equal(graph.connections[phaseRoute.name].main[index][0].node,node.name);
  assert.equal(graph.connections[node.name].main[0][0].node,'Datei-Auftrag · Fortsetzung prüfen');
 });
 assert.deepEqual(graph.nodes.filter(n=>n.type.endsWith('.executeWorkflow')).map(n=>n.parameters.workflowId.value),Object.values(OPERATIONS));
 assert.equal(graph.nodes.filter(n=>n.type.endsWith('.webhook'))[0].parameters.path,'sma-file-job-start-v1');
 for(const node of graph.nodes.filter(n=>n.type.endsWith('.code')))assert.doesNotThrow(()=>new Function(node.parameters.jsCode));
 assert.equal(graph.nodes.filter(n=>n.type.endsWith('.executeWorkflow')).every(n=>n.parameters.options.waitForSubWorkflow===true),true);
});
