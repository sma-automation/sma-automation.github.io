import test from 'node:test';
import assert from 'node:assert/strict';
import {createFileJobHandler,wakeFileJob} from '../supabase/functions/sma-file-job/handler.mjs';
const job='10000000-0000-4000-8000-000000000001',command='20000000-0000-4000-8000-000000000001';
const now=()=>1794848400000,ticket='a'.repeat(64);
const commandInput={job_id:job,command_id:command,operation:'magic_photo',input:{asset_id:job,asset_revision:'sha256:abc'}};
const makeRequest=(body=commandInput,extra={})=>new Request('https://example.supabase.co/functions/v1/sma-file-job',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body),...extra});
const view=body=>({ok:true,job_id:job,commands:[{command_id:body.command_id,operation:body.operation}]});

test('auth and fixed request shape gate all private work',async()=>{
 let privateCalls=0;
 const handle=createFileJobHandler({authorize:async(_a,_b,c)=>view(c),worker:async()=>{privateCalls++;throw Error();}});
 assert.equal((await handle(makeRequest(commandInput,{headers:{'Content-Type':'application/json'}}))).status,401);
 assert.equal((await handle(makeRequest({...commandInput,url:'https://other.invalid'}))).status,400);
 assert.equal((await handle(makeRequest({...commandInput,operation:'arbitrary_rpc'}))).status,400);
 assert.equal(privateCalls,0);
});
test('failed authorization never claims or wakes an execution',async()=>{
 let count=0;const handle=createFileJobHandler({authorize:async()=>({ok:false}),worker:async()=>{count++;}});
 assert.equal((await handle(makeRequest())).status,409);assert.equal(count,0);
});
test('lost start response with a bound receipt causes exactly one POST',async()=>{
 const calls=[],posts=[];
 const worker=async(action)=>{calls.push(action);return action==='claim_start'?{ok:true,start:{job_id:job,start_ticket:ticket,claim_expires_at:new Date(now()+60000).toISOString()}}:
  action==='start_receipt'?{ok:true,job_id:job,bound:true,execution_id:'7112'}:{ok:true,delivery:null};};
 const r=await wakeFileJob({jobId:job,worker,now,fetcher:async(url,options)=>{posts.push([url,JSON.parse(options.body)]);throw Error('lost');}});
 assert.equal(r.ok,true);assert.equal(posts.length,1);assert.equal(posts[0][0],'https://johnmusic.app.n8n.cloud/webhook/sma-file-job-start-v1');
 assert.deepEqual(posts[0][1],{job_id:job,start_ticket:ticket});assert.deepEqual(calls,['claim_start','start_receipt','claim_delivery']);
});
test('unknown start is frozen and neither retried nor reported as bound',async()=>{
 let claims=0,posts=0,delivery=0;
 const worker=async(action)=>{
  if(action==='claim_start')return claims++===0?{ok:true,start:{job_id:job,start_ticket:ticket,claim_expires_at:new Date(now()+60000).toISOString()}}:{ok:true,start:null,bound:false,state:'uncertain'};
  if(action==='start_receipt')return {ok:true,job_id:job,bound:false};
  if(action==='claim_delivery')delivery++;return {ok:true};
 };
 const options={jobId:job,worker,now,fetcher:async()=>{posts++;throw Error('lost');}};
 assert.equal((await wakeFileJob(options)).ok,false);assert.equal((await wakeFileJob(options)).ok,false);
 assert.equal(posts,1);assert.equal(delivery,0);
});
test('a queued command on an already bound busy parent creates no POST',async()=>{
 let posts=0;
 const r=await wakeFileJob({jobId:job,worker:async action=>action==='claim_start'?{ok:true,start:null,bound:true,state:'running'}:{ok:true,delivery:null},fetcher:async()=>{posts++;}});
 assert.equal(r.ok,true);assert.equal(posts,0);
});
test('canonical upload command identity is returned without private data',async()=>{
 const canonical='20000000-0000-4000-8000-000000000002';
 const handle=createFileJobHandler({authorize:async()=>({ok:true,job_id:job,commands:[{command_id:canonical,operation:'upload_start',command_ticket:ticket}]}),
  worker:async action=>action==='claim_start'?{ok:true,start:null,bound:true}:{ok:true,delivery:null}});
 const r=await handle(makeRequest({...commandInput,operation:'upload_start'})),body=await r.json();
 assert.equal(r.status,202);assert.equal(body.command_id,canonical);assert.equal(JSON.stringify(body).includes(ticket),false);
});
test('expired or mismatched private claim never sends a start',async()=>{
 let posts=0;
 await assert.rejects(wakeFileJob({jobId:job,now,worker:async()=>({ok:true,start:{job_id:job,start_ticket:ticket,claim_expires_at:new Date(now()).toISOString()}}),fetcher:async()=>{posts++;}}));
 assert.equal(posts,0);
});
