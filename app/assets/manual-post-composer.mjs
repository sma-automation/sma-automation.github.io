import {draftDestination} from './publication-destination.mjs?v=1';
import {installOrderReview} from './publication-order.mjs?v=34';
import {parseHashtags} from './publication-hashtags.mjs?v=2';
import {createFileJobClient,fileJobAnchor} from './file-job-client.mjs?v=1';

export function mountManualComposer({doc,platform,owner,portalName,session,rpc,current,refreshFile,canSchedule,beforeSend,onReceipt,onChange}){
 const element=id=>doc.getElementById(id);
 const body=element('postBody'),tags=element('postTags'),send=element('send'),notice=element('sendNotice');
 const saveButton=element('saveDraft'),draftNotice=element('draftNotice'),preview=element('previewCaption');
 const fields={body,hashtags:tags},buffers=new Map();
 const looseKey='sma/manual-text/'+owner+'/'+platform;
 let edits={},pendingRead=null,saving=false,disposed=false,looseDirty=false,transferred=null;
 const jobs=createFileJobClient({session});
 let file=null,record=null,draft=null,loaded=false,working=false,epoch=0,saveAttempt=null,sendAttempt=null,delivery=false,awaiting=false;
 const read=f=>rpc('sma_publication_files_v1',{p_action:'get',p_input:{asset_id:f.id,platform}});
 function message(text,error=false){notice.textContent=text;notice.dataset.error=String(error);}
 function storedBody(){return record?.input?.editor_body??draft?.body??'';}
 function storedTags(){return (draft?.hashtags||[]).map(t=>'#'+t).join(' ');}
 function unchanged(){return loaded&&body.value===storedBody()&&tags.value===storedTags();}
 function draftMessage(text,error=false){draftNotice.textContent=text;draftNotice.dataset.error=String(error);}
 function renderText(){
  const hashtags=tags.value.trim().split(/\s+/u).filter(Boolean).map(t=>t.startsWith('#')?t:'#'+t).join(' ');
  const language=record?.preview?.language,shop=draftDestination(record?.preview?.shop_url,draft,language);
  const text=body.value.trim(),caption=[text];
  if(text&&shop){
   const invitation=language==='en'?'Feel free to visit my shop!':'Schau doch mal in meinem Shop vorbei!';
   if(!text.endsWith('\n\n'+invitation))caption.push(invitation);
  }
  caption.push(hashtags);
  if(text&&shop)caption.push('🛒 '+shop.label+': '+shop.url);
  preview.textContent=draft&&unchanged()?draft.caption:caption.filter(Boolean).join('\n\n');
  element('textPreview').hidden=!preview.textContent;
 }
 function fill(){
  const values={body:edits.body??storedBody(),hashtags:edits.hashtags??storedTags()};
  for(const [key,field] of Object.entries(fields))if(field.value!==values[key])field.value=values[key];
  renderText();
 }
 function fileKey(f){return f.id+'/'+f.revision;}
 // Before a file is selected, an explicitly saved text belongs to this browser, customer and portal.
 function readLoose(){
  try{const value=JSON.parse(localStorage.getItem(looseKey));return Object.fromEntries(Object.entries(value||{}).filter(([k,v])=>Object.hasOwn(fields,k)&&typeof v==='string'));}catch{return {};}
 }
 function available(){return file&&file.profile_media?.state!=='private_preview_only';}
 function controls(){
  send.disabled=disposed||!available()||!loaded||working||saving||delivery;
  saveButton.disabled=disposed||working||saving;
  saveButton.setAttribute('aria-busy',String(saving));
  send.setAttribute('aria-busy',String(working||awaiting));onChange();
 }
 function check(g){
  const selected=current();
  if(g!==epoch||!file||selected?.id!==file.id||selected.revision!==file.revision)throw Error('Die ausgewählte Dateiversion hat sich geändert.');
 }
 function adopt(result){
  const d=result.preview?.drafts?.find(row=>row.platform===platform);
  if(result.status!=='empty'&&(!d||result.status!=='completed'||!Number.isInteger(result.revision)||!Number.isInteger(result.assignment_revision)))throw Error('Der gespeicherte Beitrag konnte nicht geladen werden.');
  record=result;draft=d||null;
 }
 function loadFile(g){
  const pending=read(file).then(data=>{check(g);adopt(data);loaded=true;fill();});
  pendingRead=pending;
  return pending.finally(()=>{if(pendingRead===pending)pendingRead=null;if(g===epoch)controls();});
 }
 async function select(next,fromPicker=false){
  if(disposed)return;
  if(file?.id===next?.id&&file?.revision===next?.revision){file=next;controls();return;}
  const previous=file;
  if(previous)buffers.set(fileKey(previous),edits);
  const g=++epoch;review.clear();file=next;record=draft=null;pendingRead=null;loaded=working=saving=delivery=awaiting=false;saveAttempt=sendAttempt=null;
  if(next){
   if(!previous&&(fromPicker||looseDirty)){
    transferred={key:fileKey(next),snapshot:JSON.stringify(readLoose())};looseDirty=false;
   }else edits=buffers.get(fileKey(next))||{};
  }else edits=readLoose();
  fill();message('');draftMessage('');controls();
  if(next)try{await loadFile(g);}catch(e){if(g===epoch)draftMessage(e.message,true);}
 }
 function binding(){return {asset_id:file.id,asset_revision:file.revision,platform,assignment_revision:record.assignment_revision??0,
  preview_id:record.id??null,preview_revision:record.revision??null};}
 function context(){
  check(epoch);
  if(!draft||!unchanged())throw Error('Der Beitrag hat sich geändert. Prüfe die aktuelle Fassung.');
  return {name:file.name,post:{title:draft.title,caption:draft.caption},productId:draft.product_id,binding:binding()};
 }
 async function verify(ctx){
  const g=epoch,saved=await read(file);check(g);
  const d=saved.preview?.drafts?.find(v=>v.platform===platform);
  if(!unchanged()||ctx.binding.preview_id!==saved.id||ctx.binding.preview_revision!==saved.revision||ctx.binding.assignment_revision!==saved.assignment_revision||
     !d||d.title!==ctx.post.title||d.caption!==ctx.post.caption||d.product_id!==ctx.productId)throw Error('Der Beitrag wurde inzwischen geändert. Aktualisiere die Dateiliste.');
  if((d.offer_provider==='digistore24'&&saved.offer_link_available!==true)||(d.product_id&&d.offer_provider!=='digistore24'&&saved.product_link_available!==true))throw Error('Der Produktlink ist derzeit nicht verfügbar. Prüfe ihn im Beitragseditor.');
 }
 const editor=(action,input)=>rpc('sma_content_editor_v1',{p_action:action,p_input:input});
 function attempt(previous,input){
  const signature=JSON.stringify(input);
  return previous?.signature===signature?previous:{signature,id:crypto.randomUUID()};
 }
 async function save(g){
  if(draft&&unchanged()){clearTransferred();return;}
  const text=body.value.trim(),hashtags=parseHashtags(tags.value);
  if(text.length<10){body.focus();throw Error('Gib einen Beitragstext mit mindestens 10 Zeichen ein.');}
  const input={...binding(),title:draft?.title||text.split(/\r?\n/)[0].slice(0,80),body:text,hashtags,
   source_text:record.input?.editor_source_text??record.input?.source_text??'',language:record.preview?.language||'de'};
  saveAttempt=attempt(saveAttempt,input);
  const entered={body:body.value,hashtags:tags.value};
  const saved=await editor('save',{...input,request_id:saveAttempt.id});check(g);
  const confirmed=saved.preview?.drafts?.find(d=>d.platform===platform);
  if(saved.status!=='completed'||(saved.input?.editor_body??confirmed?.body)!==text||JSON.stringify(confirmed?.hashtags)!==JSON.stringify(hashtags))throw Error('Text oder Hashtags wurden nicht wie eingegeben bestätigt.');
  adopt(saved);
  for(const [key,field] of Object.entries(fields))if(field.value===entered[key])delete edits[key];
  fill();saveAttempt=null;clearTransferred();
 }
 function clearTransferred(){
  if(transferred?.key===fileKey(file)){
   // A saved, file-bound draft supersedes its unassigned copy on this device.
   try{if(JSON.stringify(readLoose())===transferred.snapshot)localStorage.removeItem(looseKey);}catch{}transferred=null;
  }
 }
 async function saveDraft(){
  if(saveButton.disabled)return;
  const g=epoch;saving=true;controls();
  try{
   if(!file){
    localStorage.setItem(looseKey,JSON.stringify(edits));
    draftMessage('Text auf diesem Gerät gespeichert. Wähle eine Datei, um ihn dem Beitrag zuzuordnen.');return;
   }
   draftMessage('Entwurf wird gespeichert …');
   if(!loaded)await (pendingRead||loadFile(g));
   check(g);await save(g);check(g);
   draftMessage(unchanged()?'Entwurf gespeichert.':'Fassung gespeichert. Weitere Änderungen sind noch offen.');
  }catch(e){
   if(g===epoch){
    if(['ASSIGNMENT_CONFLICT','REVISION_CONFLICT'].includes(e.code))loaded=false;
    draftMessage(e.message,true);
   }
  }finally{if(g===epoch){saving=false;controls();}}
 }
 async function submit(ctx,order){
  const g=epoch;
  if(JSON.stringify(context().binding)!==JSON.stringify(ctx.binding))throw Error('Die Freigabe gehört zu einer anderen Beitragsfassung.');
  const input={...ctx.binding,...(order?{order}: {})};
  sendAttempt=attempt(sendAttempt,input);
  beforeSend(order);
  const result=await editor('send',{...input,request_id:sendAttempt.id});check(g);
  if(result.state==='approval_required')return false;
  if(result.accepted===false&&!result.pending&&['approved','checked','checking'].includes(result.state)){
   throw Error('Der Versanddienst hat den Auftrag nicht angenommen. Prüfe den aktuellen Freigabe- und Versandstand.');
  }
  if(!result.order)throw Error('SMA hat keinen Versandauftrag für diesen Beitrag bestätigt.');
  message('');await onReceipt(result,file);return true;
 }
 const orderRpc=(action,id,extra={})=>rpc('sma_publication_order_v1',{p_action:action,p_input:{id,...extra}});
 const review=installOrderReview(doc,{session,host:element('approvalControls'),portalName,getContext:context,verifySavedDraft:verify,
  refresh:refreshFile,readStoredOrder:id=>orderRpc('get',id),cancelStoredOrder:id=>orderRpc('cancel',id),
  readYoutubeDefaults:(b,channel)=>rpc('sma_youtube_file_defaults_v1',{p_asset_id:b.asset_id,p_asset_revision:b.asset_revision,p_channel_id:channel}),
  saveSupplementalReview:(id,r)=>orderRpc('supplement',id,{confirm:true,review:r}),
  command:(action,input,b,options)=>action==='get'?orderRpc('get',input.id).then(data=>Response.json(data)):
   jobs.request({anchor:fileJobAnchor(b),operation:{account:'account',prepare:'order_prepare',approve:'order_approve'}[action],input,timeoutMs:145000,retryAfter:options?.retryAfter}),
  sendApproved:async(order,ctx)=>{
   const g=epoch;working=true;controls();
   try{
    if(!await submit(ctx,order.id))throw Error('Die Bestätigung passt nicht mehr zur aktuellen Beitragsfassung.');
    return element('status').textContent;
   }catch(e){if(g===epoch)message(e.message,true);return e.message;}
   finally{if(g===epoch){working=false;controls();}}
  }});
 async function post(){
  if(send.disabled||working)return;
  const g=epoch;working=true;controls();message('Beitrag wird geprüft …');
  try{
   await save(g);check(g);const ctx=context();await verify(ctx);check(g);
   if(!await submit(ctx)){
    message('Bestätige Zielkonto und Sichtbarkeit für diesen Beitrag.');
    await review.openInstant();
   }
  }catch(e){if(g===epoch)message(e.message,true);}
  finally{if(g===epoch){working=false;controls();}}
 }
 edits=readLoose();
 for(const [key,field] of Object.entries(fields)){
  if(field.value){edits[key]=field.value;looseDirty=true;}
  field.addEventListener('input',()=>{
   if(disposed)return;
   edits[key]=field.value;if(!file)looseDirty=true;message('');draftMessage('');renderText();onChange();
  });
 }
 fill();controls();
 saveButton.addEventListener('click',saveDraft);
 send.addEventListener('click',post);
 return {select,allowsSchedule:()=>available()&&unchanged()&&!saving&&!working&&!delivery&&canSchedule(),isWorking:()=>working||saving,
  setDelivery(active,progress=active){delivery=active;awaiting=progress;controls();},retrySelection(){if(!loaded&&file&&!pendingRead)return loadFile(epoch).catch(e=>draftMessage(e.message,true));},
  dispose(){disposed=true;epoch++;file=record=draft=null;loaded=false;edits={};buffers.clear();fill();message('');draftMessage('');controls();jobs.clear();review.clear();}};
}
