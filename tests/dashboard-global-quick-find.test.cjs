const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const imported=import('../app/assets/dashboard-quick-find.mjs');
const parser=import('./dom-runtime/node_modules/linkedom/esm/index.js');
const files=[
 {id:'a',name:'SMA-Export-283abd16.mp4',media_kind:'video',assignments:[{platform:'youtube',status:'assigned'}]},
 {id:'b',name:'Gartenservice Frühling.png',media_kind:'image',assignments:[{platform:'instagram',status:'assigned'}]}
];
test('section list finds main dashboard areas without reading external services',async()=>{
 const {quickFindMatches,sectionCatalog}=await imported;
 assert(sectionCatalog.some(s=>s.key==='files'));
 assert(sectionCatalog.some(s=>s.key==='history'));
 assert(sectionCatalog.some(s=>s.key==='shop'));
 assert(sectionCatalog.some(s=>s.key==='music'));
 assert(sectionCatalog.some(s=>s.key==='settings'));
 const r=quickFindMatches('bestellungen',sectionCatalog,files);
 assert.deepEqual(r.areas.map(x=>x.key),['shop']);
 assert.deepEqual(r.files,[]);
 assert.deepEqual(quickFindMatches('283abd',sectionCatalog,files).files.map(f=>f.id),['a']);
 assert.deepEqual(quickFindMatches('FRUHLING',sectionCatalog,files).files.map(f=>f.id),['b']);
 assert.equal(quickFindMatches('x',sectionCatalog,files).files.length,0);
});
async function fixture({areas=['overview','files','publishing']}={}){
 const {parseHTML}=await parser;
 const {document:doc,window}=parseHTML('<html><head></head><body><header class="topbar"><div class="topbar-title">Dashboard</div><div class="topbar-actions"><span id="profile">Profil</span><button id="logout">Abmelden</button></div></header><main><div id="page-overview"></div><div id="page-publishing"></div></main></body></html>');
 window.HTMLElement.prototype.focus=function(){};
 const calls=[];
 const module=await imported;
 const view=module.mountDashboardQuickFind({
  doc,getAreas:()=>module.sectionCatalog.filter(s=>areas.includes(s.key)),
  getFiles:()=>files,
  onNavigate:(key,query)=>{calls.push('section:'+key+(query===undefined?'':':'+query));return true;},
  onOpenFile:id=>{calls.push('file:'+id);return true;}
 });
 return {doc,window,view,calls,get:id=>doc.getElementById(id)};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('global search opens in same dashboard and finds a file via typed filename',async()=>{
 const f=await fixture();
 assert(f.view);
 assert.equal(f.get('profile').textContent,'Profil');
 assert.equal(f.get('logout').textContent,'Abmelden');
 f.get('smaGlobalQuickFind').click();
 assert.equal(f.get('smaQuickFindDialog').hidden,false);
 const input=f.get('smaQuickFindInput');
 input.value='283abd';
 input.dispatchEvent(new f.window.Event('input',{bubbles:true}));
 const matches=[...f.get('smaQuickFindResults').querySelectorAll('button')];
 assert.equal(matches.length,1);
 assert.match(matches[0].textContent,/SMA-Export/);
 matches[0].click();await tick();
 assert.deepEqual(f.calls,['file:a']);
 assert.equal(f.get('smaQuickFindDialog').hidden,true);
 f.view.destroy();
 assert.equal(f.get('smaQuickFindDialog'),null);
 assert.equal(f.get('smaGlobalQuickFind'),null);
});
test('order searches use existing sections rather than loading account data into global results',async()=>{
 const f=await fixture({areas:['overview','history','shop']});f.view.show();
 const input=f.get('smaQuickFindInput');input.value='1001';
 input.dispatchEvent(new f.window.Event('input',{bubbles:true}));
 const names=[...f.get('smaQuickFindResults').querySelectorAll('button')].map(x=>x.textContent);
 assert(names.some(x=>x.includes('In Aufträgen suchen')));
 assert(names.some(x=>x.includes('In Bestellungen suchen')));
 const history=[...f.get('smaQuickFindResults').querySelectorAll('button')].find(x=>x.textContent.includes('In Aufträgen suchen'));
 history.click();await tick();
 assert.deepEqual(f.calls,['section:history-search:1001']);
 assert.equal(f.get('smaQuickFindDialog').hidden,true);
 f.view.show();input.value='1001';input.dispatchEvent(new f.window.Event('input',{bubbles:true}));
 const orders=[...f.get('smaQuickFindResults').querySelectorAll('button')].find(x=>x.textContent.includes('In Bestellungen suchen'));
 orders.click();await tick();
 assert.deepEqual(f.calls,['section:history-search:1001','section:shop-search:1001']);
 f.view.destroy();
});
test('quick search does not expose files that are absent from the caller’s own catalog',async()=>{
 const f=await fixture();
 f.view.show();
 const input=f.get('smaQuickFindInput');input.value='foreign-secret-file';
 input.dispatchEvent(new f.window.Event('input',{bubbles:true}));
 assert.equal(f.get('smaQuickFindResults').querySelectorAll('button').length,0);
 assert.match(f.get('smaQuickFindPanel').textContent,/Keine Treffer/);
 assert.deepEqual(f.calls,[]);
 f.view.destroy();
});
test('quick search navigates to existing area and closes with Escape',async()=>{
 const f=await fixture();f.view.show();
 const input=f.get('smaQuickFindInput');input.value='dateien';
 input.dispatchEvent(new f.window.Event('input',{bubbles:true}));
 const buttons=[...f.get('smaQuickFindResults').querySelectorAll('button')];
 assert(buttons.length);
 buttons.find(b=>/Meine Dateien/.test(b.textContent)).click();await tick();
 assert.deepEqual(f.calls,['section:files']);
 assert.equal(f.get('smaQuickFindDialog').hidden,true);
 f.view.show();const esc=new f.window.Event('keydown',{bubbles:true,cancelable:true});esc.key='Escape';f.doc.dispatchEvent(esc);
 assert.equal(f.get('smaQuickFindDialog').hidden,true);
 f.view.destroy();
});
test('dashboard integration routes through existing sidebar and preserves session cleanup',()=>{
 const src=readFileSync('app/dashboard.html','utf8');
 assert.match(src,/mountDashboardQuickFind,sectionCatalog/);
 assert.match(src,/fileView\?\.getFiles\(\)/);
 assert.match(src,/dashboardChapters\?\.controllers\.get\('publishing'\)\?\.select\('files'\)/);
 assert.match(src,/return fileView\.openFile\(id\)===true/);
 assert.match(src,/dashboardQuickFind\?\.destroy\(\)/);
 assert.match(src,/const nav=findAreaNavigation\(target\)/);
 assert.match(src,/key==='history-search'/);
 assert.match(src,/key==='shop-search'/);
 assert.match(src,/getElementById\('smaHistorySearch'\)/);
 assert.match(src,/getElementById\('smaOrderSearch'\)/);
});
test('finder has no network, browser storage, posting or own access control bypass',()=>{
 const src=readFileSync('app/assets/dashboard-quick-find.mjs','utf8');
 assert.doesNotMatch(src,/\bfetch\s*\(|\.rpc\s*\(|XMLHttpRequest|localStorage|sessionStorage|window\.open|location\.href/);
 assert.match(src,/filterDashboardFiles\(files\|\|\[\],q\)/);
 assert.match(src,/getFiles\(\)/);
});
