import {binding} from './binding.mjs';
import {mountCustomerWebsiteDomain} from './assets/customer-website-domain-view.mjs';
import {publicWebsiteRequest,websiteImageRequest} from './assets/customer-website-public-api.mjs';
const page=mountCustomerWebsiteDomain({binding,publicWebsiteRequest,websiteImageRequest});
await page.load();
window.addEventListener('pagehide',event=>{if(!event.persisted)page.destroy();});
// A restored public page must re-check its published snapshot, not reuse BFCache content.
window.addEventListener('pageshow',event=>{if(event.persisted)window.location.reload();});
