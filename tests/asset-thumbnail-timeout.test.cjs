const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app/assets/asset-thumbnail.mjs','utf8').replace(/^import[^\n]*\n/,'').replace(/export /g,'');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const file=id=>({id,revision:'revision:1',media_kind:'video'});
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0b8AAAAASUVORK5CYII=';
function fixture({hold=null,intersection=false}={}){
 let clock=0,next=0,holding=hold,tokens=0;
 const timers=new Map(),held=[],requests=[],created=[],revoked=[],observers=[];
 const stage=(name,value)=>holding===name?new Promise((resolve,reject)=>held.push({name,value,resolve,reject})):Promise.resolve(value);
 class Element{
  constructor(doc){this.ownerDocument=doc;this.isConnected=true;this.children=[];this.events={};this.text='';}
  set textContent(value){this.text=value;this.children=[];}get textContent(){return this.text;}
  addEventListener(name,fn){this.events[name]=fn;}
  replaceChildren(...children){this.children=children;this.text='';}
 }
 class Observer{
  constructor(callback){this.callback=callback;this.targets=[];observers.push(this);}
  observe(host){this.targets.push(host);}unobserve(){}disconnect(){this.disconnected=true;}
 }
 const doc={defaultView:intersection?{IntersectionObserver:Observer}:{},createElement:()=>new Element(doc)};
 const request=(url,options)=>{
  assert.equal(url,'fixture:thumbnail');assert.equal(options.method,'POST');
  assert.equal(options.headers.Authorization,'Bearer fixture');assert.equal(options.credentials,'omit');
  assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
  const input=JSON.parse(options.body);assert.deepEqual(Object.keys(input).sort(),['asset_id','asset_revision']);
  requests.push({input,signal:options.signal});
  const body={ok:true,can_publish:false,asset_id:input.asset_id,asset_revision:input.asset_revision,media_kind:'video',mime_type:'image/png',image_base64:png};
  return stage('http',{ok:true,json:()=>stage('body',body)});
 };
 const env={AbortController,AbortSignal:{any:AbortSignal.any.bind(AbortSignal),timeout:delay=>{
   const controller=new AbortController();env.setTimeout(()=>controller.abort(),delay);return controller.signal;
  }},Blob,Uint8Array,atob,fetch:request,
  Date:class extends Date{static now(){return clock;}},
  URL:{createObjectURL:blob=>{created.push(blob);return 'blob:fixture-'+created.length;},revokeObjectURL:url=>revoked.push(url)},
  customerMediaEndpoint:kind=>{assert.equal(kind,'thumbnail');return 'fixture:thumbnail';},
  setTimeout:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:clock+delay});return id;},clearTimeout:id=>timers.delete(id)};
 vm.createContext(env);vm.runInContext(source,env);
 const loader=env.createMediaThumbnailLoader(()=>{tokens++;return stage('token','fixture');});
 return {loader,env,held,requests,created,revoked,observers,timers,tokenCount:()=>tokens,
  host:()=>new Element(doc),hold:value=>{holding=value;},
  async advance(ms){clock+=ms;for(const [id,timer] of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}await flush();},
  async release(i,error=false){const h=held[i];assert.ok(h);if(error)h.reject(Error('late failure'));else h.resolve(h.value);await flush();}
 };
}
for(const phase of ['token','http','body'])test('three stalled '+phase+' reads release the queue at the common deadline',async()=>{
 const f=fixture({hold:phase}),hosts=Array.from({length:4},()=>f.host());
 hosts.forEach((host,i)=>f.loader.observe(host,file('file-'+i)));await flush();
 assert.equal(f.held.length,3);assert.equal(f.tokenCount(),3);
 await f.advance(44999);assert.equal(f.tokenCount(),3);f.hold(null);await f.advance(1);
 assert.equal(f.tokenCount(),4,'fourth preview must no longer be blocked');
 for(const host of hosts.slice(0,3))assert.equal(host.textContent,'Vorschau folgt');
 assert.equal(hosts[3].children.length,1);assert.equal(f.created.length,1);
 const requests=f.requests.length;for(let i=0;i<3;i++)await f.release(i,i===1);
 assert.equal(f.requests.length,requests);assert.equal(f.created.length,1);f.loader.clear();
});
for(const phase of ['token','http','body'])test('page reset cancels stale '+phase+' work and starts the new view immediately',async()=>{
 const f=fixture({hold:phase}),old=Array.from({length:4},()=>f.host());old.forEach((h,i)=>f.loader.observe(h,file('old-'+i)));await flush();
 f.loader.reset();f.hold(null);const current=f.host();f.loader.observe(current,file('current'));await flush();
 assert.equal(current.children.length,1);assert.equal(f.created.length,1);assert.equal(f.requests.some(r=>r.input.asset_id==='old-3'),false);
 for(const r of f.requests.filter(r=>r.input.asset_id.startsWith('old-')))assert.equal(r.signal.aborted,true);
 for(let i=0;i<3;i++)await f.release(i,i===1);
 assert.equal(current.children.length,1);assert.equal(f.created.length,1);assert.equal(f.tokenCount(),4);f.loader.clear();
});
test('token, transport and response-body phases share one loader allowance',async()=>{
 const f=fixture({hold:'token'}),host=f.host();f.loader.observe(host,file('one'));await flush();await f.advance(44000);
 f.hold('body');await f.release(0);assert.equal(f.held.length,2);
 await f.advance(1000);assert.equal(host.textContent,'Vorschau folgt');assert.equal(f.requests[0].signal.aborted,true);
 await f.release(1);assert.equal(f.created.length,0);f.loader.clear();
});
for(const phase of ['http','body'])test('standalone thumbnail '+phase+' is bounded even when the source ignores cancellation',async()=>{
 const f=fixture({hold:phase});let finished=false,error;
 const run=f.env.fetchAssetThumbnail(file('standalone'),'fixture').then(()=>{finished=true;},e=>{finished=true;error=e;});
 await flush();await f.advance(45000);assert.equal(finished,true,'read must settle at its deadline');await run;
 assert.ok(error);assert.equal(f.requests[0].signal.aborted,true);
 await f.release(0);f.loader.clear();
});
test('parent cancellation settles a stalled standalone body and pre-abort starts no request',async()=>{
 const f=fixture({hold:'body'}),controller=new AbortController();let finished=false;
 const run=f.env.fetchAssetThumbnail(file('one'),'fixture',controller.signal).catch(()=>{finished=true;});await flush();
 controller.abort();await flush();assert.equal(finished,true);await run;
 await f.release(0,true);await assert.rejects(f.env.fetchAssetThumbnail(file('two'),'fixture',controller.signal));assert.equal(f.requests.length,1);
});
test('clear discards cached bytes and a late source cannot refill the cache',async()=>{
 const f=fixture({hold:'body'}),host=f.host();f.loader.observe(host,file('same'));await flush();f.loader.clear();await flush();
 f.hold(null);await f.release(0);assert.equal(f.created.length,0);
 f.loader.observe(f.host(),file('same'));await flush();assert.equal(f.requests.length,2);assert.equal(f.created.length,1);
 f.loader.reset();f.loader.observe(f.host(),file('same'));await flush();assert.equal(f.requests.length,2,'same-owner paging may reuse the valid cache');
 assert.equal(f.revoked.length,1);f.loader.clear();assert.equal(f.revoked.length,2);
 f.loader.observe(f.host(),file('same'));await flush();assert.equal(f.requests.length,3);f.loader.clear();
});
test('a callback from a disconnected observer cannot consume the new view queue',async()=>{
 const f=fixture({intersection:true}),old=f.host();f.loader.observe(old,file('old'));const first=f.observers[0];
 f.loader.reset();const current=f.host();f.loader.observe(current,file('current'));const second=f.observers[1];
 first.callback([{target:old,isIntersecting:true}]);old.loadThumbnail?.();await flush();assert.equal(f.requests.length,0);
 second.callback([{target:current,isIntersecting:true}]);await flush();assert.equal(f.requests.length,1);assert.equal(current.children.length,1);
 f.loader.clear();first.callback([{target:old,isIntersecting:true}]);await flush();assert.equal(f.requests.length,1);
});
test('thumbnail identity, revision, publication denial and image bounds stay strict',async()=>{
 const f=fixture(),selected=file('one');
 const valid={ok:true,can_publish:false,asset_id:selected.id,asset_revision:selected.revision,media_kind:'video',mime_type:'image/png',image_base64:png};
 for(const change of [{asset_id:'other'},{asset_revision:'old'},{media_kind:'image'},{can_publish:true},{ok:false},{mime_type:'text/html'},{image_base64:'??'},{image_base64:'AAAA'}]){
  await assert.rejects(f.env.fetchAssetThumbnail(selected,'fixture',undefined,async()=>({ok:true,json:async()=>({...valid,...change})})),/PREVIEW_UNAVAILABLE/);
  
 }
 const blob=await f.env.fetchAssetThumbnail(selected,'fixture',undefined,async()=>({ok:true,json:async()=>valid}));
 assert.equal(blob.type,'image/png');assert.equal(blob.size,Buffer.from(png,'base64').length);
});
const runtime='./dom-runtime/node_modules/playwright-core/index.mjs';
test('desktop and mobile thumbnails recover from stalled auth, HTTP and JSON without external requests',
 {skip:!fs.existsSync('tests/'+runtime)?'Pinned browser dependencies are installed in CI':false,timeout:60000},async()=>{
 const {chromium}=await import(runtime);
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
 try{for(const mobile of [false,true])for(const phase of ['token','http','body']){
  const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
  try{
   const page=await context.newPage(),errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>{network.push(route.request().url());return route.abort();});
   await page.setContent('<main><span id="a"></span><span id="b"></span><span id="c"></span><span id="d"></span></main>');await page.clock.install();
   const bootstrap=`window.IntersectionObserver=undefined;
    // Playwright's controlled clock does not replace the browser's native timeout signal.
    AbortSignal.timeout=delay=>{const controller=new AbortController();setTimeout(()=>controller.abort(),delay);return controller.signal;};
    const f=window.fixture={hold:${JSON.stringify(phase)},held:[],reads:[]};
    f.stage=(name,value)=>f.hold===name?new Promise(resolve=>f.held.push(()=>resolve(value))):Promise.resolve(value);
    const customerMediaEndpoint=kind=>{if(kind!=='thumbnail')throw Error('Unexpected route');return 'fixture:thumbnail';};
    window.fetch=(url,options)=>{if(url!=='fixture:thumbnail'||options.method!=='POST')throw Error('Unexpected request');
     const input=JSON.parse(options.body);f.reads.push(input.asset_id);
     return f.stage('http',{ok:true,json:()=>f.stage('body',{ok:true,can_publish:false,...input,media_kind:'video',mime_type:'image/png',image_base64:${JSON.stringify(png)}})});};`;
   await page.addScriptTag({content:bootstrap+'\n'+source+`
    window.loader=createMediaThumbnailLoader(()=>f.stage('token','fixture'));
    window.show=suffix=>{for(const id of ['a','b','c','d'])loader.observe(document.getElementById(id),{id:id+suffix,revision:'1',media_kind:'video'});};show('old');`});
   await page.waitForFunction(()=>fixture.held.length===3);
   await page.evaluate(()=>{fixture.hold=null;});await page.clock.fastForward(45001);
   await page.waitForFunction(()=>document.querySelector('#d img')?.naturalWidth===1);
   for(const id of ['a','b','c'])assert.equal(await page.locator('#'+id).textContent(),'Vorschau folgt');
   await page.evaluate(()=>{loader.reset();show('new');});
   await page.waitForFunction(()=>[...document.querySelectorAll('img')].length===4&&[...document.querySelectorAll('img')].every(i=>i.naturalWidth===1));
   const reads=await page.evaluate(()=>fixture.reads.slice());
   await page.evaluate(()=>{for(const release of fixture.held)release();});
   assert.deepEqual(await page.evaluate(()=>fixture.reads),reads);assert.equal(await page.locator('img').count(),4);
   await page.evaluate(()=>loader.clear());assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  }finally{await context.close();}
 }}finally{await browser.close();}
});
