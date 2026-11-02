const endpoint='https://johnmusic.app.n8n.cloud/webhook/sma-publication-asset-preview-v1';
export async function fetchAssetThumbnail(file,token,signal,request=fetch){
 signal?.throwIfAborted();
 const response=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({asset_id:file.id,asset_revision:file.revision}),credentials:'omit',cache:'no-store',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(45000)])});
 const r=await response.json();signal?.throwIfAborted();
 if(!response.ok||r?.ok!==true||r.can_publish!==false||r.asset_id!==file.id||r.asset_revision!==file.revision||r.media_kind!==file.media_kind||!['image/jpeg','image/png','image/webp'].includes(r.mime_type)||typeof r.image_base64!=='string'||r.image_base64.length>2666668||!/^[A-Za-z0-9+/]+={0,2}$/.test(r.image_base64))throw Error('PREVIEW_UNAVAILABLE');
 const bytes=Uint8Array.from(atob(r.image_base64),c=>c.charCodeAt(0));if(bytes.length<12||bytes.length>2000000)throw Error('PREVIEW_UNAVAILABLE');
 return new Blob([bytes],{type:r.mime_type});
}
// One owner-scoped loader per view; at most three concurrent preview requests.
// Object URLs and responses live only in memory and are cleared at logout/reload.
export function createMediaThumbnailLoader(getToken){
 let generation=0,active=0,queue=[],observer=null;const cache=new Map(),urls=new Set(),controllers=new Set();
 function reset(){generation++;observer?.disconnect();observer=null;queue=[];for(const url of urls)URL.revokeObjectURL(url);urls.clear();}
 function clear(){reset();for(const c of controllers)c.abort();controllers.clear();cache.clear();}
 async function run(){
  if(active>=3||!queue.length)return;const {host,file,version}=queue.shift();active++;
  const key=file.id+':'+file.revision,controller=new AbortController();controllers.add(controller);
  try{
   let entry=cache.get(key);if(!entry||Date.now()-entry.time>60000){const token=await getToken();controller.signal.throwIfAborted();const blob=await fetchAssetThumbnail(file,token,controller.signal);controller.signal.throwIfAborted();entry={blob,time:Date.now()};cache.delete(key);cache.set(key,entry);if(cache.size>20)cache.delete(cache.keys().next().value);}
   if(version!==generation||!host.isConnected)return;
   const url=URL.createObjectURL(entry.blob);urls.add(url);const img=host.ownerDocument.createElement('img');img.alt=file.media_kind==='video'?'Videovorschau':'Bildvorschau';img.decoding='async';img.src=url;
   img.addEventListener('error',()=>{if(version!==generation)return;host.textContent=file.media_kind==='video'?'Video':'Bild';URL.revokeObjectURL(url);urls.delete(url);});host.replaceChildren(img);
  }catch{if(version===generation&&host.isConnected)host.textContent='Vorschau folgt';}
  finally{controllers.delete(controller);active--;void run();}
 }
 function observe(host,file){
  host.textContent=file.media_kind==='video'?'▶':'▧';const version=generation;
  const enqueue=()=>{queue.push({host,file,version});void run();};
  const Observer=host.ownerDocument.defaultView?.IntersectionObserver;
  if(!Observer){enqueue();return;}
  if(!observer)observer=new Observer(entries=>{for(const e of entries)if(e.isIntersecting){observer.unobserve(e.target);e.target.loadThumbnail?.();}},{rootMargin:'100px'});
  host.loadThumbnail=enqueue;observer.observe(host);
 }
 return {observe,reset,clear};
}
