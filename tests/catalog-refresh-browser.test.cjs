const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const origin='https://sma-catalog-refresh-fixture.test';
const owner='cc980000-0000-4000-8000-000000000091',otherOwner='cc980000-0000-4000-8000-000000000092';
const standard='https://johnmusic.app.n8n.cloud/webhook/sma-publication-files-v1';
const pilot='https://johnmusic.app.n8n.cloud/webhook/sma-kundenmedien-katalog-pilot-v1';
const status=extra=>({ok:true,version:1,can_publish:false,sync_state:'idle',retry_after_ms:0,synced_at:null,...extra});
const html='<!doctype html><html><head><meta charset="utf-8"><title>Synthetic catalogue refresh</title><link rel="icon" href="data:,"></head><body><p>Read-only synthetic catalogue fixture</p><script type="module" src="/fixture.mjs"></script></body></html>';

// The public refreshMediaCatalog wrapper, its shared coordinator and route
// selection run unchanged in separate real browser realms. Only authentication
// and backend receipts are synthetic. Every network request is intercepted.
const bootstrap=`
import {refreshMediaCatalog} from '/app/assets/media-metadata.mjs';
import {syncSharedCatalogRefreshOwner} from '/app/assets/catalog-refresh.mjs';
const fixture=window.fixture={owner:'${owner}',clock:1000,sessionReads:0,statusReads:0,results:{},controllers:new Map(),pending:new Map()};
const now=()=>{try{return window.top.fixture.clock;}catch{return fixture.clock;}};
const getSession=async()=>{fixture.sessionReads++;return fixture.owner?{user:{id:fixture.owner},access_token:'synthetic-'+fixture.owner}:null;};
async function readStatus(signal){
 fixture.statusReads++;
 const response=await fetch('/fixture-status',{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',signal,
  headers:{Authorization:'Bearer synthetic-'+fixture.owner}});
 if(!response.ok)throw Error('FILE_SYNC_UNAVAILABLE');return response.json();
}
fixture.start=(key,options={})=>{
 const controller=new AbortController();fixture.controllers.set(key,controller);fixture.results[key]={state:'pending'};
 const promise=refreshMediaCatalog({getSession,readStatus,owner:options.owner||fixture.owner,signal:controller.signal,now,
  ...(options.endpoint?{endpoint:options.endpoint}:{})})
 .then(()=>fixture.results[key]={state:'complete'},error=>fixture.results[key]={state:'failed',message:error.message});
 fixture.pending.set(key,promise);
};
fixture.result=key=>fixture.pending.get(key);
fixture.abort=key=>fixture.controllers.get(key).abort();
fixture.changeOwner=id=>{fixture.owner=id;syncSharedCatalogRefreshOwner(id);};
fixture.initialSnapshot=id=>syncSharedCatalogRefreshOwner(id,undefined,{initial:true});
fixture.advance=ms=>{fixture.clock+=ms;};
syncSharedCatalogRefreshOwner(fixture.owner,undefined,{initial:true});
// Frame teardown is handled by the actual production wrapper. The fixture adds
// no unload/pagehide cleanup that could hide a broken detached-frame lifecycle.
fixture.ready=true;
`;

async function fixture(browser,mobile,{holdFirst=false,loseFirst=false}={}){
 const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},
  isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
 const posts=[],statusReads=[],unexpected=[],errors=[],fixtureErrors=[];
 let currentStatus=status(),releaseHeld=null,firstStarted,closing=false;
 const started=new Promise(resolve=>{firstStarted=resolve;});
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.stack||error.message)));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  try{
   if([standard,pilot].includes(url.origin+url.pathname)){
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*',
     'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization,Content-Type'}});
    assert.equal(request.method(),'POST');assert.ok(['Bearer synthetic-'+owner,'Bearer synthetic-'+otherOwner].includes(request.headers().authorization));
    posts.push({url:url.href,frame:request.frame().url(),authorization:request.headers().authorization});
    if(holdFirst&&posts.length===1)await new Promise(resolve=>{releaseHeld=resolve;firstStarted();});
    else if(posts.length===1)firstStarted();
    if(loseFirst&&posts.length===1)return route.abort('failed');
    return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({ok:true})});
   }
   if(url.origin===origin){
    if(url.pathname==='/fixture.html')return route.fulfill({contentType:'text/html; charset=utf-8',body:html});
    if(url.pathname==='/fixture.mjs')return route.fulfill({contentType:'text/javascript',body:bootstrap});
    if(url.pathname==='/fixture-status'){
     assert.equal(request.method(),'POST');assert.ok(['Bearer synthetic-'+owner,'Bearer synthetic-'+otherOwner].includes(request.headers().authorization));
     statusReads.push({frame:request.frame().url(),authorization:request.headers().authorization});
     return route.fulfill({contentType:'application/json',body:JSON.stringify(currentStatus)});
    }
    if(/^\/app\/assets\/[\w.-]+\.m?js$/.test(url.pathname))return route.fulfill({contentType:'text/javascript',
     body:fs.readFileSync(path.join(process.cwd(),url.pathname.slice(1)),'utf8')});
   }
   unexpected.push(request.url());return route.abort();
  }catch(error){
   if(closing)return;fixtureErrors.push(error.stack||error.message);
   try{return await route.fulfill({status:500,body:'Invalid synthetic request'});}catch{}
  }
 });
 const ready=page=>page.waitForFunction(()=>window.fixture?.ready,undefined,{polling:50,timeout:10000});
 const open=async()=>{const page=await context.newPage();await page.goto(origin+'/fixture.html');await ready(page);return page;};
 async function frame(page,name){
  const navigation=page.waitForEvent('framenavigated',{predicate:frame=>frame.name()===name&&frame.url().startsWith(origin+'/fixture.html')});
  await page.evaluate(name=>{const frame=document.createElement('iframe');frame.name=name;frame.title=name;
   frame.src='/fixture.html?frame='+name;document.body.append(frame);},name);
  const child=await navigation;await ready(child);return child;
 }
 const release=()=>{releaseHeld?.();releaseHeld=null;};
 const clean=()=>{assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);assert.deepEqual(fixtureErrors,[]);};
 return {context,posts,statusReads,started,open,frame,ready,release,clean,status:value=>{currentStatus=value;},
  async close(){closing=true;release();await context.close();}};
}
const start=(target,key,options)=>target.evaluate(({key,options})=>fixture.start(key,options),{key,options});
async function result(target,key){
 await target.waitForFunction(key=>fixture.results[key]?.state!=='pending',key,{polling:25,timeout:10000});
 return target.evaluate(key=>fixture.results[key],key);
}
async function noPersistence(page){
 const stores=await page.evaluate(async()=>({local:localStorage.length,session:sessionStorage.length,
  databases:typeof indexedDB.databases==='function'?(await indexedDB.databases()).length:0}));
 assert.deepEqual(stores,{local:0,session:0,databases:0});
}

const runtime=process.env.SMA_TEST_PLAYWRIGHT?pathToFileURL(process.env.SMA_TEST_PLAYWRIGHT).href:'./dom-runtime/node_modules/playwright-core/index.mjs';
// CI must fail if its pinned browser runtime is missing; a missing dependency
// must never turn this acceptance gate into a silently skipped browser test.
const skip=process.env.CI!=='true'?'Real Chrome acceptance runs in CI; this suite never launches local Chrome':false;
test('real browser catalogue refresh shares native starts and survives consumer and frame lifecycles',
 {skip,timeout:120000},async t=>{
 const {chromium}=await import(runtime);
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome',
  args:process.env.SMA_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]});
 try{
  for(const mobile of [false,true]){
   const device=mobile?'mobile':'desktop';
   await t.test(device+': three same-origin consumers share one POST, one cancellation, then a later explicit refresh',async()=>{
    const f=await fixture(browser,mobile,{holdFirst:true});try{
     const page=await f.open(),first=await f.frame(page,'first'),second=await f.frame(page,'second');
     await start(first,'first');await f.started;await Promise.all([start(page,'parent'),start(second,'second')]);
     await page.waitForFunction(()=>fixture.sessionReads>0,undefined,{polling:50,timeout:10000});
     await second.waitForFunction(()=>fixture.sessionReads>0,undefined,{polling:50,timeout:10000});
     assert.equal(f.posts.length,1);await first.evaluate(()=>fixture.abort('first'));
     assert.equal((await result(first,'first')).state,'failed');f.release();
     assert.deepEqual(await result(page,'parent'),{state:'complete'});assert.deepEqual(await result(second,'second'),{state:'complete'});
     assert.equal(f.posts.length,1);await start(page,'immediate');assert.match((await result(page,'immediate')).message,/FILE_SYNC_RATE_LIMITED/);
     assert.equal(f.posts.length,1);await page.evaluate(()=>fixture.advance(15000));await start(page,'later');
     assert.deepEqual(await result(page,'later'),{state:'complete'});assert.equal(f.posts.length,2);
     await noPersistence(page);await noPersistence(first);await noPersistence(second);f.clean();
    }finally{await f.close();}
   });

   await t.test(device+': removing the initiating iframe leaves its joined parent consumer alive',async()=>{
    const f=await fixture(browser,mobile,{holdFirst:true});try{
     const page=await f.open(),child=await f.frame(page,'initiator');
     await start(child,'child');await f.started;assert.equal(f.posts.length,1);
     assert.equal(f.posts[0].frame,page.url(),'The surviving top window owns the transport realm');
     await start(page,'parent');await page.waitForFunction(()=>fixture.sessionReads>0,undefined,{polling:50,timeout:10000});
     await page.evaluate(()=>document.querySelector('iframe[name="initiator"]').remove());f.release();
     assert.deepEqual(await result(page,'parent'),{state:'complete'});assert.equal(f.posts.length,1);
     await noPersistence(page);f.clean();
    }finally{await f.close();}
   });

   await t.test(device+': reload and another window read known running or cooldown status without another POST',async()=>{
    const f=await fixture(browser,mobile);try{
     const page=await f.open();await start(page,'first');assert.deepEqual(await result(page,'first'),{state:'complete'});assert.equal(f.posts.length,1);
     f.status(status({sync_state:'running',retry_after_ms:100000}));await page.reload();await f.ready(page);
     await start(page,'reload');assert.match((await result(page,'reload')).message,/FILE_SYNC_RUNNING/);assert.equal(f.posts.length,1);
     const second=await f.open();await start(second,'second');assert.match((await result(second,'second')).message,/FILE_SYNC_RUNNING/);assert.equal(f.posts.length,1);
     f.status(status({sync_state:'complete',retry_after_ms:14000,synced_at:'2026-11-17T12:00:00Z'}));
     await page.reload();await f.ready(page);await start(page,'cooldown');assert.match((await result(page,'cooldown')).message,/FILE_SYNC_RATE_LIMITED/);assert.equal(f.posts.length,1);
     f.status(status({sync_state:'complete',synced_at:'2026-11-17T12:00:00Z'}));
     await page.evaluate(()=>fixture.advance(15000));await start(page,'later');assert.deepEqual(await result(page,'later'),{state:'complete'});
     assert.equal(f.posts.length,2);assert.ok(f.statusReads.length>=5);await noPersistence(page);f.clean();
    }finally{await f.close();}
   });

   await t.test(device+': a lost response cannot blind-start again and a server running receipt blocks a later retry',async()=>{
    const f=await fixture(browser,mobile,{loseFirst:true});try{
     const page=await f.open();await start(page,'lost');assert.equal((await result(page,'lost')).state,'failed');assert.equal(f.posts.length,1);
     await start(page,'quick-retry');assert.match((await result(page,'quick-retry')).message,/FILE_SYNC_RATE_LIMITED/);assert.equal(f.posts.length,1);
     f.status(status({sync_state:'running',retry_after_ms:90000}));await page.evaluate(()=>fixture.advance(15000));
     const before=f.statusReads.length;await start(page,'reconciled');assert.match((await result(page,'reconciled')).message,/FILE_SYNC_RUNNING/);
     assert.ok(f.statusReads.length>before);assert.equal(f.posts.length,1);f.clean();
    }finally{await f.close();}
   });

   await t.test(device+': a cancelled dispatched consumer cannot immediately authorize another start',async()=>{
    const f=await fixture(browser,mobile,{holdFirst:true});try{
     const page=await f.open();await start(page,'cancelled');await f.started;await page.evaluate(()=>fixture.abort('cancelled'));
     assert.equal((await result(page,'cancelled')).state,'failed');await start(page,'retry');
     assert.match((await result(page,'retry')).message,/FILE_SYNC_RATE_LIMITED/);assert.equal(f.posts.length,1);
     f.release();f.status(status({sync_state:'running',retry_after_ms:100000}));await page.reload();await f.ready(page);
     await start(page,'after-reload');assert.match((await result(page,'after-reload')).message,/FILE_SYNC_RUNNING/);
     assert.equal(f.posts.length,1);f.clean();
    }finally{await f.close();}
   });

   await t.test(device+': logout clears old work while stale frame authentication cannot replace the next owner',async()=>{
    const f=await fixture(browser,mobile,{holdFirst:true});try{
     const page=await f.open();await start(page,'old');await f.started;
     await page.evaluate(()=>fixture.changeOwner(null));assert.equal((await result(page,'old')).state,'failed');
     f.release();await page.evaluate(otherOwner=>fixture.changeOwner(otherOwner),otherOwner);
     await start(page,'new');assert.deepEqual(await result(page,'new'),{state:'complete'});assert.equal(f.posts.length,2);
     const stale=await f.frame(page,'stale-owner');await start(stale,'stale');
     assert.match((await result(stale,'stale')).message,/AUTH_REQUIRED/);assert.equal(f.posts.length,2);
     await stale.evaluate(owner=>fixture.initialSnapshot(owner),owner);await stale.evaluate(()=>fixture.initialSnapshot(null));
     await start(page,'preserved');assert.match((await result(page,'preserved')).message,/FILE_SYNC_RATE_LIMITED/);
     assert.equal(f.posts.length,2);assert.equal(f.posts[1].authorization,'Bearer synthetic-'+otherOwner);f.clean();
    }finally{await f.close();}
   });
  }
 }finally{await browser.close();}
});
