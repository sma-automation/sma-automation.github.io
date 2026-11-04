import {createCustomerWebsiteClient,contentLimits} from './customer-website-model.mjs?v=2';
const messages={COMPANY_PROFILE_CHANGED:'Die Firmendaten wurden inzwischen geändert. Lade den gespeicherten Stand, damit die aktuellen Angaben übernommen werden.',AUTH_REQUIRED:'Bitte melde dich bei SMA an.',ACCOUNT_CHANGED:'Die Kontozuordnung hat sich geändert. Bitte lade das Dashboard neu.',ACCOUNT_UNAVAILABLE:'Dein SMA-Konto konnte nicht zugeordnet werden.',ACCESS_INACTIVE:'Die Webseitenbearbeitung benötigt einen aktiven Delta-Zugang.',INVALID_CONTENT:'Prüfe die Pflichtfelder, Textlängen und die Kontakt-E-Mail.',REVISION_CONFLICT:'Die Webseite wurde inzwischen geändert. Lade den gespeicherten Stand, bevor du weiterarbeitest.',REQUEST_CONFLICT:'Dieser Speicherversuch gehört zu anderen Angaben. Lade den gespeicherten Stand.',ALREADY_CREATED:'Deine Webseite wurde bereits erzeugt. Lade den gespeicherten Stand.'};
export function mountCustomerWebsiteEditor({doc=document,request,getOwnerId,uuid}){
 const $=id=>doc.getElementById(id),client=createCustomerWebsiteClient({request,getOwnerId,uuid});let state=null,busy=false,dirty=false,destroyed=false,epoch=0;
 function controls(){
  $('fields').disabled=busy||!state?.canEdit;$('generate').disabled=busy||!state?.canEdit;$('save').disabled=busy||!state?.canEdit;
  $('publish').disabled=busy||dirty||!state?.canEdit||!state?.content||state.published&&!state.hasChanges;
  $('unpublish').disabled=busy||dirty||!state?.published;$('reload').disabled=busy;$('retry').disabled=busy;
  $('dirtyHint').hidden=!dirty;doc.querySelector('main').setAttribute('aria-busy',String(busy));
 }
 function show(s){
  state=s;dirty=false;$('login').hidden=true;$('retry').hidden=true;$('create').hidden=!!s.content;$('editor').hidden=!s.content;
  $('badge').textContent=s.publiclyAvailable?'Online':s.content?'Entwurf':'Noch keine Seite';
  $('companyBinding').textContent=s.company?'Firmenname, Firmensitz und Kontaktdaten werden automatisch aus deinem Firmenprofil übernommen.':'Firmenname, Firmensitz und Kontaktdaten einmal zentral erfassen.';
  for(const key of ['name','contact_email','contact_phone','contact_address'])doc.querySelector('[name="'+key+'"]').readOnly=!!s.company;
  if(s.content){
   for(const key of Object.keys(contentLimits))doc.querySelector('[name="'+key+'"]').value=s.content[key];
   $('shopStatus').textContent=s.shopURL?'Dein SMA-Shop ist automatisch zugeordnet.':'Sobald dein SMA-Shop öffentlich freigeschaltet ist, erscheint hier seine Produktliste.';
   $('publicLink').hidden=!s.publiclyAvailable;$('publicLink').removeAttribute('href');if(s.publiclyAvailable)$('publicLink').href=s.websiteURL;
   $('unpublish').hidden=!s.published;$('publish').textContent=s.published?'Öffentliche Webseite aktualisieren':'Webseite veröffentlichen';
   $('visibility').textContent=!s.canEdit?'Deine Seite ist wegen des derzeitigen Zugangs nicht öffentlich erreichbar.':s.published?(s.hasChanges?'Deine Seite ist online. Im Entwurf gibt es noch nicht veröffentlichte Änderungen.':'Deine Seite ist online und auf dem gespeicherten Stand.'):'Dein Entwurf ist nur für dich sichtbar.';
  }
  $('status').textContent=s.canEdit?'Bereit.':messages.ACCESS_INACTIVE;controls();
 }
 function clear(){client.invalidate();state=null;dirty=false;$('companyBinding').textContent='Firmendaten sind nach deiner Anmeldung verfügbar.';$('create').hidden=true;$('editor').hidden=true;$('publicLink').removeAttribute('href');for(const input of doc.querySelectorAll('input,textarea'))input.value='';controls();}
 async function run(fn,message){if(busy||destroyed)return;busy=true;const version=epoch;controls();$('status').textContent=message;
  try{const s=await fn();if(destroyed||version!==epoch)return;show(s);}
  catch(e){if(destroyed||version!==epoch)return;$('status').textContent=messages[e.code]||'Die Webseite ist gerade nicht erreichbar. Deine Eingaben bleiben stehen; versuche es erneut.';$('retry').hidden=false;
   if(['AUTH_REQUIRED','ACCOUNT_CHANGED','ACCOUNT_UNAVAILABLE'].includes(e.code)){clear();$('login').hidden=e.code!=='AUTH_REQUIRED';}}
  finally{busy=false;if(!destroyed)controls();}
 }
 const load=()=>run(()=>client.load(),'Webseite wird geladen …');
 $('generate').onclick=()=>run(()=>client.generate(),'Deine Webseite wird erzeugt …');
 $('contentForm').onsubmit=event=>{event.preventDefault();const content=Object.fromEntries(Object.keys(contentLimits).map(key=>[key,doc.querySelector('[name="'+key+'"]').value]));run(()=>client.save(content),'Änderungen werden gespeichert …');};
 $('contentForm').oninput=()=>{dirty=true;controls();};
 $('publish').onclick=()=>{if(!dirty)run(()=>client.publish(),'Deine gespeicherte Webseite wird veröffentlicht …');};
 $('unpublish').onclick=()=>{if(!dirty)run(()=>client.unpublish(),'Deine Webseite wird offline genommen …');};
 // Reloading is an explicit discard only when there are unsaved edits.
 $('reload').onclick=$('retry').onclick=()=>{if(!dirty||doc.defaultView.confirm('Ungespeicherte Änderungen verwerfen und gespeicherten Stand laden?'))load();};
 const beforeUnload=e=>{if(dirty){e.preventDefault();e.returnValue='';}};doc.defaultView.addEventListener('beforeunload',beforeUnload);
 return {load,refresh(){if(!dirty)return load();},invalidate(){epoch++;clear();$('status').textContent=messages.AUTH_REQUIRED;$('login').hidden=false;$('retry').hidden=false;},destroy(){destroyed=true;epoch++;clear();doc.defaultView.removeEventListener('beforeunload',beforeUnload);}};
}
