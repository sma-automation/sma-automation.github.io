// Explicit, read-only access to the exact original. No analysis or attestation.
export function originalVideoSupported(file){return file?.media_kind==='video'&&file.mime_type==='video/mp4'&&Number.isInteger(file.size_bytes)&&file.size_bytes>=12&&file.size_bytes<=24000000&&Number.isFinite(file.duration_ms)&&file.duration_ms>0&&file.duration_ms<=60000;}
export function mountOriginalVideo({doc,host,thumbnailHost,getOwnerId,expectedOwnerId,source,createURL=URL.createObjectURL,revokeURL=URL.revokeObjectURL}){
 const box=doc.createElement('div'),button=doc.createElement('button'),video=doc.createElement('video'),status=doc.createElement('p');
 box.id='originalVideoPreview';box.hidden=true;button.type='button';button.className='secondary';button.textContent='Originalvideo laden';
 video.controls=true;video.playsInline=true;video.preload='metadata';video.hidden=true;video.setAttribute('aria-label','Originalvideo der ausgewählten Datei');video.style.cssText='display:block;width:100%;max-height:var(--original-video-max-height,500px);object-fit:contain;background:#111827';
 status.className='note';status.setAttribute('role','status');status.setAttribute('aria-live','polite');box.append(button,video,status);host.append(box);
 let file=null,key='',generation=0,controller=null,url=null,disposed=false;
 const stop=()=>{try{video.pause();}catch{}};
 function release(){stop();video.removeAttribute('src');try{video.load();}catch{}video.hidden=true;if(url)revokeURL(url);url=null;thumbnailHost.style.display='';}
 function reset(){generation++;controller?.abort();controller=null;release();button.disabled=false;button.hidden=false;status.textContent='';}
 const current=g=>!disposed&&g===generation;
 async function owner(g){if(!current(g))return false;if(await getOwnerId()!==expectedOwnerId){if(current(g)){reset();file=null;key='';box.hidden=true;}return false;}return current(g);}
 button.addEventListener('click',async()=>{
  if(disposed||controller||!originalVideoSupported(file))return;const g=generation,selected=file;controller=new AbortController();const signal=controller.signal;button.disabled=true;status.textContent='Originalvideo wird geprüft und geladen …';
  try{
   if(!await owner(g))return;const blob=await source(selected,signal);signal.throwIfAborted();if(!await owner(g))return;
   if(!(blob instanceof Blob)||blob.type!=='video/mp4'||blob.size!==selected.size_bytes)throw Error('SOURCE_UNAVAILABLE');
   release();url=createURL(blob);video.src=url;video.hidden=false;thumbnailHost.style.display='none';button.hidden=true;status.textContent='Originalvideo geladen. Abspielen speichert keine Prüfbestätigung oder Freigabe.';
  }catch(e){if(current(g)&&!signal.aborted){release();status.textContent=e.message==='FILE_CHANGED'?'Die Datei wurde geändert. Bitte aktualisiere die Dateiliste.':'Das Originalvideo konnte nicht geladen werden. Bitte versuche es erneut.';}}
  finally{if(current(g)){controller=null;button.disabled=false;}}
 });
 video.addEventListener('error',()=>{if(!url||disposed)return;release();button.hidden=false;status.textContent='Der Browser kann das Originalvideo nicht abspielen. Bitte lade es erneut.';});
 function invalidateOwner(id){if(id!==expectedOwnerId){reset();file=null;key='';box.hidden=true;}}
 return {setContext(next){const nextKey=next?JSON.stringify([next.id,next.revision,next.media_kind,next.mime_type,next.size_bytes,next.duration_ms]):'';if(disposed||nextKey===key)return;reset();file=next?{...next}:null;key=nextKey;box.hidden=!originalVideoSupported(file);},invalidateOwner,stop,destroy(){if(disposed)return;reset();disposed=true;file=null;key='';box.hidden=true;}};
}
