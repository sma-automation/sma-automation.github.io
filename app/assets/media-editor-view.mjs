import {missingVideoMetadata,videoMetadataNotice} from './media-metadata.mjs?v=1';
import {mountMediaMusic} from './media-music-view.mjs?v=2';
import {mountMediaExport} from './media-export-view.mjs?v=3';
import {createChapterTabs} from './dashboard-chapters.mjs?v=1';
import {editorDefaults,readEditorFiles,readEditorState,readEditorSettings} from './media-editor-model.mjs?v=3';
const errors={FILE_SYNC_RATE_LIMITED:'Bitte warte kurz und aktualisiere die Dateiangaben danach erneut.',FILE_SYNC_RUNNING:'Dein Kundenordner wird bereits aktualisiert. Bitte versuche es gleich erneut.',FILE_SYNC_UNAVAILABLE:'Die Dateiangaben konnten nicht aktualisiert werden. Deine Eingaben bleiben erhalten. Bitte erneut versuchen.',FOLDER_UNAVAILABLE:'Dein Kundenordner ist momentan nicht erreichbar. Bitte erneut versuchen.',MUSIC_INVALID:'Bitte prüfe Musiklautstärke und Startzeit (0 bis unter 600 Sekunden).',RATE_LIMITED:'Für diesen Zeitraum wurden bereits viele Änderungen gespeichert. Bitte versuche es später erneut.',AUTH_REQUIRED:'Bitte melde dich erneut bei SMA an.',ACCOUNT_UNAVAILABLE:'Dein Kundenkonto ist nicht eindeutig verfügbar.',ACCESS_INACTIVE:'Dein SMA-Zugang ist derzeit nicht aktiv.',FILE_UNAVAILABLE:'Diese Datei ist nicht mehr verfügbar. Lade die Dateiliste neu.',FILE_CHANGED:'Die Datei wurde geändert. Lade die Dateiliste und den passenden Entwurf neu.',REVISION_CONFLICT:'Dieser Entwurf wurde inzwischen geändert. Lade den gespeicherten Stand, bevor du erneut speicherst.',REQUEST_CONFLICT:'Die Speicherung passt nicht mehr zu diesem Entwurf. Lade den gespeicherten Stand.',INVALID_SETTINGS:'Bitte prüfe die Eingaben: Zeitpunkte innerhalb der Videolänge, Cover innerhalb des Schnitts und höchstens 160 Zeichen ohne Zeilenumbruch.',UNAVAILABLE:'Die Anfrage konnte nicht abgeschlossen werden. Bitte erneut versuchen.'};
export function mountMediaEditor({doc,expectedOwnerId,getOwnerId,request,listFiles,refreshMetadata=null,musicLibrary=null,thumbnail,uuid,createURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url),initialAssetId=null,exportDependencies=null}){
 const $=id=>doc.getElementById(id),control=k=>doc.querySelector('[name="'+k+'"]'),ownerWindow=doc.defaultView;
 let files=[],file=null,saved=null,attempt=null,busy=false,disposed=false,invalidOwner=false,dirty=false,generation=0,previewController=null,previewURL=null,metadataController=null,fileStale=false;
 let exportView;
 const music=mountMediaMusic({doc,library:musicLibrary,createURL,revokeURL,setBusy:value=>lock(value),onChange:()=>{if(!saved||disposed||invalidOwner)return;dirty=true;exportView?.setContext(file,saved,dirty||fileStale);say('Ungespeicherte Änderungen.');}});
 const tabs=createChapterTabs({doc,id:'media-editor',list:$('chapters'),entries:[{key:'format',label:'Format & Ausschnitt',panel:$('formatPanel')},{key:'time',label:'Schnitt & Cover',panel:$('timePanel')},{key:'overlay',label:'Text',panel:$('overlayPanel')},{key:'audio',label:'Ton',panel:$('audioPanel')},...(exportDependencies?[{key:'export',label:'Export',panel:$('exportPanel')}]:[])],onSelect:key=>{if($('draftActions'))$('draftActions').hidden=key==='export';if($('draftPreview'))$('draftPreview').hidden=key==='export';}});
 const say=(text,error=false)=>{$('status').textContent=text;$('status').dataset.error=String(error);};
 const current=g=>!disposed&&!invalidOwner&&g===generation;
 function releasePreview(){previewController?.abort();previewController=null;if(previewURL)revokeURL(previewURL);previewURL=null;$('image').removeAttribute('src');$('image').hidden=true;$('overlay').textContent='';}
 function lock(value){busy=value;$('fields').disabled=value;for(const id of ['asset','refreshFiles','refreshMetadata','save','reload','confirmDiscard'])$(id).disabled=value;}
 function unavailable(message){metadataController?.abort();metadataController=null;$('metadataPanel').hidden=true;music.clear();exportView?.destroy();invalidOwner=true;generation++;releasePreview();files=[];file=null;saved=null;attempt=null;dirty=false;$('asset').replaceChildren();for(const key of Object.keys(editorDefaults))control(key).value='';$('fileInfo').textContent='';$('savedInfo').textContent='';$('editor').hidden=true;$('app').hidden=true;$('login').hidden=false;lock(true);say(message,true);}
 async function owner(g){const id=await getOwnerId();if(!current(g))return false;if(id!==expectedOwnerId){unavailable(errors.AUTH_REQUIRED);return false;}return true;}
 function fail(error){const code=error?.message||'UNAVAILABLE';if(['AUTH_REQUIRED','ACCESS_INACTIVE','ACCOUNT_UNAVAILABLE'].includes(code)){unavailable(errors[code]);return;}say(errors[code]||errors.UNAVAILABLE,true);}
 function settings(){const s={};for(const k of Object.keys(editorDefaults)){const value=control(k).value;if(k.endsWith('_ms'))s[k]=value===''&&k!=='start_ms'?null:value.trim()===''?NaN:Math.round(Number(value)*1000);else if(['position_x','position_y','audio_volume'].includes(k))s[k]=Number(value);else s[k]=value;}const m=music.getSetting();return readEditorSettings({...s,...(m?{music:m}:{})},file);}
 function paint(){
  for(const k of ['position_x','position_y','audio_volume'])doc.querySelector('[data-value="'+k+'"]').textContent=control(k).value+' %';
  const ratio=control('format').value==='original'?(file?.width_px&&file?.height_px?file.width_px/file.height_px:1):({'9:16':9/16,'1:1':1,'16:9':16/9})[control('format').value]||1;
  $('stage').style.aspectRatio=String(ratio);$('stage').style.maxWidth=Math.min(480,480*ratio)+'px';$('image').style.objectFit=control('fit').value;$('image').style.objectPosition=control('position_x').value+'% '+control('position_y').value+'%';
  $('overlay').textContent=control('overlay_text').value;const position=control('overlay_position').value;$('overlay').style.top=position==='top'?'5%':position==='center'?'50%':'auto';$('overlay').style.bottom=position==='bottom'?'5%':'auto';$('overlay').style.transform=position==='center'?'translateY(-50%)':'none';
 }
 function fill(result){saved=result;for(const [k,v] of Object.entries(result.settings).filter(([k])=>k!=='music'))control(k).value=v===null?'':k.endsWith('_ms')?String(v/1000):String(v);music.setContext(file,result.settings.music);dirty=false;attempt=null;$('discard').hidden=true;$('savedInfo').textContent=result.revision?'Gespeicherter Entwurf · Version '+result.revision+' · '+new Intl.DateTimeFormat('de-AT',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Vienna'}).format(new Date(result.saved_at)):'Noch kein Bearbeitungsentwurf gespeichert.';paint();exportView?.setContext(file,saved,dirty||fileStale);}
 function metadataFields(){const missing=missingVideoMetadata(file);$('metadataPanel').hidden=!missing.length;$('metadataStatus').textContent=videoMetadataNotice(file);$('refreshMetadata').hidden=!refreshMetadata;}
 function fileFields(){
  metadataFields();
  const timed=file.media_kind==='video'&&Number.isFinite(file.duration_ms)&&file.duration_ms>0;
  for(const k of ['start_ms','end_ms','cover_ms']){control(k).disabled=!timed;control(k).max=timed?String(file.duration_ms/1000):'';}
  control('audio_volume').disabled=file.media_kind!=='video';
  $('timeNote').textContent=file.media_kind==='image'?'Zeitpunkte gelten nur für Videos.':timed?'Videolänge: '+(file.duration_ms/1000).toLocaleString('de-AT')+' Sekunden.':'Die Videolänge ist noch nicht bekannt. Zeitfelder sind deshalb gesperrt.';
  $('previewNote').textContent=file.media_kind==='video'?'Standbild-Vorschau für Format, Bildausschnitt und Text. Schnitt, Cover-Zeitpunkt und Ton werden beim Export angewendet.':'Vorschaubild für Format, Bildausschnitt und Text; noch kein exportiertes Ergebnis.';
 }
 async function loadPreview(g,selected){
  releasePreview();const controller=new AbortController();previewController=controller;$('previewEmpty').hidden=false;$('previewEmpty').textContent='Vorschaubild wird geladen …';
  try{const blob=await thumbnail(selected,controller.signal);if(!current(g)||controller.signal.aborted||!await owner(g))return;previewURL=createURL(blob);$('image').src=previewURL;$('image').hidden=false;$('previewEmpty').hidden=true;paint();}
  catch{if(current(g)&&!controller.signal.aborted){$('previewEmpty').textContent='Das Vorschaubild ist momentan nicht verfügbar. Die Einstellungen können trotzdem gespeichert werden.';}}
 }
 async function loadFile(id){
  if(disposed||invalidOwner)return;const g=++generation;fileStale=false;metadataController?.abort();metadataController=null;$('metadataPanel').hidden=true;releasePreview();music.clear();exportView?.setContext(null,null,false);file=files.find(f=>f.id===id)||null;saved=null;attempt=null;dirty=false;$('editor').hidden=true;$('discard').hidden=true;
  if(!file){say('Noch keine Bild- oder Videodateien vorhanden. Dateien kannst du unter Veröffentlichung hinzufügen.');return;}
  $('asset').value=file.id;$('fileInfo').textContent=file.name;lock(true);say('Bearbeitungsentwurf wird geladen …');
  try{if(!await owner(g))return;const response=await request('get',{asset_id:file.id,asset_revision:file.revision});if(!current(g)||!await owner(g))return;fill(readEditorState(response,file));fileFields();$('editor').hidden=false;say('Entwurf geladen. Änderungen werden erst mit „Entwurf speichern“ gespeichert.');void loadPreview(g,file);}
  catch(e){if(current(g))fail(e);}finally{if(current(g))lock(false);}
 }
 async function loadFiles(){
  if(disposed||invalidOwner||busy)return;if(dirty){say('Speichere deine Änderungen oder lade zuerst den gespeicherten Stand.',true);return;}
  const g=++generation;lock(true);$('retry').hidden=true;say('Dateiliste wird geladen …');
  try{if(!await owner(g))return;const response=await listFiles();if(!current(g)||!await owner(g))return;files=readEditorFiles(response);const selected=files.find(f=>f.id===(file?.id||initialAssetId))||files[0];$('asset').replaceChildren();for(const f of files){const option=doc.createElement('option');option.value=f.id;option.textContent=(f.media_kind==='video'?'Video · ':'Bild · ')+(f.name.length>90?f.name.slice(0,87)+'…':f.name);$('asset').append(option);}lock(false);$('app').hidden=false;await loadFile(selected?.id);}
  catch(e){if(current(g)){fail(e);if(!invalidOwner)$('retry').hidden=false;}}finally{if(current(g))lock(false);}
 }
 async function refreshFileMetadata(){
  if(busy||disposed||invalidOwner||!file||!saved||!refreshMetadata)return;
  if(fileStale){fail(Error('FILE_CHANGED'));return;}
  const g=generation,selected=file,controller=new AbortController();metadataController=controller;lock(true);
  $('metadataStatus').textContent='Dateiangaben werden im Kundenordner geprüft …';
  try{
   if(!await owner(g))return;const result=await refreshMetadata(controller.signal);if(!current(g)||!await owner(g)||controller.signal.aborted)return;
   const latestFiles=readEditorFiles(result),latest=latestFiles.find(f=>f.id===selected.id);
   if(!latest)throw Error('FILE_UNAVAILABLE');
   files=latestFiles;
   if(latest.revision!==selected.revision||latest.media_kind!==selected.media_kind){fileStale=true;exportView?.setContext(null,null,false);throw Error('FILE_CHANGED');}
   file=latest;fileFields();paint();exportView?.setContext(file,saved,dirty||fileStale);void loadPreview(g,file);
   say(missingVideoMetadata(file).length?'Google Drive hat die fehlenden Dateiangaben noch nicht bereitgestellt. Bitte später erneut aktualisieren. Deine Eingaben bleiben erhalten.':'Dateiangaben aktualisiert. Deine Eingaben bleiben erhalten.');
  }catch(e){if(current(g)&&!controller.signal.aborted){if(['FILE_UNAVAILABLE','FILE_CHANGED'].includes(e?.message)){fileStale=true;exportView?.setContext(null,null,false);}fail(e);if(!invalidOwner)$('metadataStatus').textContent=e?.message==='FILE_CHANGED'?'Die Dateiversion wurde geändert. Deine Eingaben bleiben sichtbar. Lade den passenden gespeicherten Stand, bevor du fortfährst.':errors[e?.message]||errors.FILE_SYNC_UNAVAILABLE;}}
  finally{if(metadataController===controller)metadataController=null;if(current(g))lock(false);}
 }
 $('refreshMetadata').addEventListener('click',refreshFileMetadata);
 async function save(event){
  event?.preventDefault();if(busy||!saved||!file||invalidOwner||disposed)return;
  if(fileStale){fail(Error('FILE_CHANGED'));return;}
  let value;try{value=settings();}catch(e){fail(e);return;}
  const signature=JSON.stringify([file.id,file.revision,saved.revision,value]);if(attempt?.signature!==signature)attempt={signature,request_id:uuid()};
  const input={asset_id:file.id,asset_revision:file.revision,revision:saved.revision,request_id:attempt.request_id,settings:value},g=generation;lock(true);say('Entwurf wird gespeichert …');
  try{if(!await owner(g))return;const response=await request('save',input);if(!current(g)||!await owner(g))return;const result=readEditorState(response,file);fill(result);say(result.changed?'Entwurf gespeichert. Die Änderung steht jetzt in der History.':result.revision?'Gespeicherter Stand bestätigt. Es wurde kein doppelter Verlaufseintrag angelegt.':'Keine geänderten Einstellungen vorhanden.');}
  catch(e){if(current(g))fail(e);}finally{if(current(g))lock(false);}
 }
 const change=event=>{if(!saved||busy||!Object.hasOwn(editorDefaults,event.target.name))return;dirty=true;exportView?.setContext(file,saved,dirty||fileStale);paint();say('Ungespeicherte Änderungen.');};$('editorForm').addEventListener('input',change);$('editorForm').addEventListener('change',change);$('editorForm').addEventListener('submit',save);
 const choose=()=>{if(dirty){$('asset').value=file.id;say('Speichere deine Änderungen oder lade zuerst den gespeicherten Stand.',true);return;}void loadFile($('asset').value);};$('asset').addEventListener('change',choose);
 const reload=()=>{if(busy||!file)return;if(dirty){$('discard').hidden=false;return;}void loadFile(file.id);};$('reload').addEventListener('click',reload);
 const discard=()=>{if(file&&!busy)void loadFile(file.id);},keep=()=>{$('discard').hidden=true;};$('confirmDiscard').addEventListener('click',discard);$('keepEditing').addEventListener('click',keep);
 $('refreshFiles').addEventListener('click',loadFiles);$('retry').addEventListener('click',loadFiles);
 const visibility=async()=>{if(doc.visibilityState==='hidden'){$('app').hidden=true;return;}const g=generation;try{if(await owner(g)&&current(g))$('app').hidden=false;}catch{if(current(g))unavailable(errors.AUTH_REQUIRED);}};
 doc.addEventListener('visibilitychange',visibility);ownerWindow.addEventListener('focus',visibility);
 if(exportDependencies)exportView=mountMediaExport({doc,...exportDependencies,getOwnerId,expectedOwnerId,uuid,createURL,revokeURL,setBusy:lock,onAuthLost:()=>unavailable(errors.AUTH_REQUIRED),musicSource:m=>music.getSource(m),getDraft:(f)=>request('get',{asset_id:f.id,asset_revision:f.revision})});
 void loadFiles();
 return {invalidateOwner(id){if(id!==expectedOwnerId&&!disposed)unavailable(errors.AUTH_REQUIRED);},destroy(){if(disposed)return;disposed=true;generation++;metadataController?.abort();$('refreshMetadata').removeEventListener('click',refreshFileMetadata);exportView?.destroy();music.destroy();releasePreview();tabs.destroy();$('editorForm').removeEventListener('input',change);$('editorForm').removeEventListener('change',change);$('editorForm').removeEventListener('submit',save);$('asset').removeEventListener('change',choose);$('reload').removeEventListener('click',reload);$('confirmDiscard').removeEventListener('click',discard);$('keepEditing').removeEventListener('click',keep);$('refreshFiles').removeEventListener('click',loadFiles);$('retry').removeEventListener('click',loadFiles);doc.removeEventListener('visibilitychange',visibility);ownerWindow.removeEventListener('focus',visibility);$('app').hidden=true;}};
}
