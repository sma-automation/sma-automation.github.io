import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {createFileJobClient,fileJobAnchor} from './file-job-client.mjs?v=3';
import {createOrderClient,accountChoiceOptions,orderError} from './publication-order.mjs';
import {refreshMediaCatalog} from './media-metadata.mjs?v=3';
import {nextViennaDay} from './publication-daily-schedule.mjs?v=3';

const db=createClient('https://bnvnmdxosbnuzedokqgh.supabase.co','sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW');
const day=new URLSearchParams(location.search).get('tag')||nextViennaDay();
const el=id=>document.getElementById(id);
const label={youtube:'YouTube',tiktok:'TikTok'};
const clock=new Intl.DateTimeFormat('de-AT',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Vienna'});
let owner, working=false, visible=[], pending=[], accounts=new Map();
const mediaUrls=[];
function write(parent,tag,value){const n=document.createElement(tag);n.textContent=value;parent.append(n);return n;}
function select(parent,title,options,initial=''){
 const l=write(parent,'label',title),s=document.createElement('select');l.append(s);
 for(const [v,t] of options)s.append(new Option(t,v));s.value=initial;return s;
}
function box(parent,title,disabled=false){
 const l=write(parent,'label',''),b=document.createElement('input');b.type='checkbox';b.disabled=disabled;l.append(b,' '+title);return b;
}
const yesNo=[['','Auswählen'],['true','Ja'],['false','Nein']];
async function session(){
 const {data,error}=await db.auth.getSession(),s=data?.session;
 if(error||!s||owner&&s.user.id!==owner)throw Object.assign(Error('Bitte melde dich erneut an.'),{code:'AUTH_REQUIRED'});
 return s;
}
const jobs=createFileJobClient({session});
function clientFor(item){
 return createOrderClient({session,command:(action,input,options)=>jobs.request({
  anchor:fileJobAnchor(item),operation:action==='account'?'account':'order_prepare',input,timeoutMs:145000,retryAfter:options?.retryAfter
 })});
}
async function rpc(args){
 await session();const {data,error}=await db.rpc('sma_rotating_day_v1',{p_day:day,...args});
 if(error||!data?.ok)throw Object.assign(Error('Tagesplan konnte nicht übernommen werden.'),{code:data?.code||'NETWORK'});
 return data;
}
function issue(i){
 if(i.slot_conflict)return 'Termin wurde geändert und wird abgeglichen';
 if(i.existing_order)return 'Bereits im Versandplan';
 if(!i.current_file)return 'Datei oder Portalzuordnung wird geprüft';
 if(!i.title||!i.caption||!i.preview_id)return 'Beitragstext wird automatisch vorbereitet';
 if(i.previous_order&&!i.repeatable)return 'Früherer Versandauftrag muss geklärt werden';
 return '';
}
function mediaPreview(host,i){
 const details=write(host,'details','');write(details,'summary','Video und Beitrag ansehen');
 write(details,'p',i.caption||'Beitragstext in Vorbereitung');
 const edit=write(details,'a','Beitrag im Optimizer bearbeiten');
 edit.href='./publication-preview.html?wide=1&portal='+i.platform+'&asset='+encodeURIComponent(i.asset_id);edit.target='_blank';edit.rel='noopener';
 let loading=false;
 details.addEventListener('toggle',async()=>{
  if(!details.open||loading||details.querySelector('video'))return;
  loading=true;const info=write(details,'small','Video wird geladen …');
  try{
   const {editorSource}=await import('./media-editor-api.mjs?v=13');
   const blob=await editorSource({id:i.asset_id,revision:i.asset_revision,mime_type:i.mime_type,size_bytes:i.size_bytes},undefined,owner);
   await session();const video=document.createElement('video');const url=URL.createObjectURL(blob);mediaUrls.push(url);
   video.controls=true;video.preload='metadata';video.src=url;details.append(video);info.remove();
  }catch{info.textContent='Video derzeit nicht verfügbar.';}finally{loading=false;}
 });
}
function addRow(i){
 const row=write(el('posts'),'article','');
 write(row,'small',clock.format(new Date(i.due_at))+' Uhr · '+label[i.platform]);write(row,'strong',i.title||i.name);
 mediaPreview(row,i);
 const hold=issue(i);
 if(hold){write(row,'small',hold);return;}
 const acct=accounts.get(i.platform);
 if(!acct||acct.target.id!==i.target_id){write(row,'small','Zielkonto konnte nicht bestätigt werden.');return;}
 const controls={};let choice,inherits;
 if(i.platform==='youtube'){
  const vis=select(row,'Sichtbarkeit',[['public','Öffentlich'],['unlisted','Nicht gelistet'],['private','Privat']],'public');
  const opts=write(row,'details','');write(opts,'summary','Zielgruppe und KI');
  const kids=select(opts,'Für Kinder',yesNo,String(i.defaults?.made_for_kids??''));
  const ai=select(opts,'Realistisch verändert oder KI',yesNo,String(i.defaults?.contains_synthetic_media??''));
  choice=()=>kids.value&&ai.value?{visibility:vis.value,made_for_kids:kids.value==='true',contains_synthetic_media:ai.value==='true'}:null;
 }else{
  const allowed=accountChoiceOptions('tiktok',acct);
  const saved=allowed.visibility.some(([value])=>value===i.saved_visibility)?i.saved_visibility:'';
  const vis=select(row,'Sichtbarkeit',[['','Auswählen'],...allowed.visibility],saved);
  const saveStatus=write(row,'small','');saveStatus.setAttribute('role','status');
  let saving=false,confirmed=saved;
  vis.addEventListener('change',async()=>{
   const selected=vis.value;
   saving=true;vis.disabled=true;saveStatus.textContent='Sichtbarkeit wird gespeichert …';refreshButton();
   try{
    await session();
    const {data,error}=await db.rpc('sma_save_day_visibility_v1',{p_day:day,p_key:i.visibility_key,p_visibility:selected||null});
    if(error||data?.ok!==true||data.visibility!==(selected||null))throw Error();
    confirmed=selected;saveStatus.textContent=confirmed?'Auswahl gespeichert.':'Auswahl entfernt.';
   }catch{
    vis.value=confirmed;saveStatus.textContent='Speichern nicht bestätigt. Lade den aktuellen Stand.';
    el('reload').hidden=false;
   }finally{
    saving=false;vis.disabled=false;third.disabled=vis.value==='SELF_ONLY';if(third.disabled)third.checked=false;
    refreshButton();
   }
  });
  const opts=write(row,'details','');write(opts,'summary','Interaktionen, Werbung und KI');
  for(const [key,title] of [['disable_comment','Kommentare'],['disable_duet','Duette'],['disable_stitch','Stitch']])controls[key]=box(opts,title,allowed.forced[key]);
  const commercial=box(opts,'Dieser Beitrag bewirbt eine Marke, ein Produkt oder eine Dienstleistung');
  const brands=write(opts,'div','');brands.hidden=true;
  const own=box(brands,'Eigene Marke'),third=box(brands,'Bezahlte Partnerschaft',saved==='SELF_ONLY');
  const disclosure=write(brands,'small','');
  const display=()=>{brands.hidden=!commercial.checked;if(!commercial.checked){own.checked=false;third.checked=false;}
   disclosure.textContent=third.checked?'TikTok zeigt „Bezahlte Partnerschaft“.':own.checked?'TikTok kennzeichnet diesen Beitrag als Werbung.':'Wähle die Art der Werbung.';
   for(const option of vis.options)if(option.value==='SELF_ONLY')option.disabled=third.checked;};
  for(const control of [commercial,own,third])control.addEventListener('change',display);
  const ai=select(opts,'KI-Kennzeichnung',[['','Ordnervorgabe'],...yesNo.slice(1)]);
  vis.addEventListener('change',()=>{third.disabled=vis.value==='SELF_ONLY';if(third.disabled)third.checked=false;});
  const syncThird=()=>{for(const opt of vis.options)if(opt.value==='SELF_ONLY')opt.disabled=third.checked;};
  third.addEventListener('change',syncThird);
  choice=()=>{
   const value=ai.value||el('ai').value;
   if(saving||!vis.value||!value||commercial.checked&&!own.checked&&!third.checked||third.checked&&vis.value==='SELF_ONLY')return null;
   return {visibility:vis.value,is_aigc:value==='true',brand_content_toggle:third.checked,brand_organic_toggle:own.checked,
    ...Object.fromEntries(Object.entries(controls).map(([key,b])=>[key,!b.checked]))};
  };
  inherits=()=>!ai.value&&!!el('ai').value;
 }
 pending.push({i,choice,inherits});
}
function refreshButton(){
 const all=pending.map(p=>p.choice()),tiktok=pending.some(p=>p.i.platform==='tiktok');
 el('ttterms').hidden=!tiktok;el('branded').hidden=!all.some(c=>c?.brand_content_toggle);
 el('confirm').hidden=el('terms').hidden=!pending.length;
 el('confirm').disabled=working||all.some(c=>!c);
 el('confirm').textContent=working?'Freigabe wird gespeichert …':pending.length+' Beiträge zur Veröffentlichung freigeben';
}
function redraw(){
 pending=[];el('posts').replaceChildren();for(const i of visible)addRow(i);
 const tt=pending.find(p=>p.i.platform==='tiktok');
 el('options').hidden=!tt;el('ai').value=typeof tt?.i.tiktok_ai==='boolean'?String(tt.i.tiktok_ai):'';
 refreshButton();
}
function codeMessage(e){
 if(e.code==='PLAN_CHANGED'||e.code==='REQUEST_CONFLICT')return 'Der Plan wurde inzwischen geändert. Lade den aktuellen Stand.';
 return e.code?orderError(e.code):e.message;
}
async function load(){
 owner=(await session()).user.id;
 const data=await rpc({}); visible=data.items;
 el('day').textContent=new Intl.DateTimeFormat('de-AT',{dateStyle:'full',timeZone:'Europe/Vienna'}).format(new Date(day+'T12:00:00Z'));
 await Promise.all(Object.keys(label).map(async platform=>{
  const i=visible.find(x=>x.platform===platform&&!issue(x));if(!i)return;
  try{const acct=await clientFor(i).account(platform);if(acct.target.id===i.target_id)accounts.set(platform,acct);}
  catch(err){el('reload').hidden=false;}
 }));
 const old=savedAttempt();
 if(old?.id){const known=await rpc({p_request:old.id});if(known.receipt){try{sessionStorage.removeItem(key());}catch{}}}
 el('accounts').textContent=[...accounts].map(([p,a])=>label[p]+' · '+a.account_check.display_name).join('   /   ');
 redraw();el('status').textContent=visible.length?'':'Für diesen Tag sind noch keine Versandkanäle eingeplant.';
}
const key=()=>['sma-day-release-v1',owner,day].join('/');
function saveAttempt(attempt){try{sessionStorage.setItem(key(),JSON.stringify(attempt));}catch{/* The server also deduplicates approvals. */}}
function savedAttempt(){try{return JSON.parse(sessionStorage.getItem(key()));}catch{return null;}}
function receipt(r){el('status').textContent=r.approved+' Beiträge freigegeben. SMA prüft die Aufträge und übernimmt den Versand zum Termin.';}
async function submit(){
 if(working||el('confirm').disabled)return;
 const selected=pending.map(p=>({i:p.i,choices:p.choice(),saveAI:p.inherits?.()===true}));
 working=true;refreshButton();document.querySelectorAll('select,input').forEach(n=>{n.dataset.preDisabled=String(n.disabled);n.disabled=true;});
 let committed=false;
 try{
  const old=savedAttempt();
  if(old?.id){
   const known=await rpc({p_request:old.id});
   if(known.receipt){receipt(known);committed=true;return;}
   try{sessionStorage.removeItem(key());}catch{}
  }
  let refresh;
  const refreshFiles=()=>refresh??=refreshMediaCatalog({owner,getSession:session,readStatus:async signal=>{
   const {data,error}=await db.rpc('sma_publication_files_v1',{p_action:'sync_status',p_input:{}}).abortSignal(signal);
   if(error)throw error;return data;}}).finally(()=>{refresh=null;});
  if(selected.some(({i})=>!i.verified_at||Date.parse(i.verified_at)<Date.now()-12*60000)){
   el('status').textContent='SMA gleicht die geplanten Dateien mit Drive ab …';
   try{await refreshFiles();}catch{/* Each exact file is independently checked at preparation. */}
  }
  const entries=[],deferred=[],slotLabels=new Map();
  for(const [index,{i,choices,saveAI}] of selected.entries()){
   el('status').textContent='Versand wird vorbereitet · '+(index+1)+' von '+selected.length;
   try{
   const binding={};for(const key of ['asset_id','asset_revision','platform','assignment_revision','preview_id','preview_revision'])binding[key]=i[key];
   const order=clientFor(i),requestId=crypto.randomUUID(),target=i.repeatable?undefined:i.target_id;
   let prepared;
   try{prepared=await order.prepare(binding,choices,requestId,target);}
   catch(e){
    if(e.code!=='FILE_REFRESH_REQUIRED')throw e;
    await refreshFiles();prepared=await order.prepare(binding,choices,requestId,target,{retryAfter:'FILE_REFRESH_REQUIRED'});
   }
   const seen=accounts.get(i.platform);
   if(prepared.state!=='prepared'||!prepared.approval_token||prepared.target?.id!==i.target_id||
      prepared.draft?.title!==i.title||prepared.draft?.caption!==i.caption||
      prepared.account_check?.display_name!==seen.account_check.display_name||
      Object.keys(choices).length!==Object.keys(prepared.choices||{}).length||
      Object.entries(choices).some(([k,v])=>prepared.choices[k]!==v))throw Object.assign(Error(),{code:'PLAN_CHANGED'});
   slotLabels.set(prepared.id,clock.format(new Date(i.due_at))+' '+label[i.platform]);
   entries.push({order_id:prepared.id,token:prepared.approval_token,choices,plan_version:i.plan_version,due_at:i.due_at,save_folder_ai:saveAI});
   }catch(e){if(e.code==='AUTH_REQUIRED')throw e;deferred.push(clock.format(new Date(i.due_at))+' '+label[i.platform]);}
  }
  if(!entries.length)throw Error('Noch kein Auftrag ist bereit. Die geplanten Dateien bleiben erhalten.');
  const attempt={id:crypto.randomUUID(),entries};saveAttempt({id:attempt.id});
  let result;
  try{result=await rpc({p_request:attempt.id,p_entries:entries});}
  catch(e){
   if(!['PLAN_CHANGED','DUPLICATE_PUBLICATION','ORDER_NOT_PREPARED','TARGET_OPTIONS_CHANGED'].includes(e.code))throw e;
   // The aggregate transaction rolled back. Continue independently with the same signed selections.
   let approved=0;
   for(const entry of entries){
    try{const one=await rpc({p_request:entry.order_id,p_entries:[entry]});approved+=one.approved;}
    catch(error){
     if(error.code==='NETWORK'||error.code==='AUTH_REQUIRED')throw error;
     deferred.push(slotLabels.get(entry.order_id));
    }
   }
   if(!approved)throw e;result={approved};
  }
  receipt(result);if(deferred.length)el('status').textContent+=' Weiter offen: '+deferred.join(', ')+'.';committed=true;
 }catch(e){
  if(e.code!=='NETWORK'){try{sessionStorage.removeItem(key());}catch{}}
  el('status').textContent=codeMessage(e);el('reload').hidden=false;
 }finally{
  working=false;document.querySelectorAll('[data-pre-disabled]').forEach(n=>{n.disabled=n.dataset.preDisabled==='true';delete n.dataset.preDisabled;});
  if(committed){document.removeEventListener('change',refreshButton);try{sessionStorage.removeItem(key());}catch{}el('confirm').hidden=el('terms').hidden=el('options').hidden=true;el('reload').hidden=false;}
  else refreshButton();
 }
}
document.addEventListener('change',refreshButton);el('confirm').addEventListener('click',submit);el('reload').onclick=()=>location.reload();
window.addEventListener('pagehide',()=>{jobs.clear();mediaUrls.forEach(url=>URL.revokeObjectURL(url));});
load().catch(e=>{el('status').textContent=e.code==='AUTH_REQUIRED'?'Bitte melde dich im SMA-Konto an.':codeMessage(e);el('login').hidden=e.code!=='AUTH_REQUIRED';el('reload').hidden=false;});
