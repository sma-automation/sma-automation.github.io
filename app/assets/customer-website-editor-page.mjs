import {mountCustomerWebsiteEditor} from './customer-website-editor.mjs?v=4';
import {customerWebsiteRequest,getOwnerId,watchOwner,uploadWebsiteImage,websiteImageRequest} from './customer-website-api.mjs?v=3';
const view=mountCustomerWebsiteEditor({request:customerWebsiteRequest,getOwnerId,uploadImage:uploadWebsiteImage,imageRequest:websiteImageRequest});
try{
 let owner=await getOwnerId();
 await watchOwner(next=>{if(next!==owner){owner=next;view.invalidate();if(next)view.load();}});
 await view.load();
}catch{view.invalidate();document.getElementById('status').textContent='Die Anmeldung konnte nicht geladen werden. Bitte lade die Seite erneut.';}

window.addEventListener('focus',()=>view.refresh());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')view.refresh();});
