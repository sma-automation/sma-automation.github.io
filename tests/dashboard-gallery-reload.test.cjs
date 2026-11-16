const {test}=require('node:test');
const assert=require('node:assert/strict');
const modulePromise=import('../app/assets/dashboard-gallery-reload.mjs');
const view={query:'Aufnahme',portal:'youtube',page:99,selected:'clip-a',file:'clip-b',focus:'file'};

function tab(){
 const entries=new Map();
 const sessionStorage={getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};
 return {sessionStorage,location:{href:'https://fixture.invalid/dashboard.html'},performance:{getEntriesByType:()=>[{type:'reload'}]}};
}
test('only a reload in the same tab, route and customer account restores a gallery selection',async()=>{
 const {galleryReloadStore}=await modulePromise;
 for(const variation of ['same','account','route','new visit','back','separate tab']){
  const win=tab();galleryReloadStore(win).save('customer-a',view);
  let next=win;
  if(variation==='route')win.location.href+='#auftrag/example';
  if(variation==='new visit'||variation==='back')win.performance.getEntriesByType=()=>[{type:variation==='back'?'back_forward':'navigate'}];
  if(variation==='separate tab')next=tab();
  const store=galleryReloadStore(next);
  assert.deepEqual(store.take(variation==='account'?'customer-b':'customer-a'),variation==='same'?view:null);
  assert.equal(store.take('customer-a'),null);
 }
});
test('leaving the gallery, logging out or receiving invalid saved filters discards the snapshot',async()=>{
 const {galleryReloadStore}=await modulePromise;
 const store=galleryReloadStore(tab());
 store.save('customer-a',view);store.save('customer-a',null);assert.equal(store.take('customer-a'),null);
 store.save('customer-a',view);store.clear();assert.equal(store.take('customer-a'),null);
 for(const invalid of [{portal:'missing'},{page:-1},{page:1.5},{selected:42},{focus:'approve'}]){
  store.save('customer-a',{...view,...invalid});assert.equal(store.take('customer-a'),null);
 }
});
test('search preview reload binds the return path to its owner, file, portal and current history entry',async()=>{
 const {galleryReloadStore,previewReloadSnapshot,previewMatchesHistory}=await modulePromise;
 const route={smaOptimization:true,view:'preview',portal:'youtube',assetId:'clip-a',searchKey:'first-entry'};
 const origin={global:true,id:'clip-a',page:'overview',chapter:'account',query:'Werkstatt',launcher:{id:'account-tab',dataset:{},textContent:'omit'}};
 const snapshot=previewReloadSnapshot(route,origin);
 assert.deepEqual(snapshot.origin,{global:true,query:'Werkstatt',page:'overview',chapter:'account',launcherId:'account-tab',mobile:false});
 assert.equal(previewMatchesHistory(snapshot,route),true);
 for(const change of [{view:'files'},{searchKey:'second-entry'},{assetId:'clip-b'},{portal:'tiktok'},{smaOptimization:false}]){
  assert.equal(previewMatchesHistory(snapshot,{...route,...change}),false);
 }
 const win=tab();
 const save=()=>galleryReloadStore(win).save('owner',snapshot);
 save();assert.equal(galleryReloadStore(win).take('other'),null);
 save();assert.deepEqual(galleryReloadStore(win).take('owner'),snapshot);
 save();win.location.href+='#different';assert.equal(galleryReloadStore(win).take('owner'),null);
 assert.equal(previewReloadSnapshot(route,{...origin,id:'clip-b'}),null);
 assert.equal(previewReloadSnapshot(route,{...origin,page:0}),null);
 const gallery=previewReloadSnapshot(route,{id:'clip-a',query:'Werkstatt',page:3,portal:'all'});
 assert.deepEqual(gallery.origin,{global:false,query:'Werkstatt',page:3,portal:'all'});
});

test('portal return restores just the platform and control for the same customer and reload',async()=>{
 const {galleryReloadStore}=await modulePromise;
 const same=galleryReloadStore(tab()),view={kind:'portal-action',portal:'tiktok',action:'connect'};
 same.save('first',{...view,href:'template-only'});assert.deepEqual(same.take('first'),view);
 for(const invalid of [{portal:'all'},{portal:'other'},{action:'publish'}]){
  same.save('first',{...view,...invalid});assert.equal(same.take('first'),null);
 }
 same.save('first',view);assert.equal(same.take('second'),null);
});
test('a search editor reload retains its exact source view and rejects a different history entry',async()=>{
 const {galleryReloadStore,previewReloadSnapshot,previewMatchesHistory}=await modulePromise;
 const origin={global:true,id:'clip-a',page:'overview',chapter:'account',query:'Werkstatt',launcher:{id:'search',dataset:{}}};
 for(const view of ['source','preview']){
  const route={smaOptimization:true,view,portal:'youtube',assetId:'clip-a',searchKey:'original-search'};
  const snapshot=previewReloadSnapshot(route,origin);
  assert(snapshot);assert.equal(snapshot.view,view);assert(previewMatchesHistory(snapshot,route));
  const win=tab(),store=galleryReloadStore(win);store.save('owner',snapshot);
  assert.deepEqual(store.take('owner'),snapshot);
  for(const change of [{view:view==='source'?'preview':'source'},{searchKey:'new-search'},{assetId:'clip-b'},{portal:'tiktok'}]){
   assert.equal(previewMatchesHistory(snapshot,{...route,...change}),false);
  }
 }
 const route={smaOptimization:true,view:'files',portal:'youtube',assetId:'clip-a',searchKey:'original-search'};
 assert.equal(previewReloadSnapshot(route,origin),null);
 const snapshot=previewReloadSnapshot({...route,view:'preview'},origin);
 delete snapshot.view;assert(previewMatchesHistory(snapshot,{...route,view:'preview'}),'older preview-only snapshots remain compatible');
 const store=galleryReloadStore(tab());store.save('owner',{...snapshot,view:'publish'});assert.equal(store.take('owner'),null);
});
