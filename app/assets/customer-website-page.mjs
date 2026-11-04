import {mountCustomerWebsitePage} from './customer-website-view.mjs?v=3';
import {publicWebsiteRequest,customerWebsiteRequest,getOwnerId,watchOwner,websiteImageRequest} from './customer-website-api.mjs?v=3';
const page=mountCustomerWebsitePage({publicWebsiteRequest,customerWebsiteRequest,getOwnerId,watchOwner,websiteImageRequest});
await page.load();
window.addEventListener('pagehide',event=>{if(!event.persisted)page.destroy();});
