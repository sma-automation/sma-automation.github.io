const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {mkdtempSync,writeFileSync,readFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const fixture=require('../n8n/publishing/fixtures/gallery-music-probe.json');
const {soundtrackMP4}=require('../n8n/publishing/gallery-soundtrack.cjs');
const modulePromise=import('../n8n/publishing/gallery-technical-candidate.mjs');
const original=Buffer.from(fixture.video,'base64');
const audio=Buffer.from(fixture.audio,'base64');
const rendered=soundtrackMP4(original,audio).bytes;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=bytes=>({
 asset_id:'11111111-2222-4333-8444-555555555555',
 source_asset_id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
 drive_file_id:'syntheticDriveOnly12345',source_sha256:sha(original),
 sha256:sha(bytes),size_bytes:bytes.length,asset_revision:'sha256:'+sha(bytes)+':3'
});
async function withFiles(fn){
 const dir=mkdtempSync(join(tmpdir(),'sma-gallery-bind-'));
 const sourcePath=join(dir,'source.mp4'),audioPath=join(dir,'music.aac'),savedPath=join(dir,'saved.mp4');
 writeFileSync(sourcePath,original);writeFileSync(audioPath,audio);writeFileSync(savedPath,rendered);
 try{return await fn({dir,sourcePath,audioPath,savedPath});}
 finally{rmSync(dir,{force:true,recursive:true});}
}
const hasFFmpeg=spawnSync('ffmpeg',['-version'],{encoding:'utf8'}).status===0&&
 spawnSync('ffprobe',['-version'],{encoding:'utf8'}).status===0;
function requireFFmpeg(t){
 if(hasFFmpeg)return true;
 assert.notEqual(process.env.SMA_REQUIRE_FFMPEG,'1','CI needs FFmpeg');
 t.skip('FFmpeg absent');return false;
}
function transcode(source,output,sampleRate,muted=false){
 const args=['-nostdin','-hide_banner','-v','error','-i',source,
  '-map','0:v:0','-map','0:a:0','-c:v','copy','-c:a','aac','-ar',String(sampleRate),
  '-ac','2','-b:a','128k'];
 if(muted)args.push('-af','volume=0');
 args.push('-y',output);
 const result=spawnSync('ffmpeg',args,{encoding:'utf8',timeout:90000});
 assert.equal(result.status,0,result.stderr);
}
test('48 kHz output produces a revision-bound nonpublishing candidate',async t=>{
 if(!requireFFmpeg(t))return;
 const {prepareGalleryTechnicalCandidate:prepare}=await modulePromise;
 await withFiles(async paths=>{
  const candidate=await prepare({...paths,receipt:receipt(rendered)});
  assert.equal(candidate.status,'local_technical_evidence');
  assert.equal(candidate.technical.audio_sample_rate_hz,48000);
  assert.equal(candidate.technical.schema,'sma-video-technical-v1');
  assert.equal(Object.keys(candidate.technical).length,16);
  assert.equal(candidate.binding.asset_revision,receipt(rendered).asset_revision);
  assert.equal(candidate.volume.non_silent,true);
  assert.equal(candidate.receipt_bytes_verified,true);
  assert.equal(candidate.restrictions.can_publish,false);
  assert.equal(candidate.restrictions.can_upload,false);
  assert.equal(candidate.restrictions.registered_in_supabase,false);
 });
});
test('44.1 kHz output remains valid with unchanged video and correct receipt',async t=>{
 if(!requireFFmpeg(t))return;
 const {prepareGalleryTechnicalCandidate:prepare}=await modulePromise;
 await withFiles(async paths=>{
  const output=join(paths.dir,'44.mp4');
  transcode(paths.savedPath,output,44100);
  const candidate=await prepare({...paths,savedPath:output,receipt:receipt(readFileSync(output))});
  assert.equal(candidate.technical.audio_sample_rate_hz,44100);
  assert.equal(candidate.packet_identity_verified,true);
  assert.equal(candidate.volume.non_silent,true);
  assert.equal(candidate.restrictions.requires_trusted_ingestion,true);
 });
});
test('wrong source SHA, saved receipt, revision and identifiers are rejected',async t=>{
 if(!requireFFmpeg(t))return;
 const {prepareGalleryTechnicalCandidate:prepare}=await modulePromise;
 await withFiles(async paths=>{
  const valid=receipt(rendered);
  for(const patch of [
   {source_sha256:'0'.repeat(64)},{sha256:'1'.repeat(64)},
   {size_bytes:rendered.length+1},{asset_revision:'sha256:'+valid.sha256+':999x'},
   {drive_file_id:'invalid ID'}, {asset_id:'not-uuid'}
  ]) await assert.rejects(prepare({...paths,receipt:{...valid,...patch}}));
 });
});
test('fully muted AAC is never accepted as technical evidence',async t=>{
 if(!requireFFmpeg(t))return;
 const {prepareGalleryTechnicalCandidate:prepare}=await modulePromise;
 await withFiles(async paths=>{
  const output=join(paths.dir,'silent.mp4');
  transcode(paths.savedPath,output,48000,true);
  await assert.rejects(prepare({...paths,savedPath:output,receipt:receipt(readFileSync(output))}),
   /TECHNICAL_CHECKS_INCOMPLETE/);
 });
});
