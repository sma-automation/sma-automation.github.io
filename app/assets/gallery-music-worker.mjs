import {sha256} from './media-export-model.mjs?v=2';
import {editorUUID} from './media-editor-model.mjs?v=3';

// The server-scheduled soundtrack path handles work while the browser is closed.
// Avoid repeatedly claiming an idle queue in a background browser tab.
// Repeated no-progress claims must never spin against the production database.
// More work can be picked up by the existing foreground timer or server worker.
const MAX_IMMEDIATE_CLAIMS=8, CLAIM_BURST_BACKOFF_MS=300000;
const browserVisible=()=>!globalThis.document?.hidden;
function observeVisibility(handler){
 const doc=globalThis.document;
 doc?.addEventListener?.('visibilitychange',handler);
 return ()=>doc?.removeEventListener?.('visibilitychange',handler);
}
// No payment or publishing entry points. All uploads use the server-reserved identity.
export function createGalleryMusicWorker({rpc,source,loadTrack,render,upload,onComplete,onStatus,
  isVisible=browserVisible,subscribeVisibility=observeVisibility,
  setTimer=setTimeout,cancelTimer=clearTimeout}){
 let disposed=false,running=null,again=false,timer=null,transientStatus=false,pendingGalleryRefresh=false;
 const controller=new AbortController(),signal=controller.signal;
 // Queue notices expire when the server reports idle; saved results and review warnings do not.
 function report(text,transient=false){
  if(disposed)return;
  transientStatus=transient;onStatus(text);
 }
 async function call(action,input={}){
  signal.throwIfAborted();const r=await rpc(action,input,signal);signal.throwIfAborted();
  if(r?.ok!==true)throw Error(r?.code||'UNAVAILABLE');
  return r;
 }
 function foreground(){
  try{return isVisible()===true;}catch{return false;}
 }
 function clearScheduled(){if(timer!==null){cancelTimer(timer);timer=null;}}
 function later(ms){
  clearScheduled();
  if(!disposed&&foreground())timer=setTimer(()=>{timer=null;wake();},ms);
 }
 async function refreshGallery(){
  // A completed upload still has its receipt while the customer is elsewhere.
  // Do not start a hidden file-catalogue read; refresh once on return.
  if(!foreground()){pendingGalleryRefresh=true;return;}
  pendingGalleryRefresh=false;
  try{await onComplete();}catch{/* The saved file also appears on the next gallery refresh. */}
 }
 async function drain(){
  let immediateClaims=0;
  do{
   again=false;
   // A claimed job continues to its existing receipt; no *next* claim starts
   // while the page is hidden. This does not disable the background n8n worker.
   if(!foreground())return;
   if(pendingGalleryRefresh)await refreshGallery();
   if(!foreground())return;
   if(immediateClaims>=MAX_IMMEDIATE_CLAIMS){
    // Prevent an endless rapid loop if the server keeps reporting deferred,
    // check_upload, completed or another non-idle response. Do not alter any
    // existing lease, upload or receipt; the server worker remains independent.
    again=false;
    if(!transientStatus)report('Die automatische Vertonung wird später erneut geprüft.',true);
    later(CLAIM_BURST_BACKOFF_MS);
    return;
   }
   immediateClaims++;
   const job=await call('claim');
   if(job.state==='waiting'){report('Die automatische Vertonung wartet. Der Status wird später erneut geprüft.',true);later(Math.max(1000,Math.min(job.retry_ms,86400000)));return;}
   if(job.state==='deferred')continue;
   if(job.state==='idle'||job.state==='busy'||job.state==='no_track'){
    later(job.state==='no_track'?900000:job.state==='busy'?60000:120000);
    if(job.state==='no_track')report('Für die automatische Vertonung ist noch kein SMA-Track verfügbar.',true);
    else if(job.state==='busy')report('Die automatische Vertonung wartet auf einen laufenden Auftrag. Der Status wird erneut geprüft.',true);
    else if(transientStatus)report('');
    return;
   }
   if(job.state==='check_upload'){report('Bitte prüfe den Kundenordner. Eine Musikfassung konnte nicht eindeutig zugeordnet werden.');continue;}
   if(job.state==='completed'){report('Eine gespeicherte Musikfassung wurde zugeordnet.');await refreshGallery();continue;}
   if(job.state!=='claimed'||!editorUUID(job.id)||!editorUUID(job.lease)||!editorUUID(job.file?.id))throw Error('UNAVAILABLE');
   const bound={id:job.id,lease:job.lease};
   let reserved=false;
   try{
    report('SMA prüft die Tonspur …');
    const bytes=await source(job.file,signal);signal.throwIfAborted();
    if(bytes.size!==job.file.size_bytes||bytes.type!=='video/mp4')throw Error('SOURCE_CHANGED');
    const result=await render({source:bytes,track:job.track,loadTrack,signal});signal.throwIfAborted();
    if(['audio_present','unsupported'].includes(result.state)){
     await call(result.state,bound);
     report(result.state==='audio_present'?'Die vorhandene Tonspur bleibt erhalten.':'Dieses Video kann SMA derzeit nicht automatisch vertonen.');
     continue;
    }
    if(result.state!=='rendered'||result.blob?.type!=='video/mp4')throw Error('RENDER_FAILED');
    await call('reserve',{...bound,sha256:await sha256(await result.blob.arrayBuffer()),size_bytes:result.blob.size});
    reserved=true;
    report('Musikfassung wird im Kundenordner gespeichert …');
    const asset=await upload(result.blob,{upload_id:job.id,name:job.name,mime_type:'video/mp4'},signal);
    const saved=await call('complete',bound);
    if(saved.asset_id!==asset)throw Error('UPLOAD_INCOMPLETE');
    report('Musikfassung gespeichert · '+job.track.name);await refreshGallery();
   }catch(e){
    if(signal.aborted)throw e;
    if(reserved){
     // Drive can have committed the bytes even when the client missed the reply.
     const receipt=await call('complete',bound).catch(()=>null);
     if(receipt?.state==='completed'&&editorUUID(receipt.asset_id)){
      report('Musikfassung gespeichert · '+job.track.name);await refreshGallery();continue;
     }
    }
    if(signal.aborted)throw e;
    await call('retry',bound).catch(()=>{});
    report('Die Vertonung wird später erneut versucht.',true);
    // Continue to other eligible videos, leaving this one in backoff.
   }
  }while(!disposed);
 }
 function wake(){
  if(disposed)return;
  if(!foreground()){clearScheduled();return running;}
  if(running){again=true;return running;}
  running=drain().catch(()=>{if(!disposed){report('Automatische Vertonung ist gerade nicht erreichbar.',true);later(125000);}})
   .finally(()=>{running=null;if(again&&!disposed)wake();});
  return running;
 }
 const unsubscribe=subscribeVisibility(()=>{
  if(disposed)return;
  if(!foreground()){clearScheduled();return;}
  if(running)again=true;
  else wake();
 });
 return {wake,destroy(){
  disposed=true;clearScheduled();controller.abort();
  if(typeof unsubscribe==='function')unsubscribe();
 }};
}

export function mountGalleryMusic({owner,onComplete,onStatus,isVisible,subscribeVisibility}){
 const api=()=>import('./media-editor-api.mjs?v=13');
 return createGalleryMusicWorker({
  rpc:async(action,input,signal)=>(await api()).galleryMusicRequest(action,input,owner,signal),
  source:async(file,signal)=>(await api()).editorSource(file,signal,owner),
  loadTrack:async(track,signal)=>(await api()).editorMusicLibrary(owner).catalog.source(track,signal),
  render:async input=>(await import('./gallery-music-render.mjs?v=1')).renderSoundtrack(input),
  upload:async(blob,artifact,signal)=>(await api()).uploadExport(blob,artifact,signal,owner),
  onComplete,onStatus,isVisible,subscribeVisibility
 });
}
