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
function fixture(onPreparePost){
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
 const view=mountDashboardChapters({doc,stylesheetUrl:'/chapters.css',websiteView,onPreparePost});
 return {doc,window,$,view,calls,input,historyTabs,websiteView,original,frame,shopLoads,replaceShop,get shopDoc(){return shopDoc;},get actions(){return actions;},destroy(){view.destroy();historyTabs.destroy();websiteView.destroy();}};
}
await test('all twelve dashboard areas have tabs directly after their original heading',()=>{
 const f=fixture();assert.equal(f.doc.querySelectorAll('[data-sma-chapters]').length,12);
 for(const root of f.doc.querySelectorAll('[data-sma-chapters]')){const nav=root.querySelector('.sma-chapters');assert.equal(nav.previousElementSibling.tagName,'H1');assert.equal(nav.querySelectorAll('[aria-selected=true]').length,1);}
 for(const [name,tabs] of f.view.controllers){for(const entry of tabs.entries){entry.button.click();assert.equal(tabs.selected,entry.key);if(entry.panel){assert.equal(entry.panel.hidden,false);assert.equal(tabs.entries.filter(e=>e.panel&&!e.panel.hidden).length,1);}}}
 f.destroy();
});
await test('workspace starts post preparation and the account panel has no duplicate entry',()=>{
 let starts=0;
 const f=fixture(()=>starts++);
 const panel=f.$('#sma-overview-panel-work'),button=panel.firstElementChild;
 assert.equal(button.tagName,'BUTTON');
 assert.equal(button.type,'button');
 assert.equal(button.textContent,'Beitrag vorbereiten');
 assert.equal(button.dataset.en,'Prepare a post');
 assert.equal(f.$('#sma-overview-panel-account .sma-prepare-post'),null);
 button.click();assert.equal(starts,1);
 f.view.controllers.get('overview').select('account');assert.equal(panel.hidden,true);
 f.destroy();button.click();assert.equal(starts,1);
 const unavailable=fixture();assert.equal(unavailable.$('.sma-prepare-post'),null);unavailable.destroy();
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
await test('opens all tutorial videos inline, with reading steps and the original help slot',()=>{
 const f=fixture(),tabs=f.view.controllers.get('tutorials'),ids=new Set();
 for(const [key,count] of [['start',4],['guides',8]]){
  tabs.select(key);
  const panel=f.$('#sma-tutorials-panel-'+key);
  const buttons=[...panel.querySelectorAll('.sma-lesson-list button')];
  assert.equal(buttons.length,count);
  for(const button of buttons){
   button.click();
   const id=button.dataset.lesson,video=panel.querySelector('video');
   assert.equal(video.src.endsWith('/tutorials/'+id+'.mp4'),true);
   assert.equal(video.poster.endsWith('/tutorials/'+id+'.jpg'),true);
   assert.equal(panel.querySelectorAll('video').length,1);
   assert.equal(button.getAttribute('aria-pressed'),'true');
   assert.equal(panel.querySelectorAll('.sma-lesson-list [aria-pressed=true]').length,1);
   assert.ok(panel.querySelectorAll('details li').length>=2);
   ids.add(id);
  }
 }
 assert.equal(ids.size,12);
 tabs.select('help');assert.equal(f.$('#tutorialContentSlot').parentNode.dataset.chapter,'help');
 f.destroy();assert.equal(f.$('.sma-tutorials'),null);
});
await test('keyboard navigation has one focusable tab and matching accessible panels',()=>{
 const f=fixture(),tabs=f.view.controllers.get('social');let focused;for(const entry of tabs.entries)entry.button.focus=()=>focused=entry.key;
 function key(key){const event=new f.window.Event('keydown',{bubbles:true,cancelable:true});event.key=key;tabs.entries.find(e=>e.key===tabs.selected).button.dispatchEvent(event);}
 key('ArrowLeft');assert.equal(tabs.selected,'facebook');assert.equal(focused,'facebook');key('Home');assert.equal(tabs.selected,'youtube');key('ArrowRight');assert.equal(tabs.selected,'tiktok');key('End');assert.equal(tabs.selected,'facebook');
 for(const entry of tabs.entries){assert.equal(entry.button.getAttribute('tabindex'),entry.key==='facebook'?'0':'-1');assert.equal(entry.button.getAttribute('aria-controls'),entry.panel.id);assert.equal(entry.panel.getAttribute('aria-labelledby'),entry.button.id);}f.destroy();
});
await test('connection cards preserve the delegated OAuth click, native status refresh and the original optimizers',async()=>{
 const portal=name=>'<article class="platform-card" data-sma-platform="'+name+'"><div class="platform-info"><strong>'+name+'</strong></div>';
 const link='<a href="/connect/test" target="_blank" rel="noopener" data-en="Connect">Verbinden</a>';
 const blocked='<button disabled data-en="Meta approval pending">Meta-Freigabe offen</button>';
 const names=['YouTube','Instagram'];
 const publishing=names.map(name=>portal(name)+'<button class="sma-optimize" data-portal="'+name.toLowerCase()+'">Optimieren</button></article>').join('');
 const sourceRows=names.slice().reverse().map(name=>portal(name)+'<div class="platform-action">'+(name==='YouTube'?link:blocked)+'</div></article>').join('');
 const list=html=>'<div class="platform-list">'+html+'</div>';
 const {document:doc}=parseHTML('<html><head></head><body><nav><button data-page="publishing">Veröffentlichung</button><button data-page="social">Social Media</button></nav>'+
  page('publishing',card('portals',list(publishing))+'<div id="publishingFilesSlot"></div>')+page('social',list(sourceRows))+'</body></html>');
 const source=doc.getElementById('page-social'),nav=doc.querySelector('[data-page="social"]'),home=source.parentElement;
 const pub=doc.querySelector('#page-publishing .platform-list'),native=source.querySelector('.platform-list');
 const originals=[...pub.querySelectorAll('button')];
 let pending='';
 doc.addEventListener('click',event=>{
  const clicked=event.target.closest('#page-social .platform-action a[href]');
  if(clicked){event.preventDefault();pending=clicked.closest('[data-sma-platform]').dataset.smaPlatform;}
 },true);
 for(let n=0;n<2;n++){
  const connect=source.querySelector('a'),view=mountDashboardChapters({doc,stylesheetUrl:'/chapters.css'});
  assert(nav.hidden&&pub.hidden);assert(!view.controllers.has('social'));
  assert(doc.getElementById('sma-publishing-panel-portals').contains(connect));
  assert.equal(doc.querySelector('#page-publishing .platform-list'),pub);
  assert.deepEqual([...native.children].map(c=>c.dataset.smaPlatform),names);
  assert.equal(connect.closest('.sma-portal-actions').querySelector('.sma-optimize'),originals[0]);assert.equal(connect.target,'_blank');
  const manual=native.querySelector('.sma-manual-post');assert.equal(manual.textContent,'Sofort posten');assert.equal(manual.closest('.platform-action'),null);assert.equal(manual.previousElementSibling,originals[0]);assert.match(manual.href,/sofort-posten\.html\?portal=youtube$/);
  connect.click();assert.equal(pending,'YouTube');
  // The session shell replaces both lists after verifying the customer's fresh response.
  native.innerHTML=sourceRows.replace('>Verbinden<','>Neu verbinden<').replace('href="/connect/test"','href="/connect/fresh"');
  pub.innerHTML=names.map(name=>portal(name)+'</article>').join('');
  await tick();
  assert.deepEqual([...native.querySelectorAll('.sma-optimize')],originals);
  assert.equal(native.querySelector('.platform-action a').textContent,'Neu verbinden');
  assert.equal(native.querySelector('.platform-action a').getAttribute('href'),'/connect/fresh');
  assert(native.querySelector('button[disabled]').disabled);
  view.destroy();assert(!nav.hidden&&!pub.hidden);assert.equal(source.parentElement,home);
  assert.deepEqual([...pub.querySelectorAll('.sma-optimize')],originals);
  assert.equal(doc.querySelector('.sma-portal-actions'),null);
 }
});
await test('the overview counter opens the portal chapter and preserves native status updates',()=>{
 const overview=page('overview',grid(card('summary','<div class="card-title">Social Media</div><div class="big-value"><span data-sma-social-count>0/4</span></div><div id="caption" class="muted">verbundene Plattformen</div>'),card('content'),card('account')));
 const list=content=>'<div class="platform-list"><article class="platform-card"><div class="platform-info"><strong>YouTube</strong></div>'+content+'</article></div>';
 const publishing=page('publishing',card('portals',list('<button class="sma-optimize">Optimieren</button>'))+'<div id="publishingFilesSlot"></div>');
 const social=page('social',list('<div class="platform-action"><a href="/fixture">Verbinden</a></div>'));
 const {document:doc}=parseHTML('<html lang="en"><head></head><body>'+overview+publishing+social+'</body></html>');
 const count=doc.querySelector('[data-sma-social-count]'),summary=doc.getElementById('summary');
 let opens=0;
 const mount=()=>mountDashboardChapters({doc,stylesheetUrl:'/chapters.css',onPreparePost:()=>opens++});
 for(let n=0;n<2;n++){
  const view=mount(),button=summary.querySelector('button');
  assert.equal(button.textContent,'Open platforms');assert.equal(button.dataset.de,'Portale öffnen');
  assert.equal(button.getAttribute('aria-controls'),doc.getElementById('sma-publishing-panel-portals').id);
  assert.deepEqual(button.getAttribute('aria-describedby').split(' ').map(id=>doc.getElementById(id)),[count,doc.getElementById('caption')]);
  count.textContent='2/4';button.click();assert.equal(opens,n+1);
  assert.equal(summary.querySelector('[data-sma-social-count]'),count);
  view.destroy();button.click();assert.equal(opens,n+1);assert.equal(summary.querySelector('button'),null);
  assert(!count.id);assert.equal(doc.getElementById('caption').id,'caption');
 }
 const existing=doc.createElement('a');existing.href='/other';summary.append(existing);
 const guarded=mount();assert.equal(summary.querySelector('button'),null);guarded.destroy();existing.remove();
 doc.getElementById('page-social').remove();const unavailable=mount();
 assert.equal(summary.querySelector('button'),null);unavailable.destroy();
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
await test('website preparation loads and unlocks fields even if host does not mark the page active',async()=>{
 const f=fixture(),page=f.$('#page-website'),fields=f.$('#smaWebsitePreparation fieldset');
 assert.equal(page.classList.contains('active'),false,'Real chapter navigation can show a page without the legacy active class');
 await tick();await tick();
 assert.deepEqual(f.calls,['get'],'The saved preparation must load when the dashboard chapter is mounted');
 assert.equal(fields.disabled,false,'The customer must be able to edit the existing website URL');
 assert.equal(f.$('[name="website_url"]').disabled,false,'The website URL should be editable after successful load');
 assert.equal(f.$('#smaWebsitePreparation [type="submit"]').disabled,false,'Saving must be available after initial load');
 page.classList.add('active');await tick();
 assert.deepEqual(f.calls,['get'],'A subsequent navigation event must not repeat the initial load');
 f.destroy();
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
