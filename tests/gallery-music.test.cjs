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
test('failed transfer retries the bound job and never completes it',async()=>{
 const {worker,calls}=await fixture([job],{upload:async()=>{throw Error('offline');}});
 try{await worker.wake();assert.deepEqual(calls.map(x=>x[0]),['claim','reserve','retry','claim']);assert.deepEqual(calls[2][1],{id:job.id,lease:job.lease});}
 finally{worker.destroy();}
});
test('losing the account during a source read prevents rendering or transfer',async()=>{
 let started,release;
 const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 const {worker,calls,uploads}=await fixture([job],{source:async()=>{started();await gate;return video;},render:()=>assert.fail('Cross-account render')});
 const done=worker.wake();await ready;worker.destroy();release();await done;
 assert.deepEqual(calls.map(x=>x[0]),['claim']);assert.equal(uploads.length,0);
});
