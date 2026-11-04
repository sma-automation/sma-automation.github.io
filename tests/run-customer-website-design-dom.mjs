import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {contentLimits,appearanceOptions} from '../app/assets/customer-website-model.mjs';
import {mountCustomerWebsiteEditor} from '../app/assets/customer-website-editor.mjs';
import {mountCustomerWebsitePage} from '../app/assets/customer-website-view.mjs';
import {renderCustomerWebsite} from '../app/assets/customer-website-render.mjs';
const id='ab660000-0000-4000-8000-000000000061',tick=()=>new Promise(r=>setImmediate(r));
const content={...Object.fromEntries(Object.keys(contentLimits).map(k=>[k,''])),name:'SHK Testbetrieb',headline:'Wasser. Wärme. Wohlfühlen.',about:'Gespeicherter Text',contact_address:'Musterstraße 12'};
const html=await readFile(new URL('../app/website-builder.html',import.meta.url),'utf8');
const pageHtml=await readFile(new URL('../app/website.html',import.meta.url),'utf8');
let passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
const choose=(doc,key,value)=>{doc.querySelector(`[name="${key}"] option[value="${value}"]`).selected=true;doc.getElementById('contentForm').dispatchEvent(new doc.defaultView.Event('input',{bubbles:true}));};
function fixture(){
 const {document:doc,window}=parseHTML(html);window.confirm=()=>true;
 let saved={ok:true,site_id:id,revision:1,content:{...content},published:false,publicly_available:false,has_changes:true,can_edit:true,shop_url:null,website_url:'https://sma-automation.com/app/website.html?site='+id};
 const calls=[];let fail=false;
 const request=async(action,input)=>{calls.push({action,input});if(action==='save'){if(fail)throw Error('offline');saved={...saved,content:input.content,revision:saved.revision+1};}return saved;};
 const editor=mountCustomerWebsiteEditor({doc,request,getOwnerId:async()=>id,uuid:()=>id});
 return {doc,window,editor,request,calls,get saved(){return saved;},set fail(value){fail=value;},submit(){doc.getElementById('contentForm').dispatchEvent(new window.Event('submit',{cancelable:true}));return tick();}};
}
await test('legacy pages render in unchanged blue with the house motif',()=>{
 const {document}=parseHTML('<main class="site-shell"></main>'),root=document.querySelector('main');
 const view=renderCustomerWebsite({root,content,shopURL:null});assert.equal(root.getAttribute('data-accent'),'blue');assert.equal(root.getAttribute('data-hero'),'shk');assert(root.querySelector('#house'));view.destroy();
});
await test('all twelve design combinations preserve text and render only the selected motif',()=>{
 for(const accent of appearanceOptions.accent)for(const hero of appearanceOptions.hero){
  const {document}=parseHTML('<main class="site-shell"></main>'),root=document.querySelector('main');
  const view=renderCustomerWebsite({root,content:{...content,accent,hero},shopURL:null});assert.equal(root.getAttribute('data-accent'),accent);assert.equal(root.getAttribute('data-hero'),hero);
  assert.equal(root.querySelector('[data-about]').textContent,content.about);assert.equal(!!root.querySelector('.hero-visual'),hero!=='none');assert.equal(!!root.querySelector('#house'),hero==='shk');
  assert.equal(root.querySelector('script'),null);view.destroy();assert.equal(root.getAttribute('data-accent'),null);assert.equal(root.children.length,0);
 }
});
await test('design editor starts collapsed with legacy defaults and has no automatic writes',async()=>{
 const f=fixture();await f.editor.load();assert(!f.doc.querySelector('.design-panel details').hasAttribute('open'));
 assert.equal(f.doc.querySelector('[name="accent"]').value,'blue');assert.equal(f.doc.querySelector('[name="hero"]').value,'shk');assert.deepEqual(f.calls.map(c=>c.action),['get']);f.editor.destroy();
});
await test('design changes protect unsaved work, save with existing text and survive reload',async()=>{
 const f=fixture();await f.editor.load();choose(f.doc,'accent','green');choose(f.doc,'hero','abstract');
 assert.equal(f.doc.getElementById('publish').disabled,true);await f.editor.refresh();assert.equal(f.calls.length,1);
 await f.submit();assert.equal(f.saved.content.accent,'green');assert.equal(f.saved.content.hero,'abstract');assert.equal(f.saved.content.about,content.about);
 await f.editor.load();assert.equal(f.doc.querySelector('[name="accent"]').value,'green');assert(!f.calls.some(c=>c.action==='publish'));f.editor.destroy();
});
await test('failed saves keep design selections and retry the same request',async()=>{
 const f=fixture();await f.editor.load();choose(f.doc,'hero','none');f.fail=true;await f.submit();
 assert.equal(f.doc.querySelector('[name="hero"]').value,'none');assert.equal(f.doc.getElementById('publish').disabled,true);f.fail=false;await f.submit();
 assert.deepEqual(f.calls[1],f.calls[2]);assert.equal(f.saved.content.hero,'none');f.editor.destroy();
});
await test('open private preview adopts saved design on return, public view keeps its snapshot',async()=>{
 const f=fixture();await f.editor.load();
 const {document:doc}=parseHTML(pageHtml);Object.defineProperty(doc,'visibilityState',{value:'visible'});
 const preview=mountCustomerWebsitePage({doc,search:'?preview=1',customerWebsiteRequest:f.request,getOwnerId:async()=>id,watchOwner:async()=>({unsubscribe(){}})});await preview.load();
 const {document:publicDoc}=parseHTML(pageHtml);const publicPage=mountCustomerWebsitePage({doc:publicDoc,search:'?site='+id,publicWebsiteRequest:async()=>({ok:true,site_id:id,content,shop_url:null})});await publicPage.load();
 choose(f.doc,'accent','violet');choose(f.doc,'hero','none');await f.submit();doc.defaultView.dispatchEvent(new doc.defaultView.Event('focus'));await tick();
 assert.equal(doc.getElementById('site').getAttribute('data-accent'),'violet');assert.equal(doc.querySelector('.hero-visual'),null);assert.equal(doc.querySelector('[data-address]').textContent,content.contact_address);
 assert.equal(publicDoc.getElementById('site').getAttribute('data-accent'),'blue');assert(publicDoc.querySelector('#house'));assert(!f.calls.some(c=>c.action==='publish'));preview.destroy();publicPage.destroy();f.editor.destroy();
});
await test('account invalidation hides and clears design selections',async()=>{
 const f=fixture();await f.editor.load();choose(f.doc,'accent','terracotta');f.editor.invalidate();assert.equal(f.doc.getElementById('editor').hidden,true);assert.equal(f.doc.querySelectorAll('select option[selected]').length,0);assert.equal(f.doc.getElementById('fields').disabled,true);f.editor.destroy();
});
console.log(`Customer website design: ${passed} DOM scenarios passed.`);
