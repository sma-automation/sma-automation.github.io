import {mountWebsiteSetup} from './website-setup.mjs?v=2';
import {createWebsiteDraftClient,safeShopLink} from './website-domain-model.mjs?v=2';
import {createShopButton} from './shop-button.mjs?v=1';
import {createShopCatalog} from './shop-catalog-model.mjs?v=1';
import {mountWordpressConnection} from './wordpress-connection.mjs?v=2';
import {mountDomainVerification,domainVerificationTarget} from './domain-verification.mjs?v=3';

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
 REQUEST_TIMEOUT:'Die SMA-Verbindung antwortet nicht. Der Vorgang ist gestoppt. Klicke auf „Gespeicherten Stand laden“, bevor du erneut speicherst.',
 BUSY:'Bitte warte, bis der aktuelle Vorgang abgeschlossen ist.'
};

export function mountWebsitePreparation({page,request,setupRequest,domainRequest,wordpressRequest,wordpressSyncRequest,getOwnerId,stylesheetUrl,chapterNavigation=false}){
 if(!page||page.querySelector('#smaWebsitePreparation'))return {destroy(){}};
 const doc=page.ownerDocument,win=doc.defaultView;
 const css=doc.createElement('link');css.rel='stylesheet';css.href=stylesheetUrl;doc.head.append(css);
 const root=doc.createElement('section');root.id='smaWebsitePreparation';
 root.setAttribute('aria-label','Webseite und Domain einrichten');
 // Only static application text enters innerHTML. Customer values use value/textContent.
 root.innerHTML='<div data-website-overview class="sma-website-overview">'+
 '<button type="button" class="sma-website-entry" data-website-open="website" aria-controls="smaWebsiteView-website"><span><strong>Webseite einrichten</strong><span>Vorhandene Webseite verbinden oder eine eigene SMA-Webseite erstellen.</span></span><span class="sma-website-entry-arrow" aria-hidden="true">→</span></button>'+
 '<button type="button" class="sma-website-entry" data-website-open="shop" aria-controls="smaWebsiteView-shop"><span><strong>Shop-Button einbauen</strong><span>Shop-Link, Einbaucode und Vorschau öffnen.</span></span><span class="sma-website-entry-arrow" aria-hidden="true">→</span></button>'+
 '<button type="button" class="sma-website-entry" data-website-open="domain" aria-controls="smaWebsiteView-domain"><span><strong>Eigene Domain nachweisen</strong><span>DNS-Prüfeintrag erstellen und den Nachweis prüfen.</span></span><span class="sma-website-entry-arrow" aria-hidden="true">→</span></button>'+
 '</div><div class="sma-website-workspace-header" data-website-toolbar hidden><button type="button" data-website-back class="sma-website-back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>Webseite &amp; Domain</button></div>'+
 '<section id="smaWebsiteView-website" data-website-view="website" aria-labelledby="smaWebsitePreparationTitle" hidden><h2 id="smaWebsitePreparationTitle" tabindex="-1">Webseite einrichten</h2>'+
 '<div data-company-profile-dashboard></div><p class="sma-website-intro">Hinterlege deine bestehende Webseite oder deinen Wunsch für eine neue Seite.</p>'+
 '<form novalidate><fieldset class="sma-website-fields" disabled><legend class="sma-website-sr">Webseite und Domain</legend>'+
 '<div class="sma-website-options"><label><input type="radio" name="website_mode" value="existing" checked> Ich habe bereits eine Webseite</label>'+
 '<label><input type="radio" name="website_mode" value="new"> Ich benötige eine Webseite</label></div>'+
 '<label class="sma-website-field" data-existing>Vorhandene Webseite<input name="website_url" type="text" inputmode="url" autocomplete="url" placeholder="https://meine-firma.at" maxlength="2048"></label>'+
 '<label class="sma-website-field"><span>Eigene Domain oder Wunschdomain <span class="sma-website-optional">(optional)</span></span><input name="desired_domain" type="text" inputmode="url" autocapitalize="none" spellcheck="false" placeholder="meine-firma.at" maxlength="253"><span class="sma-website-help">Eine Domain, die dir bereits gehört, kannst du nach dem Speichern nachweisen. Ein Wunsch wird dadurch weder geprüft noch reserviert.</span></label>'+
 '</fieldset><div class="sma-website-actions"><button type="submit" disabled class="sma-website-primary">Vorbereitung speichern</button><button type="button" data-reload>Gespeicherten Stand laden</button></div>'+
 '</form><div class="sma-website-actions" data-existing-route><button type="button" data-website-open="connection" data-wp-entry>Vorhandene WordPress-Webseite verbinden</button></div><p class="sma-website-help" data-existing-note>Deine vorhandene Webseite bleibt bei ihrem Anbieter. Nach bestätigter WordPress-Verbindung kannst du deinen SMA-Produktbereich automatisch als Entwurf erzeugen.</p><div class="sma-website-actions" data-new-route hidden><a href="https://sma-automation.com/app/website-builder.html" target="_top" class="sma-website-primary">Webseite erzeugen / bearbeiten</a><a href="https://sma-automation.com/app/website-preview-shk.html" target="_blank" rel="noopener noreferrer">Beispiel Sanitär · Heizung · Klima ↗</a><button type="button" data-website-open="domain" data-new-domain-entry>Eigene Domain nachweisen</button></div><p class="sma-website-help" data-new-note hidden>Erstelle eine bearbeitbare Webseite mit SMA-Adresse und automatisch zugeordnetem Shop. Der Entwurf bleibt bis zu deiner Veröffentlichung privat. Deine SMA-Webadresse kannst du unten automatisch einrichten.</p></section>'+
 '<section id="smaWebsiteView-shop" data-website-view="shop" class="sma-website-link-section" aria-labelledby="smaWebsiteLinkTitle" hidden><h2 id="smaWebsiteLinkTitle" tabindex="-1">Shop-Button einbauen</h2>'+
 '<p data-shop-hint>Der Link zu deinem öffentlichen SMA-Shop wird hier bereitgestellt.</p>'+
 '<div data-shop-actions hidden><label class="sma-website-field">Dein Shop-Link<input data-shop-url type="text" readonly></label><div class="sma-website-actions"><button type="button" data-copy>Shop-Link kopieren</button><a data-shop-open target="_blank" rel="noopener noreferrer">Shop ansehen</a><a data-shop-preview target="_blank" rel="noopener noreferrer">Shop-Button testen</a></div>'+
 '<details class="sma-website-embed"><summary>Shop-Button auf deiner Webseite einbauen</summary><p class="sma-website-help">Kopiere den Code in einen HTML-Baustein deiner Webseite. Für ein einfaches Linkfeld verwende den Shop-Link oben.</p><label class="sma-website-field">Einbaucode<textarea data-shop-code readonly spellcheck="false" rows="4"></textarea></label><button type="button" data-copy-code>Einbaucode kopieren</button></details><div data-catalog-actions hidden><p class="sma-website-help">Du kannst auch eine Produktliste mit aktuellem Preis und Bestand auf deiner Webseite anzeigen.</p><div class="sma-website-actions"><a data-catalog-preview target="_blank" rel="noopener noreferrer">Produktliste einbauen</a></div></div></div>'+
 '<p class="sma-website-help">Der Button führt Besucher zu deinem SMA-Shop. Kopiere den Einbaucode auf deine Webseite, um ihn dort zu verwenden.</p></section>'+
 '<section id="smaWebsiteView-domain" data-website-view="domain" hidden><div data-domain-panel></div><div class="sma-website-actions" data-domain-setup><button type="button" data-website-open="website">Webadresse oder Domain hinterlegen</button></div></section>'+
 '<section id="smaWebsiteView-connection" data-website-view="connection" hidden><h2 tabindex="-1">WordPress verbinden</h2><div data-wordpress-panel></div></section>'+
 '<p class="sma-website-status" role="status" aria-live="polite" hidden></p>';
 const placeholder=page.querySelector('.package-module-slot');
 if(placeholder)placeholder.replaceWith(root);else page.append(root);
 const $=s=>root.querySelector(s),fields=$('fieldset'),status=$('.sma-website-status');
 // Keep progress/errors beside the save button, not below all other modules.
 $('form').after(status);
 page.classList.add('sma-website-managed');
 let activeView='overview',lastView='website';
 const viewNames=['website','shop','domain','connection'];
 if(chapterNavigation){
  const company=doc.createElement('section');company.id='smaWebsiteView-company';company.dataset.websiteView='company';company.hidden=true;
  company.append($('[data-company-profile-dashboard]'));root.append(company);viewNames.push('company');
 }
 function openView(name,{focus=true,scroll=true}={}){
  if(chapterNavigation&&name==='overview')name='website';
  if(name!=='overview'&&!viewNames.includes(name))return;
  if(name==='connection')wordpressView?.load();
  activeView=name;if(name!=='overview')lastView=name==='connection'?'website':name;
  for(const panel of root.querySelectorAll('[data-website-view]'))panel.hidden=panel.dataset.websiteView!==name;
  $('[data-website-overview]').hidden=name!=='overview';$('[data-website-toolbar]').hidden=name==='overview';
  page.classList.toggle('sma-website-detail',!chapterNavigation&&name!=='overview');
  if(chapterNavigation)page.dispatchEvent(new win.CustomEvent('sma:website-view-changed',{detail:{view:name}}));
  if(!busy&&!status.classList.contains('sma-website-error'))notice(dirty?'Ungespeicherte Angaben.':'');
  const target=name==='overview'?$('[data-website-open="'+lastView+'"]'):$('[data-website-view="'+name+'"] h2');
  if(focus)target?.focus({preventScroll:true});
  if(scroll)root.scrollIntoView({block:'start',behavior:'auto'});
 }
 for(const button of root.querySelectorAll('[data-website-open]'))button.addEventListener('click',()=>openView(button.dataset.websiteOpen));
 $('[data-website-back]').addEventListener('click',()=>openView('overview'));
 const client=createWebsiteDraftClient({request,getOwnerId,uuid:()=>win.crypto.randomUUID()});
 let destroyed=false,loaded=false,busy=false,dirty=false;
 const setupRoot=doc.createElement('div');setupRoot.className='sma-website-setup';setupRoot.hidden=true;$('[data-new-note]').after(setupRoot);
 const setupView=setupRequest?mountWebsiteSetup({root:setupRoot,request:setupRequest,getOwnerId}):null;
 const wordpressView=wordpressRequest?mountWordpressConnection({root:$('[data-wordpress-panel]'),request:wordpressRequest,syncRequest:wordpressSyncRequest,getOwnerId}):null;
 if(!wordpressView)$('[data-wp-entry]').hidden=true;
 const domainView=domainRequest?mountDomainVerification({root:$('[data-domain-panel]'),asPanel:true,request:domainRequest,getOwnerId,onAccessError:error=>{rejectOwner(error);setBusy(false);notice(messages[error.code],true);}}):null;
 if(!domainView){for(const entry of root.querySelectorAll('[data-website-open="domain"]'))entry.hidden=true;$('[data-domain-setup]').hidden=true;}
 const mode=()=>root.querySelector('[name="website_mode"]:checked').value;
 const toggle=()=>{ $('[data-existing]').hidden=mode()!=='existing';$('[name="website_url"]').disabled=mode()!=='existing';$('[data-existing-route]').hidden=mode()!=='existing';$('[data-existing-note]').hidden=mode()!=='existing';$('[data-new-route]').hidden=mode()!=='new';$('[data-new-note]').hidden=mode()!=='new';setupRoot.hidden=mode()!=='new'&&setupRoot.dataset.setupHasJob!=='true'; };
 function notice(text,error=false){if(destroyed)return;status.textContent=text;status.hidden=!text;status.classList.toggle('sma-website-error',error);}
 function setBusy(value){busy=value;fields.disabled=value||!loaded;$('[type="submit"]').disabled=value||!loaded;$('[data-reload]').disabled=value;root.setAttribute('aria-busy',String(value));}
 function rejectOwner(error){if(['AUTH_REQUIRED','ACCOUNT_CHANGED','ACCOUNT_UNAVAILABLE','ACCESS_INACTIVE','DELTA_REQUIRED'].includes(error.code)){loaded=false;setupView?.invalidate();wordpressView?.invalidate();domainView?.invalidate(messages[error.code]);for(const input of root.querySelectorAll('input[type="text"],textarea'))input.value='';$('[data-shop-actions]').hidden=true;$('[data-shop-open]').removeAttribute('href');$('[data-shop-preview]').removeAttribute('href');$('[data-catalog-preview]').removeAttribute('href');$('[data-catalog-actions]').hidden=true;}}
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
  const catalog=createShopCatalog(link);$('[data-catalog-preview]').removeAttribute('href');$('[data-catalog-actions]').hidden=!catalog;
  if(catalog)$('[data-catalog-preview]').href=catalog.previewUrl;
  if(link)$('[data-shop-open]').href=link;
  $('[data-shop-hint]').textContent=link?'Der Link führt zu deinem vorhandenen öffentlichen SMA-Shop.':'Sobald dein SMA-Shop öffentlich freigeschaltet ist, erscheint hier sein Link.';
  loaded=true;dirty=false;
  let domainReady=false;try{domainReady=!!domainVerificationTarget(state);}catch{}
  $('[data-domain-setup]').hidden=!domainView||domainReady;
  domainView?.setDraft(state);wordpressView?.setDraft(state);
 }
 async function load(){
  if(destroyed||busy)return;
  domainView?.invalidate('Vorbereitung wird geladen …');setBusy(true);notice('Vorbereitung wird geladen …');
  try{const result=await client.load();if(destroyed)return;show(result);notice('');}
  catch(error){rejectOwner(error);notice(messages[error.code]||'Die Vorbereitung ist gerade nicht erreichbar. Bitte versuche es später erneut.',true);}
  finally{if(!destroyed){setBusy(false);if(!loaded)fields.disabled=true;}}
 }
 $('form').addEventListener('input',()=>{dirty=true;wordpressView?.invalidate();domainView?.invalidate('Speichere die geänderten Angaben vor der Domainprüfung.');$('[data-domain-setup]').hidden=!domainView;toggle();notice('Ungespeicherte Angaben.');});
 $('form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||destroyed||!loaded)return;domainView?.invalidate('Vorbereitung wird gespeichert …');setBusy(true);notice('Vorbereitung wird gespeichert …');
  try{
   const result=await client.save({mode:mode(),website_url:mode()==='existing'?$('[name="website_url"]').value:'',desired_domain:$('[name="desired_domain"]').value});
   if(destroyed)return;show(result);notice('Vorbereitung gespeichert.');
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
 const observer=new win.MutationObserver(()=>{if(!chapterNavigation&&!page.classList.contains('active')&&activeView!=='overview')openView('overview',{focus:false,scroll:false});if(page.classList.contains('active')&&!dirty&&!loaded)load();});
 observer.observe(page,{attributes:true,attributeFilter:['class','hidden']});
 if(chapterNavigation)openView('website',{focus:false,scroll:false});
 // Chapter navigation can make the website panel visible without ever adding
 // the legacy "active" class to #page-website. Initialize its read-only
 // preparation state regardless, otherwise the disabled fieldset never unlocks.
 if(chapterNavigation||page.classList.contains('active'))void load();
 return {openChapter:chapterNavigation?(name)=>openView(name,{focus:false,scroll:false}):undefined,destroy(){destroyed=true;setupView?.destroy();wordpressView?.destroy();domainView?.destroy();observer.disconnect();page.classList.remove('sma-website-managed','sma-website-detail');if(placeholder&&root.parentNode)root.replaceWith(placeholder);else root.remove();css.remove();}};
}
