// Read-only playback. The editor always reads the separately verified original.
import {editorSource} from './media-editor-api.mjs?v=16';

const chunkSize=262144;
export function portalVideo(file){return file?.media_kind==='video';}

export function createPortalVideoSource({client,owner,original=editorSource}){
 let recent=null;
 async function read(file,portal,signal){
  signal.throwIfAborted();
  const db=client(),expected=owner();
  const checkOwner=async()=>{
   const {data,error}=await db.auth.getSession();
   signal.throwIfAborted();
   if(error||!expected||data.session?.user.id!==expected||expected!==owner())throw Error('AUTH_REQUIRED');
  };
  await checkOwner();
  const part=async index=>{
   const {data,error}=await db.rpc('sma_portal_playback_v1',{p_asset:file.id,p_revision:file.revision,p_portal:portal,p_part:index}).abortSignal(signal);
   if(error)throw error;
   signal.throwIfAborted();
   return data;
  };
  const manifest=await part(null);
  if(!manifest)return original(file,signal,expected);
  const {sha,size,parts}=manifest;
  if(!/^[0-9a-f]{64}$/.test(sha)||!Number.isSafeInteger(size)||size<1||size>33554432||parts!==Math.ceil(size/chunkSize))throw Error('PREVIEW_INVALID');
  const key=[expected,portal,file.id,file.revision,sha].join('|');
  if(recent?.key===key){await checkOwner();return recent.blob;}
  const bytes=new Uint8Array(size);
  for(let first=0;first<parts;first+=4){
   await Promise.all(Array.from({length:Math.min(4,parts-first)},async(_,offset)=>{
    const index=first+offset,data=await part(index);
    if(typeof data!=='string')throw Error('PREVIEW_INCOMPLETE');
    const raw=atob(data),start=index*chunkSize;
    if(raw.length!==Math.min(chunkSize,size-start))throw Error('PREVIEW_INCOMPLETE');
    for(let i=0;i<raw.length;i++)bytes[start+i]=raw.charCodeAt(i);
   }));
  }
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  if(Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('')!==sha)throw Error('PREVIEW_INVALID');
  await checkOwner();
  const blob=new Blob([bytes],{type:'video/mp4'});recent={key,blob};return blob;
 }
 return {read,clear(){recent=null;}};
}

export function createHoverPlayback(doc,source){
 let active=null;
 function stop(){
  if(!active)return;
  const {controller,video,url}=active;active=null;controller.abort();
  video.pause();video.removeAttribute('src');video.load();video.remove();
  if(url)URL.revokeObjectURL(url);
 }
 function attach(button,visual,file,portal){
  if(!portalVideo(file))return;
  // Thumbnail loaders replace their host's children, so keep the video in its own layer.
  const stage=doc.createElement('span');stage.style.cssText='display:block;position:relative;overflow:hidden';
  visual.replaceWith(stage);stage.append(visual);
  button.addEventListener('pointerenter',async event=>{
   if(event.pointerType==='touch'||button.disabled)return;
   stop();
   const video=doc.createElement('video'),controller=new AbortController();
   video.muted=true;video.defaultMuted=true;video.playsInline=true;video.loop=true;video.setAttribute('aria-hidden','true');
   video.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#111;pointer-events:none;opacity:0';
   const entry={video,controller,url:null,button};active=entry;stage.append(video);
   try{
    const blob=await source.read(file,portal,controller.signal);
    if(active!==entry||!button.isConnected)return;
    entry.url=URL.createObjectURL(blob);video.src=entry.url;
    await video.play();if(active===entry)video.style.opacity='1';
   }catch{if(active===entry)stop();}
  });
  const leave=()=>{if(active?.button===button)stop();};
  button.addEventListener('pointerleave',leave);button.addEventListener('click',leave);
 }
 const visibility=()=>{if(doc.hidden)stop();};
 doc.addEventListener('visibilitychange',visibility);
 doc.defaultView?.addEventListener('pagehide',stop);
 return {attach,stop,destroy(){stop();source.clear();doc.removeEventListener('visibilitychange',visibility);doc.defaultView?.removeEventListener('pagehide',stop);}};
}
