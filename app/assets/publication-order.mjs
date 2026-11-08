const endpoint = 'https://johnmusic.app.n8n.cloud/webhook/sma-publication-order-v1';
const errors = {
  AUTH_REQUIRED:'Bitte melde dich erneut an.', TARGET_ACCOUNT_REQUIRED:'Für dieses Portal ist noch kein eindeutiges Zielkonto verbunden.',
  TARGET_ACCOUNT_CHANGED:'Das Zielkonto wurde geändert. Bitte bereite einen neuen Auftrag vor.',
  TARGET_CONFIGURATION_REQUIRED:'Die Portalprüfung wird gerade eingerichtet. Bitte versuche es später erneut.',
  TARGET_PERMISSIONS_REQUIRED:'Die erforderliche Portalberechtigung fehlt. Bitte verbinde das Konto erneut.',
  TARGET_RECONNECT_REQUIRED:'Die Portalverbindung ist abgelaufen oder wurde widerrufen. Bitte verbinde das Konto erneut.',
  TARGET_CHECK_RUNNING:'Das Konto wird gerade geprüft. Bitte versuche es gleich noch einmal.',
  TARGET_CHECK_UNAVAILABLE:'Das Portal konnte die Kontoprüfung nicht bestätigen. Bitte versuche es später erneut.',
  TARGET_REFRESH_UNCERTAIN:'Die Erneuerung der Portalverbindung wurde nicht eindeutig bestätigt. Bitte verbinde das Konto erneut.',
  TARGET_TOKEN_SAVE_FAILED:'Die erneuerte Portalverbindung konnte nicht bestätigt werden. Bitte versuche es später erneut.',
  TARGET_OPTIONS_CHANGED:'Die Portaloptionen haben sich geändert oder sind abgelaufen. Öffne die Freigabe erneut.',
  TARGET_RATE_LIMITED:'Das Portal wurde zu häufig abgefragt. Bitte warte einige Minuten.',
  ORDER_CHANGED:'Datei oder Text wurden geändert. Bitte lade den aktuellen Stand.',
  FILE_CHANGED:'Die Datei wurde geändert. Bitte aktualisiere die Dateiliste.',
  FILE_REFRESH_REQUIRED:'Bitte aktualisiere die Dateiliste und versuche es erneut.',
  FINAL_APPROVAL_REQUIRED:'Bitte bestätige den angezeigten Auftrag ausdrücklich.',
  MEDIA_CONFIRMATION_REQUIRED:'Bitte bestätige die Prüfung von Inhalt, Medienrechten und Musik für diesen Auftrag erneut.',
  HUMAN_REVIEW_UNAVAILABLE:'Die persönliche Prüfung passt nicht mehr zum aktuellen Stand oder eine andere Prüfung ist offen. Lade den Auftrag erneut.',
  ORDER_RUNNING:'Dieser Auftrag wird bereits geprüft. Lade den Status erneut.',
  ORDER_NOT_PREPARED:'Die Vorbereitung ist abgelaufen. Öffne die Freigabe erneut.',
  DUPLICATE_PUBLICATION:'Für diese Datei und dieses Zielkonto existiert bereits ein freigegebener Auftrag.',
  REQUEST_CONFLICT:'Der Auftrag passt nicht mehr zur Auswahl. Öffne die Freigabe erneut.',
  ACCESS_INACTIVE:'Dein SMA-Zugang ist derzeit nicht aktiv.', ORDER_RATE_LIMITED:'Bitte warte kurz, bevor du einen weiteren Auftrag vorbereitest.',
};
export function orderError(code) { return errors[code] || 'Die Auftragsprüfung konnte nicht abgeschlossen werden. Du kannst denselben Auftrag erneut prüfen.'; }
export const approvalPolicy='media-consent-2026-11-03.1';
export const humanReviewPolicy='human-video-2026-11-06.1';
function preparationWindow(order){
  if(order?.state==='preparing')return order.preparation_window;
  if(order?.state==='prepared')return order.approval_window;
}
function preparationEnded(order) {
  const window=preparationWindow(order);
  return window!=null&&(window.status!=='active'||!(Date.parse(window.expires_at)>Date.now()));
}
function pendingTarget(order){
  return order?.state==='preparing'&&order.approved_at===null&&order.target===null&&order.account_check==null&&
    typeof order.choices?.visibility==='string'&&
    order.approval_token===null&&order.approval_window==null&&
    ['active','expired'].includes(order.preparation_window?.status)&&Number.isFinite(Date.parse(order.preparation_window.expires_at));
}
export function humanReviewAvailable(order) {
  return order?.state==='prepared'&&!preparationEnded(order)&&!order.check_error&&['youtube','tiktok'].includes(order.binding?.platform)&&
    order.human_review_option?.policy_version===humanReviewPolicy&&/^[a-f0-9]{64}$/.test(order.human_review_option?.source_fingerprint||'');
}
export function reviewConfirmation(order,values) {
  const tiktok=order?.binding?.platform==='tiktok',branded=tiktok&&order?.choices?.brand_content_toggle===true;
  if(order?.approval_policy!==approvalPolicy||!['youtube','tiktok','instagram','facebook'].includes(order?.binding?.platform)||
    !['content_checked','media_rights','music_rights'].every(k=>values?.[k]===true)||
    (tiktok&&values?.tiktok_music_terms!==true)||(branded&&values?.tiktok_branded_terms!==true))throw Error(orderError('MEDIA_CONFIRMATION_REQUIRED'));
  const result={policy_version:approvalPolicy,content_checked:true,media_rights:true,music_rights:true,tiktok_music_terms:tiktok,tiktok_branded_terms:branded};
  if(values.human_review_enabled===true){
    if(!humanReviewAvailable(order)||!['full_playback','visual_clear','speech_text_checked','claims_match'].every(k=>values[k]===true))throw Error(orderError('HUMAN_REVIEW_UNAVAILABLE'));
    result.human_review={policy_version:humanReviewPolicy,source_fingerprint:order.human_review_option.source_fingerprint,full_playback:true,visual_clear:true,speech_text_checked:true,claims_match:true};
  }
  return result;
}

function sameStringList(a,b){
  return Array.isArray(a)&&Array.isArray(b)&&a.every(v=>typeof v==='string')&&b.every(v=>typeof v==='string')&&
    JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
}
function sameOptions(a,b){
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)||Array.isArray(b))return false;
  return Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([key,value])=>
    Object.hasOwn(b,key)&&value===b[key]);
}
function sameAccountTerms(saved,current){
  if(saved?.version!==1||current?.version!==1||saved.platform!==current.platform||
     saved.target_id!==current.target_id||saved.display_name!==current.display_name||
     !(Date.parse(current.expires_at)>Date.now())||!(Date.parse(saved.expires_at)>Date.now())||
     !sameStringList(saved.permissions,current.permissions))return false;
  if(saved.platform==='youtube')return sameOptions(saved.policy,current.policy);
  if(saved.platform!=='tiktok'||!saved.policy||!current.policy)return false;
  const {privacy_levels:oldLevels,...oldRules}=saved.policy;
  const {privacy_levels:newLevels,...newRules}=current.policy;
  return sameStringList(oldLevels,newLevels)&&sameOptions(oldRules,newRules);
}

const orderIdPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function recordedApproval(row){
  return typeof row.id==='string'&&orderIdPattern.test(row.id)&&['approved','checking','checked','blocked'].includes(row.state)&&
    typeof row.approved_at==='string'&&/^20\d{2}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(row.approved_at)&&
    Number.isFinite(Date.parse(row.approved_at));
}

function validatedOrder(result,id){
  if(result?.ok!==true||result.id!==id||result.can_upload!==false||result.can_publish!==false||
     !['preparing','prepared','approved','checking','blocked','checked','cancelled'].includes(result.state))throw Error(orderError());
  return result;
}

// Reuse the exact request ID after a lost response. A different selection gets
// a new ID; the database additionally prevents duplicates across tabs/reloads.
export function createOrderClient({session,fetcher=fetch,uuid=()=>crypto.randomUUID()}) {
  let attempt=null;
  async function call(action,input) {
    const auth=await session();
    const response=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.access_token},
      body:JSON.stringify({action,input}),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(145000)});
    const r=await response.json();
    if(!response.ok||r?.ok!==true){
      const rejected=response.ok&&r?.ok===false&&Object.hasOwn(errors,r.code);
      throw Object.assign(Error(orderError(r?.code)),{code:r?.code,existingId:r?.existing_order_id,rejected});
    }
    if(action==='account'){
      const targetId=r.target?.id;
      if(r.id!==input.id||r.stage!=='account'||r.target?.platform!==input.platform||
         typeof targetId!=='string'||!targetId.trim()||r.account_check?.target_id!==targetId||
         r.can_publish!==false||r.can_upload!==false)throw Error(orderError());
      return r;
    }
    return validatedOrder(r,input.id);
  }
  return {
    account:platform=>call('account',{id:uuid(),platform}),
    prepare(binding,choices,savedId,expectedTargetId) {
      const input={...binding,choices};
      if(expectedTargetId)input.expected_target_id=expectedTargetId;
      const signature=JSON.stringify(input);
      if(savedId)attempt={signature,id:savedId};
      else if(!attempt||attempt.signature!==signature)attempt={signature,id:uuid()};
      const id=attempt.id;
      return call('prepare',{id,...input}).catch(error=>{
        if(error?.rejected){
          if(error.code==='DUPLICATE_PUBLICATION'&&expectedTargetId)error.duplicateRequestId=id;
          throw error;
        }
        throw Object.assign(Error(orderError(),{cause:error}),{preparationId:id});
      });
    },
    approve(order,confirmed,review) {
      if(preparationEnded(order))throw Error(orderError('ORDER_NOT_PREPARED'));
      if(confirmed!==true||order.state!=='prepared'||!order.approval_token||!order.target?.id)throw Error(orderError('FINAL_APPROVAL_REQUIRED'));
      return call('approve',{id:order.id,approval_token:order.approval_token,confirm:true,review:reviewConfirmation(order,review)});
    },
    get:id=>call('get',{id}), reset(){attempt=null;},
  };
}

export function accountChoiceOptions(platform,account) {
  if(platform!=='tiktok')return null;
  const policy=account?.account_check?.policy;
  const labels={SELF_ONLY:'Nur ich',PUBLIC_TO_EVERYONE:'Öffentlich',MUTUAL_FOLLOW_FRIENDS:'Freunde',FOLLOWER_OF_CREATOR:'Follower'};
  if(!policy||!Array.isArray(policy.privacy_levels)||!policy.privacy_levels.length||policy.privacy_levels.some(x=>!labels[x])||!['comment_disabled','duet_disabled','stitch_disabled'].every(k=>typeof policy[k]==='boolean'))throw Error(orderError('TARGET_CHECK_UNAVAILABLE'));
  return {visibility:policy.privacy_levels.map(x=>[x,labels[x]]),forced:{disable_comment:policy.comment_disabled,disable_duet:policy.duet_disabled,disable_stitch:policy.stitch_disabled}};
}

export function installOrderReview(doc,{session,getContext,refresh,readStoredOrder,cancelStoredOrder,host,portalName,verifySavedDraft,onUnavailableLink,onOutdatedDraft,onOpen=()=>{}}) {
  const make=(tag,text)=>{const e=doc.createElement(tag);if(text)e.textContent=text;return e;};
  const button=make('button','Freigabe vorbereiten');button.type='button';button.className='secondary';button.id='preparePublicationOrder';
  button.setAttribute('aria-haspopup','dialog');host.append(button);
  const dialog=make('dialog');dialog.id='publicationOrderDialog';dialog.setAttribute('aria-labelledby','publicationOrderHeading');
  const title=make('h2','Veröffentlichungsauftrag · '+portalName);title.id='publicationOrderHeading';
  const intro=make('p','Deine Freigabe gilt für die angezeigte Datei, den Beitrag und das gewählte Konto.');
  const controls=make('form'),options=make('div'),prepare=make('button','Auftrag prüfen');
  const reuse=make('button','Videoangaben übernehmen'),prepareActions=make('div');
  reuse.id='order-reuse-video';reuse.type='button';reuse.className='secondary';reuse.hidden=true;
  prepare.type='submit';options.className='order-options';prepareActions.className='actions';
  prepareActions.append(reuse,prepare);controls.append(options,prepareActions);
  const details=make('div'),notice=make('p');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
  const reviewControls=make('div'),reviewFields=new Map();
  for(const [key,text] of [['content_checked','Ich habe die vollständige Datei, Ton, Einblendungen und den gespeicherten Beitrag geprüft.'],['media_rights','Ich darf die verwendeten Bilder, Videos und dargestellten Personen für diesen Beitrag verwenden.'],['music_rights','Für enthaltene Musik und sonstige Tonaufnahmen habe ich die nötigen Nutzungsrechte; andernfalls enthält der Beitrag keine solchen Inhalte.'],['tiktok_music_terms','Mit der Veröffentlichung stimme ich der '],['tiktok_branded_terms','Für Werbung für Dritte stimme ich der ']]){
    const label=make('label'),input=make('input');input.type='checkbox';input.id='order-review-'+key;label.append(input,doc.createTextNode(' '+text));
    if(key.startsWith('tiktok_')){const link=make('a',key==='tiktok_music_terms'?'TikTok Music Usage Confirmation':'TikTok Branded Content Policy');link.href=key==='tiktok_music_terms'?'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en':'https://www.tiktok.com/legal/page/global/bc-policy/en';link.target='_blank';link.rel='noopener noreferrer';label.append(link,doc.createTextNode(' zu.'));}
    reviewFields.set(key,input);reviewControls.append(label);
  }
  reviewControls.append(make('p','Rechtebestätigungen sind keine automatische Medienprüfung. Eine persönliche Inhaltsprüfung wird, falls verfügbar und ausdrücklich gewählt, gesondert dokumentiert.'));
  const humanControls=make('fieldset'),humanFields=new Map(),humanEnabled=make('input'),humanLabel=make('label'),humanChecklist=make('div');
  humanControls.id='order-human-review';humanControls.hidden=true;humanControls.append(make('legend','Persönliche Inhaltsprüfung'));
  humanControls.append(make('p','Du kannst die fehlende vollständige Inhaltsprüfung selbst durchführen. Prüfe die angezeigte Datei vollständig und gleiche sie mit dem gespeicherten Beitrag ab. Deine Bestätigung gilt nur für diesen Auftrag. Gemeldete Auffälligkeiten und technische Fehler lassen sich hiermit nicht übergehen.'));
  humanEnabled.type='checkbox';humanEnabled.id='order-human-enabled';humanLabel.append(humanEnabled,doc.createTextNode(' Ich wähle die dokumentierte persönliche Prüfung.'));humanControls.append(humanLabel);
  for(const [key,text] of [['full_playback','Ich habe das gesamte Video einschließlich Ton bis zum Ende angesehen.'],['visual_clear','Ich habe alle Szenen geprüft: keine Nacktheit oder sexualisierten Inhalte, Gewalt, Waffen, drastischen Verletzungen, Hasssymbole, Drogen oder Selbstverletzung. Bei Unsicherheit bestätige ich nicht.'],['speech_text_checked','Ich habe Sprache, Musiktext und Einblendungen geprüft; sie enthalten keine der genannten problematischen Inhalte.'],['claims_match','Titel und Beitragstext passen zum Video. Enthaltene Aussagen und Versprechen habe ich auf Richtigkeit geprüft.']]){
    const label=make('label'),input=make('input');input.type='checkbox';input.id='order-human-'+key;label.append(input,doc.createTextNode(' '+text));humanFields.set(key,input);humanChecklist.append(label);
  }
  humanControls.append(humanChecklist,make('p','Dies ist deine eigene Prüfung, kein automatisches Prüfergebnis und keine Garantie für die Annahme durch das Portal. Gespeichert wird sie erst zusammen mit deiner gesonderten Veröffentlichungsfreigabe.'));
  const consentLabel=make('label'),consent=make('input');consent.type='checkbox';
  consent.id='order-final-consent';
  consentLabel.append(consent,doc.createTextNode(' Ich habe Zielkonto, Beitrag, Rechte und Kennzeichnungen geprüft und gebe diesen Auftrag zur Veröffentlichung frei.'));
  const approve=make('button','Veröffentlichung freigeben');approve.type='button';approve.disabled=true;
  const checkTarget=make('button','Zielkonto prüfen');checkTarget.type='button';checkTarget.hidden=true;
  const statusButton=make('button','Status erneut laden');statusButton.type='button';statusButton.className='secondary';statusButton.hidden=true;
  const restart=make('button','Vorbereitung neu starten');restart.type='button';restart.className='secondary';restart.hidden=true;
  const cancel=make('button','Vorbereitung abbrechen');cancel.type='button';cancel.className='secondary';cancel.hidden=true;
  const close=make('button','Schließen');close.type='button';close.className='secondary';
  const actions=make('div');actions.className='actions';actions.append(approve,checkTarget,restart,statusButton,cancel,close);
  dialog.append(title,intro,details,controls,humanControls,reviewControls,consentLabel,notice,actions);doc.body.append(dialog);
  const client=createOrderClient({session});let order=null,context=null,working=false,epoch=0,account=null;
  let recovery=null,preparationToResume=null;
  const unresolvedMessage='Der gespeicherte Freigabestand ist noch unklar. Lade den Status erneut oder öffne unter History den Auftrag.';
  let expiryTimer=null;
  function clearExpiryTimer(){if(expiryTimer!==null)clearTimeout(expiryTimer);expiryTimer=null;}
  const fields=new Map();let commercial=null,commercialNotice=null;
  const videoFields=['made_for_kids','contains_synthetic_media'];
  const bindingFields=['platform','asset_id','asset_revision','assignment_revision','preview_id','preview_revision'];
  let savedVideo=null;
  function rememberVideoChoices(previous){
    savedVideo=null;
    if(previous.state!=='prepared'||previous.approved_at!=null||previous.check_error||
       previous.binding?.platform!=='youtube'||!previous.target?.id||
       !bindingFields.every(key=>previous.binding[key]!=null)||
       !videoFields.every(key=>typeof previous.choices?.[key]==='boolean'))return;
    savedVideo={binding:previous.binding,targetId:previous.target.id,
      made_for_kids:previous.choices.made_for_kids,contains_synthetic_media:previous.choices.contains_synthetic_media};
  }
  function sameVideo(){
    return savedVideo&&account?.target.id===savedVideo.targetId&&
      bindingFields.every(key=>context.binding[key]===savedVideo.binding[key]);
  }
  function updateReuse(){
    reuse.hidden=!sameVideo()||videoFields.some(key=>fields.get(key)?.value!=='');
  }
  reuse.addEventListener('click',()=>{
    if(!dialog.open||working||order||reuse.hidden||!sameVideo())return;
    try{unchanged();}catch(e){reuse.hidden=true;notice.textContent=e.message;return;}
    for(const key of videoFields)fields.get(key).value=String(savedVideo[key]);
    updateReuse();
    notice.textContent=fields.get('visibility').value?'Videoangaben übernommen.':'Videoangaben übernommen. Bitte wähle die Sichtbarkeit.';
    if(!fields.get('visibility').value)fields.get('visibility').focus();
    else prepare.focus();
  });
  function select(key,label,values) {
    const l=make('label',label),s=make('select');s.id='order-'+key;l.htmlFor=s.id;s.required=true;
    const prior=videoFields.includes(key)&&sameVideo();
    const prompt=prior?'Bisher '+(savedVideo[key]?'Ja':'Nein')+' · bitte wählen':'Bitte auswählen';
    const empty=make('option',prompt);empty.value='';s.append(empty);
    if(prior)s.addEventListener('change',updateReuse);
    for(const [value,text] of values){const o=make('option',text);o.value=value;s.append(o);}fields.set(key,s);
    const field=make('div');field.className='order-option';field.append(l,s);options.append(field);
  }
  function checkbox(key,label,{forced=false,invert=false}={}) {
    const l=make('label'),input=make('input');input.type='checkbox';input.id='order-'+key;
    if(forced)input.dataset.forced='true';if(invert)input.dataset.invert='true';
    l.append(input,doc.createTextNode(' '+label));fields.set(key,input);options.append(l);return input;
  }
  function syncCommercial() {
    if(!commercial)return;
    const third=fields.get('brand_content_toggle'),own=fields.get('brand_organic_toggle'),visibility=fields.get('visibility');
    for(const input of [third,own]){input.parentElement.hidden=!commercial.checked;input.disabled=working||!!order||!commercial.checked;}
    if(visibility.value==='SELF_ONLY')third.disabled=true;
    for(const option of visibility.children)if(option.value==='SELF_ONLY')option.disabled=third.checked;
    commercialNotice.textContent=!commercial.checked?'':third.checked?'Dein Video wird als „Bezahlte Partnerschaft“ gekennzeichnet.':own.checked?'Dein Video wird als „Werbeinhalt“ gekennzeichnet.':'Wähle eigene Marke, Werbung für Dritte oder beides.';
    if(commercial.checked&&visibility.value==='SELF_ONLY')commercialNotice.textContent+=' Werbung für Dritte ist mit „Nur ich“ nicht möglich.';
  }
  function renderChoices(platform,verified) {
    options.replaceChildren();fields.clear();commercial=null;commercialNotice=null;reuse.hidden=true;
    if(platform==='youtube') {
      select('visibility','Sichtbarkeit',[['private','Privat'],['unlisted','Nicht gelistet'],['public','Öffentlich']]);
      select('made_for_kids','Speziell für Kinder erstellt?',[['true','Ja'],['false','Nein']]);
      select('contains_synthetic_media','Realistisch veränderte oder synthetische Inhalte?',[['true','Ja'],['false','Nein']]);
      updateReuse();
    } else if(platform==='tiktok') {
      const allowed=accountChoiceOptions(platform,verified);
      select('visibility','Gewünschte Sichtbarkeit',allowed.visibility);
      for(const [key,label] of [['disable_comment','Kommentare erlauben'],['disable_duet','Duette erlauben'],['disable_stitch','Stitch erlauben']]){const input=checkbox(key,label,{forced:allowed.forced[key],invert:true});if(allowed.forced[key])input.setAttribute('aria-description','Vom TikTok-Konto deaktiviert.');}
      const label=make('label');commercial=make('input');commercial.type='checkbox';commercial.id='order-commercial';label.append(commercial,doc.createTextNode(' Dieser Beitrag bewirbt eine Marke, ein Produkt oder eine Dienstleistung.'));options.append(label);
      checkbox('brand_organic_toggle','Eigene Marke');checkbox('brand_content_toggle','Werbung für Dritte');commercialNotice=make('p');commercialNotice.setAttribute('role','status');options.append(commercialNotice);
      commercial.addEventListener('change',()=>{if(!commercial.checked)for(const key of ['brand_organic_toggle','brand_content_toggle'])fields.get(key).checked=false;syncCommercial();});
      for(const key of ['visibility','brand_organic_toggle','brand_content_toggle'])fields.get(key).addEventListener('change',syncCommercial);
      syncCommercial();
    } else select('visibility','Sichtbarkeit',[['public','Öffentlich']]);
  }
  function reviewValues(){return {...Object.fromEntries([...reviewFields,...humanFields].map(([k,e])=>[k,e.checked])),human_review_enabled:humanEnabled.checked};}
  function reviewReady(){try{reviewConfirmation(order,reviewValues());return !order.check_error;}catch{return false;}}
  function setWorking(value){
    working=value;
    const ended=preparationEnded(order),locked=ended||recovery!==null;
    controls.querySelectorAll('select,button,input').forEach(e=>e.disabled=value||!!order||e.dataset.forced==='true');
    syncCommercial();close.disabled=value;consent.disabled=value||locked;
    restart.hidden=recovery?!recovery.canRestart:order?.state!=='prepared'&&!pendingTarget(order);
    restart.disabled=value;
    cancel.hidden=!cancelStoredOrder||!!recovery||order?.approved_at!==null||!['preparing','prepared'].includes(order.state);
    cancel.disabled=value||cancel.hidden;
    for(const input of reviewFields.values())input.disabled=value||order?.state!=='prepared'||locked;
    humanEnabled.disabled=value||!humanReviewAvailable(order);humanChecklist.hidden=!humanEnabled.checked;
    for(const input of humanFields.values())input.disabled=value||!humanEnabled.checked||!humanReviewAvailable(order);
    checkTarget.hidden=!pendingTarget(order)||locked;
    checkTarget.disabled=value||checkTarget.hidden||!!order?.check_error;
    statusButton.disabled=value;approve.disabled=value||order?.state!=='prepared'||locked||!consent.checked||!reviewReady();
    if(locked){
      consent.checked=false;humanEnabled.checked=false;
      for(const input of [...reviewFields.values(),...humanFields.values()])input.checked=false;
      approve.hidden=consentLabel.hidden=reviewControls.hidden=humanControls.hidden=true;
      if(!value&&!recovery)notice.textContent=preparationWindow(order)?.status==='recheck'
        ? 'Das Zielkonto muss erneut geprüft werden. Starte die Vorbereitung neu.'
        : 'Die Vorbereitung ist abgelaufen. Starte sie neu, um das Zielkonto und die Einstellungen erneut zu prüfen.';
    }
  }
  function checkBinding(r){
    if(!r.binding||Object.entries(context.binding).some(([k,v])=>r.binding[k]!==v))throw Error(orderError('ORDER_CHANGED'));
    if(['preparing','prepared'].includes(r.state)&&!matchesPost(r.draft)){
      throw Object.assign(Error('Der gespeicherte Auftrag enthält einen anderen Beitragstext oder Titel.'),{selectionConflict:true});
    }
  }
  function historyLink(id,label){
    const link=make('a',label);link.href='dashboard.html#auftrag/'+id;link.target='_top';return link;
  }
  function appendApprovalReceipt(row){
    const when=new Intl.DateTimeFormat('de-AT',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Vienna'}).format(new Date(row.approved_at));
    details.append(make('p','Freigegeben am '+when+' Uhr (Wien).'),historyLink(row.id,'Freigegebenen Auftrag in der History öffnen'));
  }
  function showDuplicate(row,targetId){
    // The journal identifies duplicate approvals by file version, platform and target.
    // Caption revisions and visibility belong to the independently approved order.
    if(!recordedApproval(row)||!targetId||row.target?.id!==targetId||
       row.target.platform!==context.binding.platform||
       !['asset_id','asset_revision','platform'].every(k=>context.binding[k]&&row.binding?.[k]===context.binding[k]))throw Error(orderError('REQUEST_CONFLICT'));
    if(typeof row.draft?.title==='string'&&row.draft.title)details.append(make('h3',row.draft.title));
    appendApprovalReceipt(row);
    notice.textContent=errors.DUPLICATE_PUBLICATION;
  }
  function appendPost(post){
    const caption=make('details');caption.className='order-caption';
    caption.append(make('summary','Beitragstext ansehen'),make('pre',post?.caption||post?.body||''));
    details.append(make('h3',post?.title||'Gespeicherter Beitrag'),caption);
  }
  function matchesPost(post){
    return typeof post?.title==='string'&&typeof post.caption==='string'&&
      post.title===context.post.title&&post.caption===context.post.caption;
  }
  function showOrder(r) {
    checkBinding(r);
    clearExpiryTimer();order=r;rememberVideoChoices(r);details.replaceChildren();
    const window=preparationWindow(r);
    if(window?.status==='active'&&!preparationEnded(r)){
      const until=Date.parse(window.expires_at);
      details.append(make('p','Vorbereitung gültig bis '+new Intl.DateTimeFormat('de-AT',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Europe/Vienna'}).format(until)+' Uhr (Wien).'));
      expiryTimer=setTimeout(()=>{if(order===r)setWorking(working);},Math.max(0,until-Date.now()+1));
    }
    consent.checked=false;consentLabel.hidden=r.state!=='prepared';controls.hidden=true;
    humanControls.hidden=!humanReviewAvailable(r);humanEnabled.checked=false;for(const input of humanFields.values())input.checked=false;
    reviewControls.hidden=r.state!=='prepared';for(const [key,input] of reviewFields){input.checked=false;input.parentElement.hidden=key==='tiktok_music_terms'?context.binding.platform!=='tiktok':key==='tiktok_branded_terms'?context.binding.platform!=='tiktok'||r.choices?.brand_content_toggle!==true:false;}
    details.append(make('p','Datei: '+context.name),make('p','Zielkonto: '+(r.account_check?.display_name||r.target?.name||'Noch nicht zugeordnet')+(r.target?.id?' · '+r.target.id:'')));
    const decisionLabels={visibility:'Sichtbarkeit',made_for_kids:'Speziell für Kinder',contains_synthetic_media:'Synthetische Inhalte',disable_comment:'Kommentare deaktiviert',disable_duet:'Duette deaktiviert',disable_stitch:'Stitch deaktiviert',brand_content_toggle:'Werbung für Dritte',brand_organic_toggle:'Eigene Marke'};
    const visibilityLabels={private:'Privat',public:'Öffentlich',unlisted:'Nicht gelistet',SELF_ONLY:'Nur ich',PUBLIC_TO_EVERYONE:'Öffentlich',MUTUAL_FOLLOW_FRIENDS:'Freunde',FOLLOWER_OF_CREATOR:'Follower'};
    const decisions=make('ul');for(const [key,value] of Object.entries(r.choices||{}))if(decisionLabels[key])decisions.append(make('li',decisionLabels[key]+': '+(key==='visibility'?visibilityLabels[value]||value:value?'Ja':'Nein')));details.append(decisions);
    appendPost(r.draft);
    const media=r.media_check;
    if(media?.human_review?.method==='customer_attestation')details.append(make('p','Persönliche Inhaltsprüfung für diesen Stand dokumentiert. Die automatische Video-Sicherheitsprüfung wurde dadurch nicht durchgeführt.'));
    if(media?.asset_id===context.binding.asset_id&&media?.asset_revision===context.binding.asset_revision&&Array.isArray(media.checks)){
      const open=media.checks.filter(x=>x.status!=='pass'&&x.code!=='PUBLICATION_APPROVAL_PENDING');
      if(open.length){details.append(make('h3','Offene Medienprüfungen'));const list=make('ul');for(const check of open)list.append(make('li',check.message));details.append(list);}
    }
    if(r.check_error)details.append(make('p',orderError(r.check_error)));
    if(context.binding.platform==='tiktok')details.append(make('p','Nach einer späteren Veröffentlichung kann TikTok einige Minuten benötigen, bis der Beitrag im Profil sichtbar ist.'));
    statusButton.hidden=r.state==='cancelled';
    if(r.state==='cancelled')notice.textContent='Dieser Auftrag wurde storniert und kann nicht mehr freigegeben werden. Schließe dieses Fenster und bereite bei Bedarf einen neuen Auftrag vor.';
    else if(r.state==='prepared')notice.textContent='Zielkonto und gespeicherter Text sind zugeordnet. Erst deine ausdrückliche Bestätigung speichert die Freigabe.';
    else if(r.state==='checked')notice.textContent=(r.approved_at?'Deine Freigabe ist gespeichert. ':'')+'Die Auftragsprüfung ist abgeschlossen.';
    else if(r.approved_at)notice.textContent=r.state==='blocked'?'Deine Freigabe ist gespeichert. Eine offene Prüfung blockiert den Auftrag.':'Deine Freigabe ist gespeichert.';
    else if(pendingTarget(r))notice.textContent='Die Einstellungen sind gespeichert. Prüfe das Zielkonto, um diesen Auftrag weiter vorzubereiten.';
    else notice.textContent='Die Zielkontoprüfung ist noch nicht abgeschlossen.';
    if(r.blockers?.length){const list=make('ul');for(const code of r.blockers)list.append(make('li',blockerText(code)));details.append(list);}
    if(recordedApproval(r))appendApprovalReceipt(r);
    if(r.state==='cancelled'&&r.approved_at===null&&orderIdPattern.test(r.id)){
      details.append(historyLink(r.id,'Abgebrochenen Auftrag in der History öffnen'));
    }
    approve.hidden=r.state!=='prepared';
  }
  function resumePrepared(previous){
    if(previous.approved_at!==null||previous.check_error||preparationEnded(previous)||
       previous.can_upload!==false||previous.can_publish!==false)return false;
    if(!pendingTarget(previous)&&(previous.state!=='prepared'||previous.approval_window?.status!=='active'||
       !previous.approval_token||!previous.target?.id||previous.target.platform!==previous.binding?.platform))return false;
    context=getContext();
    if(!matchesPost(previous.draft))return false;
    showOrder(previous);
    if(pendingTarget(previous))preparationToResume={id:previous.id,choices:previous.choices,persisted:true};
    setWorking(false);
    dialog.showModal();
    onOpen();
    return true;
  }
  function unchanged(){const next=getContext();if(JSON.stringify(next.binding)!==JSON.stringify(context.binding)||!matchesPost(next.post))throw Error(orderError('ORDER_CHANGED'));}
  function offerPreparationRetry(message){
    // Keep the form and the client's original request ID for an explicit retry.
    recovery=null;order=null;controls.hidden=false;statusButton.hidden=true;
    notice.textContent=message+' Klicke auf „Auftrag prüfen“, um es mit denselben Einstellungen erneut zu versuchen.';
  }
  function checkPreparation(stored,pending){
    checkBinding(stored);
    if(!sameOptions(stored.choices,pending.choices)){
      throw Object.assign(Error('Die gespeicherten Portaleinstellungen weichen von deiner Auswahl ab.'),{selectionConflict:true});
    }
    const needsTarget=stored.target!=null||!['preparing','cancelled'].includes(stored.state);
    const verifiedPortal=['youtube','tiktok'].includes(context.binding.platform);
    const checkAccount=verifiedPortal&&(stored.account_check!=null||(stored.state==='prepared'&&stored.approval_window?.status==='active'));
    if(pending.targetId&&needsTarget&&
       (stored.target?.id!==pending.targetId||stored.target?.platform!==context.binding.platform||
        (checkAccount&&stored.account_check?.target_id!==pending.targetId))){
      throw Object.assign(Error('Das gespeicherte Zielkonto passt nicht zum angezeigten Konto.'),{selectionConflict:true});
    }
  }
  function checkStoredState(stored){
    if(stored.state==='preparing'||(['approved','checking','checked','blocked'].includes(stored.state)&&!recordedApproval(stored)))throw Error(orderError('REQUEST_CONFLICT'));
    if(stored.state==='prepared'&&(stored.approved_at!==null||
        !['active','expired','recheck'].includes(stored.approval_window?.status)||
        !Number.isFinite(Date.parse(stored.approval_window.expires_at))||
        (stored.approval_window.status==='active'&&(!stored.approval_token||!stored.target?.id||
         stored.target?.platform!==stored.binding?.platform))))throw Error(orderError('REQUEST_CONFLICT'));
  }
  async function checkSavedDraft(generation,refreshFile=false){
    try{
      if(refreshFile){
        await refresh();
        if(generation!==epoch)throw Error(orderError('ORDER_CHANGED'));
        unchanged();
      }
      await verifySavedDraft(context);
    }
    catch(error){
      if(['ASSIGNMENT_CHANGED','ASSIGNMENT_CONFLICT'].includes(error.code))error.outdatedDraft=true;
      throw error;
    }
    if(generation!==epoch)throw Error(orderError('ORDER_CHANGED'));
    unchanged();
  }
  function offerDraftRepair(error){
    if(error.outdatedDraft&&onOutdatedDraft){dialog.close();onOutdatedDraft();return true;}
    if(error?.code!=='PRODUCT_LINK_UNAVAILABLE'||!onUnavailableLink)return false;
    dialog.close();onUnavailableLink();return true;
  }
  function continuePending(checkAccount){
    const previous=order,generation=epoch;
    if(!pendingTarget(previous))return;
    return run(async()=>{
      // Reading through n8n could also continue a checked order. Read the stored row directly.
      const stored=validatedOrder(await readStoredOrder(previous.id),previous.id);
      if(generation!==epoch)throw Error(orderError('ORDER_CHANGED'));
      unchanged();checkPreparation(stored,previous);
      if(!pendingTarget(stored))checkStoredState(stored);
      if(!checkAccount||!pendingTarget(stored)||preparationEnded(stored)||stored.check_error)return stored;
      await checkSavedDraft(generation,true);
      return client.prepare(context.binding,stored.choices,stored.id);
    },{choices:checkAccount?previous.choices:null});
  }
  async function readRecovery(generation){
    const pending=recovery;
    let stored;
    clearExpiryTimer();controls.hidden=true;statusButton.hidden=false;setWorking(true);
    notice.textContent='Der gespeicherte Auftragsstand wird geladen …';
    if(pending.duplicate)details.replaceChildren();
    try{
      unchanged();
      if(pending.duplicate&&(typeof pending.id!=='string'||!orderIdPattern.test(pending.id)||pending.id===pending.requestId))throw Error(orderError('REQUEST_CONFLICT'));
      const result=await readStoredOrder(pending.id);
      if(generation!==epoch||pending!==recovery)return;
      unchanged();
      if(pending.choices&&!pending.persisted&&result?.ok===false&&result.code==='ORDER_UNAVAILABLE'){
        offerPreparationRetry('Unter dieser Anfrage ist noch kein Auftrag verfügbar.');
        return;
      }
      stored=validatedOrder(result,pending.id);
      if(pending.duplicate){
        showDuplicate(stored,pending.targetId);
        return; // Keep status refresh read-only for the other order.
      }
      if((order?.state==='prepared'||pending.state==='prepared')&&stored.state==='preparing')throw Error(orderError('REQUEST_CONFLICT'));
      if(pending.choices){
        checkPreparation(stored,pending);
        if(pendingTarget(stored)&&(pending.persisted||preparationEnded(stored))){
          showOrder(stored);recovery=null;
          if(pending.cancellation)notice.textContent='Die Vorbereitung ist noch offen. Du kannst den Abbruch erneut wählen.';
          return;
        }
        if(!pending.persisted&&stored.state==='preparing'&&stored.approved_at===null&&stored.approval_token===null&&stored.approval_window==null){
          offerPreparationRetry('Die Vorbereitung ist noch nicht abgeschlossen.');
          return;
        }
      }
      if(order?.target?.id&&stored.target?.id!==order.target.id)throw Error();
      checkStoredState(stored);
      if(pending.cancellation&&stored.state==='cancelled'&&(stored.approved_at!==null||stored.approval_token!=null))throw Error();
      if(stored.state==='prepared'&&['ORDER_NOT_PREPARED','TARGET_OPTIONS_CHANGED'].includes(pending.code)){
        const status=pending.code==='ORDER_NOT_PREPARED'?'expired':'recheck';
        showOrder({...stored,approval_window:{...stored.approval_window,status}});
      }else{
        showOrder(stored);
        if(stored.state==='prepared'&&pending.code)notice.textContent=orderError(pending.code);
      }
      if(pending.cancellation&&stored.state==='prepared')notice.textContent='Der Auftrag ist noch vorbereitet. Du kannst den Abbruch erneut wählen.';
      // A concurrent approval is a read-only receipt, including subsequent status refreshes.
      if(!pending.cancellation||!recordedApproval(stored))recovery=null;
    }catch(error){
      if(generation!==epoch||pending!==recovery)return;
      pending.canRestart=error.selectionConflict===true&&stored?.state==='prepared'&&stored.approved_at===null;
      if(pending.canRestart){
        pending.persisted=true;
        notice.textContent=error.message+' Starte die Vorbereitung neu, um Konto und Einstellungen erneut zu prüfen.';
      }else if(pending.choices)notice.textContent='Der Stand der Vorbereitung ist noch unklar. Lade den Status erneut oder öffne den Auftrag unter History.';
      else notice.textContent=pending.duplicate
        ? 'SMA hat eine doppelte Freigabe gemeldet. Der bestehende Auftrag konnte noch nicht zugeordnet werden. Lade den Status erneut oder öffne History → Aufträge.'
        : unresolvedMessage;
    }
  }
  async function run(action,{approval=false,choices=null}={}) {
    if(working)return;setWorking(true);notice.textContent='Auftrag wird geprüft …';const generation=epoch;
    let sentApproval=false,preparationId;
    try{
      unchanged();
      if(recovery){await readRecovery(generation);return;}
      const request=action();
      sentApproval=approval;
      const result=await request;
      if(generation!==epoch)return;
      if(choices){
        preparationId=result.id;
        const expected=preparationToResume?.id===result.id?preparationToResume:{choices,targetId:account?.target?.id};
        checkPreparation(result,expected);
        if(result.state==='preparing'){
          if(!pendingTarget(order)||!pendingTarget(result))throw Error();
        }else checkStoredState(result);
      }
      unchanged();
      if(sentApproval&&!recordedApproval(result))throw Error();
      showOrder(result);
      if(choices&&preparationToResume?.state==='prepared'&&preparationToResume.id===result.id&&
         result.state==='prepared'&&!result.check_error&&!preparationEnded(result)){
        notice.textContent='Deine Einstellungen stimmen mit dem vorbereiteten Auftrag überein. Die ursprüngliche Frist gilt weiter.';
      }
    }catch(e){
      if(generation!==epoch)return;
      if(!sentApproval&&offerDraftRepair(e))return;
      notice.textContent=e.message||orderError();
      const duplicate=e.rejected&&e.code==='DUPLICATE_PUBLICATION'&&(sentApproval||!!e.duplicateRequestId);
      preparationId=e.preparationId||preparationId;
      if(choices&&preparationId&&!e.rejected){
        if(preparationToResume?.id!==preparationId){
          preparationToResume={id:preparationId,choices,targetId:account?.target?.id,persisted:order?.state==='preparing'};
        }
        recovery=preparationToResume;
      }else if(sentApproval||duplicate){
        preparationToResume=null;
        recovery={id:duplicate?e.existingId:order.id,duplicate,code:e.rejected?e.code:null};
        if(duplicate){
          recovery.requestId=e.duplicateRequestId||order.id;
          recovery.targetId=sentApproval?order.target?.id:account?.target?.id;
        }
      }
      if(recovery){
        await readRecovery(generation);
      }else if(order?.state==='prepared'&&['ORDER_NOT_PREPARED','TARGET_OPTIONS_CHANGED'].includes(e.code)){
        clearExpiryTimer();
        order={...order,approval_window:{status:e.code==='ORDER_NOT_PREPARED'?'expired':'recheck'}};
      }
    }
    finally{if(generation===epoch)setWorking(false);}
  }
  function savedPreparation(){
    const status=order.approval_window?.status;
    return {id:order.id,state:order.state,binding:context.binding,choices:order.choices,targetId:order.target?.id,persisted:true,
      code:status==='recheck'?'TARGET_OPTIONS_CHANGED':status==='expired'?'ORDER_NOT_PREPARED':null};
  }
  async function openPreparation(){
    if(working)return;
    if(!recovery){
      if(order?.state==='prepared'||pendingTarget(order))recovery=savedPreparation();
      else if(!order)recovery=preparationToResume;
    }
    if(recovery){
      setWorking(false);
      let next;
      try{next=getContext();}catch(e){
        controls.hidden=true;details.replaceChildren();
        if(!dialog.open)dialog.showModal();
        notice.textContent=e.message;return;
      }
      if(JSON.stringify(recovery.binding||context.binding)===JSON.stringify(next.binding)){
        context=next;
        if(!dialog.open)dialog.showModal();
        onOpen();
        return run();
      }
      recovery=null;
    }
    return startPreparation();
  }
  async function startPreparation(savedBeforeRestart=null){
    preparationToResume=savedBeforeRestart;clearExpiryTimer();restart.hidden=true;
    const generation=++epoch;order=null;account=null;commercial=null;client.reset();controls.hidden=true;reviewControls.hidden=true;humanControls.hidden=true;humanEnabled.checked=false;for(const input of [...reviewFields.values(),...humanFields.values()])input.checked=false;details.replaceChildren();options.replaceChildren();consent.checked=false;consentLabel.hidden=true;approve.hidden=true;statusButton.hidden=true;notice.textContent='Gespeicherter Beitrag wird geprüft …';if(!dialog.open)dialog.showModal();onOpen();setWorking(true);
    try{
      context=getContext();const platform=context.binding.platform;
      if(savedBeforeRestart&&JSON.stringify(savedBeforeRestart.binding)!==JSON.stringify(context.binding))preparationToResume=null;
      await checkSavedDraft(generation);
      details.append(make('p','Datei: '+context.name));appendPost(context.post);
      notice.textContent='Zielkonto wird beim Portal geprüft …';
      let verified=null;
      if(['youtube','tiktok'].includes(platform)){
        // A failed check or a newly connected account must not reactivate the former target.
        try{verified=await client.account(platform);}
        finally{
          if(savedBeforeRestart?.targetId&&savedBeforeRestart.targetId!==verified?.target.id){
            savedBeforeRestart.code||='TARGET_OPTIONS_CHANGED';
          }
        }
      }
      if(generation!==epoch)return;account=verified;unchanged();renderChoices(platform,account);controls.hidden=false;
      if(account){
        const name=account.account_check.display_name||account.target.name;
        details.append(make('p','Verbundenes Zielkonto: '+(name?name+' · ':'')+account.target.id));
        if(platform==='tiktok')details.append(make('p','Dieses TikTok-Konto erlaubt Videos bis '+account.account_check.policy.max_duration_sec+' Sekunden.'));
      }
      notice.textContent='Wähle die Einstellungen für diesen Beitrag.';
    }catch(e){if(generation===epoch&&!offerDraftRepair(e))notice.textContent=e.message||orderError();}
    finally{if(generation===epoch)setWorking(false);}
  }
  button.addEventListener('click',openPreparation);
  restart.addEventListener('click',()=>{
    if(working||restart.hidden)return;
    const prior=recovery?{...recovery,state:'prepared',binding:context.binding}:savedPreparation();
    recovery=null;
    return startPreparation(prior);
  });
  async function prepareSelection(choices,generation){
    const prior=preparationToResume;
    if(prior?.state==='prepared'&&!prior.code&&!prior.canRestart&&account&&
       prior.targetId===account.target.id&&sameOptions(prior.choices,choices)){
      const stored=validatedOrder(await readStoredOrder(prior.id),prior.id);
      if(generation!==epoch)throw Error(orderError('ORDER_CHANGED'));
      unchanged();
      if(stored.state!=='prepared'||stored.check_error||
         (!preparationEnded(stored)&&sameAccountTerms(stored.account_check,account.account_check)))return stored;
      // Verify the old selection before writing a replacement for an expired or changed account check.
      try{checkPreparation(stored,prior);checkStoredState(stored);}
      catch(error){throw Object.assign(error,{preparationId:prior.id});}
    }
    // Once this write is sent, a lost response belongs to the new request.
    if(prior&&(prior.persisted||!sameOptions(choices,prior.choices)))preparationToResume=null;
    return client.prepare(context.binding,choices,undefined,account?.target.id);
  }
  controls.addEventListener('submit',event=>{event.preventDefault();if(working||order||recovery||!controls.reportValidity())return;
    if(commercial?.checked&&!fields.get('brand_content_toggle').checked&&!fields.get('brand_organic_toggle').checked){notice.textContent='Wähle eigene Marke, Werbung für Dritte oder beides.';return;}
    if(context.binding.platform==='tiktok'&&fields.get('brand_content_toggle').checked&&fields.get('visibility').value==='SELF_ONLY'){notice.textContent='Werbung für Dritte kann bei TikTok nicht mit „Nur ich“ veröffentlicht werden. Bitte wähle eine andere Sichtbarkeit.';return;}
    const choices=Object.fromEntries([...fields].map(([k,e])=>[k,k==='visibility'?e.value:e.type==='checkbox'?(e.dataset.invert==='true'?!e.checked:e.checked):e.value==='true']));
    const generation=epoch;
    return run(async()=>{
      await checkSavedDraft(generation,true);
      return prepareSelection(choices,generation);
    },{choices});
  });
  cancel.addEventListener('click',async()=>{
    if(working||cancel.hidden||!dialog.open)return;
    try{unchanged();}catch(error){notice.textContent=error.message;return;}
    const generation=epoch,pending={...savedPreparation(),cancellation:true};
    recovery=pending;preparationToResume=null;setWorking(true);
    notice.textContent='Die Vorbereitung wird abgebrochen …';
    try{
      const stored=validatedOrder(await cancelStoredOrder(pending.id),pending.id);
      if(generation!==epoch)return;
      unchanged();checkPreparation(stored,pending);
      if(stored.state!=='cancelled'||stored.approved_at!==null||stored.approval_token!=null)throw Error();
      showOrder(stored);recovery=null;
    }catch{
      if(generation===epoch)await readRecovery(generation);
    }finally{if(generation===epoch)setWorking(false);}
  });
  consent.addEventListener('change',()=>setWorking(working));
  for(const input of reviewFields.values())input.addEventListener('change',()=>setWorking(working));
  humanEnabled.addEventListener('change',()=>{for(const input of humanFields.values())input.checked=false;consent.checked=false;setWorking(working);});
  for(const input of humanFields.values())input.addEventListener('change',()=>setWorking(working));
  approve.addEventListener('click',()=>{if(!approve.disabled)return run(()=>client.approve(order,consent.checked,reviewValues()),{approval:true});});
  checkTarget.addEventListener('click',()=>{if(!checkTarget.disabled)return continuePending(true);});
  statusButton.addEventListener('click',()=>{
    if(working||statusButton.hidden)return;
    if(recovery)return run();
    if(pendingTarget(order))return continuePending(false);
    if(order.state==='prepared'){
      recovery=savedPreparation();
      return run();
    }
    return run(()=>client.get(order.id));
  });
  close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{if(!dialog.open)clearExpiryTimer();});dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();});
  return {rememberVideoChoices,resumePrepared,viewport:height=>{if(Number.isFinite(height)&&height>=240&&height<=1200)dialog.style.maxHeight=height+'px';},lock:value=>{button.disabled=value;},clear(){clearExpiryTimer();epoch++;working=false;recovery=null;preparationToResume=null;order=null;context=null;savedVideo=null;reuse.hidden=true;options.replaceChildren();fields.clear();controls.hidden=true;client.reset();dialog.close();details.replaceChildren();notice.textContent='';}};
}

function blockerText(code) {
  if(errors[code])return errors[code];
  if(code==='TARGET_DURATION_EXCEEDED')return 'Das Video überschreitet die für dieses TikTok-Konto erlaubte Dauer.';
  if(code==='TARGET_PERMISSIONS_REQUIRED')return 'Portalberechtigungen müssen noch geprüft werden.';
  if(code==='TEXT_REVIEW_REQUIRED')return 'Hinweise zum Beitragstext müssen noch geprüft werden.';
  if(code==='TARGET_ACCOUNT_CHANGED')return 'Das verbundene Zielkonto wurde geändert.';
  if(code==='FILE_CHANGED')return 'Der Dateistand stimmt nicht mehr überein.';
  if(code==='SAVED_TEXT_INVALID')return 'Der gespeicherte Beitrag stimmt nicht mehr überein.';
  return 'Eine erforderliche Medien- oder Kontoprüfung ist noch offen ('+code+').';
}
