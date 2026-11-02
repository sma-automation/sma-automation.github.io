import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
const supabase=createClient('https://bnvnmdxosbnuzedokqgh.supabase.co','sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW');
import {deviceFileMetadata,transferDeviceFile} from './device-upload.mjs?v=1';
const endpoint='https://johnmusic.app.n8n.cloud/webhook/sma-publication-preview-v1';
const $=id=>document.getElementById(id);
const names={youtube:'YouTube',instagram:'Instagram',facebook:'Facebook',tiktok:'TikTok'};
const messages={CAPTION_TOO_SIMILAR:'Dieser Text ähnelt einem bereits gespeicherten Text zu stark. Bitte ergänze passende Angaben und erstelle einen neuen Entwurf.',AUTH_REQUIRED:'Bitte melde dich erneut im SMA-Dashboard an.',ACCESS_INACTIVE:'Dein SMA-Zugang ist derzeit nicht aktiv.',ACCOUNT_UNAVAILABLE:'Dein Konto konnte nicht eindeutig zugeordnet werden.',PUBLIC_SHOP_REQUIRED:'Für dein Konto muss zuerst ein öffentlicher SMA-Shop eingerichtet sein.',RATE_LIMITED:'Bitte warte kurz. Zum Schutz vor Mehrfachanfragen gilt mindestens 30 Sekunden Abstand und höchstens 20 Vorschauen pro Stunde.',PREPARATION_RUNNING:'Eine Vorschau wird bereits erstellt. Lade in Kürze die letzte Vorschau.',REVISION_CONFLICT:'Die Vorschau wurde zwischenzeitlich geändert. Lade die letzte Vorschau, bevor du erneut speicherst.',ACCOUNT_CHANGED:'Die Shop-Zuordnung hat sich geändert. Bitte erstelle eine neue Vorschau.',INVALID_EDIT:'Bitte prüfe Titel und Text: keine zusätzlichen Links, Hashtags, @-Angaben oder „Link im Profil“. Titel maximal 80, Text 10–1200 Zeichen.',YOUTUBE_REQUIRES_VIDEO:'Für YouTube bitte Video auswählen.',PREPARATION_TIMEOUT:'Die Erstellung hat zu lange gedauert. Bitte starte eine neue Vorschau.',PREPARATION_FAILED:'Die Texte konnten nicht vollständig geprüft werden. Bitte erstelle eine neue Vorschau.',PREPARATION_UNAVAILABLE:'Die Vorschau ist gerade nicht erreichbar. Bitte versuche es erneut.',INVALID_INPUT:'Bitte prüfe deine Angaben und wähle mindestens ein Portal.'};
let current=null,busy=false,attempt=null,assets=[],selectedAsset=null,assignmentRevision=0,dirty=false;
let reviewStatus=null;
let magicState=null;
let filePickerPage=0,pickerTrigger=null,pendingAssetId=null,sourceDirty=false,signedOut=false;
const magicEndpoint='https://johnmusic.app.n8n.cloud/webhook/sma-publication-magic-effect-v1';
const reviewEndpoint='https://johnmusic.app.n8n.cloud/webhook/sma-publication-content-review-v1';
Object.assign(messages,{VIDEO_PLAN_REQUIRED:'Die Videoanalyse ist im derzeitigen Sightengine-Tarif nicht freigeschaltet. Die Videoprüfung bleibt offen.',REVIEW_RUNNING:'Eine Datei wird bereits geprüft. Bitte warte kurz.',REVIEW_RATE_LIMITED:'Bitte warte kurz. Maximal sechs Prüfversuche pro Stunde mit mindestens 30 Sekunden Abstand.',CHECKSUM_REQUIRED:'Für diese Datei fehlt noch eine verlässliche Inhaltskennung. Bitte aktualisiere die Dateiliste.',MEDIA_UNSUPPORTED:'Diese Prüfung unterstützt statische JPEG-, PNG- und WebP-Bilder bis 12 MB sowie MP4-, MOV- und WebM-Videos unter 50 MB und unter 60 Sekunden. Animationen benötigen einen anderen Prüfweg.',REVIEW_INCOMPLETE:'Der Prüfdienst hat kein vollständiges Ergebnis geliefert. Die Prüfung bleibt offen.',PROVIDER_FAILED:'Der Prüfdienst konnte die Datei nicht prüfen.',REVIEW_TIMEOUT:'Die Prüfung hat zu lange gedauert. Du kannst sie erneut starten.',REVIEW_UNAVAILABLE:'Die Inhaltsprüfung ist gerade nicht erreichbar.'});
const fileEndpoint='https://johnmusic.app.n8n.cloud/webhook/sma-publication-files-v1';
Object.assign(messages,{FILE_UNAVAILABLE:'Diese Datei ist nicht mehr im zugeordneten Kundenordner verfügbar.',FILE_CHANGED:'Die Datei wurde geändert. Aktualisiere die Dateiliste und erstelle einen neuen passenden Text.',FILE_REFRESH_REQUIRED:'Bitte aktualisiere zuerst die Dateiliste.',ASSIGNMENT_CHANGED:'Der zugeordnete Text wurde außerhalb dieser Datei geändert. Bitte erstelle einen neuen Text für die Datei.',ASSIGNMENT_CONFLICT:'Die Zuordnung wurde inzwischen geändert. Lade den gespeicherten Text erneut.',FOLDER_UNAVAILABLE:'Dein Kundenordner ist nicht erreichbar oder nicht eindeutig zugeordnet. Die Ordnerverbindung muss geprüft werden.',FILE_SYNC_UNAVAILABLE:'Die Dateiliste konnte nicht aktualisiert werden. Bitte versuche es erneut.',FILE_SYNC_RUNNING:'Die Dateiliste wird bereits aktualisiert. Bitte versuche es gleich erneut.',FILE_SYNC_RATE_LIMITED:'Bitte warte kurz, bevor du die Dateien erneut aktualisierst.',FILE_CATALOG_TOO_LARGE:'Der Kundenordner enthält mehr Dateien als diese Ansicht vollständig laden kann.',FILE_METADATA_INVALID:'Die Dateiinformationen sind unvollständig. Bitte prüfe die Dateien im Kundenordner.',PORTAL_REQUIRES_VIDEO:'Für dieses Portal wird derzeit eine Videodatei benötigt.',TEXT_ALREADY_ASSIGNED:'Dieser Text gehört bereits zu einer anderen Datei. Bitte erstelle einen eigenen Text.',FILE_FORMAT_MISMATCH:'Die Textvorbereitung passt nicht zur ausgewählten Dateiart.'});
const params=new URLSearchParams(location.search);
const requestedPortal=params.get('portal');
const selectedPortal=Object.hasOwn(names,requestedPortal)?requestedPortal:null;
if(params.get('embedded')==='1')document.body.classList.add('embedded');
if(selectedPortal){
 $('assetPanel').hidden=false;$('mediaPanel').hidden=false;$('resultFileActions').hidden=false;document.body.classList.add('portal-mode');$('portalSelection').hidden=true;$('portalNote').hidden=false;$('portalStatus').hidden=false;
 document.querySelector('h1').textContent=names[selectedPortal]+' optimieren';$('resultHeading').textContent='Text für '+names[selectedPortal];$('generate').textContent='Text optimieren';
}

function status(text,error=false){for(const id of ['status','portalStatus']){$(id).textContent=text;$(id).dataset.error=String(error);}}
function errorText(r){return messages[r?.code||r?.error_code]||'Die Anfrage konnte nicht abgeschlossen werden. Bitte versuche es erneut.';}
function lock(value){value=value||signedOut;busy=value;syncReviewButton();syncMagicButton();for(const id of ['deviceBrowse','deviceBrowseResult','deviceFile','browseFiles','browseResultFiles','refreshFiles','pickerRefresh','confirmFileSwitch','chooseGeneralTemplate'])$(id).disabled=value;$('inputFields').disabled=value;$('save').disabled=value;for(const el of $('drafts').querySelectorAll('input,textarea'))el.disabled=value;renderFilePicker();}
async function session(){const {data,error}=await supabase.auth.getSession();if(error||!data.session)throw Error(messages.AUTH_REQUIRED);return data.session;}
async function rpc(action,input={},id=null){const {data,error}=await supabase.rpc('sma_publication_preview_v1',{p_action:action,p_input:input,p_id:id});if(error)throw Error('Die Vorschau konnte nicht geladen oder gespeichert werden.');if(!data?.ok)throw Error(errorText(data));return data;}
function sourceInput(){const form=new FormData($('previewForm'));return {source_text:form.get('source_text').trim(),audience:form.get('audience').trim(),goal:form.get('goal').trim(),language:form.get('language'),media_kind:selectedAsset?selectedAsset.media_kind:selectedPortal==='youtube'?'video':form.get('media_kind'),platforms:selectedPortal?[selectedPortal]:form.getAll('platforms')};}
function fillInput(input){if(!input)return;for(const k of ['source_text','audience','goal','language','media_kind'])$(k).value=input[k]||'';for(const c of document.querySelectorAll('[name=platforms]'))c.checked=input.platforms?.includes(c.value)===true;sourceDirty=false;syncMedia();}
function syncMedia(){if(selectedAsset){$('media_kind').value=selectedAsset.media_kind;$('media_kind').disabled=true;}else{$('media_kind').disabled=false;}if(selectedPortal){for(const c of document.querySelectorAll('[name=platforms]'))c.checked=c.value===selectedPortal;if(selectedPortal==='youtube'){$('media_kind').value='video';$('media_kind').disabled=true;}}const yt=document.querySelector('[name=platforms][value=youtube]');yt.disabled=$('media_kind').value==='image';if(yt.disabled)yt.checked=false;}
function caption(d,body){return [body.trim(),d.hashtags.map(x=>'#'+x).join(' '),(current.preview.language==='en'?'🛒 Visit our shop: ':'🛒 Zum Shop: ')+current.preview.shop_url].filter(Boolean).join('\n\n');}
function render(data){
 if(signedOut)throw Error(messages.AUTH_REQUIRED);
 if(data.status!=='completed'||!data.preview||data.preview.can_publish!==false)throw Error(errorText(data));
 current=data;$('drafts').replaceChildren();const url=data.preview.shop_url;
 if(!/^https:\/\/sma-automation\.com\/app\/shop\.html\?shop=[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url))throw Error('Die Shop-Adresse ist ungültig.');
 $('shopLink').textContent=url;$('shopLink').href=url;
 const visibleDrafts=data.preview.drafts.filter(d=>!selectedPortal||d.platform===selectedPortal);
 if(!visibleDrafts.length)throw Error('Für dieses Portal ist noch keine Vorschau gespeichert.');
 for(const d of visibleDrafts){const card=document.createElement('article');card.className='card draft';card.dataset.platform=d.platform;const h=document.createElement('h3');h.textContent=names[d.platform];card.append(h);
  for(const [key,label,max] of [['title','Titel / Einstieg',80],['body','Beitragstext',1200]]){const box=document.createElement('div');box.className='field';const l=document.createElement('label');l.htmlFor=d.platform+'-'+key;l.textContent=label;const control=document.createElement(key==='body'?'textarea':'input');control.id=l.htmlFor;control.dataset.field=key;control.maxLength=max;control.value=d[key];control.required=true;box.append(l,control);card.append(box);}
  const tags=document.createElement('p');tags.className='tags';tags.textContent=d.hashtags.map(x=>'#'+x).join(' ');card.append(tags);
  const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Gesamten Text mit Shop-Link ansehen';const full=document.createElement('div');full.className='caption';full.textContent=d.caption;details.append(summary,full);card.append(details);
  if(d.review_notes.length){const notes=document.createElement('ul');notes.className='note';for(const text of d.review_notes){const li=document.createElement('li');li.textContent=text;notes.append(li);}card.append(notes);}
  card.addEventListener('input',()=>{full.textContent=caption(d,card.querySelector('textarea').value);dirty=true;$('saveStatus').textContent='Ungespeicherte Änderungen';});$('drafts').append(card);
 }
 dirty=false;if(selectedAsset){assignmentRevision=data.assignment_revision??assignmentRevision;selectedAsset.assignments=(selectedAsset.assignments||[]).filter(a=>a.platform!==selectedPortal).concat([{platform:selectedPortal,revision:assignmentRevision,status:'assigned'}]);}$('result').hidden=false;$('saveStatus').textContent=selectedAsset?'Dieser Datei und diesem Portal zugeordnet':'Textvorlage gespeichert';if(selectedPortal)$('sourcePanel').open=false;
}
async function waitForResult(id){for(let i=0;i<50;i++){const r=await rpc('get',{},id);if(r.status==='completed')return r;if(r.status==='failed')throw Error(errorText(r));if(r.status==='empty')throw Error('Die Anfrage ist noch nicht angekommen. Du kannst sie erneut versuchen.');await new Promise(resolve=>setTimeout(resolve,3000));}throw Error('Die Erstellung läuft noch. Bitte lade gleich die letzte Vorschau.');}
async function fileRpc(action,input={}){const {data,error}=await supabase.rpc('sma_publication_files_v1',{p_action:action,p_input:input});if(error)throw Error(messages.FILE_SYNC_UNAVAILABLE);if(!data?.ok)throw Error(errorText(data));return data;}
function fileContext(){return {asset_id:selectedAsset.id,asset_revision:selectedAsset.revision,platform:selectedPortal,assignment_revision:assignmentRevision};}
function fileChanged(){if(window.parent!==window)window.top.postMessage({type:'sma-publication-file-updated'},location.origin);}
function clearDraft(){resetMagic();current=null;dirty=false;sourceDirty=false;attempt=null;$('result').hidden=true;$('drafts').replaceChildren();$('sourcePanel').open=true;$('source_text').value='';}
function fileFitsPortal(file){return !(file.media_kind==='image'&&['youtube','tiktok'].includes(selectedPortal));}
function renderSelectedFile(){
 $('selectedFileName').textContent=selectedAsset?selectedAsset.name:'Noch keine Datei ausgewählt';
 $('assetStatus').textContent=selectedAsset?'Ausgewählte Datei · '+(selectedAsset.media_kind==='image'?'Bild':'Video'):'„Dateien durchsuchen“ öffnet dein Gerät. Bereits hochgeladene Dateien findest du unter „Kundenordner öffnen“.';
}
function renderFilePicker(){
 const query=$('fileSearch').value.trim().toLocaleLowerCase('de');
 const visible=assets.filter(f=>f.name.toLocaleLowerCase('de').includes(query));
 const count=Math.max(1,Math.ceil(visible.length/10));filePickerPage=Math.min(filePickerPage,count-1);
 $('filePickerList').replaceChildren();
 $('filePickerCount').textContent=!assets.length?'Noch keine Dateien geladen. Klicke auf „Dateien aktualisieren“.':!visible.length?'Keine Datei mit diesem Namen gefunden.':visible.length+' '+(visible.length===1?'Datei':'Dateien')+(query?' gefunden':' in deinem Kundenordner');
 for(const file of visible.slice(filePickerPage*10,filePickerPage*10+10)){
  const row=document.createElement('li');row.className='file-picker-row';
  const info=document.createElement('div');info.className='file-picker-info';const name=document.createElement('strong');name.textContent=file.name;
  const meta=document.createElement('small');const parts=[file.media_kind==='image'?'Bild':'Video'];
  if(file.mime_type)parts.push(file.mime_type.split('/')[1].toUpperCase());
  if(Number.isFinite(file.size_bytes))parts.push(file.size_bytes<1000000?Math.max(1,Math.round(file.size_bytes/1000))+' kB':(file.size_bytes/1000000).toLocaleString('de',{maximumFractionDigits:1})+' MB');
  meta.textContent=parts.join(' · ');info.append(name,meta);
  const fits=fileFitsPortal(file);if(!fits){const reason=document.createElement('small');reason.textContent='Für '+names[selectedPortal]+' wird hier eine Videodatei benötigt.';info.append(reason);}
  const choose=document.createElement('button');choose.type='button';choose.textContent=selectedAsset?.id===file.id?'Ausgewählt':fits?'Auswählen':'Video benötigt';choose.disabled=busy||!fits;choose.setAttribute('aria-label',(fits?'Datei auswählen: ':'Nicht auswählbar: ')+file.name);
  choose.addEventListener('click',()=>requestFileSelection(file.id));row.append(info,choose);$('filePickerList').append(row);
 }
 $('filePickerPages').hidden=count<=1;$('filePageCount').textContent='Seite '+(filePickerPage+1)+' von '+count;
 $('filePrevious').disabled=busy||filePickerPage===0;$('fileNext').disabled=busy||filePickerPage>=count-1;
}
function openFilePicker(trigger){
 if(busy||!selectedPortal)return;pickerTrigger=trigger;filePickerPage=0;pendingAssetId=null;$('fileSearch').value='';$('filePickerStatus').textContent='';$('fileSwitchNotice').hidden=true;renderFilePicker();
 if(!$('filePicker').open)$('filePicker').showModal();$('fileSearch').focus();
}
async function requestFileSelection(id,discard=false){
 if(busy)return;const file=id?assets.find(f=>f.id===id):null;
 if(id&&(!file||!fileFitsPortal(file)))return;
 if((selectedAsset?.id||'')===id){$('filePicker').close();return;}
 if((dirty||sourceDirty)&&!discard){pendingAssetId=id;$('fileSwitchMessage').textContent='Du hast ungespeicherte Änderungen. Zum Wechsel zu „'+(file?.name||'Allgemeine Textvorlage')+'“ kannst du sie verwerfen oder zuerst behalten und speichern.';$('fileSwitchNotice').hidden=false;$('fileSwitchNotice').scrollIntoView({block:'nearest'});$('cancelFileSwitch').focus();return;}
 pendingAssetId=null;$('fileSwitchNotice').hidden=true;selectedAsset=file;assignmentRevision=file?.assignments?.find(a=>a.platform===selectedPortal)?.revision||0;
 $('filePicker').close();clearDraft();renderSelectedFile();syncMedia();$('assetPanel').scrollIntoView({block:'start'});await loadLatest();
}
const uploadEndpoint='https://johnmusic.app.n8n.cloud/webhook/sma-publication-device-upload-v1';
Object.assign(messages,{UPLOAD_FORMAT:'Bitte wähle eine Bild- oder Videodatei, zum Beispiel JPG, PNG, HEIC, MP4 oder MOV. Dokumentdateien wie PDF oder Word können über diesen Veröffentlichungsweg nicht gepostet werden.',UPLOAD_SIZE:'Bitte wähle eine nicht leere Datei bis 4 GB.',UPLOAD_RATE_LIMITED:'Das Uploadlimit ist erreicht (30 Dateien pro Stunde, 20 GB pro Tag). Bitte versuche es später erneut.',UPLOAD_UNAVAILABLE:'Der Upload ist momentan nicht erreichbar. Du kannst die Übertragung erneut versuchen.',UPLOAD_NETWORK:'Die Verbindung wurde unterbrochen. Klicke auf „Upload fortsetzen“.',UPLOAD_EXPIRED:'Die Uploadsitzung ist abgelaufen. Bitte wähle die Datei erneut über „Dateien durchsuchen“.',UPLOAD_INITIALIZING:'Der Upload wird noch vorbereitet. Bitte versuche „Upload fortsetzen“ in zwei Minuten erneut.',UPLOAD_INCOMPLETE:'Die hochgeladene Datei konnte noch nicht bestätigt werden. Bitte klicke auf „Upload fortsetzen“.',UPLOAD_CONFLICT:'Die Datei hat sich geändert. Bitte wähle sie erneut aus.'});
let deviceUpload=null,uploadController=null;
function chooseDeviceFile(){if(busy||signedOut||!selectedPortal)return;$('deviceFile').value='';$('deviceFile').accept=['youtube','tiktok'].includes(selectedPortal)?'video/*':'image/*,video/*';$('deviceFile').click();}
$('deviceBrowse').addEventListener('click',chooseDeviceFile);
$('deviceBrowseResult').addEventListener('click',chooseDeviceFile);
async function uploadCall(body,signal){
 const auth=await session();signal.throwIfAborted();
 const response=await fetch(uploadEndpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.access_token},body:JSON.stringify(body),credentials:'omit',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(90000)])});
 const data=await response.json();signal.throwIfAborted();if(!response.ok||!data?.ok)throw Error(data?.code||'UPLOAD_UNAVAILABLE');
 if(data.upload_id!==body.upload_id||data.can_publish!==false)throw Error('UPLOAD_UNAVAILABLE');return data;
}
async function runDeviceUpload(){
 if(busy||signedOut||!deviceUpload)return;
 const job=deviceUpload,controller=new AbortController();uploadController=controller;lock(true);
 $('uploadPanel').hidden=false;$('retryUpload').hidden=true;$('cancelUpload').hidden=false;$('uploadStatus').textContent='„'+job.file.name+'“ wird für deinen Kundenordner vorbereitet …';
 let completed=null;
 try{
  let data=await uploadCall({action:'start',upload_id:job.id,...job.meta},controller.signal);
  if(data.status!=='completed'){
   if(data.status!=='ready')throw Error('UPLOAD_UNAVAILABLE');
   await transferDeviceFile({file:job.file,url:data.upload_url,mime:job.meta.mime_type,signal:controller.signal,onProgress:(bytes,total)=>{if(signedOut||controller.signal.aborted)return;const percent=Math.floor(bytes/total*100);$('uploadProgress').value=percent;$('uploadStatus').textContent='„'+job.file.name+'“ · '+percent+' % hochgeladen';}});
   $('uploadStatus').textContent='Übertragung abgeschlossen. Die Datei wird deinem Kundenordner zugeordnet …';
   data=await uploadCall({action:'finish',upload_id:job.id},controller.signal);
  }
  if(data.status!=='completed'||typeof data.asset_id!=='string')throw Error('UPLOAD_INCOMPLETE');
  await loadFiles();controller.signal.throwIfAborted();
  if(!assets.some(f=>f.id===data.asset_id))throw Error('UPLOAD_INCOMPLETE');
  completed=data.asset_id;deviceUpload=null;$('deviceFile').value='';$('uploadProgress').value=100;
  $('uploadStatus').textContent='„'+job.file.name+'“ wurde hochgeladen. Die Medienprüfung folgt separat.';fileChanged();
 }catch(e){
  if(!signedOut){$('uploadStatus').textContent=controller.signal.aborted?'Upload angehalten. Mit „Upload fortsetzen“ kannst du weitermachen.':errorText({code:e.message});$('retryUpload').hidden=false;}
 }finally{uploadController=null;$('cancelUpload').hidden=true;lock(false);}
 if(completed&&!signedOut){if(dirty||sourceDirty)openFilePicker($('deviceBrowse'));await requestFileSelection(completed);}
}
$('deviceFile').addEventListener('change',async()=>{
 if(busy||signedOut)return;const file=$('deviceFile').files?.[0];if(!file)return;
 try{const meta=deviceFileMetadata(file,selectedPortal);deviceUpload={id:crypto.randomUUID(),file,meta};$('uploadProgress').value=0;await runDeviceUpload();}
 catch(e){$('uploadPanel').hidden=false;$('uploadStatus').textContent=errorText({code:e.message});$('retryUpload').hidden=true;$('cancelUpload').hidden=true;}
});
$('retryUpload').addEventListener('click',runDeviceUpload);
$('cancelUpload').addEventListener('click',()=>uploadController?.abort());
window.addEventListener('beforeunload',event=>{if(uploadController){event.preventDefault();event.returnValue='';}});

$('browseFiles').addEventListener('click',()=>openFilePicker($('browseFiles')));
$('browseResultFiles').addEventListener('click',()=>openFilePicker($('browseResultFiles')));
$('closeFilePicker').addEventListener('click',()=>$('filePicker').close());
$('filePicker').addEventListener('close',()=>{pendingAssetId=null;$('fileSwitchNotice').hidden=true;if(!busy)(pickerTrigger||$('browseFiles')).focus();});
$('fileSearch').addEventListener('input',()=>{filePickerPage=0;renderFilePicker();});
$('filePrevious').addEventListener('click',()=>{if(!busy&&filePickerPage>0){filePickerPage--;renderFilePicker();}});
$('fileNext').addEventListener('click',()=>{if(!busy&&!$('fileNext').disabled){filePickerPage++;renderFilePicker();}});
$('chooseGeneralTemplate').addEventListener('click',()=>requestFileSelection(''));
$('confirmFileSwitch').addEventListener('click',()=>pendingAssetId!==null?requestFileSelection(pendingAssetId,true):undefined);
$('cancelFileSwitch').addEventListener('click',()=>{pendingAssetId=null;$('fileSwitchNotice').hidden=true;});
async function loadFiles(preferredId=null){
 const r=await fileRpc('list');if(signedOut)return;assets=r.files||[];const old=preferredId??selectedAsset?.id??'';
 selectedAsset=assets.find(f=>f.id===old&&fileFitsPortal(f))||null;
 assignmentRevision=selectedAsset?.assignments?.find(a=>a.platform===selectedPortal)?.revision||0;renderSelectedFile();renderFilePicker();
 if(old&&!selectedAsset){clearDraft();resetMediaCheck(messages.FILE_UNAVAILABLE);throw Error(messages.FILE_UNAVAILABLE);}
}
function resetMediaCheck(message='Wähle zuerst eine Datei aus.'){
 reviewStatus=null;$('contentReviewStatus').textContent=selectedAsset?'Für diese Datei liegt noch kein Prüfergebnis vor.':'Wähle zuerst eine Datei aus.';syncReviewButton();
 $('mediaSummary').textContent='Medienprüfung · '+(selectedAsset?'noch offen':'Datei auswählen');
 $('mediaStatus').textContent=message;$('mediaFacts').textContent='';$('mediaChecks').replaceChildren();$('mediaScope').textContent='';$('mediaRecommendations').replaceChildren();$('mediaRecommendationsPanel').hidden=true;$('mediaPanel').open=false;
}
async function loadMediaCheck(){
 resetMediaCheck();if(!selectedAsset)return;
 const file=selectedAsset;resetMediaCheck('Die Dateiangaben werden geprüft …');
 try{
  const r=await fileRpc('check',{asset_id:file.id,asset_revision:file.revision,platform:selectedPortal});
  if(selectedAsset?.id!==file.id||selectedAsset?.revision!==file.revision)return;
  const m=r.media_check;
  if(!m||m.can_publish!==false||m.asset_id!==file.id||m.asset_revision!==file.revision||!['needs_review','needs_changes'].includes(m.status)||!Array.isArray(m.checks))throw Error('Die Medienprüfung ist noch nicht verfügbar.');
  const changes=m.status==='needs_changes';$('mediaSummary').textContent='Medienprüfung · '+(changes?'Überarbeitung nötig':'weitere Prüfung nötig');$('mediaStatus').textContent=(m.profile||'Datei')+': '+(changes?'Bitte korrigiere die markierten Punkte.':'Die Vorprüfung ist vorhanden. Offene Punkte sind unten aufgeführt.');
  $('mediaScope').textContent=typeof m.scope_notice==='string'?m.scope_notice:'';
  const f=m.facts||{};const facts=[];if(f.mime_type)facts.push(f.mime_type);if(Number.isFinite(f.size_bytes))facts.push(f.size_bytes<1000?f.size_bytes+' Byte':f.size_bytes<1000000?(f.size_bytes/1000).toLocaleString('de-DE',{maximumFractionDigits:2})+' kB':(f.size_bytes/1000000).toLocaleString('de-DE',{maximumFractionDigits:2})+' MB');if(f.width_px&&f.height_px)facts.push(f.width_px+' × '+f.height_px+' Pixel');if(Number.isFinite(f.duration_ms))facts.push((f.duration_ms/1000).toLocaleString('de-DE',{maximumFractionDigits:2})+' Sekunden');$('mediaFacts').textContent=(m.facts_source==='drive_metadata'?'Von Drive gemeldete Dateiangaben: ':'Dateiangaben: ')+facts.join(' · ');
  const order={fail:0,pending:1,pass:2};for(const c of [...m.checks].sort((a,b)=>(order[a.status]??3)-(order[b.status]??3))){if(!Object.hasOwn(order,c.status)||typeof c.message!=='string')continue;const li=document.createElement('li');li.dataset.state=c.status;li.textContent=({fail:'Zu korrigieren: ',pending:'Noch offen: ',pass:'Geprüft: '})[c.status]+c.message;$('mediaChecks').append(li);}
  if(Array.isArray(m.recommendations)){for(const item of m.recommendations){if(!item||!['matches','suggested','unknown'].includes(item.status)||typeof item.message!=='string')continue;const li=document.createElement('li');li.textContent=item.message;$('mediaRecommendations').append(li);}}
  $('mediaRecommendationsPanel').hidden=!$('mediaRecommendations').children.length;
  if(m.content_review)renderReview(m.content_review,file);
  $('mediaPanel').open=changes;
 }catch(e){if(selectedAsset?.id===file.id)resetMediaCheck(e.message);}
}
function syncReviewButton(){ $('reviewContent').disabled=busy||!selectedAsset||selectedAsset.media_kind==='video'||reviewStatus==='completed'||reviewStatus==='processing'; }
function renderReview(r,file){
 if(!r||r.can_publish!==false||r.asset_id!==file.id||r.asset_revision!==file.revision||r.policy_version!=='visual-2026-11-01.1'||!['unreviewed','processing','completed','failed'].includes(r.status))throw Error(messages.REVIEW_INCOMPLETE);
 if(selectedAsset?.id!==file.id||selectedAsset?.revision!==file.revision)return;
 reviewStatus=r.status;let message='Für diesen Dateistand liegt noch keine visuelle Sicherheitsprüfung vor.';
 if(file.media_kind==='video'&&r.status==='unreviewed')message=messages.VIDEO_PLAN_REQUIRED;
 if(r.status==='processing')message='Die visuelle Sicherheitsprüfung läuft. Du kannst den Status erneut laden.';
 if(r.status==='failed')message=messages[r.error_code]||messages.REVIEW_UNAVAILABLE;
 if(r.status==='completed'){
  if(r.result?.can_publish!==false||!['clear','needs_review'].includes(r.result?.outcome))throw Error(messages.REVIEW_INCOMPLETE);
  message=r.result.outcome==='clear'?'Visuell geprüft: keine Auffälligkeit unter den SMA-Prüfgrenzen. Die endgültige Freigabe steht noch aus.':'Visuell geprüft: mögliche Auffälligkeiten – bitte den Inhalt vor der Freigabe prüfen.';
  const labels={nudity:'Nacktheit / sexuelle Inhalte',violence:'Gewalt',weapons:'Waffen',gore:'drastische Darstellungen',hate:'Hasssymbole',drugs:'Drogen',self_harm:'Selbstverletzung'};
  const labelsFound=(r.result.categories||[]).map(c=>labels[c]).filter(Boolean);if(labelsFound.length)message+=' Hinweise: '+labelsFound.join(', ')+'.';
  if(file.media_kind==='video')message+=' Geprüft wurden '+r.result.frames_checked+' Einzelbilder im Abstand von ungefähr einer Sekunde; Ton ist nicht enthalten.';
 }
 $('contentReviewStatus').textContent=message;syncReviewButton();
}
$('reviewContent').addEventListener('click',async()=>{
 if(busy||!selectedAsset||selectedAsset.media_kind==='video'||['processing','completed'].includes(reviewStatus))return;const file=selectedAsset;lock(true);$('contentReviewStatus').textContent='Die visuelle Sicherheitsprüfung wird gestartet …';
 try{
  const auth=await session();const response=await fetch(reviewEndpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.access_token},body:JSON.stringify({asset_id:file.id,asset_revision:file.revision}),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(45000)});
  const d=await response.json();if(!response.ok||!d?.ok)throw Error(errorText(d));renderReview(d.review,file);
  for(let i=0;i<48&&reviewStatus==='processing';i++){
   await new Promise(resolve=>setTimeout(resolve,5000));if(selectedAsset?.id!==file.id||selectedAsset?.revision!==file.revision)return;
   const {data,error}=await supabase.rpc('sma_publication_review_v1',{p_action:'get',p_input:{asset_id:file.id,asset_revision:file.revision}});if(error||!data?.ok)throw Error(errorText(data));renderReview(data.review,file);
  }
  if(selectedAsset?.id===file.id){await loadMediaCheck();$('mediaPanel').open=true;}
 }catch(e){if(selectedAsset?.id===file.id){reviewStatus=null;$('contentReviewStatus').textContent=e.message;}}finally{lock(false);}
});
async function loadLatest(){lock(true);try{
 await loadMediaCheck();
 const data=selectedAsset?await fileRpc('get',{asset_id:selectedAsset.id,platform:selectedPortal}):await rpc('latest',selectedPortal?{platform:selectedPortal}:{});
 if(signedOut)return;
 if(data.status==='empty'){clearDraft();status(selectedAsset?'Für diese Datei und dieses Portal ist noch kein Text vorbereitet.':'Noch keine Textvorlage gespeichert.');return;}
 fillInput(data.input);const result=data.status==='processing'?await waitForResult(data.id):data;if(result.status==='failed')throw Error(errorText(result));render(result);status(selectedAsset?'Zugeordneten Text für '+selectedAsset.name+' geladen.':'Gespeicherte Textvorlage geladen.');
 }catch(e){if(selectedAsset)clearDraft();status(e.message,true);}finally{lock(false);syncMedia();await loadMagicEffect(true);}}

function resetMagic(){magicState=null;$('magicPanel').hidden=!selectedAsset||selectedAsset.media_kind!=='image';$('magicStatus').textContent='';$('magicSummary').textContent='';$('magicApplied').hidden=true;$('magicApplied').textContent='';$('applyMagic').hidden=true;syncMagicButton();}
function magicPhotoHint(file=selectedAsset){
 if(!file||file.media_kind!=='image')return '';
 const formatUnsupported=file.mime_type&&!['image/jpeg','image/png','image/webp'].includes(file.mime_type);
 const sizeUnsupported=Number.isFinite(file.size_bytes)&&(file.size_bytes<1||file.size_bytes>12000000);
 return formatUnsupported||sizeUnsupported?'Für die automatische Fotoerkennung wähle ein statisches JPG, PNG oder WebP bis 12 MB. Du kannst den Inhalt dieser Datei unter „Inhalt und Ziel“ selbst beschreiben.':'';
}
function syncMagicButton(){
 $('recognizePhoto').disabled=busy||!selectedAsset||selectedAsset.media_kind!=='image'||!!magicPhotoHint()||magicState?.status==='completed';
 $('recognizePhoto').textContent=magicState?.status==='processing'?'Erkennungsstand laden':magicState?.status==='failed'?'Foto erneut erkennen':'Foto erkennen';$('applyMagic').disabled=busy;
}
function magicErrorText(code){return ({MEDIA_UNSUPPORTED:'Die automatische Fotoerkennung unterstützt statische JPG-, PNG- und WebP-Bilder bis 12 MB. Bitte wähle ein passendes Foto oder beschreibe den Inhalt selbst.',MAGIC_TIMEOUT:'Die Fotoerkennung wurde nicht rechtzeitig abgeschlossen. Du kannst sie erneut starten.',MAGIC_RATE_LIMITED:'Bitte warte etwas, bevor du weitere Fotos erkennen lässt.',MAGIC_PHOTO_REQUIRED:'Der Magic Effect benötigt hier ein Foto.',MAGIC_RUNNING:'Eine Fotoerkennung läuft bereits.'})[code]||messages[code]||'Die Fotoerkennung konnte nicht abgeschlossen werden. Bitte versuche es erneut.';}
function photoStillSelected(file){return selectedAsset?.id===file.id&&selectedAsset?.revision===file.revision;}
function showMagic(r,file){
 if(!photoStillSelected(file))return false;
 if(!r||r.asset_id!==file.id||r.asset_revision!==file.revision||r.policy_version!=='magic-photo-2026-11-02.1'||r.can_publish!==false)throw Error('Für dieses Foto liegt noch kein vollständiges Erkennungsergebnis vor.');
 if(!['unrecognized','processing','failed','completed'].includes(r.status))throw Error('Die Fotoerkennung ist noch nicht vollständig.');
 if(r.status==='completed'){
  const v=r.result;
  if(!v||v.can_publish!==false||v.requires_confirmation!==true||typeof v.description!=='string'||!v.description.trim()||typeof v.source_text!=='string'||v.source_text.length<30||v.source_text.length>8000||!Array.isArray(v.uncertainties)||v.uncertainties.some(x=>typeof x!=='string'))throw Error('Die Fotoerkennung ist noch nicht vollständig.');
 }
 magicState=r;$('magicPanel').hidden=false;
 const labels={unrecognized:'Dieses Foto wurde noch nicht erkannt.',processing:'Der Magic Effect erkennt das Motiv und liest sichtbare Aufschriften …',failed:magicErrorText(r.error_code)};
 $('magicStatus').textContent=labels[r.status]||'';
 if(r.status==='completed'){
  const v=r.result;
  $('magicSummary').textContent=v.description+(v.uncertainties.length?'\nNoch zu prüfen: '+v.uncertainties.join(' '):'');
  const unclear=v.subject_type==='unclear';$('applyMagic').hidden=unclear;
  $('magicStatus').textContent=unclear?'Das Motiv ist nicht sicher erkennbar. Bitte beschreibe es selbst oder verwende ein deutlicheres Foto.':'Foto erkannt. Prüfe die Beschreibung und die lesbaren Aufschriften.';
  if(!unclear&&!sourceDirty&&!$('source_text').value.trim()){$('source_text').value=v.source_text;$('sourcePanel').open=true;$('magicStatus').textContent='Foto erkannt. Die Beschreibung wurde unter „Inhalt und Ziel“ eingefügt.';}
 }
 syncMagicButton();return true;
}
async function magicRpc(file){const {data,error}=await supabase.rpc('sma_publication_magic_v1',{p_action:'get',p_input:{asset_id:file.id,asset_revision:file.revision}});if(error||!data?.ok)throw Error('Die Fotoerkennung ist gerade nicht verfügbar.');return data.analysis;}
async function loadMagicEffect(autoStart=false){
 const file=selectedAsset;resetMagic();if(!file||file.media_kind!=='image')return;
 const hint=magicPhotoHint(file);if(hint){$('magicStatus').textContent=hint;return;}
 try{
  const r=await magicRpc(file);if(!showMagic(r,file))return;
  if(autoStart&&(r.status==='processing'||(r.status==='unrecognized'&&!sourceDirty&&!$('source_text').value.trim()&&/^(sha256:[a-f0-9]{64}|md5:[a-f0-9]{32}):\d+$/.test(file.revision))))await recognizePhoto();
 }catch(e){if(photoStillSelected(file))$('magicStatus').textContent=e.message;}
}
async function recognizePhoto(){
 if(busy||!selectedAsset||selectedAsset.media_kind!=='image'||magicState?.status==='completed')return;
 const hint=magicPhotoHint();if(hint){$('magicStatus').textContent=hint;return;}
 const file=selectedAsset;lock(true);$('magicStatus').textContent='Der Magic Effect wird gestartet …';
 try{
  if(magicState?.status!=='processing'){
   const auth=await session();const response=await fetch(magicEndpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.access_token},body:JSON.stringify({asset_id:file.id,asset_revision:file.revision}),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(25000)});
   const d=await response.json();if(!response.ok||!d.ok)throw Error(magicErrorText(d?.code));
   if(!showMagic(d.analysis,file))return;
  }
  for(let i=0;i<80&&magicState?.status==='processing';i++){
   await new Promise(resolve=>setTimeout(resolve,3000));if(!photoStillSelected(file))return;
   if(!showMagic(await magicRpc(file),file))return;
  }
  if(photoStillSelected(file)&&magicState?.status==='processing')$('magicStatus').textContent='Die Fotoerkennung läuft noch. Klicke auf „Erkennungsstand laden“, um das Ergebnis weiter abzurufen.';
 }catch(e){if(photoStillSelected(file))$('magicStatus').textContent=e.message;}
 finally{if(photoStillSelected(file))lock(false);}
}
$('recognizePhoto').addEventListener('click',recognizePhoto);
$('applyMagic').addEventListener('click',()=>{
 if(busy||magicState?.status!=='completed'||magicState.asset_id!==selectedAsset?.id||magicState.asset_revision!==selectedAsset?.revision||magicState.result?.subject_type==='unclear')return;
 $('source_text').value=magicState.result.source_text;$('sourcePanel').open=true;sourceDirty=true;attempt=null;
 const message='Erkannter Inhalt übernommen. Prüfe die Beschreibung und klicke anschließend auf „'+$('generate').textContent+'“.';
 $('magicStatus').textContent=message;$('magicApplied').textContent=message;$('magicApplied').hidden=false;
 $('source_text').focus({preventScroll:true});$('sourcePanel').scrollIntoView({block:'start'});
});

async function refreshFiles(){
 if(busy)return;if(dirty||sourceDirty){const message='Bitte speichere zuerst deine Änderungen oder wähle eine Datei und bestätige das Verwerfen.';status(message,true);$('filePickerStatus').textContent=message;return;}
 lock(true);try{status('Dein Kundenordner wird geprüft …');$('filePickerStatus').textContent='Dein Kundenordner wird geprüft …';const auth=await session();const r=await fetch(fileEndpoint,{method:'POST',headers:{Authorization:'Bearer '+auth.access_token},credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(90000)});const d=await r.json();if(!r.ok||!d.ok)throw Error(errorText(d));await loadFiles();fileChanged();await loadLatest();$('filePickerStatus').textContent='Dateiliste aktualisiert.';}catch(e){status(e.message,true);$('filePickerStatus').textContent=e.message;}finally{lock(false);syncMedia();}
}
$('refreshFiles').addEventListener('click',refreshFiles);
$('pickerRefresh').addEventListener('click',refreshFiles);
$('previewForm').addEventListener('input',()=>{sourceDirty=true;attempt=null;});
$('media_kind').addEventListener('change',syncMedia);
$('loadLatest').addEventListener('click',()=>{if(!busy)loadLatest();});
$('previewForm').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;const input=sourceInput();if(!input.platforms.length){status(messages.INVALID_INPUT,true);return;}
 const signature=JSON.stringify({input,asset_id:selectedAsset?.id,asset_revision:selectedAsset?.revision});if(!attempt||attempt.signature!==signature||attempt.finished)attempt={signature,id:crypto.randomUUID(),finished:false};
 lock(true);status('Eigene Texte je Portal werden erstellt und der Shop-Link wird geprüft …');
 try{const auth=await session();let data;
  try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.access_token},body:JSON.stringify({...input,request_id:attempt.id}),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(110000)});if(!response.ok)throw Error('NETWORK');data=await response.json();}
  catch{status('Die Rückmeldung dauert länger. Der gespeicherte Status wird geprüft …');data=await waitForResult(attempt.id);}
  if(!data?.ok){attempt.finished=true;throw Error(errorText(data));}if(data.status==='processing')data=await waitForResult(data.id);
  if(data.status==='failed'){attempt.finished=true;throw Error(errorText(data));}attempt.finished=true;if(selectedAsset){data=await fileRpc('assign',{...fileContext(),preview_id:data.id,preview_revision:data.revision});const bound=selectedAsset.assignments?.find(a=>a.platform===selectedPortal);if(bound)bound.revision=data.assignment_revision;fileChanged();}render(data);sourceDirty=false;status('Die Textvorschau ist gespeichert. Prüfe jetzt die Inhalte und passe sie bei Bedarf an.');
 }catch(e){status(e.message,true);}finally{lock(false);syncMedia();}
});
$('save').addEventListener('click',async()=>{if(busy||!current)return;const edits=[...$('drafts').children].map(card=>({platform:card.dataset.platform,title:card.querySelector('[data-field=title]').value.trim(),body:card.querySelector('[data-field=body]').value.trim()}));const drafts=current.preview.drafts.map(d=>edits.find(e=>e.platform===d.platform)||{platform:d.platform,title:d.title,body:d.body});if(drafts.some(d=>!d.title||d.title.length>80||d.body.length<10||d.body.length>1200)){status(messages.INVALID_EDIT,true);return;}lock(true);$('saveStatus').textContent='Wird gespeichert …';try{const result=selectedAsset?await fileRpc('save',{...fileContext(),title:edits[0].title,body:edits[0].body}):await rpc('save',{revision:current.revision,drafts},current.id);render(result);if(selectedAsset){const bound=selectedAsset.assignments?.find(a=>a.platform===selectedPortal);if(bound)bound.revision=result.assignment_revision;fileChanged();}status('Änderungen gespeichert. Der Shop-Link ist weiterhin enthalten.');}catch(e){status(e.message,true);$('saveStatus').textContent='Änderungen noch nicht gespeichert';}finally{lock(false);syncMedia();}});
supabase.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){signedOut=true;uploadController?.abort();deviceUpload=null;$('deviceFile').value='';$('uploadPanel').hidden=true;$('uploadStatus').textContent='';lock(true);$('result').hidden=true;current=null;assets=[];selectedAsset=null;sourceDirty=false;pendingAssetId=null;resetMagic();for(const id of ['source_text','audience','goal','fileSearch'])$(id).value='';$('fileSwitchMessage').textContent='';$('filePickerStatus').textContent='';$('fileSwitchNotice').hidden=true;if($('filePicker').open)$('filePicker').close();renderSelectedFile();renderFilePicker();$('assetStatus').textContent='';resetMediaCheck(messages.AUTH_REQUIRED);status(messages.AUTH_REQUIRED,true);}});
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&uploadController){event.preventDefault();return;}if(event.key==='Escape'&&$('filePicker').open)return;if(event.key==='Escape'&&window.parent!==window){event.preventDefault();window.top.postMessage({type:'sma-publication-preview-close'},location.origin);}});
try{await session();let ready=true;if(selectedPortal){try{await loadFiles(params.get('asset'));}catch(e){ready=false;lock(false);status(e.message,true);}}if(ready)await loadLatest();}catch(e){lock(true);status(e.message,true);}
