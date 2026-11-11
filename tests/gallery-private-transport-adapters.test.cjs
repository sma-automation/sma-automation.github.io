const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {Readable}=require('node:stream');
const {spawnSync}=require('node:child_process');
const fixture=require('../n8n/publishing/fixtures/gallery-music-probe.json');
const {soundtrackMP4}=require('../n8n/publishing/gallery-soundtrack.cjs');
const modulePromise=import('../n8n/publishing/gallery-private-transport-adapters.mjs');
const workerPromise=import('../n8n/publishing/gallery-private-evidence-worker.mjs');
const source=Buffer.from(fixture.video,'base64'),audio=Buffer.from(fixture.audio,'base64');
const result=soundtrackMP4(source,audio).bytes;
const sha=b=>createHash('sha256').update(b).digest('hex');
const job='11111111-2222-4333-8444-555555555555';
const sourceId='syntheticSourceDrive2026',resultId='syntheticResultDrive2026';
const track='c'.repeat(64),audioName='render/'+track+'/'+sha(audio)+'.aac';
const file=(id,driveId,buffer,rev)=>({asset_id:id,drive_file_id:driveId,
 revision:'sha256:'+sha(buffer)+':'+rev,size_bytes:buffer.length,available:true,
 media_kind:'video',mime_type:'video/mp4'});
const snapshot=()=>({
 gallery_job_id:job,state:'completed',customer_id:15,
 user_id:'22222222-3333-4333-8333-444444444444',customer_active:true,
 source_key:'sha256:'+sha(source),expected_sha:sha(result),expected_size:result.length,
 track_sha:track,audio_sha256:sha(audio),audio_object_name:audioName,
 audio_size_bytes:audio.length,
 source:file('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sourceId,source,10),
 result:file('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',resultId,result,11)
});
const ffmpeg=spawnSync('ffmpeg',['-version'],{encoding:'utf8'}).status===0
 &&spawnSync('ffprobe',['-version'],{encoding:'utf8'}).status===0;
function requireFFmpeg(t){
 if(ffmpeg)return true;
 assert.notEqual(process.env.SMA_REQUIRE_FFMPEG,'1','CI requires ffmpeg');
 t.skip('FFmpeg unavailable locally');return false;
}
async function* chunks(bytes){
 const chunkSize=4096;
 for(let i=0;i<bytes.length;i+=chunkSize)yield bytes.subarray(i,i+chunkSize);
}
function harness({snap=()=>snapshot(),files={},audioBytes=audio}={}){
 const calls={snapshot:0,drive:[],storage:[]};
 return {
  calls,
  getSnapshotFromDB:async id=>{calls.snapshot++;assert.equal(id,job);return snap(calls.snapshot);},
  streamDriveFile:async id=>{calls.drive.push(id);
   return chunks(files[id]|| (id===sourceId?source:id===resultId?result:Buffer.from([0])));
  },
  streamStorageFile:async(bucket,key)=>{calls.storage.push([bucket,key]);
   return chunks(audioBytes);
  }
 };
}
test('exact bounded download rejects buffered, oversized and truncated responses',async()=>{
 const {boundedPrivateDownload:bounded}=await modulePromise;
 await assert.rejects(()=>bounded(Buffer.alloc(1),100,1),/UNBOUNDED_DOWNLOAD_NOT_ALLOWED/);
 await assert.rejects(()=>bounded(Readable.from([Buffer.alloc(11)]),10,10),/DOWNLOAD_TOO_LARGE/);
 await assert.rejects(()=>bounded(Readable.from([Buffer.alloc(9)]),10,10),/DOWNLOAD_TRUNCATED/);
 await assert.rejects(()=>bounded(Readable.from(['string']),10,10),/INVALID_DOWNLOAD_CHUNK/);
 const result=await bounded(Readable.from([Buffer.from([1,2]),Buffer.from([3,4])]),10,4);
 assert.deepEqual(result,Buffer.from([1,2,3,4]));
});
test('private worker reads two trusted Drive files and the exact AAC sidecar, but never registers',async t=>{
 if(!requireFFmpeg(t))return;
 const {createGalleryPrivateAdapters}=await modulePromise;
 const {runPrivateGalleryEvidenceWorker:run}=await workerPromise;
 const simulated=harness();
 const a=createGalleryPrivateAdapters(simulated);
 const outcome=await run({galleryJobId:job,...a});
 assert.equal(outcome.ok,true);
 assert.equal(outcome.state,'verified_not_registered');
 assert.equal(outcome.registration_attempted,false);
 assert.equal(outcome.can_publish,false);
 assert.equal(outcome.candidate.receipt_bytes_verified,true);
 assert.equal(outcome.candidate.volume.non_silent,true);
 assert.equal(outcome.candidate.binding.asset_revision,snapshot().result.revision);
 assert.equal(simulated.calls.snapshot,2,'source must be re-read after ffmpeg');
 assert.deepEqual(simulated.calls.drive,[sourceId,resultId]);
 assert.deepEqual(simulated.calls.storage,[['sma-katalog',audioName]]);
});
test('wrong IDs, invalid audio location or malformed size fail before reading bytes',async()=>{
 const {createGalleryPrivateAdapters}=await modulePromise;
 for(const changed of [
  {...snapshot(),audio_object_name:'render/'+track+'/evil.aac'},
  {...snapshot(),audio_size_bytes:0},
  {...snapshot(),audio_sha256:'broken'}
 ]){
  const mock=harness({snap:()=>changed});
  const a=createGalleryPrivateAdapters(mock);
  await assert.rejects(()=>a.getSnapshot(job));
  assert.deepEqual(mock.calls.drive,[]);
  assert.deepEqual(mock.calls.storage,[]);
 }
 const mock=harness();const a=createGalleryPrivateAdapters(mock);
 await assert.rejects(()=>a.readDriveFile(sourceId),/SNAPSHOT_REQUIRED/);
 await a.getSnapshot(job);
 await assert.rejects(()=>a.readDriveFile('foreignDriveId'),/DRIVE_FILE_NOT_IN_TRUSTED_JOB/);
 await assert.rejects(()=>a.readTrackAudio('f'.repeat(64)),/TRACK_NOT_IN_TRUSTED_JOB/);
 assert.deepEqual(mock.calls.drive,[]);
 assert.deepEqual(mock.calls.storage,[]);
});
test('changed private audio location or size is rejected on second DB snapshot',async()=>{
 const {createGalleryPrivateAdapters}=await modulePromise;
 for(const bad of [
  {...snapshot(),audio_object_name:'render/'+track+'/'+ 'e'.repeat(64)+'.aac'},
  {...snapshot(),audio_size_bytes:audio.length-1}
 ]){
  const mock=harness({snap:n=>n===1?snapshot():bad});
  const a=createGalleryPrivateAdapters(mock);
  await a.getSnapshot(job);
  await assert.rejects(()=>a.getSnapshot(job),/AUDIO_OBJECT_PATH_MISMATCH|AUDIO_OBJECT_CHANGED/);
 }
});
test('tampered Drive bytes and audio sidecar are blocked even when size matches',async t=>{
 if(!requireFFmpeg(t))return;
 const {createGalleryPrivateAdapters}=await modulePromise;
 const {runPrivateGalleryEvidenceWorker:run}=await workerPromise;
 const fakeResult=Buffer.from(result);fakeResult[0]^=1;
 const fakeAudio=Buffer.from(audio);fakeAudio[0]^=1;
 for(const mock of [
  harness({files:{[resultId]:fakeResult}}),
  harness({audioBytes:fakeAudio})
 ]){
  const a=createGalleryPrivateAdapters(mock);
  await assert.rejects(()=>run({galleryJobId:job,...a}),/BYTE_SHA_MISMATCH/);
 }
});
test('no endpoint, token, storage URL or implicit registration is present in adapters',async()=>{
 const {readFileSync}=require('node:fs');
 const source=readFileSync('n8n/publishing/gallery-private-transport-adapters.mjs','utf8');
 assert.doesNotMatch(source,/fetch\(|https?:\/\//);
 assert.doesNotMatch(source,/process\.env|service_role|credit.*debit|can_publish:true/i);
});
