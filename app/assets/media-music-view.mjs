import {inspectMusic,readMusicSetting,verifyMusicBytes} from './media-music-model.mjs?v=1';
export function mountMediaMusic({doc,onChange,setBusy,createURL=URL.createObjectURL,revokeURL=URL.revokeObjectURL}){
 const $=id=>doc.getElementById(id);let setting=null,blob=null,url=null,key='',video=false,epoch=0,disposed=false;
 function clearBlob(){try{$('musicPlayer').pause();$('musicPlayer').removeAttribute('src');$('musicPlayer').load();}catch{}if(url)revokeURL(url);url=null;blob=null;$('musicFile').value='';$('musicPlayer').hidden=true;}
 function paint(){
  $('musicFile').disabled=!video;$('musicRemove').disabled=!video||!setting;$('musicVolume').disabled=!video||!setting;$('musicStart').disabled=!video||!setting;
  $('musicVolume').value=String(setting?.volume??25);$('musicStart').value=String((setting?.start_ms??0)/1000);$('musicVolumeValue').textContent=(setting?.volume??25)+' %';
  $('musicStatus').textContent=!video?'Zusätzliche Musik ist für Videos verfügbar.':setting?setting.name+(blob?' · bereit':' · bitte dieselbe Musikdatei erneut auswählen'):'Noch keine zusätzliche Musik ausgewählt.';
 }
 async function choose(){const file=$('musicFile').files?.[0];if(!file||!video||disposed)return;const e=++epoch;setBusy(true);$('musicStatus').textContent='Musikdatei wird geprüft …';
  try{const found=await inspectMusic(file);if(disposed||e!==epoch)return;const same=setting&&found.sha256===setting.sha256&&found.size_bytes===setting.size_bytes&&found.mime_type===setting.mime_type;clearBlob();blob=file;setting=same?setting:found;url=createURL(file);$('musicPlayer').src=url;$('musicPlayer').hidden=false;paint();if(!same)onChange();}
  catch{if(!disposed&&e===epoch){$('musicFile').value='';$('musicStatus').textContent='Bitte eine MP3- oder WAV-Datei bis 8 MB wählen. Beim Export sind höchstens 10 Minuten und zwei Tonkanäle möglich.';}}
  finally{if(!disposed&&e===epoch)setBusy(false);}
 }
 function edit(){if(!setting||disposed)return;const volume=Number($('musicVolume').value),start_ms=Math.round(Number($('musicStart').value)*1000);setting={...setting,volume,start_ms};$('musicVolumeValue').textContent=volume+' %';onChange();}
 function remove(){if(!setting||disposed)return;epoch++;clearBlob();setting=null;paint();onChange();}
 $('musicFile').addEventListener('change',choose);$('musicVolume').addEventListener('input',edit);$('musicStart').addEventListener('input',edit);$('musicRemove').addEventListener('click',remove);
 return {setContext(file,m){const next=file?file.id+':'+file.revision:'';if(next!==key||m?.sha256!==setting?.sha256||m?.size_bytes!==setting?.size_bytes){epoch++;clearBlob();}key=next;video=file?.media_kind==='video';setting=m?readMusicSetting(m):null;paint();},getSetting(){return setting?readMusicSetting(setting):null;},async getSource(m){return verifyMusicBytes(blob,m);},clear(){epoch++;clearBlob();setting=null;video=false;key='';paint();},destroy(){disposed=true;epoch++;clearBlob();$('musicFile').removeEventListener('change',choose);$('musicVolume').removeEventListener('input',edit);$('musicStart').removeEventListener('input',edit);$('musicRemove').removeEventListener('click',remove);}};
}
