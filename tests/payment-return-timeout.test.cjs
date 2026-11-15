const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const source=readFileSync('app/assets/onboarding-payment-return.mjs','utf8').replace(/^import[^\n]*\n/,'');
const order='60600000-0000-4000-8000-000000000011';
const flush=()=>new Promise(resolve=>setImmediate(resolve));

function setup({stall=null,ignoreAbort=false,state='renewal_suspended'}={}){
 let account='first',reply=state,authHandler,nextTimer=0,now=0,authReads=0,statusReads=0,active=0,maxActive=0;
 const nodes=new Map(),timers=new Map(),redirects=[],holds=new Map(),held=new Map(),signals=[],events={};
 if(stall)holds.set(stall,true);
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,disabled:false,listeners:{},
   addEventListener(name,fn){this.listeners[name]=fn;}});
  return nodes.get(id);
 };
 function response(key,value){
  if(!holds.delete(key))return Promise.resolve(value);
  return new Promise((resolve,reject)=>held.set(key,{resolve:()=>resolve(value),reject}));
 }
 const document={hidden:false,querySelector:node,addEventListener:(name,fn)=>{events[name]=fn;}};
 const navigator={onLine:true};
 const client={auth:{
  getSession:()=>response('auth'+(++authReads),{data:{session:account?{user:{id:account}}:null}}),
  onAuthStateChange:fn=>{authHandler=fn;},signOut:async()=>({error:null})
 },rpc:(name,args)=>{
  assert.equal(name,'sma_onboarding_payment_status_v1');assert.deepEqual(JSON.parse(JSON.stringify(args)),{p_order:order});
  let signal;
  return {
   abortSignal(value){assert.ok(value instanceof AbortSignal);signal=value;return this;},
   then(resolve,reject){
    assert.ok(signal);signals.push(signal);statusReads++;active++;maxActive=Math.max(active,maxActive);
    const read=response('rpc'+statusReads,{data:reply,error:null});
    let cancel;
    const request=ignoreAbort?read:new Promise((res,rej)=>{
     cancel=()=>rej(Error('aborted fixture transport'));
     if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
     read.then(res,rej);
    });
    return request.finally(()=>{active--;if(cancel)signal.removeEventListener('abort',cancel);}).then(resolve,reject);
   }
  };
 }};
 const ready=vm.runInNewContext('(async()=>{'+source+'})()',{
  AbortController,document,navigator,URLSearchParams,createClient:()=>client,
  location:{search:'?buchung='+order,replace:path=>redirects.push(path)},
  window:{addEventListener:(name,fn)=>{events[name]=fn;}},
  setTimeout:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,delay,at:now+delay});return id;},
  clearTimeout:id=>timers.delete(id)
 });
 return {ready,node,redirects,timers,signals,reads:()=>({auth:authReads,status:statusReads}),active:()=>active,maxActive:()=>maxActive,
  state:value=>{reply=value;},owner:value=>{account=value;},hold:key=>holds.set(key,true),
  async release(key,reject=false){const item=held.get(key);assert.ok(item,key);held.delete(key);if(reject)item.reject(Error('late fixture failure'));else item.resolve();await flush();},
  async advance(ms){
   const until=now+ms;
   for(;;){const next=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!next)break;
    const [id,t]=next;now=t.at;timers.delete(id);t.fn();await flush();
   }
   now=until;await flush();
  },
  async retry(){node('#retry').listeners.click();await flush();},
  async event(name,arg={}){events[name](arg);await flush();},
  async offline(){navigator.onLine=false;await this.event('offline');},
  async online(){navigator.onLine=true;await this.event('online');},
  async hide(){document.hidden=true;await this.event('visibilitychange');},
  async show(){document.hidden=false;await this.event('visibilitychange');},
  async auth(event,id){account=id;authHandler(event,id?{user:{id}}:null);await flush();}
 };
}

function retryAvailable(f){
 assert.match(f.node('#status').textContent,/Prüfung dauert zu lange/);
 assert.equal(f.node('#retry').hidden,false);assert.equal(f.node('#retry').disabled,false);
 assert.deepEqual(f.redirects,[]);
}

for(const stall of ['auth1','rpc1','auth2'])test('a stalled '+stall+' releases the button at the same 15-second check deadline',async()=>{
 const f=setup({stall});await flush();
 await f.advance(14999);assert.equal(f.node('#retry').disabled,true);
 await f.advance(1);await f.ready;retryAvailable(f);
 if(stall==='rpc1'){assert.equal(f.signals[0].aborted,true);assert.equal(f.active(),0);}
 f.state('active');await f.retry();assert.deepEqual(f.redirects,['dashboard.html']);assert.equal(f.timers.size,0);
 const reads=f.reads();await f.release(stall);
 assert.deepEqual(f.reads(),reads);assert.deepEqual(f.redirects,['dashboard.html']);
});

test('the deadline is shared across slow session, status and final ownership checks, not restarted per stage',async()=>{
 const f=setup({stall:'auth1',state:'active'});f.hold('rpc1');f.hold('auth2');await flush();
 await f.advance(6000);await f.release('auth1');
 await f.advance(6000);await f.release('rpc1');
 assert.equal(f.reads().auth,2);await f.advance(3000);await f.ready;retryAvailable(f);
 f.state('renewal_suspended');await f.retry();assert.match(f.node('#status').textContent,/Zugang pausiert/);
 await f.release('auth2');assert.deepEqual(f.redirects,[]);assert.match(f.node('#status').textContent,/Zugang pausiert/);
});

test('a timed-out active RPC reply is ignored even when its transport does not honour abort',async()=>{
 const f=setup({stall:'rpc1',ignoreAbort:true,state:'active'});await flush();
 await f.advance(15000);await f.ready;retryAvailable(f);
 f.state('renewal_suspended');await f.retry();
 const reads=f.reads();await f.release('rpc1');assert.deepEqual(f.reads(),reads);
 assert.deepEqual(f.redirects,[]);assert.match(f.node('#status').textContent,/Zugang pausiert/);
});

test('late rejected session and status promises are consumed without changing a newer successful read',async()=>{
 for(const stall of ['auth1','rpc1','auth2']){
  const f=setup({stall,ignoreAbort:true});await flush();await f.advance(15000);await f.ready;
  await f.retry();const message=f.node('#status').textContent;
  await f.release(stall,true);assert.equal(f.node('#status').textContent,message);assert.deepEqual(f.redirects,[]);
 }
});

test('five stalled attempts exhaust the existing automatic budget and leave only explicit retry',async()=>{
 const f=setup({stall:'rpc1'});for(let i=2;i<=5;i++)f.hold('rpc'+i);
 await flush();await f.advance(15000);await f.ready;
 for(const delay of [3000,7000,15000,30000]){await f.advance(delay);await f.advance(15000);}
 assert.equal(f.reads().status,5);assert.equal(f.maxActive(),1);assert.equal(f.timers.size,0);
 retryAvailable(f);assert.match(f.node('#status').textContent,/automatische Prüfung pausiert/);
 await f.advance(120000);assert.equal(f.reads().status,5);
 await f.event('online');await f.event('visibilitychange');assert.equal(f.reads().status,5);
 f.state('active');await f.retry();assert.deepEqual(f.redirects,['dashboard.html']);assert.equal(f.reads().status,6);
});

test('offline and hidden timeouts release the check without creating offscreen requests',async()=>{
 for(const mode of ['offline','hide']){
  const f=setup({stall:'rpc1'});await flush();await f[mode]();await f.advance(15000);await f.ready;
  retryAvailable(f);assert.equal(f.timers.size,0);assert.equal(f.active(),0);
  await f.advance(120000);assert.equal(f.reads().status,1);
  f.state('active');await f[mode==='hide'?'show':'online']();
  assert.deepEqual(f.redirects,['dashboard.html']);assert.equal(f.reads().status,2);
 }
});

test('sign-out or account switch cancels a stalled read immediately, clears the deadline and ignores its late reply',async()=>{
 for(const [event,id,path] of [['SIGNED_OUT',null,'index.html?buchung='+order],['SIGNED_IN','second','index.html']]){
  const f=setup({stall:'rpc1',state:'active'});await flush();await f.auth(event,id);await f.ready;
  assert.equal(f.signals[0].aborted,true);assert.equal(f.active(),0);assert.equal(f.timers.size,0);
  assert.equal(f.node('#status').textContent,'');assert.equal(f.node('nav a').hidden,true);
  await f.release('rpc1');await f.advance(60000);assert.deepEqual(f.redirects,[path]);
 }
});

test('an aborted old reply cannot unlock controls or finish a newer pending check',async()=>{
 const f=setup({stall:'rpc1',ignoreAbort:true,state:'active'});await flush();await f.advance(15000);await f.ready;
 f.state('renewal_suspended');f.hold('rpc2');await f.retry();
 await f.release('rpc1');assert.equal(f.node('#retry').disabled,true);assert.deepEqual(f.redirects,[]);
 await f.release('rpc2');assert.equal(f.node('#retry').disabled,false);assert.match(f.node('#status').textContent,/Zugang pausiert/);
});

test('recovery rechecks the account rather than using a pre-timeout owner snapshot',async()=>{
 const f=setup({stall:'rpc1',state:'active'});await flush();await f.advance(15000);await f.ready;
 f.owner('second');await f.retry();assert.deepEqual(f.redirects,['index.html']);assert.equal(f.reads().status,1);
 await f.release('rpc1');assert.deepEqual(f.redirects,['index.html']);assert.equal(f.timers.size,0);
});

const browserRuntime='./dom-runtime/node_modules/playwright-core/index.mjs';
test('desktop and mobile browsers recover from stalled session/status/final-session reads and reject their late active replies',
 {skip:!require('node:fs').existsSync('tests/'+browserRuntime)?'Browser runtime runs in GitHub CI':false,timeout:60000},async()=>{
 const {chromium}=await import(browserRuntime);
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
 const site='https://sma.test';
 const fake=`export function createClient(){
  const stall=new URLSearchParams(location.search).get('fixture');
  const f=window.paymentFixture={auth:0,reads:0,state:'active',signals:[],blocked:false};
  return {
   auth:{getSession:async()=>{
    f.auth++;const result={data:{session:{user:{id:'fixture'}}}};
    if(stall==='auth'+f.auth){f.blocked=true;return new Promise(resolve=>{f.late=()=>resolve(result);});}
    return result;
   },onAuthStateChange(){},signOut:async()=>({})},
   rpc:(name,args)=>({abortSignal:async signal=>{
    if(name!=='sma_onboarding_payment_status_v1'||args.p_order!==${JSON.stringify(order)})throw Error('unexpected RPC');
    f.reads++;f.signals.push(signal);const result={data:f.state,error:null};
    if(stall==='rpc'+f.reads){f.blocked=true;return new Promise(resolve=>{f.late=()=>resolve(result);});}
    return result;
   }})
  };
 };`;
 try{
  for(const mobile of [false,true])for(const stall of ['auth1','rpc1','auth2']){
   const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
   try{
    const page=await context.newPage(),errors=[],unexpected=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
     const req=route.request(),target=new URL(req.url());
     if(req.method()==='GET'&&target.origin===site&&['/app/paketwahl.html','/app/assets/onboarding-payment-return.mjs'].includes(target.pathname))
      return route.fulfill({contentType:target.pathname.endsWith('.html')?'text/html; charset=utf-8':'text/javascript',body:readFileSync('.'+target.pathname,'utf8')});
     if(req.method()==='GET'&&req.url()==='https://esm.sh/@supabase/supabase-js@2.57.4')
      return route.fulfill({contentType:'text/javascript',body:fake});
     if(req.method()==='GET'&&target.origin===site&&target.pathname==='/app/dashboard.html')
      return route.fulfill({contentType:'text/html',body:'<h1>Fixture Dashboard</h1>'});
     unexpected.push(req.method()+' '+req.url());return route.abort();
    });
    const url=site+'/app/paketwahl.html?buchung='+order+'&fixture='+stall;
    await page.clock.install();await page.goto(url,{waitUntil:'commit'});
    await page.waitForFunction(()=>window.paymentFixture?.blocked===true);
    await page.clock.fastForward(15001);
    await page.getByText(/Die Prüfung dauert zu lange/).waitFor();
    const retry=page.getByRole('button',{name:'Zahlungsstand erneut prüfen'});
    assert.equal(await retry.isEnabled(),true);assert.equal(page.url(),url);
    assert.equal(await page.locator('#book').isHidden(),true);assert.equal(await page.locator('#checkout').isHidden(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(stall!=='auth1')assert.equal(await page.evaluate(()=>window.paymentFixture.signals[0].aborted),true);
    await page.evaluate(()=>{window.paymentFixture.state='renewal_suspended';});
    if(mobile)await retry.tap();else await retry.click();
    await page.getByText(/Dein Zugang pausiert/).waitFor();
    await page.evaluate(async()=>{window.paymentFixture.late();for(let i=0;i<10;i++)await Promise.resolve();});
    assert.equal(page.url(),url);assert.match(await page.locator('#status').innerText(),/Dein Zugang pausiert/);
    await page.evaluate(()=>{window.paymentFixture.state='active';});await retry.click();
    await page.getByRole('heading',{name:'Fixture Dashboard'}).waitFor();
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
   }finally{await context.close();}
  }
 }finally{await browser.close();}
});
