import {readCustomerWebsite} from './customer-website-model.mjs?v=5';

// Read-only owner summary. Creating, saving and publishing stay in the editor.
export function mountCustomerWebsiteDashboard({page,request,getOwnerId,expectedOwnerId,watchOwner,ownerWindow=page.ownerDocument.defaultView}){
 const doc=page.ownerDocument,root=page.querySelector('#smaWebsitePreparation');
 const target=root?.querySelector('[data-website-view="website"]'),entry=root?.querySelector('[data-website-overview] [data-website-open="website"]');
 if(!target||!entry||!expectedOwnerId)return {destroy(){}};
 const title=entry.querySelector('strong'),description=title.nextElementSibling,originalTitle=title.textContent,originalDescription=description.textContent;
 const panel=doc.createElement('section');panel.className='sma-website-site-summary';panel.hidden=true;panel.setAttribute('aria-label','Deine SMA-Webseite');
 panel.innerHTML='<h3>Deine SMA-Webseite</h3><p data-site-state role="status" aria-live="polite"></p><p data-site-address class="sma-website-help" hidden></p><div data-site-actions class="sma-website-actions" hidden><a data-site-edit target="_top" class="sma-website-primary">Webseite bearbeiten</a><a data-site-preview target="_blank" rel="noopener noreferrer">Private Vorschau</a><a data-site-public target="_blank" rel="noopener noreferrer" hidden>Öffentliche Webseite öffnen</a></div><button type="button" data-site-retry hidden>Status erneut laden</button>';
 target.insertBefore(panel,target.querySelector('[data-company-profile-dashboard]'));
 const $=selector=>panel.querySelector(selector);
 let disposed=false,blocked=false,generation=0,running=null,queued=false,scheduled=false,subscription;
 const active=()=>page.classList.contains('active')&&!page.hidden&&ownerWindow.document.visibilityState!=='hidden';
 let wasActive=active();
 function clear(message=''){
  title.textContent=originalTitle;description.textContent=originalDescription;
  $('[data-site-state]').textContent=message;$('[data-site-address]').textContent='';$('[data-site-address]').hidden=true;
  $('[data-site-actions]').hidden=true;$('[data-site-public]').hidden=true;$('[data-site-retry]').hidden=true;
  for(const link of panel.querySelectorAll('a'))link.removeAttribute('href');panel.hidden=!message;
 }
 function invalidate(){blocked=true;generation++;queued=false;clear('Bitte öffne das Dashboard erneut, um deinen Webseitenstand zu laden.');}
 function show(state){
  if(!state.content){clear();return;}
  const status=!state.canEdit?'Derzeit offline: Dein Delta-Zugang ist nicht aktiv.':state.publiclyAvailable?(state.hasChanges?'Online. Im Entwurf gibt es noch unveröffentlichte Änderungen.':'Online. Der gespeicherte Stand ist veröffentlicht.'):'Privater Entwurf. Deine Webseite ist nur für dich sichtbar.';
  clear(status);title.textContent='Webseite verwalten';description.textContent=(!state.canEdit?'Zugang derzeit inaktiv':state.publiclyAvailable?'Online'+(state.hasChanges?' · Unveröffentlichte Änderungen':''):'Privater Entwurf')+(state.customDomain?' · Eigene Adresse eingerichtet':'');
  $('[data-site-address]').textContent=(state.customDomain?'Eigene Adresse: ':'SMA-Adresse: ')+(state.customDomain?.url||state.websiteURL);$('[data-site-address]').hidden=false;
  $('[data-site-edit]').href='https://sma-automation.com/app/website-builder.html';$('[data-site-preview]').href='https://sma-automation.com/app/website.html?preview=1';$('[data-site-actions]').hidden=false;
  if(state.publiclyAvailable&&state.canEdit){$('[data-site-public]').href=state.customDomain?.url||state.websiteURL;$('[data-site-public]').hidden=false;}
 }
 async function load(){
  if(disposed||blocked||!active())return;
  if(running){queued=true;return running;}
  running=(async()=>{
   do{
    queued=false;const version=generation;clear('Webseitenstand wird geladen …');
    try{
     if(await getOwnerId()!==expectedOwnerId)throw Object.assign(Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED'});
     if(disposed||blocked||version!==generation||!active())continue;
     const raw=await request('get',{});
     if(disposed||blocked||version!==generation||!active())continue;
     if(await getOwnerId()!==expectedOwnerId)throw Object.assign(Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED'});
     if(disposed||blocked||version!==generation||!active())continue;
     show(readCustomerWebsite(raw));
    }catch(error){
     if(disposed||version!==generation)continue;
     if(['AUTH_REQUIRED','ACCOUNT_CHANGED','ACCOUNT_UNAVAILABLE'].includes(error.code)){invalidate();break;}
     clear('Dein Webseitenstand konnte nicht geladen werden.');$('[data-site-retry]').hidden=false;
    }
   }while(queued&&!disposed&&!blocked&&active());
  })().finally(()=>{running=null;});return running;
 }
 function schedule(){if(scheduled||disposed||blocked||!active())return;scheduled=true;queueMicrotask(()=>{scheduled=false;if(!disposed)load();});}
 const visibility=()=>{if(active())schedule();else{generation++;queued=false;clear();}};
 const observer=new doc.defaultView.MutationObserver(()=>{const now=active();if(now!==wasActive){wasActive=now;visibility();}});
 observer.observe(page,{attributes:true,attributeFilter:['class','hidden']});
 ownerWindow.addEventListener('focus',schedule);ownerWindow.document.addEventListener('visibilitychange',visibility);
 const restored=event=>{if(event.persisted)schedule();};ownerWindow.addEventListener('pageshow',restored);
 $('[data-site-retry]').onclick=schedule;
 if(watchOwner)Promise.resolve().then(()=>disposed?null:watchOwner(owner=>{if(owner!==expectedOwnerId&&!disposed)invalidate();})).then(value=>{if(disposed)value?.unsubscribe();else subscription=value;}).catch(()=>{if(!disposed)invalidate();});
 schedule();
 return {destroy(){disposed=true;generation++;queued=false;subscription?.unsubscribe();observer.disconnect();ownerWindow.removeEventListener('focus',schedule);ownerWindow.document.removeEventListener('visibilitychange',visibility);ownerWindow.removeEventListener('pageshow',restored);clear();panel.remove();}};
}
