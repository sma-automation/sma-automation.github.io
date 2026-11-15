// Explicit, read-only access to the exact original. No analysis or attestation.
export function originalVideoSupported(file){return file?.media_kind==='video'&&file.mime_type==='video/mp4'&&Number.isInteger(file.size_bytes)&&file.size_bytes>=12&&file.size_bytes<=24000000&&Number.isFinite(file.duration_ms)&&file.duration_ms>0&&file.duration_ms<=60000;}
export function mountOriginalVideo({doc,host,thumbnailHost,getOwnerId,expectedOwnerId,source,onReadyChange,loadedText='Originalvideo geladen. Abspielen speichert keine Prüfbestätigung oder Freigabe.',createURL=URL.createObjectURL,revokeURL=URL.revokeObjectURL}){
 const box=doc.createElement('div'),button=doc.createElement('button'),video=doc.createElement('video'),status=doc.createElement('p');
 box.id='originalVideoPreview';box.hidden=true;button.type='button';button.className='secondary';button.textContent='Originalvideo laden';
 video.controls=true;video.playsInline=true;video.preload='metadata';video.hidden=true;video.setAttribute('aria-label','Originalvideo der ausgewählten Datei');video.style.cssText='display:block;width:100%;max-height:var(--original-video-max-height,500px);object-fit:contain;background:#111827';
 status.className='note';status.setAttribute('role','status');status.setAttribute('aria-live','polite');box.append(button,video,status);host.append(box);
 let file=null,key='',generation=0,controller=null,url=null,disposed=false;
 let range=null,endTimer=null;
 function stop(){
  if(range){range=null;clearTimeout(endTimer);status.textContent=loadedText;}
  try{video.pause();}catch{}
 }
 function stopRange(){if(range)stop();}
 function checkRange(){
  if(!range)return;
  clearTimeout(endTimer);
  if(video.seeking)return;
  const {start,end}=range;
  if(video.ended||video.currentTime>=end){
   stop();
   if(video.currentTime!==end)video.currentTime=end;
   status.textContent='Ausschnitt beendet · '+start.toLocaleString('de-AT')+' bis '+end.toLocaleString('de-AT')+' Sekunden.';
   return;
  }
  if(video.currentTime<start){video.currentTime=start;return;}
  if(!video.paused&&video.readyState>=3&&video.playbackRate>0){
   const remaining=(end-video.currentTime)*1000/video.playbackRate;
   endTimer=setTimeout(checkRange,Math.max(16,remaining));
  }
 }
 for(const event of ['playing','timeupdate','seeked','ratechange','pause','ended'])video.addEventListener(event,checkRange);
 function release(){onReadyChange?.(false);stop();video.removeAttribute('src');try{video.load();}catch{}video.hidden=true;if(url)revokeURL(url);url=null;thumbnailHost.style.display='';}
 function reset(){video.removeAttribute('poster');generation++;controller?.abort();controller=null;release();button.disabled=false;button.hidden=false;status.textContent='';}
 const current=g=>!disposed&&g===generation;
 async function owner(g,read){if(!current(g))return false;if(await read(()=>getOwnerId())!==expectedOwnerId){if(current(g)){reset();file=null;key='';box.hidden=true;}return false;}return current(g);}
 button.addEventListener('click',async()=>{
  if(disposed||controller||!originalVideoSupported(file))return;
  const g=generation,selected=file,attempt=new AbortController(),signal=attempt.signal;
  controller=attempt;button.disabled=true;status.textContent='Originalvideo wird geprüft und geladen …';
  let timedOut=false;
  // Preserve the existing source allowance, shared by both owner checks and bytes.
  const deadline=setTimeout(()=>{timedOut=true;attempt.abort();},180000);
  // Auth and custom source promises may ignore abort. Consume late replies without
  // continuing a cancelled load or releasing a later attempt's controls.
  const read=start=>new Promise((resolve,reject)=>{
   let settled=false;
   const finish=(callback,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',cancel);callback(value);};
   const cancel=()=>finish(reject,Error('ORIGINAL_READ_ABORTED'));
   if(signal.aborted)return cancel();
   signal.addEventListener('abort',cancel,{once:true});
   Promise.resolve().then(()=>{signal.throwIfAborted();return start();})
    .then(value=>finish(resolve,value),error=>finish(reject,error));
  });
  try{
   if(!await owner(g,read))return;const blob=await read(()=>source(selected,signal));signal.throwIfAborted();if(!await owner(g,read))return;
   if(!(blob instanceof Blob)||blob.type!=='video/mp4'||blob.size!==selected.size_bytes)throw Error('SOURCE_UNAVAILABLE');
   release();url=createURL(blob);video.src=url;video.hidden=false;thumbnailHost.style.display='none';button.hidden=true;status.textContent=loadedText;
  }catch(e){if(current(g)&&controller===attempt&&(timedOut||!signal.aborted)){release();status.textContent=timedOut?'Das Laden des Originalvideos dauert gerade zu lange. Bitte versuche es erneut.':e?.message==='FILE_CHANGED'?'Die Datei wurde geändert. Bitte aktualisiere die Dateiliste.':'Das Originalvideo konnte nicht geladen werden. Bitte versuche es erneut.';}}
  finally{clearTimeout(deadline);if(current(g)&&controller===attempt){controller=null;button.disabled=false;}}
 });
 video.addEventListener('error',()=>{if(!url||disposed)return;release();button.hidden=false;status.textContent='Der Browser kann das Originalvideo nicht abspielen. Bitte lade es erneut.';});
 video.addEventListener('loadeddata',()=>{if(url&&!disposed&&!video.hidden)onReadyChange?.(true);});
 function seekTo(seconds){
  if(disposed||!url||video.hidden||video.readyState<2||!Number.isFinite(seconds)||seconds<0||!Number.isFinite(video.duration)||seconds>=video.duration)return false;
  try{stop();video.currentTime=seconds;return true;}catch{return false;}
 }
 function playRange(start,requestedEnd){
  const end=requestedEnd??video.duration;
  if(!Number.isFinite(end)||end<=start||end>video.duration||!seekTo(start))return false;
  const selected={start,end};range=selected;
  status.textContent='Ausschnitt wird abgespielt …';
  try{
   video.play().catch(()=>{
    if(range!==selected)return;
    stop();status.textContent='Der Ausschnitt konnte nicht abgespielt werden. Bitte versuche es erneut.';
   });
  }catch{stop();return false;}
  return true;
 }
 function invalidateOwner(id){if(id!==expectedOwnerId){reset();file=null;key='';box.hidden=true;}}
 function setPoster(selected,poster){
  if(disposed||!file||selected?.id!==file.id||selected.revision!==file.revision)return;
  if(poster)video.setAttribute('poster',poster);else video.removeAttribute('poster');
 }
 return {seekTo,playRange,stopRange,setPoster,setContext(next){const nextKey=next?JSON.stringify([next.id,next.revision,next.media_kind,next.mime_type,next.size_bytes,next.duration_ms]):'';if(disposed||nextKey===key)return;reset();file=next?{...next}:null;key=nextKey;box.hidden=!originalVideoSupported(file);},invalidateOwner,stop,destroy(){if(disposed)return;reset();disposed=true;file=null;key='';box.hidden=true;}};
}
