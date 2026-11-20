'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const strip=path=>fs.readFileSync(path,'utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');
const source=strip('app/assets/asset-thumbnail.mjs')+'\n'+strip('app/assets/thumbnail-batch.mjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0b8AAAAASUVORK5CYII=';
const file=(i,revision='revision:1')=>({id:'a0000000-0000-4000-8000-'+String(i).padStart(12,'0'),revision,media_kind:'video'});
function fixture({hold=null,intersection=false}={}){
 let clock=0,timerId=0,owner='owner-one',token='fixture-one',holding=hold,transform=body=>body,extraHeaders={},oversize=false;
 const timers=new Map(),held=[],requests=[],created=[],revoked=[],observers=[],auth=[];
 const stage=(name,value)=>holding===name?new Promise((resolve,reject)=>held.push({name,value,resolve,reject})):Promise.resolve(value);
 const host={setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,at:clock+delay});return id;},clearTimeout:id=>timers.delete(id)};
 host.fetch=(url,options)=>{
  assert.equal(url,'fixture:thumbnail');assert.equal(options.method,'POST');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
  const input=JSON.parse(options.body);assert.deepEqual(Object.keys(input),['assets']);assert.ok(input.assets.length>=1&&input.assets.length<=10);
  requests.push({input,signal:options.signal,authorization:options.headers.Authorization});
  const rows=input.assets.map(asset=>({ok:true,can_publish:false,...asset,media_kind:'video',mime_type:'image/png',image_base64:png}));
  const bytes=oversize?new Uint8Array(8*1024*1024+1):new TextEncoder().encode(JSON.stringify(transform({ok:true,can_publish:false,assets:rows})));
  let read=false,cancelled=false;
  const response={ok:true,headers:new Headers(extraHeaders),body:{getReader:()=>({
   read(){if(read||cancelled)return Promise.resolve({done:true});read=true;return stage('body',{done:false,value:bytes});},
   cancel(){cancelled=true;return Promise.resolve();},releaseLock(){}
  })}};
  return stage('http',response);
 };
 class Element{
  constructor(doc){this.ownerDocument=doc;this.isConnected=true;this.children=[];this.events={};this.text='';}
  set textContent(value){this.text=value;this.children=[];}get textContent(){return this.text;}
  addEventListener(name,fn){this.events[name]=fn;}replaceChildren(...children){this.children=children;this.text='';}
 }
 class Observer{
  constructor(callback){this.callback=callback;this.targets=[];observers.push(this);}observe(host){this.targets.push(host);}unobserve(){}disconnect(){this.disconnected=true;}
 }
 const doc={defaultView:intersection?{IntersectionObserver:Observer}:{},createElement:()=>new Element(doc)};
 function realm(){
  const env={AbortController,AbortSignal:{any:AbortSignal.any.bind(AbortSignal),timeout:delay=>{const controller=new AbortController();host.setTimeout(()=>controller.abort(),delay);return controller.signal;}},
   Blob,Uint8Array,TextDecoder,atob,fetch:host.fetch,Date:class extends Date{static now(){return clock;}},
   URL:{createObjectURL:blob=>{created.push(blob);return 'blob:fixture-'+created.length;},revokeObjectURL:url=>revoked.push(url)},
   customerMediaEndpoint:kind=>{assert.equal(kind,'thumbnail');return 'fixture:thumbnail';},setTimeout:host.setTimeout,clearTimeout:host.clearTimeout};
  vm.createContext(env);vm.runInContext(source,env);return env;
 }
 const env=realm();
 function client(context=env){return context.createSharedThumbnailClient({host,getOwnerId:()=>owner,getSession:()=>{auth.push(owner);return stage('token',{user:{id:owner},access_token:token});},endpoint:()=> 'fixture:thumbnail'});}
 return {env,host,realm,client,held,requests,created,revoked,observers,auth,element:()=>new Element(doc),
  hold:value=>{holding=value;},owner:(id,value)=>{owner=id;token=value;},body:fn=>{transform=fn;},headers:value=>{extraHeaders=value;},oversize:()=>{oversize=true;},
  async tick(ms){clock+=ms;for(const [id,timer] of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}await flush();},
  async release(i,error=false){const item=held[i];assert.ok(item);if(error)item.reject(Error('late failure'));else item.resolve(item.value);await flush();}
 };
}

test('ten visible distinct gallery thumbnails use one n8n request and render all ten images',async()=>{
 const f=fixture(),client=f.client(),loader=f.env.createMediaThumbnailLoader(null,{client}),hosts=Array.from({length:10},()=>f.element());
 hosts.forEach((host,i)=>loader.observe(host,file(i)));await flush();assert.equal(f.requests.length,0);await f.tick(16);
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].input.assets.length,10);assert.equal(f.auth.length,1);
 assert.equal(f.created.length,10);assert.ok(hosts.every(host=>host.children.length===1));loader.clear();client.dispose();
});
test('two iframe realms share a pending request and the same 60-second cache',async()=>{
 const f=fixture({hold:'http'}),gallery=f.client(),portal=f.client(f.realm());
 const a=gallery.request(file(1)),b=portal.request(file(1));const result=Promise.all([a,b]);await f.tick(16);
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].input.assets.length,1);
 f.hold(null);await f.release(0);const blobs=await result;assert.equal(blobs[0],blobs[1]);
 assert.equal(await portal.request(file(1)),blobs[0]);assert.equal(f.requests.length,1);gallery.dispose();portal.dispose();
});
test('thirty-one identities use batches of ten and never more than three active requests',async()=>{
 const f=fixture({hold:'http'}),client=f.client();const pending=Promise.allSettled(Array.from({length:31},(_,i)=>client.request(file(i))));await f.tick(16);
 assert.deepEqual(f.requests.map(row=>row.input.assets.length),[10,10,10]);assert.equal(f.auth.length,3);
 await f.release(0);assert.deepEqual(f.requests.map(row=>row.input.assets.length),[10,10,10,1]);
 assert.equal(f.requests.filter(row=>!row.signal.aborted).length,3);
 f.hold(null);for(let i=1;i<4;i++)await f.release(i);assert.ok((await pending).every(row=>row.status==='fulfilled'));client.dispose();
});
test('a batch survives three redraws and a delayed IntersectionObserver without another POST',async()=>{
 const f=fixture({hold:'http',intersection:true}),client=f.client(),loader=f.env.createMediaThumbnailLoader(null,{client}),old=f.element();
 loader.observe(old,file(1));f.observers[0].callback([{target:old,isIntersecting:true}]);await flush();await f.tick(16);
 let current;
 for(let i=0;i<3;i++){loader.reset();current=f.element();loader.observe(current,file(1));await flush();}
 assert.equal(f.requests[0].signal.aborted,false);const observer=f.observers.at(-1);observer.callback([{target:current,isIntersecting:true}]);observer.callback([{target:current,isIntersecting:true}]);await flush();await f.tick(16);
 assert.equal(f.requests.length,1);f.hold(null);await f.release(0);
 assert.equal(old.children.length,0);assert.equal(current.children.length,1);assert.equal(f.created.length,1);loader.clear();client.dispose();
});
test('one view closing cannot abort an image still requested by another view',async()=>{
 const f=fixture({hold:'http'}),a=f.client(),b=f.client(),controller=new AbortController();
 const first=a.request(file(1),controller.signal),second=b.request(file(1));const all=Promise.allSettled([first,second]);await f.tick(16);
 controller.abort();a.dispose();assert.equal(f.requests[0].signal.aborted,false);f.hold(null);await f.release(0);
 const results=await all;assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');assert.equal(f.requests.length,1);b.dispose();
});
test('a reopened portal joins its thumbnail already in flight with another visible file', async () => {
 const f=fixture({hold:'http'}), gallery=f.client(), portal=f.client(f.realm());
 const left=new AbortController();
 const cancelled=gallery.request(file(1),left.signal).catch(error=>error);
 const visible=gallery.request(file(2));
 await f.tick(16);
 left.abort();
 const reopened=portal.request(file(1));
 await f.tick(16);
 assert.equal(f.requests.length,1);
 assert.equal(f.requests[0].input.assets.length,2);
 f.hold(null);
 await f.release(0);
 assert.equal((await cancelled).message,'PREVIEW_ABORTED');
 const [original,other]=await Promise.all([reopened,visible]);
 assert.equal(original.type,'image/png');
 assert.equal(other.type,'image/png');
 gallery.dispose();portal.dispose();
});

test('an abandoned thumbnail in a successful batch is neither cached nor left pending', async () => {
 const f=fixture({hold:'http'}), client=f.client(), left=new AbortController();
 const cancelled=client.request(file(1),left.signal).catch(error=>error);
 const visible=client.request(file(2));
 await f.tick(16);
 left.abort();
 f.hold(null);
 await f.release(0);
 await visible;
 assert.equal((await cancelled).message,'PREVIEW_ABORTED');
 const next=client.request(file(1));
 await f.tick(16);
 assert.equal(f.requests.length,2);
 assert.equal((await next).type,'image/png');
 client.dispose();
});

test('a gallery closed before dispatch cannot supply authentication for its still-open portal',async()=>{
 const f=fixture(),closed=f.env.createSharedThumbnailClient({host:f.host,getOwnerId:()=> 'owner-one',getSession:()=>{throw Error('Closed gallery session must not be read');},endpoint:()=> 'fixture:thumbnail'}),portal=f.client();
 const results=Promise.allSettled([closed.request(file(1)),portal.request(file(1))]);closed.dispose();await f.tick(16);
 assert.deepEqual((await results).map(row=>row.status),['rejected','fulfilled']);assert.equal(f.requests.length,1);portal.dispose();
});
test('a portal takes over stalled authentication when the first view closes, within the original deadline',async()=>{
 const f=fixture({hold:'token'}),gallery=f.client(),portal=f.client();const results=Promise.allSettled([gallery.request(file(1)),portal.request(file(1))]);await f.tick(16);
 assert.equal(f.held.length,1);await f.tick(44000);gallery.dispose();f.hold(null);await flush();
 assert.deepEqual((await results).map(row=>row.status),['rejected','fulfilled']);assert.equal(f.requests.length,1);assert.equal(f.auth.length,2);
 await f.release(0);assert.equal(f.requests.length,1);portal.dispose();
});
test('conflicting media kinds for one binding cannot put duplicate identities in a batch',async()=>{
 const f=fixture(),client=f.client();const results=Promise.allSettled([client.request(file(1)),client.request({...file(1),media_kind:'image'})]);await f.tick(16);
 assert.equal(f.requests.length,2);assert.ok(f.requests.every(row=>row.input.assets.length===1));
 assert.deepEqual((await results).map(row=>row.status),['fulfilled','rejected']);client.dispose();
});
test('removing every consumer aborts a batch and its late result cannot refill the cache',async()=>{
 const f=fixture({hold:'http'}),client=f.client(),controller=new AbortController();const old=client.request(file(1),controller.signal).catch(error=>error);await f.tick(16);
 controller.abort();await old;assert.equal(f.requests[0].signal.aborted,true);f.hold(null);await f.release(0);
 const retry=client.request(file(1));await f.tick(16);await retry;assert.equal(f.requests.length,2);client.dispose();
});
for(const phase of ['token','http','body'])test('one batch deadline includes stalled '+phase+' and releases the next batch',async()=>{
 const f=fixture({hold:phase}),client=f.client();const pending=Promise.allSettled(Array.from({length:31},(_,i)=>client.request(file(i))));await f.tick(16);
 assert.equal(f.held.length,3);assert.equal(f.auth.length,3);await f.tick(44999);assert.equal(f.auth.length,3);
 f.hold(null);await f.tick(1);assert.equal(f.auth.length,4);
 const results=await pending;assert.equal(results.filter(row=>row.status==='rejected').length,30);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
 const count=f.requests.length;for(let i=0;i<3;i++)await f.release(i,i===1);assert.equal(f.requests.length,count);client.dispose();
});
test('auth, transport and streamed body share one allowance; redraw cannot extend it',async()=>{
 const f=fixture({hold:'token'}),client=f.client(),loader=f.env.createMediaThumbnailLoader(null,{client}),old=f.element();
 loader.observe(old,file(1));await flush();await f.tick(16);await f.tick(44000);
 f.hold('body');await f.release(0);assert.equal(f.held.length,2);
 loader.reset();const current=f.element();loader.observe(current,file(1));await flush();await f.tick(1000);
 assert.equal(current.textContent,'Vorschau folgt');assert.equal(f.requests.length,1);assert.equal(f.requests[0].signal.aborted,true);
 f.hold(null);await f.release(1);loader.reset();const retry=f.element();loader.observe(retry,file(1));await flush();await f.tick(16);
 assert.equal(f.requests.length,2);assert.equal(retry.children.length,1);assert.equal(old.children.length,0);loader.clear();client.dispose();
});
for(const phase of ['token','http','body'])test('logout drops pending '+phase+' and no old-owner response enters a new session',async()=>{
 const f=fixture({hold:phase}),old=f.client();const result=old.request(file(1)).catch(error=>error);await f.tick(16);
 f.env.clearSharedThumbnailCache(f.host,'owner-one');await result;f.owner('owner-two','fixture-two');f.hold(null);
 const current=f.client(),fresh=current.request(file(1));await f.tick(16);const blob=await fresh;
 await f.release(0);assert.equal(await current.request(file(1)),blob);
 assert.ok(f.requests.every(row=>row.authorization==='Bearer fixture-two'||row.signal.aborted));
 await assert.rejects(old.request(file(1)),/PREVIEW_ABORTED/);old.dispose();current.dispose();
});
test('a delayed clear for an old owner cannot discard the new owner cache',async()=>{
 const f=fixture(),one=f.client(),first=one.request(file(1));await f.tick(16);await first;
 f.env.clearSharedThumbnailCache(f.host,'owner-one');f.owner('owner-two','fixture-two');const two=f.client(),next=two.request(file(1));await f.tick(16);const blob=await next;
 f.env.clearSharedThumbnailCache(f.host,'owner-one');assert.equal(await two.request(file(1)),blob);assert.equal(f.requests.length,2);one.dispose();two.dispose();
});
test('a cache hit queued immediately before logout is rejected before delivery',async()=>{
 const f=fixture(),client=f.client(),first=client.request(file(1));await f.tick(16);await first;
 const cached=client.request(file(1));f.env.clearSharedThumbnailCache(f.host);await assert.rejects(cached,/PREVIEW_ABORTED/);client.dispose();
});
test('revision, 60-second expiration and the global 20-entry limit never share stale bytes',async()=>{
 const f=fixture(),client=f.client();let pending=client.request(file(1));await f.tick(16);await pending;
 await f.tick(60000);await client.request(file(1));assert.equal(f.requests.length,1);
 await f.tick(1);pending=client.request(file(1));await f.tick(16);await pending;assert.equal(f.requests.length,2);
 pending=client.request(file(1,'revision:2'));await f.tick(16);await pending;assert.equal(f.requests.length,3);
 const many=Promise.all(Array.from({length:21},(_,i)=>client.request(file(i+10))));await f.tick(16);await many;
 pending=client.request(file(10));await f.tick(16);await pending;assert.equal(f.requests.at(-1).input.assets[0].asset_id,file(10).id);assert.equal(f.requests.length,7);client.dispose();
});
test('one unavailable file does not discard the other bound thumbnails or silently retry it',async()=>{
 const f=fixture(),client=f.client();f.body(body=>({...body,assets:body.assets.map((row,i)=>i===1?{ok:false,can_publish:false,asset_id:row.asset_id,asset_revision:row.asset_revision,code:'FILE_CHANGED'}:row)}));
 const pending=Promise.allSettled([1,2,3].map(i=>client.request(file(i))));await f.tick(16);const rows=await pending;
 assert.deepEqual(rows.map(row=>row.status),['fulfilled','rejected','fulfilled']);assert.equal(f.requests.length,1);
 await client.request(file(1));assert.equal(f.requests.length,1);client.dispose();
});
for(const corruption of ['foreign','duplicate','publish','missing'])test('malformed '+corruption+' batch identities fail before any image is cached',async()=>{
 const f=fixture(),client=f.client();f.body(body=>{
  if(corruption==='foreign')body.assets[1].asset_id=file(999).id;
  if(corruption==='duplicate')body.assets[1]=body.assets[0];
  if(corruption==='publish')body.can_publish=true;
  if(corruption==='missing')body.assets.pop();return body;
 });
 const pending=Promise.allSettled([client.request(file(1)),client.request(file(2))]);await f.tick(16);assert.ok((await pending).every(row=>row.status==='rejected'));
 f.body(body=>body);const retry=client.request(file(1));await f.tick(16);await retry;assert.equal(f.requests.length,2);client.dispose();
});
for(const kind of ['header','stream'])test('the 8 MiB '+kind+' limit bounds the full response without per-file fallback',async()=>{
 const f=fixture(),client=f.client();if(kind==='header')f.headers({'content-length':String(8*1024*1024+1)});else f.oversize();
 const pending=Promise.allSettled([client.request(file(1)),client.request(file(2))]);await f.tick(16);
 assert.ok((await pending).every(row=>row.status==='rejected'));assert.equal(f.requests.length,1);client.dispose();
});
test('dashboard, picker and selected preview use the same broker and explicitly clear it on auth changes',()=>{
 const dashboard=fs.readFileSync('app/dashboard.html','utf8'),preview=fs.readFileSync('app/assets/publication-preview.js','utf8');
 assert.match(dashboard,/createMediaThumbnailLoader\(null,\{client:thumbnailClient\}\)/);
 assert.match(preview,/createMediaThumbnailLoader\(null,\{client:previewThumbnails\}\)/);
 assert.match(preview,/previewThumbnails\.request\(file,controller.signal\)/);
 assert.match(preview,/previewThumbnails\.request\(f,signal\)/);
 assert.match(dashboard,/clearSharedThumbnailCache\(undefined,previousOwner\)/);assert.match(preview,/clearSharedThumbnailCache\(undefined,previewOwnerId\)/);
 assert.doesNotMatch(preview,/fetchAssetThumbnail\(/);
});
