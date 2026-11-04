import {domainPageSearch} from './customer-website-domain-model.mjs';
import {mountCustomerWebsitePage} from './customer-website-view.mjs?v=3';

export function mountCustomerWebsiteDomain({doc=document,href=doc.defaultView.location.href,binding,publicWebsiteRequest,websiteImageRequest,renderWebsite}){
 // Never forward user query parameters to the shared private/public page controller.
 return mountCustomerWebsitePage({doc,search:domainPageSearch(href,binding),publicWebsiteRequest,websiteImageRequest,...(renderWebsite?{renderWebsite}:{})});
}
