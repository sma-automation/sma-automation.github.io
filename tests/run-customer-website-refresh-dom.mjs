import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {mountCustomerWebsitePage} from '../app/assets/customer-website-view.mjs';
import {contentLimits} from '../app/assets/customer-website-model.mjs';
import {emptyCompanyProfile,companyAddress} from '../app/assets/company-profile-model.mjs';
const html=await readFile(new URL('../app/website.html',import.meta.url),'utf8');
const id='ab770000-0000-4000-8000-000000000071';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function state(city='Wien',revision=1){
 const company={...emptyCompanyProfile(),company_name:'SHK Testbetrieb',street:'Musterstraße',house_number:'12',postal_code:'1010',city,country:'Österreich',public_email:'kontakt@example.com',contact_person:'Testteam '+city};
 const content={...Object.fromEntries(Object.keys(contentLimits).map(k=>[k,''])),name:company.company_name,headline:'Wasser. Wärme. Wohlfühlen.',about:'Gespeicherter Vorstellungstext.',contact_address:companyAddress(company),contact_email:company.public_email};
 return {ok:true,site_id:id,revision,content,company_profile:company,company_revision:revision,published:false,publicly_available:false,has_changes:true,can_edit:true,shop_url:null,website_url:'https://sma-automation.com/app/website.html?site='+id};
}
function fixture(options={}){
 const {document:doc,window}=parseHTML(html);let owner=id,callback,unsubscribe=0;
 Object.defineProperty(doc,'visibilityState',{value:'visible',writable:true});
 const calls=[];
 const view=mountCustomerWebsitePage({doc,search:'?preview=1',customerWebsiteRequest:async action=>{calls.push(action);return state();},publicWebsiteRequest:()=>{throw Error('Unexpected public request');},getOwnerId:async()=>owner,watchOwner:async cb=>{callback=cb;return {unsubscribe(){unsubscribe++;}};},...options});
 return {doc,window,view,calls,owner(value,notify=true){owner=value;if(notify)callback?.(value);},get unsubscribed(){return unsubscribe;},focus(){window.dispatchEvent(new window.Event('focus'));},visible(value='visible'){doc.visibilityState=value;doc.dispatchEvent(new window.Event('visibilitychange'));}};
}
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
await test('returning to preview updates company address and contact without changing saved website texts',async()=>{
 let saved=state(),calls=[];const f=fixture({customerWebsiteRequest:async action=>{calls.push(action);return saved;}});await f.view.load();
 assert.match(f.doc.querySelector('[data-address]').textContent,/Wien/);
 saved=state('Graz',2);f.focus();f.visible();await tick();await tick();
 assert.deepEqual(calls,['get','get'],'focus and visibility in the same turn coalesce');
 assert.match(f.doc.querySelector('[data-address]').textContent,/Graz/);assert.match(f.doc.querySelector('.contact-list').textContent,/Testteam Graz/);
 assert.equal(f.doc.querySelector('[data-headline]').textContent,saved.content.headline);assert.equal(f.doc.querySelector('[data-about]').textContent,saved.content.about);
 assert.equal(f.doc.getElementById('previewBanner').hidden,false);f.view.destroy();
});
await test('unchanged saved content preserves existing DOM and open details',async()=>{
 const f=fixture();await f.view.load();const header=f.doc.querySelector('.site-header'),details=f.doc.querySelector('[data-company-facts]');details.setAttribute('open','');
 await f.view.refresh();assert.equal(f.doc.querySelector('.site-header'),header);assert.equal(f.doc.querySelector('[data-company-facts]'),details);assert(details.hasAttribute('open'));f.view.destroy();
});
await test('a return during an in-flight read queues one latest read, never parallel requests',async()=>{
 const first=deferred();let calls=0,active=0,maxActive=0;
 const f=fixture({customerWebsiteRequest:async action=>{assert.equal(action,'get');calls++;active++;maxActive=Math.max(maxActive,active);const result=calls===1?await first.promise:state('Linz',2);active--;return result;}});
 const initial=f.view.load();await tick();f.focus();f.visible();await tick();assert.equal(calls,1);
 first.resolve(state());await initial;assert.equal(calls,2);assert.equal(maxActive,1);assert.match(f.doc.querySelector('[data-address]').textContent,/Linz/);f.view.destroy();
});
await test('account switch clears visible company data immediately and discards late responses',async()=>{
 const delayed=deferred();let calls=0;const f=fixture({customerWebsiteRequest:async()=>++calls===1?state():delayed.promise});await f.view.load();
 const pending=f.view.refresh();await tick();f.owner('different-owner');assert.equal(f.doc.getElementById('site').hidden,true);assert.equal(f.doc.getElementById('site').children.length,0);assert(!f.doc.body.textContent.includes('Musterstraße'));
 delayed.resolve(state('Old account'));await pending;f.focus();await tick();assert.equal(calls,2);assert.equal(f.doc.getElementById('site').hidden,true);f.view.destroy();
});
await test('same-owner auth notifications preserve the preview and do not request data',async()=>{
 const f=fixture();await f.view.load();const header=f.doc.querySelector('.site-header');f.owner(id);await tick();assert.equal(f.doc.querySelector('.site-header'),header);assert.equal(f.calls.length,1);f.view.destroy();
});
await test('owner checks catch missed auth events before and after a read',async()=>{
 const f=fixture();await f.view.load();f.owner('different-owner',false);await f.view.refresh();assert.equal(f.calls.length,1);assert.equal(f.doc.getElementById('site').children.length,0);f.view.destroy();
 const delayed=deferred();const g=fixture({customerWebsiteRequest:()=>delayed.promise});const pending=g.view.load();await tick();g.owner('different-owner',false);delayed.resolve(state());await pending;assert.equal(g.doc.getElementById('site').children.length,0);g.view.destroy();
});
await test('failed refresh removes stale content and retries on the next visit',async()=>{
 let fail=false;const f=fixture({customerWebsiteRequest:async()=>{if(fail)throw Error('offline');return state('Salzburg');}});await f.view.load();fail=true;await f.view.refresh();
 assert.equal(f.doc.getElementById('site').hidden,true);assert.equal(f.doc.getElementById('site').children.length,0);assert.equal(f.doc.getElementById('pageError').hidden,false);
 fail=false;f.focus();await tick();assert.equal(f.doc.getElementById('site').hidden,false);assert.match(f.doc.querySelector('[data-address]').textContent,/Salzburg/);f.view.destroy();
});
await test('server-side account rejection blocks further automatic reads',async()=>{
 let result=state(),calls=0;const f=fixture({customerWebsiteRequest:async()=>{calls++;return result;}});await f.view.load();result={ok:false,code:'ACCOUNT_CHANGED'};await f.view.refresh();
 result=state('Other customer');f.focus();await tick();assert.equal(calls,2);assert.equal(f.doc.getElementById('site').children.length,0);f.view.destroy();
});
await test('hidden tabs do not refresh; browser back/forward restoration refreshes a visible preview',async()=>{
 const f=fixture();await f.view.load();f.visible('hidden');f.focus();await tick();assert.equal(f.calls.length,1);
 f.doc.visibilityState='visible';const event=new f.window.Event('pageshow');event.persisted=true;f.window.dispatchEvent(event);await tick();assert.equal(f.calls.length,2);f.view.destroy();
});
await test('public pages request only the published projection, without private auth or refreshes',async()=>{
 const saved=state('Published city');let calls=0;
 const forbidden=()=>{throw Error('Private function called on public page');};
 const f=fixture({search:'?site='+id,publicWebsiteRequest:async siteId=>{assert.equal(siteId,id);calls++;return {ok:true,site_id:id,content:saved.content,company_profile:saved.company_profile,shop_url:null};},customerWebsiteRequest:forbidden,getOwnerId:forbidden,watchOwner:forbidden});
 await f.view.load();f.focus();f.visible();await f.view.refresh();await tick();assert.equal(calls,1);assert.equal(f.doc.getElementById('previewBanner').hidden,true);assert.match(f.doc.querySelector('[data-address]').textContent,/Published city/);f.view.destroy();
});
await test('destroy removes listeners, unsubscribes and rejects late responses',async()=>{
 const delayed=deferred();const f=fixture({customerWebsiteRequest:()=>delayed.promise});const loading=f.view.load();await tick();f.view.destroy();delayed.resolve(state());await loading;
 assert.equal(f.unsubscribed,1);assert.equal(f.doc.getElementById('site').children.length,0);f.focus();await tick();assert.equal(f.doc.getElementById('site').children.length,0);
 const subscription=deferred();let unsubscribed=0;const g=fixture({watchOwner:()=>subscription.promise});const pending=g.view.load();await tick();g.view.destroy();subscription.resolve({unsubscribe(){unsubscribed++;}});await pending;assert.equal(unsubscribed,1);assert.equal(g.calls.length,0);
});
await test('invalid routes and unavailable public pages never fall back to private data',async()=>{
 const f=fixture({search:'?preview=1&site='+id});await f.view.load();assert.equal(f.calls.length,0);assert.equal(f.doc.getElementById('site').hidden,true);f.view.destroy();
 const g=fixture({search:'?site='+id,publicWebsiteRequest:async()=>({ok:false,code:'NOT_AVAILABLE'})});await g.view.load();assert.equal(g.calls.length,0);assert.equal(g.doc.getElementById('site').hidden,true);g.view.destroy();
});
console.log(`Customer website preview refresh: ${passed} DOM scenarios passed; requests were read-only.`);
