import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {mountCustomerWebsiteDomain} from '../app/assets/customer-website-domain-view.mjs';
import {renderCustomerWebsite} from '../app/assets/customer-website-render.mjs';
import {contentLimits} from '../app/assets/customer-website-model.mjs';
import {emptyCompanyProfile} from '../app/assets/company-profile-model.mjs';
const html=await readFile(new URL('../hosting/customer-website/index.html',import.meta.url),'utf8');
const site='ab990000-0000-4000-8000-000000000071',image='ab990000-0000-4000-8000-000000000072',origin='https://test.sma-automation.com';
const content={...Object.fromEntries(Object.keys(contentLimits).map(key=>[key,''])),name:'SHK-Testbetrieb – fiktiv',headline:'Sanitär, Heizung und Klima',contact_email:'kontakt@example.com',contact_address:'Musterstraße 12\n0000 Musterort',service_1_title:'Sanitär',service_1_text:'Testbeschreibung',accent:'blue',hero:'shk'};
const company={...emptyCompanyProfile(),company_name:content.name,city:'Musterort'};
const state=()=>({ok:true,site_id:site,content:{...content},company_profile:{...company},shop_url:null});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({href=origin+'/',response=state(),request,imageRequest,renderWebsite}={}){
 const {document:doc}=parseHTML(html),calls=[];
 const page=mountCustomerWebsiteDomain({doc,href,binding:{origin,siteId:site},publicWebsiteRequest:async id=>{calls.push(id);return request?request(id):response;},websiteImageRequest:imageRequest,...(renderWebsite?{renderWebsite}:{})});
 return {doc,page,calls};
}
let passed=0;async function test(name,run){await run();passed++;console.log('PASS '+name);}
await test('root renders the assigned published company using the existing design',async()=>{
 const f=fixture();await f.page.load();assert.deepEqual(f.calls,[site]);assert.equal(f.doc.getElementById('site').hidden,false);assert.equal(f.doc.getElementById('site').getAttribute('data-accent'),'blue');assert.equal(f.doc.querySelector('[data-headline]').textContent,content.headline);assert.match(f.doc.querySelector('[data-company-facts]').textContent,/Musterort/);assert.equal(f.doc.getElementById('previewBanner').hidden,true);assert(!f.doc.querySelector('a[href*="builder"]'));f.page.destroy();
});
await test('foreign hosts, user site IDs and private previews make no requests',async()=>{
 for(const href of ['https://unassigned.pages.dev/',origin+'/?preview=1',origin+'/?site='+image,origin+'/app/website.html',origin+'/?site='+site]){const f=fixture({href});await f.page.load();assert.equal(f.calls.length,0);assert.equal(f.doc.getElementById('site').hidden,true);assert.match(f.doc.getElementById('pageError').textContent,/nicht verfügbar/);f.page.destroy();}
});
await test('offline, mismatched site and malformed snapshots stay hidden',async()=>{
 for(const response of [{ok:false,code:'NOT_AVAILABLE'},{...state(),site_id:image},{...state(),content:{name:'untrusted'}},{...state(),company_profile:{company_name:'broken'}}]){const f=fixture({response});await f.page.load();assert.equal(f.doc.getElementById('site').hidden,true);assert.equal(f.doc.getElementById('site').children.length,0);assert(!f.doc.body.textContent.includes(content.name));f.page.destroy();}
});
await test('network failure uses the existing unavailable message',async()=>{
 const f=fixture({request:async()=>{throw Error('network detail');}});await f.page.load();assert.equal(f.doc.getElementById('site').hidden,true);assert(!f.doc.body.textContent.includes('network detail'));f.page.destroy();
});
await test('logo and hero reads use only the assigned public site, with working image fallbacks',async()=>{
 const calls=[],revoked=[],response=state();response.content={...content,hero:'image',logo_image_id:image,hero_image_id:image,hero_image_alt:'Fiktives Testmotiv'};
 const f=fixture({response,imageRequest:async(id,siteId)=>{calls.push({id,siteId});return new Blob(['fixture'],{type:'image/png'});},renderWebsite:options=>renderCustomerWebsite({...options,makeURL:()=> 'blob:fixture',revokeURL:url=>revoked.push(url)})});await f.page.load();await tick();
 assert.deepEqual(calls,[{id:image,siteId:site},{id:image,siteId:site}]);for(const img of f.doc.querySelectorAll('img'))img.onload();assert.equal(f.doc.querySelector('.brand-logo').hidden,false);assert.equal(f.doc.querySelector('.hero-photo img').hidden,false);assert.equal(f.doc.querySelector('.hero-photo img').alt,'Fiktives Testmotiv');f.page.destroy();assert.equal(revoked.length,2);
 const g=fixture({response,imageRequest:async()=>{throw Error('IMAGE_UNAVAILABLE');}});await g.page.load();await tick();assert.equal(g.doc.querySelector('.brand-logo').hidden,true);assert.equal(g.doc.querySelector('.brand-mark').hidden,false);assert.match(g.doc.querySelector('.hero-photo').textContent,/Bild derzeit nicht verfügbar/);g.page.destroy();
});
await test('products load from the existing assigned shop without a checkout operation',async()=>{
 const response={...state(),shop_url:'https://sma-automation.com/app/shop.html?shop=sma-testkunde'},calls=[];
 const f=fixture({response,renderWebsite:options=>renderCustomerWebsite({...options,catalogRequest:async input=>{calls.push(input);return {name:'Testshop',page:1,total:1,pages:1,products:[{id:'fixture',title:'Testprodukt',price:25,currency:'EUR',stock:2,ready:true,image:null}]};}})});await f.page.load();await tick();assert.equal(calls[0].slug,'sma-testkunde');assert.match(f.doc.getElementById('products').textContent,/Testprodukt/);assert.equal(f.doc.getElementById('shopOpen').href,response.shop_url);f.page.destroy();
});
await test('a late public response cannot revive an unloaded page',async()=>{
 let resolve;const response=new Promise(r=>resolve=r),f=fixture({request:()=>response});const pending=f.page.load();f.page.destroy();resolve(state());await pending;assert.equal(f.doc.getElementById('site').hidden,true);assert.equal(f.doc.getElementById('site').children.length,0);
});
await test('a fresh visit after offline transition cannot reuse the earlier published page',async()=>{
 const online=fixture();await online.page.load();assert.equal(online.doc.getElementById('site').hidden,false);online.page.destroy();const offline=fixture({response:{ok:false,code:'NOT_AVAILABLE'}});await offline.page.load();assert.equal(offline.doc.getElementById('site').hidden,true);offline.page.destroy();
});
console.log(`Customer website domain: ${passed} DOM scenarios passed.`);
