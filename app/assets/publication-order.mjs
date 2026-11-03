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
  ORDER_RUNNING:'Dieser Auftrag wird bereits geprüft. Lade den Status erneut.',
  ORDER_NOT_PREPARED:'Die Vorbereitung ist abgelaufen. Öffne die Freigabe erneut.',
  DUPLICATE_PUBLICATION:'Für diese Datei und dieses Zielkonto existiert bereits ein freigegebener Auftrag.',
  REQUEST_CONFLICT:'Der Auftrag passt nicht mehr zur Auswahl. Öffne die Freigabe erneut.',
  ACCESS_INACTIVE:'Dein SMA-Zugang ist derzeit nicht aktiv.', ORDER_RATE_LIMITED:'Bitte warte kurz, bevor du einen weiteren Auftrag vorbereitest.',
};
export function orderError(code) { return errors[code] || 'Die Auftragsprüfung konnte nicht abgeschlossen werden. Du kannst denselben Auftrag erneut prüfen.'; }
export const approvalPolicy='media-consent-2026-11-03.1';
export function reviewConfirmation(order,values) {
  const tiktok=order?.binding?.platform==='tiktok',branded=tiktok&&order?.choices?.brand_content_toggle===true;
  if(order?.approval_policy!==approvalPolicy||!['youtube','tiktok','instagram','facebook'].includes(order?.binding?.platform)||
    !['content_checked','media_rights','music_rights'].every(k=>values?.[k]===true)||
    (tiktok&&values?.tiktok_music_terms!==true)||(branded&&values?.tiktok_branded_terms!==true))throw Error(orderError('MEDIA_CONFIRMATION_REQUIRED'));
  return {policy_version:approvalPolicy,content_checked:true,media_rights:true,music_rights:true,tiktok_music_terms:tiktok,tiktok_branded_terms:branded};
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
    if(!response.ok||r?.ok!==true)throw Object.assign(Error(orderError(r?.code)),{code:r?.code,existingId:r?.existing_order_id});
    if(action==='account'){if(r.id!==input.id||r.stage!=='account'||r.target?.platform!==input.platform||r.account_check?.target_id!==r.target?.id||r.can_publish!==false||r.can_upload!==false)throw Error(orderError());return r;}
    if(r.id!==input.id||r.can_publish!==false||r.can_upload!==false||!['preparing','prepared','approved','checking','blocked','checked','cancelled'].includes(r.state))throw Error(orderError());
    return r;
  }
  return {
    account:platform=>call('account',{id:uuid(),platform}),
    prepare(binding,choices) {
      const input={...binding,choices};const signature=JSON.stringify(input);
      if(!attempt||attempt.signature!==signature)attempt={signature,id:uuid()};
      return call('prepare',{id:attempt.id,...input});
    },
    approve(order,confirmed,review) {
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

export function installOrderReview(doc,{session,getContext,refresh,host,portalName,onOpen=()=>{}}) {
  const make=(tag,text)=>{const e=doc.createElement(tag);if(text)e.textContent=text;return e;};
  const button=make('button','Freigabe vorbereiten');button.type='button';button.className='secondary';button.id='preparePublicationOrder';
  button.setAttribute('aria-haspopup','dialog');host.append(button);
  const dialog=make('dialog');dialog.id='publicationOrderDialog';dialog.setAttribute('aria-labelledby','publicationOrderHeading');
  const title=make('h2','Veröffentlichungsauftrag · '+portalName);title.id='publicationOrderHeading';
  const intro=make('p','Prüfe Datei, gespeicherten Beitrag und Zielkonto. Deine Freigabe gilt nur für genau diesen Stand. Offene Medien- oder Kontoprüfungen verhindern die Veröffentlichung.');
  const controls=make('form'),options=make('div'),prepare=make('button','Auftrag prüfen');prepare.type='submit';controls.append(options,prepare);
  const details=make('div'),notice=make('p');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
  const reviewControls=make('div'),reviewFields=new Map();
  for(const [key,text] of [['content_checked','Ich habe die vollständige Datei, Ton, Einblendungen und den gespeicherten Beitrag geprüft.'],['media_rights','Ich darf die verwendeten Bilder, Videos und dargestellten Personen für diesen Beitrag verwenden.'],['music_rights','Für enthaltene Musik und sonstige Tonaufnahmen habe ich die nötigen Nutzungsrechte; andernfalls enthält der Beitrag keine solchen Inhalte.'],['tiktok_music_terms','Mit der Veröffentlichung stimme ich der '],['tiktok_branded_terms','Für Werbung für Dritte stimme ich der ']]){
    const label=make('label'),input=make('input');input.type='checkbox';input.id='order-review-'+key;label.append(input,doc.createTextNode(' '+text));
    if(key.startsWith('tiktok_')){const link=make('a',key==='tiktok_music_terms'?'TikTok Music Usage Confirmation':'TikTok Branded Content Policy');link.href=key==='tiktok_music_terms'?'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en':'https://www.tiktok.com/legal/page/global/bc-policy/en';link.target='_blank';link.rel='noopener noreferrer';label.append(link,doc.createTextNode(' zu.'));}
    reviewFields.set(key,input);reviewControls.append(label);
  }
  reviewControls.append(make('p','Diese Bestätigungen ersetzen keine automatische Medienprüfung. Offene Prüfungen bleiben gesperrt.'));
  const consentLabel=make('label'),consent=make('input');consent.type='checkbox';
  consent.id='order-final-consent';
  consentLabel.append(consent,doc.createTextNode(' Ich habe Zielkonto, Beitrag, Rechte und Kennzeichnungen geprüft und gebe diesen Auftrag zur Veröffentlichung frei.'));
  const approve=make('button','Veröffentlichung freigeben');approve.type='button';approve.disabled=true;
  const statusButton=make('button','Status erneut laden');statusButton.type='button';statusButton.className='secondary';statusButton.hidden=true;
  const close=make('button','Schließen');close.type='button';close.className='secondary';
  const actions=make('div');actions.className='actions';actions.append(approve,statusButton,close);
  dialog.append(title,intro,controls,details,reviewControls,consentLabel,notice,actions);doc.body.append(dialog);
  const style=make('style');style.textContent='#publicationOrderDialog{width:min(650px,calc(100vw - 24px));max-height:min(720px,calc(100dvh - 24px));top:12px;bottom:auto;margin:0 auto;overflow:auto;border:1px solid #dfe5ef;border-radius:14px;padding:24px;color:#17233b}#publicationOrderDialog::backdrop{background:#17233b66}#publicationOrderDialog label{margin:14px 0 8px}#publicationOrderDialog input[type=checkbox]{margin-right:8px}#publicationOrderDialog pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.5;background:#f5f7fc;padding:14px;border-radius:10px}#publicationOrderDialog select{margin-bottom:14px}#preparePublicationOrder{margin-top:12px}';doc.head.append(style);
  const client=createOrderClient({session});let order=null,context=null,working=false,epoch=0,account=null;
  const fields=new Map();let commercial=null,commercialNotice=null;
  function select(key,label,values) {
    const l=make('label',label),s=make('select');s.id='order-'+key;l.htmlFor=s.id;s.required=true;
    const empty=make('option','Bitte auswählen');empty.value='';s.append(empty);
    for(const [value,text] of values){const o=make('option',text);o.value=value;s.append(o);}fields.set(key,s);options.append(l,s);
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
    options.replaceChildren();fields.clear();commercial=null;commercialNotice=null;
    if(platform==='youtube') {
      select('visibility','Sichtbarkeit',[['private','Privat'],['unlisted','Nicht gelistet'],['public','Öffentlich']]);
      select('made_for_kids','Speziell für Kinder erstellt?',[['true','Ja'],['false','Nein']]);
      select('contains_synthetic_media','Realistisch veränderte oder synthetische Inhalte?',[['true','Ja'],['false','Nein']]);
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
  function reviewValues(){return Object.fromEntries([...reviewFields].map(([k,e])=>[k,e.checked]));}
  function reviewReady(){try{reviewConfirmation(order,reviewValues());return !order.check_error;}catch{return false;}}
  function setWorking(value){working=value;controls.querySelectorAll('select,button,input').forEach(e=>e.disabled=value||!!order||e.dataset.forced==='true');syncCommercial();close.disabled=value;consent.disabled=value;for(const input of reviewFields.values())input.disabled=value||order?.state!=='prepared';statusButton.disabled=value;approve.disabled=value||order?.state!=='prepared'||!consent.checked||!reviewReady();}
  function showOrder(r) {
    if(!r.binding||Object.entries(context.binding).some(([k,v])=>r.binding[k]!==v))throw Error(orderError('ORDER_CHANGED'));
    order=r;details.replaceChildren();consent.checked=false;consentLabel.hidden=r.state!=='prepared';controls.hidden=true;
    reviewControls.hidden=r.state!=='prepared';for(const [key,input] of reviewFields){input.checked=false;input.parentElement.hidden=key==='tiktok_music_terms'?context.binding.platform!=='tiktok':key==='tiktok_branded_terms'?context.binding.platform!=='tiktok'||r.choices?.brand_content_toggle!==true:false;}
    details.append(make('p','Datei: '+context.name),make('p','Zielkonto: '+(r.account_check?.display_name||r.target?.name||'Noch nicht zugeordnet')+(r.target?.id?' · '+r.target.id:'')));
    const decisionLabels={visibility:'Sichtbarkeit',made_for_kids:'Speziell für Kinder',contains_synthetic_media:'Synthetische Inhalte',disable_comment:'Kommentare deaktiviert',disable_duet:'Duette deaktiviert',disable_stitch:'Stitch deaktiviert',brand_content_toggle:'Werbung für Dritte',brand_organic_toggle:'Eigene Marke'};
    const visibilityLabels={private:'Privat',public:'Öffentlich',unlisted:'Nicht gelistet',SELF_ONLY:'Nur ich',PUBLIC_TO_EVERYONE:'Öffentlich',MUTUAL_FOLLOW_FRIENDS:'Freunde',FOLLOWER_OF_CREATOR:'Follower'};
    const decisions=make('ul');for(const [key,value] of Object.entries(r.choices||{}))if(decisionLabels[key])decisions.append(make('li',decisionLabels[key]+': '+(key==='visibility'?visibilityLabels[value]||value:value?'Ja':'Nein')));details.append(decisions);
    details.append(make('h3',r.draft?.title||'Gespeicherter Beitrag'),make('pre',r.draft?.caption||r.draft?.body||''));
    const media=r.media_check;
    if(media?.asset_id===context.binding.asset_id&&media?.asset_revision===context.binding.asset_revision&&Array.isArray(media.checks)){
      const open=media.checks.filter(x=>x.status!=='pass'&&x.code!=='PUBLICATION_APPROVAL_PENDING');
      if(open.length){details.append(make('h3','Offene Medienprüfungen'));const list=make('ul');for(const check of open)list.append(make('li',check.message));details.append(list);}
    }
    if(r.check_error)details.append(make('p',orderError(r.check_error)));
    if(context.binding.platform==='tiktok')details.append(make('p','Nach einer späteren Veröffentlichung kann TikTok einige Minuten benötigen, bis der Beitrag im Profil sichtbar ist.'));
    statusButton.hidden=r.state==='cancelled';
    if(r.state==='cancelled')notice.textContent='Dieser Auftrag wurde storniert und kann nicht mehr freigegeben werden. Schließe dieses Fenster und bereite bei Bedarf einen neuen Auftrag vor.';
    else if(r.state==='prepared')notice.textContent='Zielkonto und gespeicherter Text sind zugeordnet. Erst deine ausdrückliche Bestätigung speichert die Freigabe.';
    else if(r.approved_at)notice.textContent='Deine Freigabe ist gespeichert. Es wurde nichts veröffentlicht. '+(r.state==='checking'?'Die Prüfung läuft noch.':'Die Veröffentlichung bleibt wegen offener Prüfungen gesperrt.');
    else notice.textContent='Der Auftrag ist vorbereitet; die Zielkontoprüfung ist noch nicht abgeschlossen.';
    if(r.blockers?.length){const list=make('ul');for(const code of r.blockers)list.append(make('li',blockerText(code)));details.append(list);}
    approve.hidden=r.state!=='prepared';setWorking(false);
  }
  function unchanged(){const next=getContext();if(JSON.stringify(next.binding)!==JSON.stringify(context.binding))throw Error(orderError('ORDER_CHANGED'));}
  async function run(action) {
    if(working)return;setWorking(true);notice.textContent='Auftrag wird geprüft …';const generation=epoch;
    try{unchanged();const result=await action();if(generation!==epoch)return;unchanged();showOrder(result);}
    catch(e){if(generation===epoch){notice.textContent=e.message||orderError();if(e.code==='DUPLICATE_PUBLICATION'&&e.existingId){try{const existing=await client.get(e.existingId);if(generation===epoch){unchanged();showOrder(existing);notice.textContent=errors.DUPLICATE_PUBLICATION+' Es wurde nichts erneut veröffentlicht.';}}catch{}}}}
    finally{if(generation===epoch)setWorking(false);}
  }
  button.addEventListener('click',async()=>{
    const generation=++epoch;order=null;account=null;commercial=null;client.reset();controls.hidden=true;reviewControls.hidden=true;for(const input of reviewFields.values())input.checked=false;details.replaceChildren();options.replaceChildren();consent.checked=false;consentLabel.hidden=true;approve.hidden=true;statusButton.hidden=true;notice.textContent='Zielkonto wird beim Portal geprüft …';dialog.showModal();onOpen();setWorking(true);
    try{
      context=getContext();const platform=context.binding.platform;
      const verified=['youtube','tiktok'].includes(platform)?await client.account(platform):null;
      if(generation!==epoch)return;account=verified;unchanged();renderChoices(platform,account);controls.hidden=false;
      if(account){details.append(make('p','Verbundenes Zielkonto: '+account.account_check.display_name+' · '+account.target.id));if(platform==='tiktok')details.append(make('p','Dieses TikTok-Konto erlaubt Videos bis '+account.account_check.policy.max_duration_sec+' Sekunden.'));}
      notice.textContent='Wähle die Einstellungen für diesen Beitrag.';
    }catch(e){if(generation===epoch)notice.textContent=e.message||orderError();}
    finally{if(generation===epoch)setWorking(false);}
  });
  controls.addEventListener('submit',event=>{event.preventDefault();if(!controls.reportValidity())return;
    if(commercial?.checked&&!fields.get('brand_content_toggle').checked&&!fields.get('brand_organic_toggle').checked){notice.textContent='Wähle eigene Marke, Werbung für Dritte oder beides.';return;}
    if(context.binding.platform==='tiktok'&&fields.get('brand_content_toggle').checked&&fields.get('visibility').value==='SELF_ONLY'){notice.textContent='Werbung für Dritte kann bei TikTok nicht mit „Nur ich“ veröffentlicht werden. Bitte wähle eine andere Sichtbarkeit.';return;}
    const choices=Object.fromEntries([...fields].map(([k,e])=>[k,k==='visibility'?e.value:e.type==='checkbox'?(e.dataset.invert==='true'?!e.checked:e.checked):e.value==='true']));return run(async()=>{await refresh();unchanged();return client.prepare(context.binding,choices);});});
  consent.addEventListener('change',()=>setWorking(working));
  for(const input of reviewFields.values())input.addEventListener('change',()=>setWorking(working));
  approve.addEventListener('click',()=>run(()=>client.approve(order,consent.checked,reviewValues())));
  statusButton.addEventListener('click',()=>run(()=>client.get(order.id)));
  close.addEventListener('click',()=>dialog.close());dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();});
  return {viewport:height=>{if(Number.isFinite(height)&&height>=240&&height<=1200)dialog.style.maxHeight=height+'px';},lock:value=>{button.disabled=value;},clear(){epoch++;order=null;context=null;client.reset();dialog.close();details.replaceChildren();notice.textContent='';}};
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
