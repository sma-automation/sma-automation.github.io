import {historyStatuses} from './publication-history-model.mjs';
const clock=new Intl.DateTimeFormat('de-AT',{timeZone:'Europe/Vienna',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const states={approval_required:'Für dieses Video fehlt die Freigabe.',blocked:'Eine offene Prüfung blockiert den Versand. Öffne den Beitrag für die Details.',
 complete:'Das Portal hat den Beitrag bestätigt.',processing:'Das Portal verarbeitet das Video.',uploading:'Die Datei wird übertragen.',session_ready:'Das Portal ist für die Datei bereit.',failed:'Der Versand ist fehlgeschlagen.',uncertain:'Das Portal hat den letzten Versuch nicht bestätigt.',needs_review:'Der Übertragungsstand muss geklärt werden.'};
const tiktokReasons={TIKTOK_PUBLIC_AUDIT_REQUIRED:'TikTok verlangt die App-Freigabe für öffentliches Posten.',TIKTOK_ACCESS_TOKEN_INVALID:'Verbinde das TikTok-Konto erneut.',TIKTOK_SCOPE_NOT_AUTHORIZED:'TikTok hat die Berechtigung zum Veröffentlichen abgelehnt.',TIKTOK_VISIBILITY_CHANGED:'Prüfe die Sichtbarkeit im TikTok-Auftrag erneut.',TIKTOK_INVALID_PARAM:'TikTok hat die Beitragsdaten abgelehnt.',TIKTOK_APP_QUOTA:'TikToks App-Limit ist erreicht.',TIKTOK_RATE_LIMIT:'TikTok hat zu viele Anfragen erhalten.',TIKTOK_DAILY_LIMIT:'Das tägliche TikTok-Postinglimit ist erreicht.',TIKTOK_ACCOUNT_RESTRICTED:'TikTok hat dieses Konto für neue Beiträge gesperrt.'};

export function createDeliveryMonitor({rpc,transport,platform,portalName,ownsOrder,errorLabels={}}){
 const attempted=new Map();
 async function continueApproved(result){
  if(result.background||!result?.order||!ownsOrder(result.order)||!result.due||!result.pending||Date.parse(result.due)>Date.now()||
     Date.now()-Date.parse(result.due)>30*60000||document.hidden)return;
  const last=attempted.get(result.order);
  const stage=result.state+'/'+result.sequence;
  if(last?.stage===stage&&(last.at>Date.now()-25000||last.count>=2))return;
  const start={at:Date.now(),stage,count:last?.stage===stage?last.count+1:1};attempted.set(result.order,start);
  try{await transport.get(result.order);start.confirmed=true;}
  catch{start.failed=true;}
 }

 async function describe(r,expectedOrder,active,onProgress){
  if(expectedOrder&&expectedOrder!==r.order)throw Error('Der gestartete Versandauftrag konnte nicht eindeutig zugeordnet werden.');
  let text=tiktokReasons[r.provider_code]||states[r.state]||'Freigabe vorhanden.';
  if(r.state==='blocked'&&r.order&&!r.provider_code){
   const order=await rpc('sma_publication_order_v1',{p_action:'get',p_input:{id:r.order}});if(!active())return null;
   const reasons=(order.blockers||[]).map(b=>typeof b==='string'?b:b?.code).filter(Boolean);
   if(reasons.length)text+=' '+reasons.map(reason=>errorLabels[reason]||tiktokReasons[reason]||reason).join(' · ');
  }
  const safeRestart=r.pending&&r.state==='uncertain'&&r.bytes===0&&r.provider_code==='PROVIDER_INIT_UNCERTAIN';
  const terminal=!safeRestart&&['complete','failed','uncertain','needs_review','blocked','cancelled'].includes(r.state);
  if(r.provider_code&&!tiktokReasons[r.provider_code]&&terminal&&r.state!=='complete')text+=' ('+r.provider_code+')';
  if(r.state==='complete'){
   text='Das Portal bestätigt den Abschluss. Die Sichtbarkeit ist noch unbestätigt.';
   const h=await rpc('sma_publication_history_order_page_v1',{p_order_id:r.order});if(!active())return null;
   const row=h.entries?.find(x=>x.id===r.order&&x.platform===platform);
   if(row?.status==='public_confirmed')text='Erfolgreich veröffentlicht. '+portalName+' hat die öffentliche Sichtbarkeit bestätigt.';
   else if(['private_complete','unlisted_complete','limited_complete','complete_unknown'].includes(row?.status))text=historyStatuses[row.status].join('. ');
  }
  if(expectedOrder&&r.due&&!terminal&&!r.pending&&!['uploading','session_ready','processing'].includes(r.state)&&Date.now()-Date.parse(r.due)>=30*60000){
   return {text:'Das Versandfenster ist abgelaufen. Prüfe den Auftrag in der History.',locked:true,progress:false};
  }
  const pending=!terminal&&Boolean(r.pending||r.due&&['uploading','session_ready','processing'].includes(r.state));
  if(pending){
   text=Date.parse(r.due)>Date.now()?'Für heute um '+clock.format(new Date(r.due))+' Uhr vorgemerkt.':
    ['uploading','session_ready','processing'].includes(r.state)?states[r.state]:'Versand angefordert. Die Bestätigung des Portals steht aus.';
   onProgress(text);
   await continueApproved(r);if(!active())return null;
   if(attempted.get(r.order)?.failed)text='Der Versanddienst hat den Start noch nicht bestätigt. Der Auftragsstand wird erneut geprüft.';
   if(!r.background)text+=' Lass diese Seite bis zur Rückmeldung geöffnet.';

  }else if(expectedOrder&&!terminal&&!r.can_send){
   text='Für den Versandauftrag liegt noch keine Abschlussmeldung vor. Der Status wird erneut geprüft.';
  }

  const progress=pending||Boolean(expectedOrder&&!terminal&&!r.can_send);
  return {text,progress,locked:progress||['complete','uncertain','needs_review'].includes(r.state)};
 }
 return {describe};
}
