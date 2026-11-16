import {customerMediaEndpoint} from './customer-media-routes.mjs?v=1';

// One deadline covers even non-abortable auth, transport and response-body reads.
// Late replies are consumed, never allowed to resume a cancelled view.
export function thumbnailReadScope(parent,deadline=true){
 const controller=new AbortController();
 const signal=AbortSignal.any([controller.signal,...(parent?[parent]:[]),...(deadline?[AbortSignal.timeout(45000)]:[])]);
 function read(start){
  return new Promise((resolve,reject)=>{
   let settled=false;
   const finish=(callback,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);callback(value);};
   const abort=()=>finish(reject,Error('PREVIEW_ABORTED'));
   if(signal.aborted)return abort();
   signal.addEventListener('abort',abort,{once:true});
   try{Promise.resolve(start()).then(value=>finish(resolve,value),error=>finish(reject,error));}
   catch(error){finish(reject,error);}
  });
 }
 return {controller,signal,read,close(){controller.abort();}};
}
export function decodeAssetThumbnail(file,r){
 if(r?.ok!==true||r.can_publish!==false||r.asset_id!==file.id||r.asset_revision!==file.revision||r.media_kind!==file.media_kind||!['image/jpeg','image/png','image/webp'].includes(r.mime_type)||typeof r.image_base64!=='string'||r.image_base64.length>2666668||!/^[A-Za-z0-9+/]+={0,2}$/.test(r.image_base64))throw Error('PREVIEW_UNAVAILABLE');
 const bytes=Uint8Array.from(atob(r.image_base64),c=>c.charCodeAt(0));if(bytes.length<12||bytes.length>2000000)throw Error('PREVIEW_UNAVAILABLE');
 return new Blob([bytes],{type:r.mime_type});
}
export async function fetchAssetThumbnail(file,token,signal,request=fetch){
 signal?.throwIfAborted();
 const scope=thumbnailReadScope(signal);
 try{
  const response=await scope.read(()=>request(customerMediaEndpoint('thumbnail'),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({asset_id:file.id,asset_revision:file.revision}),credentials:'omit',redirect:'error',cache:'no-store',signal:scope.signal}));
  const r=await scope.read(()=>response.json());scope.signal.throwIfAborted();
  if(!response.ok)throw Error('PREVIEW_UNAVAILABLE');
  return decodeAssetThumbnail(file,r);
 }finally{scope.close();}
}
// One owner-scoped loader per view; at most three concurrent preview requests.
// Object URLs and responses live only in memory and are cleared at logout/reload.
export function createMediaThumbnailLoader(getToken,{client=null}={}){
 let generation=0,owner=0,active=0,queue=[],observer=null;
 const cache=new Map(),urls=new Set(),pending=new Map(),wanted=new Set();
 function reset(){
  generation++;observer?.disconnect();observer=null;queue=[];wanted.clear();
  for(const [key,job] of pending){job.targets=[];if(!job.scope)pending.delete(key);}
  for(const url of urls)URL.revokeObjectURL(url);urls.clear();
  // A renderer re-observes its next page synchronously. Keep matching work even
  // before IntersectionObserver fires; abort only files that left the new view.
  const version=generation;void Promise.resolve().then(()=>{
   if(version!==generation)return;
   for(const [key,job] of pending)if(!wanted.has(key)){pending.delete(key);job.scope?.close();}
  });
 }
 function clear(){reset();owner++;for(const job of pending.values())job.scope?.close();pending.clear();cache.clear();}
 function current({host,version}){return version===generation&&host.isConnected;}
 function show(target,entry){
  if(!current(target))return;const {host,file,version}=target;
  const url=URL.createObjectURL(entry.blob);urls.add(url);const img=host.ownerDocument.createElement('img');img.alt=file.media_kind==='video'?'Videovorschau':'Bildvorschau';img.decoding='async';img.src=url;
  img.addEventListener('error',()=>{if(version!==generation)return;host.textContent=file.media_kind==='video'?'Video':'Bild';URL.revokeObjectURL(url);urls.delete(url);});host.replaceChildren(img);
 }
 function drain(){
  // The shared client limits whole batches globally; submitting all visible
  // identities here lets ten thumbnails use one request instead of four.
  while(active<(client?Infinity:3)&&queue.length){const job=queue.shift();if(pending.get(job.key)!==job)continue;active++;job.scope=thumbnailReadScope(undefined,!client);void run(job);}
 }
 async function run(job){
  const {key,file,scope}=job;
  try{
   let blob;
   if(client)blob=await scope.read(()=>client.request(file,scope.signal));
   else{const token=await scope.read(getToken);blob=await scope.read(()=>fetchAssetThumbnail(file,token,scope.signal));}
   scope.signal.throwIfAborted();
   if(job.owner!==owner||pending.get(key)!==job)return;
   const entry={blob,time:Date.now()};
   if(!client){cache.delete(key);cache.set(key,entry);if(cache.size>20)cache.delete(cache.keys().next().value);}
   for(const target of job.targets)show(target,entry);
  }catch{if(job.owner===owner)for(const target of job.targets)if(current(target))target.host.textContent='Vorschau folgt';}
  finally{scope.close();if(pending.get(key)===job)pending.delete(key);active--;drain();}
 }
 function observe(host,file){
  file={id:file.id,revision:file.revision,media_kind:file.media_kind};
  host.textContent=file.media_kind==='video'?'▶':'▧';const target={host,file,version:generation},key=JSON.stringify([file.id,file.revision,file.media_kind]);wanted.add(key);let queued=false;
  const enqueue=()=>{
   if(queued||!current(target))return;queued=true;
   const entry=cache.get(key);if(!client&&entry&&Date.now()-entry.time<=60000){show(target,entry);return;}cache.delete(key);
   let job=pending.get(key);
   if(!job||job.scope?.signal.aborted){job={key,file,owner,targets:[],scope:null};pending.set(key,job);queue.push(job);}
   job.targets.push(target);drain();
  };
  const Observer=host.ownerDocument.defaultView?.IntersectionObserver;
  if(!Observer){enqueue();return;}
  if(!observer){const current=new Observer(entries=>{if(observer!==current)return;for(const e of entries)if(e.isIntersecting){current.unobserve(e.target);e.target.loadThumbnail?.();}},{rootMargin:'100px'});observer=current;}
  host.loadThumbnail=enqueue;observer.observe(host);
 }
 return {observe,reset,clear};
}
