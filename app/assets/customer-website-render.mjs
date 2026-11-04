import {readCompanyProfile,companyAddress} from './company-profile-model.mjs?v=1';
import {readWebsiteContent,appearanceDefaults} from './customer-website-model.mjs?v=4';
import {createShopCatalog} from './shop-catalog-model.mjs?v=1';
import {mountShopCatalog} from './shop-catalog.mjs?v=1';
export function renderCustomerWebsite({root,content,shopURL,catalogRequest,company=null,imageRequest,makeURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url)}){
 const c=readWebsiteContent(content),p=company?readCompanyProfile(company):null,doc=root.ownerDocument,catalog=createShopCatalog(shopURL);
 // All interpolated customer content is assigned as text. The HTML below is application-owned.
 root.innerHTML='<header class="site-header"><a class="brand" href="#start"><span class="brand-mark" aria-hidden="true">⌂</span><span data-name></span></a><nav aria-label="Hauptnavigation"><a href="#leistungen" data-services-nav>Leistungen</a><a href="#produkte" data-shop-nav>Produkte</a><a href="#kontakt" class="button">Kontakt aufnehmen</a></nav></header>'+
 '<section class="hero" id="start"><div><p class="eyebrow" data-name></p><h1 data-headline></h1><p data-intro></p><div><a class="button primary" href="#kontakt">Kontakt aufnehmen →</a><a class="secondary" href="#leistungen" data-services-nav>Unsere Leistungen ↓</a></div></div><svg class="hero-visual" viewBox="0 0 400 300" aria-hidden="true"><defs><linearGradient id="house" x2="1" y2="1"><stop stop-color="#3b5879"/><stop offset="1" stop-color="#213c59"/></linearGradient></defs><circle cx="205" cy="150" r="140" fill="#203e5c"/><path d="M65 135 200 35 335 135" stroke="#a6c6eb" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M88 123V260H312V123L200 60Z" fill="url(#house)"/><path d="M113 160h65v-42h-65zm115 0h59v-42h-59z" fill="#86b5de" opacity=".7"/><path d="M200 75v183M90 180h220" stroke="#607f9d" stroke-width="3"/><path d="M109 242h172v-15H113v-15h167" stroke="#efac75" stroke-width="5" stroke-linecap="round" fill="none"/><path d="M175 153v-18h-27v17m-8 1h43" stroke="#d9edf8" stroke-width="5" fill="none" stroke-linecap="round"/><rect x="264" y="205" width="86" height="64" rx="7" fill="#dce8f3"/><circle cx="306" cy="236" r="23" stroke="#5f7e9c" stroke-width="3" fill="#aac0d4"/><path d="M306 218v36m-18-18h36m-31-13 26 26m-26 0 26-26" stroke="#5f7e9c" stroke-width="3"/><path d="M250 100v-23m-10 6 20 12m0-12-20 12" stroke="#a9dfff" stroke-width="3" stroke-linecap="round"/><path d="M75 265h285" stroke="#718eaa" stroke-width="3" stroke-linecap="round"/></svg></section>'+
 '<section class="section" id="leistungen"><div class="section-intro"><div><p class="eyebrow">Unsere Leistungsbereiche</p><h2>Unsere Leistungen</h2></div></div><div class="services" data-services></div></section>'+
 '<section class="section" id="ueber-uns"><p class="eyebrow">Über uns</p><h2 data-about-title></h2><p class="prose" data-about></p></section>'+
 '<section class="section" id="produkte"><div class="section-intro"><div><p class="eyebrow">Unser Angebot</p><h2>Produkte entdecken</h2><span id="merchantName" hidden></span></div><a id="shopOpen" class="button" target="_blank" rel="noopener noreferrer" hidden>Shop öffnen ↗</a></div><div class="catalog-toolbar"><p id="catalogStatus" role="status" aria-live="polite"></p><button id="refresh" type="button" hidden>Aktualisieren</button></div><div id="products" aria-label="Produkte" aria-busy="false"></div><nav id="pager" aria-label="Produktseiten" hidden><button id="previous" type="button">← Zurück</button><span id="pageNumber"></span><button id="next" type="button">Weiter →</button></nav><p class="note" id="catalogNote" hidden>Preise und Verfügbarkeit werden direkt aus unserem Shop geladen.</p></section>'+
 '<section class="contact" id="kontakt"><div><p class="eyebrow">Für Ihr nächstes Projekt</p><h2>Lassen Sie uns darüber sprechen.</h2><p>Nutzen Sie unsere Kontaktdaten für Ihre Anfrage.</p></div><div class="contact-list"><a data-email class="button primary" hidden>Anfrage per E-Mail →</a><p data-phone hidden></p><address data-address hidden></address><p data-contact-missing hidden>Kontaktdaten folgen.</p></div></section>'+
 '<footer class="site-footer"><span data-name></span><span>Webseite mit SMA</span></footer><div class="legal"><details data-company-facts hidden><summary>Firmendaten</summary><dl></dl></details><details data-legal hidden><summary>Impressum</summary><p></p></details><details data-privacy hidden><summary>Datenschutz</summary><p></p></details></div>';
 const accent=c.accent??appearanceDefaults.accent,hero=c.hero??appearanceDefaults.hero;
 root.setAttribute('data-accent',accent);root.setAttribute('data-hero',hero);
 const visual=root.querySelector('.hero-visual');
 if(hero==='none')visual.remove();
 if(hero==='abstract')visual.innerHTML='<circle cx="200" cy="150" r="133" fill="#ffffff" opacity=".07"/><rect x="72" y="70" width="234" height="160" rx="26" fill="#ffffff" opacity=".1" transform="rotate(-12 200 150)"/><rect x="96" y="78" width="234" height="160" rx="26" fill="#ffffff" opacity=".14"/><circle cx="153" cy="134" r="23" fill="#ffffff" opacity=".85"/><path d="M199 122h87m-87 20h63M128 188h158m-158 20h111" stroke="#ffffff" stroke-width="7" stroke-linecap="round" opacity=".65"/><circle cx="308" cy="227" r="35" fill="#ffffff" opacity=".9"/><path d="m292 227 11 11 21-24" fill="none" stroke="#213c59" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>';
 let disposed=false;const imageControllers=[],imageURLs=[];
 function loadImage(id,img,ready,failed){
  if(!imageRequest){failed();return;}const controller=new AbortController();imageControllers.push(controller);
  Promise.resolve().then(()=>imageRequest(id,controller.signal)).then(blob=>{
   if(disposed)return;const url=makeURL(blob);imageURLs.push(url);img.onload=()=>{if(!disposed)ready();};img.onerror=()=>{if(!disposed)failed();};img.src=url;
  }).catch(()=>{if(!disposed)failed();});
 }
 if(c.logo_image_id){
  const mark=root.querySelector('.brand-mark'),logo=doc.createElement('img');logo.className='brand-logo';logo.alt='';logo.hidden=true;mark.before(logo);
  loadImage(c.logo_image_id,logo,()=>{logo.hidden=false;mark.hidden=true;},()=>{logo.hidden=true;mark.hidden=false;});
 }
 if(hero==='image'){
  visual.remove();const host=doc.createElement('div');host.className='hero-photo';const photo=doc.createElement('img');photo.alt=c.hero_image_alt||'';photo.hidden=true;photo.decoding='async';const hint=doc.createElement('p');hint.className='small';hint.textContent='Bild wird geladen …';host.append(photo,hint);root.querySelector('.hero').append(host);
  loadImage(c.hero_image_id,photo,()=>{photo.hidden=false;hint.hidden=true;},()=>{photo.hidden=true;hint.textContent='Bild derzeit nicht verfügbar.';});
 }
 const set=(selector,text)=>{for(const el of root.querySelectorAll(selector))el.textContent=text;};
 set('[data-name]',c.name);set('[data-headline]',c.headline);set('[data-intro]',c.intro);set('[data-about-title]',c.name);set('[data-about]',c.about);root.querySelector('#ueber-uns').hidden=!c.about.trim();
 const services=root.querySelector('[data-services]');let count=0;
 for(let i=1;i<=3;i++)if(c['service_'+i+'_title'].trim()){
  count++;const article=doc.createElement('article');article.className='service';
  const icon=doc.createElement('span');icon.className='service-icon';icon.setAttribute('aria-hidden','true');icon.textContent=String(i).padStart(2,'0');
  const title=doc.createElement('h3'),text=doc.createElement('p');title.textContent=c['service_'+i+'_title'];text.textContent=c['service_'+i+'_text'];article.append(icon,title,text);services.append(article);
 }
 root.querySelector('#leistungen').hidden=!count;for(const el of root.querySelectorAll('[data-services-nav]'))el.hidden=!count;
 if(c.contact_email){const a=root.querySelector('[data-email]');a.hidden=false;a.href='mailto:'+encodeURIComponent(c.contact_email);}
 for(const [key,selector] of [['contact_phone','[data-phone]'],['contact_address','[data-address]']]){const el=root.querySelector(selector);el.textContent=c[key];el.hidden=!c[key].trim();}
 root.querySelector('[data-contact-missing]').hidden=!!(c.contact_email||c.contact_phone.trim()||c.contact_address.trim());
 for(const [key,selector] of [['legal_notice','[data-legal]'],['privacy_notice','[data-privacy]']]){const el=root.querySelector(selector);el.hidden=!c[key].trim();el.querySelector('p').textContent=c[key];}
 root.querySelector('#produkte').hidden=!catalog;root.querySelector('[data-shop-nav]').hidden=!catalog;
 if(p){
  const list=root.querySelector('.contact-list');
  for(const [label,key] of [['Ansprechperson','contact_person'],['Erreichbarkeit','opening_hours']])if(p[key]){const el=doc.createElement('p');el.className='prose';el.textContent=label+': '+p[key];list.append(el);}
  const facts=root.querySelector('[data-company-facts]'),dl=facts.querySelector('dl');
  for(const [label,value] of [['Firma',p.company_name],['Rechtsform',p.legal_form],['Branche',p.industry],['Vertretung',p.representative],['Firmensitz',companyAddress(p)],['UID / Umsatzsteuer-ID',p.vat_id],['Firmenbuch / Handelsregister',p.register_number],['Registergericht',p.register_court]])if(value){const dt=doc.createElement('dt'),dd=doc.createElement('dd');dt.textContent=label;dd.textContent=value;dl.append(dt,dd);}
  facts.hidden=false;
 }
 const view=catalog?mountShopCatalog({doc,search:'?shop='+catalog.slug,...(catalogRequest?{request:catalogRequest}:{})}):null;
 return {destroy(){disposed=true;for(const controller of imageControllers)controller.abort();for(const url of imageURLs)revokeURL(url);view?.destroy();root.replaceChildren();root.removeAttribute('data-accent');root.removeAttribute('data-hero');}};
}
