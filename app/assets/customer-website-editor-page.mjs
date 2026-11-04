import {mountCustomerWebsiteEditor} from './customer-website-editor.mjs?v=1';
import {customerWebsiteRequest,getOwnerId,watchOwner} from './customer-website-api.mjs?v=1';
const view=mountCustomerWebsiteEditor({request:customerWebsiteRequest,getOwnerId});
try{
 let owner=await getOwnerId();
 await watchOwner(next=>{if(next!==owner){owner=next;view.invalidate();if(next)view.load();}});
 await view.load();
}catch{view.invalidate();document.getElementById('status').textContent='Die Anmeldung konnte nicht geladen werden. Bitte lade die Seite erneut.';}
