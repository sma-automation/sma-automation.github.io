import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {filePortal,findDashboardNav,searchDashboard,mountDashboardSearch} from '../app/assets/dashboard-global-search.mjs';

let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const files=[
 {id:A,name:'SMA-Export-283abd16-3b72-4224-ab66-81b30afdab13.mp4',
  modified_at:'2026-11-06T18:25:13Z',media_kind:'video',
  assignments:[{platform:'youtube',status:'assigned'}]},
 {id:B,name:'Küchenmontage mit SMA-Musik.mp4',
  modified_at:'2026-11-09T12:11:00Z',media_kind:'video',
  assignments:[{platform:'tiktok',status:'assigned'}]},
 {id:C,name:'Hausmeister Logo.png',
  modified_at:'2026-11-05T10:00:00Z',media_kind:'image',assignments:[]}
];
function fixture({owner='owner-1',reject=false,missingSidebar=false}={}){
 const markup='<html lang="de"><head></head><body>'+
 '<header class="topbar"><div class="topbar-title">SMA</div><div class="topbar-actions">'+
 '<span>Profil</span><select id="languageSwitcher" aria-label="Sprache"><option>DE</option></select>'+
 '<button id="logout">Abmelden</button></div></header>'+
 (missingSidebar?'':'<aside class="sidebar"><nav><button data-page="overview">Übersicht</button>'+
 '<button data-page="publishing" id="navPublishing">Veröffentlichung</button>'+
 '<button data-page="history">History</button><button data-page="shop">Shop</button></nav></aside>')+
 '<main><section id="page-overview"></section><section id="page-publishing"></section>'+
 '<section id="page-history"></section><section id="page-shop"></section></main>'+
 '</body></html>';
 const {document:doc,window}=parseHTML(markup);
 const events=[],requests={list:0},navigate=(page,chapter)=>{
  events.push({area:page,chapter});return !!findDashboardNav(doc,page);
 };
 const search=mountDashboardSearch({
  doc,expectedOwnerId:'owner-1',stylesheetUrl:'/search.css',
  getOwnerId:async()=>owner,
  listFiles:async()=>{requests.list++;if(reject)throw Error('INTERNAL_SECRET_SHOULD_NOT_LEAK');return files;},
  onNavigate:navigate,
  onOpenFile:(fileId,portal)=>{events.push({fileId,portal});return true;}
 });
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 const input=(text)=>{
  search.search(text);
 };
 return {doc,window,search,events,requests,tick,input,get$:q=>doc.querySelector(q),setOwner:v=>{owner=v;}};
}

await check('search field is visible in the original header before language; unchanged nav',()=>{
 const f=fixture(),query=f.get$('#smaDashboardSearchQuick');
 assert(query);assert.equal(query.tagName,'INPUT');assert.equal(query.type,'search');
 assert.equal(query.parentNode.nextElementSibling,f.get$('#languageSwitcher'));
 assert.equal(f.get$('#navPublishing').textContent,'Veröffentlichung');
 assert.equal(f.get$('#smaDashboardSearchDialog').hidden,true);
 assert.equal(f.get$('link[href="/search.css"]').rel,'stylesheet');
 f.search.destroy();
 assert.equal(f.get$('#smaDashboardSearch'),null);
 assert.equal(f.get$('#smaDashboardSearchDialog'),null);
});
await check('global search opens the exact filename directly in the assigned YouTube optimizer',async()=>{
 const f=fixture();f.search.show();await f.search.refresh();f.input('SMA-Export-283abd16');
 const results=[...f.doc.querySelectorAll('button.sma-search-hit[data-type="file"]')];
 assert.equal(results.length,1);
 assert.match(results[0].textContent,/SMA-Export-283abd16/);
 assert.match(results[0].textContent,/YouTube optimieren/);
 results[0].click();await f.tick();
 assert.deepEqual(f.events,[{fileId:A,portal:'youtube'}]);
 assert.equal(f.get$('#smaDashboardSearchDialog').hidden,true);
 f.search.destroy();
});
await check('accent-independent media search finds only the current owner file',async()=>{
 const f=fixture();f.search.show();await f.search.refresh();f.input('Kuchenmontage');
 const results=[...f.doc.querySelectorAll('button.sma-search-hit[data-type="file"]')];
 assert.equal(results.length,1);assert.match(results[0].textContent,/Küchenmontage/);
 assert.equal(results[0].dataset.fileId,B);
 results[0].click();await f.tick();
 assert.deepEqual(f.events,[{fileId:B,portal:'tiktok'}]);f.search.destroy();
});
await check('section search navigates to existing History/Shop in the same dashboard, no tab',async()=>{
 const f=fixture();f.search.show();await f.search.refresh();f.input('History');
 const history=[...f.doc.querySelectorAll('button.sma-search-hit[data-type="area"]')]
   .find(x=>x.dataset.page==='history');
 assert(history);
 history.click();await f.tick();
 assert.deepEqual(f.events,[{area:'history',chapter:undefined}]);
 f.search.show();f.input('Bestellungen');
 const shop=[...f.doc.querySelectorAll('button.sma-search-hit[data-type="area"]')]
  .find(x=>x.dataset.page==='shop');
 assert(shop);shop.click();await f.tick();
 assert.deepEqual(f.events,[{area:'history',chapter:undefined},{area:'shop',chapter:undefined}]);
 f.search.destroy();
});
await check('global navigation shows direct Dateien chapter, never new navigation buttons',async()=>{
 const f=fixture();f.search.show();await f.search.refresh();f.input('Dateien');
 const entry=[...f.doc.querySelectorAll('.sma-search-hit[data-type="area"]')]
 .find(x=>x.dataset.page==='publishing'&&x.textContent.includes('Dateien'));
 assert(entry);entry.click();await f.tick();
 assert.equal(f.events[0].area,'publishing');assert.equal(f.events[0].chapter,'files');
 assert.equal(f.doc.querySelectorAll('aside button').length,4);
 f.search.destroy();
});
await check('Ctrl+K, Escape and input search work without new windows',async()=>{
 const f=fixture();const shortcut=new f.window.Event('keydown',{bubbles:true,cancelable:true});
 shortcut.key='k';shortcut.ctrlKey=true;f.doc.dispatchEvent(shortcut);
 assert.equal(f.get$('#smaDashboardSearchDialog').hidden,false);
 await f.search.refresh();
 const e=new f.window.Event('keydown',{bubbles:true,cancelable:true});e.key='Escape';
 f.doc.dispatchEvent(e);
 assert.equal(f.get$('#smaDashboardSearchDialog').hidden,true);
 const small=f.get$('#smaDashboardSearchQuick');small.value='SMA-Export';
 small.dispatchEvent(new f.window.Event('input',{bubbles:true}));
 assert.equal(f.get$('#smaDashboardSearchDialog').hidden,false);
 assert.equal(f.search.input.value,'SMA-Export');
 f.search.destroy();
});
await check('signed-out or changed owner never reveals files, even on stale click',async()=>{
 const f=fixture();f.search.show();await f.search.refresh();f.input('Hausmeister');
 const item=f.doc.querySelector('.sma-search-hit[data-type="file"]');assert(item);
 f.setOwner('another-owner');item.click();await f.tick();
 assert.equal(f.events.length,0);
 assert.equal(f.get$('#smaDashboardSearchDialog').hidden,true);
 assert.equal(f.get$('#smaDashboardSearchQuick').value,'');
 f.search.destroy();
});
await check('unavailable file RPC shows a safe message, but keeps local page routes',async()=>{
 const f=fixture({reject:true});f.search.show();await f.search.refresh();
 assert.match(f.doc.querySelector('.sma-search-status').textContent,/Dateisuche gerade nicht verfügbar/);
 assert(!f.doc.body.textContent.includes('INTERNAL_SECRET_SHOULD_NOT_LEAK'));
 f.input('Übersicht');const area=f.doc.querySelector('.sma-search-hit[data-type="area"]');
 assert.equal(area?.dataset.page,'overview');f.search.destroy();
});
await check('no sidebar route is never guessed and search cannot create second mount',async()=>{
 const f=fixture({missingSidebar:true});
 assert.equal(findDashboardNav(f.doc,'publishing'),null);
 assert.equal(mountDashboardSearch({doc:f.doc,expectedOwnerId:'owner-1',getOwnerId:async()=> 'owner-1',listFiles:async()=>files,onOpenFile:()=>true,onNavigate:()=>true,stylesheetUrl:'/search.css'}),null);
 f.search.destroy();
});
await check('ranking, filename limits and images use existing portal models',()=>{
 assert.equal(filePortal(files[0]),'youtube');
 assert.equal(filePortal(files[1]),'tiktok');
 assert.equal(filePortal(files[2]),'instagram');
 const data=searchDashboard('SMA-Export',{files,pages:['publishing','history']});
 assert.equal(data.filter(x=>x.type==='file').length,1);
 assert.equal(data.find(x=>x.type==='file').id,A);
 assert.equal(searchDashboard('SMA-Export',{files:[{...files[0],id:'malicious id'}],pages:[]}).length,0);
 assert.equal(searchDashboard('',{files,pages:['publishing'],limit:5}).length,5);
});
await check('dashboard integration uses existing authenticated RPC, not a second upload endpoint',async()=>{
 const s=await readFile(new URL('../app/dashboard.html',import.meta.url),'utf8');
 assert.match(s,/import \{mountDashboardSearch,findDashboardNav\}/);
 assert.match(s,/mountDashboardSearch\(\{/);
 assert.match(s,/supabase[.]rpc\('sma_publication_files_v1',\{p_action:'list'\}\)/);
 assert.match(s,/selectedFileId=fileId/);
 assert.match(s,/openOptimizer\(portal,trigger\)/);
 assert.match(s,/smaPublishingFileSearch/);
 assert.match(s,/const shown=needle\?files[.]filter/);
 assert.match(s,/pageNumber=Math[.]min\(pageNumber,Math[.]max\(0,Math[.]ceil\(shown[.]length\/10\)-1\)\)/);
 assert.match(s,/dashboardSearch\?[.]destroy\(\)/);
 const module=await readFile(new URL('../app/assets/dashboard-global-search.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(module,/https?:\/\/|\.upload\(|\.insert\(|\.update\(|approval_token|credit_pack/);
});
console.log(passed+' SMA global search and navigation DOM checks passed.');
