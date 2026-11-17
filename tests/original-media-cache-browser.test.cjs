const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');

const origin='https://sma-original-read-fixture.test',foreignOrigin='https://sma-original-isolated-fixture.test';
const owner='ac900000-0000-4000-8000-000000000091',otherOwner='ac900000-0000-4000-8000-000000000092';
const assetId='ac900000-0000-4000-8000-000000000001';
const original=fs.readFileSync('tests/fixtures/original-video.mp4');
const digest=createHash('sha256').update(original).digest('hex');
const file={id:assetId,revision:'sha256:'+digest+':1',name:'Synthetic original video',media_kind:'video',mime_type:'video/mp4',
 duration_ms:10000,width_px:320,height_px:240,size_bytes:original.length};
const html=fs.readFileSync('app/media-editor.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'')
 .replace('</head>','<link rel="icon" href="data:,"></head>')
 .replace('</body>','<script type="module" src="/fixture.mjs"></script></body>');

// The complete editor, both original/export consumers, editorSource and its new
// RAM service are unmodified production modules. Only auth, backend replies and
// rendering are synthetic. Every network request is fulfilled or aborted below.
const bootstrap=`
import {mountMediaEditor} from '/app/assets/media-editor-view.mjs';
import {editorDefaults} from '/app/assets/media-editor-model.mjs';
import {editorSource,getOwnerId,watchOwner} from '/app/assets/media-editor-api.mjs';
const expectedOwner='${owner}',file=${JSON.stringify(file)};
const fixture=window.fixture={owner:expectedOwner,file,sources:[],sourceErrors:[],realms:[],renders:[],calls:[],authCallbacks:new Set(),sessionReads:0};
let saved={revision:0,settings:{...editorDefaults},saved_at:null,changed:false};
const state=()=>({ok:true,version:1,can_publish:false,asset_id:file.id,asset_revision:file.revision,...saved});
function inspect(blob){let topRealm=null;try{topRealm=blob instanceof window.top.Blob;}catch{}
 return {ownRealm:blob instanceof Blob,topRealm,size:blob.size,type:blob.type};}
fixture.read=async(selected=file,asOwner=fixture.owner)=>inspect(await editorSource(selected,new AbortController().signal,asOwner));
const source=async(selected,signal)=>{
 fixture.sources.push({id:selected.id||selected.asset_id,revision:selected.revision||selected.asset_revision});
 try{const blob=await editorSource(selected,signal,expectedOwner);fixture.realms.push(inspect(blob));return blob;}
 catch(error){fixture.sourceErrors.push({name:error.name,message:error.message,aborted:signal.aborted});throw error;}
};
fixture.view=mountMediaEditor({doc:document,expectedOwnerId:expectedOwner,getOwnerId,source,
 request:async(action,input)=>{
  fixture.calls.push({action,input});if(!['get','save'].includes(action))throw Error('Unexpected draft action');
  if(action==='save')saved={revision:saved.revision+1,settings:{...input.settings},saved_at:'2026-11-17T12:00:00Z',changed:true};
  return state();
 },listFiles:async()=>({ok:true,files:[file]}),thumbnail:async()=>new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'}),
 uuid:()=>crypto.randomUUID(),exportDependencies:{source,
  request:async(action,input)=>{fixture.calls.push({action:'export-'+action,input});if(action!=='list')throw Error('Export preparation or publication is forbidden');return {ok:true,version:1,can_publish:false,exports:[]};},
  upload:async()=>{throw Error('Real or synthetic media uploads are forbidden in this read-only journey');},
  render:async args=>{if(!(args.source instanceof Blob))throw Error('Renderer received a foreign-realm blob');
   fixture.renders.push({id:args.file.id,revision:args.file.revision,settings:args.settings,sourceSize:args.source.size});
   return {media:args.source.slice(0,args.source.size,'video/mp4'),cover:new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'})};}
 }});
const subscription=await watchOwner(id=>fixture.view.invalidateOwner(id));
fixture.emitAuth=(event,id)=>{const session=id?{user:{id},access_token:'synthetic-'+id}:null;
 for(const callback of fixture.authCallbacks)callback(event,session);};
fixture.changeOwner=async id=>{fixture.owner=id;fixture.emitAuth(id?'SIGNED_IN':'SIGNED_OUT',id);};
window.addEventListener('pagehide',()=>{fixture.view.destroy();subscription.unsubscribe();},{once:true});
fixture.ready=true;
`;
const authModule=`
export function createClient(){return {auth:{
 getSession:async()=>{const f=window.fixture;f.sessionReads++;return {error:null,data:{session:f.owner?{user:{id:f.owner},access_token:'synthetic-'+f.owner}:null}};},
 onAuthStateChange:callback=>{const f=window.fixture;f.authCallbacks.add(callback);return {data:{subscription:{unsubscribe(){f.authCallbacks.delete(callback);}}}};}
}};}
`;

async function fixture(browser,mobile,{holdFirstOriginal=false}={}){
 const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},
  isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
 const transfers=[],unexpected=[],pageErrors=[],fixtureErrors=[],consoleErrors=[],failedRequests=[];
 let releaseHeld=null,started;
 const originalStarted=new Promise(resolve=>{started=resolve;});
 const releaseOriginal=()=>{releaseHeld?.();releaseHeld=null;};
 context.on('page',page=>{
  page.on('pageerror',error=>pageErrors.push(error.stack||error.message));
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
 });
 context.on('requestfailed',request=>failedRequests.push({url:request.url(),error:request.failure()?.errorText}));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  try{
   if(url.href==='https://esm.sh/@supabase/supabase-js@2.57.4')return route.fulfill({contentType:'text/javascript',body:authModule,headers:{'Access-Control-Allow-Origin':'*'}});
   if(url.origin==='https://johnmusic.app.n8n.cloud'&&['/webhook/sma-publication-editor-source-v1','/webhook/sma-kundenmedien-original-pilot-v1'].includes(url.pathname)){
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*',
     'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization,Content-Type'}});
    assert.equal(request.method(),'POST');assert.deepEqual(request.postDataJSON(),{asset_id:assetId,asset_revision:file.revision});
    assert.ok(['Bearer synthetic-'+owner,'Bearer synthetic-'+otherOwner].includes(request.headers().authorization));
    transfers.push({url:url.href,frame:request.frame().url(),authorization:request.headers().authorization});
    if(holdFirstOriginal&&transfers.length===1)await new Promise(resolve=>{releaseHeld=resolve;started();});
    return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({
     ok:true,can_publish:false,asset_id:assetId,asset_revision:file.revision,mime_type:'video/mp4',
     size_bytes:original.length,sha256:digest,data_base64:original.toString('base64')})});
   }
   if([origin,foreignOrigin].includes(url.origin)){
    if(url.pathname==='/app/media-editor.html')return route.fulfill({contentType:'text/html; charset=utf-8',body:html});
    if(url.pathname==='/fixture.mjs')return route.fulfill({contentType:'text/javascript',body:bootstrap});
    if(/^\/app\/assets\/[\w.-]+\.(?:m?js|css)$/.test(url.pathname))return route.fulfill({
     contentType:url.pathname.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(path.join(process.cwd(),url.pathname.slice(1)),'utf8')});
   }
   unexpected.push(request.url());return route.abort();
  }catch(error){fixtureErrors.push(error.stack);return route.fulfill({status:500,body:'Invalid synthetic request'});}
 });
 async function diagnostics(target){
  const page=typeof target.frames==='function'?target:target.page();
  const frames=await Promise.all(page.frames().map(async frame=>{
   try{return await frame.evaluate(()=>{
    const f=window.fixture,$=id=>document.getElementById(id);let host=window;
    try{if(window.top.location.origin===location.origin)host=window.top;}catch{}
    const registry=host[Symbol.for('sma.original.media.v1')];
    return {url:location.href,readyState:document.readyState,visibility:document.visibilityState,ready:f?.ready,
     owner:f?.owner,sessionReads:f?.sessionReads,status:$('status')?.textContent,editorHidden:$('editor')?.hidden,
     appHidden:$('app')?.hidden,assetDisabled:$('asset')?.disabled,originalStatus:$('originalVideoPreview')?.querySelector('p')?.textContent,
     originalHidden:$('originalVideoPreview')?.querySelector('video')?.hidden,originalReadyState:$('originalVideoPreview')?.querySelector('video')?.readyState,
     sources:f?.sources,sourceErrors:f?.sourceErrors,realms:f?.realms,calls:f?.calls.map(call=>call.action),
     registry:registry?{owner:registry.owner,epoch:registry.epoch,cacheEntries:registry.cache.size,running:registry.running.size,
      pending:[...registry.pending.values()].map(job=>({asset:job.file.id,consumers:job.consumers.size,aborted:job.scope.signal.aborted}))}:null};
   });}catch(error){return {url:frame.url(),unavailable:error.message};}
  }));
  return {frames,transfers,unexpected,pageErrors,fixtureErrors,consoleErrors,failedRequests};
 }
 async function wait(target,label,predicate,arg){
  // These predicates observe state, not animation frames. Timer polling also
  // works while Chrome suspends rAF for an offscreen cross-origin iframe.
  try{return await target.waitForFunction(predicate,arg,{polling:50});}
  catch(error){throw new Error(label+' failed: '+error.message+'\nFixture diagnostics: '+JSON.stringify(await diagnostics(target)),{cause:error});}
 }
 const ready=page=>wait(page,'Editor ready',()=>window.fixture?.ready&&!document.querySelector('#editor').hidden&&!document.querySelector('#asset').disabled);
 const open=async()=>{const page=await context.newPage();await page.goto(origin+'/app/media-editor.html');await ready(page);return page;};
 const frame=async(page,frameOrigin,name)=>{
  const navigated=page.waitForEvent('framenavigated',{predicate:frame=>frame.name()===name&&frame.url().startsWith(frameOrigin+'/app/media-editor.html')});
  await page.evaluate(({frameOrigin,name})=>{const frame=document.createElement('iframe');frame.name=name;frame.title=name;
   frame.src=frameOrigin+'/app/media-editor.html?frame='+name;frame.style.width='100%';frame.height='850';document.body.append(frame);},{frameOrigin,name});
  const target=await navigated;
  // Chrome can suspend requestAnimationFrame in an offscreen foreign iframe.
  // Make the actual editor visible before waiting for its visual readiness.
  await page.locator('iframe[name="'+name+'"]').scrollIntoViewIfNeeded();
  await ready(target);return target;
 };
 const clean=()=>{assert.deepEqual(unexpected,[]);assert.deepEqual(pageErrors,[]);assert.deepEqual(fixtureErrors,[]);};
 return {context,transfers,open,ready,wait,diagnostics,frame,clean,originalStarted,releaseOriginal,
  async close(){releaseOriginal();await context.close();}};
}
async function beginOriginalPreview(page){
 await page.getByRole('tab',{name:'Schnitt & Cover',exact:true}).click();
 await page.getByRole('button',{name:'Originalvideo laden',exact:true}).click();
}
async function originalPreview(page,f){
 await beginOriginalPreview(page);
 await f.wait(page,'Original preview ready',()=>!document.querySelector('#originalVideoPreview video').hidden&&document.querySelector('#originalVideoPreview p').textContent==='Originalvideo geladen.');
 assert.equal(await page.locator('#originalVideoPreview video').isVisible(),true);
}
async function assertNoPersistence(page){
 const storage=await page.evaluate(async()=>({local:localStorage.length,session:sessionStorage.length,databases:typeof indexedDB.databases==='function'?(await indexedDB.databases()).length:0}));
 assert.deepEqual(storage,{local:0,session:0,databases:0});
}
const runtime=process.env.SMA_TEST_PLAYWRIGHT?pathToFileURL(process.env.SMA_TEST_PLAYWRIGHT).href:'./dom-runtime/node_modules/playwright-core/index.mjs';
test('real browser editorSource reuses exact original bytes only inside its authorized live top window',
 {skip:!process.env.SMA_TEST_PLAYWRIGHT&&!fs.existsSync('tests/dom-runtime/node_modules/playwright-core/index.mjs')?'Pinned browser runtime is installed in CI':false,timeout:90000},async t=>{
 const {chromium}=await import(runtime);
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome',
  args:process.env.SMA_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]});
 try{
  for(const mobile of [false,true]){
   const device=mobile?'mobile':'desktop';
   await t.test(device+': real editor journey needs one original POST; reload and another tab each need a new one',async()=>{
    const f=await fixture(browser,mobile);try{
     const page=await f.open();assert.equal(f.transfers.length,0);
     await originalPreview(page,f);assert.equal(f.transfers.length,1);
     await page.locator('[name=cover_ms]').fill('0.5');await page.getByRole('button',{name:'Entwurf speichern',exact:true}).click();
     await page.waitForFunction(()=>document.querySelector('#savedInfo').textContent.includes('Version 1'));
     await page.getByRole('tab',{name:'Export',exact:true}).click();await page.locator('#generateExport').click();
     await page.waitForFunction(()=>!document.querySelector('#exportResult').hidden&&!document.querySelector('#generateExport').disabled);
     assert.equal(f.transfers.length,1);assert.equal(await page.evaluate(()=>fixture.renders.length),1);
     await originalPreview(page,f);assert.equal(f.transfers.length,1);assert.equal(await page.evaluate(()=>fixture.sources.length),3);
     assert.deepEqual(await page.evaluate(()=>fixture.realms.map(value=>value.ownRealm)),[true,true,true]);
     assert.ok((await page.evaluate(()=>fixture.calls.map(call=>call.action))).every(action=>['get','save','export-list'].includes(action)));
     await assertNoPersistence(page);
     await page.reload();await f.ready(page);assert.equal(f.transfers.length,1,'Opening a fresh document remains read-only');
     await originalPreview(page,f);assert.equal(f.transfers.length,2,'Reload discards the old RAM; no reload saving is claimed');
     const second=await f.open();assert.equal(f.transfers.length,2);await originalPreview(second,f);
     assert.equal(f.transfers.length,3,'A second top window cannot reuse the first window memory');
     await assertNoPersistence(second);f.clean();
    }finally{await f.close();}
   });
   await t.test(device+': same-origin iframe receives its own Blob realm while a foreign-origin iframe reads separately',async()=>{
    const f=await fixture(browser,mobile);try{
     const page=await f.open();await originalPreview(page,f);assert.equal(f.transfers.length,1);
     const same=await f.frame(page,origin,'same-origin');await originalPreview(same,f);
     assert.equal(f.transfers.length,1);assert.deepEqual(await same.evaluate(()=>fixture.realms),[
      {ownRealm:true,topRealm:false,size:original.length,type:'video/mp4'}]);
     const foreign=await f.frame(page,foreignOrigin,'foreign-origin');await originalPreview(foreign,f);
     assert.equal(f.transfers.length,2);assert.equal(await foreign.evaluate(()=>fixture.realms[0].ownRealm),true);
     await assertNoPersistence(page);await assertNoPersistence(same);await assertNoPersistence(foreign);f.clean();
    }finally{await f.close();}
   });
   await t.test(device+': removing the first iframe during a shared top-window transfer leaves the parent consumer alive',async()=>{
    const f=await fixture(browser,mobile,{holdFirstOriginal:true});try{
     const page=await f.open(),child=await f.frame(page,origin,'pending-original');
     await beginOriginalPreview(child);await f.originalStarted;assert.equal(f.transfers.length,1);
     assert.equal(f.transfers[0].frame,page.url(),'The shared transfer uses the surviving top-window fetch realm');
     const before=await page.evaluate(()=>fixture.sessionReads);await beginOriginalPreview(page);
     await f.wait(page,'Parent joined shared transfer',before=>fixture.sources.length===1&&fixture.sessionReads>=before+2,before);
     await page.evaluate(()=>document.querySelector('iframe[name="pending-original"]').remove());
     f.releaseOriginal();
     await f.wait(page,'Parent received original after iframe removal',()=>!document.querySelector('#originalVideoPreview video').hidden&&fixture.realms.length===1);
     assert.equal(f.transfers.length,1);assert.deepEqual(await page.evaluate(()=>fixture.realms),[
      {ownRealm:true,topRealm:true,size:original.length,type:'video/mp4'}]);
     await assertNoPersistence(page);f.clean();
    }finally{await f.close();}
   });
   await t.test(device+': the actual adapter remains usable after repeated persisted pagehide/pageshow cycles',async()=>{
    const f=await fixture(browser,mobile);try{
     const page=await f.open();assert.equal((await page.evaluate(()=>fixture.read())).ownRealm,true);assert.equal(f.transfers.length,1);
     // This deliberately exercises adapter lifecycle in the same live document,
     // not a reload-saving claim. The separate test above proves a real reload
     // and another top window each fetch their own source again.
     for(let n=0;n<2;n++){
      await page.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
      const result=await page.evaluate(()=>fixture.read());assert.equal(result.ownRealm,true);assert.equal(result.size,original.length);
     }
     assert.equal(f.transfers.length,1);await assertNoPersistence(page);f.clean();
    }finally{await f.close();}
   });
   await t.test(device+': the actual auth subscription invalidates old original bytes on logout and owner changes',async()=>{
    const f=await fixture(browser,mobile);try{
     const page=await f.open();await originalPreview(page,f);assert.equal(f.transfers.length,1);
     await page.evaluate(async()=>{await fixture.changeOwner(null);});
     assert.equal(await page.locator('#login').isVisible(),true);
     const failure=await page.evaluate(async owner=>{try{await fixture.read(fixture.file,owner);return null;}catch(error){return error.message;}},owner);
     assert.equal(failure,'AUTH_REQUIRED');assert.equal(f.transfers.length,1);
     await page.evaluate(otherOwner=>fixture.changeOwner(otherOwner),otherOwner);
     assert.equal((await page.evaluate(()=>fixture.read())).ownRealm,true);assert.equal(f.transfers.length,2);
     await page.evaluate(()=>fixture.read());assert.equal(f.transfers.length,2);
     // A delayed initial snapshot from another frame is not a new login/logout.
     // Exercise the registered production API callback, leaving the actual
     // current SDK session at B throughout both stale notifications.
     for(const initialOwner of [owner,null]){
      await page.evaluate(initialOwner=>fixture.emitAuth('INITIAL_SESSION',initialOwner),initialOwner);
      assert.equal((await page.evaluate(()=>fixture.read())).ownRealm,true);
      assert.equal(f.transfers.length,2,'A stale INITIAL_SESSION cannot reverse B or evict its verified bytes');
     }
     await page.evaluate(owner=>fixture.changeOwner(owner),owner);await page.evaluate(()=>fixture.read());assert.equal(f.transfers.length,3);
     assert.deepEqual(f.transfers.map(call=>call.authorization),['Bearer synthetic-'+owner,'Bearer synthetic-'+otherOwner,'Bearer synthetic-'+owner]);
     await assertNoPersistence(page);f.clean();
    }finally{await f.close();}
   });
  }
 }finally{await browser.close();}
});
