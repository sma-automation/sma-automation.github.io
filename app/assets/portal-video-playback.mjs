// Only the selected file is downloaded. The editor still reads the independently verified original.
import {editorSource} from './media-editor-api.mjs?v=16';

const chunkSize=262144, batchSize=4, cacheMs=60000;
export function portalVideo(file){return file?.media_kind==='video';}

export function createPortalVideoSource({client,owner,original=editorSource}){
 const entries=new Map();
 const drop=entry=>{
  clearTimeout(entry.cancelTimer);
  entry.controller.abort();
  if(entries.get(entry.key)===entry)entries.delete(entry.key);
 };
 async function checkOwner(expected,signal){
  signal.throwIfAborted();
  const {data,error}=await client().auth.getSession();
  signal.throwIfAborted();
  if(error||!expected||data.session?.user?.id!==expected||owner()!==expected)throw Error('AUTH_REQUIRED');
 }
 async function download(file,portal,expected,signal){
  const batch=async first=>{
   const {data,error}=await client().rpc('sma_portal_playback_batch_v1',{
    p_asset:file.id,p_revision:file.revision,p_portal:portal,p_first:first
   }).abortSignal(signal);
   signal.throwIfAborted();
   if(error)throw error;
   return data;
  };
  const first=await batch(0);
  if(first===null)return original(file,signal,expected);
  const {size,parts,sha}=first;
  if(!Number.isSafeInteger(size)||size<1||size>33554432||parts!==Math.ceil(size/chunkSize)||!/^[a-f0-9]{64}$/.test(sha))throw Error('PREVIEW_INVALID');
  const bytes=new Uint8Array(size);
  function append(data,start){
   if(!data||data.first!==start||data.sha!==sha||data.size!==size||!Array.isArray(data.chunks)||data.chunks.length!==Math.min(batchSize,parts-start))throw Error('PREVIEW_INCOMPLETE');
   for(const [offset,encoded] of data.chunks.entries()){
    const index=(start+offset)*chunkSize;
    if(typeof encoded!=='string')throw Error('PREVIEW_INCOMPLETE');
    const raw=atob(encoded);
    if(raw.length!==Math.min(chunkSize,size-index))throw Error('PREVIEW_INCOMPLETE');
    for(let i=0;i<raw.length;i++)bytes[index+i]=raw.charCodeAt(i);
   }
  }
  append(first,0);
  for(let start=batchSize;start<parts;start+=batchSize*2){
   const offsets=[start,start+batchSize].filter(offset=>offset<parts);
   await Promise.all(offsets.map(async offset=>append(await batch(offset),offset)));
  }
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  if(Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('')!==sha)throw Error('PREVIEW_INVALID');
  return new Blob([bytes],{type:'video/mp4'});
 }
 async function read(file,portal,signal){
  const expected=owner();
  await checkOwner(expected,signal);
  const key=JSON.stringify([expected,portal,file.id,file.revision]);
  for(const item of entries.values())if(item.expires&&item.expires<Date.now())drop(item);
  let entry=entries.get(key);
  if(!entry){
   entry={key,controller:new AbortController(),users:0,expires:0,cancelTimer:null};
   entries.set(key,entry);
   const deadline=setTimeout(()=>entry.controller.abort(),45000);
   entry.result=download(file,portal,expected,entry.controller.signal).then(async blob=>{
    await checkOwner(expected,entry.controller.signal);
    entry.expires=Date.now()+cacheMs;
    const complete=[...entries.values()].filter(e=>e.expires).sort((a,b)=>a.expires-b.expires);
    while(complete.length>2)drop(complete.shift());
    return blob;
   }).catch(error=>{drop(entry);throw error;}).finally(()=>clearTimeout(deadline));
  }
  clearTimeout(entry.cancelTimer);
  entry.users++;
  // A click immediately after hover adopts the same in-flight transfer.
  return new Promise((resolve,reject)=>{
   let finished=false;
   function settle(callback,value){
    if(finished)return;
    finished=true;signal.removeEventListener('abort',abort);entry.users--;
    if(!entry.users&&!entry.expires)entry.cancelTimer=setTimeout(()=>{if(!entry.users&&!entry.expires)drop(entry);},350);
    callback(value);
   }
   const abort=()=>settle(reject,new DOMException('Cancelled','AbortError'));
   signal.addEventListener('abort',abort,{once:true});
   entry.result.then(blob=>{
    if(expected!==owner())settle(reject,Error('AUTH_REQUIRED'));
    else settle(resolve,blob);
   },error=>settle(reject,error));
   if(signal.aborted)abort();
  });
 }
 const intros=new Map();
 async function intro(file,portal,signal){
  const expected=owner(),key=JSON.stringify([expected,portal,file.id,file.revision]);
  await checkOwner(expected,signal);
  const full=entries.get(key);
  if(full?.expires>Date.now())return null;
  const cached=intros.get(key);
  if(cached&&cached.expires>Date.now())return cached.blob;
  const {data,error}=await client().rpc('sma_portal_hover_intro_v1',{
   p_asset:file.id,p_revision:file.revision,p_portal:portal
  }).abortSignal(signal);
  signal.throwIfAborted();
  if(error||typeof data!=='string'||!data.length||data.length>175000)return null;
  await checkOwner(expected,signal);
  const blob=new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'video/mp4'});
  if(intros.size>=8)intros.delete(intros.keys().next().value);
  intros.set(key,{blob,expires:Date.now()+cacheMs});
  return blob;
 }
 return {read,intro,clear(){intros.clear();for(const entry of entries.values())drop(entry);}};
}

export function createHoverPlayback(doc,source){
 let active=null;
 function stop(){
  if(!active)return;
  const {controller,video,url,feedback,button}=active;active=null;controller.abort();
  button.removeAttribute('aria-busy');feedback.remove();video.pause();video.removeAttribute('src');video.load();video.remove();
  if(url)URL.revokeObjectURL(url);
 }
 function attach(button,visual,file,portal){
  if(!portalVideo(file))return;
  const stage=doc.createElement('span');stage.style.cssText='display:block;position:relative;overflow:hidden';
  visual.replaceWith(stage);stage.append(visual);
  async function start(event){
   if(event.pointerType==='touch'||button.disabled||active?.button===button)return;
   stop();
   const video=doc.createElement('video'),controller=new AbortController(),feedback=doc.createElement('span');
   video.muted=true;video.defaultMuted=true;video.playsInline=true;video.loop=true;video.setAttribute('aria-hidden','true');
   video.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#111;pointer-events:none;opacity:0';
   feedback.className='sma-playback-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-label','Video wird geladen');
   button.setAttribute('aria-busy','true');
   const entry={video,controller,feedback,url:null,button};active=entry;stage.append(video,feedback);
   try{
    async function play(blob,at=0){
     if(active!==entry||!button.isConnected)return;
     const old=entry.url;
     entry.url=URL.createObjectURL(blob);video.src=entry.url;
     if(old)URL.revokeObjectURL(old);
     if(at>0)video.currentTime=at;
     await video.play();
     if(active===entry){video.style.opacity='1';feedback.remove();button.removeAttribute('aria-busy');}
    }
    const intro=await source.intro(file,portal,controller.signal);
    if(intro){
     video.loop=false;await play(intro);
     if(active!==entry)return;
     video.addEventListener('ended',()=>{if(active===entry&&!video.loop){stage.append(feedback);button.setAttribute('aria-busy','true');}},{once:true});
     // Passing rapidly over the gallery only requests the small starts.
     await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(active!==entry)return;
    const blob=await source.read(file,portal,controller.signal);
    if(active!==entry)return;
    video.loop=true;await play(blob,intro?video.currentTime:0);
   }catch{
    if(active===entry){
     button.removeAttribute('aria-busy');feedback.removeAttribute('aria-label');feedback.classList.add('error');stage.append(feedback);
     feedback.textContent='Video konnte nicht geladen werden. Zum erneuten Laden klicken.';
    }
   }
  }
  const leave=()=>{if(active?.button===button)stop();};
  button.addEventListener('pointerenter',start);button.addEventListener('pointermove',start);button.addEventListener('pointerleave',leave);button.addEventListener('click',leave);
 }
 const visibility=()=>{if(doc.hidden)stop();};
 doc.addEventListener('visibilitychange',visibility);doc.defaultView?.addEventListener('pagehide',stop);
 return {attach,stop,destroy(){stop();source.clear();doc.removeEventListener('visibilitychange',visibility);doc.defaultView?.removeEventListener('pagehide',stop);}};
}
