import {mountCustomerWebsitePage} from './customer-website-view.mjs?v=1';
import {publicWebsiteRequest,customerWebsiteRequest,getOwnerId,watchOwner} from './customer-website-api.mjs?v=2';
const page=mountCustomerWebsitePage({publicWebsiteRequest,customerWebsiteRequest,getOwnerId,watchOwner});
await page.load();
window.addEventListener('pagehide',event=>{if(!event.persisted)page.destroy();});
