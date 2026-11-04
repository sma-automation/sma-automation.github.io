import assert from 'node:assert/strict';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {mountDomainVerification} from '../app/assets/domain-verification.mjs';
import {mountWebsitePreparation} from '../app/assets/website-domain.mjs';
const token='sma-verification='+'a'.repeat(64),owner='fa730000-0000-4000-8000-000000000001',tick=()=>new Promise(r=>setImmediate(r));
const saved=(mode='new',domain='example.com',revision=1)=>({ok:true,state:'preparation',can_publish:false,revision,shop_url:null,draft:{mode,website_url:mode==='existing'?'https://external.example.org/path':'',desired_domain:domain}});
const proof=(hostname='example.com',revision=1,state='pending')=>({ok:true,hostname,revision,state,record_name:'_sma-verification.'+hostname,record_type:'TXT',record_value:token,last_result:state==='verified'?'found':'pending',verified_at:state==='verified'?'2026-11-04T18:00:00Z':null});
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
let passed=0;const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
function fixture(options={}){
 const {document:doc}=parseHTML('<html><body><main></main></body></html>'),root=doc.querySelector('main'),calls=[];let state='unprepared',uid=owner;
 const view=mountDomainVerification({root,asPanel:true,getOwnerId:options.getOwnerId||(async()=>uid),request:options.request||(async action=>{calls.push(action);if(action==='prepare')state='pending';if(action==='verify')state='verified';return proof('example.com',1,state);})});
 return {doc,root,view,calls,set uid(value){uid=value;}};
}
await test('new-site domain loads without preparing or checking DNS automatically',async()=>{
 const f=fixture();f.view.setDraft(saved());await tick();assert.deepEqual(f.calls,['get']);assert.match(f.root.textContent,/Domain nachweisen, die dir bereits gehört/);assert.match(f.root.textContent,/Verknüpfung.*noch nicht eingerichtet/);assert.equal(f.root.querySelector('[data-domain-prepare]').disabled,false);
 f.root.querySelector('[data-domain-prepare]').click();await tick();assert.equal(f.root.querySelector('[data-domain-name]').value,'_sma-verification.example.com');assert.deepEqual(f.calls,['get','prepare']);
 f.root.querySelector('[data-domain-verify]').click();await tick();assert.match(f.root.querySelector('[data-domain-status]').textContent,/bestätigt/);assert.match(f.root.querySelector('[data-domain-connection-note]').textContent,/noch nicht eingerichtet/);assert.deepEqual(f.calls,['get','prepare','verify']);f.view.destroy();
});
await test('missing and overlong new domains make no requests and offer no active challenge',async()=>{
 const f=fixture();for(const domain of ['', 'a'.repeat(63)+'.'+'a'.repeat(63)+'.'+'a'.repeat(63)+'.'+'a'.repeat(44)+'.com']){f.view.setDraft(saved('new',domain));await tick();assert.equal(f.root.querySelector('[data-domain-prepare]').disabled,true);assert.equal(f.root.querySelector('[data-domain-record]').hidden,true);}assert.deepEqual(f.calls,[]);f.view.destroy();
});
await test('existing websites still prove their URL host and keep their own explanation',async()=>{
 const f=fixture({request:async()=>proof('external.example.org')});f.view.setDraft(saved('existing','different.example.com'));await tick();assert.equal(f.root.querySelector('[data-domain-name]').value,'_sma-verification.external.example.org');assert.match(f.root.querySelector('[data-domain-intro]').textContent,/Shop-Button/);assert.doesNotMatch(f.root.querySelector('[data-domain-intro]').textContent,/neue SMA-Webseite/);f.view.destroy();
});
await test('changed domain discards a late response for the former target',async()=>{
 const old=deferred();let calls=0;const f=fixture({request:()=>++calls===1?old.promise:Promise.resolve(proof('example.org',2))});f.view.setDraft(saved());await tick();f.view.setDraft(saved('new','example.org',2));await tick();old.resolve(proof());await tick();assert.equal(f.root.querySelector('[data-domain-name]').value,'_sma-verification.example.org');f.view.destroy();
});
await test('pending owner check cannot send a stale request after invalidation',async()=>{
 const gate=deferred();let calls=0;const f=fixture({getOwnerId:()=>gate.promise,request:async()=>{calls++;return proof();}});f.view.setDraft(saved());f.view.invalidate('Neue Angaben zuerst speichern.');gate.resolve(owner);await tick();assert.equal(calls,0);assert.equal(f.root.querySelector('[data-domain-name]').value,'');assert.equal(f.root.querySelector('[data-domain-prepare]').disabled,true);f.view.destroy();
});
await test('account change clears the challenge and cannot expose a late result',async()=>{
 const delayed=deferred(),f=fixture({request:()=>delayed.promise});f.view.setDraft(saved());await tick();f.uid='another-owner';delayed.resolve(proof());await tick();assert.equal(f.root.querySelector('[data-domain-name]').value,'');assert.equal(f.root.querySelector('[data-domain-record]').hidden,true);assert.equal(f.root.querySelector('[data-domain-prepare]').disabled,true);f.view.destroy();
});
await test('saved preparation is copied so later caller edits cannot retarget a proof',async()=>{
 const delayed=deferred(),f=fixture({request:()=>delayed.promise}),draft=saved();f.view.setDraft(draft);await tick();draft.draft.desired_domain='attacker.example.com';delayed.resolve(proof());await tick();assert.equal(f.root.querySelector('[data-domain-name]').value,'_sma-verification.example.com');f.view.destroy();
});
await test('dashboard keeps three entries and removes proof as soon as the new domain is edited',async()=>{
 const {document:doc,window}=parseHTML('<html><head></head><body><section class="active"><div class="package-module-slot"></div></section></body></html>');window.HTMLElement.prototype.scrollIntoView=function(){};
 // Linkedom does not implement the native radio checked property/group behavior.
 Object.defineProperty(window.HTMLInputElement.prototype,'checked',{configurable:true,get(){return this.hasAttribute('checked');},set(value){if(value){for(const radio of doc.querySelectorAll('input[type="radio"]'))if(radio.name===this.name)radio.removeAttribute('checked');this.setAttribute('checked','');}else this.removeAttribute('checked');}});
 const page=doc.querySelector('section'),calls=[];const view=mountWebsitePreparation({page,stylesheetUrl:'/test.css',getOwnerId:async()=>owner,request:async()=>saved(),domainRequest:async action=>{calls.push(action);return proof();}});await tick();await tick();
 assert.equal(page.querySelectorAll('[data-website-overview]>button').length,3);page.querySelector('[data-website-open="website"]').click();assert.equal(page.querySelector('[data-new-route]').hidden,false);page.querySelector('[data-new-domain-entry]').click();assert.equal(page.querySelector('[data-website-view="domain"]').hidden,false);assert.equal(page.querySelector('[data-domain-setup]').hidden,true);assert.equal(page.querySelector('[data-domain-name]').value,'_sma-verification.example.com');
 page.querySelector('[data-website-back]').click();page.querySelector('[data-website-open="website"]').click();const input=page.querySelector('[name="desired_domain"]');input.value='example.org';input.dispatchEvent(new window.Event('input',{bubbles:true}));page.querySelector('[data-new-domain-entry]').click();assert.equal(page.querySelector('[data-domain-name]').value,'');assert.equal(page.querySelector('[data-domain-prepare]').disabled,true);assert.match(page.querySelector('[data-domain-status]').textContent,/Speichere/);assert.equal(page.querySelector('[data-domain-setup]').hidden,false);assert.deepEqual(calls,['get']);view.destroy();
});
console.log(`New SMA website domain proof: ${passed} DOM scenarios passed.`);
