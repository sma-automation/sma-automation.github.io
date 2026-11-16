'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createProbeRuntime,buildProbe}=require('./file-job-native-probe.cjs');
const {buildParent}=require('./file-job-parent.cjs');
const rt=createProbeRuntime();
const now=1794848400000,executionId='7123',workflowId='synthetic-existing-workflow';
const saved={job_id:rt.jobId,execution_id:executionId,deadline_at:new Date(now+900000).toISOString()};
const request=(action,input={})=>({p_action:action,p_input:{job_id:rt.jobId,execution_id:executionId,...input}});
const run=(value,runIndex=0)=>rt.rpc(value,{node:'synthetic',runIndex,executionId,saved,now});
test('mocked phases require two inline commands then two different signed resume identities',()=>{
 for(let index=0;index<4;index++){
  const phase=index<3?1:2;
  const output=run(request('wait',{phase_seq:phase,resume_url:'https://johnmusic.app.n8n.cloud/webhook-waiting/'+executionId+'/file-command-'+phase+'?signature='+'a'.repeat(64)}),index);
  assert.equal(output.wait,index>=2);
  if(index<2)assert.equal(output.dispatch.command_id,rt.commandId(index+1));
  else assert.equal(output.qa_resume_body.event_id,rt.commandId(index+1));
 }
 assert.throws(()=>run(request('wait',{phase_seq:1,resume_url:'https://evil.invalid'}),2),/SIGNED_WAIT_URL/);
});
test('stale item lookup after the second resume cannot pass the fixture',()=>{
 assert.equal(run(request('context',{command_id:rt.commandId(3)}),0).command_id,rt.commandId(3));
 assert.equal(run(request('context',{command_id:rt.commandId(4)}),1).command_id,rt.commandId(4));
 assert.throws(()=>run(request('context',{command_id:rt.commandId(3)}),1),/CURRENT_RESUME_ITEM_REQUIRED/);
 assert.throws(()=>run(request('accept',{event_id:rt.commandId(3),phase_seq:1,ticket:rt.ticket(3)}),0),/ACKNOWLEDGEMENT_LOST/);
 assert.equal(run(request('accept',{event_id:rt.commandId(4),phase_seq:2,ticket:rt.ticket(4)}),1).ok,true);
});
test('synthetic native child binds only the original four-field ticket payload',()=>{
 const payload={job_id:rt.jobId,command_id:rt.commandId(1),command_ticket:rt.ticket(1),parent_execution_id:executionId};
 assert.equal(rt.child(payload,'child-1',workflowId).operation,'upload_start');
 assert.throws(()=>rt.child(payload,executionId,workflowId),/CHILD_BINDING/);
 assert.throws(()=>rt.child({...payload,operation:'rpc'},'child-1',workflowId),/CHILD_PAYLOAD_KEYS/);
});
test('fixture retains the exact parent Code and Wait nodes but removes every service transport',()=>{
 const parent=buildParent({credentialTemplate:{typeVersion:4.2,parameters:{method:'POST',sendBody:true,specifyBody:'json',options:{}},credentials:{httpHeaderAuth:{id:'synthetic',name:'synthetic'}}}});
 const sourceHash=crypto.createHash('sha256').update(JSON.stringify(parent)).digest('hex');
 const {workflow,metadata}=buildProbe(parent,{sourceHash});
 const originals=parent.nodes.filter(node=>node.type==='n8n-nodes-base.code'||node.type==='n8n-nodes-base.wait');
 for(const node of originals)assert.deepEqual(workflow.nodes.find(value=>value.name===node.name),node);
 assert.equal(workflow.nodes.filter(node=>node.type==='n8n-nodes-base.executeWorkflowTrigger').length,1);
 assert.equal(workflow.nodes.filter(node=>node.type==='n8n-nodes-base.executeWorkflow').length,9);
 assert.equal(workflow.nodes.some(node=>node.credentials||node.type==='n8n-nodes-base.httpRequest'),false);
 assert.equal(Object.hasOwn(workflow.settings,'executionTimeout'),false);
 assert.equal(metadata.expected_wait_resumes,2);
 assert.equal(parent.nodes.some(node=>node.type==='n8n-nodes-base.webhook'),true);
});
