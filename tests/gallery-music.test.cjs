const test=require('node:test');
const assert=require('node:assert/strict');
const uuid=n=>'d5ac5354-e9b4-4782-99c4-'+String(n).padStart(12,'0');
const video=new Blob(['synthetic data'],{type:'video/mp4'});
const job={state:'claimed',id:uuid(1),lease:uuid(2),file:{id:uuid(3),size_bytes:video.size},track:{name:'Titel'},name:'Clip – mit SMA-Musik.mp4'};
async function fixture(states,overrides={}){
 const {createGalleryMusicWorker}=await import('../app/assets/gallery-music-worker.mjs');
 const calls=[],uploads=[],updates=[];
 const worker=createGalleryMusicWorker({
  rpc:async(action,input)=>{calls.push([action,input]);return {ok:true,...(action==='claim'?states.shift()||{state:'idle'}:action==='complete'?{asset_id:uuid(4)}:{})};},
  source:async()=>video,loadTrack:()=>assert.fail('Unexpected track fetch'),
  render:async()=>({state:'rendered',blob:video}),upload:async(_,artifact)=>{uploads.push(artifact);return uuid(4);},
  onComplete:()=>updates.push('refreshed'),onStatus:()=>{},...overrides
 });
 return {worker,calls,uploads,updates};
}
test('a saved music version uses its original reservation and refreshes the gallery',async()=>{
 const {worker,calls,uploads,updates}=await fixture([job]);
 try{
  await Promise.all([worker.wake(),worker.wake()]);
  assert.deepEqual(calls.map(x=>x[0]),['claim','reserve','complete','claim']);
  assert.equal(calls[1][1].size_bytes,video.size);assert.match(calls[1][1].sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(uploads,[{upload_id:job.id,name:job.name,mime_type:'video/mp4'}]);assert.equal(updates.length,1);
 }finally{worker.destroy();}
});
test('video with audio and unsupported video finish without an upload',async()=>{
 for(const state of ['audio_present','unsupported']){
  const {worker,calls,uploads}=await fixture([job],{render:async()=>({state})});
  try{await worker.wake();assert.deepEqual(calls.map(x=>x[0]),['claim',state,'claim']);assert.equal(uploads.length,0);}finally{worker.destroy();}
 }
});
test('no available music or another active tab leaves the gallery alone',async()=>{
 for(const state of ['no_track','busy','waiting']){
  const {worker,calls}=await fixture([{state,retry_ms:1000}],{source:()=>assert.fail('Reads an ineligible file')});
  try{await worker.wake();assert.deepEqual(calls.map(x=>x[0]),['claim']);}finally{worker.destroy();}
 }
});
test('unconfirmed transfer checks the receipt before retrying its bound job',async()=>{
 const {worker,calls}=await fixture([job],{upload:async()=>{throw Error('offline');}});
 try{await worker.wake();assert.deepEqual(calls.map(x=>x[0]),['claim','reserve','complete','retry','claim']);assert.deepEqual(calls[3][1],{id:job.id,lease:job.lease});}
 finally{worker.destroy();}
});
test('losing the account during a source read prevents rendering or transfer',async()=>{
 let started,release;
 const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 const {worker,calls,uploads}=await fixture([job],{source:async()=>{started();await gate;return video;},render:()=>assert.fail('Cross-account render')});
 const done=worker.wake();await ready;worker.destroy();release();await done;
 assert.deepEqual(calls.map(x=>x[0]),['claim']);assert.equal(uploads.length,0);
});

test('a lost upload reply uses the verified server receipt without repeating the render',async()=>{
 const actions=[],queue=[job],notes=[];
 const {worker,updates}=await fixture([],{
  rpc:async(action,input)=>{actions.push(action);return {ok:true,...(action==='claim'?queue.shift()||{state:'idle'}:
   action==='complete'?{state:'completed',asset_id:uuid(4)}:{})};},
  upload:async()=>{throw Error('response lost');},onStatus:text=>notes.push(text)
 });
 try{
  await worker.wake();assert.deepEqual(actions,['claim','reserve','complete','claim']);
  assert.equal(updates.length,1);assert.match(notes.at(-1),/gespeichert/);
 }finally{worker.destroy();}
});


test('an idle music queue does not re-query Supabase while the browser tab is hidden',async()=>{
 let visible=true,notify,unsubscribed=false,seq=0;
 const timers=new Map();
 const {worker,calls}=await fixture([{state:'idle'},{state:'idle'}],{
  isVisible:()=>visible,
  subscribeVisibility:fn=>{notify=fn;return ()=>{unsubscribed=true;};},
  setTimer:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id;},
  cancelTimer:id=>timers.delete(id)
 });
 try{
  await worker.wake();
  assert.deepEqual(calls.map(x=>x[0]),['claim']);
  assert.equal([...timers.values()][0].ms,120000);
  visible=false;notify();
  assert.equal(timers.size,0,'background tab must cancel its idle timer');
  await worker.wake();
  assert.equal(calls.length,1,'explicit unrelated wake cannot claim while hidden');
  visible=true;notify();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls.map(x=>x[0]),['claim','claim']);
  assert.equal(timers.size,1,'only the foreground page re-arms the idle timer');
 }finally{worker.destroy();}
 assert.equal(unsubscribed,true);
 assert.equal(timers.size,0);
});

test('hidden before first claim: server background worker can proceed without client polling',async()=>{
 let visible=false,notify;
 const {worker,calls}=await fixture([{state:'idle'}],{
  isVisible:()=>visible,
  subscribeVisibility:fn=>{notify=fn;return ()=>{};}
 });
 try{
  await worker.wake();assert.equal(calls.length,0);
  visible=true;notify();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls.map(x=>x[0]),['claim']);
 }finally{worker.destroy();}
});

test('hiding mid-job preserves a leased upload and receipt but does not claim another job',async()=>{
 let visible=true,notify,started,release;
 const readStarted=new Promise(resolve=>{started=resolve;});
 const gate=new Promise(resolve=>{release=resolve;});
 const {worker,calls,uploads,updates}=await fixture([job,{state:'idle'}],{
  isVisible:()=>visible,
  subscribeVisibility:fn=>{notify=fn;return ()=>{};},
  source:async()=>{started();await gate;return video;}
 });
 try{
  const pending=worker.wake();await readStarted;
  visible=false;notify();release();
  await pending;
  assert.deepEqual(calls.map(x=>x[0]),['claim','reserve','complete']);
  assert.equal(uploads.length,1);
  assert.equal(updates.length,0,'hidden chapter must not reload the file catalogue');
  await worker.wake();
  assert.equal(calls.length,3,'no new claim while page is hidden');
  visible=true;notify();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(updates.length,1,'return refreshes the saved music result exactly once');
  assert.deepEqual(calls.map(x=>x[0]),['claim','reserve','complete','claim']);
  visible=false;notify();visible=true;notify();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(updates.length,1,'later visibility changes must not duplicate the refresh');
 }finally{worker.destroy();}
});


test('repeated deferred claims are bounded and resume only after the scheduled backoff',async()=>{
 let seq=0;
 const timers=new Map();
 const {worker,calls,uploads,updates}=await fixture(Array.from({length:24},()=>({state:'deferred'})),{
  setTimer:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id;},
  cancelTimer:id=>timers.delete(id),
  source:()=>assert.fail('No media must be read for deferred claims')
 });
 try{
  await worker.wake();
  assert.equal(calls.length,8,'a stalled queue must not claim indefinitely');
  assert.ok(calls.every(([action])=>action==='claim'));
  assert.equal(timers.size,1,'one scheduled recheck, no busy loop');
  assert.equal([...timers.values()][0].ms,300000);
  assert.deepEqual(uploads,[]);assert.deepEqual(updates,[]);
  const [id,scheduled]=[...timers][0];
  timers.delete(id);
  scheduled.fn();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,16,'a fresh timer starts one more bounded batch');
  assert.equal(timers.size,1);
 }finally{worker.destroy();}
 assert.equal(timers.size,0);
});

test('repeated uncertain uploads retain their warning and do not spin or alter a lease',async()=>{
 let seq=0;const timers=new Map(),messages=[];
 const {worker,calls,uploads,updates}=await fixture(Array.from({length:40},()=>({state:'check_upload'})),{
  setTimer:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id;},
  cancelTimer:id=>timers.delete(id),
  onStatus:message=>messages.push(message),
  source:()=>assert.fail('Uncertain transfer must not trigger another source read')
 });
 try{
  await worker.wake();
  assert.equal(calls.length,8);
  assert.ok(calls.every(([action])=>action==='claim'));
  assert.equal(timers.size,1);
  assert.equal([...timers.values()][0].ms,300000);
  assert.match(messages.at(-1),/nicht eindeutig zugeordnet/);
  assert.deepEqual(uploads,[]);assert.deepEqual(updates,[]);
 }finally{worker.destroy();}
 assert.equal(timers.size,0);
});
