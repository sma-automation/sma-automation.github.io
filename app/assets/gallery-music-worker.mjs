import {sha256} from './media-export-model.mjs?v=2';
import {editorUUID} from './media-editor-model.mjs?v=3';

// No payment or publishing entry points. All uploads use the server-reserved identity.
export function createGalleryMusicWorker({rpc,source,loadTrack,render,upload,onComplete,onStatus}){
 let disposed=false,running=null,again=false,timer=null;
 const controller=new AbortController(),signal=controller.signal;
 async function call(action,input={}){
  signal.throwIfAborted();const r=await rpc(action,input,signal);signal.throwIfAborted();
  if(r?.ok!==true)throw Error(r?.code||'UNAVAILABLE');
  return r;
 }
 function later(ms){clearTimeout(timer);if(!disposed)timer=setTimeout(wake,ms);}
 async function refreshGallery(){try{await onComplete();}catch{/* The saved file also appears on the next gallery refresh. */}}
 async function drain(){
  do{
   again=false;
   const job=await call('claim');
   if(job.state==='waiting'){later(Math.max(1000,Math.min(job.retry_ms,86400000)));return;}
   if(job.state==='deferred')continue;
   if(job.state==='idle'||job.state==='busy'||job.state==='no_track'){
    later(job.state==='no_track'?900000:job.state==='busy'?60000:120000);
    if(job.state==='no_track')onStatus('Für die automatische Vertonung ist noch kein SMA-Track verfügbar.');
    return;
   }
   if(job.state==='check_upload'){onStatus('Bitte prüfe den Kundenordner. Eine Musikfassung konnte nicht eindeutig zugeordnet werden.');continue;}
   if(job.state==='completed'){await refreshGallery();continue;}
   if(job.state!=='claimed'||!editorUUID(job.id)||!editorUUID(job.lease)||!editorUUID(job.file?.id))throw Error('UNAVAILABLE');
   const bound={id:job.id,lease:job.lease};
   let reserved=false;
   try{
    onStatus('SMA prüft die Tonspur …');
    const bytes=await source(job.file,signal);signal.throwIfAborted();
    if(bytes.size!==job.file.size_bytes||bytes.type!=='video/mp4')throw Error('SOURCE_CHANGED');
    const result=await render({source:bytes,track:job.track,loadTrack,signal});signal.throwIfAborted();
    if(['audio_present','unsupported'].includes(result.state)){
     await call(result.state,bound);
     onStatus(result.state==='audio_present'?'Die vorhandene Tonspur bleibt erhalten.':'Dieses Video kann SMA derzeit nicht automatisch vertonen.');
     continue;
    }
    if(result.state!=='rendered'||result.blob?.type!=='video/mp4')throw Error('RENDER_FAILED');
    await call('reserve',{...bound,sha256:await sha256(await result.blob.arrayBuffer()),size_bytes:result.blob.size});
    reserved=true;
    onStatus('Musikfassung wird im Kundenordner gespeichert …');
    const asset=await upload(result.blob,{upload_id:job.id,name:job.name,mime_type:'video/mp4'},signal);
    const saved=await call('complete',bound);
    if(saved.asset_id!==asset)throw Error('UPLOAD_INCOMPLETE');
    onStatus('Musikfassung gespeichert · '+job.track.name);await refreshGallery();
   }catch(e){
    if(signal.aborted)throw e;
    if(reserved){
     // Drive can have committed the bytes even when the client missed the reply.
     const receipt=await call('complete',bound).catch(()=>null);
     if(receipt?.state==='completed'&&editorUUID(receipt.asset_id)){
      onStatus('Musikfassung gespeichert · '+job.track.name);await refreshGallery();continue;
     }
    }
    if(signal.aborted)throw e;
    await call('retry',bound).catch(()=>{});
    onStatus('Die Vertonung wird später erneut versucht.');
    // Continue to other eligible videos, leaving this one in backoff.
   }
  }while(!disposed);
 }
 function wake(){
  if(disposed)return;
  if(running){again=true;return running;}
  running=drain().catch(()=>{if(!disposed){onStatus('Automatische Vertonung ist gerade nicht erreichbar.');later(125000);}})
   .finally(()=>{running=null;if(again&&!disposed)wake();});
  return running;
 }
 return {wake,destroy(){disposed=true;clearTimeout(timer);controller.abort();}};
}

export function mountGalleryMusic({owner,onComplete,onStatus}){
 const api=()=>import('./media-editor-api.mjs?v=6');
 return createGalleryMusicWorker({
  rpc:async(action,input,signal)=>(await api()).galleryMusicRequest(action,input,owner,signal),
  source:async(file,signal)=>(await api()).editorSource(file,signal,owner),
  loadTrack:async(track,signal)=>(await api()).editorMusicLibrary(owner).catalog.source(track,signal),
  render:async input=>(await import('./gallery-music-render.mjs?v=1')).renderSoundtrack(input),
  upload:async(blob,artifact,signal)=>(await api()).uploadExport(blob,artifact,signal,owner),onComplete,onStatus
 });
}
