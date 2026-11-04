import {normalizeWebsite,normalizeDomain} from './website-domain-model.mjs?v=1';
const error=code=>Object.assign(new Error(code),{code});
const messages={AUTH_REQUIRED:'Deine SMA-Sitzung ist nicht mehr gültig.',ACCOUNT_CHANGED:'Die Kundenzuordnung hat sich geändert.',ACCOUNT_UNAVAILABLE:'Der Zugang ist nicht eindeutig zugeordnet.',ACCESS_INACTIVE:'Dein SMA-Zugang ist derzeit nicht aktiv.',DELTA_REQUIRED:'Der Domainnachweis gehört zum Delta-Paket.',CHECK_RATE_LIMITED:'Bitte warte eine Minute vor der nächsten DNS-Prüfung.',CHECK_STALE:'Die Webadresse oder Domain wurde inzwischen geändert. Lade die gespeicherte Vorbereitung neu.',PREPARE_REQUIRED:'Erstelle zuerst den Nachweis für die gespeicherte Domain.',WEBSITE_REQUIRED:'Speichere zuerst deine bestehende Webadresse.',DOMAIN_REQUIRED:'Speichere zuerst die Domain für deine neue SMA-Webseite.',INVALID_DOMAIN:'Für den TXT-Nachweis muss die Domain gültig und höchstens 235 Zeichen lang sein.'};
// The target comes only from the saved preparation, never from an editable field.
export function domainVerificationTarget(preparation){
 const draft=preparation?.draft;if(!draft)return null;let hostname;
 if(draft.mode==='existing'){if(!draft.website_url)return null;hostname=new URL(normalizeWebsite(draft.website_url)).hostname;}
 else if(draft.mode==='new')hostname=normalizeDomain(draft.desired_domain??'');
 else throw error('INVALID_RESPONSE');
 if(!hostname)return null;if(hostname.length>235)throw error('INVALID_DOMAIN');
 return {hostname,mode:draft.mode};
}
export function readDomainCheck(value,draft){
 if(!value||value.ok!==true)throw error(value?.code||'UNAVAILABLE');
 if(!draft?.draft||value.revision!==draft.revision)throw error('CHECK_STALE');
 const target=domainVerificationTarget(draft);if(!target)throw error('CHECK_STALE');const {hostname}=target;
 if(value.hostname!==hostname||!['unprepared','pending','verified'].includes(value.state))throw error('INVALID_RESPONSE');
 if(value.state==='unprepared')return {state:value.state,hostname};
 if(value.record_name!=='_sma-verification.'+hostname||value.record_type!=='TXT'||typeof value.record_value!=='string'||!/^sma-verification=[a-f0-9]{64}$/.test(value.record_value)||!['pending','found','not_found','unavailable'].includes(value.last_result))throw error('INVALID_RESPONSE');
 if(value.state==='verified'?(typeof value.verified_at!=='string'||!Number.isFinite(Date.parse(value.verified_at))):value.verified_at!==null)throw error('INVALID_RESPONSE');
 return {state:value.state,hostname,recordName:value.record_name,recordValue:value.record_value,verifiedAt:value.verified_at,lastResult:value.last_result};
}
export function mountDomainVerification({root,request,getOwnerId,onAccessError,asPanel=false}){
 const doc=root.ownerDocument,win=doc.defaultView,section=doc.createElement(asPanel?'section':'details');
 section.className='sma-website-embed sma-domain-check';
 section.innerHTML='<summary>Eigene Domain nachweisen</summary><p class="sma-website-help" data-domain-intro></p><p class="sma-website-help" data-domain-connection-note></p><p data-domain-status role="status" aria-live="polite"></p><button type="button" data-domain-prepare disabled>Prüfeintrag erstellen</button><div data-domain-record hidden><p class="sma-website-help">Lege bei deinem Domainanbieter einen zusätzlichen DNS-Eintrag vom Typ <strong>TXT</strong> an. Die folgenden Angaben gehören zur gespeicherten Domain. Vorhandene Einträge bleiben bestehen.</p><label class="sma-website-field">Vollständiger DNS-Name<input type="text" readonly data-domain-name></label><button type="button" data-domain-copy="name">DNS-Name kopieren</button><label class="sma-website-field">TXT-Wert<textarea readonly rows="3" spellcheck="false" data-domain-value></textarea></label><button type="button" data-domain-copy="value">TXT-Wert kopieren</button><p class="sma-website-help">Wenn dein Anbieter die Domain automatisch ergänzt, trage im Namensfeld nur den davorliegenden Teil ein. Neue DNS-Einträge können zeitversetzt sichtbar werden.</p><div class="sma-website-actions"><button type="button" data-domain-verify>Domainnachweis prüfen</button></div><p class="sma-website-help">Die Prüfung bestätigt den DNS-Eintrag zum angezeigten Zeitpunkt. Sie verbindet die Domain noch nicht mit einer Webseite.</p></div>';
 root.append(section);
 if(asPanel){const heading=doc.createElement('h2');heading.textContent='Eigene Domain nachweisen';heading.tabIndex=-1;section.querySelector('summary').replaceWith(heading);}
 const $=s=>section.querySelector(s);let draft=null,owner=null,generation=0,busy=false,destroyed=false;
 const notice=text=>{$('[data-domain-status]').textContent=text;};
 function clear(){for(const el of section.querySelectorAll('input,textarea'))el.value='';$('[data-domain-record]').hidden=true;$('[data-domain-prepare]').disabled=true;$('[data-domain-intro]').textContent='Mit einem TXT-Prüfeintrag zeigst du, dass du die gespeicherte Domain verwalten kannst.';$('[data-domain-connection-note]').textContent='Ein Nachweis kauft keine Domain und ändert weder DNS noch Hosting.';}
 function invalidate(text='Speichere zuerst eine Webadresse oder die Domain für deine neue SMA-Webseite.') {generation++;draft=null;owner=null;busy=false;clear();notice(text);}
 function show(state){
  clear();describe();$('[data-domain-prepare]').hidden=state.state!=='unprepared';$('[data-domain-prepare]').disabled=false;
  if(state.state==='unprepared'){notice('Für '+state.hostname+' ist noch kein Domainnachweis erstellt.');return;}
  $('[data-domain-name]').value=state.recordName;$('[data-domain-value]').value=state.recordValue;$('[data-domain-record]').hidden=false;
  if(state.lastResult==='unavailable')notice('DNS konnte gerade nicht geprüft werden.'+(state.verifiedAt?' Letzter bestätigter Nachweis: '+new Date(state.verifiedAt).toLocaleString('de-AT')+'.':' Bitte später erneut versuchen.'));
  else if(state.state==='verified')notice('Domainnachweis bestätigt am '+new Date(state.verifiedAt).toLocaleString('de-AT')+'.');
  else if(state.lastResult==='not_found')notice('Der passende TXT-Eintrag ist noch nicht sichtbar. Prüfe die Angaben oder versuche es später erneut.');
  else notice('Prüfeintrag für '+state.hostname+' erstellt. Trage ihn bei deinem Domainanbieter ein und starte danach die Prüfung.');
 }
 function describe(){const own=draft?.draft?.mode==='new';$('[data-domain-intro]').textContent=own?'Für deine neue SMA-Webseite kannst du eine Domain nachweisen, die dir bereits gehört. Trage dazu den TXT-Prüfeintrag bei deinem Domainanbieter ein.':'Mit einem TXT-Prüfeintrag zeigst du, dass du die gespeicherte Domain verwalten kannst. Der Shop-Button ist unabhängig davon nutzbar.';$('[data-domain-connection-note]').textContent=own?'Deine SMA-Webseite bleibt unter ihrer bisherigen Adresse. Die Verknüpfung der eigenen Domain ist noch nicht eingerichtet.':'Der Nachweis verbindet oder verändert deine bestehende Webseite nicht.';}
 async function run(action){
  if(destroyed||busy||!draft)return;const ticket=generation,saved=draft;busy=true;
  for(const b of section.querySelectorAll('button'))b.disabled=true;
  notice(action==='verify'?'DNS-Eintrag wird geprüft …':action==='prepare'?'Prüfeintrag wird erstellt …':'Domainnachweis wird geladen …');
  try{
   const before=await getOwnerId();if(destroyed||generation!==ticket)return;if(!before||(owner&&owner!==before))throw error('AUTH_REQUIRED');owner=before;
   const result=await request(action);
   if(destroyed||generation!==ticket)return;
   if(await getOwnerId()!==before)throw error('AUTH_REQUIRED');
   if(destroyed||generation!==ticket)return;
   show(readDomainCheck(result,saved));
  }catch(e){
   if(destroyed||generation!==ticket)return;
   if(['AUTH_REQUIRED','ACCOUNT_CHANGED','ACCOUNT_UNAVAILABLE','ACCESS_INACTIVE','DELTA_REQUIRED'].includes(e.code)){invalidate(messages[e.code]);onAccessError?.(e);}
   else notice(messages[e.code]||'Der Domainnachweis ist gerade nicht erreichbar. Bitte versuche es erneut.');
  }finally{if(!destroyed&&generation===ticket){busy=false;for(const b of section.querySelectorAll('button'))b.disabled=false;}}
 }
 $('[data-domain-prepare]').addEventListener('click',()=>run('prepare'));
 $('[data-domain-verify]').addEventListener('click',()=>run('verify'));
 for(const button of section.querySelectorAll('[data-domain-copy]'))button.addEventListener('click',async()=>{
  const field=button.dataset.domainCopy==='name'?$('[data-domain-name]'):$('[data-domain-value]');const ticket=generation;
  if(!draft||!field.value)return;
  try{await win.navigator.clipboard.writeText(field.value);if(ticket===generation&&!destroyed)notice('DNS-Angabe kopiert.');}
  catch{if(ticket===generation&&!destroyed){field.focus();field.select();notice('Markierte DNS-Angabe mit Strg+C oder ⌘C kopieren.');}}
 });
 return {invalidate,setDraft(value){invalidate();$('[data-domain-prepare]').hidden=false;try{if(domainVerificationTarget(value)){draft=structuredClone(value);describe();run('get');}else if(value?.draft?.mode==='new')notice(messages.DOMAIN_REQUIRED);}catch(e){notice(messages[e.code]||'Die gespeicherte Domain ist nicht gültig.');}},destroy(){destroyed=true;generation++;section.remove();}};
}
