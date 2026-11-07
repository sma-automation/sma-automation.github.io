import assert from 'node:assert/strict';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {createChapterTabs,mountDashboardChapters} from '../app/assets/dashboard-chapters.mjs';
import {mountWebsitePreparation} from '../app/assets/website-domain.mjs';
import {mountCustomerWebsiteDashboard} from '../app/assets/customer-website-dashboard.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
const card=(id,content=id)=>`<div class="card" id="${id}">${content}</div>`;
const grid=(...cards)=>`<div class="grid">${cards.join('')}</div>`;
const head=name=>`<div class="page-head"><h1>${name}</h1><p>Introduction</p></div>`;
const page=(name,body)=>`<section id="page-${name}">${head(name)}${body}</section>`;
const feature='<div class="interface-list package-feature-list">Existing features</div>';
function fixture(){
 const html=[
  page('overview',grid(...['social-summary','content-summary','account-summary','plan-summary'].map(id=>card(id)))),
  page('publishing',card('portals','<button id="optimize">Optimieren</button>')+head('Dateien')+'<div id="publishingFilesSlot"><input id="file-query"></div><section id="smaOptimizationPage" hidden>Native optimizer</section>'),
  page('social','<div class="notice">Provider notice</div><div class="platform-list">'+['YouTube','TikTok','Instagram','Facebook'].map(name=>`<div class="platform-card"><div class="platform-info"><strong>${name}</strong></div><button>${name} verbinden</button></div>`).join('')+'</div>'),
  page('content',card('content-files')+grid(card('content-optimizer','<input id="unsaved"><button id="existing-action">Existing action</button>'),card('content-magic'))+'<div id="contentOptimizerResult">Existing result</div>'),
  page('music',grid(card('length'),card('pricing'))+card('tracks')+card('playlist')+'<div id="playlistResultSlot">Playlist result</div>'),
  page('history','<div class="sma-history-switcher"><button>Aufträge</button><button>Portaltexte</button></div><article id="orders">Order list</article><article id="texts">Text list</article>'),
  page('settings',grid(card('account'),card('language'))+grid(card('plan'),card('credits'))+card('connections')+card('interfaces')+card('privacy')+'<section class="company-profile-overview">Company summary</section>'),
  page('tutorials',card('quickstart')+grid(...['guide1','guide2','help'].map(id=>card(id)))+'<div id="tutorialContentSlot">Existing guide</div>'),
  page('seller','<div class="package-module-status unlocked">Enabled</div>'+feature+'<div id="seller-chat">Existing seller widget</div>'),
  page('assistant',feature+'<div class="package-module-slot">Existing assistant</div>'),
  page('shop',feature+'<iframe id="smaShopFrame" style="height:900px"></iframe><details id="smaProductDetails">Existing product editor</details>'),
  page('website','<div class="package-module-slot"></div>')
 ].join('');
 const {document:doc,window}=parseHTML('<html><head></head><body><header><div class="topbar-title">overview</div></header>'+html+'</body></html>');
 window.HTMLElement.prototype.scrollIntoView=function(){};
 Object.defineProperty(window.HTMLInputElement.prototype,'checked',{configurable:true,get(){return this.hasAttribute('checked');},set(value){if(value){for(const radio of doc.querySelectorAll('input[type="radio"]'))if(radio.name===this.name)radio.removeAttribute('checked');this.setAttribute('checked','');}else this.removeAttribute('checked');}});
 const $=selector=>doc.querySelector(selector),history=$('.sma-history-switcher'),historyTabs=createChapterTabs({doc,id:'history',list:history,entries:[{key:'orders',button:history.children[0],panel:$('#orders')},{key:'texts',button:history.children[1],panel:$('#texts')}]});
 const calls=[],websiteView=mountWebsitePreparation({page:$('#page-website'),chapterNavigation:true,stylesheetUrl:'/website.css',getOwnerId:async()=>'owner',request:async(action)=>{calls.push(action);return {ok:true,state:'preparation',can_publish:false,revision:0,shop_url:null,draft:null};}});
 const input=$('#unsaved');input.value='Keep this unsaved input';let actions=0;$('#existing-action').addEventListener('click',()=>actions++);
 const frame=$('#smaShopFrame');let shopDoc;
 const shopLoads=[];
 function replaceShop(){
  const {document:child}=parseHTML('<html><body><div id="app"><div class="content"><nav class="shop-sections"><button id="showProducts">Produkte</button><button id="showOrders">Bestellungen</button></nav><section id="shop">Products</section><section id="bestellungen" hidden><span id="order-page">2</span></section></div></div></body></html>');
  for(const [id,orders] of [['showProducts',false],['showOrders',true]])child.getElementById(id).addEventListener('click',()=>{child.getElementById('shop').hidden=orders;child.getElementById('bestellungen').hidden=!orders;shopLoads.push(id);});
  child.querySelector('.content').getBoundingClientRect=()=>({height:410});shopDoc=child;
  Object.defineProperty(frame,'contentDocument',{configurable:true,get:()=>shopDoc});frame.dispatchEvent(new window.Event('load'));return child;
 }
 replaceShop();
 const original=[...doc.querySelectorAll('[id]')].map(el=>[el,el.parentNode]);
 const view=mountDashboardChapters({doc,stylesheetUrl:'/chapters.css',websiteView});
 return {doc,window,$,view,calls,input,historyTabs,websiteView,original,frame,shopLoads,replaceShop,get shopDoc(){return shopDoc;},get actions(){return actions;},destroy(){view.destroy();historyTabs.destroy();websiteView.destroy();}};
}
await test('all twelve dashboard areas have tabs directly after their original heading',()=>{
 const f=fixture();assert.equal(f.doc.querySelectorAll('[data-sma-chapters]').length,12);
 for(const root of f.doc.querySelectorAll('[data-sma-chapters]')){const nav=root.querySelector('.sma-chapters');assert.equal(nav.previousElementSibling.tagName,'H1');assert.equal(nav.querySelectorAll('[aria-selected=true]').length,1);}
 for(const [name,tabs] of f.view.controllers){for(const entry of tabs.entries){entry.button.click();assert.equal(tabs.selected,entry.key);if(entry.panel){assert.equal(entry.panel.hidden,false);assert.equal(tabs.entries.filter(e=>e.panel&&!e.panel.hidden).length,1);}}}
 f.destroy();
});
await test('keeps the large content heading ahead of the tabs when the shell title changes',async()=>{
 const f=fixture(), title=f.$('.topbar-title');
 for(const root of f.doc.querySelectorAll('[data-sma-chapters]')){
  const heading=root.querySelector('.page-head > h1');
  title.textContent=heading.textContent;await tick();
  assert.equal(heading.hidden,false,root.id);
  assert.equal(heading.hasAttribute('data-sma-duplicate-heading'),false,root.id);
  assert.equal(heading.nextElementSibling,root.querySelector('.sma-chapters'));
 }
 title.textContent='Publishing';f.$('#page-publishing .page-head > h1').textContent='Publishing';await tick();
 assert.equal(f.$('#page-publishing .page-head > h1').hidden,false);
 assert.equal(f.$('#page-publishing [data-chapter="files"] h1').textContent,'Dateien');
 f.destroy();
});
await test('switches preserve exact form nodes, unsaved values, listeners and generated results',()=>{
 const f=fixture(),tabs=f.view.controllers.get('content'),result=f.$('#contentOptimizerResult');
 tabs.select('optimizer');f.$('#existing-action').click();tabs.select('magic');assert.equal(result.parentNode.dataset.chapter,'magic');result.textContent='New result';tabs.select('files');tabs.select('optimizer');
 assert.equal(f.$('#unsaved'),f.input);assert.equal(f.input.value,'Keep this unsaved input');assert.equal(result.textContent,'New result');assert.equal(result.parentNode.dataset.chapter,'optimizer');f.$('#existing-action').click();assert.equal(f.actions,2);
 const tutorial=f.view.controllers.get('tutorials'),guide=f.$('#tutorialContentSlot');tutorial.select('guides');tutorial.select('help');assert.equal(guide.parentNode.dataset.chapter,'help');f.destroy();
});
await test('keyboard navigation has one focusable tab and matching accessible panels',()=>{
 const f=fixture(),tabs=f.view.controllers.get('social');let focused;for(const entry of tabs.entries)entry.button.focus=()=>focused=entry.key;
 function key(key){const event=new f.window.Event('keydown',{bubbles:true,cancelable:true});event.key=key;tabs.entries.find(e=>e.key===tabs.selected).button.dispatchEvent(event);}
 key('ArrowLeft');assert.equal(tabs.selected,'facebook');assert.equal(focused,'facebook');key('Home');assert.equal(tabs.selected,'youtube');key('ArrowRight');assert.equal(tabs.selected,'tiktok');key('End');assert.equal(tabs.selected,'facebook');
 for(const entry of tabs.entries){assert.equal(entry.button.getAttribute('tabindex'),entry.key==='facebook'?'0':'-1');assert.equal(entry.button.getAttribute('aria-controls'),entry.panel.id);assert.equal(entry.panel.getAttribute('aria-labelledby'),entry.button.id);}f.destroy();
});
await test('publication keeps its portal rows and file gallery, with optimizer outside chapter panels',()=>{
 const f=fixture(),tabs=f.view.controllers.get('publishing'),optimizer=f.$('#smaOptimizationPage');assert.equal(optimizer.parentNode,f.$('#page-publishing'));assert.equal(optimizer.closest('.sma-chapter-panel'),null);assert.equal(optimizer.hidden,true);
 tabs.select('files');f.$('#file-query').value='Video';tabs.select('portals');assert.equal(f.$('#portals').hidden,false);tabs.select('files');assert.equal(f.$('#file-query').value,'Video');f.destroy();
});
await test('Shop delegates to original iframe controls, retains order page and restores on reload/destroy',()=>{
 const f=fixture(),tabs=f.view.controllers.get('shop'),first=f.shopDoc;assert.equal(first.querySelector('.shop-sections').style.display,'none');assert.equal(f.frame.style.height,'434px');
 tabs.select('orders');assert.equal(first.getElementById('bestellungen').hidden,false);assert.equal(f.$('#smaProductDetails').hidden,true);tabs.select('products');tabs.select('orders');assert.equal(first.getElementById('order-page').textContent,'2');
 const second=f.replaceShop();assert.notEqual(first,second);assert.equal(first.querySelector('.shop-sections').style.display,'');assert.equal(second.getElementById('bestellungen').hidden,false);second.getElementById('showProducts').click();assert.equal(tabs.selected,'products');
 f.destroy();assert.equal(f.frame.style.height,'900px');assert.equal(second.querySelector('.shop-sections').style.display,'');assert.equal(f.$('#smaProductDetails').hidden,false);
});
await test('Website chapters and existing shortcuts remain synchronized without losing unsaved input',async()=>{
 const f=fixture(),root=f.$('#page-website'),tabs=f.view.controllers.get('website');root.classList.add('active');await tick();await tick();assert.deepEqual(f.calls,['get']);
 const input=f.$('[name=desired_domain]');input.value='unsaved.example.org';input.dispatchEvent(new f.window.Event('input',{bubbles:true}));tabs.select('company');assert.equal(f.$('[data-company-profile-dashboard]').closest('[data-website-view]').dataset.websiteView,'company');tabs.select('website');assert.equal(input.value,'unsaved.example.org');
 f.$('[data-new-domain-entry]').click();assert.equal(tabs.selected,'domain');assert.equal(tabs.entries.find(e=>e.key==='domain').panel.hidden,false);root.classList.remove('active');await tick();root.classList.add('active');await tick();assert.equal(tabs.selected,'domain');assert.deepEqual(f.calls,['get']);f.destroy();
});
await test('customer website summary still inserts into its own chapter when company data is separate',async()=>{
 const f=fixture(),root=f.$('#page-website');const summary=mountCustomerWebsiteDashboard({page:root,expectedOwnerId:'owner',getOwnerId:async()=>'owner',request:async()=>({ok:false})});await tick();
 assert.equal(f.$('.sma-website-site-summary').closest('[data-website-view]').dataset.websiteView,'website');assert.equal(f.$('[data-company-profile-dashboard]').closest('[data-website-view]').dataset.websiteView,'company');summary.destroy();f.destroy();
});
await test('teardown restores original element positions and supports clean remount',()=>{
 const f=fixture();f.view.destroy();for(const [node,parent] of f.original)assert.equal(node.parentNode,parent,node.id);assert.equal(f.doc.querySelectorAll('[data-sma-chapters]').length,0);assert.equal(f.doc.querySelectorAll('link[href="/chapters.css"]').length,0);
 const again=mountDashboardChapters({doc:f.doc,stylesheetUrl:'/chapters.css',websiteView:f.websiteView});assert.equal(f.doc.querySelectorAll('[data-sma-chapters]').length,12);again.destroy();f.historyTabs.destroy();f.websiteView.destroy();
});
console.log(`${passed} dashboard chapter DOM scenarios passed.`);
