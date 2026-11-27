import {dashboardAction} from './dashboard-feedback.mjs?v=1';
import {mountEditorCaption} from './media-editor-caption.mjs?v=1';
import {mountEditorTimeline} from './media-editor-timeline.mjs?v=2';
import {exportFrameSize} from './media-export-model.mjs?v=4';
import {mountOriginalVideo,originalVideoSupported} from './original-video-preview.mjs?v=6';
import {missingVideoMetadata,videoMetadataNotice} from './media-metadata.mjs?v=1';
import {mountMediaMusic} from './media-music-view.mjs?v=7';
import {mountMediaExport} from './media-export-view.mjs?v=9';
import {createChapterTabs} from './dashboard-chapters.mjs?v=1';
import {editorDefaults,readEditorFiles,readEditorState,readEditorSettings} from './media-editor-model.mjs?v=5';
const errors={FILE_SYNC_RATE_LIMITED:'Bitte warte kurz und aktualisiere die Dateiangaben danach erneut.',FILE_SYNC_RUNNING:'Dein Kundenordner wird bereits aktualisiert. Bitte versuche es gleich erneut.',FILE_SYNC_UNAVAILABLE:'Die Dateiangaben konnten nicht aktualisiert werden. Deine Eingaben bleiben erhalten. Bitte erneut versuchen.',FOLDER_UNAVAILABLE:'Dein Kundenordner ist momentan nicht erreichbar. Bitte erneut versuchen.',MUSIC_INVALID:'Bitte prüfe Musiklautstärke und Startzeit (0 bis unter 600 Sekunden).',RATE_LIMITED:'Für diesen Zeitraum wurden bereits viele Änderungen gespeichert. Bitte versuche es später erneut.',AUTH_REQUIRED:'Bitte melde dich erneut bei SMA an.',ACCOUNT_UNAVAILABLE:'Dein Kundenkonto ist nicht eindeutig verfügbar.',ACCESS_INACTIVE:'Dein SMA-Zugang ist derzeit nicht aktiv.',FILE_UNAVAILABLE:'Diese Datei ist nicht mehr verfügbar. Lade die Dateiliste neu.',FILE_CHANGED:'Die Datei wurde geändert. Lade die Dateiliste und den passenden Entwurf neu.',REVISION_CONFLICT:'Dieser Entwurf wurde inzwischen geändert. Lade den gespeicherten Stand, bevor du erneut speicherst.',REQUEST_CONFLICT:'Die Speicherung passt nicht mehr zu diesem Entwurf. Lade den gespeicherten Stand.',INVALID_SETTINGS:'Bitte prüfe die Eingaben: Zeitpunkte innerhalb der Videolänge, Cover innerhalb des Schnitts und höchstens 160 Zeichen ohne Zeilenumbruch.',UNAVAILABLE:'Die Anfrage konnte nicht abgeschlossen werden. Bitte erneut versuchen.'};
export function driveFileId(value){
 let url;
 try{url=new URL(value.trim());}catch{return null;}
 if(url.origin!=='https://drive.google.com'||url.username||url.password)return null;
 const path=url.pathname.match(/^\/file\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{10,200})(?:\/(?:view|edit|preview))?\/?$/);
 if(path)return path[1];
 if(!/^\/(?:u\/\d+\/)?open\/?$/.test(url.pathname))return null;
 const ids=url.searchParams.getAll('id');
 return ids.length===1&&/^[A-Za-z0-9_-]{10,200}$/.test(ids[0])?ids[0]:null;
}
export function mountMediaEditor({doc,expectedOwnerId,getOwnerId,request,listFiles,lookupDriveFile=null,refreshMetadata=null,musicLibrary=null,thumbnail,source=null,displaySource=null,isLinkedVideo=null,uuid,createURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url),initialAssetId=null,initialAssetRevision=null,initialAssetPortal=null,exportDependencies=null,navigate=href=>doc.defaultView.location.assign(href)}){
 const $=id=>doc.getElementById(id),control=k=>doc.querySelector('[name="'+k+'"]'),ownerWindow=doc.defaultView;
 let files=[],file=null,saved=null,attempt=null,busy=false,disposed=false,invalidOwner=false,dirty=false,generation=0,previewController=null,previewURL=null,metadataController=null,fileStale=false;
 let exportView,discardAction=null;
 let useLinkedFile=initialAssetId!==null||initialAssetRevision!==null;
 let folderVisit=false,driveLookup=null;
 const music=mountMediaMusic({doc,library:musicLibrary,createURL,revokeURL,setBusy:value=>lock(value),onChange:()=>{if(!saved||disposed||invalidOwner)return;setDirty(true);exportView?.setContext(file,saved,dirty||fileStale);say('Ungespeicherte Änderungen.');}});
 const canEdit=()=>Boolean(saved&&!busy&&!fileStale&&!invalidOwner&&!disposed);
 function markEdited(){
  if(!canEdit())return;
  setDirty(true);exportView?.setContext(file,saved,true);paint();say('Ungespeicherte Änderungen.');
 }
 const caption=mountEditorCaption({doc,stage:$('stage'),control,changed:markEdited});
 let timeline;
 const playable=file=>originalVideoSupported(file)||Boolean(isLinkedVideo?.(file));
 const original=source?mountOriginalVideo({
  doc,host:$('editorOriginal'),thumbnailHost:$('image'),editorStage:$('stage'),getOwnerId,expectedOwnerId,source,displaySource,displaySupported:playable,createURL,revokeURL,
  loadedText:'',onReadyChange:value=>timeline?.readyChange(value)
 }):null;
 timeline=mountEditorTimeline({doc,control,original,music,changed:markEdited,canEdit,playable});
 function syncOriginal(){
  const selected=saved&&!fileStale&&!invalidOwner&&$('exportPanel').hidden?file:null;
  original?.setContext(selected);
  timeline.setFile(selected);
 }
 const tabs=createChapterTabs({doc,id:'media-editor',list:$('chapters'),initial:'overlay',entries:[
  {key:'format',label:'Format',panel:$('formatPanel')},{key:'time',label:'Schnitt & Cover',panel:$('timePanel')},
  {key:'overlay',label:'Text',panel:$('overlayPanel')},{key:'audio',label:'Ton',panel:$('audioPanel')},
  ...(exportDependencies?[{key:'export',label:'Export',panel:$('exportPanel')}]:[])
 ],onSelect:key=>{
  timeline.pause();caption.setActive(key==='overlay');
  $('draftPreview').hidden=key==='export';
  syncOriginal();
  if(key==='time')timeline.prepare();
 }});
 for(const {button} of tabs.entries)button.setAttribute('aria-label',button.textContent);
 caption.setActive(true);
 const say=(text,error=false)=>{$('status').textContent=text;$('status').dataset.error=String(error);};
 const current=g=>!disposed&&!invalidOwner&&g===generation;
 function warnBeforeLeaving(event){if(!dirty||disposed||invalidOwner)return;event.preventDefault();event.returnValue=true;}
 function setDirty(value){if(dirty===value)return;dirty=value;if(value)ownerWindow.addEventListener('beforeunload',warnBeforeLeaving);else ownerWindow.removeEventListener('beforeunload',warnBeforeLeaving);}
 function clearDiscard(){discardAction=null;$('discard').hidden=true;}
 function showDiscard(action){discardAction=action;$('discardMessage').textContent=action==='leave'?'Ungespeicherte Änderungen verwerfen und zum Dashboard zurückkehren?':'Ungespeicherte Änderungen verwerfen?';$('confirmDiscard').textContent=action==='leave'?'Verwerfen und zurück':'Verwerfen und laden';$('discard').hidden=false;$('discard').scrollIntoView?.({block:'nearest'});$('keepEditing').focus();}
 function releasePreview(clearOverlay=true){$('timeTrack').style.backgroundImage='';previewController?.abort();previewController=null;if(previewURL)revokeURL(previewURL);previewURL=null;$('image').removeAttribute('src');$('image').hidden=true;
  if(clearOverlay){caption.clear();$('overlay').textContent='';$('overlayCanvas').hidden=true;$('overlayCanvas').width=0;$('overlayCanvas').removeAttribute('aria-label');}
 }
 function lock(value){busy=value;$('fields').ariaBusy=String(value);$('fields').disabled=value;for(const id of ['asset','refreshMetadata','save','reload','confirmDiscard'])$(id).disabled=value;}
 function unavailable(message){driveLookup?.abort();$('driveFileLink').value='';timeline.setFile(null);original?.setContext(null);$('draftActions').hidden=true;metadataController?.abort();metadataController=null;$('metadataPanel').hidden=true;music.clear();exportView?.destroy();invalidOwner=true;generation++;releasePreview();files=[];file=null;saved=null;attempt=null;setDirty(false);clearDiscard();$('asset').replaceChildren();for(const key of Object.keys(editorDefaults))control(key).value='';$('savedInfo').textContent='';$('editor').hidden=true;$('app').hidden=true;$('login').hidden=false;lock(true);say(message,true);}
 async function owner(g){const id=await getOwnerId();if(!current(g))return false;if(id!==expectedOwnerId){unavailable(errors.AUTH_REQUIRED);return false;}return true;}
 function fail(error){const code=error?.message||'UNAVAILABLE';if(['AUTH_REQUIRED','ACCESS_INACTIVE','ACCOUNT_UNAVAILABLE'].includes(code)){unavailable(errors[code]);return;}say(errors[code]||errors.UNAVAILABLE,true);}
 function timeValue(key){
  const value=control(key).value.trim();
  if(value==='')return key==='start_ms'?NaN:null;
  return Math.round(Number(value)*1000);
 }
 function settings(){const s={};for(const k of Object.keys(editorDefaults)){const value=control(k).value;if(k.endsWith('_ms'))s[k]=timeValue(k);else if(['position_x','position_y','audio_volume'].includes(k))s[k]=Number(value);else s[k]=value;}const m=music.getSetting();return readEditorSettings({...s,...(m?{music:m}:{}),...caption.getSetting()},file);}
 function paint(){
  for(const k of ['position_x','position_y','audio_volume'])doc.querySelector('[data-value="'+k+'"]').textContent=control(k).value+' %';
  const {width,height}=exportFrameSize(control('format').value,file?.width_px,file?.height_px);
  const ratio=width/height;
  $('stage').style.aspectRatio=String(ratio);$('stage').style.maxWidth=Math.min(640,400*ratio)+'px';$('image').style.objectFit=control('fit').value;$('image').style.objectPosition=control('position_x').value+'% '+control('position_y').value+'%';
  if(original){
   original.video.style.objectFit=$('image').style.objectFit;
   original.video.style.objectPosition=$('image').style.objectPosition;
   original.video.volume=Number(control('audio_volume').value)/100;
  }
  caption.paint(width,height);
  timeline.paint();
 }
 function fill(result){saved=result;for(const [k,v] of Object.entries(result.settings).filter(([k])=>k!=='music'&&k!=='overlay_style'))control(k).value=v===null?'':k.endsWith('_ms')?String(v/1000):String(v);caption.fill(result.settings);music.setContext(file,result.settings.music);setDirty(false);attempt=null;clearDiscard();$('savedInfo').textContent=result.revision?'Gespeicherter Entwurf · Version '+result.revision+' · '+new Intl.DateTimeFormat('de-AT',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Vienna'}).format(new Date(result.saved_at)):'';paint();exportView?.setContext(file,saved,dirty||fileStale);}
 function metadataFields(){const missing=missingVideoMetadata(file);$('metadataPanel').hidden=!missing.length;$('metadataStatus').textContent=videoMetadataNotice(file);$('refreshMetadata').hidden=!refreshMetadata;}
 function fileFields(){
  metadataFields();syncOriginal();
  const timed=file.media_kind==='video'&&Number.isFinite(file.duration_ms)&&file.duration_ms>0;
  for(const k of ['start_ms','end_ms','cover_ms']){control(k).disabled=!timed;control(k).max=timed?String(file.duration_ms/1000):'';}
  control('audio_volume').disabled=file.media_kind!=='video';
  $('timeNote').textContent=file.media_kind==='image'?'Schnitt und Cover sind für Videos verfügbar.':timed?'Ziehe die Griffe an den Enden der Timeline zum Kürzen. Wähle für das Cover ein Bild auf der Timeline.':'Die Videolänge ist noch nicht bekannt.';

 }
 async function loadPreview(g,selected){
  releasePreview(false);const controller=new AbortController();previewController=controller;$('previewEmpty').hidden=false;$('previewEmpty').textContent='Vorschaubild wird geladen …';
  try{const blob=await thumbnail(selected,controller.signal);if(!current(g)||controller.signal.aborted||!await owner(g))return;previewURL=createURL(blob);$('image').src=previewURL;$('timeTrack').style.backgroundImage='url("'+previewURL+'")';$('image').hidden=false;$('previewEmpty').hidden=true;paint();}
  catch{if(current(g)&&!controller.signal.aborted){$('previewEmpty').textContent='Das Vorschaubild ist momentan nicht verfügbar. Die Einstellungen können trotzdem gespeichert werden.';}}
 }
 async function loadFile(id,unavailableMessage){
  if(disposed||invalidOwner)return;timeline.setFile(null);original?.setContext(null);$('draftActions').hidden=true;const g=++generation;fileStale=false;metadataController?.abort();metadataController=null;$('metadataPanel').hidden=true;releasePreview();music.clear();exportView?.setContext(null,null,false);file=files.find(f=>f.id===id)||null;saved=null;attempt=null;setDirty(false);$('editor').hidden=true;clearDiscard();
  if(!file){
   $('savedInfo').textContent='';
   say(unavailableMessage||'Noch keine Bild- oder Videodateien vorhanden. Dateien kannst du unter Veröffentlichung hinzufügen.',Boolean(unavailableMessage));
   return;
  }
  $('asset').value=file.id;lock(true);say('Bearbeitungsentwurf wird geladen …');
  try{if(!await owner(g))return;const response=await request('get',{asset_id:file.id,asset_revision:file.revision});if(!current(g)||!await owner(g))return;fill(readEditorState(response,file));fileFields();$('editor').hidden=false;$('draftActions').hidden=false;say('');void loadPreview(g,file);}
  catch(e){if(current(g))fail(e);}finally{if(current(g))lock(false);}
 }
 function renderOptions(unavailable){
  const select=$('asset');select.replaceChildren();
  if(unavailable){
   const placeholder=doc.createElement('option');placeholder.value='';placeholder.disabled=true;
   placeholder.textContent='Datei auswählen';select.append(placeholder);
  }
  for(const f of files){
   const option=doc.createElement('option');option.value=f.id;option.textContent=f.caption;
   select.append(option);
  }
  if(unavailable)select.value='';
 }
 async function loadFiles({fromDrive=false}={}){
  if(disposed||invalidOwner||busy)return;if(dirty){say('Speichere deine Änderungen oder lade zuerst den gespeicherten Stand.',true);return;}
  const g=++generation;lock(true);$('retry').hidden=true;say('Dateiliste wird geladen …');
  try{
   if(!await owner(g))return;
   const response=fromDrive&&!files.length&&refreshMetadata?await refreshMetadata():await listFiles();
   if(!current(g)||!await owner(g))return;
   files=readEditorFiles(response,initialAssetId,initialAssetPortal);
   const selected=useLinkedFile
    ?files.find(f=>f.id===initialAssetId&&(initialAssetRevision===null||f.revision===initialAssetRevision))
    :files.find(f=>f.id===file?.id)||files[0];
   const unavailable=useLinkedFile&&!selected;
   renderOptions(unavailable);
   lock(false);$('app').hidden=false;
   if(fromDrive&&file&&saved&&previewURL&&selected?.id===file.id&&selected.revision===file.revision){
    $('asset').value=file.id;say('');return;
   }
   await loadFile(selected?.id,unavailable?'Die verlinkte Dateiversion ist nicht mehr verfügbar. Bitte prüfe die Dateiauswahl.':null);
  }
  catch(e){if(current(g)){fail(e);if(!invalidOwner)$('retry').hidden=false;}}finally{if(current(g))lock(false);}
 }
 async function refreshFileMetadata(){
  if(busy||disposed||invalidOwner||!file||!saved||!refreshMetadata)return;
  if(fileStale){fail(Error('FILE_CHANGED'));return;}
  const g=generation,selected=file,controller=new AbortController(),expires=Date.now()+90000;let timedOut=false;
  const expire=()=>{timedOut=true;controller.abort(Error('FILE_SYNC_TIMEOUT'));};
  const deadline=setTimeout(expire,90000);
  const check=()=>{if(Date.now()>=expires)expire();controller.signal.throwIfAborted();};
  const read=start=>new Promise((resolve,reject)=>{
   let settled=false;
   const finish=(callback,value)=>{if(settled)return;settled=true;controller.signal.removeEventListener('abort',abort);callback(value);};
   const abort=()=>finish(reject,controller.signal.reason||Error('FILE_SYNC_ABORTED'));
   if(controller.signal.aborted)return abort();controller.signal.addEventListener('abort',abort,{once:true});
   Promise.resolve().then(()=>{check();return start();})
    .then(value=>{try{check();finish(resolve,value);}catch(error){finish(reject,error);}},error=>finish(reject,error));
  });
  // Race the owner read itself. Racing owner(g) would still allow its late
  // continuation to clear the editor after this attempt had already ended.
  const checkOwner=async()=>{
   const id=await read(()=>getOwnerId());check();
   if(!current(g)||metadataController!==controller)return false;
   if(id!==expectedOwnerId){unavailable(errors.AUTH_REQUIRED);return false;}return true;
  };
  metadataController=controller;lock(true);
  $('metadataStatus').textContent='Dateiangaben werden im Kundenordner geprüft …';
  try{
   if(!await checkOwner())return;const result=await read(()=>refreshMetadata(controller.signal));if(!current(g)||!await checkOwner())return;
   const latestFiles=readEditorFiles(result,initialAssetId,initialAssetPortal),latest=latestFiles.find(f=>f.id===selected.id);
   if(!latest)throw Error('FILE_UNAVAILABLE');
   files=latestFiles;renderOptions(false);$('asset').value=selected.id;
   if(latest.revision!==selected.revision||latest.media_kind!==selected.media_kind){fileStale=true;exportView?.setContext(null,null,false);throw Error('FILE_CHANGED');}
   file=latest;fileFields();paint();exportView?.setContext(file,saved,dirty||fileStale);void loadPreview(g,file);
   say(missingVideoMetadata(file).length?'Google Drive hat die fehlenden Dateiangaben noch nicht bereitgestellt. Bitte später erneut aktualisieren. Deine Eingaben bleiben erhalten.':'Dateiangaben aktualisiert. Deine Eingaben bleiben erhalten.');
  }catch(e){if(current(g)){
   if(timedOut||e?.message==='FILE_SYNC_TIMEOUT'){
    const message='Die Aktualisierung der Dateiangaben dauert zu lange. Deine Eingaben bleiben erhalten. Bitte versuche es erneut.';
    say(message,true);$('metadataStatus').textContent=message;
   }else if(!controller.signal.aborted){if(['FILE_UNAVAILABLE','FILE_CHANGED'].includes(e?.message)){fileStale=true;timeline.setFile(null);original?.setContext(null);exportView?.setContext(null,null,false);}fail(e);if(!invalidOwner)$('metadataStatus').textContent=e?.message==='FILE_CHANGED'?'Die Dateiversion wurde geändert. Deine Eingaben bleiben sichtbar. Lade den passenden gespeicherten Stand, bevor du fortfährst.':errors[e?.message]||errors.FILE_SYNC_UNAVAILABLE;}
  }}
  finally{clearTimeout(deadline);if(metadataController===controller)metadataController=null;if(current(g))lock(false);}
 }
 $('refreshMetadata').addEventListener('click',dashboardAction(refreshFileMetadata));
 async function save(event){
  event?.preventDefault();if(busy||!saved||!file||invalidOwner||disposed)return;
  if(fileStale){fail(Error('FILE_CHANGED'));return;}
  let value;try{value=settings();}catch(e){fail(e);return;}
  const signature=JSON.stringify([file.id,file.revision,saved.revision,value]);if(attempt?.signature!==signature)attempt={signature,request_id:uuid()};
  const input={asset_id:file.id,asset_revision:file.revision,revision:saved.revision,request_id:attempt.request_id,settings:value},g=generation;lock(true);say('Entwurf wird gespeichert …');
  try{if(!await owner(g))return;const response=await request('save',input);if(!current(g)||!await owner(g))return;const result=readEditorState(response,file);fill(result);say(result.changed?'Entwurf gespeichert. Die Änderung steht jetzt in der History.':result.revision?'Gespeicherter Stand bestätigt. Es wurde kein doppelter Verlaufseintrag angelegt.':'Keine geänderten Einstellungen vorhanden.');}
  catch(e){if(current(g))fail(e);}finally{if(current(g))lock(false);}
 }
 const change=event=>{if(!saved||busy||!Object.hasOwn(editorDefaults,event.target.name))return;if(['start_ms','end_ms'].includes(event.target.name))original?.stopRange();markEdited();};$('editorForm').addEventListener('input',change);$('editorForm').addEventListener('change',change);$('editorForm').addEventListener('submit',dashboardAction(save));
 const choose=()=>{if(dirty){$('asset').value=file.id;say('Speichere deine Änderungen oder lade zuerst den gespeicherten Stand.',true);return;}useLinkedFile=false;$('assetPicker').hidden=true;return loadFile($('asset').value);};$('asset').addEventListener('change',dashboardAction(choose));
 const reload=()=>{if(busy||!file)return;if(dirty){showDiscard('reload');return;}return loadFile(file.id);};$('reload').addEventListener('click',dashboardAction(reload));
 const leave=event=>{if(event.defaultPrevented||event.button>0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||disposed||invalidOwner||!dirty)return;event.preventDefault();if(busy){say('Bitte warte, bis der laufende Vorgang abgeschlossen ist.',true);return;}showDiscard('leave');};$('backDashboard').addEventListener('click',leave);
 const discard=()=>{if(busy||disposed||invalidOwner||!discardAction)return;if(discardAction==='leave'){clearDiscard();setDirty(false);try{navigate($('backDashboard').href);}catch{setDirty(true);showDiscard('leave');say('Das Dashboard konnte nicht geöffnet werden. Deine Eingaben sind noch vorhanden.',true);}return;}if(file)return loadFile(file.id);},keep=()=>clearDiscard();$('confirmDiscard').addEventListener('click',dashboardAction(discard));$('keepEditing').addEventListener('click',keep);
 $('driveLinkForm').hidden=!lookupDriveFile;
 async function chooseDriveLink(event){
  event.preventDefault();
  if(!lookupDriveFile||busy||disposed||invalidOwner)return;
  if(dirty){say('Speichere deine Änderungen oder lade zuerst den gespeicherten Stand.',true);return;}
  const id=driveFileId($('driveFileLink').value);
  if(!id){say('Bitte füge den Link zu einer Datei auf Google Drive ein.',true);return;}
  const g=generation,controller=new AbortController();
  driveLookup=controller;lock(true);say('Datei wird im Kundenordner gesucht …');
  try{
   if(!await owner(g))return;
   const result=await lookupDriveFile(id,controller.signal);
   if(!current(g)||!await owner(g))return;
   if(result?.code==='FILE_UNAVAILABLE'){say('Diese Datei ist im aktuellen SMA-Katalog deines Kundenordners nicht verfügbar.',true);return;}
   const matches=readEditorFiles(result);
   if(matches.length!==1)throw Error('UNAVAILABLE');
   const [found]=matches,known=files.find(f=>f.id===found.id);
   if(!known||known.revision!==found.revision){
    files=[...files.filter(f=>f.id!==found.id),found];renderOptions(false);
   }
   $('driveFileLink').value='';$('assetPicker').hidden=true;useLinkedFile=false;
   await loadFile(found.id);
  }catch(error){if(current(g)&&!controller.signal.aborted)fail(error);}
  finally{if(driveLookup===controller)driveLookup=null;if(current(g))lock(false);}
 }
 $('driveLinkForm').addEventListener('submit',dashboardAction(chooseDriveLink));
 const openFolder=()=>{folderVisit=true;$('assetPicker').hidden=false;};
 $('driveFolder').addEventListener('click',openFolder);$('retry').addEventListener('click',dashboardAction(loadFiles));
 const visibility=async()=>{if(doc.visibilityState==='hidden'){timeline.pause();$('app').hidden=true;return;}const g=generation;try{if(await owner(g)&&current(g)){
  $('app').hidden=false;
  if(folderVisit&&!busy){folderVisit=false;if(!dirty)void loadFiles({fromDrive:true});}
 }}catch{if(current(g))unavailable(errors.AUTH_REQUIRED);}};
 doc.addEventListener('visibilitychange',visibility);ownerWindow.addEventListener('focus',visibility);
 if(exportDependencies)exportView=mountMediaExport({doc,...exportDependencies,getOwnerId,expectedOwnerId,uuid,createURL,revokeURL,setBusy:lock,onAuthLost:()=>unavailable(errors.AUTH_REQUIRED),musicSource:(m,signal)=>music.getSource(m,signal),getDraft:(f,signal)=>request('get',{asset_id:f.id,asset_revision:f.revision},signal)});
 void loadFiles();
 return {invalidateOwner(id){if(id!==expectedOwnerId&&!disposed)unavailable(errors.AUTH_REQUIRED);},destroy(){if(disposed)return;clearDiscard();$('backDashboard').removeEventListener('click',leave);setDirty(false);disposed=true;generation++;metadataController?.abort();$('refreshMetadata').removeEventListener('click',dashboardAction(refreshFileMetadata));exportView?.destroy();original?.destroy();timeline.destroy();caption.destroy();$('draftActions').hidden=true;music.destroy();releasePreview();tabs.destroy();$('editorForm').removeEventListener('input',change);$('editorForm').removeEventListener('change',change);$('editorForm').removeEventListener('submit',dashboardAction(save));$('asset').removeEventListener('change',dashboardAction(choose));$('reload').removeEventListener('click',dashboardAction(reload));$('confirmDiscard').removeEventListener('click',dashboardAction(discard));$('keepEditing').removeEventListener('click',keep);driveLookup?.abort();$('driveLinkForm').removeEventListener('submit',dashboardAction(chooseDriveLink));$('driveFolder').removeEventListener('click',openFolder);$('retry').removeEventListener('click',dashboardAction(loadFiles));doc.removeEventListener('visibilitychange',visibility);ownerWindow.removeEventListener('focus',visibility);$('app').hidden=true;}};
}
