import {readCompanyProfile} from './company-profile-model.mjs?v=1';
import {pageMode,readCustomerWebsite,readWebsiteContent} from './customer-website-model.mjs?v=4';
import {renderCustomerWebsite} from './customer-website-render.mjs?v=4';

// Private previews reload only saved data. Public pages keep their published snapshot.
export function mountCustomerWebsitePage({doc=document,search=doc.defaultView.location.search,customerWebsiteRequest,publicWebsiteRequest,getOwnerId,watchOwner,websiteImageRequest,renderWebsite=renderCustomerWebsite}){
 const win=doc.defaultView,mode=pageMode(search),root=doc.getElementById('site'),error=doc.getElementById('pageError'),banner=doc.getElementById('previewBanner');
 let view,owner,subscription,renderKey=null,started=null,running=null,queued=false,scheduled=false,ready=false,blocked=false,destroyed=false,epoch=0;
 const previewError='Dein gespeicherter Entwurf konnte nicht geladen werden. Wechsle erneut zu dieser Vorschau oder öffne die Webseitenbearbeitung in deinem SMA-Konto.';
 const authError='Deine Anmeldung hat sich geändert. Öffne die Vorschau erneut über dein SMA-Konto.';
 function clear(message){
  view?.destroy();view=null;renderKey=null;root.replaceChildren();root.hidden=true;banner.hidden=true;
  root.setAttribute('aria-busy','false');error.hidden=false;error.textContent=message;doc.title='Kundenwebseite · SMA';
 }
 function invalidate(){blocked=true;epoch++;queued=false;clear(authError);}
 function show(content,company,shopURL){
  // An unchanged response must preserve the catalog page, scroll and open details.
  const nextKey=JSON.stringify({content,company,shopURL});
  if(renderKey!==nextKey){view?.destroy();view=renderWebsite({root,content,company,shopURL,...(websiteImageRequest?{imageRequest:(id,signal)=>websiteImageRequest(id,mode.preview?null:mode.siteId,signal)}:{})});renderKey=nextKey;}
  root.hidden=false;error.hidden=true;banner.hidden=!mode.preview;doc.title=content.name+' · Webseite';
 }
 async function readPreview(){
  const version=epoch;
  root.setAttribute('aria-busy','true');
  try{
   const current=await getOwnerId();
   if(destroyed||blocked||version!==epoch)return;
   if(!current||current!==owner){invalidate();return;}
   const raw=await customerWebsiteRequest('get');
   if(destroyed||blocked||version!==epoch)return;
   const after=await getOwnerId();
   if(destroyed||blocked||version!==epoch)return;
   if(after!==owner){invalidate();return;}
   const data=readCustomerWebsite(raw);if(!data.content)throw Error('NO_DRAFT');
   show(data.content,data.company,data.shopURL);
  }catch(e){
   if(destroyed||blocked||version!==epoch)return;
   if(['AUTH_REQUIRED','ACCOUNT_CHANGED','ACCOUNT_UNAVAILABLE'].includes(e.code))invalidate();
   else clear(previewError);
  }finally{if(!destroyed&&version===epoch)root.setAttribute('aria-busy','false');}
 }
 function refresh(){
  if(!ready||destroyed||blocked||!mode?.preview)return Promise.resolve();
  if(running){queued=true;return running;}
  // One trailing read covers a profile save made while a previous read was pending.
  running=(async()=>{do{queued=false;await readPreview();}while(queued&&!destroyed&&!blocked);})().finally(()=>{running=null;});
  return running;
 }
 function schedule(){
  if(scheduled||!ready||destroyed||blocked||doc.visibilityState==='hidden')return;
  scheduled=true;queueMicrotask(()=>{scheduled=false;refresh();});
 }
 const visibility=()=>{if(doc.visibilityState==='visible')schedule();};
 const pageshow=event=>{if(event.persisted)schedule();};
 async function start(){
  if(destroyed)return;
  if(!mode){clear('Diese Webseite ist derzeit nicht verfügbar.');return;}
  if(!mode.preview){
   try{
    const data=await publicWebsiteRequest(mode.siteId);if(destroyed)return;
    if(data?.ok!==true||data.site_id!==mode.siteId)throw Error('NOT_AVAILABLE');
    show(readWebsiteContent(data.content),data.company_profile?readCompanyProfile(data.company_profile):null,data.shop_url);
   }catch{if(!destroyed)clear('Diese Webseite ist derzeit nicht verfügbar.');}
   return;
  }
  try{
   owner=await getOwnerId();if(destroyed)return;if(!owner){invalidate();return;}
   // Keep the auth callback synchronous; no Supabase call is made inside it.
   subscription=await watchOwner(next=>{if(!destroyed&&next!==owner)invalidate();});
   if(destroyed){subscription?.unsubscribe();return;}if(blocked)return;
   ready=true;win.addEventListener('focus',schedule);doc.addEventListener('visibilitychange',visibility);win.addEventListener('pageshow',pageshow);
   await refresh();
  }catch{if(!destroyed&&!blocked){invalidate();}}
 }
 return {
  load(){return started||(started=start());},refresh,
  destroy(){destroyed=true;epoch++;queued=false;ready=false;subscription?.unsubscribe();win.removeEventListener('focus',schedule);doc.removeEventListener('visibilitychange',visibility);win.removeEventListener('pageshow',pageshow);clear('Diese Webseite ist derzeit nicht verfügbar.');}
 };
}
