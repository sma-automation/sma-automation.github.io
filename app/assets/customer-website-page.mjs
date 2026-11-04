import {readCompanyProfile} from './company-profile-model.mjs?v=1';
import {pageMode,readCustomerWebsite,readWebsiteContent} from './customer-website-model.mjs?v=2';
import {renderCustomerWebsite} from './customer-website-render.mjs?v=2';
import {publicWebsiteRequest,customerWebsiteRequest,getOwnerId,watchOwner} from './customer-website-api.mjs?v=2';
const mode=pageMode(location.search),root=document.getElementById('site'),error=document.getElementById('pageError');let view,owner;
function hide(){view?.destroy();root.hidden=true;document.getElementById('previewBanner').hidden=true;error.hidden=false;error.textContent='Diese Webseite ist derzeit nicht verfügbar.';document.title='Kundenwebseite · SMA';}
try{
 if(!mode)throw Error();
 let content,shopURL,company=null;
 if(mode.preview){
  owner=await getOwnerId();if(!owner)throw Error();
  await watchOwner(next=>{if(next!==owner){owner=null;hide();}});
  const data=readCustomerWebsite(await customerWebsiteRequest('get'));if(!data.content||!owner||owner!==await getOwnerId())throw Error();
  content=data.content;shopURL=data.shopURL;company=data.company;document.getElementById('previewBanner').hidden=false;
 }else{
  const data=await publicWebsiteRequest(mode.siteId);if(data?.ok!==true||data.site_id!==mode.siteId)throw Error();
  content=readWebsiteContent(data.content);shopURL=data.shop_url;company=data.company_profile?readCompanyProfile(data.company_profile):null;
 }
 view=renderCustomerWebsite({root,content,shopURL,company});root.hidden=false;error.hidden=true;document.title=content.name+' · Webseite';
}catch{hide();if(mode?.preview){error.textContent='Dein gespeicherter Entwurf konnte nicht geladen werden. Öffne die Webseitenbearbeitung in deinem SMA-Konto.';}}
