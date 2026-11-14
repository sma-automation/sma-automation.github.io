const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const modulePromise=import('../app/assets/dashboard-file-search.mjs');
const fixtures=[
 {id:'a',name:'SMA-Export-283abd16-3b72-4224-ab66-81b30afdab13.mp4',media_kind:'video',assignments:[{platform:'youtube',status:'assigned'}]},
 {id:'b',name:'Küche mit Wärmepumpe.mp4',media_kind:'video',assignments:[{platform:'tiktok',status:'assigned'}]},
 {id:'c',name:'Logo Gartenservice.png',media_kind:'image',assignments:[{platform:'facebook',status:'assigned'},{platform:'instagram',status:'assigned'}]},
 {id:'d',name:'SMA_STUMMER_GALERIE_TEST_10S_2026-11-09.mp4',media_kind:'video',assignments:[]}
];
test('file names are searchable by fragment, underscores, case and German accents',async()=>{
 const {filterDashboardFiles:f}=await modulePromise;
 assert.deepEqual(f(fixtures,'283abd16').map(x=>x.id),['a']);
 assert.deepEqual(f(fixtures,'SMA-Export').map(x=>x.id),['a']);
 assert.deepEqual(f(fixtures,'wArMePuMpE').map(x=>x.id),['b']);
 assert.deepEqual(f(fixtures,'STUMMER galerie').map(x=>x.id),['d']);
 assert.deepEqual(f(fixtures,'logo garten').map(x=>x.id),['c']);
 assert.deepEqual(f(fixtures,'does not exist'),[]);
 assert.deepEqual(f(fixtures,''),fixtures);
});
test('portal filters operate only on returned own file metadata',async()=>{
 const {filterDashboardFiles:f}=await modulePromise;
 assert.deepEqual(f(fixtures,'','youtube').map(x=>x.id),['a']);
 assert.deepEqual(f(fixtures,'','tiktok').map(x=>x.id),['b']);
 assert.deepEqual(f(fixtures,'','facebook').map(x=>x.id),['c']);
 assert.deepEqual(f(fixtures,'','instagram').map(x=>x.id),['c']);
 assert.deepEqual(f(fixtures,'','all'),fixtures);
 assert.deepEqual(f(fixtures,'Küche','youtube'),[]);
 assert.deepEqual(f(fixtures,'YouTube').map(x=>x.id),['a']);
});
test('filter ignores invalid catalog entries, never reads token or unrelated data',async()=>{
 const {filterDashboardFiles:f}=await modulePromise;
 const injected=[...fixtures,null,undefined,{}, {name:'foreign'}, {id:'evil',name:42},
  {id:'private',name:'Visible',credentials:{access_token:'SECRET_NEVER_INDEX'},assignments:[{platform:'unknown'}]}];
 const result=f(injected,'SECRET_NEVER_INDEX');
 assert.deepEqual(result,[]);
 assert.equal(f(injected,'Visible').length,1);
 assert.equal(f(null,'anything').length,0);
 assert.deepEqual(f(injected,'','youtube').map(x=>x.id),['a']);
});
test('search results paginate after filtering, not before',async()=>{
 const {filterDashboardFiles:f,searchFilePage:page}=await modulePromise;
 const many=Array.from({length:27},(_,i)=>({
  id:'file-'+i,name:(i%2?'Video':'Foto')+' '+String(i).padStart(2,'0'),
  media_kind:i%2?'video':'image',assignments:[]
 }));
 const video=f(many,'Video');
 assert.equal(video.length,13);
 assert.equal(page(video,'file-25'),1);
 assert.equal(page(video,'file-3'),0);
 assert.equal(page(video,'file-24'),-1);
 assert.equal(page(video,'unknown'),-1);
 assert.equal(page(null,'file-1'),-1);
});
test('dashboard search is in the existing publishing file area and opens the optimizer directly',()=>{
 const html=readFileSync('app/dashboard.html','utf8');
 assert.match(html,/id='smaFileSearch'/);
 assert.match(html,/id='smaFilePortalFilter'/);
 assert.match(html,/id='smaFindFiles'/);
 assert.match(html,/find\.addEventListener\('click',\(\)=>navigateDashboardArea\('files'\)\)/);
 assert.match(html,/dashboardChapters\?\.controllers\.get\('publishing'\)\?\.select\('files'\)/);
 assert.match(html,/const matches=filterDashboardFiles\(files,finder.value,portalFilter.value\)/);
 assert.match(html,/for\(const f of matches\.slice\(pageNumber\*10,pageNumber\*10\+10\)\)/);
 assert.match(html,/const open=doc.createElement\('button'\);open.type='button';open.textContent='Im Portal öffnen'/);
 assert.match(html,/openOptimizer\(portal,trigger\)/);
 assert.doesNotMatch(html,/window\.open\(.+smaFileSearch/);
 assert.doesNotMatch(html,/supabase\.rpc\('sma_publication_order_v1'/);
});
test('search is client-side only: no new API, upload or approval path',async()=>{
 const src=readFileSync('app/assets/dashboard-file-search.mjs','utf8');
 assert.doesNotMatch(src,/\bfetch\(|\bXMLHttpRequest\b|localStorage|sessionStorage|\.rpc\(|postMessage/i);
 assert.match(src,/Array\.isArray\(files\)/);
});

test('gallery receives the global query, resets the portal and opens the first filtered page',async()=>{
 const {parseHTML}=await import('./dom-runtime/node_modules/linkedom/esm/index.js');
 const {filterDashboardFiles}=await modulePromise;
 const html=readFileSync('app/dashboard.html','utf8');
 const source=html.slice(html.indexOf('function attachFileList('),html.indexOf('let pending;'));
 const {document,window}=parseHTML('<html><head></head><body><main><div id="publishingFilesSlot"></div></main></body></html>');
 const files=Array.from({length:24},(_,i)=>({id:'clip-'+i,name:'Küche Mai '+i+'.mp4',media_kind:'video',
  assignments:[{platform:i<12?'youtube':'tiktok',status:'assigned'}]}));
 files.push({id:'other',name:'Sommer.png',media_kind:'image',assignments:[]});
 const calls=[];
 const env={dashboardOwnerId:'owner',signedOut:false,selectedFileId:null,dashboardQuickFind:null,
  portalNames:{youtube:'YouTube',tiktok:'TikTok'},filterDashboardFiles,
  createMediaThumbnailLoader:()=>({reset(){},observe(){},clear(){}}),mountGalleryMusic:()=>null,
  supabase:{rpc:async(name,args)=>{calls.push([name,args.p_action]);return {data:{ok:true,files}};}}};
 const attach=require('node:vm').runInNewContext(source+'\nattachFileList',env);
 const gallery=attach(document,document.querySelector('main'));
 const portal=document.querySelector('#smaFilePortalFilter'),finder=document.querySelector('#smaFileSearch');
 // LinkeDOM exposes select.value as a getter. Emulate the native select setter.
 Object.defineProperty(portal,'value',{writable:true,value:'all'});
 await new Promise(resolve=>setImmediate(resolve));
 const next=()=>[...document.querySelectorAll('.sma-file-pages button')].find(b=>b.textContent==='Weiter');
 portal.value='youtube';portal.dispatchEvent(new window.Event('change'));next().click();
 assert.match(document.querySelector('.sma-file-pages').textContent,/Seite 2 von 2/);
 const routeSource=html.slice(html.indexOf('  function navigateDashboardArea('),html.indexOf('  dashboardQuickFind=ownerId&&fileView?mountDashboardQuickFind('));
 const visits=[];
 const optimizer={hidden:false};
 const navigate=require('node:vm').runInNewContext('('+routeSource+')',{
  signedOut:false,dashboardOwnerId:'owner',ownerId:'owner',fileView:gallery,optimizerPage:optimizer,
  sectionCatalog:(await import('../app/assets/dashboard-quick-find.mjs')).sectionCatalog,
  findAreaNavigation:key=>({click:()=>visits.push(key)}),
  location:{pathname:'/app/dashboard.html',search:''},
  history:{state:{smaOptimization:true},pushState:(_state,_title,url)=>visits.push(url)},
  showPublishing:()=>{optimizer.hidden=true;},
  dashboardChapters:{controllers:new Map([['publishing',{select:key=>{visits.push(key);return true;}}]])}
 });
 assert.equal(navigate('files','KÜCHE mai'),true);
 assert.deepEqual(visits,['files','/app/dashboard.html','files']);assert.equal(optimizer.hidden,true);
 assert.equal(finder.value,'KÜCHE mai');assert.equal(portal.value,'all');
 assert.match(document.querySelector('.sma-file-pages').textContent,/Seite 1 von 3/);
 assert.equal(document.querySelectorAll('.sma-gallery-select').length,10);
 next().click();next().click();
 const names=[...document.querySelectorAll('.sma-gallery-label')].map(el=>el.textContent);
 assert.deepEqual(names,files.slice(20,24).map(file=>'▶ '+file.name));
 assert.equal(gallery.focusSearch(),true);
 assert.match(document.querySelector('.sma-file-pages').textContent,/Seite 3 von 3/);
 optimizer.hidden=false;visits.length=0;
 assert.equal(navigate('portals'),true);
 assert.deepEqual(visits,['publishing','/app/dashboard.html','portals']);
 assert.equal(optimizer.hidden,true);
 env.dashboardOwnerId='other';assert.equal(gallery.focusSearch('private'),false);
 assert.equal(finder.value,'KÜCHE mai');assert.deepEqual(calls,[['sma_publication_files_v1','list']]);
 gallery.clear();
});
