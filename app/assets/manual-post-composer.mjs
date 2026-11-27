import {installOrderReview} from './publication-order.mjs?v=34';
import {parseHashtags} from './publication-hashtags.mjs?v=2';
import {createFileJobClient,fileJobAnchor} from './file-job-client.mjs?v=1';

export function mountManualComposer({doc,platform,portalName,session,rpc,current,refreshFile,canSchedule,beforeSend,onReceipt,onChange}){
 const element=id=>doc.getElementById(id);
 const body=element('postBody'),tags=element('postTags'),send=element('send'),notice=element('sendNotice');
 const jobs=createFileJobClient({session});
 let file=null,record=null,draft=null,loaded=false,working=false,epoch=0,saveAttempt=null,sendAttempt=null,delivery=false,awaiting=false;
 const read=f=>rpc('sma_publication_files_v1',{p_action:'get',p_input:{asset_id:f.id,platform}});
 function message(text,error=false){notice.textContent=text;notice.dataset.error=String(error);}
 function unchanged(){return loaded&&body.value===(draft?.body||'')&&tags.value===(draft?.hashtags||[]).map(t=>'#'+t).join(' ');}
 function available(){return file&&file.profile_media?.state!=='private_preview_only';}
 function controls(){
  send.disabled=!available()||!loaded||working||delivery;
  body.disabled=tags.disabled=!available()||!loaded||working||delivery;
  send.setAttribute('aria-busy',String(working||awaiting));onChange();
 }
 function check(g){
  const selected=current();
  if(g!==epoch||!file||selected?.id!==file.id||selected.revision!==file.revision)throw Error('Die ausgewählte Dateiversion hat sich geändert.');
 }
 function adopt(result){
  const d=result.preview?.drafts?.find(row=>row.platform===platform);
  if(result.status!=='empty'&&(!d||result.status!=='completed'||!Number.isInteger(result.revision)||!Number.isInteger(result.assignment_revision)))throw Error('Der gespeicherte Beitrag konnte nicht geladen werden.');
  record=result;draft=d||null;body.value=d?.body||'';tags.value=(d?.hashtags||[]).map(t=>'#'+t).join(' ');
 }
 async function select(next,force=false){
  if(!force&&file?.id===next?.id&&file?.revision===next?.revision){file=next;controls();return;}
  const g=++epoch;review.clear();file=next;record=draft=null;loaded=working=delivery=awaiting=false;saveAttempt=sendAttempt=null;
  body.value=tags.value='';message('');controls();
  if(!next)return;
  try{const data=await read(next);check(g);adopt(data);loaded=true;}
  catch(e){if(g===epoch)message(e.message,true);}
  finally{if(g===epoch)controls();}
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
  if(draft&&unchanged())return;
  const text=body.value.trim(),hashtags=parseHashtags(tags.value);
  if(text.length<10){body.focus();throw Error('Gib einen Beitragstext mit mindestens 10 Zeichen ein.');}
  const input={...binding(),title:draft?.title||text.split(/\r?\n/)[0].slice(0,80),body:text,hashtags,
   source_text:record.input?.editor_source_text??record.input?.source_text??'',language:record.preview?.language||'de'};
  saveAttempt=attempt(saveAttempt,input);
  const saved=await editor('save',{...input,request_id:saveAttempt.id});check(g);adopt(saved);
  if(draft?.body!==text||JSON.stringify(draft.hashtags)!==JSON.stringify(hashtags))throw Error('Text oder Hashtags wurden nicht wie eingegeben bestätigt.');
  saveAttempt=null;
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
 for(const field of [body,tags])field.addEventListener('input',()=>{message('');onChange();});
 send.addEventListener('click',post);
 return {select,allowsSchedule:()=>available()&&unchanged()&&!working&&!delivery&&canSchedule(),isWorking:()=>working,
  setDelivery(active,progress=active){delivery=active;awaiting=progress;controls();},retrySelection(){if(!loaded&&file)return select(file,true);},
  dispose(){epoch++;jobs.clear();review.clear();}};
}
