import test from 'node:test';
import assert from 'node:assert/strict';
import {createFileJobClient} from '../app/assets/file-job-client.mjs';

const owner='10000000-0000-4000-8000-000000000001';
const job='20000000-0000-4000-8000-000000000001';
const anchor={kind:'asset',asset_id:'30000000-0000-4000-8000-000000000001',asset_revision:'revision-1'};
const input={asset_id:anchor.asset_id,asset_revision:anchor.asset_revision};
const options={anchor,operation:'magic_photo',input};
function setup({reply,edgeNeverArrives=false,loseEdgeReply=false,getFailure=false,hideReceipt=false,pending=false,responseStatus=200,
 wait=()=>new Promise(resolve=>setImmediate(resolve))}={}){
 let seq=0,submissions=0;const calls=[],stored=new Map();
 const view={ok:true,job_id:job,state:'running',deadline_at:new Date(Date.now()+86400000).toISOString()};
 const client=createFileJobClient({session:async()=>({access_token:'synthetic',user:{id:owner}}),
  uuid:()=>`40000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`,wait,
  fetcher:async(url,init)=>{
   const body=JSON.parse(init.body);calls.push({url,body});
   if(body.p_action==='start')return Response.json({...view,commands:[]});
   if(url.endsWith('/functions/v1/sma-file-job')){
    submissions++;
    if(edgeNeverArrives===true||edgeNeverArrives===1&&submissions===1)throw Error('request did not arrive');
    if(!stored.has(body.command_id))stored.set(body.command_id,{command_id:body.command_id,operation:body.operation,state:'completed',
     response:pending?null:{status:responseStatus,body:reply?reply(stored.size+1):{ok:true,can_publish:false}}});
    if(loseEdgeReply)throw Error('reply was lost');
    return Response.json({ok:true,job_id:job,command_id:body.command_id});
   }
   if(getFailure)throw Error('authoritative read unavailable');
   const item=stored.get(body.p_input.command_id);
   return Response.json({...view,commands:item&&!hideReceipt?[item]:[]});
  }});
 return {client,calls,stored,edgeCalls:()=>calls.filter(c=>c.url.endsWith('/functions/v1/sma-file-job'))};
}

test('a confirmed freshness rejection is immutable until an explicit retry uses a new command in the same job',async()=>{
 const f=setup({reply:n=>n===1?{ok:false,code:'FILE_REFRESH_REQUIRED'}:{ok:true,can_publish:false}});
 assert.equal((await (await f.client.request(options)).json()).code,'FILE_REFRESH_REQUIRED');
 assert.equal((await (await f.client.request(options)).json()).code,'FILE_REFRESH_REQUIRED');
 assert.equal(f.edgeCalls().length,1);
 assert.equal((await (await f.client.request({...options,retryAfter:'FILE_REFRESH_REQUIRED'})).json()).ok,true);
 const calls=f.edgeCalls();assert.equal(calls.length,2);assert.notEqual(calls[0].body.command_id,calls[1].body.command_id);
 assert.deepEqual(calls.map(c=>c.body.job_id),[job,job]);
 assert.equal(f.calls.filter(c=>c.body.p_action==='start').length,1);
});

test('parallel explicit retries share one replacement command after the confirmed freshness rejection',async()=>{
 const f=setup({reply:n=>n===1?{ok:false,code:'FILE_REFRESH_REQUIRED'}:{ok:true,can_publish:false}});
 await f.client.request(options);
 const replies=await Promise.all([1,2].map(()=>f.client.request({...options,retryAfter:'FILE_REFRESH_REQUIRED'})));
 assert.deepEqual(await Promise.all(replies.map(r=>r.json())),[{ok:true,can_publish:false},{ok:true,can_publish:false}]);
 assert.equal(f.edgeCalls().length,2);
});

test('a retry hint cannot replay a completed operation or a different confirmed failure',async()=>{
 for(const body of [{ok:true,can_publish:false},{ok:false,code:'PROVIDER_FAILED'},{ok:true,code:'FILE_REFRESH_REQUIRED'}]){
  const f=setup({reply:()=>body});
  await f.client.request(options);await f.client.request({...options,retryAfter:'FILE_REFRESH_REQUIRED'});
  assert.equal(f.edgeCalls().length,1);
 }
});

test('a non-200 stored failure cannot authorize a fresh command',async()=>{
 const f=setup({reply:()=>({ok:false,code:'FILE_REFRESH_REQUIRED'}),responseStatus:500});
 assert.equal((await f.client.request(options)).status,500);
 assert.equal((await f.client.request({...options,retryAfter:'FILE_REFRESH_REQUIRED'})).status,500);
 assert.equal(f.edgeCalls().length,1);
});

test('an Edge request which never arrived is resubmitted only after an authoritative absence and with the same command',async()=>{
 const f=setup({edgeNeverArrives:1});
 assert.equal((await (await f.client.request({...options,timeoutMs:100})).json()).ok,true);
 const calls=f.edgeCalls();assert.equal(calls.length,2);assert.deepEqual(calls[0].body,calls[1].body);
 assert.equal(f.calls.filter(c=>c.body.p_action==='start').length,1);
 assert.equal(f.calls[f.calls.indexOf(calls[1])-1].body.p_action,'get');
});

test('a lost Edge reply with an existing receipt is never resubmitted or given a new command by retry hints',async()=>{
 const f=setup({loseEdgeReply:true});
 await f.client.request(options);await f.client.request({...options,retryAfter:'FILE_REFRESH_REQUIRED'});
 assert.equal(f.edgeCalls().length,1);
});

test('an unavailable authoritative get cannot authorize retransmission',async()=>{
 const f=setup({edgeNeverArrives:true,getFailure:true});
 await assert.rejects(f.client.request(options),/authoritative read unavailable/);
 await assert.rejects(f.client.request({...options,retryAfter:'FILE_REFRESH_REQUIRED'}),/authoritative read unavailable/);
 assert.equal(f.edgeCalls().length,1);
});

test('repeated authoritative absence permits at most one resubmission across later requests',async()=>{
 const f=setup({edgeNeverArrives:true,wait:async()=>{throw Error('stop after absence');}});
 for(let i=0;i<3;i++)await assert.rejects(f.client.request({...options,retryAfter:'FILE_REFRESH_REQUIRED'}),/stop after absence/);
 const calls=f.edgeCalls();assert.equal(calls.length,2);assert.deepEqual(calls[0].body,calls[1].body);
 assert.equal(f.calls.filter(c=>c.body.p_action==='start').length,1);
});

test('an existing pending receipt is never resubmitted even after a lost Edge response and an explicit retry hint',async()=>{
 const f=setup({loseEdgeReply:true,pending:true,wait:async()=>{throw Error('still pending');}});
 for(let i=0;i<2;i++)await assert.rejects(f.client.request({...options,retryAfter:'FILE_REFRESH_REQUIRED'}),/still pending/);
 assert.equal(f.edgeCalls().length,1);
});

test('an acknowledged command with a missing receipt remains read-only',async()=>{
 const f=setup({hideReceipt:true,wait:async()=>{throw Error('receipt unavailable');}});
 await assert.rejects(f.client.request(options),/receipt unavailable/);
 assert.equal(f.edgeCalls().length,1);
});

test('unknown operations fail before any authenticated network call',async()=>{
 const f=setup();
 await assert.rejects(f.client.request({...options,operation:'approve_everything'}),e=>e.code==='INVALID_INPUT');
 assert.equal(f.calls.length,0);
});

test('an aborted explicit selection cannot evict an expired binding after its session read finishes',async()=>{
 let clock=Date.now(),seq=0,pendingSession,releaseSession,blockSession=false;const calls=[];
 const sessionValue={access_token:'synthetic',user:{id:owner}};
 const client=createFileJobClient({now:()=>clock,uuid:()=>`40000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`,
  session:()=>blockSession?new Promise(resolve=>{releaseSession=resolve;pendingSession?.();}):Promise.resolve(sessionValue),
  fetcher:async(url,init)=>{const body=JSON.parse(init.body);calls.push(body);
   if(body.p_action==='start')return Response.json({ok:true,job_id:job,state:'running',deadline_at:new Date(clock+100).toISOString(),commands:[]});
   if(!body.p_action)return Response.json({ok:true,job_id:job,command_id:body.command_id});
   return Response.json({ok:true,job_id:job,state:'running',deadline_at:new Date(clock+100).toISOString(),commands:[{
    command_id:body.p_input.command_id,operation:'magic_photo',state:'completed',response:{status:200,body:{ok:true}}}]});
  }});
 await client.request(options);clock+=101;blockSession=true;
 const ready=new Promise(resolve=>{pendingSession=resolve;}),controller=new AbortController();
 const selected=client.beginNewWork(anchor,{signal:controller.signal});await ready;
 controller.abort();releaseSession(sessionValue);blockSession=false;
 await assert.rejects(selected,e=>e.name==='AbortError');
 await assert.rejects(client.request(options),e=>e.code==='FILE_JOB_EXPIRED');
 assert.equal(calls.filter(c=>c.p_action==='start').length,1);
});
