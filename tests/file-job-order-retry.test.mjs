import test from 'node:test';
import assert from 'node:assert/strict';
import {createFileJobClient} from '../app/assets/file-job-client.mjs';

const id=n=>`af660000-0000-4000-9000-${String(n).padStart(12,'0')}`;
const owner=id(1),jobId=id(2),orderId=id(3);
const anchor={kind:'asset',asset_id:id(4),asset_revision:'revision-1'};
const input={id:orderId,asset_id:anchor.asset_id,asset_revision:anchor.asset_revision,
 platform:'youtube',assignment_revision:1,preview_id:id(5),preview_revision:1,
 choices:{visibility:'private',made_for_kids:false,contains_synthetic_media:false}};
const request={anchor,operation:'order_prepare',input};
const retry={...request,retryAfter:'TARGET_CHECK_UNAVAILABLE'};
const failure={ok:false,code:'TARGET_CHECK_UNAVAILABLE'};
const prepared={ok:true,id:orderId,state:'prepared',can_publish:false,can_upload:false};
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

function fixture({replacement=prepared}={}){
 const calls=[],stored=new Map();let sequence=10,currentOwner=owner,interceptGet=null,interceptSession=null;
 const view={ok:true,job_id:jobId,state:'running',deadline_at:new Date(Date.now()+86400000).toISOString()};
 const client=createFileJobClient({session:async()=>{
  if(interceptSession)await interceptSession();
  return {access_token:'synthetic',user:{id:currentOwner}};
 },
  uuid:()=>id(++sequence),wait:async()=>{throw Error('read-only pending');},
  fetcher:async(url,init)=>{
   const body=JSON.parse(init.body);calls.push({url,body});
   if(body.p_action==='start')return Response.json({...view,commands:[]});
   if(url.endsWith('/functions/v1/sma-file-job')){
    if(!stored.has(body.command_id)){
     const reply=stored.size?replacement:failure;
     stored.set(body.command_id,{command_id:body.command_id,operation:body.operation,
      state:reply.ok?'completed':'failed',response:{status:200,body:reply}});
    }
    return Response.json({ok:true,job_id:jobId,command_id:body.command_id});
   }
   const item=stored.get(body.p_input.command_id);
   const result={...view,commands:item?[structuredClone(item)]:[]};
   if(interceptGet)return interceptGet(result,body);
   return Response.json(result);
  }});
 return {client,calls,stored,view,first:()=>stored.values().next().value,
  edges:()=>calls.filter(c=>c.url.endsWith('/functions/v1/sma-file-job')),
  owner:value=>{currentOwner=value;},onGet:value=>{interceptGet=value;},onSession:value=>{interceptSession=value;}};
}
const result=async(client,options=request)=>(await client.request(options)).json();

test('target failure remains immutable without an explicit continuation hint',async()=>{
 const f=fixture();
 assert.deepEqual(await result(f.client),failure);
 assert.deepEqual(await result(f.client),failure);
 assert.equal(f.edges().length,1);
});

test('explicit target retry uses a fresh failed receipt and keeps the job, order and complete input',async()=>{
 const f=fixture();await result(f.client);
 const original=structuredClone(f.first());
 assert.deepEqual(await result(f.client,retry),prepared);
 const [first,second]=f.edges();
 assert.equal(f.edges().length,2);
 assert.notEqual(first.body.command_id,second.body.command_id);
 assert.deepEqual(first.body.input,second.body.input);
 assert.equal(second.body.input.id,orderId);
 assert.equal(first.body.job_id,second.body.job_id);
 assert.equal(second.body.job_id,jobId);
 assert.equal(second.body.operation,'order_prepare');
 assert.deepEqual(f.stored.get(original.command_id),original);
 assert.equal(f.calls.filter(c=>c.body.p_action==='start').length,1);
 const prior=f.calls[f.calls.indexOf(second)-1].body;
 assert.equal(prior.p_action,'get');
 assert.equal(prior.p_input.command_id,original.command_id);
});

test('a hint on the first attempt cannot retry its own failure',async()=>{
 const f=fixture();assert.deepEqual(await result(f.client,retry),failure);
 assert.equal(f.edges().length,1);
});

test('an early running error can be retried only after a fresh failed receipt',async()=>{
 const f=fixture();
 f.onGet(view=>{view.commands[0].state='running';return Response.json(view);});
 assert.deepEqual(await result(f.client),failure);
 assert.deepEqual(await result(f.client,retry),failure);
 assert.equal(f.edges().length,1);
 f.onGet(null);
 assert.deepEqual(await result(f.client,retry),prepared);
 assert.equal(f.edges().length,2);
});

test('parallel explicit target retries share exactly one replacement command',async()=>{
 const f=fixture();await result(f.client);
 const answers=await Promise.all([result(f.client,retry),result(f.client,retry)]);
 assert.deepEqual(answers,[prepared,prepared]);
 assert.equal(f.edges().length,2);
 assert.equal(f.calls.filter(c=>c.body.p_action==='start').length,1);
});

test('a concurrent retry delayed in its first session read cannot retry the other call\'s failed replacement',async()=>{
 const f=fixture({replacement:failure});await result(f.client);
 const release=deferred();let sessionReads=0;
 f.onSession(()=>++sessionReads===2?release.promise:undefined);
 const first=result(f.client,retry),delayed=result(f.client,retry);
 assert.deepEqual(await first,failure);
 assert.equal(f.edges().length,2);
 release.resolve();assert.deepEqual(await delayed,failure);
 assert.equal(f.edges().length,2);
 f.onSession(null);
 assert.deepEqual(await result(f.client,retry),failure);
 assert.equal(f.edges().length,3);
});

test('a failed replacement stops until another explicit customer action',async()=>{
 const f=fixture({replacement:failure});await result(f.client);
 assert.deepEqual(await result(f.client,retry),failure);
 assert.equal(f.edges().length,2);
 assert.deepEqual(await result(f.client),failure);
 assert.equal(f.edges().length,2);
 assert.deepEqual(await result(f.client,retry),failure);
 assert.equal(f.edges().length,3);
});

for(const state of ['queued','offered','accepted','running','uncertain','completed']){
 test(`target retry cannot replace a ${state} receipt`,async()=>{
  const f=fixture();await result(f.client);f.first().state=state;
  assert.deepEqual(await result(f.client,retry),failure);
  assert.equal(f.edges().length,1);
 });
}

for(const body of [
 {ok:false,code:'TARGET_REFRESH_UNCERTAIN'},
 {ok:false,code:'TARGET_TOKEN_SAVE_FAILED'},
 {ok:false,code:'TARGET_RATE_LIMITED'},
 {ok:false,code:'TARGET_CHECK_RUNNING'},
 {ok:false,code:'FILE_REFRESH_REQUIRED'},
 {ok:true,code:'TARGET_CHECK_UNAVAILABLE'},
 prepared,
]){
 test(`target retry cannot replace a different response: ${body.code||body.state}`,async()=>{
  const f=fixture();await result(f.client);f.first().response.body=body;
  assert.deepEqual(await result(f.client,retry),body);
  assert.equal(f.edges().length,1);
 });
}

test('non-200 error responses never authorize a replacement',async()=>{
 for(const status of [202,400,401,429,500,503]){
  const f=fixture();await result(f.client);f.first().response.status=status;
  assert.equal((await f.client.request(retry)).status,status);
  assert.equal(f.edges().length,1);
 }
});

for(const state of ['uncertain','start_uncertain','failed','finished','expired']){
 test(`target retry cannot enqueue in a ${state} job`,async()=>{
  const f=fixture();await result(f.client);f.view.state=state;
  assert.deepEqual(await result(f.client,retry),failure);
  assert.equal(f.edges().length,1);
 });
}

test('an expired or invalid freshly read deadline never authorizes new work',async()=>{
 for(const deadline of [new Date(0).toISOString(),'invalid',null]){
  const f=fixture();await result(f.client);f.view.deadline_at=deadline;
  assert.deepEqual(await result(f.client,retry),failure);
  assert.equal(f.edges().length,1);
 }
});

test('unknown and unavailable receipts remain read-only',async()=>{
 for(const change of ['read failure','missing','wrong job','wrong operation','pending']){
  const f=fixture();await result(f.client);
  f.onGet(view=>{
   if(change==='read failure')throw Error('authoritative read unavailable');
   if(change==='missing')view.commands=[];
   if(change==='wrong job')view.job_id=id(98);
   if(change==='wrong operation')view.commands[0].operation='order_approve';
   if(change==='pending'){view.commands[0].response=null;view.commands[0].state='running';}
   return Response.json(view);
  });
  await assert.rejects(f.client.request(retry));
  assert.equal(f.edges().length,1,change);
 }
});

for(const change of ['logout','owner change','abort']){
 test(`${change} during a fresh receipt read prevents a late retry`,async()=>{
  const f=fixture();await result(f.client);
  const entered=deferred(),release=deferred(),controller=new AbortController();
  f.onGet(view=>({ok:true,json:async()=>{entered.resolve();await release.promise;return view;}}));
  const pending=f.client.request({...retry,signal:controller.signal});
  const rejected=assert.rejects(pending,error=>change==='owner change'?error.code==='AUTH_REQUIRED':error.name==='AbortError');
  await entered.promise;
  if(change==='logout')f.client.clear();
  if(change==='owner change')f.owner(id(99));
  if(change==='abort')controller.abort(new DOMException('Stopped','AbortError'));
  release.resolve();await rejected;
  assert.equal(f.edges().length,1);
 });
}

test('target retry hint is rejected before authentication for every other operation',async()=>{
 const f=fixture();
 for(const operation of ['upload_start','upload_finish','magic_photo','magic_video','review','preview_prepare','account','order_approve']){
  await assert.rejects(f.client.request({...retry,operation}),error=>error.code==='INVALID_INPUT');
 }
 assert.equal(f.calls.length,0);
});
