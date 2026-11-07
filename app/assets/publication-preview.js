import {mountGalleryMusic} from './gallery-music-worker.mjs?v=2';
import {parseHashtags,addHashtagField,hashtagMessage} from './publication-hashtags.mjs?v=1';
import {missingVideoMetadata,videoMetadataNotice} from './media-metadata.mjs?v=1';
import {mountExportCover} from './publication-export-cover.mjs?v=3';
import {mountOriginalVideo} from './original-video-preview.mjs?v=3';
let supabase,coverView,originalVideo,previewOwnerId,galleryMusic;
import {fetchAssetThumbnail,createMediaThumbnailLoader} from './asset-thumbnail.mjs?v=1';
import {deviceFileMetadata,transferDeviceFile} from './device-upload.mjs?v=1';
import {createOptimizerWorkspace} from './optimizer-workspace.mjs?v=11';
import {installOrderReview} from './publication-order.mjs?v=12';
const endpoint='https://johnmusic.app.n8n.cloud/webhook/sma-publication-preview-v1';
const $=id=>document.getElementById(id);
const names={youtube:'YouTube',instagram:'Instagram',facebook:'Facebook',tiktok:'TikTok'};
const messages={CAPTION_TOO_SIMILAR:'Dieser Text ähnelt einem bereits gespeicherten Text zu stark. Bitte ergänze passende Angaben und erstelle einen neuen Entwurf.',AUTH_REQUIRED:'Bitte melde dich erneut im SMA-Dashboard an.',ACCESS_INACTIVE:'Dein SMA-Zugang ist derzeit nicht aktiv.',ACCOUNT_UNAVAILABLE:'Dein Konto konnte nicht eindeutig zugeordnet werden.',PUBLIC_SHOP_REQUIRED:'Für dein Konto muss zuerst ein öffentlicher SMA-Shop eingerichtet sein.',RATE_LIMITED:'Bitte warte kurz. Zum Schutz vor Mehrfachanfragen gilt mindestens 30 Sekunden Abstand und höchstens 20 Vorschauen pro Stunde.',PREPARATION_RUNNING:'Eine Vorschau wird bereits erstellt. Lade in Kürze die letzte Vorschau.',REVISION_CONFLICT:'Die Vorschau wurde zwischenzeitlich geändert. Lade die letzte Vorschau, bevor du erneut speicherst.',ACCOUNT_CHANGED:'Die Shop-Zuordnung hat sich geändert. Bitte erstelle eine neue Vorschau.',INVALID_EDIT:'Bitte prüfe Titel und Text: keine zusätzlichen Links, Hashtags, @-Angaben oder „Link im Profil“. Titel maximal 80, Text 10–1200 Zeichen.',YOUTUBE_REQUIRES_VIDEO:'Für YouTube bitte Video auswählen.',PREPARATION_TIMEOUT:'Die Erstellung hat zu lange gedauert. Bitte starte eine neue Vorschau.',PREPARATION_FAILED:'Die Texte konnten nicht vollständig geprüft werden. Bitte erstelle eine neue Vorschau.',PREPARATION_UNAVAILABLE:'Die Vorschau ist gerade nicht erreichbar. Bitte versuche es erneut.',INVALID_INPUT:'Bitte prüfe deine Angaben und wähle mindestens ein Portal.'};
let current=null,busy=false,attempt=null,assets=[],selectedAsset=null,assignmentRevision=0,dirty=false;
let reviewStatus=null;
let retryHistoryPreview=false;
let orderReview=null;
let selectedMediaFacts=null;
let magicState=null,automaticMode=null,pendingAutomatic=null,automaticInputSignature=null;
let filePickerPage=0,pickerTrigger=null,pendingAssetId=null,sourceDirty=false,signedOut=false;
const videoMagicEndpoint='https://johnmusic.app.n8n.cloud/webhook/sma-publication-video-magic-effect-v1';
const magicEndpoint='https://johnmusic.app.n8n.cloud/webhook/sma-publication-magic-effect-v1';
const reviewEndpoint='https://johnmusic.app.n8n.cloud/webhook/sma-publication-content-review-v1';
Object.assign(messages,{VIDEO_PLAN_REQUIRED:'Die Videoanalyse ist im derzeitigen Sightengine-Tarif nicht freigeschaltet. Die Videoprüfung bleibt offen.',REVIEW_RUNNING:'Eine Datei wird bereits geprüft. Bitte warte kurz.',REVIEW_RATE_LIMITED:'Bitte warte kurz. Maximal sechs Prüfversuche pro Stunde mit mindestens 30 Sekunden Abstand.',CHECKSUM_REQUIRED:'Für diese Datei fehlt noch eine verlässliche Inhaltskennung. Bitte aktualisiere die Dateiliste.',MEDIA_UNSUPPORTED:'Diese Prüfung unterstützt statische JPEG-, PNG- und WebP-Bilder bis 12 MB sowie MP4-, MOV- und WebM-Videos unter 50 MB und unter 60 Sekunden. Animationen benötigen einen anderen Prüfweg.',REVIEW_INCOMPLETE:'Der Prüfdienst hat kein vollständiges Ergebnis geliefert. Die Prüfung bleibt offen.',PROVIDER_FAILED:'Der Prüfdienst konnte die Datei nicht prüfen.',REVIEW_TIMEOUT:'Die Prüfung hat zu lange gedauert. Du kannst sie erneut starten.',REVIEW_UNAVAILABLE:'Die Inhaltsprüfung ist gerade nicht erreichbar.'});
messages.INVALID_HASHTAGS=hashtagMessage;
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

const workspace=params.get('wide')==='1'&&selectedPortal?createOptimizerWorkspace(document,names[selectedPortal],()=>renderFilePicker(),{
 describeFile,
 getPreview:()=>{
  const draft=current?.preview?.drafts.find(d=>d.platform===selectedPortal);
  let hashtags=[];try{hashtags=parseHashtags($(selectedPortal+'-hashtags')?.value||'');}catch{}
  return {draft:draft?{...draft,hashtags,title:$(selectedPortal+'-title').value,body:$(selectedPortal+'-body').value,shop_url:current.preview.shop_url}:null,
   facts:selectedMediaFacts,source:$('source_text').value,language:$('language').value,
   draftStatus:draft?(dirty?'Aktuelle, noch nicht gespeicherte Änderungen':'Dieser Datei und diesem Portal zugeordnet'):''};
 },
 onView:view=>{if(view!=='preview')originalVideo?.stop();if(window.parent!==window)window.top.postMessage({type:'sma-publication-workspace-view',view},location.origin);},
}):null;
if(workspace){
 window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===window.top&&event.data?.type==='sma-publication-show-view'&&['preview','files'].includes(event.data.view))workspace.show(event.data.view);});
 let heightQueued=false;
 const sendHeight=()=>{if(heightQueued)return;heightQueued=true;requestAnimationFrame(()=>{heightQueued=false;window.top.postMessage({type:'sma-publication-preview-height',height:Math.max(300,Math.ceil(document.querySelector('main').getBoundingClientRect().height)+20)},location.origin);});};
 new ResizeObserver(sendHeight).observe(document.querySelector('main'));sendHeight();
}

function status(text,error=false){for(const id of ['status','portalStatus']){$(id).textContent=text;$(id).dataset.error=String(error);}}
function errorText(r){return messages[r?.code||r?.error_code]||'Die Anfrage konnte nicht abgeschlossen werden. Bitte versuche es erneut.';}
function lock(value){value=value||signedOut||automaticMode!==null;busy=value;orderReview?.lock(value);syncReviewButton();syncMagicButton();for(const id of ['refreshVideoMetadata','deviceBrowse','deviceBrowseResult','deviceFile','browseFiles','browseResultFiles','refreshFiles','pickerRefresh','confirmFileSwitch','chooseGeneralTemplate'])$(id).disabled=value;$('inputFields').disabled=value;$('language').disabled=value;$('save').disabled=value;for(const el of $('drafts').querySelectorAll('input,textarea'))el.disabled=value;renderFilePicker();}
async function session(){const {data,error}=await supabase.auth.getSession();if(error||!data.session)throw Error(messages.AUTH_REQUIRED);return data.session;}
async function rpc(action,input={},id=null){const {data,error}=await supabase.rpc('sma_publication_preview_v1',{p_action:action,p_input:input,p_id:id});if(error)throw Error('Die Vorschau konnte nicht geladen oder gespeichert werden.');if(!data?.ok)throw Error(errorText(data));return data;}
// Read controlled fields directly: FormData omits the disabled fields during a Magic run.
function sourceInput(){
 const english=$('language').value==='en';
 // Keep the existing caption API contract without asking customers for audience or goal.
 return {source_text:$('source_text').value.trim(),audience:english?'People interested in the content shown':'Interessierte am gezeigten Inhalt',goal:english?'Maximize relevant reach with accurate, content-specific text':'Größtmögliche relevante Reichweite mit sachlich richtigen, zum Inhalt passenden Texten',language:$('language').value,media_kind:selectedAsset?selectedAsset.media_kind:selectedPortal==='youtube'?'video':$('media_kind').value,platforms:selectedPortal?[selectedPortal]:[...document.querySelectorAll('[name=platforms]')].filter(c=>c.checked).map(c=>c.value)};
}
// Product facts stay separate from observations and from text entered by the customer.
const productPrefix='SMA-Produktangaben (Kunden-/Katalogdaten): ';
const sourceSeparator='\nDateiinhalt: ';
function originalSource(text){
 if(typeof text!=='string'||!text.startsWith(productPrefix))return text;
 const split=text.indexOf(sourceSeparator);
 if(split<0)return text;
 try{
  const facts=JSON.parse(text.slice(productPrefix.length,split));
  if(typeof facts.Produkt==='string'&&typeof facts.Einsatzzweck==='string')return text.slice(split+sourceSeparator.length);
 }catch{}
 return text;
}
function showProductContext(value,file){
 const note=$('productContext');
 note.hidden=true;note.textContent='';
 if(!value||!file||value.asset_id!==file.id||value.asset_revision!==file.revision)return null;
 if(value.state==='ambiguous'){
  note.textContent='Mehrere Produkte passen zu dieser Datei. Ergänze Produktname und Einsatzzweck in der Beschreibung.';
 }else if(value.state==='matched'&&typeof value.name==='string'&&typeof value.purpose==='string'){
  note.textContent=['Produkt: '+value.name,value.topic&&'Thema: '+value.topic,value.purpose].filter(Boolean).join(' · ');
 }else{return null;}
 note.hidden=false;return value;
}
async function getDraftProduct(context){
 if(!context)return null;
 const data=await fileRpc('product',{asset_id:context.asset_id,asset_revision:context.asset_revision,platform:context.platform});
 assertFileContext(context);
 return showProductContext(data.product_context,selectedAsset);
}
function attachProduct(input,product){
 if(product?.state!=='matched')return input;
 const info={Produkt:product.name,Thema:product.topic||'',Einsatzzweck:product.purpose};
 const source=productPrefix+JSON.stringify(info)+sourceSeparator+input.source_text;
 if(source.length>8000)throw Error('Die Produktangaben und die Dateibeschreibung sind zusammen zu lang. Bitte kürze die Dateibeschreibung.');
 return {...input,source_text:source};
}
function fillInput(input){if(!input)return;for(const k of ['source_text','language','media_kind'])$(k).value=(k==='source_text'?originalSource(input[k]):input[k])||'';for(const c of document.querySelectorAll('[name=platforms]'))c.checked=input.platforms?.includes(c.value)===true;sourceDirty=false;syncMedia();}
function syncMedia(){if(selectedAsset){$('media_kind').value=selectedAsset.media_kind;$('media_kind').disabled=true;}else{$('media_kind').disabled=false;}if(selectedPortal){for(const c of document.querySelectorAll('[name=platforms]'))c.checked=c.value===selectedPortal;if(selectedPortal==='youtube'){$('media_kind').value='video';$('media_kind').disabled=true;}}const yt=document.querySelector('[name=platforms][value=youtube]');yt.disabled=$('media_kind').value==='image';if(yt.disabled)yt.checked=false;}
function caption(d,body,tags=d.hashtags){return [body.trim(),tags.map(x=>'#'+x).join(' '),(current.preview.language==='en'?'🛒 Visit our shop: ':'🛒 Zum Shop: ')+current.preview.shop_url].filter(Boolean).join('\n\n');}
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
  const tags=addHashtagField(document,card,d.platform,d.hashtags);
  const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Gesamten Text mit Shop-Link ansehen';const full=document.createElement('div');full.className='caption';full.textContent=d.caption;details.append(summary,full);card.append(details);
  if(d.review_notes.length){const notes=document.createElement('ul');notes.className='note';for(const text of d.review_notes){const li=document.createElement('li');li.textContent=text;notes.append(li);}card.append(notes);}
  card.addEventListener('input',()=>{dirty=true;$('saveStatus').textContent='Ungespeicherte Änderungen';try{full.textContent=caption(d,card.querySelector('textarea').value,parseHashtags(tags.value));tags.setCustomValidity('');}catch(e){tags.setCustomValidity(e.message);full.textContent=e.message;}});$('drafts').append(card);
 }
 if(workspace&&selectedAsset&&selectedAsset.display?.draft_title!==visibleDrafts[0].title){
  selectedAsset.display={...selectedAsset.display,draft_title:visibleDrafts[0].title};
  workspace.selection(selectedAsset);renderFilePicker();
 }
 dirty=false;if(selectedAsset){assignmentRevision=data.assignment_revision??assignmentRevision;selectedAsset.assignments=(selectedAsset.assignments||[]).filter(a=>a.platform!==selectedPortal).concat([{platform:selectedPortal,revision:assignmentRevision,status:'assigned'}]);}$('result').hidden=false;workspace?.textAvailable(true);$('saveStatus').textContent=selectedAsset?'Dieser Datei und diesem Portal zugeordnet':'Textvorlage gespeichert';if(selectedPortal&&!workspace)$('sourcePanel').open=false;
}
async function waitForResult(id){for(let i=0;i<50;i++){const r=await rpc('get',{},id);if(r.status==='completed')return r;if(r.status==='failed')throw Error(errorText(r));if(r.status==='empty')throw Error('Die Anfrage ist noch nicht angekommen. Du kannst sie erneut versuchen.');await new Promise(resolve=>setTimeout(resolve,3000));}throw Error('Die Erstellung läuft noch. Bitte lade gleich die letzte Vorschau.');}
function fileError(code){return Object.assign(Error(errorText({code})),{code});}
async function fileRpc(action,input={}){const {data,error}=await supabase.rpc('sma_publication_files_v1',{p_action:action,p_input:input});if(error)throw fileError('FILE_SYNC_UNAVAILABLE');if(!data?.ok)throw fileError(data?.code);return data;}
function fileContext(){return {asset_id:selectedAsset.id,asset_revision:selectedAsset.revision,platform:selectedPortal,assignment_revision:assignmentRevision};}
function assertFileContext(context){
 if(signedOut)throw fileError('AUTH_REQUIRED');
 if(!context)return;
 if(selectedAsset?.id!==context.asset_id||selectedAsset?.revision!==context.asset_revision||selectedPortal!==context.platform)throw fileError('FILE_CHANGED');
 if(assignmentRevision!==context.assignment_revision)throw fileError('ASSIGNMENT_CONFLICT');
}
async function syncFileCatalog(){
 const auth=await session();if(signedOut)throw fileError('AUTH_REQUIRED');
 const response=await fetch(fileEndpoint,{method:'POST',headers:{Authorization:'Bearer '+auth.access_token},credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(90000)});
 const data=await response.json();if(signedOut)throw fileError('AUTH_REQUIRED');if(!response.ok||!data?.ok)throw fileError(data?.code||'FILE_SYNC_UNAVAILABLE');
}
function catalogFileIsFresh(file){
 const age=Date.now()-Date.parse(file.verified_at);
 return Number.isFinite(age)&&age>=0&&age<14*60*1000;
}
async function ensureFreshFile(context,force=false){
 assertFileContext(context);if(!context)return;
 // Refresh before the server's 15-minute limit. The server remains authoritative.
 if(!force&&catalogFileIsFresh(selectedAsset))return;
 status('Die Datei wird automatisch im Kundenordner geprüft. Deine Eingaben bleiben erhalten …');
 await syncFileCatalog();assertFileContext(context);
 const catalog=await optimizerCatalog();assertFileContext(context);
 if(!Array.isArray(catalog.files))throw fileError('FILE_SYNC_UNAVAILABLE');
 const latest=catalog.files.find(file=>file.id===context.asset_id);
 if(!latest)throw fileError('FILE_UNAVAILABLE');
 if(latest.revision!==context.asset_revision||latest.media_kind!==selectedAsset.media_kind)throw fileError('FILE_CHANGED');
 const bound=latest.assignments?.find(item=>item.platform===context.platform);
 if((bound?.revision||0)!==context.assignment_revision)throw fileError('ASSIGNMENT_CONFLICT');
 // Do not load a draft or replace form fields during this background refresh.
 assets=catalog.files;selectedAsset=latest;workspace?.selection(latest);renderVideoMetadata();renderFilePicker();fileChanged();status('Dateistand geprüft. Deine Eingaben sind erhalten.');
}
async function withFreshFile(context,action){
 assertFileContext(context);
 try{const result=await action();assertFileContext(context);return result;}
 catch(error){
  if(!context||error.code!=='FILE_REFRESH_REQUIRED')throw error;
  // One bounded retry also covers clock differences and a long-running request.
  await ensureFreshFile(context,true);const result=await action();assertFileContext(context);return result;
 }
}
function fileChanged(){if(window.parent!==window)window.top.postMessage({type:'sma-publication-file-updated'},location.origin);}
function clearDraft(){resetMagic();current=null;dirty=false;sourceDirty=false;attempt=null;$('result').hidden=true;workspace?.textAvailable(false);$('drafts').replaceChildren();$('sourcePanel').open=!workspace;$('source_text').value='';}
function fileFitsPortal(file){return !(file.media_kind==='image'&&['youtube','tiktok'].includes(selectedPortal));}
const pickerThumbnails=createMediaThumbnailLoader(async()=>(await session()).access_token);
let localMedia=null,mediaViewKey='',mediaViewUrl=null,mediaViewController=null;
function clearAssetPreview(){
 originalVideo?.setPoster(selectedAsset,null);
 delete $('assetPreviewStatus').dataset.cover;
 mediaViewController?.abort();mediaViewController=null;mediaViewKey='';
 for(const video of $('assetPreviewMedia').querySelectorAll('video')){video.pause();video.removeAttribute('src');video.load();}
 $('assetPreviewMedia').replaceChildren();if(mediaViewUrl)URL.revokeObjectURL(mediaViewUrl);mediaViewUrl=null;
 $('assetPreviewStatus').textContent='';$('retryAssetPreview').hidden=true;
}
function showAssetMedia(blob,kind,key,cover=null){
 if(signedOut||key!==mediaViewKey)return;
 mediaViewUrl=URL.createObjectURL(blob);const media=document.createElement(kind==='video'?'video':'img');
 if(kind==='video'){media.controls=true;media.playsInline=true;media.preload='metadata';media.setAttribute('aria-label','Ausgewähltes Video');}
 else{media.alt=selectedAsset?.media_kind==='video'?'Vorschaubild des ausgewählten Videos':'Ausgewähltes Bild';media.decoding='async';}
 media.addEventListener('error',()=>{if(mediaViewKey!==key||media.src!==mediaViewUrl)return;media.hidden=true;
  if(cover)originalVideo?.setPoster(selectedAsset,null);$('assetPreviewStatus').textContent='Diese Vorschau kann dein Browser gerade nicht anzeigen.';$('retryAssetPreview').hidden=false;});
 media.src=mediaViewUrl;$('assetPreviewMedia').replaceChildren(media);$('assetPreviewStatus').textContent='';
 if(cover){
  const caption=selectedPortal==='youtube'?'Geplantes YouTube-Titelbild':'TikTok-Covervorschau · Bild bei '+(cover.position_ms/1000).toLocaleString('de-AT')+' Sek.';
  media.alt=caption;$('assetPreviewStatus').dataset.cover='true';$('assetPreviewStatus').textContent=caption;
  originalVideo?.setPoster(selectedAsset,mediaViewUrl);
 }
}
async function loadAssetPreview({retry=false,refresh=false}={}){
 const file=selectedAsset,key=file?file.id+':'+file.revision:'';
 if(!retry&&!refresh&&key===mediaViewKey)return;
 clearAssetPreview();
 if(!file||signedOut){coverView?.clear();return;}
 mediaViewKey=key;
 const controller=new AbortController();mediaViewController=controller;$('assetPreviewStatus').textContent='Vorschau wird geladen …';
 try{
  const coverTask=coverView?.setContext(file);
  if(file.media_kind==='video'&&['youtube','tiktok'].includes(selectedPortal)){
   const result=await coverTask;controller.signal.throwIfAborted();
   if(result?.unavailable)throw Error('COVER_UNAVAILABLE');
   if(result?.cover){showAssetMedia(result.blob,'image',key,result.cover);return;}
  }
  if(localMedia?.id===file.id&&localMedia.revision===file.revision&&!retry){showAssetMedia(localMedia.file,file.media_kind,key);return;}
  const auth=await session();controller.signal.throwIfAborted();
  const blob=await fetchAssetThumbnail(file,auth.access_token,controller.signal);
  showAssetMedia(blob,'image',key);
 }catch(e){
  if(!signedOut&&!controller.signal.aborted&&mediaViewKey===key){
   $('assetPreviewStatus').textContent=e.message==='COVER_UNAVAILABLE'?'Das geplante Titelbild ist gerade nicht verfügbar.':'Vorschau noch nicht verfügbar. Deine Datei bleibt ausgewählt.';
   $('retryAssetPreview').hidden=false;
  }
 }finally{if(mediaViewController===controller)mediaViewController=null;}
}
$('retryAssetPreview').addEventListener('click',()=>loadAssetPreview({retry:true}));
window.addEventListener('pagehide',()=>{galleryMusic?.destroy();originalVideo?.destroy();coverView?.destroy();clearAssetPreview();pickerThumbnails.clear();localMedia=null;});
function renderVideoMetadata(){
 $('videoMetadataPanel').hidden=!missingVideoMetadata(selectedAsset).length;
 $('videoMetadataStatus').textContent=videoMetadataNotice(selectedAsset);
}
function readableFilename(name){
 const stem=(name||'').replace(/\.[a-z0-9]{1,8}$/i,'').trim();
 // Generated export IDs, digests, camera counters and opaque upload tokens are poor titles.
 if(!stem||/^[a-f\d]{24,}$|[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}|^(?:(?:IMG|VID|DSC|MOV)[-_ ]?)?\d{5,}$/i.test(stem))return '';
 if(/^[a-zA-Z0-9_+=-]{25,}$/.test(stem)&&/[a-z]/.test(stem)&&/[A-Z]/.test(stem)&&/\d/.test(stem)&&/[a-zA-Z0-9]{20}/.test(stem))return '';
 return stem.replace(/_/g,' ');
}
function describeFile(file){
 const video=file.media_kind==='video';
 const kind=video?'Video':'Bild';
 const musicVersion=video&&file.name?.endsWith(' – mit SMA-Musik.mp4');
 const variant=musicVersion?'Video mit SMA-Musik':{original:video?'Originalvideo':'Originalbild',clip:'Videoausschnitt',cover:'Titelbild',export:video?'Bearbeitetes Video':'Bearbeitetes Bild'}[file.display?.variant]||kind;
 const duration=video&&Number.isFinite(file.duration_ms)&&file.duration_ms>0
  ? Math.max(0.1,Math.round(file.duration_ms/100)/10).toLocaleString('de-DE')+' Sek.' : '';
 const modified=new Date(file.modified_at);
 const fallback=Number.isFinite(modified.getTime())?kind+' vom '+modified.toLocaleDateString('de-AT')+' · '+modified.toLocaleTimeString('de-AT',{hour:'2-digit',minute:'2-digit'}):kind;
 const title=file.display?.product||file.display?.draft_title||readableFilename((file.display?.source_name||'').replace(/ – mit SMA-Musik\.mp4$/,''))||readableFilename((file.name||'').replace(/ – mit SMA-Musik\.mp4$/,''))||fallback;
 return {title,version:[variant,duration].filter(Boolean).join(' · ')};
}
async function optimizerCatalog(){
 return fileRpc('list',workspace?{platform:selectedPortal}:{});
}
function renderSelectedFile(refreshCover=false){
 showProductContext(null,null);
 originalVideo?.setContext(selectedAsset);
 renderVideoMetadata();
 workspace?.selection(selectedAsset);
 $('selectedFileName').textContent=selectedAsset?(workspace?'Dateiname: ':'')+selectedAsset.name:'';
 $('noSelectedFile').hidden=!!selectedAsset;$('fileDetails').hidden=!selectedAsset;$('fileDetails').open=false;
 $('assetPreview').hidden=!selectedAsset;$('assetPreviewKind').textContent=selectedAsset?.media_kind==='video'?'Video':'Bild';
 $('assetStatus').textContent=selectedAsset?'':'„Dateien durchsuchen“ öffnet dein Gerät. Bereits hochgeladene Dateien findest du unter „Kundenordner öffnen“.';
 void loadAssetPreview({refresh:refreshCover});
}
function renderFilePicker(){
 pickerThumbnails.reset();
 const query=$('fileSearch').value.trim().toLocaleLowerCase('de');
 const visible=assets.filter(file=>{
  if(!query)return true;
  const label=describeFile(file);
  return [file.name,label.title,label.version,file.display?.draft_title].some(value=>value?.toLocaleLowerCase('de').includes(query));
 });
 if(workspace)$('workspaceFiles').classList.toggle('has-files',visible.length>0);
 const pageSize=workspace?4:10;
 const count=Math.max(1,Math.ceil(visible.length/pageSize));filePickerPage=Math.min(filePickerPage,count-1);
 $('filePickerList').replaceChildren();
 $('filePickerCount').textContent=!assets.length?'Noch keine Dateien geladen. Klicke auf „Dateien aktualisieren“.':!visible.length?'Keine Datei für diese Suche gefunden.':visible.length+' '+(visible.length===1?'Datei':'Dateien')+(query?' gefunden':' in deinem Kundenordner');
 for(const file of visible.slice(filePickerPage*pageSize,(filePickerPage+1)*pageSize)){
  const description=describeFile(file);
  const row=document.createElement('li');row.className='file-picker-row';
  const info=document.createElement('details');info.className='file-picker-info';const summary=document.createElement('summary');summary.textContent='Dateidetails';info.append(summary);const name=document.createElement('strong');name.textContent=workspace?'Dateiname: '+file.name:file.name;
  const meta=document.createElement('small');const parts=[file.media_kind==='image'?'Bild':'Video'];
  if(file.mime_type)parts.push(file.mime_type.split('/')[1].toUpperCase());
  if(Number.isFinite(file.size_bytes))parts.push(file.size_bytes<1000000?Math.max(1,Math.round(file.size_bytes/1000))+' kB':(file.size_bytes/1000000).toLocaleString('de',{maximumFractionDigits:1})+' MB');
  meta.textContent=parts.join(' · ');info.append(name,meta);
  const fits=fileFitsPortal(file);if(!fits){const reason=document.createElement('small');reason.textContent='Für '+names[selectedPortal]+' wird hier eine Videodatei benötigt.';info.append(reason);}
  const choose=document.createElement('button');choose.type='button';choose.textContent=selectedAsset?.id===file.id?'Ausgewählt':fits?'Auswählen':'Video benötigt';choose.disabled=busy||!fits;choose.setAttribute('aria-label',(fits?'Datei auswählen: ':'Nicht auswählbar: ')+(workspace?description.title+' · '+description.version:file.name));
  const visual=document.createElement('span');visual.className='gallery-visual';const label=document.createElement('span');label.className='gallery-label';label.textContent=workspace&&selectedAsset?.id===file.id?'Ausgewählt':workspace&&fits?(file.media_kind==='image'?'Bild':'Video'):choose.textContent;choose.textContent='';choose.append(visual,label);choose.className='gallery-select';choose.setAttribute('aria-pressed',String(selectedAsset?.id===file.id));
  choose.addEventListener('click',()=>requestFileSelection(file.id));row.append(choose);
  if(workspace){
   const caption=document.createElement('div');caption.className='gallery-caption';
   const title=document.createElement('strong');title.textContent=description.title;
   const version=document.createElement('small');version.textContent=description.version;
   caption.append(title,version);row.append(caption);
  }
  row.append(info);$('filePickerList').append(row);if(workspace?.galleryVisible()||$('filePicker').open)pickerThumbnails.observe(visual,file);else visual.textContent=file.media_kind==='video'?'▶':'▧';
 }
 $('filePickerPages').hidden=count<=1;$('filePageCount').textContent='Seite '+(filePickerPage+1)+' von '+count;
 $('filePrevious').disabled=busy||filePickerPage===0;$('fileNext').disabled=busy||filePickerPage>=count-1;
}
function openFilePicker(trigger){
 if(busy||!selectedPortal)return;pickerTrigger=trigger;filePickerPage=0;pendingAssetId=null;$('fileSearch').value='';$('filePickerStatus').textContent='';$('fileSwitchNotice').hidden=true;renderFilePicker();
 if(workspace){workspace.show('folder');renderFilePicker();$('fileSearch').focus();return;}
 if(!$('filePicker').open)$('filePicker').showModal();renderFilePicker();$('fileSearch').focus();
}
async function requestFileSelection(id,discard=false){
 if(busy)return;const file=id?assets.find(f=>f.id===id):null;
 if(id&&(!file||!fileFitsPortal(file)))return;
 if((selectedAsset?.id||'')===id){if(!workspace)$('filePicker').close();return;}
 if((dirty||sourceDirty)&&!discard){pendingAssetId=id;$('fileSwitchMessage').textContent='Du hast ungespeicherte Änderungen. Zum Wechsel zu „'+(file?describeFile(file).title:'Allgemeine Textvorlage')+'“ kannst du sie verwerfen oder zuerst behalten und speichern.';$('fileSwitchNotice').hidden=false;$('fileSwitchNotice').scrollIntoView({block:'nearest'});$('cancelFileSwitch').focus();return;}
 pendingAssetId=null;$('fileSwitchNotice').hidden=true;selectedAsset=file;assignmentRevision=file?.assignments?.find(a=>a.platform===selectedPortal)?.revision||0;
 if(workspace)workspace.show('files');else $('filePicker').close();clearDraft();renderSelectedFile();syncMedia();if(!workspace)$('assetPanel').scrollIntoView({block:'start'});renderFilePicker();await loadLatest();
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
 $('uploadPanel').hidden=false;$('uploadKeepOpen').hidden=false;$('uploadProgress').hidden=false;$('retryUpload').hidden=true;$('cancelUpload').hidden=false;$('uploadStatus').textContent='Upload wird vorbereitet …';
 let completed=null;
 try{
  let data=await uploadCall({action:'start',upload_id:job.id,...job.meta},controller.signal);
  if(data.status!=='completed'){
   if(data.status!=='ready')throw Error('UPLOAD_UNAVAILABLE');
   await transferDeviceFile({file:job.file,url:data.upload_url,mime:job.meta.mime_type,signal:controller.signal,onProgress:(bytes,total)=>{if(signedOut||controller.signal.aborted)return;const percent=Math.floor(bytes/total*100);$('uploadProgress').value=percent;$('uploadStatus').textContent=percent+' % hochgeladen';}});
   $('uploadStatus').textContent='Übertragung abgeschlossen. Die Datei wird deinem Kundenordner zugeordnet …';
   data=await uploadCall({action:'finish',upload_id:job.id},controller.signal);
  }
  if(data.status!=='completed'||typeof data.asset_id!=='string')throw Error('UPLOAD_INCOMPLETE');
  await loadFiles();controller.signal.throwIfAborted();
  if(!assets.some(f=>f.id===data.asset_id))throw Error('UPLOAD_INCOMPLETE');
  completed=data.asset_id;const uploaded=assets.find(f=>f.id===completed);localMedia={id:completed,revision:uploaded.revision,file:job.file};deviceUpload=null;$('deviceFile').value='';$('uploadProgress').value=100;
  $('uploadStatus').textContent='✓ Datei hochgeladen';$('uploadKeepOpen').hidden=true;$('uploadProgress').hidden=true;fileChanged();
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
$('filePicker').addEventListener('close',()=>{pickerThumbnails.reset();pendingAssetId=null;$('fileSwitchNotice').hidden=true;if(!busy)(pickerTrigger||$('browseFiles')).focus();});
$('fileSearch').addEventListener('input',()=>{filePickerPage=0;renderFilePicker();});
$('filePrevious').addEventListener('click',()=>{if(!busy&&filePickerPage>0){filePickerPage--;renderFilePicker();}});
$('fileNext').addEventListener('click',()=>{if(!busy&&!$('fileNext').disabled){filePickerPage++;renderFilePicker();}});
$('chooseGeneralTemplate').addEventListener('click',()=>requestFileSelection(''));
$('confirmFileSwitch').addEventListener('click',()=>pendingAssetId!==null?requestFileSelection(pendingAssetId,true):undefined);
$('cancelFileSwitch').addEventListener('click',()=>{pendingAssetId=null;$('fileSwitchNotice').hidden=true;});
async function loadFiles(preferredId=null){
 const r=await optimizerCatalog();if(signedOut)return;void galleryMusic?.wake();assets=r.files||[];const old=preferredId??selectedAsset?.id??'';
 selectedAsset=assets.find(f=>f.id===old&&fileFitsPortal(f))||null;
 assignmentRevision=selectedAsset?.assignments?.find(a=>a.platform===selectedPortal)?.revision||0;renderSelectedFile(!!selectedAsset&&mediaViewKey===selectedAsset.id+':'+selectedAsset.revision);renderFilePicker();
 if(old&&!selectedAsset){clearDraft();resetMediaCheck(messages.FILE_UNAVAILABLE);throw Error(messages.FILE_UNAVAILABLE);}
}
function resetMediaCheck(message='Wähle zuerst eine Datei aus.'){
 selectedMediaFacts=null;workspace?.refreshPreview();
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
  selectedMediaFacts=m.facts||null;workspace?.refreshPreview();
  $('mediaScope').textContent=typeof m.scope_notice==='string'?m.scope_notice:'';
  const f=m.facts||{};const facts=[];if(f.mime_type)facts.push(f.mime_type);if(Number.isFinite(f.size_bytes))facts.push(f.size_bytes<1000?f.size_bytes+' Byte':f.size_bytes<1000000?(f.size_bytes/1000).toLocaleString('de-DE',{maximumFractionDigits:2})+' kB':(f.size_bytes/1000000).toLocaleString('de-DE',{maximumFractionDigits:2})+' MB');if(f.width_px&&f.height_px)facts.push(f.width_px+' × '+f.height_px+' Pixel');if(Number.isFinite(f.duration_ms))facts.push((f.duration_ms/1000).toLocaleString('de-DE',{maximumFractionDigits:2})+' Sekunden');$('mediaFacts').textContent=(m.facts_source==='drive_metadata'?'Von Drive gemeldete Dateiangaben: ':'Dateiangaben: ')+facts.join(' · ');
  const order={fail:0,pending:1,pass:2};for(const c of [...m.checks].sort((a,b)=>(order[a.status]??3)-(order[b.status]??3))){if(!Object.hasOwn(order,c.status)||typeof c.message!=='string')continue;const li=document.createElement('li');li.dataset.state=c.status;li.textContent=({fail:'Zu korrigieren: ',pending:'Noch offen: ',pass:'Geprüft: '})[c.status]+c.message;$('mediaChecks').append(li);}
  if(Array.isArray(m.recommendations)){for(const item of m.recommendations){if(!item||!['matches','suggested','unknown'].includes(item.status)||typeof item.message!=='string')continue;const li=document.createElement('li');li.textContent=item.message;$('mediaRecommendations').append(li);}}
  $('mediaRecommendationsPanel').hidden=!$('mediaRecommendations').children.length;
  if(m.content_review)renderReview(m.content_review,file);
  if(changes)$('mediaPanel').open=true;
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
const orderUuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
async function readStoredOrder(id){
 if(!orderUuid.test(id)||signedOut||(await session()).user.id!==previewOwnerId)throw Error(messages.AUTH_REQUIRED);
 const {data,error}=await supabase.rpc('sma_publication_order_v1',{p_action:'get',p_input:{id}})
  .abortSignal(AbortSignal.timeout(20000));
 if(error)throw fileError('FILE_SYNC_UNAVAILABLE');
 if(signedOut||(await session()).user.id!==previewOwnerId)throw Error(messages.AUTH_REQUIRED);
 return data;
}
async function readHistoryOrder(id){
 const unavailable='Die Beitragsvorschau für diesen Auftrag ist in deinem Konto nicht verfügbar.';
 if(!workspace||!orderUuid.test(id))throw Error(unavailable);
 const order=await readStoredOrder(id),binding=order?.binding;
 if(!order?.ok||order.id!==id||order.state!=='prepared'||order.approved_at!=null||
    order.can_publish!==false||order.can_upload!==false||binding?.platform!==selectedPortal||!orderUuid.test(binding.asset_id)||
    !orderUuid.test(binding.preview_id)||typeof binding.asset_revision!=='string'||
    !Number.isSafeInteger(binding.assignment_revision)||!Number.isSafeInteger(binding.preview_revision))throw Error(unavailable);
 return order;
}
async function openHistoryOrderPreview(id,owner){
 const changed='Datei oder Beitrag wurden seit diesem Auftrag geändert. Öffne den aktuellen Stand unter Veröffentlichung.';
 let order=await readHistoryOrder(id);
 // The order RPC evaluates the catalogue timestamp on the server. A device clock
 // can be ahead or behind even immediately after a successful Drive sync.
 if(['FILE_REFRESH_REQUIRED','FILE_CHANGED'].includes(order.check_error)){
  status('SMA gleicht die Datei für diesen Auftrag mit deinem Kundenordner ab …');
  try{await syncFileCatalog();}catch(error){throw typeof error.code==='string'?error:fileError('FILE_SYNC_UNAVAILABLE');}
  if(signedOut||(await session()).user.id!==owner)throw Error(messages.AUTH_REQUIRED);
  order=await readHistoryOrder(id);
 }
 if(order.check_error==='FILE_REFRESH_REQUIRED')throw fileError('FILE_REFRESH_REQUIRED');
 if(order.check_error)throw Error(order.check_error==='FILE_UNAVAILABLE'?messages.FILE_UNAVAILABLE:changed);
 const binding=order.binding;
 const catalog=await optimizerCatalog();
 const file=catalog.files?.find(f=>f.id===binding.asset_id);
 if(!file||!fileFitsPortal(file))throw Error(messages.FILE_UNAVAILABLE);
 const assignment=file.assignments?.find(a=>a.platform===selectedPortal);
 if(file.revision!==binding.asset_revision||assignment?.status!=='assigned'||assignment.revision!==binding.assignment_revision)throw Error(changed);
 const saved=await fileRpc('get',{asset_id:file.id,platform:selectedPortal});
 if(saved.status!=='completed'||saved.id!==binding.preview_id||saved.revision!==binding.preview_revision||
    saved.assignment_revision!==binding.assignment_revision)throw Error(changed);
 const resume=params.get('resume')==='1';
 if(resume){
  // Re-read the same order after the file lookup. Another tab may have acted meanwhile.
  order=await readHistoryOrder(id);
  if(order.check_error==='FILE_REFRESH_REQUIRED')throw fileError('FILE_REFRESH_REQUIRED');
  if(order.check_error||Object.keys(binding).some(key=>order.binding[key]!==binding[key]))throw Error(changed);
 }
 const draft=saved.preview?.drafts?.find(d=>d.platform===selectedPortal);
 if(!draft||!order.draft||saved.preview.shop_url!==binding.shop_url||
    ['platform','title','body','caption','hashtags','review_notes'].some(key=>JSON.stringify(draft[key])!==JSON.stringify(order.draft[key])))throw Error(changed);
 if(signedOut||(await session()).user.id!==owner)throw Error(messages.AUTH_REQUIRED);
 // Select only after the order, file and saved portal text have all been verified.
 assets=catalog.files;selectedAsset=file;assignmentRevision=saved.assignment_revision;
 renderSelectedFile();showProductContext(saved.product_context,file);fillInput(saved.input);render(saved);
 orderReview.rememberVideoChoices(order);
 workspace.show('preview');status('Beitragsvorschau des Auftrags geladen.');
 await loadMediaCheck();await loadMagicEffect(false);
 if(signedOut||(await session()).user.id!==owner)throw Error(messages.AUTH_REQUIRED);
 lock(false);syncMedia();
 if(resume&&!orderReview.resumePrepared(order)){
  status('Die gespeicherte Vorbereitung kann nicht fortgesetzt werden. Du kannst sie für diesen Beitrag neu starten.');
 }
}

async function loadHistoryPreview(){
 retryHistoryPreview=false;
 lock(true);
 $('refreshFiles').textContent='Dateien aktualisieren';
 status('Beitragsvorschau wird geladen …');
 try{await openHistoryOrderPreview(params.get('order'),previewOwnerId);}
 catch(error){
  if(signedOut)return;
  if(['FILE_REFRESH_REQUIRED','FILE_SYNC_RUNNING','FILE_SYNC_RATE_LIMITED','FILE_SYNC_UNAVAILABLE','FOLDER_UNAVAILABLE'].includes(error.code)){
   retryHistoryPreview=true;
   $('refreshFiles').textContent='Vorschau erneut laden';
   $('refreshFiles').disabled=false;
   status(error.code==='FILE_REFRESH_REQUIRED'?'Die Datei ist noch nicht aktuell bestätigt. Bitte lade die Vorschau erneut.':error.message,true);
  }else{status(error.message,true);}
 }
}
async function loadLatest(){const file=selectedAsset;lock(true);try{
 await loadMediaCheck();
 const data=selectedAsset?await fileRpc('get',{asset_id:selectedAsset.id,platform:selectedPortal}):await rpc('latest',selectedPortal?{platform:selectedPortal}:{});
 if(signedOut||file?.id!==selectedAsset?.id||file?.revision!==selectedAsset?.revision)return;
 showProductContext(data.product_context,file);
 if(data.status==='empty'){clearDraft();status(selectedAsset?'Für diese Datei und dieses Portal ist noch kein Text vorbereitet.':'Noch keine Textvorlage gespeichert.');return;}
 fillInput(data.input);const result=data.status==='processing'?await waitForResult(data.id):data;if(result.status==='failed')throw Error(errorText(result));render(result);status(selectedAsset?'Zugeordneten Beitragstext geladen.':'Gespeicherte Textvorlage geladen.');
 }catch(e){if(selectedAsset)clearDraft();status(e.message,true);}finally{lock(false);syncMedia();await loadMagicEffect(true);}}

function resetMagic(){automaticInputSignature=null;pendingAutomatic=null;$('magicReplaceNotice').hidden=true;magicState=null;$('magicPanel').hidden=!selectedAsset||!['image','video'].includes(selectedAsset.media_kind);$('magicStatus').textContent='';$('magicSummary').textContent='';$('magicApplied').hidden=true;$('magicApplied').textContent='';$('applyMagic').hidden=true;syncMagicButton();}
function magicPhotoHint(file=selectedAsset){
 if(!file||file.media_kind!=='image')return '';
 const formatUnsupported=file.mime_type&&!['image/jpeg','image/png','image/webp'].includes(file.mime_type);
 const sizeUnsupported=Number.isFinite(file.size_bytes)&&(file.size_bytes<1||file.size_bytes>12000000);
 return formatUnsupported||sizeUnsupported?'Für die automatische Fotoerkennung wähle ein statisches JPG, PNG oder WebP bis 12 MB. Du kannst den Inhalt dieser Datei unter „Inhalt und Ziel“ selbst beschreiben.':'';
}
function magicHint(file=selectedAsset){
 if(file?.media_kind!=='video')return magicPhotoHint(file);
 if(file.mime_type!=='video/mp4'||!Number.isSafeInteger(file.size_bytes)||file.size_bytes<1||file.size_bytes>24000000||!Number.isInteger(file.duration_ms)||file.duration_ms<1||file.duration_ms>60000)return 'Für den Video-Magic-Effect wähle ein MP4 bis 24 MB und bis 60 Sekunden mit vollständig geladenen Dateiangaben.';
 if(!/^sha256:[a-f0-9]{64}:\d+$/.test(file.revision||''))return messages.CHECKSUM_REQUIRED;
 return '';
}
function magicPolicy(file){return file.media_kind==='video'?'magic-video-2026-11-03.1':'magic-photo-2026-11-02.1';}
function magicLabel(file=selectedAsset){return file?.media_kind==='video'?'Video':'Foto';}
function syncMagicButton(){
 $('recognizePhoto').disabled=busy||!selectedAsset||!['image','video'].includes(selectedAsset.media_kind)||!!magicHint()||magicState?.status==='completed';
 $('recognizePhoto').textContent=magicState?.status==='processing'?'Erkennungsstand laden':magicState?.status==='failed'?magicLabel()+' erneut erkennen':magicLabel()+' erkennen';$('applyMagic').disabled=busy;syncMagicActions();
}
function magicErrorText(code){return ({VIDEO_UNSUPPORTED:'Die Videoerkennung unterstützt MP4 bis 24 MB und bis 60 Sekunden.',MEDIA_UNSUPPORTED:'Die automatische Fotoerkennung unterstützt statische JPG-, PNG- und WebP-Bilder bis 12 MB.',MAGIC_TIMEOUT:'Die Erkennung wurde nicht rechtzeitig abgeschlossen. Du kannst sie erneut starten.',MAGIC_RATE_LIMITED:'Bitte warte etwas, bevor du weitere Dateien erkennen lässt.',MAGIC_PHOTO_REQUIRED:'Für diesen Erkennungsweg wird ein Foto benötigt.',MAGIC_RUNNING:'Eine Erkennung läuft bereits.',TRANSCRIPT_INVALID:'Die Tonspur konnte nicht vollständig ausgewertet werden. Bitte starte die Erkennung erneut.',VIDEO_EXTRACTION_UNVERIFIED:'Die Bildfolge konnte nicht zuverlässig verarbeitet werden. Bitte versuche es erneut.'})[code]||messages[code]||'Die Erkennung konnte nicht abgeschlossen werden. Bitte versuche es erneut.';}

function photoStillSelected(file){return selectedAsset?.id===file.id&&selectedAsset?.revision===file.revision;}
function showMagic(r,file){
 if(!photoStillSelected(file))return false;
 if(!r||r.asset_id!==file.id||r.asset_revision!==file.revision||r.policy_version!==magicPolicy(file)||r.can_publish!==false)throw Error('Für diese Datei liegt noch kein vollständiges Erkennungsergebnis vor.');
 if(!['unrecognized','processing','failed','completed'].includes(r.status))throw Error('Die Erkennung ist noch nicht vollständig.');
 if(r.status==='completed'){
  const v=r.result;
  if(!v||!['product','food','place','service_scene','document','other','unclear'].includes(v.subject_type)||v.can_publish!==false||v.requires_confirmation!==true||typeof v.description!=='string'||!v.description.trim()||typeof v.source_text!=='string'||v.source_text.length<30||v.source_text.length>8000||!Array.isArray(v.uncertainties)||v.uncertainties.some(x=>typeof x!=='string'))throw Error('Die Erkennung ist noch nicht vollständig.');
 }
 if(r.status==='completed'&&file.media_kind==='video'&&(r.result.policy_version!==magicPolicy(file)||r.result.content_comparison!=='model_checked_sampled_evidence'||!['transcribed','no_audio_stream','no_speech_recognized'].includes(r.result.audio_status)||r.result.evidence?.source_sha256!==file.revision.split(':')[1]))throw Error('Für dieses Video liegt noch kein vollständiges Erkennungsergebnis vor.');
 magicState=r;$('magicPanel').hidden=false;
 const labels={unrecognized:'Diese Datei wurde noch nicht erkannt.',processing:file.media_kind==='video'?'Der Magic Effect liest die Bildfolge und Aufschriften, wertet vorhandene Sprache aus und gleicht die Beschreibung ab …':'Der Magic Effect erkennt das Motiv und liest sichtbare Aufschriften …',failed:magicErrorText(r.error_code)};
 $('magicStatus').textContent=labels[r.status]||'';
 if(r.status==='completed'){
  const v=r.result;
  $('magicSummary').textContent=v.description+(v.uncertainties.length?'\nNoch zu prüfen: '+v.uncertainties.join(' '):'');
  if(file.media_kind==='video')$('magicSummary').textContent+='\n'+({no_audio_stream:'Dieses Video hat keine Tonspur.',no_speech_recognized:'In der Tonspur wurde keine Sprache erkannt.',transcribed:'Gesprochene Inhalte wurden transkribiert und berücksichtigt.'})[v.audio_status];
  const unclear=v.subject_type==='unclear';$('applyMagic').hidden=unclear;
  $('magicStatus').textContent=unclear?'Das Motiv ist nicht sicher erkennbar. Bitte beschreibe es selbst oder verwende ein deutlicheres Foto.':magicLabel(file)+' erkannt. Prüfe die Beschreibung und die lesbaren Aufschriften.';
  if(!unclear&&!sourceDirty&&!$('source_text').value.trim()){$('source_text').value=v.source_text;if(!workspace)$('sourcePanel').open=true;$('magicStatus').textContent=magicLabel(file)+' erkannt. Die Beschreibung wurde unter „Inhalt und Ziel“ eingefügt.';}
 }
 syncMagicButton();return true;
}
async function magicRpc(file){const {data,error}=await supabase.rpc(file.media_kind==='video'?'sma_publication_video_magic_v1':'sma_publication_magic_v1',{p_action:'get',p_input:{asset_id:file.id,asset_revision:file.revision}});if(error||!data?.ok)throw Error('Die Erkennung ist gerade nicht verfügbar.');return data.analysis;}
async function loadMagicEffect(autoStart=false){
 const file=selectedAsset;resetMagic();if(!file||!['image','video'].includes(file.media_kind))return;
 const hint=magicHint(file);if(hint){$('magicStatus').textContent=hint;return;}
 try{
  const r=await magicRpc(file);if(!showMagic(r,file))return;
  if(autoStart&&(r.status==='processing'||(file.media_kind==='image'&&r.status==='unrecognized'&&!sourceDirty&&!$('source_text').value.trim()&&/^(sha256:[a-f0-9]{64}|md5:[a-f0-9]{32}):\d+$/.test(file.revision))))await recognizePhoto();
 }catch(e){if(photoStillSelected(file))$('magicStatus').textContent=e.message;}
}
async function recognizePhoto({withinAutomatic=false}={}){
 if(signedOut||(busy&&!withinAutomatic)||!selectedAsset||!['image','video'].includes(selectedAsset.media_kind)||magicState?.status==='completed')return;
 const hint=magicHint();if(hint){$('magicStatus').textContent=hint;return;}
 const file=selectedAsset,context=fileContext();lock(true);$('magicStatus').textContent='Der Magic Effect wird gestartet …';
 try{
  await ensureFreshFile(context);
  if(magicState?.status!=='processing'){
   const d=await withFreshFile(context,async()=>{
    const auth=await session();assertFileContext(context);
    const response=await fetch(file.media_kind==='video'?videoMagicEndpoint:magicEndpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.access_token},body:JSON.stringify({asset_id:file.id,asset_revision:file.revision}),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(25000)});
    const data=await response.json();if(!response.ok||!data?.ok)throw Object.assign(Error(magicErrorText(data?.code)),{code:data?.code});return data;
   });
   if(!showMagic(d.analysis,file))return;
  }
  for(let i=0;i<(file.media_kind==='video'?210:80)&&magicState?.status==='processing';i++){
   await new Promise(resolve=>setTimeout(resolve,3000));if(!photoStillSelected(file))return;
   if(!showMagic(await magicRpc(file),file))return;
  }
  if(photoStillSelected(file)&&magicState?.status==='processing')$('magicStatus').textContent='Die Erkennung läuft noch. Klicke auf „Erkennungsstand laden“, um das Ergebnis weiter abzurufen.';
 }catch(e){if(photoStillSelected(file)){$('magicStatus').textContent=e.message;status(e.message,true);}}
 finally{if(photoStillSelected(file))lock(false);}
}
$('recognizePhoto').addEventListener('click',()=>recognizePhoto());
$('applyMagic').addEventListener('click',()=>{
 if(busy||magicState?.status!=='completed'||magicState.asset_id!==selectedAsset?.id||magicState.asset_revision!==selectedAsset?.revision||magicState.result?.subject_type==='unclear')return;
 $('source_text').value=magicState.result.source_text;$('sourcePanel').open=true;sourceDirty=true;attempt=null;
 const message='Erkannter Inhalt übernommen. Prüfe die Beschreibung und klicke anschließend auf „'+$('generate').textContent+'“.';
 $('magicStatus').textContent=message;$('magicApplied').textContent=message;$('magicApplied').hidden=false;
 workspace?.show('source');
 $('source_text').focus({preventScroll:true});$('sourcePanel').scrollIntoView({block:'start'});
});


function magicActionHint(){
 if(!selectedAsset)return 'Wähle oben zuerst ein Bild oder Video aus deiner Galerie aus.';
 return magicHint()||'';
}

function syncMagicActions(){
 const hint=magicActionHint();
 for(const id of ['magicSource','magicText'])$(id).disabled=busy||!!hint;
 $('magicSource').textContent=automaticMode==='source'?'✨ Inhalt wird vorbereitet …':'✨ Magic Effect';
 $('magicText').textContent=automaticMode==='text'?'✨ Text wird vorbereitet …':workspace?'✨ Magic Effect':'✨ Magic Effect · Text erstellen';
 $('magicSourceHint').textContent=hint||(selectedAsset?.media_kind==='video'?'Analysiert dein Video mit Bildfolge, lesbaren Aufschriften und vorhandener Sprache und trägt die Beschreibung ein.':'Erkennt dein Foto und trägt die Beschreibung automatisch ein.');
 $('magicTextHint').textContent=hint||(workspace?'Inhalt erkennen und passenden Beitragstext vorbereiten.':'Erkennt deine Datei, übernimmt den Inhalt und erstellt einen passenden Text für '+(names[selectedPortal]||'die gewählten Portale')+' mit Hashtags und Shop-Link. Du kannst den fertigen Entwurf anschließend prüfen und bearbeiten.');
}
async function runMagicAction(mode,replace=false){
 if(busy||signedOut||!['source','text'].includes(mode))return;
 const hint=magicActionHint();if(hint){status(hint,true);return;}
 if((dirty||(sourceDirty&&automaticInputSignature!==JSON.stringify(sourceInput())))&&!replace){
  pendingAutomatic=mode;$('magicReplaceNotice').hidden=false;
  $('magicReplaceNotice').scrollIntoView({block:'nearest'});$('cancelMagicReplace').focus();return;
 }
 pendingAutomatic=null;$('magicReplaceNotice').hidden=true;
 const file=selectedAsset,context=fileContext();automaticMode=mode;lock(true);
 status(mode==='text'?'Magic Effect: Datei erkennen und Beitragstext vorbereiten …':'Magic Effect: Inhalt erkennen und übernehmen …');
 try{
  await ensureFreshFile(context);
  const product=await getDraftProduct(context);
  if(product?.state==='ambiguous'){
   $('sourcePanel').open=true;workspace?.show('source');$('source_text').focus();
   throw Error('Welches Produkt ist im Beitrag zu sehen? Ergänze Produktname und Einsatzzweck in der Beschreibung.');
  }
  if(product?.state==='matched'&&typeof product.visual==='string'&&product.visual.trim().length>=30){
   $('source_text').value=product.visual;
  }else{
   if(magicState?.status!=='completed')await recognizePhoto({withinAutomatic:true});
   if(signedOut||!photoStillSelected(file))return;
   if(magicState?.status!=='completed')throw Error($('magicStatus').textContent||'Die Erkennung ist noch nicht abgeschlossen. Bitte versuche es erneut.');
   if(magicState.result.subject_type==='unclear')throw Error('Das Motiv ist nicht sicher erkennbar. Bitte ergänze den Inhalt selbst oder wähle ein deutlicheres Foto.');
   $('source_text').value=magicState.result.source_text;
  }
  sourceDirty=true;automaticInputSignature=JSON.stringify(sourceInput());if(!workspace)$('sourcePanel').open=true;
  if(mode==='text')await generatePreview({withinAutomatic:true});
  else{workspace?.show('source');status('Der erkannte Inhalt ist übernommen. Du kannst die Angaben bearbeiten oder unter „Text für '+(names[selectedPortal]||'das Portal')+'“ automatisch den Beitragstext erstellen.');}
 }catch(e){if(!signedOut)status(e.message,true);}
 finally{automaticMode=null;lock(false);syncMedia();}
}
$('magicSource').addEventListener('click',()=>runMagicAction('source'));
$('magicText').addEventListener('click',()=>runMagicAction('text'));
$('confirmMagicReplace').addEventListener('click',()=>pendingAutomatic?runMagicAction(pendingAutomatic,true):undefined);
$('cancelMagicReplace').addEventListener('click',()=>{pendingAutomatic=null;$('magicReplaceNotice').hidden=true;});

async function refreshFiles(){
 if(busy)return;if(dirty||sourceDirty){const message='Bitte speichere zuerst deine Änderungen oder wähle eine Datei und bestätige das Verwerfen.';status(message,true);$('filePickerStatus').textContent=message;return;}
 lock(true);try{status('Dein Kundenordner wird geprüft …');$('filePickerStatus').textContent='Dein Kundenordner wird geprüft …';await syncFileCatalog();await loadFiles();fileChanged();await loadLatest();$('filePickerStatus').textContent='Dateiliste aktualisiert.';}catch(e){if(!signedOut){status(e.message,true);$('filePickerStatus').textContent=e.message;}}finally{lock(false);syncMedia();}
}
async function refreshVideoMetadata(){
 if(busy||signedOut||!selectedAsset)return;
 const context=fileContext();lock(true);$('videoMetadataStatus').textContent='Dateiangaben werden im Kundenordner geprüft …';
 try{
  await ensureFreshFile(context,true);assertFileContext(context);renderVideoMetadata();syncMagicButton();
  status(missingVideoMetadata(selectedAsset).length?'Google Drive hat die fehlenden Dateiangaben noch nicht bereitgestellt. Bitte später erneut aktualisieren. Deine Eingaben bleiben erhalten.':'Dateiangaben aktualisiert. Deine Eingaben bleiben erhalten.');
 }catch(e){if(!signedOut){status(e.message,true);$('videoMetadataStatus').textContent=e.message;}}
 finally{lock(false);}
}
$('refreshVideoMetadata').addEventListener('click',refreshVideoMetadata);
$('refreshFiles').addEventListener('click',()=>retryHistoryPreview&&!signedOut?loadHistoryPreview():refreshFiles());
$('pickerRefresh').addEventListener('click',refreshFiles);
$('previewForm').addEventListener('input',()=>{sourceDirty=true;attempt=null;});
$('media_kind').addEventListener('change',syncMedia);
$('language').addEventListener('change',()=>{sourceDirty=true;attempt=null;});
$('loadLatest').addEventListener('click',async()=>{if(!busy){await loadLatest();if(current)workspace?.show('text');}});
async function generatePreview({withinAutomatic=false}={}){
 if(signedOut||(busy&&!withinAutomatic))return false;const input=sourceInput();if(!input.platforms.length){status(messages.INVALID_INPUT,true);return;}
 const context=selectedAsset?fileContext():null;

 lock(true);status('Eigene Texte je Portal werden erstellt und der Shop-Link wird geprüft …');
 try{
  await ensureFreshFile(context);
  const product=await getDraftProduct(context);
  if(product?.state==='ambiguous'&&(withinAutomatic||!sourceDirty))throw Error('Bitte ergänze den zutreffenden Produktnamen und Einsatzzweck in der Dateibeschreibung.');
  const draftInput=attachProduct(input,product);
  const signature=JSON.stringify({input:draftInput,asset_id:context?.asset_id,asset_revision:context?.asset_revision});
  if(!attempt||attempt.signature!==signature||attempt.finished)attempt={signature,id:crypto.randomUUID(),finished:false};
  const request=attempt;
  let data=request.preview;
  if(!data){
   const auth=await session();assertFileContext(context);
   status('Eigene Texte je Portal werden erstellt und der Shop-Link wird geprüft …');
   try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.access_token},body:JSON.stringify({...draftInput,request_id:request.id}),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(110000)});if(!response.ok)throw Error('NETWORK');data=await response.json();}
   catch{assertFileContext(context);status('Die Rückmeldung dauert länger. Der gespeicherte Status wird geprüft …');data=await waitForResult(request.id);}
   if(!data?.ok){request.finished=true;throw Error(errorText(data));}if(data.status==='processing')data=await waitForResult(data.id);
   assertFileContext(context);
   if(data.status==='failed'){request.finished=true;throw Error(errorText(data));}
   if(data.status!=='completed'||data.preview?.can_publish!==false)throw Error(messages.PREPARATION_UNAVAILABLE);
   // Keep the completed text for a retry if only its file assignment failed.
   request.preview=data;
  }
  if(context){data=await withFreshFile(context,()=>fileRpc('assign',{...context,preview_id:request.preview.id,preview_revision:request.preview.revision}));fileChanged();}
  render(data);request.finished=true;sourceDirty=false;workspace?.show('text');status('Die Textvorschau ist gespeichert. Prüfe jetzt die Inhalte und passe sie bei Bedarf an.');
  return true;
 }catch(e){if(!signedOut)status(e.message,true);return false;}finally{lock(false);syncMedia();}
}
$('previewForm').addEventListener('submit',event=>{event.preventDefault();return generatePreview();});

$('save').addEventListener('click',async()=>{
 if(busy||signedOut||!current)return;
 let edits;try{edits=[...$('drafts').children].map(card=>({platform:card.dataset.platform,title:card.querySelector('[data-field=title]').value.trim(),body:card.querySelector('[data-field=body]').value.trim(),hashtags:parseHashtags(card.querySelector('[data-field=hashtags]').value)}));}catch(e){status(e.message,true);return;}
 const drafts=current.preview.drafts.map(d=>edits.find(e=>e.platform===d.platform)||{platform:d.platform,title:d.title,body:d.body});
 if(drafts.some(d=>!d.title||d.title.length>80||d.body.length<10||d.body.length>1200)){status(messages.INVALID_EDIT,true);return;}
 const context=selectedAsset?fileContext():null;
 lock(true);$('saveStatus').textContent='Wird gespeichert …';
 try{
  await ensureFreshFile(context);
  const result=context?await withFreshFile(context,()=>fileRpc('save',{...context,title:edits[0].title,body:edits[0].body,hashtags:edits[0].hashtags})):await rpc('save',{revision:current.revision,drafts},current.id);
  render(result);if(context)fileChanged();status('Änderungen gespeichert. Der Shop-Link ist weiterhin enthalten.');
 }catch(e){if(!signedOut){status(e.message,true);$('saveStatus').textContent='Änderungen noch nicht gespeichert';}}finally{lock(false);syncMedia();}
});
window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===window.top&&event.data?.type==='sma-publication-order-viewport')orderReview?.viewport(event.data.height);});
if(selectedPortal)orderReview=installOrderReview(document,{session,readStoredOrder,portalName:names[selectedPortal],host:workspace?$('workspacePreviewHeader'):$('save').parentElement,
 getContext:()=>{if(signedOut)throw Error(messages.AUTH_REQUIRED);if(busy)throw Error('Bitte warte, bis die laufende Vorbereitung abgeschlossen ist.');if(!selectedAsset||!current)throw Error('Bitte wähle zuerst eine Datei und erstelle einen gespeicherten Beitrag.');if(dirty||sourceDirty)throw Error('Bitte speichere zuerst deine Änderungen oder erstelle einen aktuellen Beitrag.');return {name:selectedAsset.name,binding:{...fileContext(),preview_id:current.id,preview_revision:current.revision}};},
 refresh:()=>ensureFreshFile(fileContext()),
 onOpen:()=>{if(window.parent!==window)window.top.postMessage({type:'sma-publication-order-open'},location.origin);},
});
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&uploadController){event.preventDefault();return;}if(event.key==='Escape'&&$('filePicker').open)return;if(event.key==='Escape'&&window.parent!==window&&params.get('wide')!=='1'){event.preventDefault();window.top.postMessage({type:'sma-publication-preview-close'},location.origin);}});
// Build the shared portal workspace before waiting for the external account client.
lock(true);status('Deine Dateien werden geladen …');
try{
 const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2');
 supabase=createClient('https://bnvnmdxosbnuzedokqgh.supabase.co','sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW');
 supabase.auth.onAuthStateChange((event,s)=>{originalVideo?.invalidateOwner(s?.user?.id||null);if(event==='SIGNED_OUT'||(previewOwnerId&&s?.user?.id&&s.user.id!==previewOwnerId)){galleryMusic?.destroy();coverView?.clear();signedOut=true;orderReview?.clear();clearAssetPreview();pickerThumbnails.clear();localMedia=null;uploadController?.abort();deviceUpload=null;$('deviceFile').value='';$('uploadPanel').hidden=true;$('uploadStatus').textContent='';lock(true);$('result').hidden=true;current=null;assets=[];selectedAsset=null;sourceDirty=false;pendingAssetId=null;resetMagic();for(const id of ['source_text','fileSearch'])$(id).value='';$('fileSwitchMessage').textContent='';$('filePickerStatus').textContent='';$('fileSwitchNotice').hidden=true;if($('filePicker').open)$('filePicker').close();renderSelectedFile();renderFilePicker();$('assetStatus').textContent='';resetMediaCheck(messages.AUTH_REQUIRED);status(messages.AUTH_REQUIRED,true);}});
 const coverOwner=(await session()).user.id;previewOwnerId=coverOwner;
 if(selectedPortal&&!params.has('order')&&window.top===window){
  galleryMusic=mountGalleryMusic({owner:coverOwner,onStatus:text=>{if(!signedOut)$('galleryMusicStatus').textContent=text;},
   onComplete:async()=>{const list=await optimizerCatalog();if(!signedOut&&(await session()).user.id===coverOwner){assets=list.files||[];renderFilePicker();}}
  });
 }
 coverView=mountExportCover({doc:document,portal:selectedPortal,expectedOwnerId:coverOwner,getOwnerId:async()=>signedOut?null:(await session()).user.id,request:async f=>{const {data,error}=await supabase.rpc('sma_publication_editor_result_v1',{p_asset_id:f.id,p_revision:f.revision});if(error)throw error;return data;},loadImage:async(f,signal)=>{
  if(!['youtube','tiktok'].includes(selectedPortal))return fetchAssetThumbnail(f,(await session()).access_token,signal);
  const blob=await (await import('./media-editor-api.mjs?v=4')).editorSource(f,signal,coverOwner);
  if(blob.type!=='image/png'||(f.size_bytes!=null&&blob.size!==f.size_bytes))throw Error('COVER_UNAVAILABLE');
  return blob;
 }});
 originalVideo=mountOriginalVideo({doc:document,host:$('assetPreview'),thumbnailHost:$('assetPreviewMedia'),expectedOwnerId:coverOwner,getOwnerId:async()=>signedOut?null:(await session()).user.id,source:async(f,signal)=>(await import('./media-editor-api.mjs?v=4')).editorSource(f,signal,coverOwner)});
 if(params.has('order')){
  await loadHistoryPreview();
 }else{
  let ready=true;if(selectedPortal){try{await loadFiles(params.get('asset'));}catch(e){ready=false;lock(false);status(e.message,true);}}
  if(ready)await loadLatest();
 }
}catch(e){lock(true);status(supabase?e.message:'Die Ansicht konnte nicht geladen werden. Bitte lade die Seite erneut.',true);}
