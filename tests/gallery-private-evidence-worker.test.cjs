const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const fixture=require('../n8n/publishing/fixtures/gallery-music-probe.json');
const {soundtrackMP4}=require('../n8n/publishing/gallery-soundtrack.cjs');
const imported=import('../n8n/publishing/gallery-private-evidence-worker.mjs');
const original=Buffer.from(fixture.video,'base64');
const audio=Buffer.from(fixture.audio,'base64');
const mixed=soundtrackMP4(original,audio).bytes;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const jobId='11111111-2222-4333-8444-555555555555';
const srcId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const resultId='bbbbbbbb-aaaa-4bbb-8bbb-aaaaaaaaaaaa';
const master='c'.repeat(64);
const sourceRev='sha256:'+sha(original)+':1';
const resultRev='sha256:'+sha(mixed)+':2';
const fresh=()=>({
 gallery_job_id:jobId,state:'completed',customer_id:500,user_id:'22222222-3333-4333-8333-444444444444',
 customer_active:true,track_sha:master,audio_sha256:sha(audio),
 source_key:'sha256:'+sha(original),expected_sha:sha(mixed),expected_size:mixed.length,
 source:{asset_id:srcId,drive_file_id:'syntheticSMAOriginal12345',
  revision:sourceRev,size_bytes:original.length,available:true,
  media_kind:'video',mime_type:'video/mp4'},
 result:{asset_id:resultId,drive_file_id:'syntheticSMAResult123456',
  revision:resultRev,size_bytes:mixed.length,available:true,
  media_kind:'video',mime_type:'video/mp4'}
});
const hasFFmpeg=spawnSync('ffmpeg',['-version'],{encoding:'utf8'}).status===0 &&
 spawnSync('ffprobe',['-version'],{encoding:'utf8'}).status===0;
function gateFFmpeg(t){
 if(hasFFmpeg)return true;
 assert.notEqual(process.env.SMA_REQUIRE_FFMPEG,'1','CI must provide ffmpeg and ffprobe');
 t.skip('FFmpeg unavailable locally');return false;
}
function adapters({snapshots=()=>fresh(),source=original,result=mixed,track=audio,register}={}){
 const calls={db:0,drive:[],track:0,register:0};
 return {
  calls,
  getSnapshot:async id=>{calls.db++;assert.equal(id,jobId);return snapshots(calls.db);},
  readDriveFile:async id=>{calls.drive.push(id);
   if(id==='syntheticSMAOriginal12345')return source;
   if(id==='syntheticSMAResult123456')return result;
   throw Error('UNEXPECTED_DRIVE_FILE');
  },
  readTrackAudio:async id=>{calls.track++;assert.equal(id,master);return track;},
  registerEvidence:async candidate=>{calls.register++;
   if(register)return register(candidate);
   return {ok:true,state:'technical_evidence_recorded',
    asset_id:resultId,asset_revision:resultRev,can_upload:false,can_publish:false};
  }
 };
}
test('offline worker verifies independent Drive bytes and returns candidate without DB writes',async t=>{
 if(!gateFFmpeg(t))return;
 const {runPrivateGalleryEvidenceWorker:run}=await imported;
 const tools=adapters();
 const r=await run({...tools,galleryJobId:jobId});
 assert.equal(r.ok,true);
 assert.equal(r.state,'verified_not_registered');
 assert.equal(r.registration_attempted,false);
 assert.equal(r.can_publish,false);
 assert.equal(r.can_upload,false);
 assert.equal(r.candidate.binding.sha256,sha(mixed));
 assert.equal(r.candidate.binding.asset_revision,resultRev);
 assert.equal(r.candidate.volume.non_silent,true);
 assert.equal(tools.calls.db,2,'snapshot must be rechecked after decoding');
 assert.deepEqual(tools.calls.drive,['syntheticSMAOriginal12345','syntheticSMAResult123456']);
 assert.equal(tools.calls.track,1);
 assert.equal(tools.calls.register,0);
});
test('explicit server-only flag calls a mocked registration adapter after recheck',async t=>{
 if(!gateFFmpeg(t))return;
 const {runPrivateGalleryEvidenceWorker:run}=await imported;
 const tools=adapters();
 const r=await run({...tools,galleryJobId:jobId,enableRegistration:true});
 assert.equal(r.state,'registered_technical_only');
 assert.equal(tools.calls.register,1);
 assert.equal(tools.calls.db,2);
 assert.equal(r.can_publish,false);
});
test('wrong video checksum or wrong private AAC hash fails before registration',async()=>{
 const {runPrivateGalleryEvidenceWorker:run}=await imported;
 const video=Buffer.from(mixed);video[video.length-1]^=1;
 for(const spec of [{result:video},{track:Buffer.concat([audio,Buffer.from([0])])}]){
  const tools=adapters(spec);
  await assert.rejects(()=>run({...tools,galleryJobId:jobId,enableRegistration:true}),
   /BYTE_SHA_MISMATCH/);
  assert.equal(tools.calls.register,0);
 }
});
test('a changed DB revision or active-customer state blocks late registration',async t=>{
 if(!gateFFmpeg(t))return;
 const {runPrivateGalleryEvidenceWorker:run}=await imported;
 for(const changed of [
  {...fresh(),result:{...fresh().result,revision:'sha256:'+sha(mixed)+':33'}},
  {...fresh(),source:{...fresh().source,revision:'sha256:'+sha(original)+':8'}},
  {...fresh(),customer_active:false},
  {...fresh(),state:'check_upload'}
 ]){
  const tools=adapters({snapshots:n=>n===1?fresh():changed});
  await assert.rejects(()=>run({...tools,galleryJobId:jobId,enableRegistration:true}),
    /SNAPSHOT_CHANGED_BEFORE_REGISTRATION|CUSTOMER_INACTIVE|JOB_NOT_COMPLETED/);
  assert.equal(tools.calls.register,0);
 }
});
test('caller cannot substitute a foreign receipt, result ID or unverified job',async()=>{
 const {runPrivateGalleryEvidenceWorker:run}=await imported;
 for(const bad of [
  {...fresh(),gallery_job_id:'ffffffff-ffff-4fff-8fff-ffffffffffff'},
  {...fresh(),expected_sha:'f'.repeat(64)},
  {...fresh(),source:{...fresh().source,drive_file_id:fresh().result.drive_file_id}},
  {...fresh(),result:{...fresh().result,revision:'sha256:'+'f'.repeat(64)+':2'}},
  {...fresh(),source_key:'sha256:'+'f'.repeat(64)}
 ]){
  const tools=adapters({snapshots:()=>bad});
  await assert.rejects(()=>run({...tools,galleryJobId:jobId,enableRegistration:true}));
  assert.equal(tools.calls.register,0);
  assert.deepEqual(tools.calls.drive,[]);
 }
});
test('unexpected registration response never grants upload or publishing permission',async t=>{
 if(!gateFFmpeg(t))return;
 const {runPrivateGalleryEvidenceWorker:run}=await imported;
 for(const response of [
  {ok:true,state:'technical_evidence_recorded',asset_id:resultId,
   asset_revision:resultRev,can_upload:true,can_publish:false},
  {ok:true,state:'technical_evidence_recorded',asset_id:resultId,
   asset_revision:resultRev,can_upload:false,can_publish:true},
  {ok:true,state:'technical_evidence_recorded',asset_id:'foreign',
   asset_revision:resultRev,can_upload:false,can_publish:false}
 ]){
  const tools=adapters({register:()=>response});
  await assert.rejects(()=>run({...tools,galleryJobId:jobId,enableRegistration:true}),
   /REGISTRATION_REJECTED/);
  assert.equal(tools.calls.register,1);
 }
});
