import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
const supabase=createClient('https://bnvnmdxosbnuzedokqgh.supabase.co','sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW');
const endpoint='https://johnmusic.app.n8n.cloud/webhook/sma-publication-preview-v1';
const $=id=>document.getElementById(id);
const names={youtube:'YouTube',instagram:'Instagram',facebook:'Facebook',tiktok:'TikTok'};
const messages={AUTH_REQUIRED:'Bitte melde dich erneut im SMA-Dashboard an.',ACCESS_INACTIVE:'Dein SMA-Zugang ist derzeit nicht aktiv.',ACCOUNT_UNAVAILABLE:'Dein Konto konnte nicht eindeutig zugeordnet werden.',PUBLIC_SHOP_REQUIRED:'Für dein Konto muss zuerst ein öffentlicher SMA-Shop eingerichtet sein.',RATE_LIMITED:'Bitte warte kurz. Zum Schutz vor Mehrfachanfragen gilt mindestens 30 Sekunden Abstand und höchstens 20 Vorschauen pro Stunde.',PREPARATION_RUNNING:'Eine Vorschau wird bereits erstellt. Lade in Kürze die letzte Vorschau.',REVISION_CONFLICT:'Die Vorschau wurde zwischenzeitlich geändert. Lade die letzte Vorschau, bevor du erneut speicherst.',ACCOUNT_CHANGED:'Die Shop-Zuordnung hat sich geändert. Bitte erstelle eine neue Vorschau.',INVALID_EDIT:'Bitte prüfe Titel und Text: keine zusätzlichen Links, Hashtags, @-Angaben oder „Link im Profil“. Titel maximal 80, Text 10–1200 Zeichen.',YOUTUBE_REQUIRES_VIDEO:'Für YouTube bitte Video auswählen.',PREPARATION_TIMEOUT:'Die Erstellung hat zu lange gedauert. Bitte starte eine neue Vorschau.',PREPARATION_FAILED:'Die Texte konnten nicht vollständig geprüft werden. Bitte erstelle eine neue Vorschau.',PREPARATION_UNAVAILABLE:'Die Vorschau ist gerade nicht erreichbar. Bitte versuche es erneut.',INVALID_INPUT:'Bitte prüfe deine Angaben und wähle mindestens ein Portal.'};
let current=null,busy=false,attempt=null;
const params=new URLSearchParams(location.search);
const requestedPortal=params.get('portal');
const selectedPortal=Object.hasOwn(names,requestedPortal)?requestedPortal:null;
if(params.get('embedded')==='1')document.body.classList.add('embedded');
if(selectedPortal){
 document.body.classList.add('portal-mode');$('portalSelection').hidden=true;$('portalNote').hidden=false;$('portalStatus').hidden=false;
 document.querySelector('h1').textContent=names[selectedPortal]+' optimieren';$('resultHeading').textContent='Text für '+names[selectedPortal];$('generate').textContent='Text optimieren';
}

function status(text,error=false){for(const id of ['status','portalStatus']){$(id).textContent=text;$(id).dataset.error=String(error);}}
function errorText(r){return messages[r?.code||r?.error_code]||'Die Anfrage konnte nicht abgeschlossen werden. Bitte versuche es erneut.';}
function lock(value){busy=value;$('inputFields').disabled=value;$('save').disabled=value;for(const el of $('drafts').querySelectorAll('input,textarea'))el.disabled=value;}
async function session(){const {data,error}=await supabase.auth.getSession();if(error||!data.session)throw Error(messages.AUTH_REQUIRED);return data.session;}
async function rpc(action,input={},id=null){const {data,error}=await supabase.rpc('sma_publication_preview_v1',{p_action:action,p_input:input,p_id:id});if(error)throw Error('Die Vorschau konnte nicht geladen oder gespeichert werden.');if(!data?.ok)throw Error(errorText(data));return data;}
function sourceInput(){const form=new FormData($('previewForm'));return {source_text:form.get('source_text').trim(),audience:form.get('audience').trim(),goal:form.get('goal').trim(),language:form.get('language'),media_kind:selectedPortal==='youtube'?'video':form.get('media_kind'),platforms:selectedPortal?[selectedPortal]:form.getAll('platforms')};}
function fillInput(input){if(!input)return;for(const k of ['source_text','audience','goal','language','media_kind'])$(k).value=input[k]||'';for(const c of document.querySelectorAll('[name=platforms]'))c.checked=input.platforms?.includes(c.value)===true;syncMedia();}
function syncMedia(){if(selectedPortal){for(const c of document.querySelectorAll('[name=platforms]'))c.checked=c.value===selectedPortal;if(selectedPortal==='youtube'){$('media_kind').value='video';$('media_kind').disabled=true;}}const yt=document.querySelector('[name=platforms][value=youtube]');yt.disabled=$('media_kind').value==='image';if(yt.disabled)yt.checked=false;}
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
  card.addEventListener('input',()=>{full.textContent=caption(d,card.querySelector('textarea').value);$('saveStatus').textContent='Ungespeicherte Änderungen';});$('drafts').append(card);
 }
 $('result').hidden=false;$('saveStatus').textContent='Vorschau gespeichert';if(selectedPortal)$('sourcePanel').open=false;
}
async function waitForResult(id){for(let i=0;i<50;i++){const r=await rpc('get',{},id);if(r.status==='completed')return r;if(r.status==='failed')throw Error(errorText(r));if(r.status==='empty')throw Error('Die Anfrage ist noch nicht angekommen. Du kannst sie erneut versuchen.');await new Promise(resolve=>setTimeout(resolve,3000));}throw Error('Die Erstellung läuft noch. Bitte lade gleich die letzte Vorschau.');}
async function loadLatest(){lock(true);try{const data=await rpc('latest',selectedPortal?{platform:selectedPortal}:{});if(data.status==='empty'){status('Noch keine Vorschau gespeichert.');return;}fillInput(data.input);const result=data.status==='processing'?await waitForResult(data.id):data;if(result.status==='failed')throw Error(errorText(result));render(result);status('Gespeicherte Textvorschau geladen.');}catch(e){status(e.message,true);}finally{lock(false);syncMedia();}}
$('media_kind').addEventListener('change',syncMedia);
$('loadLatest').addEventListener('click',()=>{if(!busy)loadLatest();});
$('previewForm').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;const input=sourceInput();if(!input.platforms.length){status(messages.INVALID_INPUT,true);return;}
 const signature=JSON.stringify(input);if(!attempt||attempt.signature!==signature||attempt.finished)attempt={signature,id:crypto.randomUUID(),finished:false};
 lock(true);status('Eigene Texte je Portal werden erstellt und der Shop-Link wird geprüft …');
 try{const auth=await session();let data;
  try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.access_token},body:JSON.stringify({...input,request_id:attempt.id}),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(110000)});if(!response.ok)throw Error('NETWORK');data=await response.json();}
  catch{status('Die Rückmeldung dauert länger. Der gespeicherte Status wird geprüft …');data=await waitForResult(attempt.id);}
  if(!data?.ok){attempt.finished=true;throw Error(errorText(data));}if(data.status==='processing')data=await waitForResult(data.id);
  if(data.status==='failed'){attempt.finished=true;throw Error(errorText(data));}render(data);attempt.finished=true;status('Die Textvorschau ist gespeichert. Prüfe jetzt die Inhalte und passe sie bei Bedarf an.');
 }catch(e){status(e.message,true);}finally{lock(false);syncMedia();}
});
$('save').addEventListener('click',async()=>{if(busy||!current)return;const edits=[...$('drafts').children].map(card=>({platform:card.dataset.platform,title:card.querySelector('[data-field=title]').value.trim(),body:card.querySelector('[data-field=body]').value.trim()}));const drafts=current.preview.drafts.map(d=>edits.find(e=>e.platform===d.platform)||{platform:d.platform,title:d.title,body:d.body});if(drafts.some(d=>!d.title||d.title.length>80||d.body.length<10||d.body.length>1200)){status(messages.INVALID_EDIT,true);return;}lock(true);$('saveStatus').textContent='Wird gespeichert …';try{const result=await rpc('save',{revision:current.revision,drafts},current.id);render(result);status('Änderungen gespeichert. Der Shop-Link ist weiterhin enthalten.');}catch(e){status(e.message,true);$('saveStatus').textContent='Änderungen noch nicht gespeichert';}finally{lock(false);syncMedia();}});
supabase.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){lock(true);$('result').hidden=true;current=null;status(messages.AUTH_REQUIRED,true);}});
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&window.parent!==window){event.preventDefault();window.top.postMessage({type:'sma-publication-preview-close'},location.origin);}});
try{await session();await loadLatest();}catch(e){lock(true);status(e.message,true);}
