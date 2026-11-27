import {editorSource,editorThumbnail} from './media-editor-api.mjs?v=16';
import {originalVideoSupported} from './original-video-preview.mjs?v=4';

export function manualVideoPreview(host,notice){
 let key=null,controller=null,urls=[];
 function clear(){
  controller?.abort();controller=null;key=null;host.replaceChildren();notice.textContent='';
  for(const url of urls)URL.revokeObjectURL(url);urls=[];
 }
 function url(blob){const path=URL.createObjectURL(blob);urls.push(path);return path;}
 async function render(file,owner,driveHref,localFile){
  const next=[owner,file.id,file.revision].join('|');if(next===key)return;
  clear();key=next;controller=new AbortController();const signal=controller.signal;
  const video=document.createElement('video');video.controls=true;video.playsInline=true;video.preload='auto';video.setAttribute('aria-label','Vorschau der ausgewählten MP4');
  const orientation=(element,width,height)=>{if(width>0&&height>0)element.toggleAttribute('data-portrait',height>width);};
  orientation(video,file.width_px,file.height_px);
  video.addEventListener('loadedmetadata',()=>orientation(video,video.videoWidth,video.videoHeight),{once:true});
  if(localFile){video.src=url(localFile);host.append(video);return;}
  if(!originalVideoSupported(file)&&driveHref){const frame=document.createElement('iframe');
   const u=new URL(driveHref);u.pathname=u.pathname.replace(/\/view$/,'/preview');frame.src=u.href;frame.title='Private Drive-Videovorschau';frame.allowFullscreen=true;orientation(frame,file.width_px,file.height_px);host.append(frame);return;}
  notice.textContent='Vorschau wird geladen …';host.append(video);
  const poster=editorThumbnail(file,signal,owner).then(blob=>{if(!signal.aborted&&blob instanceof Blob)video.poster=url(blob);}).catch(()=>{});
  try{const blob=await editorSource(file,signal,owner);if(signal.aborted)return;video.src=url(blob);notice.textContent='';}
  catch{if(!signal.aborted){await poster;if(!signal.aborted)notice.textContent='Videowiedergabe in SMA momentan nicht verfügbar.';}}
 }
 return {render,clear};
}
