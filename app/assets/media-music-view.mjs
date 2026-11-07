import {mountMusicLibrary,musicLibraryMessages} from './music-library-view.mjs?v=2';
import {inspectMusic,readMusicSetting,verifyMusicBytes} from './media-music-model.mjs?v=1';
export function mountMediaMusic({doc,onChange,setBusy,createURL=URL.createObjectURL,revokeURL=URL.revokeObjectURL,library=null}){
 const $=id=>doc.getElementById(id);let setting=null,blob=null,url=null,key='',video=false,epoch=0,disposed=false,restoreController=null,restoring=null,libraryView=null,savingLibrary=false;
 function clearBlob(){restoreController?.abort();restoreController=null;restoring=null;try{$('musicPlayer').pause();$('musicPlayer').removeAttribute('src');$('musicPlayer').load();}catch{}if(url)revokeURL(url);url=null;blob=null;$('musicFile').value='';$('musicPlayer').hidden=true;}
 function paint(){
  $('musicFile').disabled=!video;$('musicRemove').disabled=!video||!setting;$('musicVolume').disabled=!video||!setting;$('musicStart').disabled=!video||!setting;
  $('musicVolume').value=String(setting?.volume??25);$('musicStart').value=String((setting?.start_ms??0)/1000);$('musicVolumeValue').textContent=(setting?.volume??25)+' %';
  if($('musicSaveLibrary'))$('musicSaveLibrary').disabled=!video||!blob||!library;
  if($('musicLibraryPanel'))$('musicLibraryPanel').hidden=!video||!library;
  $('musicStatus').textContent=!video?'Zusätzliche Musik ist für Videos verfügbar.':setting?setting.name+(blob?' · bereit':' · bitte dieselbe Musikdatei erneut auswählen'):'Noch keine zusätzliche Musik ausgewählt.';
 }
 function accept(found,bytes){const same=setting&&found.sha256===setting.sha256&&found.size_bytes===setting.size_bytes&&found.mime_type===setting.mime_type;clearBlob();blob=bytes;setting=same?setting:readMusicSetting(Object.fromEntries(['name','sha256','size_bytes','mime_type','volume','start_ms'].map(k=>[k,k==='volume'?25:k==='start_ms'?0:found[k]])));url=createURL(blob);$('musicPlayer').src=url;$('musicPlayer').hidden=false;paint();if(!same)onChange();}
 async function restore(m){if(!library||blob)return;const e=epoch,selectedKey=key,controller=new AbortController();restoreController=controller;$('musicStatus').textContent='Gespeicherte Musik wird geladen …';
  try{const bytes=await library.source(m,controller.signal);if(disposed||e!==epoch||key!==selectedKey||controller.signal.aborted)return;await verifyMusicBytes(bytes,m);if(disposed||e!==epoch||controller.signal.aborted)return;blob=bytes;url=createURL(blob);$('musicPlayer').src=url;$('musicPlayer').hidden=false;paint();}
  catch(error){if(!disposed&&e===epoch&&!controller.signal.aborted){paint();$('musicStatus').textContent=(musicLibraryMessages[error.message]||'Die gespeicherte Musik konnte nicht geladen werden.')+' Du kannst dieselbe Datei erneut auswählen.';}}
  finally{if(restoreController===controller){restoreController=null;restoring=null;}}
 }
 function waitForMusic(pending,controller,signal,e){
  if(!signal)return pending;
  return new Promise((resolve,reject)=>{
   const stop=()=>{
    if(!disposed&&e===epoch&&restoreController===controller){
     restoreController=null;restoring=null;controller?.abort();paint();
     $('musicStatus').textContent='Laden der Musik abgebrochen. Beim nächsten Export wird es erneut versucht.';
    }
    signal.removeEventListener('abort',stop);reject(signal.reason);
   };
   signal.addEventListener('abort',stop,{once:true});
   if(signal.aborted)stop();
   pending.then(value=>{signal.removeEventListener('abort',stop);resolve(value);},error=>{signal.removeEventListener('abort',stop);reject(error);});
  });
 }
 async function getSource(m,signal){
  signal?.throwIfAborted();const e=epoch;
  if(disposed)throw new DOMException('Music view closed','AbortError');
  if(!blob&&library){if(!restoring)restoring=restore(m);await waitForMusic(restoring,restoreController,signal,e);}
  signal?.throwIfAborted();
  if(disposed||e!==epoch)throw new DOMException('Music selection changed','AbortError');
  const bytes=await verifyMusicBytes(blob,m);signal?.throwIfAborted();
  if(disposed||e!==epoch)throw new DOMException('Music selection changed','AbortError');
  return bytes;
 }
 async function saveLibrary(){if(!blob||!setting||!library||disposed||savingLibrary)return;savingLibrary=true;const e=epoch,controller=new AbortController(),bytes=blob,m=setting;restoreController=controller;setBusy(true);$('musicStatus').textContent='Musik wird dauerhaft gespeichert …';try{await library.upload(new File([bytes],m.name,{type:m.mime_type}),controller.signal);if(disposed||e!==epoch||controller.signal.aborted)return;$('musicStatus').textContent=m.name+' · in deiner Bibliothek gespeichert';void libraryView?.refresh();}catch(error){if(!disposed&&e===epoch&&!controller.signal.aborted)$('musicStatus').textContent=musicLibraryMessages[error.message]||musicLibraryMessages.MUSIC_UNAVAILABLE;}finally{savingLibrary=false;if(restoreController===controller)restoreController=null;if(!disposed&&e===epoch)setBusy(false);}}
 if(library){libraryView=mountMusicLibrary({doc,host:$('musicLibraryHost'),api:library,selectionKey:()=>video?key:null,onSelect:async(t,b)=>{if(!disposed&&video){epoch++;accept(t,b);}},createURL,revokeURL});$('musicSaveLibrary').addEventListener('click',saveLibrary);}
 async function choose(){const file=$('musicFile').files?.[0];if(!file||!video||disposed)return;const e=++epoch;setBusy(true);$('musicStatus').textContent='Musikdatei wird geprüft …';
  try{const found=await inspectMusic(file);if(disposed||e!==epoch)return;const same=setting&&found.sha256===setting.sha256&&found.size_bytes===setting.size_bytes&&found.mime_type===setting.mime_type;clearBlob();blob=file;setting=same?setting:found;url=createURL(file);$('musicPlayer').src=url;$('musicPlayer').hidden=false;paint();if(!same)onChange();}
  catch{if(!disposed&&e===epoch){$('musicFile').value='';$('musicStatus').textContent='Bitte eine MP3- oder WAV-Datei bis 8 MB wählen. Beim Export sind höchstens 10 Minuten und zwei Tonkanäle möglich.';}}
  finally{if(!disposed&&e===epoch)setBusy(false);}
 }
 function edit(){if(!setting||disposed)return;const volume=Number($('musicVolume').value),start_ms=Math.round(Number($('musicStart').value)*1000);setting={...setting,volume,start_ms};$('musicVolumeValue').textContent=volume+' %';onChange();}
 function remove(){if(!setting||disposed)return;epoch++;clearBlob();setting=null;paint();onChange();}
 $('musicFile').addEventListener('change',choose);$('musicVolume').addEventListener('input',edit);$('musicStart').addEventListener('input',edit);$('musicRemove').addEventListener('click',remove);
 return {setContext(file,m){const next=file?file.id+':'+file.revision:'';if(next!==key||m?.sha256!==setting?.sha256||m?.size_bytes!==setting?.size_bytes){epoch++;clearBlob();}key=next;video=file?.media_kind==='video';setting=m?readMusicSetting(m):null;paint();if(setting&&!blob&&library&&!restoring)restoring=restore(setting);},getSetting(){return setting?readMusicSetting(setting):null;},getSource,clear(){epoch++;clearBlob();setting=null;video=false;key='';paint();},destroy(){disposed=true;epoch++;libraryView?.destroy();$('musicSaveLibrary')?.removeEventListener('click',saveLibrary);clearBlob();$('musicFile').removeEventListener('change',choose);$('musicVolume').removeEventListener('input',edit);$('musicStart').removeEventListener('input',edit);$('musicRemove').removeEventListener('click',remove);}};
}
