import {missingVideoMetadata} from './media-metadata.mjs?v=1';
import {exportPlan,readExportReceipt,readExportList,sha256} from './media-export-model.mjs?v=3';
import {readEditorState} from './media-editor-model.mjs?v=3';
import {createExportCheckpoints} from './media-export-checkpoint.mjs?v=1';
const messages={MUSIC_REQUIRED:'Bitte wähle im Kapitel „Ton“ dieselbe Musikdatei erneut aus.',MUSIC_INVALID:'Die Musikdatei kann nicht verarbeitet werden. Erlaubt sind MP3 und WAV bis 8 MB, 10 Minuten und zwei Tonkanäle. Der Startpunkt muss innerhalb der Musik liegen.',AUTH_REQUIRED:'Bitte melde dich erneut bei SMA an.',EXPORT_UNSUPPORTED:'Diese Datei wird noch nicht unterstützt. Möglich sind MP4 bis 60 Sekunden, JPG, PNG und WebP bis 24 MB, maximal 4096 Pixel je Seite und 12 Megapixel.',SOURCE_UNAVAILABLE:'Die Originaldatei konnte nicht sicher geladen werden. Bitte versuche es erneut.',FILE_CHANGED:'Die Originaldatei wurde geändert. Lade die Dateiliste neu.',REVISION_CONFLICT:'Der Entwurf wurde inzwischen geändert. Lade den gespeicherten Stand neu.',EXPORT_CONFLICT:'Dieser Speicherversuch passt nicht mehr zum Ergebnis. Erzeuge eine neue Vorschau.',MEDIA_INVALID:'Die tatsächlichen Mediendaten stimmen nicht mit der Datei oder dem erwarteten Ergebnis überein.',RENDER_FAILED:'Der Browser konnte diese Datei nicht verarbeiten. Bitte versuche es erneut.',RENDERER_UNAVAILABLE:'Die Medienverarbeitung konnte nicht geladen werden. Bitte prüfe deine Verbindung und versuche es erneut.',EXPORT_SIZE:'Die fertige Datei ist größer als 24 MB. Bitte kürze das Video.',RATE_LIMITED:'In dieser Stunde wurden bereits zehn Exporte vorbereitet. Bitte versuche es später erneut.'};
Object.assign(messages,{EXPORT_CHECKPOINT_UNAVAILABLE:'Die Wiederaufnahme kann in diesem Browser gerade nicht sicher gespeichert werden. Das Speichern wurde gestoppt. Lass die Vorschau geöffnet und versuche es erneut, sobald der Browserspeicher verfügbar ist.',EXPORT_CHECKPOINT_UNSUPPORTED:'Dieser Browser kann die Speicherung nicht sicher absichern. Öffne SMA in einem aktuellen Browser. Die fertige Vorschau kannst du weiterhin herunterladen.',EXPORT_CHECKPOINT_BUSY:'Der Speicherversuch wird gerade in einem anderen SMA-Fenster gesichert. Bitte versuche es gleich erneut.',EXPORT_CHECKPOINT_LIMIT:'Der Wiederaufnahmespeicher dieses Browsers ist voll. Für dieses Ergebnis konnte kein neuer Speicherversuch angelegt werden. Die fertige Vorschau kannst du weiterhin herunterladen.',EXPORT_CHECKPOINT_CHANGED:'Der Speicherversuch wurde in einem anderen Fenster geändert. Lade den gespeicherten Stand erneut, bevor du weiterarbeitest.',FILE_JOB_EXPIRED:'Die Frist dieser Verarbeitung ist abgelaufen. Lade den Editor neu und erzeuge dieselbe Vorschau, um den gespeicherten Stand zu prüfen.'});
export function mountMediaExport({doc,getOwnerId,expectedOwnerId,onAuthLost,setBusy,getDraft,request,source,musicSource=async()=>{throw Error('MUSIC_REQUIRED');},upload,uuid,checkpointStorage=()=>doc.defaultView.localStorage,checkpointLocks=()=>doc.defaultView.navigator?.locks,createURL=URL.createObjectURL,revokeURL=URL.revokeObjectURL,render=async args=>(await import('./media-export-render.mjs?v=5')).renderMedia(args)}){
 const $=id=>doc.getElementById(id);let context=null,signature='',generation=0,disposed=false,controller=null,result=null,job=null,operation=null;const urls=new Set(),cleanups=[];
 const checkpoints=createExportCheckpoints({storage:checkpointStorage,locks:checkpointLocks,uuid});
 const restart=doc.createElement('button');restart.id='restartExpiredExport';restart.type='button';restart.className='secondary';restart.textContent='Neuen Speicherversuch starten';restart.hidden=true;restart.setAttribute('aria-describedby','exportStatus');$('storeExport').after(restart);
 const say=(text,error=false)=>{$('exportStatus').textContent=text;$('exportStatus').dataset.error=String(error);};
 function url(blob){const u=createURL(blob);urls.add(u);return u;}
 function clear(){controller?.abort();controller=null;restart.hidden=true;try{$('exportVideo').pause();$('exportVideo').removeAttribute('src');$('exportVideo').load();}catch{}for(const id of ['exportImage','exportCover'])$(id).removeAttribute('src');for(const id of ['downloadExport','downloadCover'])$(id).removeAttribute('href');for(const u of urls)revokeURL(u);urls.clear();result=null;job=null;$('exportResult').hidden=true;$('exportHistory').replaceChildren();}
 function lock(next=null){operation=next;const value=Boolean(next);setBusy(value);$('generateExport').disabled=value||!context||context.dirty||missingVideoMetadata(context.file).length>0;$('storeExport').disabled=value||!result||job?.status==='completed';restart.disabled=value||!result||!job?.checkpoint?.expired||job?.status==='completed';$('cancelExport').hidden=!value;for(const b of $('exportHistory').querySelectorAll('button'))b.disabled=value;}
 const active=g=>!disposed&&g===generation;
 async function owner(g){
  if(!active(g))throw Error('AbortError');
  const id=await getOwnerId();if(!active(g))throw Error('AbortError');
  if(id!==expectedOwnerId){onAuthLost();throw Error('AUTH_REQUIRED');}
 }
 async function verify(g,signal){await owner(g);const file=context.file;const state=readEditorState(await getDraft(file,signal),file);await owner(g);if(state.revision!==context.saved.revision||JSON.stringify(state.settings)!==JSON.stringify(context.saved.settings))throw Error('REVISION_CONFLICT');return state;}
 function fail(e,g){if(!active(g))return;if(e?.message==='AUTH_REQUIRED'||e?.code==='AUTH_REQUIRED'){onAuthLost();return;}if(controller?.signal.aborted||e?.name==='AbortError'||e?.message==='AbortError'){say(result?'Speichern abgebrochen. Du kannst dasselbe Ergebnis erneut speichern.':'Verarbeitung abgebrochen.');return;}say(messages[e?.code]||messages[e?.message]||(result?'Speichern noch nicht abgeschlossen. Bitte erneut auf „Im Kundenordner speichern“ klicken. Dasselbe Ergebnis wird fortgesetzt.':'Die Verarbeitung konnte nicht abgeschlossen werden. Bitte erneut versuchen.'),true);}
 function listen(id,fn){$(id).addEventListener('click',fn);cleanups.push(()=>$(id).removeEventListener('click',fn));}
 async function history(g){
  try{const f=context.file,rows=readExportList(await request('list',{asset_id:f.id,asset_revision:f.revision}));await owner(g);$('exportHistory').replaceChildren();if(!rows.length){$('exportHistory').textContent='Noch keine exportierte Datei gespeichert.';return;}
   for(const row of rows){const div=doc.createElement('div'),label=doc.createElement('p'),actions=doc.createElement('div');actions.className='actions';label.textContent='Entwurf '+row.draft_revision+' · '+new Intl.DateTimeFormat('de-AT',{dateStyle:'medium',timeStyle:'short'}).format(new Date(row.completed_at));div.append(label,actions);
    for(const kind of ['media','cover'])if(row[kind]){const button=doc.createElement('button');button.type='button';button.textContent=kind==='media'?'Datei herunterladen':'Cover herunterladen';button.disabled=Boolean(operation);button.addEventListener('click',()=>download(row[kind]));actions.append(button);} const select=doc.createElement('select'),link=doc.createElement('a');select.setAttribute('aria-label','Portal für diese exportierte Datei');
    for(const [value,label] of [['youtube','YouTube'],['tiktok','TikTok'],['instagram','Instagram'],['facebook','Facebook']]){if(context.file.media_kind==='image'&&['youtube','tiktok'].includes(value))continue;const o=doc.createElement('option');o.value=value;o.textContent=label;select.append(o);}
    const target=()=>{link.href='publication-preview.html?portal='+select.value+'&asset='+row.media.asset_id+'&wide=1&v=31';};select.addEventListener('change',target);link.textContent='Für Portal vorbereiten →';target();actions.append(select,link);$('exportHistory').append(div);
   }
  }catch{if(active(g)&&!disposed)$('exportHistory').textContent='Gespeicherte Ergebnisse konnten gerade nicht geladen werden.';}
 }
 async function download(file){if(operation||disposed)return;const g=generation;controller=new AbortController();lock('download');say('Gespeicherte Datei wird geladen …');try{await owner(g);const blob=await source(file,controller.signal);await owner(g);controller.signal.throwIfAborted();const a=doc.createElement('a');a.href=url(blob);a.download=file.name;doc.body.append(a);a.click();a.remove();say('Datei zum Herunterladen bereit.');}catch(e){fail(e,g);}finally{if(active(g)){controller=null;lock();}}}
 async function generate(){
  if(operation||!context||context.dirty||disposed||missingVideoMetadata(context.file).length)return;clear();const g=++generation;controller=new AbortController();const signal=controller.signal;lock('preview');say('Originaldatei wird geladen …');
  try{const plan=exportPlan(context.file,context.saved.settings);await verify(g,signal);const music=plan.settings.music?await musicSource(plan.settings.music,signal):null;await owner(g);signal.throwIfAborted();const bytes=await source(context.file,signal);await owner(g);signal.throwIfAborted();say('Datei wird im Browser bearbeitet …');
   const rendered=await render({doc,file:context.file,settings:context.saved.settings,source:bytes,music,signal,onProgress:ratio=>{if(active(g))say(typeof ratio==='string'?ratio:'Datei wird im Browser bearbeitet … '+Math.round(Math.max(0,Math.min(1,ratio))*100)+' %');}});await verify(g,signal);signal.throwIfAborted();result=rendered;
   const video=context.file.media_kind==='video',mediaURL=url(result.media);$('exportVideo').hidden=!video;$('exportImage').hidden=video;$(video?'exportVideo':'exportImage').src=mediaURL;$('downloadExport').href=mediaURL;$('downloadExport').download='SMA-Export.'+(video?'mp4':'png');$('exportCover').hidden=!result.cover;$('downloadCover').hidden=!result.cover;
   if(result.cover){const coverURL=url(result.cover);$('exportCover').src=coverURL;$('downloadCover').href=coverURL;$('downloadCover').download='SMA-Cover.png';}
   $('exportDetails').textContent=plan.width+' × '+plan.height+' Pixel'+(video?' · '+(plan.duration_ms/1000).toLocaleString('de-AT')+' Sekunden':'')+' · '+(result.media.size/1e6).toLocaleString('de-AT',{maximumFractionDigits:2})+' MB';$('exportResult').hidden=false;say('Vorschau fertig. Prüfe das Ergebnis und speichere es anschließend in deinem Kundenordner.');
  }catch(e){fail(e,g);}finally{if(active(g)){controller=null;lock();void history(g);}}
 }
 const storeInput=()=>({asset_id:context.file.id,asset_revision:context.file.revision,draft_revision:job.draft_revision,export_id:job.export_id});
 function showExpired(){restart.hidden=false;say('Die Uploadfrist dieses Speicherversuchs ist abgelaufen. Bereits übertragene Dateien können im Kundenordner vorhanden sein. Prüfe sie dort. Mit „Neuen Speicherversuch starten“ wird dieses Ergebnis bewusst noch einmal gespeichert.',true);}
 async function finishStored(g){
  job.status='completed';restart.hidden=true;
  // Keeping a stale checkpoint after a storage failure is safe: prepare will
  // return its already completed result on a later explicit recovery.
  void checkpoints.complete(job.checkpoint).catch(()=>{});
  say('Fertige Datei'+(result.cover?' und Cover':'')+' im Kundenordner gespeichert. Unter Veröffentlichung kannst du das Ergebnis als Datei auswählen.');await history(g);
 }
 async function reconcile(input,g){
  const reply=await request('complete',input);await owner(g);controller.signal.throwIfAborted();
  if(reply?.ok===false&&reply.code==='EXPORT_INCOMPLETE'&&Object.keys(reply).length===2)return null;
  const receipt=readExportReceipt(reply,job);if(receipt.status!=='completed')throw Error('EXPORT_UNAVAILABLE');return receipt;
 }
 async function store(replaceExpired=false){
  if(operation||!result||!context||context.dirty||disposed||job?.status==='completed'||replaceExpired&&(restart.hidden||restart.disabled))return;const g=generation;controller=new AbortController();lock('store');say('Ergebnis wird für deinen Kundenordner vorbereitet …');
  try{
   await owner(g);controller.signal.throwIfAborted();
   const outputs={media:{sha256:await sha256(await result.media.arrayBuffer()),size_bytes:result.media.size},cover:result.cover?{sha256:await sha256(await result.cover.arrayBuffer()),size_bytes:result.cover.size}:null};
   const verified=await verify(g,controller.signal);controller.signal.throwIfAborted();
   if(!job){
    const reservation=await checkpoints.reserve({owner:expectedOwnerId,asset_id:context.file.id,asset_revision:context.file.revision,draft_revision:context.saved.revision,media_kind:context.file.media_kind,outputs},controller.signal,{confirmedDraftRevision:verified.revision});
    await owner(g);controller.signal.throwIfAborted();
    job={export_id:reservation.record.export_id,draft_revision:context.saved.revision,has_cover:!!result.cover,file:context.file,checkpoint:reservation.record,restored:reservation.restored};
   }
   checkpoints.current(job.checkpoint);
   let input=storeInput(),receipt=readExportReceipt(await request('prepare',{...input,outputs}),job);await owner(g);controller.signal.throwIfAborted();
   if(receipt.status!=='completed'&&(job.restored||job.checkpoint.expired)){
    const completed=await reconcile(input,g);
    if(completed)receipt=completed;
    else if(job.checkpoint.expired){
     if(!replaceExpired){showExpired();return;}
     await verify(g);controller.signal.throwIfAborted();
     const replacement=await checkpoints.replaceExpired(job.checkpoint,controller.signal);await owner(g);controller.signal.throwIfAborted();
     job={...job,export_id:replacement.export_id,checkpoint:replacement,restored:false};input=storeInput();restart.hidden=true;
     checkpoints.current(job.checkpoint);receipt=readExportReceipt(await request('prepare',{...input,outputs}),job);await owner(g);controller.signal.throwIfAborted();
    }
   }
   if(receipt.status!=='completed'){
    for(const key of ['media','cover'])if(receipt[key]){controller.signal.throwIfAborted();await owner(g);checkpoints.current(job.checkpoint);say(key==='media'?'Datei wird in deinem Kundenordner gespeichert …':'Cover wird in deinem Kundenordner gespeichert …');await upload(result[key],receipt[key],controller.signal);await owner(g);}
    controller.signal.throwIfAborted();await verify(g);receipt=readExportReceipt(await request('complete',input),job);await owner(g);if(receipt.status!=='completed')throw Error('EXPORT_INCOMPLETE');
   }
   await finishStored(g);
  }catch(e){
   if(active(g)&&(e?.code==='EXPORT_CHECKPOINT_CHANGED'||e?.message==='EXPORT_CHECKPOINT_CHANGED')&&job?.checkpoint){
    // Another tab may have finished and removed this shared checkpoint. Only
    // reconcile the original ID; a missing or replaced marker cannot authorize
    // another prepare, upload or replacement.
    try{await owner(g);controller.signal.throwIfAborted();if(await reconcile(storeInput(),g)){await finishStored(g);return;}fail(e,g);}catch(error){fail(error,g);}
   }else if(active(g)&&(e?.code==='UPLOAD_EXPIRED'||e?.message==='UPLOAD_EXPIRED')&&job?.checkpoint){
    try{
     if(await reconcile(storeInput(),g)){await finishStored(g);return;}
     const expired=await checkpoints.expire(job.checkpoint,controller.signal);await owner(g);job.checkpoint=expired;showExpired();
    }catch(error){fail(error,g);}
   }else fail(e,g);
  }finally{if(active(g)){controller=null;lock();}}
 }
 function cancel(){
  if(operation!=='preview'){controller?.abort();return;}
  // Late callbacks from this attempt must not touch the next preview.
  generation++;controller.abort();controller=null;lock();
  say('Verarbeitung abgebrochen.');void history(generation);
 }
 listen('generateExport',generate);listen('storeExport',()=>store());listen('restartExpiredExport',()=>store(true));listen('cancelExport',cancel);
 return {setContext(file,saved,dirty){const next=JSON.stringify([file?.id,file?.revision,file?.duration_ms,file?.width_px,file?.height_px,saved?.revision,!!dirty]);context=file&&saved?{file,saved,dirty}:null;if(next!==signature){signature=next;generation++;clear();lock();if(context){say(missingVideoMetadata(file).length?'Für den Videoexport fehlen noch Dateiangaben. Nutze oben „Dateiangaben aktualisieren“.':dirty?'Speichere zuerst deine Änderungen am Entwurf.':'Erzeuge eine Vorschau aus dem gespeicherten Entwurf.');void history(generation);}else say('Lade zuerst einen Entwurf.');}},destroy(){if(disposed)return;disposed=true;generation++;clear();cleanups.forEach(fn=>fn());restart.remove();}};
}
