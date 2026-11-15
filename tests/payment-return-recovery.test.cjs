const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const source=readFileSync('app/assets/onboarding-payment-return.mjs','utf8').replace(/^import[^\n]*\n/,'');
const order='60600000-0000-4000-8000-000000000011';
const flush=()=>new Promise(resolve=>setImmediate(resolve));

function setup({state='renewal_suspended',online=true,hidden=false,valid=true}={}){
 let account='first',reply=state,fail=false,authHandler,held=null,hold=false,nextTimer=0,reads=0,active=0,maxActive=0;
 const nodes=new Map(),timers=new Map(),redirects=[],events={window:{},document:{}};
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,disabled:false,listeners:{},
   addEventListener(event,fn){this.listeners[event]=fn;}});
  return nodes.get(id);
 };
 const document={hidden,querySelector:node,addEventListener:(name,fn)=>{events.document[name]=fn;}};
 const navigator={onLine:online};
 const client={auth:{
  getSession:async()=>({data:{session:account?{user:{id:account}}:null}}),
  onAuthStateChange:fn=>{authHandler=fn;},signOut:async()=>({error:null})
 },rpc:(name,args)=>({abortSignal:async signal=>{
  assert.ok(signal instanceof AbortSignal);
  assert.equal(name,'sma_onboarding_payment_status_v1');assert.equal(args.p_order,order);
  reads++;active++;maxActive=Math.max(maxActive,active);
  const response={data:reply,error:fail?{message:'fixture outage'}:null};
  try{
   if(hold){hold=false;await new Promise(resolve=>{held=resolve;});}
   return response;
  }finally{active--;}
 }})};
 const env={AbortController,document,navigator,URLSearchParams,createClient:()=>client,
  location:{search:'?buchung='+(valid?order:'invalid'),replace:path=>redirects.push(path)},
  window:{addEventListener:(name,fn)=>{events.window[name]=fn;}},
  setTimeout:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,delay});return id;},
  clearTimeout:id=>timers.delete(id)};
 const ready=vm.runInNewContext('(async()=>{'+source+'})()',env);
 return {ready,node,redirects,timers,reads:()=>reads,maxActive:()=>maxActive,
  state:value=>{reply=value;},fail:value=>{fail=value;},owner:value=>{account=value;},
  holdNext(){hold=true;},async release(){assert.ok(held);const resolve=held;held=null;resolve();await flush();},
  async fire(){assert.equal(timers.size,1);const [id,timer]=[...timers][0];timers.delete(id);timer.fn();await flush();return timer.delay;},
  async retry(){node('#retry').listeners.click();await flush();},
  async event(name,data={}){(events.window[name]||events.document[name])(data);await flush();},
  async offline(){navigator.onLine=false;await this.event('offline');},
  async online(){navigator.onLine=true;await this.event('online');},
  async hide(){document.hidden=true;await this.event('visibilitychange');},
  async show(){document.hidden=false;await this.event('visibilitychange');},
  async auth(event,id){account=id;authHandler(event,id?{user:{id}}:null);await flush();}
 };
}

async function exhaust(f){
 for(const delay of [3000,7000,15000,30000])assert.equal(await f.fire(),delay);
 assert.equal(f.timers.size,0);
}

test('paused page automatically opens the dashboard only after a confirmed simulated restoration',async()=>{
 const f=setup();await f.ready;
 assert.match(f.node('#status').textContent,/Zugang pausiert/);
 assert.match(f.node('#status').textContent,/automatisch erneut geprüft/);
 assert.equal(f.node('#retry').hidden,false);assert.deepEqual(f.redirects,[]);
 await f.fire();assert.deepEqual(f.redirects,[]);
 f.state('paid');await f.fire();assert.deepEqual(f.redirects,[]);
 f.state('active');await f.fire();assert.deepEqual(f.redirects,['dashboard.html']);
 assert.equal(f.timers.size,0);assert.equal(f.node('#status').textContent,'');
 assert.equal(f.reads(),4);assert.equal(f.maxActive(),1);
});

test('automatic reads stop after four retries; duplicate online/visible events cannot reset the budget',async()=>{
 const f=setup();await f.ready;await exhaust(f);
 assert.equal(f.reads(),5);assert.match(f.node('#status').textContent,/automatische Prüfung pausiert/);
 for(let i=0;i<3;i++){await f.event('online');await f.event('visibilitychange');}
 assert.equal(f.reads(),5);assert.equal(f.timers.size,0);
 await f.retry();assert.equal(f.reads(),6);assert.equal(f.timers.size,1);
 assert.doesNotMatch(f.node('#status').textContent,/Prüfung pausiert/);
});

test('reconnecting after the retry budget is exhausted resumes read-only confirmation without another login',async()=>{
 const f=setup();await f.ready;await exhaust(f);
 await f.offline();assert.equal(f.timers.size,0);
 f.state('active');await f.online();
 assert.equal(f.reads(),6);assert.deepEqual(f.redirects,['dashboard.html']);
 assert.equal(f.maxActive(),1);
});

test('hidden pages stop polling; returning starts a fresh bounded cycle even after exhaustion',async()=>{
 const f=setup();await f.ready;await f.hide();assert.equal(f.timers.size,0);
 await f.show();assert.equal(f.reads(),2);await exhaust(f);
 await f.hide();f.state('active');await f.show();
 assert.deepEqual(f.redirects,['dashboard.html']);assert.equal(f.reads(),7);
});

test('pagehide discards a late active result; cached-page return rechecks the actual state',async()=>{
 const f=setup();await f.ready;f.state('active');f.holdNext();await f.fire();
 await f.event('pagehide');await f.release();assert.deepEqual(f.redirects,[]);
 assert.equal(f.timers.size,0);
 f.state('renewal_suspended');await f.event('pageshow',{persisted:true});
 assert.deepEqual(f.redirects,[]);assert.match(f.node('#status').textContent,/Zugang pausiert/);
 assert.equal(f.reads(),3);
 f.state('active');await f.fire();assert.deepEqual(f.redirects,['dashboard.html']);
});

test('network read errors retain a retry and recover automatically; all requests use only the existing status RPC',async()=>{
 const f=setup();await f.ready;f.fail(true);await f.fire();
 assert.match(f.node('#status').textContent,/konnte gerade nicht geladen werden/);
 assert.equal(f.node('#retry').hidden,false);assert.equal(f.node('#retry').disabled,false);
 assert.deepEqual(f.redirects,[]);
 f.fail(false);f.state('active');await f.fire();assert.deepEqual(f.redirects,['dashboard.html']);
});

test('rapid clicks and returning while a response is pending never overlap status reads',async()=>{
 const f=setup();await f.ready;f.holdNext();await f.fire();
 assert.equal(f.node('#retry').disabled,true);
 await f.retry();await f.retry();assert.equal(f.reads(),2);
 await f.offline();await f.online();await f.event('online');
 assert.equal(f.reads(),2);assert.equal(f.timers.size,1);
 assert.equal([...f.timers.values()][0].delay,15000); // Only the in-flight deadline remains.
 await f.release();assert.equal(f.reads(),3);assert.equal(f.maxActive(),1);
 assert.equal(f.timers.size,1);assert.deepEqual(f.redirects,[]);
});

test('sign-out and account change clear the old status and discard a late confirmation',async()=>{
 for(const [event,id,path] of [['SIGNED_OUT',null,'index.html?buchung='+order],['SIGNED_IN','second','index.html']]){
  const f=setup();await f.ready;f.state('active');f.holdNext();await f.fire();
  await f.auth(event,id);await f.release();
  assert.deepEqual(f.redirects,[path]);assert.equal(f.node('#status').textContent,'');
  assert.equal(f.node('nav a').hidden,true);assert.equal(f.timers.size,0);
  await f.hide();await f.show();await f.offline();await f.online();assert.equal(f.reads(),2);
 }
});

test('post-response session check refuses stale ownership even before the auth event arrives',async()=>{
 for(const id of ['second',null]){
  const f=setup();await f.ready;f.state('active');f.holdNext();await f.fire();
  f.owner(id);await f.release();
  assert.deepEqual(f.redirects,[id?'index.html':'index.html?buchung='+order]);
  assert.equal(f.timers.size,0);assert.equal(f.node('#status').textContent,'');
 }
});

test('terminal and invalid payment states cannot start polling or reopen the dashboard on reconnect',async()=>{
 for(const state of ['closed','reversed','unavailable','unknown']){
  const f=setup({state});await f.ready;
  assert.equal(f.node('#retry').hidden,true);assert.equal(f.timers.size,0);
  await f.offline();await f.online();await f.hide();await f.show();
  assert.equal(f.reads(),1);assert.deepEqual(f.redirects,[]);
 }
 const invalid=setup({valid:false});await invalid.ready;
 await invalid.offline();await invalid.online();await invalid.retry();
 assert.equal(invalid.reads(),0);assert.equal(invalid.timers.size,0);
 assert.match(invalid.node('#status').textContent,/ungültig/);
});

test('initially offline or hidden pages wait for a real return before reading their payment status',async()=>{
 const offline=setup({online:false});await offline.ready;
 assert.equal(offline.reads(),0);assert.match(offline.node('#status').textContent,/Keine Internetverbindung/);
 offline.state('active');await offline.online();assert.deepEqual(offline.redirects,['dashboard.html']);
 const hidden=setup({hidden:true});await hidden.ready;assert.equal(hidden.reads(),0);
 await hidden.show();assert.equal(hidden.reads(),1);assert.equal(hidden.timers.size,1);
});

const browserRuntime='./dom-runtime/node_modules/playwright-core/index.mjs';
test('desktop and mobile browsers restore automatically and recover after offline without payment requests',
 {skip:!require('node:fs').existsSync('tests/'+browserRuntime)?'Browser runtime runs in GitHub CI':false,timeout:60000},async()=>{
 const {chromium}=await import(browserRuntime);
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
 const site='https://sma.test',url=site+'/app/paketwahl.html?buchung='+order;
 const fake=`export function createClient(){return {
  auth:{getSession:async()=>({data:{session:{user:{id:'fixture'}}}}),onAuthStateChange(){},signOut:async()=>({})},
  rpc:(name,args)=>({abortSignal:async signal=>{
   const response=await fetch('/fixture/status',{method:'POST',body:JSON.stringify({name,args}),signal});
   return {data:await response.json(),error:null};
  }})
 };}`;
 try{
  for(const mobile of [false,true]){
   const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
   try{
    const page=await context.newPage();let state='renewal_suspended',reads=0;
    const unexpected=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
     const req=route.request(),target=new URL(req.url());
     if(req.method()==='GET'&&target.origin===site&&['/app/paketwahl.html','/app/assets/onboarding-payment-return.mjs'].includes(target.pathname))
      return route.fulfill({contentType:target.pathname.endsWith('.html')?'text/html; charset=utf-8':'text/javascript',body:readFileSync('.'+target.pathname,'utf8')});
     if(req.method()==='GET'&&req.url()==='https://esm.sh/@supabase/supabase-js@2.57.4')
      return route.fulfill({contentType:'text/javascript',body:fake});
     if(req.method()==='POST'&&req.url()===site+'/fixture/status'){
      assert.deepEqual(req.postDataJSON(),{name:'sma_onboarding_payment_status_v1',args:{p_order:order}});
      reads++;return route.fulfill({contentType:'application/json',body:JSON.stringify(state)});
     }
     if(req.method()==='GET'&&target.origin===site&&target.pathname==='/app/dashboard.html')
      return route.fulfill({contentType:'text/html',body:'<h1>Fixture Dashboard</h1>'});
     unexpected.push(req.method()+' '+req.url());return route.abort();
    });
    await page.clock.install();await page.goto(url);
    await page.getByText(/Dein Zugang pausiert/).waitFor();
    assert.equal(await page.locator('#book').isHidden(),true);
    assert.equal(await page.locator('#checkout').isHidden(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    state='active';await page.clock.fastForward(3001);
    await page.getByRole('heading',{name:'Fixture Dashboard'}).waitFor();assert.equal(reads,2);
    state='renewal_suspended';await page.goto(url);await page.getByText(/Dein Zugang pausiert/).waitFor();
    for(const delay of [3000,7000,15000,30000]){
     const response=page.waitForResponse(r=>r.url()===site+'/fixture/status');
     await page.clock.fastForward(delay+1);await response;
     await page.waitForFunction(()=>!document.querySelector('#retry').disabled);
    }
    await page.getByText(/Die automatische Prüfung pausiert/).waitFor();
    const exhausted=reads;await page.clock.fastForward(120000);assert.equal(reads,exhausted);
    await context.setOffline(true);await page.waitForFunction(()=>!navigator.onLine);
    await page.clock.fastForward(60000);assert.equal(reads,exhausted);
    state='active';await context.setOffline(false);
    await page.getByRole('heading',{name:'Fixture Dashboard'}).waitFor();assert.equal(reads,exhausted+1);
    assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
   }finally{await context.close();}
  }
 }finally{await browser.close();}
});
