const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const page=readFileSync('app/assets/media-editor-page.mjs','utf8');
const startup='(async()=>{'+page.slice(page.indexOf('const query ='))+'})()';

async function open({pilot=true,ok=true,owners=['owner'],error=false}={}) {
 const {parseHTML}=await import('./dom-runtime/node_modules/linkedom/esm/index.js');
 const {document,window}=parseHTML(readFileSync('app/media-editor.html','utf8'));
 const calls=[],mounts=[];
 let checked=0,listener;
 const getOwnerId=async()=>owners[Math.min(checked++,owners.length-1)];
 await vm.runInNewContext(startup,{
  document,window,location:{search:pilot?'?kundenmedien=pilot':'',hash:'#asset=chosen&revision=r%3A2&portal=tiktok'},
  URLSearchParams,getOwnerId,editorMusicLibrary:()=>({}),
  editorPilotAccess:async owner=>{calls.push(owner);if(error)throw Error();return {ok};},
  watchOwner:async cb=>{listener=cb;return {unsubscribe(){}};},
  mountMediaEditor:options=>{mounts.push(options);return {invalidateOwner(){},destroy(){}};}
 });
 return {document,calls,mounts,listener};
}

test('pilot editor checks the account before mounting and retains the mode on the dashboard return',async()=>{
 const {document,calls,mounts,listener}=await open();
 assert.deepEqual(calls,['owner']);assert.equal(mounts.length,1);
 assert.equal(mounts[0].initialAssetId,'chosen');assert.equal(mounts[0].initialAssetRevision,'r:2');assert.equal(mounts[0].initialAssetPortal,'tiktok');
 assert.equal(document.documentElement.dataset.smaCustomerMedia,'pilot');
 assert.match(document.getElementById('backDashboard').href,/dashboard\.html\?kundenmedien=pilot$/);
 listener('different');assert.equal(document.documentElement.dataset.smaCustomerMedia,undefined);
});

test('ordinary editor opens without a pilot check; signed-out, refused and switched pilots never mount',async()=>{
 const regular=await open({pilot:false});
 assert.equal(regular.mounts.length,1);assert.equal(regular.calls.length,0);
 assert.equal(regular.document.documentElement.dataset.smaCustomerMedia,undefined);
 for(const settings of [{owners:[null]},{ok:false},{owners:['owner','other']},{error:true}]){
  const f=await open(settings);assert.equal(f.mounts.length,0);
  assert.equal(f.document.documentElement.dataset.smaCustomerMedia,undefined);
  assert.equal(f.document.getElementById('backDashboard').getAttribute('href'),'./dashboard.html');
 }
});
