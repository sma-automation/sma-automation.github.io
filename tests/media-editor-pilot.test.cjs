const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const page=readFileSync('app/assets/media-editor-page.mjs','utf8');
const startup='(async()=>{'+page.slice(page.indexOf('const query ='))+'})()';

async function open({pilot=true,ok=true,owners=['owner'],error=false,drive=false}={}) {
 const {parseHTML}=await import('./dom-runtime/node_modules/linkedom/esm/index.js');
 const {document,window}=parseHTML(readFileSync('app/media-editor.html','utf8'));
 const calls=[],mounts=[];
 let checked=0,listener,redirect;
 const getOwnerId=async()=>owners[Math.min(checked++,owners.length-1)];
 await vm.runInNewContext(startup,{
  document,window,location:{search:'?'+[pilot?'kundenmedien=pilot':'',drive?'drive=folder':''].filter(Boolean).join('&'),replace:href=>{redirect=href;},hash:'#asset=chosen&revision=r%3A2&portal=tiktok'},
  URLSearchParams,getOwnerId,editorDriveFolder:async id=>{assert.equal(id,'owner');return 'https://drive.google.com/drive/folders/test-input-folder';},editorMusicLibrary:()=>({}),
  editorPilotAccess:async owner=>{calls.push(owner);if(error)throw Error();return {ok};},
  watchOwner:async cb=>{listener=cb;return {unsubscribe(){}};},
  mountMediaEditor:options=>{mounts.push(options);return {invalidateOwner(){},destroy(){}};}
 });
 return {document,calls,mounts,listener,redirect};
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

test('Drive opens the assigned folder only after successful auth, without mounting a media draft',async()=>{
 const own=await open({pilot:false,drive:true});
 assert.equal(own.redirect,'https://drive.google.com/drive/folders/test-input-folder');assert.equal(own.mounts.length,0);
 const changed=await open({pilot:false,drive:true,owners:['owner','peer']});
 assert.equal(changed.redirect,undefined);assert.equal(changed.mounts.length,0);
 assert.equal(changed.document.getElementById('retry').hidden,false);
});
