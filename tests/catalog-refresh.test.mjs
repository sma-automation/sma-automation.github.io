import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshMediaCatalog} from '../app/assets/media-metadata.mjs';
import {createSharedCatalogRefreshClient,clearSharedCatalogRefreshCache,syncSharedCatalogRefreshOwner,
 CATALOG_REFRESH_READ_MS,CATALOG_REFRESH_GATE_MS} from '../app/assets/catalog-refresh.mjs';

// Actual production coordinator and wrapper; all sessions, clocks and transport
// replies below are synthetic. The suite cannot reach any network endpoint.
const owner='cc970000-0000-4000-8000-000000000091',otherOwner='cc970000-0000-4000-8000-000000000092';
const route='https://catalog-refresh-fixture.invalid/catalog',pilotRoute='https://catalog-refresh-fixture.invalid/pilot';
const status=(extra={})=>({ok:true,version:1,can_publish:false,sync_state:'idle',retry_after_ms:0,synced_at:null,...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const observed=promise=>promise.then(value=>({ok:true,value}),error=>({ok:false,error}));
const response=(body={ok:true})=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});

function fixture(options={}){
 let currentOwner=owner,clock=1000,nextTimer=0,currentRoute=route;
 let readSession=options.session||null,readStatus=options.status||(()=>status());
 let reply=options.reply||(()=>response());
 const timers=new Map(),posts=[],statusReads=[],sessionReads=[],events=[],clients=[];
 const host={
  setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,at:clock+ms});return id;},
  clearTimeout(id){timers.delete(id);}
 };
 const session=async()=>{
  sessionReads.push(clock);events.push('session');
  return readSession?readSession(sessionReads.length):currentOwner?{user:{id:currentOwner},access_token:'synthetic-'+currentOwner}:null;
 };
 const preflight=async signal=>{
  assert.ok(signal instanceof AbortSignal);assert.equal(signal.aborted,false);
  statusReads.push({signal,at:clock});events.push('status');return readStatus(signal,statusReads.length);
 };
 const request=async(url,init)=>{
  assert.ok([route,pilotRoute].includes(url));assert.equal(init.method,'POST');
  assert.equal(init.cache,'no-store');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
  assert.match(new Headers(init.headers).get('Authorization'),/^Bearer synthetic-/);
  assert.ok(init.signal instanceof AbortSignal);assert.equal(init.signal.aborted,false);
  posts.push({url,init,at:clock});events.push('post');return reply(posts.length,init);
 };
 return {host,posts,statusReads,sessionReads,events,timers,
  refresh:extra=>refreshMediaCatalog({getSession:session,readStatus:preflight,owner,host,now:()=>clock,
   endpoint:()=>currentRoute,request,...extra}),
  client(extra={}){const client=createSharedCatalogRefreshClient({getSession:session,readStatus:preflight,host,now:()=>clock,
   endpoint:()=>currentRoute,request,...extra});clients.push(client);return client;},
  time:()=>clock,owner:value=>{currentOwner=value;},route:value=>{currentRoute=value;},
  session:value=>{readSession=value;},status:value=>{readStatus=typeof value==='function'?value:()=>value;},reply:value=>{reply=value;},
  async advance(ms){
   const target=clock+ms;
   for(;;){const due=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!due)break;clock=Math.max(clock,due[1].at);timers.delete(due[0]);due[1].fn();await flush();}
   clock=target;await flush();
  },
  close(){for(const client of clients)client.dispose();clearSharedCatalogRefreshCache(host);}
 };
}

test('three concurrent refresh consumers authorize one catalogue POST after read-only status',async()=>{
 const gate=deferred(),f=fixture({reply:()=>gate.promise});
 try{
  const pending=[f.refresh(),f.refresh(),f.refresh()];await flush();
  assert.equal(f.posts.length,1);assert.ok(f.statusReads.length>=1);
  assert.ok(f.events.indexOf('status')<f.events.indexOf('post'));
  gate.resolve(response());await Promise.all(pending);assert.equal(f.posts.length,1);
  assert.equal(f.timers.size,0,'A completed shared refresh leaves no deadline timer');
 }finally{gate.resolve(response());f.close();}
});

for(const [name,body,code] of [
 ['running',status({sync_state:'running',retry_after_ms:120000}),'FILE_SYNC_RUNNING'],
 ['server cooldown',status({sync_state:'complete',retry_after_ms:14999,synced_at:'2026-11-17T12:00:00Z'}),'FILE_SYNC_RATE_LIMITED']
])test('known '+name+' is rejected by Supabase status before any n8n POST',async()=>{
 const f=fixture({status:()=>body});try{
  await assert.rejects(f.refresh(),error=>error.message===code);
  assert.equal(f.statusReads.length,1);assert.equal(f.posts.length,0);assert.equal(f.timers.size,0);
 }finally{f.close();}
});

test('the local 15-second gate also protects an idle server snapshot, then permits a new explicit refresh',async()=>{
 assert.equal(CATALOG_REFRESH_GATE_MS,15000);const f=fixture();try{
  await f.refresh();assert.equal(f.posts.length,1);
  await assert.rejects(f.refresh(),/FILE_SYNC_RATE_LIMITED/);assert.equal(f.posts.length,1);
  await f.advance(14999);await assert.rejects(f.refresh(),/FILE_SYNC_RATE_LIMITED/);assert.equal(f.posts.length,1);
  const before=f.statusReads.length;await f.advance(1);await f.refresh();
  assert.equal(f.posts.length,2);assert.ok(f.statusReads.length>before,'A later explicit start obtains a new status');
 }finally{f.close();}
});

test('cancelling one of three consumers keeps the shared transport and other consumers alive',async()=>{
 const gate=deferred(),f=fixture({reply:()=>gate.promise}),controller=new AbortController();
 try{
  const first=observed(f.refresh({signal:controller.signal})),second=f.refresh(),third=f.refresh();await flush();
  assert.equal(f.posts.length,1);controller.abort();assert.equal((await first).ok,false);
  assert.equal(f.posts[0].init.signal.aborted,false);gate.resolve(response());await Promise.all([second,third]);
  assert.equal(f.posts.length,1);
 }finally{gate.resolve(response());f.close();}
});

test('disposing one factory client cancels only its consumers and permanently closes that client',async()=>{
 const gate=deferred(),f=fixture({reply:()=>gate.promise}),first=f.client(),second=f.client();
 try{
  const old=observed(first.refresh({owner})),live=second.refresh({owner});await flush();first.dispose();
  assert.equal((await old).ok,false);assert.equal(f.posts.length,1);assert.equal(f.posts[0].init.signal.aborted,false);
  await assert.rejects(first.refresh({owner}),/FILE_SYNC_ABORTED/);
  gate.resolve(response());await live;assert.equal(f.posts.length,1);
 }finally{gate.resolve(response());f.close();}
});

test('cancelling the initiator during preflight lets a surviving consumer supply fresh status without a duplicate start',async()=>{
 const gate=deferred(),f=fixture({status:(_signal,n)=>n===1?gate.promise:status()}),controller=new AbortController();
 try{
  const old=observed(f.refresh({signal:controller.signal})),live=f.refresh();await flush();
  assert.equal(f.posts.length,0);controller.abort();assert.equal((await old).ok,false);await live;
  assert.equal(f.posts.length,1);assert.equal(f.statusReads.length,2);gate.resolve(status());await flush();assert.equal(f.posts.length,1);
 }finally{gate.resolve(status());f.close();}
});

test('disposing a queued route prevents it from dispatching after the active route finishes',async()=>{
 const gate=deferred(),f=fixture({reply:()=>gate.promise}),waiting=f.client({endpoint:pilotRoute});
 try{
  const active=f.refresh();await flush();const queued=observed(waiting.refresh({owner}));await flush();assert.equal(f.posts.length,1);
  waiting.dispose();assert.equal((await queued).ok,false);gate.resolve(response());await active;await flush();
  assert.equal(f.posts.length,1);assert.equal(f.posts[0].url,route);
 }finally{gate.resolve(response());f.close();}
});

test('queue time consumes the same deadline and dispatch cannot grant another 90 seconds',async()=>{
 const first=deferred(),body=deferred(),f=fixture({reply:n=>n===1?first.promise:{ok:true,json:()=>body.promise}});
 try{
  const active=f.refresh();await flush();const queued=observed(f.refresh({endpoint:pilotRoute}));await flush();
  await f.advance(89999);first.resolve(response());await flush();await active;assert.equal(f.posts.length,2);
  await f.advance(1);const result=await queued;assert.equal(result.ok,false);assert.match(result.error.message,/FILE_SYNC_TIMEOUT/);
  assert.equal(f.posts[1].init.signal.aborted,true);assert.equal(f.posts.length,2);
 }finally{first.resolve(response());body.resolve({ok:true});f.close();}
});

test('an aborted dispatched attempt keeps its start gate and a retry reconciles running status without another POST',async()=>{
 const gate=deferred(),f=fixture({reply:()=>gate.promise}),controller=new AbortController();
 try{
  const old=observed(f.refresh({signal:controller.signal}));await flush();controller.abort();assert.equal((await old).ok,false);
  assert.equal(f.posts.length,1);assert.equal(f.posts[0].init.signal.aborted,true);
  await assert.rejects(f.refresh(),/FILE_SYNC_RATE_LIMITED/);assert.equal(f.posts.length,1);
  gate.resolve(response());await flush();await f.advance(15000);f.status(status({sync_state:'running',retry_after_ms:100000}));
  const before=f.statusReads.length;await assert.rejects(f.refresh(),/FILE_SYNC_RUNNING/);
  assert.ok(f.statusReads.length>before);assert.equal(f.posts.length,1);
 }finally{gate.resolve(response());f.close();}
});

test('a lost HTTP reply never authorizes an immediate blind restart even while status still reports idle',async()=>{
 const f=fixture({reply:()=>{throw new TypeError('Synthetic lost response');}});try{
  await assert.rejects(f.refresh());assert.equal(f.posts.length,1);
  await assert.rejects(f.refresh(),/FILE_SYNC_RATE_LIMITED/);assert.equal(f.posts.length,1);
  await f.advance(15000);f.status(status({sync_state:'running',retry_after_ms:90000}));
  const before=f.statusReads.length;await assert.rejects(f.refresh(),/FILE_SYNC_RUNNING/);
  assert.ok(f.statusReads.length>before);assert.equal(f.posts.length,1);
 }finally{f.close();}
});

test('failure before dispatch is not recorded as a native start and can be safely retried with fresh status',async()=>{
 const f=fixture({status:()=>{throw Error('Synthetic unavailable status');}});try{
  await assert.rejects(f.refresh());assert.equal(f.posts.length,0);
  f.status(status());await f.refresh();assert.equal(f.posts.length,1);assert.equal(f.statusReads.length,2);
 }finally{f.close();}
});

test('a fresh top-window registry still honors an already-running server sync after reload',async()=>{
 const first=fixture(),reloaded=fixture({status:()=>status({sync_state:'running',retry_after_ms:110000})});
 try{await first.refresh();await assert.rejects(reloaded.refresh(),/FILE_SYNC_RUNNING/);
  assert.equal(first.posts.length,1);assert.equal(reloaded.posts.length,0);assert.equal(reloaded.statusReads.length,1);
 }finally{first.close();reloaded.close();}
});

test('normal and pilot routes keep independent start gates and never borrow each other transport',async()=>{
 const f=fixture();try{
  await f.refresh();f.route(pilotRoute);await f.refresh();assert.deepEqual(f.posts.map(call=>call.url),[route,pilotRoute]);
  f.route(route);await assert.rejects(f.refresh(),/FILE_SYNC_RATE_LIMITED/);assert.equal(f.posts.length,2);
 }finally{f.close();}
});

test('a signed-out or foreign caller is rejected before reading status or starting n8n',async()=>{
 for(const currentOwner of [null,otherOwner]){
  const f=fixture();try{f.owner(currentOwner);await assert.rejects(f.refresh(),/AUTH_REQUIRED/);
   assert.equal(f.statusReads.length,0);assert.equal(f.posts.length,0);
  }finally{f.close();}
 }
});

test('a session change before return prevents a completed transport from succeeding for the previous owner',async()=>{
 const gate=deferred(),f=fixture({reply:()=>gate.promise});try{
  const pending=observed(f.refresh());await flush();const before=f.sessionReads.length;
  f.owner(otherOwner);gate.resolve(response());const result=await pending;
  assert.equal(result.ok,false);assert.match(result.error.message,/AUTH_REQUIRED/);
  assert.ok(f.sessionReads.length>before);assert.equal(f.posts.length,1);
 }finally{gate.resolve(response());f.close();}
});

test('an owner change during preflight cancels the old query and a late old receipt cannot dispatch',async()=>{
 const gate=deferred(),f=fixture({status:()=>gate.promise});try{
  const old=observed(f.refresh());await flush();assert.equal(f.statusReads.length,1);assert.equal(f.posts.length,0);
  f.owner(otherOwner);syncSharedCatalogRefreshOwner(otherOwner,f.host);assert.equal((await old).ok,false);
  assert.equal(f.statusReads[0].signal.aborted,true);f.status(status());await f.refresh({owner:otherOwner});
  gate.resolve(status());await flush();assert.equal(f.posts.length,1);
  assert.equal(new Headers(f.posts[0].init.headers).get('Authorization'),'Bearer synthetic-'+otherOwner);
 }finally{gate.resolve(status());f.close();}
});

test('logout aborts old work; late replies and an old-owner clear cannot cancel a newly signed-in owner',async()=>{
 const gate=deferred(),f=fixture({reply:n=>n===1?gate.promise:response()});try{
  const old=observed(f.refresh());await flush();f.owner(null);syncSharedCatalogRefreshOwner(null,f.host);
  assert.equal((await old).ok,false);assert.equal(f.posts[0].init.signal.aborted,true);
  await assert.rejects(f.refresh(),/AUTH_REQUIRED/);assert.equal(f.posts.length,1);
  f.owner(otherOwner);syncSharedCatalogRefreshOwner(otherOwner,f.host);await f.refresh({owner:otherOwner});
  gate.resolve(response());await flush();clearSharedCatalogRefreshCache(f.host,owner);
  await assert.rejects(f.refresh({owner:otherOwner}),/FILE_SYNC_RATE_LIMITED/);assert.equal(f.posts.length,2);
 }finally{gate.resolve(response());f.close();}
});

test('a stale frame session or INITIAL_SESSION cannot reverse the known owner or abort its current refresh',async()=>{
 const gate=deferred(),f=fixture({reply:()=>gate.promise});try{
  f.owner(otherOwner);syncSharedCatalogRefreshOwner(otherOwner,f.host);const live=f.refresh({owner:otherOwner});await flush();
  for(const stale of [owner,null]){
   syncSharedCatalogRefreshOwner(stale,f.host,{initial:true});
   await assert.rejects(f.refresh({getSession:async()=>stale?{user:{id:stale},access_token:'synthetic-'+stale}:null,owner:stale||otherOwner}),/AUTH_REQUIRED/);
   assert.equal(f.posts.length,1);assert.equal(f.posts[0].init.signal.aborted,false);
  }
  gate.resolve(response());await live;assert.equal(f.posts.length,1);
 }finally{gate.resolve(response());f.close();}
});

test('a cancelled slow initial session cannot start old work or replace a newer owner',async()=>{
 const gate=deferred(),f=fixture({session:()=>gate.promise}),controller=new AbortController();try{
  const old=observed(f.refresh({signal:controller.signal}));await flush();controller.abort();assert.equal((await old).ok,false);
  f.session(null);f.owner(otherOwner);syncSharedCatalogRefreshOwner(otherOwner,f.host);await f.refresh({owner:otherOwner});
  gate.resolve({user:{id:owner},access_token:'synthetic-'+owner});await flush();assert.equal(f.posts.length,1);
  await assert.rejects(f.refresh({owner:otherOwner}),/FILE_SYNC_RATE_LIMITED/);assert.equal(f.posts.length,1);
 }finally{gate.resolve(null);f.close();}
});

for(const [name,invalid] of [
 ['missing receipt',null],['publish permission',status({can_publish:true})],['unknown state',status({sync_state:'unknown'})],
 ['unknown version',status({version:2})],['negative delay',status({retry_after_ms:-1})],
 ['unbounded delay',status({retry_after_ms:120001})],['invalid timestamp',status({synced_at:'not-an-ISO-date'})],
 ['unexpected private field',status({lease_id:'synthetic-internal-lease'})]
])test('malformed preflight '+name+' fails closed before a native start',async()=>{
 const f=fixture({status:()=>invalid});try{
  await assert.rejects(f.refresh(),/FILE_SYNC_UNAVAILABLE/);assert.equal(f.posts.length,0);
 }finally{f.close();}
});

for(const phase of ['initial session','status','HTTP','body','final session'])test('one 90-second allowance bounds stalled '+phase+' and fences its late reply',async()=>{
 assert.equal(CATALOG_REFRESH_READ_MS,90000);const gate=deferred(),f=fixture();let bodySeen=false;
 try{
  if(phase==='initial session')f.session(()=>gate.promise);
  if(phase==='status')f.status(()=>gate.promise);
  if(phase==='HTTP')f.reply(()=>gate.promise);
  if(phase==='body')f.reply(()=>({ok:true,json:()=>gate.promise}));
  if(phase==='final session'){
   f.reply(()=>({ok:true,json:async()=>{bodySeen=true;return {ok:true};}}));
   f.session(()=>bodySeen?gate.promise:{user:{id:owner},access_token:'synthetic-'+owner});
  }
  let finished=false;const pending=observed(f.refresh()).then(result=>{finished=true;return result;});await flush();
  await f.advance(89999);assert.equal(finished,false);
  await f.advance(1);const result=await pending;assert.equal(result.ok,false);assert.match(result.error.message,/FILE_SYNC_TIMEOUT/);
  assert.equal(f.timers.size,0);
  if(['HTTP','body'].includes(phase))for(const post of f.posts)assert.equal(post.init.signal.aborted,true);
  const count=f.posts.length;
  gate.resolve(phase==='HTTP'?response():phase==='status'?status():phase==='body'?{ok:true}:{user:{id:owner},access_token:'synthetic-'+owner});
  await flush();assert.equal(f.posts.length,count);
 }finally{gate.resolve(null);f.close();}
});

test('initial auth, preflight, transport and body share their total deadline instead of resetting it per phase',async()=>{
 const auth=deferred(),preflight=deferred(),body=deferred(),f=fixture({session:n=>n===1?auth.promise:{user:{id:owner},access_token:'synthetic-'+owner},
  status:()=>preflight.promise,reply:()=>({ok:true,json:()=>body.promise})});
 try{
  let finished=false;const pending=observed(f.refresh()).then(result=>{finished=true;return result;});await flush();
  await f.advance(44000);auth.resolve({user:{id:owner},access_token:'synthetic-'+owner});await flush();
  await f.advance(45000);preflight.resolve(status());await flush();assert.equal(f.posts.length,1);
  await f.advance(999);assert.equal(finished,false);await f.advance(1);
  const result=await pending;assert.equal(result.ok,false);assert.match(result.error.message,/FILE_SYNC_TIMEOUT/);
  assert.equal(f.posts[0].init.signal.aborted,true);assert.equal(f.posts.length,1);
 }finally{auth.resolve(null);preflight.resolve(status());body.resolve({ok:true});f.close();}
});
