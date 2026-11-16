import {customerMediaEndpoint} from './customer-media-routes.mjs?v=1';
import {decodeAssetThumbnail,thumbnailReadScope} from './asset-thumbnail.mjs?v=4';

const REGISTRY=Symbol.for('sma.thumbnail.batch.v1');
const MAX_ITEMS=10,MAX_BATCHES=3,MAX_RESPONSE_BYTES=8*1024*1024,CACHE_MS=60000,CACHE_ENTRIES=20;
const failed=()=>Error('PREVIEW_UNAVAILABLE');
const identity=file=>JSON.stringify([file.id,file.revision,file.media_kind]);
function sharedHost(){
 try{const top=globalThis.window?.top;if(top&&top.location.origin===globalThis.location?.origin)return top;}catch{}
 return globalThis;
}
function registry(host){
 if(!host[REGISTRY])Object.defineProperty(host,REGISTRY,{value:{owner:null,epoch:0,cache:new Map(),pending:new Map(),queue:[],batches:new Set(),timer:null},configurable:true});
 return host[REGISTRY];
}
function settle(job,error,blob){
 for(const consumer of [...job.consumers]){consumer.signal?.removeEventListener('abort',consumer.abort);job.consumers.delete(consumer);consumer.life.abort();if(error)consumer.reject(error);else consumer.resolve(blob);}
}
function clearRegistry(state,host){
 state.epoch++;state.owner=null;state.cache.clear();state.queue=[];
 if(state.timer!==null){host.clearTimeout(state.timer);state.timer=null;}
 for(const job of state.pending.values())settle(job,Error('PREVIEW_ABORTED'));
 state.pending.clear();for(const batch of state.batches)batch.scope.close();
}
// Auth callbacks invalidate every same-origin view synchronously. A late token,
// response, or body from a previous owner cannot populate the shared cache.
export function clearSharedThumbnailCache(host=sharedHost(),expectedOwner=null){const state=registry(host);if(expectedOwner&&state.owner!==expectedOwner)return;clearRegistry(state,host);}

async function readResponse(response,scope){
 if(!response.ok||!response.body?.getReader)throw failed();
 const length=response.headers?.get('content-length');
 if(length&&(!/^\d+$/.test(length)||Number(length)>MAX_RESPONSE_BYTES))throw failed();
 const reader=response.body.getReader(),parts=[];let size=0;
 try{
  for(;;){const {done,value}=await scope.read(()=>reader.read());if(done)break;
   size+=value.byteLength;if(size>MAX_RESPONSE_BYTES)throw failed();parts.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }finally{
  // A non-cooperating body must not keep the caller waiting after the deadline.
  void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}
 }
}
function readBatch(body,jobs){
 if(body?.ok!==true||body.can_publish!==false||!Array.isArray(body.assets)||body.assets.length!==jobs.length)throw failed();
 const expected=new Map(jobs.map(job=>[JSON.stringify([job.file.id,job.file.revision]),job])),seen=new Set(),results=new Map();
 for(const row of body.assets){
  const key=JSON.stringify([row?.asset_id,row?.asset_revision]),job=expected.get(key);
  if(!job||seen.has(key)||row.can_publish!==false||typeof row.ok!=='boolean')throw failed();seen.add(key);
  if(row.ok===false){results.set(job,{error:failed()});continue;}
  // A malformed image fails only its own binding. Foreign/duplicate identities
  // reject the entire envelope before any result enters the cache.
  try{results.set(job,{blob:decodeAssetThumbnail(job.file,row)});}catch{results.set(job,{error:failed()});}
 }
 return results;
}

// Each client supplies the already verified owner for its view, plus a fresh
// session when a batch starts. Only these short-lived JWTs reach the old endpoint.
// The registry stores neither tokens nor URLs for media on an external service.
export function createSharedThumbnailClient({getSession,getOwnerId,host=sharedHost(),endpoint=()=>customerMediaEndpoint('thumbnail'),request=(...args)=>host.fetch(...args)}){
 const state=registry(host);let epoch=state.epoch,owner=null,disposed=false;
 const ownConsumers=new Set();
 function activeOwner(){
  if(disposed||epoch!==state.epoch)throw Error('PREVIEW_ABORTED');
  const id=getOwnerId();if(typeof id!=='string'||!id)throw Error('AUTH_REQUIRED');
  if(owner!==null&&owner!==id)throw Error('AUTH_REQUIRED');
  if(state.owner!==null&&state.owner!==id){clearRegistry(state,host);epoch=state.epoch;}
  state.owner=id;owner=id;return id;
 }
 function schedule(){
  if(state.timer!==null)return;
  state.timer=host.setTimeout(()=>{state.timer=null;drain();},16);
 }
 function remove(job,consumer){
  consumer.signal?.removeEventListener('abort',consumer.abort);job.consumers.delete(consumer);ownConsumers.delete(consumer);consumer.life.abort();
  if(job.consumers.size||state.pending.get(job.key)!==job)return;
  state.pending.delete(job.key);
  if(job.batch&&job.batch.jobs.every(item=>state.pending.get(item.key)!==item||!item.consumers.size))job.batch.scope.close();
 }
 function drain(){
  while(state.batches.size<MAX_BATCHES){
   state.queue=state.queue.filter(job=>state.pending.get(job.key)===job&&job.consumers.size&&job.epoch===state.epoch);
   const first=state.queue.shift();if(!first)return;
   const jobs=[first],bindings=new Set([JSON.stringify([first.file.id,first.file.revision])]);
   for(let i=0;i<state.queue.length&&jobs.length<MAX_ITEMS;){const job=state.queue[i];
    const binding=JSON.stringify([job.file.id,job.file.revision]);
    if(job.endpoint===first.endpoint&&job.epoch===first.epoch&&!bindings.has(binding)){jobs.push(job);bindings.add(binding);state.queue.splice(i,1);}else i++;
   }
   const batch={jobs,scope:thumbnailReadScope(),epoch:state.epoch};for(const job of jobs)job.batch=batch;
   state.batches.add(batch);void run(batch);
  }
 }
 async function sessionFor(batch){
  // A gallery can close while its iframe still needs the same pending image.
  // Select a live consumer at dispatch, and hand off stalled authentication if
  // that consumer leaves. The original batch deadline never restarts.
  for(;;){
   batch.scope.signal.throwIfAborted();
   const job=batch.jobs.find(item=>state.pending.get(item.key)===item&&item.consumers.size),consumer=job?.consumers.values().next().value;
   if(!consumer)throw Error('PREVIEW_ABORTED');
   const auth=thumbnailReadScope(AbortSignal.any([batch.scope.signal,consumer.life.signal]),false);
   try{return await auth.read(consumer.getSession);}
   catch(error){if(!job.consumers.has(consumer)&&!batch.scope.signal.aborted)continue;throw error;}
   finally{auth.close();}
  }
 }
 async function run(batch){
  const {jobs,scope}=batch,first=jobs[0];
  try{
   const session=await sessionFor(batch);
   if(state.epoch!==batch.epoch||session?.user?.id!==first.owner||typeof session.access_token!=='string'||!session.access_token)throw Error('AUTH_REQUIRED');
   const response=await scope.read(()=>request(first.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
    body:JSON.stringify({assets:jobs.map(({file})=>({asset_id:file.id,asset_revision:file.revision}))}),credentials:'omit',redirect:'error',cache:'no-store',signal:scope.signal}));
   const body=await readResponse(response,scope);scope.signal.throwIfAborted();
   const results=readBatch(body,jobs);
   if(state.epoch!==batch.epoch||state.owner!==first.owner)return;
   for(const job of jobs){
    if(state.pending.get(job.key)!==job||!job.consumers.size)continue;
    const result=results.get(job);state.pending.delete(job.key);
    if(result.blob){state.cache.delete(job.key);state.cache.set(job.key,{blob:result.blob,time:Date.now()});if(state.cache.size>CACHE_ENTRIES)state.cache.delete(state.cache.keys().next().value);}
    settle(job,result.error,result.blob);
   }
  }catch(error){for(const job of jobs)if(state.pending.get(job.key)===job){state.pending.delete(job.key);settle(job,error);}}
  finally{scope.close();state.batches.delete(batch);drain();}
 }
 return {
  request(file,signal){
   try{
    signal?.throwIfAborted();const id=activeOwner(),url=endpoint();
    file={id:file.id,revision:file.revision,media_kind:file.media_kind};
    const key=JSON.stringify([url,identity(file)]),entry=state.cache.get(key);
    if(entry&&Date.now()-entry.time<=CACHE_MS){const currentEpoch=state.epoch;return Promise.resolve().then(()=>{signal?.throwIfAborted();if(disposed||currentEpoch!==state.epoch||state.owner!==id)throw Error('PREVIEW_ABORTED');return entry.blob;});}state.cache.delete(key);
    let job=state.pending.get(key);
    if(!job){job={key,file,endpoint:url,owner:id,epoch:state.epoch,consumers:new Set(),batch:null};state.pending.set(key,job);state.queue.push(job);}
    return new Promise((resolve,reject)=>{
     const consumer={signal,getSession,life:new AbortController(),resolve:value=>{ownConsumers.delete(consumer);resolve(value);},reject:error=>{ownConsumers.delete(consumer);reject(error);},abort:null,job};
     consumer.abort=()=>{remove(job,consumer);reject(Error('PREVIEW_ABORTED'));};job.consumers.add(consumer);ownConsumers.add(consumer);
     signal?.addEventListener('abort',consumer.abort,{once:true});if(signal?.aborted){consumer.abort();return;}schedule();
    });
   }catch(error){return Promise.reject(error);}
  },
  dispose(){if(disposed)return;disposed=true;for(const consumer of [...ownConsumers])consumer.abort();}
 };
}
