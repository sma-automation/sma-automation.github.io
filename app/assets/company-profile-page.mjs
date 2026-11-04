import {mountCompanyProfileEditor} from './company-profile-editor.mjs?v=1';
import {companyProfileRequest,getOwnerId,watchOwner} from './customer-website-api.mjs?v=2';
const view=mountCompanyProfileEditor({request:companyProfileRequest,getOwnerId});
try{let owner=await getOwnerId();await watchOwner(next=>{if(next!==owner){owner=next;view.invalidate();if(next)view.load();}});await view.load();}
catch{view.invalidate();document.getElementById('profileStatus').textContent='Die Anmeldung konnte nicht geladen werden. Bitte lade die Seite erneut.';}
