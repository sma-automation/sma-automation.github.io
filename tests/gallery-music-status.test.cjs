const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app/assets/gallery-music-worker.mjs','utf8')
 .replace(/^import[^\n]*\n/gm,'').replace(/export function /g,'function ');
const id='60600000-0000-4000-8000-000000000011';
function setup(){
 const messages=[],calls=[],timers=new Map(),replies=[];
 let serial=0,refreshes=0,mediaCalls=0;
 const env={AbortController,editorUUID:v=>v===id,sha256:async()=> 'a'.repeat(64),
  setTimeout(fn,ms){const key=++serial;timers.set(key,{fn,ms});return key;},clearTimeout:key=>timers.delete(key)};
 vm.runInNewContext(source,env);
 const worker=env.createGalleryMusicWorker({
  rpc:async(action)=>{calls.push(action);assert.equal(action,'claim');assert.ok(replies.length,'unexpected claim');
   const reply=replies.shift();if(reply instanceof Error)throw reply;return {ok:true,...reply};},
  source:async()=>{mediaCalls++;throw Error('unexpected source');},
  loadTrack:async()=>{mediaCalls++;throw Error('unexpected track');},
  render:async()=>{mediaCalls++;throw Error('unexpected render');},
  upload:async()=>{mediaCalls++;throw Error('unexpected upload');},
  onComplete:async()=>{refreshes++;},onStatus:text=>messages.push(text)
 });
 return {messages,calls,timers,worker,refreshes:()=>refreshes,mediaCalls:()=>mediaCalls,
  async read(...values){replies.push(...values);await worker.wake();},
  last:()=>messages.at(-1)};
}

test('waiting is visibly queued, not left empty or described as completed',async()=>{
 const f=setup();try{
  await f.read({state:'waiting',retry_ms:5000});
  assert.match(f.last(),/wartet.*erneut geprüft/);assert.doesNotMatch(f.last(),/gespeichert|fertig/);
  assert.equal([...f.timers.values()][0].ms,5000);assert.equal(f.mediaCalls(),0);
 }finally{f.worker.destroy();}
});

test('a missing-track message changes to the current wait and busy state, then clears on idle',async()=>{
 const f=setup();try{
  await f.read({state:'no_track'});assert.match(f.last(),/kein SMA-Track verfügbar/);
  assert.equal([...f.timers.values()][0].ms,900000);
  await f.read({state:'waiting',retry_ms:10000});assert.match(f.last(),/wartet/);assert.doesNotMatch(f.last(),/kein SMA-Track/);
  await f.read({state:'busy'});assert.match(f.last(),/laufenden Auftrag/);assert.doesNotMatch(f.last(),/kein SMA-Track/);
  assert.equal([...f.timers.values()][0].ms,60000);
  await f.read({state:'idle'});assert.equal(f.last(),'');assert.equal([...f.timers.values()][0].ms,120000);
  assert.deepEqual(f.calls,['claim','claim','claim','claim']);assert.equal(f.mediaCalls(),0);
 }finally{f.worker.destroy();}
});

test('an idle queue removes a stale outage without claiming successful processing',async()=>{
 const f=setup();try{
  await f.read(Error('offline'));assert.match(f.last(),/nicht erreichbar/);
  assert.equal([...f.timers.values()][0].ms,125000);
  await f.read({state:'idle'});assert.equal(f.last(),'');assert.equal(f.refreshes(),0);assert.equal(f.mediaCalls(),0);
 }finally{f.worker.destroy();}
});

test('a verified existing completion replaces a stale track warning and refreshes without rendering',async()=>{
 const f=setup();try{
  await f.read({state:'no_track'});await f.read({state:'completed'},{state:'idle'});
  assert.match(f.last(),/Musikfassung.*zugeordnet/);assert.doesNotMatch(f.last(),/kein SMA-Track|freigegeben|veröffentlicht/);
  assert.equal(f.refreshes(),1);assert.equal(f.mediaCalls(),0);
  await f.read({state:'idle'});assert.match(f.last(),/zugeordnet/);
 }finally{f.worker.destroy();}
});

test('an unresolved upload warning remains visible when the queue becomes idle',async()=>{
 const f=setup();try{
  await f.read({state:'check_upload'},{state:'idle'});
  assert.match(f.last(),/nicht eindeutig zugeordnet/);assert.equal(f.refreshes(),0);assert.equal(f.mediaCalls(),0);
 }finally{f.worker.destroy();}
});

test('an initially empty queue is silent and leaves the existing poll interval unchanged',async()=>{
 const f=setup();try{
  await f.read({state:'idle'});assert.deepEqual(f.messages,[]);assert.equal(f.mediaCalls(),0);
  assert.equal([...f.timers.values()][0].ms,120000);
 }finally{f.worker.destroy();}
});

test('deferred jobs retain server backoff and cannot be announced as completed',async()=>{
 const f=setup();try{
  await f.read({state:'deferred'},{state:'waiting',retry_ms:1});
  assert.match(f.last(),/wartet/);assert.equal(f.refreshes(),0);assert.equal(f.mediaCalls(),0);
  assert.equal([...f.timers.values()][0].ms,1000);
 }finally{f.worker.destroy();}
});

test('destroy cancels polling and later wake calls do not change the status or read again',async()=>{
 const f=setup();await f.read({state:'no_track'});f.worker.destroy();
 const count=f.messages.length;await f.worker.wake();assert.equal(f.messages.length,count);
 assert.deepEqual(f.calls,['claim']);assert.equal(f.timers.size,0);assert.equal(f.mediaCalls(),0);
});
