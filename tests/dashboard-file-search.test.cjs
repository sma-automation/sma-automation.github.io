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
 assert.match(html,/fileView\?\.focusSearch\(\)/);
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
 assert.doesNotMatch(src,/\bfetch\(|\bXMLHttpRequest\b|localStorage|sessionStorage|\.rpc\(|postMessage|approve|upload|publish/i);
 assert.match(src,/Array\.isArray\(files\)/);
});
