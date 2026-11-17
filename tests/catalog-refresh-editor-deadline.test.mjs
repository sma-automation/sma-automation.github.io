import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {refreshMediaCatalog} from '../app/assets/media-metadata.mjs';
import {clearSharedCatalogRefreshCache} from '../app/assets/catalog-refresh.mjs';

// Execute the actual adapter, session and RPC functions without importing the
// remote auth SDK. The coordinator is the real production module. All auth,
// HTTP bodies, files and clock values are synthetic; no network call is made.
const source=await readFile(new URL('../app/assets/media-editor-api.mjs',import.meta.url),'utf8');
const line=prefix=>{
 const value=source.split('\n').find(row=>row.startsWith(prefix));
 assert.ok(value,'Production function not found: '+prefix);return value.replace(/^export /,'');
};
const scopeStart=source.indexOf('function editorRefreshScope('),scopeEnd=source.indexOf('export async function editorThumbnail(');
assert.ok(scopeStart>=0&&scopeEnd>scopeStart);
const adapterSource=[line('async function session(owner)'),line('async function rpc(name,body,owner,signal)'),
 line('export const editorFiles='),source.slice(scopeStart,scopeEnd).replace(/^export /gm,'')].join('\n');
const owner='cc990000-0000-4000-8000-000000000091',otherOwner='cc990000-0000-4000-8000-000000000092';
const knownFile={id:'known-synthetic-file',revision:'same-revision',name:'Known file.mp4'};
const newFile={id:'new-synthetic-file',revision:'new-revision',name:'Refreshed file.mp4'};
const list=()=>({ok:true,files:[knownFile,newFile]});
const status=()=>({ok:true,version:1,can_publish:false,sync_state:'idle',retry_after_ms:0,synced_at:null});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const observed=promise=>promise.then(value=>({ok:true,value}),error=>({ok:false,error}));

function fixture({hold=null}={}){
 let clock=1000,next=0,currentOwner=owner,afterRefresh=false,listBodyRead=false,holdUsed=false,settledRefreshes=0,gate=deferred();
 const timers=new Map(),authReads=[],rpcCalls=[],nativePosts=[];
 const sessionReply=()=>({data:{session:currentOwner?{user:{id:currentOwner},access_token:'synthetic-'+currentOwner}:null},error:null});
 const held=(phase,fallback)=>{
  if(hold===phase&&!holdUsed){holdUsed=true;return gate.promise;}
  return fallback();
 };
 class Clock extends Date {static now(){return clock;}}
 const host={
  setTimeout(fn,ms){const id=++next;timers.set(id,{fn,at:clock+ms});return id;},
  clearTimeout(id){timers.delete(id);}
 };
 const rpcResponse=action=>({ok:true,json:()=>{
  if(action==='list')listBodyRead=true;
  return held(action==='list'?'list-body':'status-body',()=>Promise.resolve(action==='list'?list():status()));
 }});
 const nativeResponse=()=>({ok:true,json:()=>held('native-body',()=>Promise.resolve({ok:true}))});
 const request=async(url,init)=>{
  assert.equal(url,'https://synthetic-catalog.invalid/start');assert.equal(init.method,'POST');assert.equal(init.signal.aborted,false);
  nativePosts.push({url,init});return held('native-http',()=>nativeResponse());
 };
 const env={AbortController,AbortSignal,Date:Clock,setTimeout:host.setTimeout,clearTimeout:host.clearTimeout,
  origin:'https://synthetic-supabase.invalid',key:'synthetic-publishable-key',
  refreshMediaCatalog:async options=>{
   const result=await refreshMediaCatalog({...options,host,now:()=>clock,endpoint:'https://synthetic-catalog.invalid/start',request});
   afterRefresh=true;settledRefreshes++;return result;
  },
  auth:async()=>({auth:{getSession:()=>{
   const phase=afterRefresh?(listBodyRead?'final-auth':'list-auth'):authReads.length===0?'initial-auth':'refresh-auth';
   authReads.push(phase);return held(phase,()=>Promise.resolve(sessionReply()));
  }}}),
  fetch:async(url,init)=>{
   assert.equal(url,'https://synthetic-supabase.invalid/rest/v1/rpc/sma_publication_files_v1');
   assert.equal(init.method,'POST');assert.equal(init.signal.aborted,false);
   const body=JSON.parse(init.body);assert.ok(['sync_status','list'].includes(body.p_action));
   assert.deepEqual(body.p_input,body.p_action==='list'?{dashboard_labels:true}:{});
   assert.equal(new Headers(init.headers).get('Authorization'),'Bearer synthetic-'+owner);
   rpcCalls.push({action:body.p_action,init});
   return held(body.p_action==='list'?'list-http':'status-http',()=>rpcResponse(body.p_action));
  }
 };
 const refresh=vm.runInNewContext(adapterSource+'\neditorRefreshFiles',env);
 function lateValue(){
  if(hold?.endsWith('auth'))return sessionReply();
  if(hold==='native-http')return {ok:true,json:async()=>({ok:true})};
  if(hold==='status-http')return {ok:true,json:async()=>status()};
  if(hold==='list-http')return {ok:true,json:async()=>list()};
  return hold==='status-body'?status():hold==='list-body'?list():{ok:true};
 }
 return {host,timers,authReads,rpcCalls,nativePosts,get gate(){return gate;},
  refresh:signal=>refresh(owner,signal),get held(){return holdUsed;},get completedCoordinators(){return settledRefreshes;},
  owner:value=>{currentOwner=value;},release:()=>gate.resolve(lateValue()),jump:ms=>{clock+=ms;},
  holdPhase(phase){hold=phase;holdUsed=false;gate=deferred();},
  async advance(ms){
   const target=clock+ms;
   for(;;){const due=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!due)break;clock=Math.max(clock,due[1].at);timers.delete(due[0]);due[1].fn();await flush();}
   clock=target;await flush();
  },
  close(){gate.resolve(lateValue());clearSharedCatalogRefreshCache(host);}
 };
}

test('actual editor adapter completes one scan, then reads and returns its verified saved list under the same allowance',async()=>{
 const f=fixture();try{
  const result=await f.refresh();assert.deepEqual(result,list());
  assert.equal(f.nativePosts.length,1);assert.deepEqual(f.rpcCalls.map(call=>call.action),['sync_status','list']);
  assert.equal(f.authReads.at(-1),'final-auth');assert.equal(f.timers.size,0);
 }finally{f.close();}
});

for(const phase of ['initial-auth','status-body','native-http','native-body','list-auth','list-http','list-body','final-auth'])
 test('the actual editor refresh releases stalled '+phase+' at its original 90-second deadline',async()=>{
  const f=fixture({hold:phase});let settled=false;
  try{
   const pending=observed(f.refresh()).then(result=>{settled=true;return result;});await flush();assert.equal(f.held,true);
   if(phase.startsWith('list-')||phase==='final-auth')assert.equal(f.completedCoordinators,1,'The scan already succeeded before this stalled follow-up');
   await f.advance(89999);assert.equal(settled,false);await f.advance(1);
   const result=await pending;assert.equal(result.ok,false);assert.match(result.error.message,/FILE_SYNC_TIMEOUT/);
   assert.equal(f.timers.size,0);const posts=f.nativePosts.length,calls=f.rpcCalls.length;
   f.release();await flush();assert.equal(f.nativePosts.length,posts);assert.equal(f.rpcCalls.length,calls,'A late auth result cannot initiate another RPC');
  }finally{f.close();}
 });

test('an abort while authenticating the post-scan list releases the caller and prevents a late list fetch',async()=>{
 const f=fixture({hold:'list-auth'}),controller=new AbortController();
 try{
  const pending=observed(f.refresh(controller.signal));await flush();assert.equal(f.held,true);assert.equal(f.completedCoordinators,1);
  assert.deepEqual(f.rpcCalls.map(call=>call.action),['sync_status']);controller.abort();assert.equal((await pending).ok,false);
  f.release();await flush();assert.deepEqual(f.rpcCalls.map(call=>call.action),['sync_status']);
  assert.equal(f.nativePosts.length,1);assert.equal(f.timers.size,0);
 }finally{f.close();}
});

test('time spent scanning is deducted from the saved-list allowance instead of starting another 90 seconds',async()=>{
 const f=fixture({hold:'native-http'});let first;
 try{
  const pending=observed(f.refresh());await flush();assert.equal(f.held,true);await f.advance(68000);
  first=f.gate;f.holdPhase('list-body');first.resolve({ok:true,json:async()=>({ok:true})});await flush();
  assert.equal(f.held,true);assert.equal(f.completedCoordinators,1);assert.equal(f.nativePosts.length,1);
  let settled=false;pending.then(()=>{settled=true;});await f.advance(21999);assert.equal(settled,false);
  await f.advance(1);const result=await pending;assert.equal(result.ok,false);assert.match(result.error.message,/FILE_SYNC_TIMEOUT/);
  f.release();await flush();assert.equal(f.nativePosts.length,1);assert.equal(f.timers.size,0);
 }finally{first?.resolve({ok:true,json:async()=>({ok:true})});f.close();}
});

test('an aborted saved-list body cannot replace previously displayed files with its late result',async()=>{
 const f=fixture({hold:'list-body'}),controller=new AbortController();let visibleFiles=[knownFile];
 try{
  const pending=observed(f.refresh(controller.signal).then(result=>{visibleFiles=result.files;return result;}));
  await flush();assert.equal(f.held,true);controller.abort();assert.equal((await pending).ok,false);
  assert.equal(f.rpcCalls.find(call=>call.action==='list').init.signal.aborted,true);f.release();await flush();
  assert.deepEqual(visibleFiles,[knownFile]);assert.equal(f.nativePosts.length,1);assert.equal(f.timers.size,0);
 }finally{f.close();}
});

test('a cancelled editor consumer cannot cancel the catalogue refresh needed by a second editor consumer',async()=>{
 const f=fixture({hold:'native-http'}),controller=new AbortController();
 try{
  const cancelled=observed(f.refresh(controller.signal)),survivor=f.refresh();await flush();assert.equal(f.nativePosts.length,1);
  controller.abort();assert.equal((await cancelled).ok,false);assert.equal(f.nativePosts[0].init.signal.aborted,false);
  f.release();assert.deepEqual(await survivor,list());assert.equal(f.nativePosts.length,1);
  assert.equal(f.rpcCalls.filter(call=>call.action==='list').length,1);assert.equal(f.timers.size,0);
 }finally{f.close();}
});

test('a changed final session cannot return the previous owner saved files',async()=>{
 const f=fixture({hold:'list-body'});try{
  const pending=observed(f.refresh());await flush();assert.equal(f.held,true);f.owner(otherOwner);f.release();
  const result=await pending;assert.equal(result.ok,false);assert.match(result.error.message,/AUTH_REQUIRED/);
  assert.equal(f.nativePosts.length,1);assert.equal(f.timers.size,0);
 }finally{f.close();}
});

test('a delayed timer callback cannot allow a post-deadline saved-list response to succeed',async()=>{
 const f=fixture({hold:'list-body'});try{
  const pending=observed(f.refresh());await flush();assert.equal(f.held,true);
  f.jump(90000);f.release();const result=await pending;
  assert.equal(result.ok,false);assert.match(result.error.message,/FILE_SYNC_TIMEOUT/);
  assert.equal(f.nativePosts.length,1);assert.equal(f.authReads.includes('final-auth'),false);assert.equal(f.timers.size,0);
 }finally{f.close();}
});

test('a caller already aborted before entry cannot perform session, status, list or native reads',async()=>{
 const f=fixture(),controller=new AbortController();try{
  controller.abort();await assert.rejects(f.refresh(controller.signal));
  assert.equal(f.authReads.length,0);assert.equal(f.rpcCalls.length,0);assert.equal(f.nativePosts.length,0);assert.equal(f.timers.size,0);
 }finally{f.close();}
});
