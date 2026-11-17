import test from 'node:test';
import assert from 'node:assert/strict';
import {createFileJobClient} from '../app/assets/file-job-client.mjs';

const id=n=>`ac770000-0000-4000-9000-${String(n).padStart(12,'0')}`;
const owner=id(1),jobId=id(2),anchor={kind:'asset',asset_id:id(3),asset_revision:'sha256:'+'a'.repeat(64)+':1'};
const input={asset_id:anchor.asset_id,asset_revision:anchor.asset_revision};
const specs={
 magic_photo:{rpc:'sma_publication_magic_v1',field:'analysis',policy:'magic-photo-2026-11-02.1',empty:'unrecognized',rate:'MAGIC_RATE_LIMITED',running:'MAGIC_RUNNING'},
 magic_video:{rpc:'sma_publication_video_magic_v1',field:'analysis',policy:'magic-video-2026-11-03.1',empty:'unrecognized',rate:'MAGIC_RATE_LIMITED',running:'MAGIC_RUNNING'},
 review:{rpc:'sma_publication_review_v1',field:'review',policy:'visual-2026-11-01.1',empty:'unreviewed',rate:'REVIEW_RATE_LIMITED',running:'REVIEW_RUNNING'},
};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(operation='magic_photo',{firstCode,subsequentCode}={}){
 const spec=specs[operation],calls=[],receipts=new Map();
 let sequence=10,currentOwner=owner,clock=Date.now(),onBusiness=null,onSession=null;
 const summary=status=>({...input,policy_version:spec.policy,can_publish:false,status,result:null});
 const response=status=>({ok:true,[spec.field]:summary(status)});
 const view={ok:true,job_id:jobId,state:'waiting',deadline_at:new Date(clock+86400000).toISOString()};
 const business=response('failed');
 const client=createFileJobClient({now:()=>clock,session:async()=>{
  if(onSession)await onSession();return {access_token:'synthetic-session',user:{id:currentOwner}};
 },uuid:()=>id(++sequence),wait:async()=>{throw Error('read-only pending');},fetcher:async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({url,body});
  if(url.endsWith('/rest/v1/rpc/'+spec.rpc)){
   assert.deepEqual(body,{p_action:'get',p_input:input});
   return onBusiness?onBusiness():Response.json(business);
  }
  if(body.p_action==='start')return Response.json({...view,commands:[]});
  if(body.p_action==='get'){
   const command=receipts.get(body.p_input.command_id);
   return Response.json({...view,commands:command?[command]:[]});
  }
  assert.ok(url.endsWith('/functions/v1/sma-file-job'));
  assert.equal(body.operation,operation);
  if(!receipts.has(body.command_id)){
   const code=receipts.size?subsequentCode:firstCode;
   receipts.set(body.command_id,{command_id:body.command_id,operation,state:'failed',
    response:{status:200,body:code?{ok:false,code}:response('processing')}});
  }
  return Response.json({ok:true,job_id:jobId,command_id:body.command_id});
 }});
 const options={anchor,operation,input};
 return {client,calls,receipts,view,business,summary,response,options,
  read:async(extra={})=>(await client.request({...options,...extra})).json(),
  first:()=>receipts.values().next().value,
  edges:()=>calls.filter(c=>c.url.endsWith('/functions/v1/sma-file-job')),
  businessReads:()=>calls.filter(c=>c.url.endsWith('/rest/v1/rpc/'+spec.rpc)),
  owner:value=>{currentOwner=value;},advance:ms=>{clock+=ms;},
  onBusiness:fn=>{onBusiness=fn;},onSession:fn=>{onSession=fn;}};
}

for(const operation of Object.keys(specs)){
 test(`${operation}: explicit confirmed failure recovery preserves job, input and original receipt`,async()=>{
  const f=fixture(operation);await f.read();const original=structuredClone(f.first());
  await f.read({retryFailed:true});const [first,second]=f.edges();
  assert.equal(f.edges().length,2);
  assert.equal(first.body.job_id,second.body.job_id);
  assert.equal(second.body.job_id,jobId);
  assert.notEqual(first.body.command_id,second.body.command_id);
  assert.deepEqual(first.body.input,second.body.input);
  assert.deepEqual(f.receipts.get(original.command_id),original);
  assert.equal(f.calls.filter(c=>c.body.p_action==='start').length,1);
  assert.equal(f.businessReads().length,1);
  assert.equal(f.calls[f.calls.indexOf(second)-1],f.businessReads()[0]);
 });
 test(`${operation}: automatic and ordinary reads cannot replace failed analysis work`,async()=>{
  const f=fixture(operation);await f.read();await f.read();await f.read({retryFailed:false});
  assert.equal(f.edges().length,1);assert.equal(f.businessReads().length,0);
 });
 test(`${operation}: fresh completed or processing state is returned without restarting`,async()=>{
  for(const status of ['completed','processing']){
   const f=fixture(operation);await f.read();const original=structuredClone(f.first());
   f.business[specs[operation].field]=f.summary(status);
   f.business.unexpected_private_context='must not be returned';
   assert.deepEqual(await f.read({retryFailed:true}),f.response(status));
   assert.equal(f.edges().length,1);assert.deepEqual(f.first(),original);
  }
 });
 test(`${operation}: initial rate/running rejection with no result row can be retried explicitly`,async()=>{
  for(const code of [specs[operation].rate,specs[operation].running]){
   const f=fixture(operation,{firstCode:code});await f.read();
   f.business[specs[operation].field].status=specs[operation].empty;
   await f.read({retryFailed:true});assert.equal(f.edges().length,2);
  }
 });
 test(`${operation}: one replacement cannot automatically retry its own rate rejection`,async()=>{
  const f=fixture(operation,{subsequentCode:specs[operation].rate});await f.read();
  assert.deepEqual(await f.read({retryFailed:true}),{ok:false,code:specs[operation].rate});
  assert.equal(f.edges().length,2);
  await f.read();assert.equal(f.edges().length,2);
  await f.read({retryFailed:true});assert.equal(f.edges().length,3);
 });
 test(`${operation}: every fresh business binding field is required`,async()=>{
  for(const patch of [{asset_id:id(99)},{asset_revision:'changed'},{policy_version:'old-policy'},
   {can_publish:true},{status:'unknown'},{asset_id:null},{asset_revision:null}]){
   const f=fixture(operation);await f.read();Object.assign(f.business[specs[operation].field],patch);
   await assert.rejects(f.read({retryFailed:true}),error=>error.code==='FILE_JOB_UNAVAILABLE');
   assert.equal(f.edges().length,1);
  }
 });
}

test('a retry hint on the first request never creates a second command in that request',async()=>{
 const f=fixture();await f.read({retryFailed:true});assert.equal(f.edges().length,1);assert.equal(f.businessReads().length,0);
});

test('a failed business summary cannot override a nonfailed native receipt',async()=>{
 for(const state of ['queued','offered','accepted','running','uncertain','completed']){
  const f=fixture();await f.read();f.first().state=state;
  await f.read({retryFailed:true});assert.equal(f.edges().length,1,state);assert.equal(f.businessReads().length,0);
 }
});

test('a terminal or expired file job cannot be retried',async()=>{
 for(const state of ['uncertain','start_uncertain','failed','finished','expired']){
  const f=fixture();await f.read();f.view.state=state;
  await f.read({retryFailed:true});assert.equal(f.edges().length,1,state);assert.equal(f.businessReads().length,0);
 }
 const f=fixture();await f.read();f.view.deadline_at=new Date(0).toISOString();
 await f.read({retryFailed:true});assert.equal(f.edges().length,1);assert.equal(f.businessReads().length,0);
});

test('job expiry during the fresh business read prevents the subsequent replacement',async()=>{
 const f=fixture();await f.read();
 f.onBusiness(()=>{f.advance(86400001);return Response.json(f.business);});
 await f.read({retryFailed:true});assert.equal(f.edges().length,1);
});

test('non-200, malformed, successful or unrelated original responses cannot authorize a retry',async()=>{
 const invalid=[{status:503,body:{ok:true,analysis:null}},
  {status:200,body:{ok:false,code:'AUTH_REQUIRED'}},{status:200,body:{ok:false,code:'FILE_CHANGED'}},
  {status:200,body:{ok:false,code:'MAGIC_UNAVAILABLE'}},{status:200,body:{ok:false,code:'FILE_REFRESH_REQUIRED'}},
  {status:200,body:{ok:false,code:'REVIEW_RATE_LIMITED'}},
  {status:200,body:{ok:true,analysis:{...input,status:'processing',policy_version:'other',can_publish:false}}}];
 for(const response of invalid){
  const f=fixture();await f.read();f.first().response=response;
  await f.read({retryFailed:true});assert.equal(f.edges().length,1);assert.equal(f.businessReads().length,0);
 }
 const f=fixture();await f.read();f.first().response.body=f.response('completed');
 await f.read({retryFailed:true});assert.equal(f.edges().length,1);assert.equal(f.businessReads().length,0);
});

test('an empty current summary cannot erase evidence that processing had already started',async()=>{
 const f=fixture();await f.read();f.business.analysis.status='unrecognized';
 await f.read({retryFailed:true});assert.equal(f.edges().length,1);
});

test('unavailable or rejected fresh business reads never submit a replacement',async()=>{
 for(const read of [()=>{throw Error('offline');},()=>Response.json({ok:false,code:'AUTH_REQUIRED'}),
  ()=>Response.json({ok:false,code:'FILE_CHANGED'}),()=>Response.json({ok:true}),
  ()=>new Response('Unavailable',{status:503}),()=>new Response('not json',{status:200})]){
  const f=fixture();await f.read();f.onBusiness(read);
  await assert.rejects(f.read({retryFailed:true}));assert.equal(f.edges().length,1);
 }
});

for(const change of ['logout','owner change','abort'])test(`${change} during the business read prevents a late replacement`,async()=>{
 const f=fixture();await f.read();const entered=deferred(),release=deferred(),controller=new AbortController();
 f.onBusiness(()=>({ok:true,json:async()=>{entered.resolve();await release.promise;return f.business;}}));
 const pending=f.read({retryFailed:true,signal:controller.signal});
 const rejected=assert.rejects(pending,error=>change==='owner change'?error.code==='AUTH_REQUIRED':error.name==='AbortError');
 await entered.promise;
 if(change==='logout')f.client.clear();
 if(change==='owner change')f.owner(id(99));
 if(change==='abort')controller.abort(new DOMException('Stopped','AbortError'));
 release.resolve();await rejected;assert.equal(f.edges().length,1);
});

test('a bounded fresh business read cannot enqueue after its late response',async()=>{
 const f=fixture();await f.read();const release=deferred();
 f.onBusiness(()=>({ok:true,json:()=>release.promise}));
 const keepAlive=setTimeout(()=>{},1000);
 try{
  await assert.rejects(f.read({retryFailed:true,timeoutMs:25}),error=>error.code==='FILE_JOB_PENDING');
  release.resolve(f.business);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.edges().length,1);
 }finally{clearTimeout(keepAlive);}
});

test('parallel explicit retries share one replacement after a fresh failed analysis read',async()=>{
 const f=fixture();await f.read();
 await Promise.all([f.read({retryFailed:true}),f.read({retryFailed:true})]);
 assert.equal(f.edges().length,2);
});

test('a retry delayed before authentication cannot retry another call\'s rate-limited replacement',async()=>{
 const f=fixture('magic_photo',{subsequentCode:'MAGIC_RATE_LIMITED'});await f.read();
 const release=deferred();let count=0;
 f.onSession(()=>++count===2?release.promise:undefined);
 const first=f.read({retryFailed:true}),second=f.read({retryFailed:true});
 await first;assert.equal(f.edges().length,2);release.resolve();await second;
 assert.equal(f.edges().length,2);
});

test('a retry delayed inside its business read adopts a concurrent replacement without replacing it again',async()=>{
 const f=fixture('magic_photo',{subsequentCode:'MAGIC_RATE_LIMITED'});await f.read();
 const entered=deferred(),release=deferred();let count=0;
 f.onBusiness(()=>({ok:true,json:async()=>{
  if(++count===2){entered.resolve();await release.promise;}return f.business;
 }}));
 const first=f.read({retryFailed:true}),second=f.read({retryFailed:true});
 await entered.promise;await first;assert.equal(f.edges().length,2);
 release.resolve();await second;assert.equal(f.edges().length,2);
});

test('failed-analysis retry is rejected before network for unrelated operations and nonbooleans',async()=>{
 const f=fixture();
 for(const operation of ['upload_start','upload_finish','preview_prepare','account','order_prepare','order_approve']){
  await assert.rejects(f.client.request({...f.options,operation,retryFailed:true}),error=>error.code==='INVALID_INPUT');
 }
 for(const retryFailed of [null,1,'true',{}])await assert.rejects(f.read({retryFailed}),error=>error.code==='INVALID_INPUT');
 assert.equal(f.calls.length,0);
});
