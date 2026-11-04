import {createWebsiteDraftClient,safeShopLink} from './website-domain-model.mjs?v=1';
import {createShopButton} from './shop-button.mjs?v=1';

const messages={
 AUTH_REQUIRED:'Bitte melde dich erneut bei SMA an.',
 ACCESS_INACTIVE:'Dein SMA-Zugang ist derzeit nicht aktiv.',
 DELTA_REQUIRED:'Webseite & Domain gehört zum Delta-Paket.',
 ACCOUNT_UNAVAILABLE:'Dein Zugang konnte nicht eindeutig zugeordnet werden.',
 ACCOUNT_CHANGED:'Deine Kundenzuordnung hat sich geändert. Bitte lade das Dashboard erneut.',
 WEBSITE_REQUIRED:'Trage die Adresse deiner vorhandenen Webseite ein.',
 INVALID_WEBSITE:'Verwende eine HTTPS-Webadresse ohne Zugangsdaten, Port, Suchparameter oder Anker.',
 INVALID_DOMAIN:'Trage einen Domainnamen wie meine-firma.at ein. Verwende für Umlaute die Schreibweise mit xn--.',
 INVALID_MODE:'Wähle aus, ob du bereits eine Webseite hast.',
 REVISION_CONFLICT:'Der gespeicherte Stand wurde inzwischen geändert. Lade ihn neu, bevor du weiter speicherst.',
 REQUEST_CONFLICT:'Dieser Speicherversuch passt nicht mehr zum Entwurf. Lade den gespeicherten Stand neu.',
 BUSY:'Bitte warte, bis der aktuelle Vorgang abgeschlossen ist.'
};

export function mountWebsitePreparation({page,request,getOwnerId,stylesheetUrl}){
 if(!page||page.querySelector('#smaWebsitePreparation'))return {destroy(){}};
 const doc=page.ownerDocument,win=doc.defaultView;
 const css=doc.createElement('link');css.rel='stylesheet';css.href=stylesheetUrl;doc.head.append(css);
 const root=doc.createElement('section');root.id='smaWebsitePreparation';
 root.setAttribute('aria-labelledby','smaWebsitePreparationTitle');
 // Only static application text enters innerHTML. Customer values use value/textContent.
 root.innerHTML='<h2 id="smaWebsitePreparationTitle">Deine Webseite vorbereiten</h2>'+
 '<p class="sma-website-intro">Hinterlege deine bestehende Webseite oder deinen Wunsch für eine neue Seite. Neue Webseiten werden individuell mit dir abgestimmt.</p>'+
 '<form novalidate><fieldset class="sma-website-fields" disabled><legend class="sma-website-sr">Webseite und Domain</legend>'+
 '<div class="sma-website-options"><label><input type="radio" name="website_mode" value="existing" checked> Ich habe bereits eine Webseite</label>'+
 '<label><input type="radio" name="website_mode" value="new"> Ich benötige eine Webseite</label></div>'+
 '<label class="sma-website-field" data-existing>Vorhandene Webseite<input name="website_url" type="text" inputmode="url" autocomplete="url" placeholder="https://meine-firma.at" maxlength="2048"></label>'+
 '<label class="sma-website-field">Wunschdomain <span class="sma-website-optional">(optional)</span><input name="desired_domain" type="text" inputmode="url" autocapitalize="none" spellcheck="false" placeholder="meine-firma.at" maxlength="253"><span class="sma-website-help">Ein Domainwunsch ist noch keine Verfügbarkeitsprüfung oder Reservierung.</span></label>'+
 '</fieldset><div class="sma-website-actions"><button type="submit" disabled class="sma-website-primary">Vorbereitung speichern</button><button type="button" data-reload>Gespeicherten Stand laden</button></div>'+
 '</form><p class="sma-website-status" role="status" aria-live="polite">Vorbereitung wird geladen …</p>'+
 '<p class="sma-website-help">Das Speichern beauftragt keine Erstellung, kauft keine Domain und veröffentlicht keine Webseite.</p>'+
 '<section class="sma-website-link-section" aria-labelledby="smaWebsiteLinkTitle"><h3 id="smaWebsiteLinkTitle">SMA-Shop auf deiner Webseite</h3>'+
 '<p data-shop-hint>Der Link zu deinem öffentlichen SMA-Shop wird hier bereitgestellt.</p>'+
 '<div data-shop-actions hidden><label class="sma-website-field">Dein Shop-Link<input data-shop-url type="text" readonly></label><div class="sma-website-actions"><button type="button" data-copy>Shop-Link kopieren</button><a data-shop-open target="_blank" rel="noopener noreferrer">Shop ansehen</a><a data-shop-preview target="_blank" rel="noopener noreferrer">Shop-Button testen</a></div>'+
 '<details class="sma-website-embed"><summary>Shop-Button auf deiner Webseite einbauen</summary><p class="sma-website-help">Kopiere den Code in einen HTML-Baustein deiner Webseite. Für ein einfaches Linkfeld verwende den Shop-Link oben.</p><label class="sma-website-field">Einbaucode<textarea data-shop-code readonly spellcheck="false" rows="4"></textarea></label><button type="button" data-copy-code>Einbaucode kopieren</button></details></div>'+
 '<p class="sma-website-help">Der Button führt Besucher zu deinem SMA-Shop. Kopiere den Einbaucode auf deine Webseite, um ihn dort zu verwenden.</p></section>';
 const placeholder=page.querySelector('.package-module-slot');
 if(placeholder)placeholder.replaceWith(root);else page.append(root);
 const $=s=>root.querySelector(s),fields=$('fieldset'),status=$('.sma-website-status');
 const client=createWebsiteDraftClient({request,getOwnerId,uuid:()=>win.crypto.randomUUID()});
 let destroyed=false,loaded=false,busy=false,dirty=false;
 const mode=()=>root.querySelector('[name="website_mode"]:checked').value;
 const toggle=()=>{ $('[data-existing]').hidden=mode()!=='existing';$('[name="website_url"]').disabled=mode()!=='existing'; };
 function notice(text,error=false){if(destroyed)return;status.textContent=text;status.classList.toggle('sma-website-error',error);}
 function setBusy(value){busy=value;fields.disabled=value||!loaded;$('[type="submit"]').disabled=value||!loaded;$('[data-reload]').disabled=value;root.setAttribute('aria-busy',String(value));}
 function rejectOwner(error){if(['AUTH_REQUIRED','ACCOUNT_CHANGED','ACCOUNT_UNAVAILABLE','ACCESS_INACTIVE','DELTA_REQUIRED'].includes(error.code)){loaded=false;for(const input of root.querySelectorAll('input[type="text"],textarea'))input.value='';$('[data-shop-actions]').hidden=true;$('[data-shop-open]').removeAttribute('href');$('[data-shop-preview]').removeAttribute('href');}}
 function show(state){
  if(destroyed)return;
  const draft=state.draft||{mode:'existing',website_url:'',desired_domain:''};
  root.querySelector('[name="website_mode"][value="'+draft.mode+'"]').checked=true;
  $('[name="website_url"]').value=draft.website_url;$('[name="desired_domain"]').value=draft.desired_domain;toggle();
  const link=safeShopLink(state.shop_url);$('[data-shop-actions]').hidden=!link;
  $('[data-shop-url]').value=link||'';$('[data-shop-open]').removeAttribute('href');
  const button=createShopButton(link);$('[data-shop-code]').value=button?.html||'';
  $('[data-shop-preview]').removeAttribute('href');
  if(button)$('[data-shop-preview]').href=button.previewUrl;
  if(link)$('[data-shop-open]').href=link;
  $('[data-shop-hint]').textContent=link?'Der Link führt zu deinem vorhandenen öffentlichen SMA-Shop.':'Sobald dein SMA-Shop öffentlich freigeschaltet ist, erscheint hier sein Link.';
  loaded=true;dirty=false;
 }
 async function load(){
  if(destroyed||busy)return;
  setBusy(true);notice('Vorbereitung wird geladen …');
  try{const result=await client.load();if(destroyed)return;show(result);notice(result.draft?'Gespeicherte Vorbereitung geladen. Verbindung noch nicht geprüft.':'Du kannst deine Webseite jetzt vorbereiten.');}
  catch(error){rejectOwner(error);notice(messages[error.code]||'Die Vorbereitung ist gerade nicht erreichbar. Bitte versuche es später erneut.',true);}
  finally{if(!destroyed){setBusy(false);if(!loaded)fields.disabled=true;}}
 }
 $('form').addEventListener('input',()=>{dirty=true;toggle();notice('Ungespeicherte Angaben.');});
 $('form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||destroyed||!loaded)return;setBusy(true);notice('Vorbereitung wird gespeichert …');
  try{
   const result=await client.save({mode:mode(),website_url:mode()==='existing'?$('[name="website_url"]').value:'',desired_domain:$('[name="desired_domain"]').value});
   if(destroyed)return;show(result);notice('Vorbereitung gespeichert. Verbindung noch nicht geprüft.');
  }catch(error){rejectOwner(error);notice(messages[error.code]||'Das Speichern konnte nicht bestätigt werden. Du kannst denselben Stand erneut speichern.',true);}
  finally{if(!destroyed){setBusy(false);toggle();}}
 });
 $('[data-reload]').addEventListener('click',load);
 $('[data-copy]').addEventListener('click',async()=>{
  const link=safeShopLink($('[data-shop-url]').value);if(!link||destroyed)return;
  try{await win.navigator.clipboard.writeText(link);notice('Shop-Link kopiert.');}
  catch{$('[data-shop-url]').focus();$('[data-shop-url]').select();notice('Markierten Shop-Link mit Strg+C oder ⌘C kopieren.');}
 });
 $('[data-copy-code]').addEventListener('click',async()=>{
  const button=createShopButton($('[data-shop-url]').value);if(!button||destroyed)return;
  try{await win.navigator.clipboard.writeText(button.html);notice('Einbaucode kopiert.');}
  catch{$('[data-shop-code]').focus();$('[data-shop-code]').select();notice('Markierten Einbaucode mit Strg+C oder ⌘C kopieren.');}
 });
 // Load only when the existing navigation displays this module.
 const observer=new win.MutationObserver(()=>{if(page.classList.contains('active')&&!dirty&&!loaded)load();});
 observer.observe(page,{attributes:true,attributeFilter:['class','hidden']});
 if(page.classList.contains('active'))load();
 return {destroy(){destroyed=true;observer.disconnect();if(placeholder&&root.parentNode)root.replaceWith(placeholder);else root.remove();css.remove();}};
}
