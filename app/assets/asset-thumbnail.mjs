import {customerMediaEndpoint} from './customer-media-routes.mjs?v=1';

// One deadline covers even non-abortable auth, transport and response-body reads.
// Late replies are consumed, never allowed to resume a cancelled view.
function thumbnailReadScope(parent){
 const controller=new AbortController();
 const signal=AbortSignal.any([controller.signal,...(parent?[parent]:[]),AbortSignal.timeout(45000)]);
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
export async function fetchAssetThumbnail(file,token,signal,request=fetch){
 signal?.throwIfAborted();
 const scope=thumbnailReadScope(signal);
 try{
  const response=await scope.read(()=>request(customerMediaEndpoint('thumbnail'),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({asset_id:file.id,asset_revision:file.revision}),credentials:'omit',redirect:'error',cache:'no-store',signal:scope.signal}));
  const r=await scope.read(()=>response.json());scope.signal.throwIfAborted();
  if(!response.ok||r?.ok!==true||r.can_publish!==false||r.asset_id!==file.id||r.asset_revision!==file.revision||r.media_kind!==file.media_kind||!['image/jpeg','image/png','image/webp'].includes(r.mime_type)||typeof r.image_base64!=='string'||r.image_base64.length>2666668||!/^[A-Za-z0-9+/]+={0,2}$/.test(r.image_base64))throw Error('PREVIEW_UNAVAILABLE');
  const bytes=Uint8Array.from(atob(r.image_base64),c=>c.charCodeAt(0));if(bytes.length<12||bytes.length>2000000)throw Error('PREVIEW_UNAVAILABLE');
  return new Blob([bytes],{type:r.mime_type});
 }finally{scope.close();}
}
// One owner-scoped loader per view; at most three concurrent preview requests.
// Object URLs and responses live only in memory and are cleared at logout/reload.
export function createMediaThumbnailLoader(getToken){
 let generation=0,active=0,queue=[],observer=null;const cache=new Map(),urls=new Set(),controllers=new Set();
 function reset(){generation++;observer?.disconnect();observer=null;queue=[];for(const c of controllers)c.abort();for(const url of urls)URL.revokeObjectURL(url);urls.clear();}
 function clear(){reset();cache.clear();}
 async function run(){
  if(active>=3||!queue.length)return;const {host,file,version}=queue.shift();active++;
  const key=file.id+':'+file.revision,scope=thumbnailReadScope(),{controller}=scope;controllers.add(controller);
  try{
   let entry=cache.get(key);if(!entry||Date.now()-entry.time>60000){const token=await scope.read(getToken);const blob=await scope.read(()=>fetchAssetThumbnail(file,token,scope.signal));scope.signal.throwIfAborted();if(version!==generation||!host.isConnected)return;entry={blob,time:Date.now()};cache.delete(key);cache.set(key,entry);if(cache.size>20)cache.delete(cache.keys().next().value);}
   if(version!==generation||!host.isConnected)return;
   const url=URL.createObjectURL(entry.blob);urls.add(url);const img=host.ownerDocument.createElement('img');img.alt=file.media_kind==='video'?'Videovorschau':'Bildvorschau';img.decoding='async';img.src=url;
   img.addEventListener('error',()=>{if(version!==generation)return;host.textContent=file.media_kind==='video'?'Video':'Bild';URL.revokeObjectURL(url);urls.delete(url);});host.replaceChildren(img);
  }catch{if(version===generation&&host.isConnected)host.textContent='Vorschau folgt';}
  finally{scope.close();controllers.delete(controller);active--;void run();}
 }
 function observe(host,file){
  host.textContent=file.media_kind==='video'?'▶':'▧';const version=generation;
  const enqueue=()=>{if(version!==generation||!host.isConnected)return;queue.push({host,file,version});void run();};
  const Observer=host.ownerDocument.defaultView?.IntersectionObserver;
  if(!Observer){enqueue();return;}
  if(!observer){const current=new Observer(entries=>{if(observer!==current)return;for(const e of entries)if(e.isIntersecting){current.unobserve(e.target);e.target.loadThumbnail?.();}},{rootMargin:'100px'});observer=current;}
  host.loadThumbnail=enqueue;observer.observe(host);
 }
 return {observe,reset,clear};
}
