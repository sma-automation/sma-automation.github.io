import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
const supabase=createClient('https://bnvnmdxosbnuzedokqgh.supabase.co','sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW');
const endpoint='https://johnmusic.app.n8n.cloud/webhook/sma-publication-preview-v1';
const $=id=>document.getElementById(id);
const names={youtube:'YouTube',instagram:'Instagram',facebook:'Facebook',tiktok:'TikTok'};
const messages={AUTH_REQUIRED:'Bitte melde dich erneut im SMA-Dashboard an.',ACCESS_INACTIVE:'Dein SMA-Zugang ist derzeit nicht aktiv.',ACCOUNT_UNAVAILABLE:'Dein Konto konnte nicht eindeutig zugeordnet werden.',PUBLIC_SHOP_REQUIRED:'Für dein Konto muss zuerst ein öffentlicher SMA-Shop eingerichtet sein.',RATE_LIMITED:'Bitte warte kurz. Zum Schutz vor Mehrfachanfragen gilt mindestens 30 Sekunden Abstand und höchstens 20 Vorschauen pro Stunde.',PREPARATION_RUNNING:'Eine Vorschau wird bereits erstellt. Lade in Kürze die letzte Vorschau.',REVISION_CONFLICT:'Die Vorschau wurde zwischenzeitlich geändert. Lade die letzte Vorschau, bevor du erneut speicherst.',ACCOUNT_CHANGED:'Die Shop-Zuordnung hat sich geändert. Bitte erstelle eine neue Vorschau.',INVALID_EDIT:'Bitte prüfe Titel und Text: keine zusätzlichen Links, Hashtags, @-Angaben oder „Link im Profil“. Titel maximal 80, Text 10–1200 Zeichen.',YOUTUBE_REQUIRES_VIDEO:'Für YouTube bitte Video auswählen.',PREPARATION_TIMEOUT:'Die Erstellung hat zu lange gedauert. Bitte starte eine neue Vorschau.',PREPARATION_FAILED:'Die Texte konnten nicht vollständig geprüft werden. Bitte erstelle eine neue Vorschau.',PREPARATION_UNAVAILABLE:'Die Vorschau ist gerade nicht erreichbar. Bitte versuche es erneut.',INVALID_INPUT:'Bitte prüfe deine Angaben und wähle mindestens ein Portal.'};
let current=null,busy=false,attempt=null,assets=[],selectedAsset=null,assignmentRevision=0,dirty=false;
let reviewStatus=null;
const reviewEndpoint='https://johnmusic.app.n8n.cloud/webhook/sma-publication-content-review-v1';
Object.assign(messages,{VIDEO_PLAN_REQUIRED:'Die Videoanalyse ist im derzeitigen Sightengine-Tarif nicht freigeschaltet. Die Videoprüfung bleibt offen.',REVIEW_RUNNING:'Eine Datei wird bereits geprüft. Bitte warte kurz.',REVIEW_RATE_LIMITED:'Bitte warte kurz. Maximal sechs Prüfversuche pro Stunde mit mindestens 30 Sekunden Abstand.',CHECKSUM_REQUIRED:'Für diese Datei fehlt noch eine verlässliche Inhaltskennung. Bitte aktualisiere die Dateiliste.',MEDIA_UNSUPPORTED:'Diese Prüfung unterstützt statische JPEG-, PNG- und WebP-Bilder bis 12 MB sowie MP4-, MOV- und WebM-Videos unter 50 MB und unter 60 Sekunden. Animationen benötigen einen anderen Prüfweg.',REVIEW_INCOMPLETE:'Der Prüfdienst hat kein vollständiges Ergebnis geliefert. Die Prüfung bleibt offen.',PROVIDER_FAILED:'Der Prüfdienst konnte die Datei nicht prüfen.',REVIEW_TIMEOUT:'Die Prüfung hat zu lange gedauert. Du kannst sie erneut starten.',REVIEW_UNAVAILABLE:'Die Inhaltsprüfung ist gerade nicht erreichbar.'});
const fileEndpoint='https://johnmusic.app.n8n.cloud/webhook/sma-publication-files-v1';
Object.assign(messages,{FILE_UNAVAILABLE:'Diese Datei ist nicht mehr im zugeordneten Kundenordner verfügbar.',FILE_CHANGED:'Die Datei wurde geändert. Aktualisiere die Dateiliste und erstelle einen neuen passenden Text.',FILE_REFRESH_REQUIRED:'Bitte aktualisiere zuerst die Dateiliste.',ASSIGNMENT_CHANGED:'Der zugeordnete Text wurde außerhalb dieser Datei geändert. Bitte erstelle einen neuen Text für die Datei.',ASSIGNMENT_CONFLICT:'Die Zuordnung wurde inzwischen geändert. Lade den gespeicherten Text erneut.',FOLDER_UNAVAILABLE:'Dein Kundenordner konnte noch nicht eindeutig zugeordnet werden.',FILE_SYNC_UNAVAILABLE:'Die Dateiliste konnte nicht aktualisiert werden. Bitte versuche es erneut.',FILE_SYNC_RUNNING:'Die Dateiliste wird bereits aktualisiert. Bitte versuche es gleich erneut.',FILE_SYNC_RATE_LIMITED:'Bitte warte kurz, bevor du die Dateien erneut aktualisierst.',FILE_CATALOG_TOO_LARGE:'Der Kundenordner enthält mehr Dateien als diese Ansicht vollständig laden kann.',FILE_METADATA_INVALID:'Die Dateiinformationen sind unvollständig. Bitte prüfe die Dateien im Kundenordner.',PORTAL_REQUIRES_VIDEO:'Für dieses Portal wird derzeit eine Videodatei benötigt.',TEXT_ALREADY_ASSIGNED:'Dieser Text gehört bereits zu einer anderen Datei. Bitte erstelle einen eigenen Text.',FILE_FORMAT_MISMATCH:'Die Textvorbereitung passt nicht zur ausgewählten Dateiart.'});
const params=new URLSearchParams(location.search);
const requestedPortal=params.get('portal');
const selectedPortal=Object.hasOwn(names,requestedPortal)?requestedPortal:null;
if(params.get('embedded')==='1')document.body.classList.add('embedded');
if(selectedPortal){
 $('assetPanel').hidden=false;$('mediaPanel').hidden=false;document.body.classList.add('portal-mode');$('portalSelection').hidden=true;$('portalNote').hidden=false;$('portalStatus').hidden=false;
 document.querySelector('h1').textContent=names[selectedPortal]+' optimieren';$('resultHeading').textContent='Text für '+names[selectedPortal];$('generate').textContent='Text optimieren';
}

function status(text,error=false){for(const id of ['status','portalStatus']){$(id).textContent=text;$(id).dataset.error=String(error);}}
function errorText(r){return messages[r?.code||r?.error_code]||'Die Anfrage konnte nicht abgeschlossen werden. Bitte versuche es erneut.';}
function lock(value){busy=value;syncReviewButton();$('assetSelect').disabled=value;$('refreshFiles').disabled=value;$('inputFields').disabled=value;$('save').disabled=value;for(const el of $('drafts').querySelectorAll('input,textarea'))el.disabled=value;}
async function session(){const {data,error}=await supabase.auth.getSession();if(error||!data.session)throw Error(messages.AUTH_REQUIRED);return data.session;}
async function rpc(action,input={},id=null){const {data,error}=await supabase.rpc('sma_publication_preview_v1',{p_action:action,p_input:input,p_id:id});if(error)throw Error('Die Vorschau konnte nicht geladen oder gespeichert werden.');if(!data?.ok)throw Error(errorText(data));return data;}
function sourceInput(){const form=new FormData($('previewForm'));return {source_text:form.get('source_text').trim(),audience:form.get('audience').trim(),goal:form.get('goal').trim(),language:form.get('language'),media_kind:selectedAsset?selectedAsset.media_kind:selectedPortal==='youtube'?'video':form.get('media_kind'),platforms:selectedPortal?[selectedPortal]:form.getAll('platforms')};}
function fillInput(input){if(!input)return;for(const k of ['source_text','audience','goal','language','media_kind'])$(k).value=input[k]||'';for(const c of document.querySelectorAll('[name=platforms]'))c.checked=input.platforms?.includes(c.value)===true;syncMedia();}
function syncMedia(){if(selectedAsset){$('media_kind').value=selectedAsset.media_kind;$('media_kind').disabled=true;}else{$('media_kind').disabled=false;}if(selectedPortal){for(const c of document.querySelectorAll('[name=platforms]'))c.checked=c.value===selectedPortal;if(selectedPortal==='youtube'){$('media_kind').value='video';$('media_kind').disabled=true;}}const yt=document.querySelector('[name=platforms][value=youtube]');yt.disabled=$('media_kind').value==='image';if(yt.disabled)yt.checked=false;}
function caption(d,body){return [body.trim(),d.hashtags.map(x=>'#'+x).join(' '),(current.preview.language==='en'?'🛒 Visit our shop: ':'🛒 Zum Shop: ')+current.preview.shop_url].filter(Boolean).join('\n\n');}
function render(data){
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
function clearDraft(){current=null;dirty=false;attempt=null;$('result').hidden=true;$('drafts').replaceChildren();$('sourcePanel').open=true;$('source_text').value='';}
async function loadFiles(preferredId=null){
 const r=await fileRpc('list');assets=r.files||[];const old=preferredId??selectedAsset?.id??'';
 $('assetSelect').replaceChildren();const general=document.createElement('option');general.value='';general.textContent='Allgemeine Textvorlage · ohne Datei';$('assetSelect').append(general);
 for(const f of assets){if(f.media_kind==='image'&&['youtube','tiktok'].includes(selectedPortal))continue;const o=document.createElement('option');o.value=f.id;o.textContent=f.name;$('assetSelect').append(o);}
 selectedAsset=assets.find(f=>f.id===old&&!(f.media_kind==='image'&&['youtube','tiktok'].includes(selectedPortal)))||null;
 $('assetSelect').value=selectedAsset?.id||'';assignmentRevision=selectedAsset?.assignments?.find(a=>a.platform===selectedPortal)?.revision||0;
 $('assetStatus').textContent=selectedAsset?'Ausgewählt: '+selectedAsset.name:assets.length?'Wähle eine Datei aus deinem Kundenordner.':'Noch keine passenden Dateien geladen. Über „Dateien aktualisieren“ wird dein Kundenordner geprüft.';
 if(old&&!selectedAsset)throw Error(messages.FILE_UNAVAILABLE);
}
function resetMediaCheck(message='Wähle zuerst eine Datei aus.'){
 reviewStatus=null;$('contentReviewStatus').textContent=selectedAsset?'Für diese Datei liegt noch kein Prüfergebnis vor.':'Wähle zuerst eine Datei aus.';syncReviewButton();
 $('mediaSummary').textContent='Medienprüfung · '+(selectedAsset?'noch offen':'Datei auswählen');
 $('mediaStatus').textContent=message;$('mediaFacts').textContent='';$('mediaChecks').replaceChildren();$('mediaPanel').open=false;
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
  const f=m.facts||{};const facts=[];if(f.mime_type)facts.push(f.mime_type);if(Number.isFinite(f.size_bytes))facts.push((f.size_bytes/1000000).toLocaleString('de-DE',{maximumFractionDigits:2})+' MB');if(f.width_px&&f.height_px)facts.push(f.width_px+' × '+f.height_px+' Pixel');if(Number.isFinite(f.duration_ms))facts.push((f.duration_ms/1000).toLocaleString('de-DE',{maximumFractionDigits:2})+' Sekunden');$('mediaFacts').textContent='Dateiangaben: '+facts.join(' · ');
  const order={fail:0,pending:1,pass:2};for(const c of [...m.checks].sort((a,b)=>(order[a.status]??3)-(order[b.status]??3))){if(!Object.hasOwn(order,c.status)||typeof c.message!=='string')continue;const li=document.createElement('li');li.dataset.state=c.status;li.textContent=({fail:'Zu korrigieren: ',pending:'Noch offen: ',pass:'Geprüft: '})[c.status]+c.message;$('mediaChecks').append(li);}
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
 if(data.status==='empty'){clearDraft();status(selectedAsset?'Für diese Datei und dieses Portal ist noch kein Text vorbereitet.':'Noch keine Textvorlage gespeichert.');return;}
 fillInput(data.input);const result=data.status==='processing'?await waitForResult(data.id):data;if(result.status==='failed')throw Error(errorText(result));render(result);status(selectedAsset?'Zugeordneten Text für '+selectedAsset.name+' geladen.':'Gespeicherte Textvorlage geladen.');
 }catch(e){if(selectedAsset)clearDraft();status(e.message,true);}finally{lock(false);syncMedia();}}
$('assetSelect').addEventListener('change',async()=>{if(busy)return;if(dirty){$('assetSelect').value=selectedAsset?.id||'';status('Bitte speichere deine Änderungen zuerst oder lade den letzten gespeicherten Text.',true);return;}const id=$('assetSelect').value;selectedAsset=assets.find(a=>a.id===id)||null;assignmentRevision=selectedAsset?.assignments?.find(a=>a.platform===selectedPortal)?.revision||0;clearDraft();$('assetStatus').textContent=selectedAsset?'Ausgewählt: '+selectedAsset.name:'Allgemeine Textvorlage · ohne Dateizuordnung';syncMedia();await loadLatest();});
$('refreshFiles').addEventListener('click',async()=>{if(busy)return;if(dirty){status('Bitte speichere zuerst deine Änderungen.',true);return;}lock(true);try{status('Dein Kundenordner wird geprüft …');const auth=await session();const r=await fetch(fileEndpoint,{method:'POST',headers:{Authorization:'Bearer '+auth.access_token},credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(90000)});const d=await r.json();if(!r.ok||!d.ok)throw Error(errorText(d));await loadFiles();fileChanged();await loadLatest();}catch(e){status(e.message,true);}finally{lock(false);syncMedia();}});
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
  if(data.status==='failed'){attempt.finished=true;throw Error(errorText(data));}attempt.finished=true;if(selectedAsset){data=await fileRpc('assign',{...fileContext(),preview_id:data.id,preview_revision:data.revision});const bound=selectedAsset.assignments?.find(a=>a.platform===selectedPortal);if(bound)bound.revision=data.assignment_revision;fileChanged();}render(data);status('Die Textvorschau ist gespeichert. Prüfe jetzt die Inhalte und passe sie bei Bedarf an.');
 }catch(e){status(e.message,true);}finally{lock(false);syncMedia();}
});
$('save').addEventListener('click',async()=>{if(busy||!current)return;const edits=[...$('drafts').children].map(card=>({platform:card.dataset.platform,title:card.querySelector('[data-field=title]').value.trim(),body:card.querySelector('[data-field=body]').value.trim()}));const drafts=current.preview.drafts.map(d=>edits.find(e=>e.platform===d.platform)||{platform:d.platform,title:d.title,body:d.body});if(drafts.some(d=>!d.title||d.title.length>80||d.body.length<10||d.body.length>1200)){status(messages.INVALID_EDIT,true);return;}lock(true);$('saveStatus').textContent='Wird gespeichert …';try{const result=selectedAsset?await fileRpc('save',{...fileContext(),title:edits[0].title,body:edits[0].body}):await rpc('save',{revision:current.revision,drafts},current.id);render(result);if(selectedAsset){const bound=selectedAsset.assignments?.find(a=>a.platform===selectedPortal);if(bound)bound.revision=result.assignment_revision;fileChanged();}status('Änderungen gespeichert. Der Shop-Link ist weiterhin enthalten.');}catch(e){status(e.message,true);$('saveStatus').textContent='Änderungen noch nicht gespeichert';}finally{lock(false);syncMedia();}});
supabase.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){lock(true);$('result').hidden=true;current=null;assets=[];selectedAsset=null;$('assetSelect').replaceChildren();$('assetStatus').textContent='';resetMediaCheck(messages.AUTH_REQUIRED);status(messages.AUTH_REQUIRED,true);}});
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&window.parent!==window){event.preventDefault();window.top.postMessage({type:'sma-publication-preview-close'},location.origin);}});
try{await session();let ready=true;if(selectedPortal){try{await loadFiles(params.get('asset'));}catch(e){ready=false;lock(false);status(e.message,true);}}if(ready)await loadLatest();}catch(e){lock(true);status(e.message,true);}
