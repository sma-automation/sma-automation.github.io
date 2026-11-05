import assert from 'node:assert/strict';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {mountWebsitePreparation} from '../app/assets/website-domain.mjs';
import {mountCustomerWebsiteDashboard} from '../app/assets/customer-website-dashboard.mjs';
import {contentLimits,websiteURL} from '../app/assets/customer-website-model.mjs';
const id='ab660000-0000-4000-8000-000000000061',tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const state=(extra={})=>({ok:true,site_id:id,revision:1,content:{...Object.fromEntries(Object.keys(contentLimits).map(k=>[k,''])),name:'Fixture',headline:'Fixture'},published:false,publicly_available:false,has_changes:true,can_edit:true,shop_url:null,website_url:websiteURL(id),custom_domain:{site_id:id,hostname:'test.sma-automation.com',verified_at:'2026-11-05T13:16:59Z'},...extra});
function fixture({active=true,request,getOwnerId,watchOwner}={}){
 const {document:doc,window}=parseHTML('<html><head></head><body><section id="page-website" class="'+(active?'active':'')+'"><div class="package-module-slot"></div></section></body></html>');
 Object.defineProperty(doc,'visibilityState',{value:'visible',writable:true});window.HTMLElement.prototype.scrollIntoView=function(){};
 Object.defineProperty(window.HTMLInputElement.prototype,'checked',{configurable:true,get(){return this.hasAttribute('checked');},set(value){if(value){for(const radio of doc.querySelectorAll('input[type="radio"]'))if(radio.name===this.name)radio.removeAttribute('checked');this.setAttribute('checked','');}else this.removeAttribute('checked');}});
 const page=doc.querySelector('#page-website');let owner=id,callback,unsubscribed=0;
 const prep=mountWebsitePreparation({page,stylesheetUrl:'/test.css',getOwnerId:async()=>owner,request:async()=>({ok:true,state:'preparation',can_publish:false,revision:0,shop_url:null,draft:null})});
 const calls=[];
 const view=mountCustomerWebsiteDashboard({page,expectedOwnerId:id,ownerWindow:window,getOwnerId:getOwnerId||(async()=>owner),watchOwner:watchOwner||(cb=>{callback=cb;return {unsubscribe(){unsubscribed++;}};}),request:async(action,input)=>{calls.push({action,input});return request?request():state();}});
 return {doc,page,window,calls,view,$:selector=>page.querySelector(selector),owner(value,notify=true){owner=value;if(notify)callback?.(value);},focus(){window.dispatchEvent(new window.Event('focus'));},visibility(value){doc.visibilityState=value;doc.dispatchEvent(new window.Event('visibilitychange'));},get unsubscribed(){return unsubscribed;},destroy(){view.destroy();prep.destroy();}};
}
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
await test('private existing site is directly accessible without changing the preparation or publishing',async()=>{
 const f=fixture();await tick();await tick();assert.equal(f.$('[data-website-overview] strong').textContent,'Webseite verwalten');assert.equal(f.$('[data-website-overview]').children.length,3);f.$('[data-website-open="website"]').click();
 assert.match(f.$('[data-site-state]').textContent,/Privater Entwurf/);assert.match(f.$('[data-site-address]').textContent,/test.sma-automation.com/);assert.equal(f.$('[data-site-edit]').href,'https://sma-automation.com/app/website-builder.html');assert.equal(f.$('[data-site-preview]').href,'https://sma-automation.com/app/website.html?preview=1');assert.equal(f.$('[data-site-public]').getAttribute('href'),null);assert.equal(f.$('[name="website_url"]').value,'');
 assert.deepEqual(f.calls,[{action:'get',input:{}}]);f.destroy();
});
await test('published site opens its confirmed address; absent mapping uses canonical address',async()=>{
 let result=state({published:true,publicly_available:true});const f=fixture({request:()=>result});await tick();assert.equal(f.$('[data-site-public]').href,'https://test.sma-automation.com/');assert.equal(f.$('[data-site-public]').hidden,false);assert.match(f.$('[data-site-state]').textContent,/unveröffentlichte/);
 result=state({published:true,publicly_available:true,has_changes:false,custom_domain:null});f.focus();await tick();assert.equal(f.$('[data-site-public]').href,websiteURL(id));assert.doesNotMatch(f.$('[data-site-state]').textContent,/unveröffentlichte/);f.destroy();
});
await test('new account keeps setup choices; inactive access has no public link',async()=>{
 let result=state({revision:0,site_id:null,content:null,custom_domain:null,website_url:null});const f=fixture({request:()=>result});await tick();assert.equal(f.$('.sma-website-site-summary').hidden,true);assert.equal(f.$('[data-website-overview] strong').textContent,'Webseite einrichten');
 result=state({can_edit:false,custom_domain:null});f.focus();await tick();assert.match(f.$('[data-site-state]').textContent,/Zugang.*nicht aktiv/);assert.equal(f.$('[data-site-public]').hidden,true);f.destroy();
});
await test('hidden module makes no reads; opening and returning refreshes only this summary',async()=>{
 const f=fixture({active:false});await tick();assert.equal(f.calls.length,0);f.page.classList.add('active');await tick();await tick();assert.equal(f.calls.length,1);
 f.$('[name="desired_domain"]').value='unsaved.example.com';f.$('[name="desired_domain"]').dispatchEvent(new f.window.Event('input',{bubbles:true}));f.focus();f.visibility('visible');await tick();assert.equal(f.calls.length,2);assert.equal(f.$('[name="desired_domain"]').value,'unsaved.example.com');
 f.page.classList.remove('active');await tick();f.focus();await tick();assert.equal(f.calls.length,2);assert.equal(f.$('[data-site-address]').textContent,'');f.page.classList.add('active');await tick();assert.equal(f.calls.length,3);f.destroy();
});
await test('in-flight refreshes are serialized and coalesced into one subsequent read',async()=>{
 const first=deferred();let n=0,active=0,max=0;const f=fixture({request:async()=>{active++;max=Math.max(max,active);const r=++n===1?await first.promise:state({published:true,publicly_available:true});active--;return r;}});await tick();f.focus();f.visibility('visible');await tick();assert.equal(f.calls.length,1);first.resolve(state());await tick();await tick();assert.equal(f.calls.length,2);assert.equal(max,1);assert.equal(f.$('[data-site-public]').hidden,false);f.destroy();
});
await test('account event clears immediately and rejects late former-owner results',async()=>{
 let result=state();const f=fixture({request:()=>result});await tick();const gate=deferred();result=gate.promise;f.focus();await tick();f.owner('other');assert.equal(f.$('[data-site-address]').textContent,'');assert.equal(f.$('[data-site-edit]').getAttribute('href'),null);gate.resolve(state());await tick();assert.equal(f.$('[data-site-address]').textContent,'');f.focus();await tick();assert.equal(f.calls.length,2);f.destroy();
});
await test('missed owner events are checked both before and after the read',async()=>{
 const f=fixture();await tick();f.owner('other',false);f.focus();await tick();assert.equal(f.calls.length,1);assert.equal(f.$('[data-site-address]').textContent,'');f.destroy();
 const gate=deferred(),g=fixture({request:()=>gate.promise});await tick();g.owner('other',false);gate.resolve(state());await tick();assert.equal(g.$('[data-site-address]').textContent,'');g.destroy();
});
await test('hidden tab clears stale links and does not render late results',async()=>{
 const gate=deferred();let n=0;const f=fixture({request:()=>++n===1?gate.promise:state()});await tick();f.visibility('hidden');gate.resolve(state());await tick();assert.equal(f.$('[data-site-address]').textContent,'');f.focus();await tick();assert.equal(n,1);f.visibility('visible');await tick();assert.equal(n,2);assert.match(f.$('[data-site-address]').textContent,/test.sma-automation.com/);f.destroy();
});
await test('network or invalid response clears old links and supports explicit retry',async()=>{
 let result=state();const f=fixture({request:()=>{if(result instanceof Error)throw result;return result;}});await tick();result=Error('offline');f.focus();await tick();assert.equal(f.$('[data-site-address]').textContent,'');assert.equal(f.$('[data-site-retry]').hidden,false);result=state({custom_domain:{site_id:id,hostname:'evil.com/path',verified_at:'2026-11-05'}});f.$('[data-site-retry]').click();await tick();assert.equal(f.$('[data-site-edit]').getAttribute('href'),null);result=state();f.$('[data-site-retry]').click();await tick();assert.equal(f.$('[data-site-retry]').hidden,true);f.destroy();
});
await test('destroy removes listeners and clears late subscriptions and data',async()=>{
 const gate=deferred(),subscription=deferred();let unsubscribed=0;const f=fixture({request:()=>gate.promise,watchOwner:()=>subscription.promise});await tick();f.view.destroy();subscription.resolve({unsubscribe(){unsubscribed++;}});gate.resolve(state());await tick();assert.equal(unsubscribed,1);assert.equal(f.$('.sma-website-site-summary'),null);f.focus();await tick();assert.equal(f.calls.length,1);f.destroy();
});
await test('leaving during owner check and returning still loads the newest state once',async()=>{
 const gate=deferred();let n=0;const f=fixture({getOwnerId:()=>++n===1?gate.promise:Promise.resolve(id)});await tick();f.page.classList.remove('active');await tick();f.page.classList.add('active');await tick();gate.resolve(id);await tick();await tick();assert.equal(f.calls.length,1);assert.match(f.$('[data-site-address]').textContent,/test.sma-automation.com/);f.destroy();
});
console.log(`Customer website dashboard: ${passed} DOM scenarios passed; existing preparation preserved; owner reads only.`);
