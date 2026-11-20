'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {browserSource}=require('../n8n/consolidation/patch-dashboard-oauth-refresh.cjs');
const {root,origin,endpoint,owner,otherOwner,customer,otherCustomer,shell,dashboardReadSource,controlledClock}=require('./fixtures/oauth-return-fixture.cjs');

const parentHtml='<!doctype html><html><head><meta charset="utf-8"><title>Synthetic dashboard return</title><link rel="icon" href="data:,"></head><body><iframe id="dashboard" name="dashboard-oauth-fixture" title="Kundenbereich" style="width:100%;height:1800px;border:0"></iframe><script type="module" src="/oauth-parent.mjs"></script></body></html>';
const parentCode=`
const fixture=window.fixture={owner:${JSON.stringify(owner)},starts:0,settled:0,applied:[],leaves:0};
const endpoint=${JSON.stringify(endpoint)};
const supabase={auth:{getSession:async()=>({data:{session:fixture.owner?{user:{id:fixture.owner},access_token:'synthetic-'+fixture.owner}:null},error:null})},rpc(){throw Error('Unexpected synthetic dashboard RPC');}};
let dashboardOwnerId=fixture.owner,signedOut=false;
const fetch=(...args)=>{fixture.starts++;return window.fetch(...args);};
function leaveDashboard(){signedOut=true;dashboardOwnerId=null;cancelDashboardReads();fixture.leaves++;document.getElementById('dashboard')?.remove();}
${dashboardReadSource()}
const actualDashboardResponse=window.smaDashboardResponse;
window.smaDashboardResponse=async()=>{try{return await actualDashboardResponse();}finally{fixture.settled++;}};
fixture.changeOwner=value=>{fixture.owner=value;};
fixture.logout=()=>{fixture.owner=null;leaveDashboard();};
fixture.detach=()=>document.getElementById('dashboard')?.remove();
document.getElementById('dashboard').srcdoc=${JSON.stringify(shell().replace('</body>','<script type="module" src="/oauth-child.mjs"></script></body>'))};
`;
const childCode=`
import {mountDashboardChapters} from '/app/assets/dashboard-chapters.mjs';
const clock=(${controlledClock.toString()})(Date.now());
const fixture=window.fixture={clock,applied:0,ready:false};
// Only this already-loaded synthetic child uses controlled timers/Date.now.
// The parent navigation, performance clock and real dashboard deadline remain native.
window.setTimeout=clock.setTimeout;window.clearTimeout=clock.clearTimeout;Date.now=clock.now;
function currentLanguage(){return 'de';}
function setLanguage(){fixture.applied++;window.parent.fixture.applied.push({customer:document.querySelector('.app').dataset.smaCustomerId,revision:document.querySelector('#page-social .platform-card').dataset.fixtureRevision});}
${browserSource()}
fixture.chapters=mountDashboardChapters({doc:document,stylesheetUrl:'/synthetic-chapters.css'});
// Suppress only navigation after the real capture-phase connection handler ran.
// No OAuth provider, popup, token or callback is used by this test.
document.addEventListener('click',event=>{if(event.target.closest?.('a[href]'))event.preventDefault();});
fixture.returned=()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));};
fixture.success=(platform='YouTube',zeit=Date.now(),origin=${JSON.stringify(origin)})=>window.dispatchEvent(new MessageEvent('message',{origin,data:{type:'sma-oauth-success',platform,zeit}}));
fixture.storage=(platform='YouTube',zeit=Date.now())=>window.dispatchEvent(new StorageEvent('storage',{key:'sma_oauth_success',newValue:JSON.stringify({type:'sma-oauth-success',platform,zeit})}));
fixture.advance=ms=>clock.advance(ms,async()=>{for(let i=0;i<20;i++)await Promise.resolve();});
fixture.ready=true;
`;
// Validate the generated fixture scripts even when local browser execution is
// deliberately disabled. The imported chapter module is independently parsed.
new Function(parentCode);
new Function(childCode.replace(/^\s*import[^\n]+\n/,''));

async function setup(browser,mobile){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},
  isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
 const posts=[],replies=[],unexpected=[],errors=[],routeErrors=[],waiters=[];let closing=false;
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.stack||error.message)));
 const wake=()=>{for(const waiter of [...waiters])if(posts.length>=waiter.count){waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve();}};
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  try{
   if(url.href===endpoint){
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':origin,
     'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization'}});
    assert.equal(request.method(),'POST');assert.equal(request.headers().authorization,'Bearer synthetic-'+owner);
    const reply=replies.shift()||{},row={reply,authorization:request.headers().authorization};posts.push(row);
    let held;if(reply.hold)held=new Promise(resolve=>{row.release=resolve;});wake();
    if(held)await held;
    if(reply.error)return route.abort('failed');
    return route.fulfill({status:reply.status??200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin},body:JSON.stringify({html:reply.html??shell(reply)})});
   }
   if(url.origin===origin){
    if(url.pathname==='/oauth-fixture.html')return route.fulfill({contentType:'text/html',body:parentHtml});
    if(url.pathname==='/oauth-parent.mjs')return route.fulfill({contentType:'text/javascript',body:parentCode});
    if(url.pathname==='/oauth-child.mjs')return route.fulfill({contentType:'text/javascript',body:childCode});
    if(url.pathname==='/synthetic-chapters.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(root,'app/assets/dashboard-chapters.css'),'utf8')});
    if(['/app/assets/dashboard-chapters.mjs','/app/assets/dashboard-portal-connections.mjs','/app/assets/publication-daily-schedule.mjs'].includes(url.pathname))
     return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,url.pathname.slice(1)),'utf8')});
   }
   unexpected.push(request.url());return route.abort();
  }catch(error){if(!closing)routeErrors.push(error.stack||error.message);try{await route.abort();}catch{}}
 });
 const page=await context.newPage();await page.goto(origin+'/oauth-fixture.html');
 await page.waitForFunction(()=>{const frame=document.getElementById('dashboard'),doc=frame?.contentDocument;
  return frame?.contentWindow?.fixture?.ready&&doc&&[...doc.styleSheets].some(sheet=>sheet.href?.endsWith('/synthetic-chapters.css')&&sheet.cssRules.length>0);
 },undefined,{polling:50,timeout:10000});
 const child=page.frames().find(frame=>frame.name()==='dashboard-oauth-fixture');assert.ok(child);assert.equal(child.url(),'about:srcdoc');
 const waitPosts=count=>posts.length>=count?Promise.resolve():new Promise((resolve,reject)=>{
  const waiter={count,resolve,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(Error('Synthetic dashboard POST '+count+' was not observed'));},10000)};waiters.push(waiter);
 });
 const idle=()=>page.waitForFunction(()=>{const doc=document.getElementById('dashboard')?.contentDocument;
  return doc&&doc.querySelector('.sma-oauth-status-check')?.disabled===false;},undefined,{polling:50,timeout:10000});
 const f={context,page,child,posts,replies,waitPosts,idle,
  click:platform=>child.locator('#page-social .platform-card[data-sma-platform="'+(platform||'YouTube')+'"] .platform-action a').click(),
  returned:()=>child.evaluate(()=>fixture.returned()),advance:ms=>child.evaluate(ms=>fixture.advance(ms),ms),
  success:(platform='YouTube',extra={})=>child.evaluate(({platform,extra})=>fixture.success(platform,extra.zeit??Date.now(),extra.origin),{platform,extra}),
  release(index=0){assert.equal(typeof posts[index]?.release,'function');posts[index].release();},
  async count(expected){assert.equal(await page.evaluate(()=>fixture.starts),expected);assert.equal(posts.length,expected);},
  clean(){assert.deepEqual(unexpected,[],'no unapproved or provider URL may be contacted');assert.deepEqual(errors,[]);assert.deepEqual(routeErrors,[]);},
  async close(){closing=true;for(const row of posts)row.release?.();for(const waiter of waiters)clearTimeout(waiter.timer);await context.close();}
 };
 return f;
}
const runtime=process.env.SMA_TEST_PLAYWRIGHT?pathToFileURL(process.env.SMA_TEST_PLAYWRIGHT).href:'./dom-runtime/node_modules/playwright-core/index.mjs';
const skip=process.env.CI!=='true'?'Real Chrome acceptance runs in CI; this suite never launches local Chrome':false;
test('real dashboard OAuth return uses bounded checks and preserves the visible publishing controls',
 {skip,timeout:120000},async t=>{
 const {chromium}=await import(runtime);
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome',
  args:process.env.SMA_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]});
 try{
  for(const mobile of [false,true]){
   const device=mobile?'mobile':'desktop';
   await t.test(device+': a cancelled connection and six returns issue one POST; manual checks remain visible after replacement',async()=>{
    const f=await setup(browser,mobile);try{
     const panel=f.child.locator('.sma-oauth-status');
     assert.equal(await panel.evaluate(element=>getComputedStyle(element).display),'none');assert.equal(await panel.isVisible(),false);
     await f.child.locator('#unsaved').fill('Lokale Eingabe bleibt');await f.click();
     assert.equal(await panel.evaluate(element=>getComputedStyle(element).display),'block');assert.equal(await panel.isVisible(),true);
     await f.returned();await f.advance(350);await f.waitPosts(1);await f.idle();
     for(let i=0;i<6;i++){await f.returned();await f.advance(1000);}
     await f.count(1);
     const check=f.child.locator('.sma-oauth-status-check');assert.equal(await check.isVisible(),true);
     assert.equal(await check.evaluate(button=>button.closest('.platform-list')===null&&button.closest('#page-publishing')!==null),true);
     await f.child.locator('#sma-publishing-tab-files').click();assert.equal(await check.isVisible(),false);
     assert.equal(await panel.evaluate(element=>element.closest('[hidden]')?.getAttribute('data-chapter')),'portals');
     await f.child.locator('#sma-publishing-tab-portals').click();assert.equal(await check.isVisible(),true);
     f.replies.push({connected:['YouTube'],revision:'manual-one'});await check.click();await f.advance(0);await f.waitPosts(2);await f.idle();
     assert.equal(await f.child.locator('#page-social .platform-card[data-sma-platform="YouTube"]').evaluate(card=>card.classList.contains('connected')),true);
     assert.equal(await f.child.locator('#unsaved').inputValue(),'Lokale Eingabe bleibt');assert.equal(await check.isVisible(),true);
     f.replies.push({connected:['YouTube','TikTok'],revision:'manual-two'});await check.click();await f.advance(0);await f.waitPosts(3);await f.idle();
     assert.equal(await f.child.locator('[data-sma-social-count]').textContent(),'2');await f.returned();await f.advance(1000);await f.count(3);f.clean();
    }finally{await f.close();}
   });

   await t.test(device+': a lost dashboard response never becomes automatic retry traffic',async()=>{
    const f=await setup(browser,mobile);try{
     f.replies.push({error:true});await f.click();await f.returned();await f.advance(350);await f.waitPosts(1);await f.idle();
     assert.match(await f.child.locator('.sma-oauth-status-message').textContent(),/nicht geprüft/);
     for(let i=0;i<6;i++){await f.returned();await f.advance(4000);}await f.count(1);
     f.replies.push({connected:['YouTube']});await f.child.locator('.sma-oauth-status-check').click();await f.advance(0);await f.waitPosts(2);await f.idle();await f.count(2);f.clean();
    }finally{await f.close();}
   });

   await t.test(device+': success while the old return is running queues one fresh snapshot and deduplicates both channels',async()=>{
    const f=await setup(browser,mobile);try{
     f.replies.push({hold:true,connected:['YouTube'],revision:'old'},{hold:true,connected:['YouTube'],revision:'fresh'});
     await f.click();await f.returned();await f.advance(350);await f.waitPosts(1);
     await f.child.evaluate(()=>{fixture.success();fixture.storage();fixture.success();});await f.advance(250);await f.count(1);
     f.release(0);await f.waitPosts(2);assert.deepEqual(await f.page.evaluate(()=>fixture.applied),[]);
     f.release(1);await f.idle();assert.deepEqual(await f.page.evaluate(()=>fixture.applied.map(value=>value.revision)),['fresh']);
     await f.child.evaluate(()=>{const zeit=Date.now()-250;fixture.success('YouTube',zeit);fixture.storage('YouTube',zeit);});
     await f.returned();await f.advance(5000);await f.count(2);f.clean();
    }finally{await f.close();}
   });

   await t.test(device+': another connection click survives the old response with one queued request',async()=>{
    const f=await setup(browser,mobile);try{
     f.replies.push({hold:true,connected:['YouTube'],revision:'old'},{hold:true,connected:['TikTok'],revision:'next'});
     await f.click();await f.returned();await f.advance(350);await f.waitPosts(1);
     await f.click('TikTok');await f.returned();await f.advance(350);await f.count(1);
     f.release(0);await f.waitPosts(2);assert.deepEqual(await f.page.evaluate(()=>fixture.applied),[]);
     f.release(1);await f.idle();assert.deepEqual(await f.page.evaluate(()=>fixture.applied.map(value=>value.revision)),['next']);
     assert.equal(await f.child.locator('.sma-oauth-status-check').getAttribute('data-sma-platform'),'TikTok');
     await f.returned();await f.advance(1000);await f.count(2);f.clean();
    }finally{await f.close();}
   });

   await t.test(device+': malformed hints and a foreign customer response cannot change the connection display',async()=>{
    const f=await setup(browser,mobile);try{
     await f.click();await f.child.evaluate(()=>{fixture.success('TikTok');fixture.success('YouTube',Date.now()-120001);fixture.success('YouTube',Date.now(),'https://attacker.invalid');});
     await f.advance(500);await f.count(0);
     f.replies.push({customerId:otherCustomer,connected:['YouTube']});await f.returned();await f.advance(350);await f.waitPosts(1);await f.idle();
     assert.deepEqual(await f.page.evaluate(()=>fixture.applied),[]);
     assert.equal(await f.child.locator('.app').getAttribute('data-sma-customer-id'),customer);
     assert.equal(await f.child.locator('[data-sma-social-count]').textContent(),'0');await f.returned();await f.advance(1000);await f.count(1);f.clean();
    }finally{await f.close();}
   });

   await t.test(device+': removing the initiating frame discards its late response; an owner switch cancels the parent read',async()=>{
    const detached=await setup(browser,mobile);try{
     detached.replies.push({hold:true,connected:['YouTube']});await detached.click();await detached.returned();await detached.advance(350);await detached.waitPosts(1);
     await detached.page.evaluate(()=>fixture.detach());detached.release();
     await detached.page.waitForFunction(()=>document.getElementById('dashboard')===null&&fixture.settled===1,undefined,{polling:50,timeout:10000});
     assert.deepEqual(await detached.page.evaluate(()=>fixture.applied),[]);await detached.count(1);detached.clean();
    }finally{await detached.close();}
    const switched=await setup(browser,mobile);try{
     switched.replies.push({hold:true,connected:['YouTube']});await switched.click();await switched.returned();await switched.advance(350);await switched.waitPosts(1);
     await switched.page.evaluate(otherOwner=>fixture.changeOwner(otherOwner),otherOwner);switched.release();
     await switched.page.waitForFunction(()=>fixture.leaves===1,undefined,{polling:50,timeout:10000});
     assert.deepEqual(await switched.page.evaluate(()=>fixture.applied),[]);await switched.count(1);switched.clean();
    }finally{await switched.close();}
   });

   await t.test(device+': persisted page transitions pause timers and old responses while keeping the manual status check usable',async()=>{
    const f=await setup(browser,mobile);try{
     await f.click();await f.returned();
     await f.child.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
     await f.advance(1000);await f.count(0);
     await f.child.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
     await f.returned();await f.advance(1000);await f.count(0);
     const check=f.child.locator('.sma-oauth-status-check');assert.equal(await check.isVisible(),true);assert.equal(await check.isEnabled(),true);
     f.replies.push({hold:true,connected:['YouTube'],revision:'before-cache'});
     await check.click();await f.advance(0);await f.waitPosts(1);
     await f.child.evaluate(()=>{
      window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
      window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
      fixture.returned();document.querySelector('.sma-oauth-status-check').click();
     });
     await f.advance(1000);await f.count(1);assert.equal(await check.isEnabled(),false);
     f.release();await f.idle();assert.deepEqual(await f.page.evaluate(()=>fixture.applied),[]);
     await f.returned();await f.advance(1000);await f.count(1);
     f.replies.push({connected:['YouTube'],revision:'after-cache'});await check.click();await f.advance(0);await f.waitPosts(2);await f.idle();
     assert.deepEqual(await f.page.evaluate(()=>fixture.applied.map(value=>value.revision)),['after-cache']);await f.count(2);f.clean();
    }finally{await f.close();}
   });
  }
 }finally{await browser.close();}
});
