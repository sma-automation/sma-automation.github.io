const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');

const html=readFileSync('app/dashboard.html','utf8');
const source=html.slice(html.indexOf('function attachFileList('),html.indexOf('\nlet pending;'));
const runtime=Promise.all([
 import('./dom-runtime/node_modules/linkedom/esm/index.js'),
 import('../app/assets/dashboard-file-search.mjs'),
 import('../app/assets/media-metadata.mjs')
]);
const initialTime=Date.parse('2026-11-17T12:00:00Z');
const knownFile={id:'known-file',name:'Kundenvideo.mp4',revision:'same-revision',media_kind:'video',
 modified_at:new Date(initialTime).toISOString(),verified_at:new Date(initialTime).toISOString(),assignments:[]};

function backend(){
 return {now:initialTime,files:[knownFile],syncState:'complete',syncedAt:new Date(initialTime).toISOString(),
  failLists:0,folderReply:{ok:true},onFolder:null,calls:[]};
}
async function mount(state){
 const [{parseHTML},{filterDashboardFiles,dashboardFileDescription,searchFilePage},{refreshMediaCatalog}]=await runtime;
 const {document}=parseHTML('<html><head></head><body><nav><button id="publicationNav">Veröffentlichung</button></nav><main><div id="publishingFilesSlot"></div></main></body></html>');
 class Clock extends Date {static now(){return state.now;}}
 const env={document,AbortController,setTimeout,clearTimeout,Date:Clock,
  dashboardOwnerId:'own-customer',signedOut:false,selectedFileId:null,dashboardQuickFind:null,
  portalNames:{youtube:'YouTube'},filterDashboardFiles,dashboardFileDescription,searchFilePage,
  createSharedThumbnailClient:()=>({dispose(){}}),
  createPortalVideoSource:()=>({clear(){}}),createHoverPlayback:()=>({attach(){},stop(){},destroy(){}}),
  createMediaThumbnailLoader:()=>({reset(){},observe(){},clear(){}}),mountGalleryMusic:()=>null,
   createMusicViewGate:()=>({isVisible:()=>true,subscribeVisibility:()=>()=>{}}),
  dashboardSession:read=>(read||((fn)=>fn()))(async()=>({user:{id:'own-customer'},access_token:'synthetic-session'})),
  customerMediaEndpoint:kind=>{assert.equal(kind,'catalog');return 'https://fixture.invalid/catalog';},
  fetch:async(url,options)=>{
   assert.equal(url,'https://fixture.invalid/catalog');assert.equal(options.method,'POST');
   assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
   assert.equal(options.headers.Authorization,'Bearer synthetic-session');
   options.signal.throwIfAborted();state.calls.push('n8n-catalog');state.onFolder?.();
   return {ok:true,json:async()=>state.folderReply};
  },
  supabase:{rpc:(name,args)=>{
   assert.equal(name,'sma_publication_files_v1');
   if(args.p_action==='sync_status'){
    assert.deepEqual(JSON.parse(JSON.stringify(args.p_input)),{});
    return {abortSignal:async signal=>{signal.throwIfAborted();state.calls.push('supabase-sync-status');return {data:{ok:true,version:1,can_publish:false,sync_state:state.syncState,retry_after_ms:state.syncState==='running'?120000:0,synced_at:state.syncedAt},error:null};}};
   }
   assert.equal(JSON.stringify(args),JSON.stringify({p_action:'list',p_input:{dashboard_labels:true}}));
   return {abortSignal:async signal=>{
    signal.throwIfAborted();state.calls.push('supabase-list');
    if(state.failLists){state.failLists--;return {data:null,error:Error('synthetic list outage')};}
    return {data:{ok:true,files:state.files,synced_at:state.syncedAt,sync_state:state.syncState},error:null};
   }};
  }}
 };
 env.refreshMediaCatalog=options=>refreshMediaCatalog({...options,host:env,now:()=>state.now,request:env.fetch,endpoint:()=>env.customerMediaEndpoint('catalog')});
 const attach=vm.runInNewContext(source+'\nattachFileList',env);
 const gallery=attach(document,document.querySelector('main'),'https://sma.test/app/media-editor.html');
 const refresh=document.querySelector('.sma-file-toolbar button');
 async function click(button){
  button.click();
  for(let turn=0;refresh.disabled&&turn<100;turn++)await new Promise(setImmediate);
  assert.equal(refresh.disabled,false,'the synthetic request should have settled');
 }
 await gallery.initialRead;
 return {gallery,document,refresh,nav:document.querySelector('#publicationNav'),click,
  nativeStarts:()=>state.calls.filter(call=>call==='n8n-catalog').length,
  listReads:()=>state.calls.filter(call=>call==='supabase-list').length,
  fileIds:()=>Array.from(gallery.getFiles(),file=>file.id),
  close:()=>gallery.clear()};
}

test('opening the saved gallery, repeated navigation and a fresh reload never start a folder workflow',async()=>{
 const state=backend();let view=await mount(state);
 try{
  assert.deepEqual(view.fileIds(),['known-file']);assert.equal(view.nativeStarts(),0);
  for(let visit=0;visit<3;visit++){
   state.now+=61001;await view.click(view.nav);
   assert.equal(view.gallery.getCatalogState(),'ready');assert.deepEqual(view.fileIds(),['known-file']);
   assert.equal(view.nativeStarts(),0,'ordinary navigation must only read the saved list');
  }
  assert.equal(view.listReads(),4);
  view.close();view=await mount(state);await view.click(view.nav);
  assert.equal(view.nativeStarts(),0);assert.equal(view.listReads(),6);
  assert.deepEqual(view.fileIds(),['known-file']);
 }finally{view.close();}
});

test('an explicit folder refresh starts once, then later navigation only reads the refreshed catalogue',async()=>{
 const state=backend(),view=await mount(state);
 state.onFolder=()=>{state.files=[knownFile,{...knownFile,id:'new-file',name:'Neues Video.mp4'}];};
 try{
  assert.equal(view.refresh.textContent,'Dateien aktualisieren');await view.click(view.refresh);
  assert.equal(view.nativeStarts(),1);assert.deepEqual(view.fileIds(),['known-file','new-file']);
  for(let visit=0;visit<3;visit++){state.now+=61001;await view.click(view.nav);}
  assert.equal(view.nativeStarts(),1);assert.deepEqual(view.fileIds(),['known-file','new-file']);
 }finally{view.close();}
});

test('a running folder check is observed through saved status without starting another workflow',async()=>{
 const state=backend();state.syncState='running';const view=await mount(state);
 try{
  assert.equal(view.refresh.textContent,'Abgleichstatus prüfen');await view.click(view.refresh);
  state.now+=61001;await view.click(view.nav);
  assert.equal(view.nativeStarts(),0);assert.deepEqual(view.fileIds(),['known-file']);
  state.syncState='complete';await view.click(view.refresh);
  assert.equal(view.refresh.textContent,'Dateien aktualisieren');assert.equal(view.nativeStarts(),0);
  assert.equal(view.gallery.getCatalogState(),'ready');
 }finally{view.close();}
});

test('retrying a failed saved-list read retains known files and does not turn into a folder refresh',async()=>{
 const state=backend(),view=await mount(state);
 try{
  state.failLists=1;state.now+=61001;await view.click(view.nav);
  assert.equal(view.gallery.getCatalogState(),'error');assert.deepEqual(view.fileIds(),['known-file']);
  assert.equal(view.refresh.textContent,'Dateiliste erneut laden');assert.equal(view.nativeStarts(),0);
  await view.click(view.refresh);
  assert.equal(view.gallery.getCatalogState(),'ready');assert.deepEqual(view.fileIds(),['known-file']);
  assert.equal(view.nativeStarts(),0);assert.equal(view.listReads(),3);
 }finally{view.close();}
});

test('a list retry after an explicit successful folder check does not repeat that check',async()=>{
 const state=backend(),view=await mount(state);
 try{
  state.failLists=1;await view.click(view.refresh);
  assert.equal(view.nativeStarts(),1);assert.equal(view.refresh.textContent,'Dateiliste erneut laden');
  assert.deepEqual(view.fileIds(),['known-file']);await view.click(view.refresh);
  assert.equal(view.gallery.getCatalogState(),'ready');assert.deepEqual(view.fileIds(),['known-file']);
  assert.equal(view.nativeStarts(),1);
 }finally{view.close();}
});

test('an interrupted check stays visible until an explicit refresh; navigation does not silently restart it',async()=>{
 const state=backend();state.syncState='interrupted';const view=await mount(state);
 try{
  state.now+=61001;await view.click(view.nav);
  assert.equal(view.nativeStarts(),0);assert.deepEqual(view.fileIds(),['known-file']);
  assert.match(view.gallery.catalogWarning(),/nicht abgeschlossen/);
  state.onFolder=()=>{state.syncState='complete';};await view.click(view.refresh);
  assert.equal(view.nativeStarts(),1);assert.equal(view.gallery.catalogWarning(),'');
 }finally{view.close();}
});
