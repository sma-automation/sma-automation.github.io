import {customerMediaEndpoint} from './customer-media-routes.mjs?v=1';

export const CATALOG_REFRESH_READ_MS=90000;
export const CATALOG_REFRESH_GATE_MS=15000;
const REGISTRY=Symbol.for('sma.catalog.refresh.v1');
const DRIVER=Symbol.for('sma.catalog.refresh.driver.v1');
const MAX_RUNNING=1,MAX_RECENT=32;
const CODES=new Set(['AUTH_REQUIRED','ACCESS_INACTIVE','ACCOUNT_UNAVAILABLE','FILE_SYNC_RATE_LIMITED','FILE_SYNC_RUNNING','FOLDER_UNAVAILABLE','FILE_CATALOG_TOO_LARGE','FILE_METADATA_INVALID','FILE_SYNC_UNAVAILABLE','FILE_SYNC_ABORTED','FILE_SYNC_TIMEOUT']);
let defaultHost;

function failed(code='FILE_SYNC_UNAVAILABLE',retryAfter){
 const error=Error(code);error.code=code;
 if(Number.isInteger(retryAfter)&&retryAfter>=0&&retryAfter<=120000)error.retry_after_ms=retryAfter;
 return error;
}
const cancelled=()=>failed('FILE_SYNC_ABORTED');
function knownError(error){
 const code=typeof error?.code==='string'?error.code:error?.message;
 return CODES.has(code)?failed(code,error?.retry_after_ms):failed();
}
function sharedHost(){
 if(defaultHost)return defaultHost;
 try{const top=globalThis.window?.top;if(top&&top.location.origin===globalThis.location?.origin&&(top===globalThis.window||typeof top[DRIVER]==='function'))return defaultHost=top;}catch{}
 // A frame without an installed parent driver keeps this choice for its whole
 // lifetime. Later imports cannot move its auth observer to a different host.
 return defaultHost=globalThis;
}
function registry(host){
 if(!host[REGISTRY])Object.defineProperty(host,REGISTRY,{value:{owner:undefined,epoch:0,pending:new Map(),recent:new Map(),consumers:new Set(),queue:[],running:new Set()},configurable:true});
 return host[REGISTRY];
}
function readScope(host,parent,timeout,now){
 const controller=new AbortController(),signal=controller.signal,expires=now()+Math.max(0,timeout);
 const abort=reason=>{if(!signal.aborted)controller.abort(reason||cancelled());};
 const parentAbort=()=>abort(parent.reason||cancelled());
 const setTimer=host.setTimeout?.bind(host)||setTimeout,clearTimer=host.clearTimeout?.bind(host)||clearTimeout;
 const timer=setTimer(()=>abort(failed('FILE_SYNC_TIMEOUT')),Math.max(0,timeout));
 parent?.addEventListener('abort',parentAbort,{once:true});if(parent?.aborted)parentAbort();
 function check(){if(now()>=expires)abort(failed('FILE_SYNC_TIMEOUT'));signal.throwIfAborted();}
 function read(start){
  return new Promise((resolve,reject)=>{
   let settled=false;
   const finish=(callback,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',onAbort);callback(value);};
   const onAbort=()=>finish(reject,signal.reason||cancelled());
   try{check();}catch(error){finish(reject,error);return;}
   signal.addEventListener('abort',onAbort,{once:true});
   try{Promise.resolve(start()).then(value=>{try{check();finish(resolve,value);}catch(error){finish(reject,error);}},error=>finish(reject,error));}catch(error){finish(reject,error);}
  });
 }
 return {signal,read,check,abort,close(){clearTimer(timer);parent?.removeEventListener('abort',parentAbort);}};
}
function assertConsumer(state,consumer){
 consumer.scope.check();
 if(consumer.epoch!==state.epoch||!state.consumers.has(consumer))throw cancelled();
}
async function checkedSession(state,consumer){
 let session;
 try{session=await consumer.scope.read(consumer.getSession);}catch(error){consumer.scope.check();throw failed('AUTH_REQUIRED');}
 assertConsumer(state,consumer);
 const id=session?.user?.id;
 if(typeof id!=='string'||!id||id!==consumer.owner||typeof session.access_token!=='string'||!session.access_token)throw failed('AUTH_REQUIRED');
 if(state.owner===undefined)state.owner=id;
 // A session authorizes only its own consumer. Stale SDK snapshots never
 // replace a newer identity observed by another frame's auth listener.
 else if(state.owner!==id)throw failed('AUTH_REQUIRED');
 assertConsumer(state,consumer);return session;
}
function assertJob(state,job){
 job.scope.check();
 if(job.epoch!==state.epoch||state.owner!==job.owner||state.pending.get(job.key)!==job||!job.consumers.size)throw cancelled();
}
function finishJob(state,job,error){
 if(job.finished)return;job.finished=true;
 if(state.pending.get(job.key)===job)state.pending.delete(job.key);
 const queued=state.queue.indexOf(job);if(queued!==-1)state.queue.splice(queued,1);
 state.running.delete(job);job.scope.close();
 if(error)job.reject(error);else job.resolve();
 drain(state);
}
function removeConsumer(state,consumer,reason=cancelled()){
 if(!state.consumers.delete(consumer))return;
 consumer.local.delete(consumer);consumer.scope.abort(reason);consumer.scope.close();
 const job=consumer.job;if(!job)return;
 job.consumers.delete(consumer);
 if(job.consumers.size)return;
 // Also close a completed transport when its last receiver finishes final
 // auth. Disposal is synchronous; it never depends on a detached frame's finally.
 job.scope.abort(reason);job.scope.close();finishJob(state,job,reason);
}
function clearRegistry(state,owner,reason=cancelled()){
 state.epoch++;state.owner=owner;state.queue=[];
 const pending=[...state.pending.values()];
 for(const consumer of [...state.consumers])removeConsumer(state,consumer,reason);
 for(const job of pending){job.scope.abort(reason);finishJob(state,job,reason);}
 state.pending.clear();state.running.clear();
 // Keep only the tiny recent-dispatch guards across logout/clear. Removing a
 // receiver cannot undo an already sent POST or its delayed server reservation.
}
export function syncSharedCatalogRefreshOwner(owner,host=sharedHost(),{initial=false}={}){
 const state=registry(host),next=typeof owner==='string'&&owner?owner:null;
 if(initial&&state.owner!==undefined&&state.owner!==next)return;
 if(state.owner===undefined&&![...state.consumers].some(consumer=>consumer.owner!==next)){state.owner=next;return;}
 if(state.owner!==next)clearRegistry(state,next,failed('AUTH_REQUIRED'));
}
export function clearSharedCatalogRefreshCache(host=sharedHost(),expectedOwner=null){
 const state=registry(host);if(expectedOwner!==null&&state.owner!==expectedOwner)return;
 clearRegistry(state,undefined);
}
function pruneRecent(state,now){
 for(const [key,entry] of state.recent)if(now>=entry.until)state.recent.delete(key);
 while(state.recent.size>MAX_RECENT)state.recent.delete(state.recent.keys().next().value);
}
function validatedStatus(body){
 if(body?.ok!==true)throw knownError(body);
 const keys=Object.keys(body).sort();
 if(keys.length!==6||keys.join(',')!=='can_publish,ok,retry_after_ms,sync_state,synced_at,version')throw failed();
 const stamp=body.synced_at;
 if(body.version!==1||body.can_publish!==false||!['running','interrupted','complete','idle'].includes(body.sync_state)||!Number.isInteger(body.retry_after_ms)||body.retry_after_ms<0||body.retry_after_ms>120000||stamp!==null&&(typeof stamp!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(stamp)||!Number.isFinite(Date.parse(stamp))))throw failed();
 return body;
}
function remainingConsumer(state,job){
 assertJob(state,job);
 const consumer=[...job.consumers].find(item=>!item.scope.signal.aborted);
 if(!consumer)throw cancelled();return consumer;
}
async function statusFor(state,job){
 for(;;){
  const consumer=remainingConsumer(state,job);
  try{
   const body=await job.scope.read(()=>consumer.scope.read(()=>consumer.readStatus(job.scope.signal)));
   assertConsumer(state,consumer);assertJob(state,job);return validatedStatus(body);
  }catch(error){
   if(consumer.scope.signal.aborted&&!job.scope.signal.aborted&&state.pending.get(job.key)===job)continue;
   job.scope.check();throw knownError(error);
  }
 }
}
async function sessionFor(state,job){
 for(;;){
  const consumer=remainingConsumer(state,job);
  try{return await job.scope.read(()=>checkedSession(state,consumer));}
  catch(error){
   if(error?.code==='AUTH_REQUIRED'&&!job.scope.signal.aborted)removeConsumer(state,consumer,error);
   if(consumer.scope.signal.aborted&&!job.scope.signal.aborted&&state.pending.get(job.key)===job)continue;
   throw error;
  }
 }
}
async function run(state,job){
 try{
  const status=await statusFor(state,job);assertJob(state,job);
  if(status.sync_state==='running')throw failed('FILE_SYNC_RUNNING',status.retry_after_ms);
  if(status.retry_after_ms>0)throw failed('FILE_SYNC_RATE_LIMITED',status.retry_after_ms);
  pruneRecent(state,job.now());
  const recent=state.recent.get(job.key);
  if(recent&&job.now()<recent.until)throw failed('FILE_SYNC_RATE_LIMITED',Math.ceil(recent.until-job.now()));
  const session=await sessionFor(state,job);assertJob(state,job);
  const attempt={until:job.now()+CATALOG_REFRESH_GATE_MS,uncertain:true};
  state.recent.delete(job.key);state.recent.set(job.key,attempt);pruneRecent(state,job.now());
  // The local guard begins at dispatch, before n8n can reserve its server lease.
  // A lost response or cancelled receiver cannot make that dispatch unsent.
  const response=await job.scope.read(()=>job.request(job.endpoint,{method:'POST',headers:{Authorization:'Bearer '+session.access_token},credentials:'omit',redirect:'error',cache:'no-store',signal:job.scope.signal}));
  const data=await job.scope.read(()=>response.json());assertJob(state,job);
  if(!response.ok||data?.ok!==true)throw knownError(data);
  attempt.uncertain=false;finishJob(state,job);
 }catch(error){finishJob(state,job,job.scope.signal.aborted?job.scope.signal.reason||cancelled():knownError(error));}
}
function drain(state){
 while(state.running.size<MAX_RUNNING&&state.queue.length){
  const job=state.queue.shift();
  if(job.finished||state.pending.get(job.key)!==job||!job.consumers.size||job.scope.signal.aborted)continue;
  state.running.add(job);void run(state,job);
 }
}

// Only in-flight work and bounded dispatch guards are shared. There is no cached
// success response, token, persistent storage, polling or automatic next POST.
export function createSharedCatalogRefreshClient(options={}){
 let host=options.host??sharedHost();const driver=host[DRIVER];
 // The surviving top realm must create the entire async driver and its Promises,
 // not just fetch. A removed initiating iframe cannot own another view's work.
 if(typeof driver==='function'&&driver!==createSharedCatalogRefreshClient)return driver({...options,host});
 if(globalThis.window&&host!==globalThis.window&&host.window===host&&!driver)host=globalThis;
 const {getSession,readStatus,endpoint=()=>customerMediaEndpoint('catalog'),request=(...args)=>host.fetch(...args),now=()=>Date.now()}=options;
 if(typeof getSession!=='function')throw failed('AUTH_REQUIRED');
 if(typeof readStatus!=='function'||typeof request!=='function')throw failed();
 const state=registry(host),consumers=new Set();let disposed=false;
 return {
  async refresh({owner,signal}={}){
   if(disposed)throw cancelled();signal?.throwIfAborted();
   if(typeof owner!=='string'||!owner)throw failed('AUTH_REQUIRED');
   const started=now(),consumer={owner,getSession,readStatus,epoch:state.epoch,started,scope:readScope(host,signal,CATALOG_REFRESH_READ_MS,now),job:null,local:consumers};
   consumers.add(consumer);state.consumers.add(consumer);
   consumer.scope.signal.addEventListener('abort',()=>removeConsumer(state,consumer,consumer.scope.signal.reason||cancelled()),{once:true});
   try{
    await checkedSession(state,consumer);assertConsumer(state,consumer);
    const url=typeof endpoint==='function'?endpoint():endpoint;
    if(typeof url!=='string'||!url)throw failed();
    const key=JSON.stringify([owner,url]);let job=state.pending.get(key);
    if(!job){
     let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
     // An immediate dispose can happen before a consumer attaches its waiter.
     void promise.catch(()=>{});
     job={key,owner,epoch:state.epoch,endpoint:url,request,now,host,consumers:new Set(),scope:readScope(host,null,CATALOG_REFRESH_READ_MS-(now()-started),now),promise,resolve,reject,finished:false};
     job.scope.signal.addEventListener('abort',()=>finishJob(state,job,job.scope.signal.reason||cancelled()),{once:true});
     state.pending.set(key,job);state.queue.push(job);
    }
    consumer.job=job;job.consumers.add(consumer);drain(state);
    await consumer.scope.read(()=>job.promise);assertConsumer(state,consumer);
    await checkedSession(state,consumer);assertConsumer(state,consumer);
   }finally{removeConsumer(state,consumer);}
  },
  dispose(){if(disposed)return;disposed=true;for(const consumer of [...consumers])removeConsumer(state,consumer);}
 };
}

if(globalThis.window&&globalThis.window===globalThis.window.top)Object.defineProperty(globalThis,DRIVER,{value:createSharedCatalogRefreshClient,configurable:true});
