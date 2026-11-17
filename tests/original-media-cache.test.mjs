import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readExportCover} from '../app/assets/publication-export-cover.mjs';
import {
 createSharedOriginalMediaClient,clearSharedOriginalMediaCache,syncSharedOriginalMediaOwner,
 ORIGINAL_MEDIA_MAX_ENTRIES,ORIGINAL_MEDIA_MAX_BYTES,ORIGINAL_MEDIA_TTL_MS,ORIGINAL_MEDIA_READ_MS
} from '../app/assets/original-media-cache.mjs';

// Every byte and HTTP reply in this suite is synthetic. No production endpoint
// is used, even when testing the unchanged original-source receipt contract.
const owner='ac880000-0000-4000-8000-000000000091',otherOwner='ac880000-0000-4000-8000-000000000092';
const id=n=>'ac880000-0000-4000-8000-'+String(n).padStart(12,'0');
const bytes=Buffer.from('Synthetic original media bytes.');
const file=(n=1,extra={})=>({id:id(n),revision:'r1',media_kind:'video',mime_type:'video/mp4',size_bytes:bytes.length,...extra});
const hash=value=>createHash('sha256').update(value).digest('hex');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const rejected=promise=>promise.then(value=>({value}),error=>({error}));
function receipt(input,{data=bytes,...extra}={}){
 return {ok:true,can_publish:false,asset_id:input.id||input.asset_id,asset_revision:input.revision||input.asset_revision,
  mime_type:'video/mp4',size_bytes:data.length,sha256:hash(data),data_base64:data.toString('base64'),...extra};
}
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function fixture(options={}){
 const host=options.host||{setTimeout:(...args)=>setTimeout(...args),clearTimeout:(...args)=>clearTimeout(...args)};
 let currentOwner=owner,clock=1000,route='https://synthetic-original.test/original',reads=0;
 let reply=options.reply||((input)=>response(receipt(input))),sessionReader=null;
 const calls=[],clients=[];
 const newClient=(extra={})=>{
  const client=createSharedOriginalMediaClient({host,now:()=>clock,endpoint:()=>route,
   getSession:async()=>{reads++;return sessionReader?sessionReader():currentOwner?{user:{id:currentOwner},access_token:'synthetic-'+currentOwner}:null;},
   fetcher:async(url,init)=>{
    assert.equal(url,route);assert.equal(init.method,'POST');assert.equal(init.cache,'no-store');
    assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
    assert.match(new Headers(init.headers).get('Authorization'),/^Bearer synthetic-/);
    assert.ok(init.signal instanceof AbortSignal);assert.equal(init.signal.aborted,false);
    const input=JSON.parse(init.body);assert.deepEqual(Object.keys(input).sort(),['asset_id','asset_revision']);
    calls.push({url,init,input});return reply(input,calls.length);
   },...extra});clients.push(client);return client;
 };
 const client=newClient();
 return {client,host,calls,newClient,get sessionReads(){return reads;},
  request:(input=file(),extra={})=>client.request(input,{owner,...extra}),
  owner:value=>{currentOwner=value;},session:value=>{sessionReader=value;},reply:value=>{reply=value;},
  time:value=>{clock=value;},route:value=>{route=value;},
  close(){for(const client of clients)client.dispose();clearSharedOriginalMediaCache(host);}};
}

test('successful original bytes are reused across real clients and normalized asset aliases',async()=>{
 const f=fixture();try{
  const first=await f.request(),reads=f.sessionReads;
  const second=await f.newClient().request({asset_id:id(1),asset_revision:'r1',mime_type:'video/mp4',size_bytes:bytes.length},{owner});
  assert.equal(f.calls.length,1);assert.ok(f.sessionReads>reads,'Even a byte-cache hit requires a fresh own session');
  for(const blob of [first,second]){assert.ok(blob instanceof Blob);assert.equal(blob.type,'video/mp4');assert.deepEqual(Buffer.from(await blob.arrayBuffer()),bytes);}
  assert.equal(f.calls[0].input.asset_id,id(1));assert.equal(f.calls[0].input.asset_revision,'r1');
 }finally{f.close();}
});

test('parallel consumers share one transfer while an individual abort leaves the remaining consumer alive',async()=>{
 const gate=deferred(),f=fixture({reply:input=>gate.promise.then(()=>response(receipt(input)))}),a=new AbortController(),b=new AbortController();
 try{
  const first=rejected(f.request(file(),{signal:a.signal}));
  const second=f.newClient().request(file(),{owner,signal:b.signal});await tick();
  assert.equal(f.calls.length,1);a.abort();assert.ok((await first).error);assert.equal(f.calls[0].init.signal.aborted,false);
  gate.resolve();assert.equal((await second).size,bytes.length);await f.request();assert.equal(f.calls.length,1);
 }finally{f.close();}
});

test('the final consumer abort cancels its transfer and a late reply cannot populate a retry cache',async()=>{
 const gate=deferred(),f=fixture({reply:(input,n)=>n===1?gate.promise.then(()=>response(receipt(input))):response(receipt(input))});
 try{
  const controller=new AbortController(),old=rejected(f.request(file(),{signal:controller.signal}));await tick();
  controller.abort();assert.ok((await old).error);assert.equal(f.calls[0].init.signal.aborted,true);
  gate.resolve();await tick();await tick();await f.request();assert.equal(f.calls.length,2);await f.request();assert.equal(f.calls.length,2);
 }finally{f.close();}
});

test('disposing one client cancels only its consumers and never destroys another client transfer',async()=>{
 const gate=deferred(),f=fixture({reply:input=>gate.promise.then(()=>response(receipt(input)))}),second=f.newClient();
 try{
  const old=rejected(f.request()),live=second.request(file(),{owner});await tick();f.client.dispose();
  assert.ok((await old).error);assert.equal(f.calls[0].init.signal.aborted,false);
  gate.resolve();assert.equal((await live).size,bytes.length);await assert.rejects(()=>f.request());
  await second.request(file(),{owner});assert.equal(f.calls.length,1);
 }finally{f.close();}
});

test('missing, foreign and switched owners never receive cached original bytes',async()=>{
 const f=fixture();try{
  await assert.rejects(()=>f.client.request(file()),/AUTH_REQUIRED/);assert.equal(f.calls.length,0);
  f.owner(otherOwner);await assert.rejects(()=>f.request(),/AUTH_REQUIRED/);assert.equal(f.calls.length,0);
  f.owner(owner);await f.request();assert.equal(f.calls.length,1);
  f.owner(null);await assert.rejects(()=>f.request(),/AUTH_REQUIRED/);
  f.owner(otherOwner);syncSharedOriginalMediaOwner(otherOwner,f.host);
  await f.newClient().request(file(),{owner:otherOwner});assert.equal(f.calls.length,2);
  f.owner(owner);syncSharedOriginalMediaOwner(owner,f.host);await f.newClient().request(file(),{owner});assert.equal(f.calls.length,3);
 }finally{f.close();}
});

test('an auth event fences a pending old-owner reply and leaves the new owner cache independent',async()=>{
 const gate=deferred(),f=fixture({reply:(input,n)=>n===1?gate.promise.then(()=>response(receipt(input))):response(receipt(input))});
 try{
  const old=rejected(f.request());await tick();f.owner(otherOwner);syncSharedOriginalMediaOwner(otherOwner,f.host);
  assert.ok((await old).error);assert.equal(f.calls[0].init.signal.aborted,true);
  const fresh=f.newClient();await fresh.request(file(),{owner:otherOwner});assert.equal(f.calls.length,2);
  gate.resolve();await tick();await tick();await fresh.request(file(),{owner:otherOwner});assert.equal(f.calls.length,2);
  clearSharedOriginalMediaCache(f.host,owner);await fresh.request(file(),{owner:otherOwner});assert.equal(f.calls.length,2,'An old-owner clear must not evict the new account');
 }finally{f.close();}
});

test('ownership is checked again after bytes arrive and failed final ownership cannot enter the cache',async()=>{
 const gate=deferred(),f=fixture({reply:(input,n)=>n===1?gate.promise.then(()=>response(receipt(input))):response(receipt(input))});
 try{
  const pending=rejected(f.request());await tick();f.owner(otherOwner);gate.resolve();
  assert.ok((await pending).error);f.owner(owner);syncSharedOriginalMediaOwner(owner,f.host);
  await f.newClient().request(file(),{owner});assert.equal(f.calls.length,2);
 }finally{f.close();}
});

test('a cancelled slow session cannot resurrect an invalidated owner or start a network read',async()=>{
 const gate=deferred(),f=fixture();try{
  f.session(()=>gate.promise);const old=rejected(f.request());await tick();
  f.owner(otherOwner);syncSharedOriginalMediaOwner(otherOwner,f.host);f.session(null);
  const fresh=f.newClient();await fresh.request(file(),{owner:otherOwner});assert.equal(f.calls.length,1);
  gate.resolve({user:{id:owner},access_token:'synthetic-'+owner});assert.ok((await old).error);
  await tick();assert.equal(f.calls.length,1);
  await fresh.request(file(),{owner:otherOwner});assert.equal(f.calls.length,1,'A late initial session must not evict the new authenticated owner bytes');
 }finally{f.close();}
});

test('a stale frame or initial auth snapshot cannot reverse another frame authenticated owner or abort its transfer',async()=>{
 const gate=deferred(),f=fixture({reply:(input,n)=>n===2?gate.promise.then(()=>response(receipt(input))):response(receipt(input))});
 try{
  f.owner(otherOwner);syncSharedOriginalMediaOwner(otherOwner,f.host,{initial:true});const current=f.newClient();
  await current.request(file(),{owner:otherOwner});const inFlight=current.request(file(2),{owner:otherOwner});await tick();
  for(const initialOwner of [owner,null,otherOwner]){
   syncSharedOriginalMediaOwner(initialOwner,f.host,{initial:true});await current.request(file(),{owner:otherOwner});
   assert.equal(f.calls.length,2);assert.equal(f.calls[1].init.signal.aborted,false);
  }
  const stale=f.newClient({getSession:async()=>({user:{id:owner},access_token:'synthetic-'+owner})});
  await assert.rejects(()=>stale.request(file(),{owner}),/AUTH_REQUIRED/);
  assert.equal(f.calls.length,2);assert.equal(f.calls[1].init.signal.aborted,false);
  gate.resolve();await inFlight;await current.request(file(),{owner:otherOwner});assert.equal(f.calls.length,2);
 }finally{f.close();}
});

test('a conflicting or empty reader session fails only that reader and preserves the known owner transfer and cache',async()=>{
 const gate=deferred(),f=fixture({reply:input=>gate.promise.then(()=>response(receipt(input)))});
 try{
  f.owner(otherOwner);syncSharedOriginalMediaOwner(otherOwner,f.host);const current=f.newClient();
  const pending=current.request(file(),{owner:otherOwner});await tick();assert.equal(f.calls.length,1);
  const staleSessions=[{user:{id:owner},access_token:'synthetic-'+owner},null];
  const staleClients=staleSessions.map(session=>f.newClient({getSession:async()=>session}));
  for(const stale of staleClients){
   await assert.rejects(()=>stale.request(file(),{owner:otherOwner}),/AUTH_REQUIRED/);
   assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.signal.aborted,false,'A bad reader cannot cancel the authenticated B transfer');
  }
  gate.resolve();assert.equal((await pending).size,bytes.length);
  for(const stale of staleClients){
   await assert.rejects(()=>stale.request(file(),{owner:otherOwner}),/AUTH_REQUIRED/);
   assert.equal((await current.request(file(),{owner:otherOwner})).size,bytes.length);
   assert.equal(f.calls.length,1,'A bad reader cannot evict the authenticated B cache');
  }
 }finally{f.close();}
});

test('different assets, revisions and pilot routes never borrow another original receipt',async()=>{
 const f=fixture();try{
  await f.request();await f.request(file(1,{revision:'r2'}));assert.equal(f.calls.length,2);
  await f.request(file(2));assert.equal(f.calls.length,3);
  f.route('https://synthetic-original.test/pilot');await f.request(file(2));assert.equal(f.calls.length,4);
  await f.request(file(2));assert.equal(f.calls.length,4);
  const g=fixture();try{await g.request(file(2));assert.equal(g.calls.length,1,'A different top window starts with empty RAM');}finally{g.close();}
 }finally{f.close();}
});

test('cache hits must still match the caller MIME and exact expected byte count',async()=>{
 const f=fixture();try{
  await f.request();
  await assert.rejects(()=>f.request(file(1,{mime_type:'image/png'})),/SOURCE_UNAVAILABLE/);
  await assert.rejects(()=>f.request(file(1,{size_bytes:bytes.length+1})),/SOURCE_UNAVAILABLE/);
  await assert.rejects(()=>f.request(file(1,{size_bytes:0})),/SOURCE_UNAVAILABLE/);
  const correct=await f.request();assert.equal(correct.type,'video/mp4');assert.equal(correct.size,bytes.length);
 }finally{f.close();}
});

test('a real readExportCover result with unknown legacy size still requires a valid PNG receipt and hash',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
 const cover=readExportCover({ok:true,version:1,can_publish:false,asset_id:id(1),asset_revision:'r1',
  cover:{asset_id:id(2),asset_revision:'sha256:'+hash(png)+':1',name:'Legacy cover.png',size_bytes:null,position_ms:500}},file());
 assert.equal(cover.size_bytes,null);assert.equal(cover.mime_type,'image/png');
 const good={data:png,mime_type:'image/png'},f=fixture({reply:input=>response(receipt(input,good))});
 try{
  const result=await f.request(cover);assert.equal(result.type,'image/png');assert.equal(result.size,png.length);
  await f.request(cover);assert.equal(f.calls.length,1);
 }finally{f.close();}
 for(const invalid of [{size_bytes:null},{size_bytes:png.length+1},{sha256:'0'.repeat(64)}]){
  const g=fixture({reply:(input,n)=>response(receipt(input,{...good,...(n===1?invalid:{})}))});try{
   await assert.rejects(()=>g.request(cover),/SOURCE_UNAVAILABLE/);assert.equal((await g.request(cover)).size,png.length);
   await g.request(cover);assert.equal(g.calls.length,2);
  }finally{g.close();}
 }
});

test('every original receipt is validated before it can be reused; rejected replies remain retryable',async t=>{
 const cases={
  foreign_asset:{asset_id:id(2)},wrong_revision:{asset_revision:'r2'},publish_capability:{can_publish:true},
  unsupported_mime:{mime_type:'application/octet-stream'},wrong_mime:{mime_type:'image/png'},wrong_size:{size_bytes:bytes.length+1},
  fractional_size:{size_bytes:bytes.length+0.5},short_source:{size_bytes:11},too_large:{size_bytes:24000001},
  wrong_hash:{sha256:'0'.repeat(64)},uppercase_hash:{sha256:hash(bytes).toUpperCase()},
  malformed_base64:{data_base64:'!!not base64!!'},missing_bytes:{data_base64:''},failure:{ok:false,code:'FILE_CHANGED'}
 };
 for(const [name,changes]of Object.entries(cases))await t.test(name,async()=>{
  const f=fixture({reply:(input,n)=>response(receipt(input,n===1?changes:{}))});try{
   await assert.rejects(()=>f.request());assert.equal((await f.request()).size,bytes.length);
   await f.request();assert.equal(f.calls.length,2);
  }finally{f.close();}
 });
});

test('sha256 source revisions bind to the actual digest rather than just a matching response label',async()=>{
 const f=fixture();try{
  await assert.rejects(()=>f.request(file(1,{revision:'sha256:'+'0'.repeat(64)+':1'})),/SOURCE_UNAVAILABLE/);
  const exact=file(1,{revision:'sha256:'+hash(bytes)+':1'});await f.request(exact);await f.request(exact);assert.equal(f.calls.length,2);
 }finally{f.close();}
});

test('the ten minute cache lifetime is absolute and is not extended by another preview',async()=>{
 assert.equal(ORIGINAL_MEDIA_TTL_MS,600000);const f=fixture();try{
  await f.request();f.time(1000+ORIGINAL_MEDIA_TTL_MS-1);await f.request();assert.equal(f.calls.length,1);
  f.time(1000+ORIGINAL_MEDIA_TTL_MS+1);await f.request();assert.equal(f.calls.length,2);
 }finally{f.close();}
});

test('memory holds at most two originals and enforces the existing 24 MB per-source bound',async()=>{
 assert.equal(ORIGINAL_MEDIA_MAX_ENTRIES,2);assert.equal(ORIGINAL_MEDIA_MAX_BYTES,48000000);
 const f=fixture();try{
  for(const n of [1,2,3])await f.request(file(n));assert.equal(f.calls.length,3);
  for(const n of [1,2,3])await f.request(file(n));assert.ok(f.calls.length>3,'Three originals cannot all remain cached');
 }finally{f.close();}
 // Two maximum-size immutable sources exactly fill the documented 48 MB bound.
 const large=Buffer.alloc(24000000,3),g=fixture({reply:input=>response(receipt(input,{data:large}))});try{
  for(const n of [1,2,1,2])assert.equal((await g.request(file(n,{size_bytes:large.length}))).size,large.length);
  assert.equal(g.calls.length,2);
  await assert.rejects(()=>g.request(file(3,{size_bytes:24000001})),/SOURCE_UNAVAILABLE/);
 }finally{g.close();}
});

for(const phase of ['session','fetch','body'])test('one 180 second deadline bounds a stalled '+phase+' and consumes its late reply',async t=>{
 assert.equal(ORIGINAL_MEDIA_READ_MS,180000);t.mock.timers.enable({apis:['setTimeout']});
 const gate=deferred(),f=fixture();try{
  if(phase==='session')f.session(()=>gate.promise);
  if(phase==='fetch')f.reply(input=>gate.promise.then(()=>response(receipt(input))));
  if(phase==='body')f.reply(input=>({ok:true,headers:new Headers(),json:()=>gate.promise.then(()=>receipt(input))}));
  let settled=false;const pending=rejected(f.request()).then(result=>{settled=true;return result;});await tick();
  t.mock.timers.tick(ORIGINAL_MEDIA_READ_MS-1);await tick();assert.equal(settled,false);
  t.mock.timers.tick(1);await tick();assert.equal(settled,true);assert.match((await pending).error.message,/SOURCE_TIMEOUT/);
  gate.resolve({user:{id:owner},access_token:'synthetic-'+owner});await tick();await tick();
  f.session(null);f.reply(input=>response(receipt(input)));const before=f.calls.length;
  assert.equal((await f.request()).size,bytes.length);assert.equal(f.calls.length,before+1);
 }finally{f.close();t.mock.timers.reset();}
});

test('finishing authentication does not restart the whole original-read deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const auth=deferred(),body=deferred(),f=fixture();
 try{
  f.session(()=>auth.promise);f.reply(input=>({ok:true,headers:new Headers(),json:()=>body.promise.then(()=>receipt(input))}));
  let settled=false;const pending=rejected(f.request()).then(result=>{settled=true;return result;});await tick();
  t.mock.timers.tick(ORIGINAL_MEDIA_READ_MS-1);await tick();assert.equal(settled,false);assert.equal(f.calls.length,0);
  auth.resolve({user:{id:owner},access_token:'synthetic-'+owner});await tick();await tick();assert.equal(f.calls.length,1);
  t.mock.timers.tick(1);await tick();assert.equal(settled,true);assert.match((await pending).error.message,/SOURCE_TIMEOUT/);
  assert.equal(f.calls[0].init.signal.aborted,true);body.resolve();await tick();await tick();
 }finally{f.close();t.mock.timers.reset();}
});

test('at most two reads run in parallel and a queued read retains its original deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const gates=[deferred(),deferred(),deferred()],f=fixture({
  reply:(input,n)=>gates[n-1].promise.then(()=>response(receipt(input)))});
 try{
  const pending=[1,2,3].map(n=>rejected(f.request(file(n))));await tick();assert.equal(f.calls.length,2);
  t.mock.timers.tick(ORIGINAL_MEDIA_READ_MS-1);f.time(1000+ORIGINAL_MEDIA_READ_MS-1);await tick();
  gates[0].resolve();assert.equal((await pending[0]).value.size,bytes.length);await tick();
  assert.equal(f.calls.length,3,'Only after one active read finishes may the queued transfer start');
  t.mock.timers.tick(1);await tick();
  for(const result of await Promise.all(pending.slice(1)))assert.match(result.error.message,/SOURCE_TIMEOUT/);
  assert.equal(f.calls[2].init.signal.aborted,true,'Queue time is part of the 180-second limit');
  gates[1].resolve();gates[2].resolve();await tick();await tick();
 }finally{f.close();t.mock.timers.reset();}
});
