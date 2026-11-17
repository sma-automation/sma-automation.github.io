import {customerMediaEndpoint} from './customer-media-routes.mjs?v=1';
import {sha256,EXPORT_MAX_BYTES} from './media-export-model.mjs?v=1';

export const ORIGINAL_MEDIA_MAX_ENTRIES=2;
export const ORIGINAL_MEDIA_MAX_BYTES=48000000;
export const ORIGINAL_MEDIA_TTL_MS=600000;
export const ORIGINAL_MEDIA_READ_MS=180000;
const REGISTRY=Symbol.for('sma.original.media.v1');
const DRIVER=Symbol.for('sma.original.media.driver.v1');
const MAX_READS=2,MAX_RESPONSE_BYTES=32004096;
const MIME_TYPES=new Set(['video/mp4','image/jpeg','image/png','image/webp']);
const failed=()=>Error('SOURCE_UNAVAILABLE');
const cancelled=()=>Error('SOURCE_ABORTED');
let defaultHost;

function sharedHost(){
 if(defaultHost)return defaultHost;
 try{const top=globalThis.window?.top;if(top&&top.location.origin===globalThis.location?.origin&&(top===globalThis.window||typeof top[DRIVER]==='function'))return defaultHost=top;}catch{}
 // Keep auth observers, explicit clears and all later clients on the same host
 // for this module's lifetime, even if an unrelated parent imports us later.
 return defaultHost=globalThis;
}
function registry(host){
 if(!host[REGISTRY])Object.defineProperty(host,REGISTRY,{value:{owner:undefined,epoch:0,cache:new Map(),bytes:0,pending:new Map(),consumers:new Set(),queue:[],running:new Set()},configurable:true});
 return host[REGISTRY];
}
function readScope(host,parent,timeout){
 const controller=new AbortController(),signal=controller.signal;
 const abort=reason=>{if(!signal.aborted)controller.abort(reason||cancelled());};
 const parentAbort=()=>abort(parent.reason||cancelled());
 const setTimer=host.setTimeout?.bind(host)||setTimeout,clearTimer=host.clearTimeout?.bind(host)||clearTimeout;
 const timer=setTimer(()=>abort(Error('SOURCE_TIMEOUT')),Math.max(0,timeout));
 parent?.addEventListener('abort',parentAbort,{once:true});if(parent?.aborted)parentAbort();
 function read(start){
  return new Promise((resolve,reject)=>{
   let settled=false;
   const finish=(callback,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',onAbort);callback(value);};
   const onAbort=()=>finish(reject,signal.reason||cancelled());
   if(signal.aborted)return onAbort();signal.addEventListener('abort',onAbort,{once:true});
   try{Promise.resolve(start()).then(value=>finish(resolve,value),error=>finish(reject,error));}catch(error){finish(reject,error);}
  });
 }
 return {signal,read,abort,close(){clearTimer(timer);parent?.removeEventListener('abort',parentAbort);}};
}
function clearRegistry(state,owner,reason=cancelled()){
 state.epoch++;state.owner=owner;state.cache.clear();state.bytes=0;state.queue=[];
 for(const consumer of state.consumers)consumer.scope.abort(reason);
 for(const job of state.pending.values())job.scope.abort(reason);
 state.pending.clear();
}
// Auth observers call this synchronously, including observers in other portal
// frames. The first observation initializes the registry without cancelling the
// initial session read which established that same owner.
export function syncSharedOriginalMediaOwner(owner,host=sharedHost(),{initial=false}={}){
 const state=registry(host),next=typeof owner==='string'&&owner?owner:null;
 // Another SDK instance can report its initial snapshot after this top window
 // has already observed a newer owner. Only a subsequent auth event may replace
 // that known identity; an initial snapshot is not a new sign-in.
 if(initial&&state.owner!==undefined&&state.owner!==next)return;
 if(state.owner===undefined&&!Array.from(state.consumers).some(consumer=>consumer.owner!==next)){state.owner=next;return;}
 if(state.owner!==next)clearRegistry(state,next,Error('AUTH_REQUIRED'));
}
export function clearSharedOriginalMediaCache(host=sharedHost(),expectedOwner=null){
 const state=registry(host);if(expectedOwner!==null&&state.owner!==expectedOwner)return;
 clearRegistry(state,undefined);
}
function prune(state,now){
 for(const [key,entry] of state.cache)if(now>=entry.expires){state.cache.delete(key);state.bytes-=entry.size;}
}
function remember(state,key,entry,now){
 prune(state,now);if(now>=entry.expires||entry.size>ORIGINAL_MEDIA_MAX_BYTES)return;
 const old=state.cache.get(key);if(old){state.cache.delete(key);state.bytes-=old.size;}
 state.cache.set(key,entry);state.bytes+=entry.size;
 while(state.cache.size>ORIGINAL_MEDIA_MAX_ENTRIES||state.bytes>ORIGINAL_MEDIA_MAX_BYTES){const first=state.cache.keys().next().value;state.bytes-=state.cache.get(first).size;state.cache.delete(first);}
}
function binding(file){
 const id=file?.id??file?.asset_id,revision=file?.revision??file?.asset_revision;
 if(typeof id!=='string'||!id||id.length>250||typeof revision!=='string'||!revision||revision.length>250||file.id!==undefined&&file.asset_id!==undefined&&file.id!==file.asset_id||file.revision!==undefined&&file.asset_revision!==undefined&&file.revision!==file.asset_revision)throw failed();
 const mime=file.mime_type,size=file.size_bytes??undefined;
 if(mime!==undefined&&!MIME_TYPES.has(mime)||size!==undefined&&(!Number.isInteger(size)||size<12||size>EXPORT_MAX_BYTES))throw failed();
 return {id,revision,mime,size};
}
function matches(file,entry){
 if(file.mime!==undefined&&file.mime!==entry.mime||file.size!==undefined&&file.size!==entry.size)throw failed();
}
function assertConsumer(state,consumer){
 consumer.scope.signal.throwIfAborted();
 if(consumer.epoch!==state.epoch||!state.consumers.has(consumer))throw cancelled();
}
async function checkedSession(state,consumer){
 let session;
 try{session=await consumer.scope.read(consumer.getSession);}catch(error){consumer.scope.signal.throwIfAborted();throw Error('AUTH_REQUIRED');}
 assertConsumer(state,consumer);
 const id=session?.user?.id;
 if(typeof id!=='string'||!id||typeof session.access_token!=='string'||!session.access_token||id!==consumer.owner)throw Error('AUTH_REQUIRED');
 if(state.owner===undefined)state.owner=id;
 // Session snapshots authorize this consumer only. A stale or empty snapshot
 // must not reverse another frame's explicit auth observation or cancel its
 // valid consumers; shared invalidation belongs to the auth event observers.
 else if(state.owner!==id)throw Error('AUTH_REQUIRED');
 assertConsumer(state,consumer);return session;
}
async function readResponse(response,scope){
 if(!response?.ok)throw failed();
 const length=response.headers?.get('content-length');
 if(length&&(!/^\d+$/.test(length)||Number(length)>MAX_RESPONSE_BYTES))throw failed();
 if(!response.body?.getReader)return scope.read(()=>response.json());
 const reader=response.body.getReader(),parts=[];let size=0;
 try{
  for(;;){const {done,value}=await scope.read(()=>reader.read());if(done)break;size+=value.byteLength;if(size>MAX_RESPONSE_BYTES)throw failed();parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }finally{void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
}
async function decode(body,job){
 if(body?.ok!==true)throw Error(typeof body?.code==='string'?body.code:'SOURCE_UNAVAILABLE');
 if(body.can_publish!==false||body.asset_id!==job.file.id||body.asset_revision!==job.file.revision||!MIME_TYPES.has(body.mime_type)||!Number.isInteger(body.size_bytes)||body.size_bytes<12||body.size_bytes>EXPORT_MAX_BYTES||typeof body.sha256!=='string'||!/^[a-f0-9]{64}$/.test(body.sha256)||typeof body.data_base64!=='string'||body.data_base64.length>32000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.data_base64))throw failed();
 const bytes=Uint8Array.from(atob(body.data_base64),c=>c.charCodeAt(0));
 if(bytes.length!==body.size_bytes||await job.scope.read(()=>sha256(bytes))!==body.sha256||body.asset_revision.startsWith('sha256:')&&body.asset_revision.split(':')[1]!==body.sha256)throw failed();
 job.scope.signal.throwIfAborted();
 const BlobType=job.host.Blob||Blob;
 return {blob:new BlobType([bytes],{type:body.mime_type}),mime:body.mime_type,size:body.size_bytes,expires:job.now()+ORIGINAL_MEDIA_TTL_MS};
}
function assertJob(state,job){
 job.scope.signal.throwIfAborted();
 if(job.epoch!==state.epoch||state.owner!==job.owner||state.pending.get(job.key)!==job||!job.consumers.size)throw cancelled();
}
async function sessionFor(state,job){
 for(;;){
  assertJob(state,job);
  const consumer=[...job.consumers].find(item=>!item.scope.signal.aborted);
  if(!consumer)throw cancelled();
  try{return await job.scope.read(()=>checkedSession(state,consumer));}
  catch(error){if(consumer.scope.signal.aborted&&!job.scope.signal.aborted&&state.pending.get(job.key)===job)continue;throw error;}
 }
}
async function run(state,job){
 try{
  const session=await sessionFor(state,job);assertJob(state,job);
  const response=await job.scope.read(()=>job.fetcher(job.endpoint,{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',signal:job.scope.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({asset_id:job.file.id,asset_revision:job.file.revision})}));
  const entry=await decode(await readResponse(response,job.scope),job);assertJob(state,job);
  job.resolve(entry);
 }catch(error){job.reject(error);if(state.pending.get(job.key)===job)state.pending.delete(job.key);}
 finally{job.scope.close();}
}
function drain(state){
 while(state.running.size<MAX_READS&&state.queue.length){
  const job=state.queue.shift();
  if(state.pending.get(job.key)!==job||!job.consumers.size||job.scope.signal.aborted)continue;
  state.running.add(job);void run(state,job);
 }
}
function removeConsumer(state,consumer){
 if(!state.consumers.delete(consumer))return;
 consumer.scope.abort();consumer.scope.close();
 const job=consumer.job;if(!job)return;
 job.consumers.delete(consumer);
 if(job.consumers.size)return;
 if(state.pending.get(job.key)===job)state.pending.delete(job.key);
 job.scope.abort();job.scope.close();state.running.delete(job);drain(state);
}

// This registry contains verified Blobs and short-lived in-flight consumers only.
// Tokens stay in individual auth/transport calls; media never reaches persistent
// storage. Each receiver gets a Blob constructed in its own JavaScript realm.
export function createSharedOriginalMediaClient(options={}){
 const {getSession,BlobCtor=Blob}=options;let host=options.host??sharedHost();
 // Using top.fetch alone does not keep an iframe's Promise/async continuations
 // alive after that iframe is removed. The surviving host must create the whole
 // driver, while each consumer retains its own session callback and Blob realm.
 const driver=host[DRIVER];
 if(typeof driver==='function'&&driver!==createSharedOriginalMediaClient)return driver({...options,host,BlobCtor});
 // Known app hosts import this module themselves. An unrelated embed without a
 // host driver keeps its own bounded cache instead of sharing a disposable job.
 if(globalThis.window&&host!==globalThis.window&&host.window===host&&!driver)host=globalThis;
 const {endpoint=()=>customerMediaEndpoint('original'),fetcher=(...args)=>host.fetch(...args),now=()=>Date.now()}=options;
 if(typeof getSession!=='function')throw Error('AUTH_REQUIRED');
 const state=registry(host),consumers=new Set();let disposed=false;
 return {
  async request(file,{owner,signal}={}){
   if(disposed)throw cancelled();signal?.throwIfAborted();
   if(typeof owner!=='string'||!owner)throw Error('AUTH_REQUIRED');
   const selected=binding(file),url=typeof endpoint==='function'?endpoint():endpoint;
   if(typeof url!=='string'||!url)throw failed();
   const consumer={owner,host,getSession,epoch:state.epoch,started:now(),scope:readScope(host,signal,ORIGINAL_MEDIA_READ_MS),job:null};
   consumers.add(consumer);state.consumers.add(consumer);
   try{
    await checkedSession(state,consumer);assertConsumer(state,consumer);
    const key=JSON.stringify([owner,url,selected.id,selected.revision]);prune(state,now());
    let entry=state.cache.get(key);
    if(entry){matches(selected,entry);state.cache.delete(key);state.cache.set(key,entry);}
    else{
     let job=state.pending.get(key);
     if(!job){
      let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
      job={key,file:selected,owner,epoch:state.epoch,endpoint:url,host,fetcher,now,consumers:new Set(),scope:readScope(host,null,ORIGINAL_MEDIA_READ_MS-(now()-consumer.started)),promise,resolve,reject};
      job.scope.signal.addEventListener('abort',()=>{reject(job.scope.signal.reason||cancelled());if(state.pending.get(key)===job)state.pending.delete(key);},{once:true});
      state.pending.set(key,job);state.queue.push(job);
     }
     consumer.job=job;job.consumers.add(consumer);drain(state);
     entry=await consumer.scope.read(()=>job.promise);assertConsumer(state,consumer);matches(selected,entry);
     await checkedSession(state,consumer);assertConsumer(state,consumer);
     remember(state,key,entry,now());
    }
    assertConsumer(state,consumer);if(state.owner!==owner)throw Error('AUTH_REQUIRED');
    const blob=new BlobCtor([entry.blob],{type:entry.mime});assertConsumer(state,consumer);return blob;
   }finally{consumers.delete(consumer);removeConsumer(state,consumer);}
  },
  dispose(){if(disposed)return;disposed=true;for(const consumer of [...consumers]){consumers.delete(consumer);removeConsumer(state,consumer);}}
 };
}

// This module is loaded by the dashboard and standalone API in the top window.
// Child modules may call this function, but cannot install their own realm as
// the long-lived driver of another window.
if(globalThis.window&&globalThis.window===globalThis.window.top)Object.defineProperty(globalThis,DRIVER,{value:createSharedOriginalMediaClient,configurable:true});
