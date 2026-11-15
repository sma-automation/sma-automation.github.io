const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const fs=require('node:fs');
const fixture=require('../n8n/publishing/fixtures/gallery-music-probe.json');
const {soundtrackMP4}=require('../n8n/publishing/gallery-soundtrack.cjs');
const original=Buffer.from(fixture.video,'base64');
const aac=Buffer.from(fixture.audio,'base64');
const rendered=soundtrackMP4(original,aac).bytes;
const sha256=b=>createHash('sha256').update(b).digest('hex');
const modulePromise=import('../n8n/publishing/verify-gallery-output.mjs');

test('valid synthetic output can be reproduced but is not a verified saved customer file',async()=>{
 const {reconcileGalleryBytes:verify}=await modulePromise;
 const r=verify({original,aac,expectedSha:fixture.expected,expectedSize:rendered.length});
 assert.equal(r.reconstructed.sha256,fixture.expected);
 assert.equal(r.reconstruction_matches_receipt,true);
 assert.equal(r.actual_output_checked,false);
 assert.equal(r.status,'requires_original_saved_output');
 assert.equal(r.can_publish,false);
 assert.equal(r.source_sha256,sha256(original));
 assert.equal(r.audio_sha256,sha256(aac));
});

test('actual bytes need an independent exact SHA-256 and byte-count match',async()=>{
 const {reconcileGalleryBytes:verify}=await modulePromise;
 const input={original,aac,expectedSha:fixture.expected,expectedSize:rendered.length};
 const valid=verify({...input,observed:rendered});
 assert.equal(valid.actual_output_checked,true);
 assert.equal(valid.status,'saved_bytes_authenticated');
 assert.equal(valid.observed.receipt_match,true);
 assert.equal(valid.can_publish,false);
 const altered=Buffer.from(rendered);altered[altered.length-1]^=1;
 const bad=verify({...input,observed:altered});
 assert.equal(bad.status,'observed_file_differs_from_receipt');
 assert.equal(bad.observed.receipt_match,false);
 assert.equal(bad.can_publish,false);
});

test('alternate renderer receipt remains unverified even if two inputs have valid hashes',async()=>{
 const {reconcileGalleryBytes:verify}=await modulePromise;
 const r=verify({original,aac,expectedSha:'1'.repeat(64),expectedSize:rendered.length+114});
 assert.equal(r.reconstruction_matches_receipt,false);
 assert.equal(r.status,'requires_original_saved_output');
 assert.equal(r.actual_output_checked,false);
 assert.equal(r.can_publish,false);
});

test('audio-level decoder accepts actual music and rejects silent/unmeasurable AAC tracks',async()=>{
 const {parseSoundtrackVolume}=await modulePromise;
 const music=parseSoundtrackVolume('[Parsed_volumedetect] n_samples: 480000\\n[Parsed_volumedetect] mean_volume: -26.2 dB\\n[Parsed_volumedetect] max_volume: -12.8 dB');
 assert.equal(music.non_silent,true);
 assert.equal(music.mean_dbfs,-26.2);
 assert.equal(music.peak_dbfs,-12.8);
 for(const log of [
  '[Parsed_volumedetect] mean_volume: -inf dB\\n[Parsed_volumedetect] max_volume: -inf dB',
  '[Parsed_volumedetect] mean_volume: -90.0 dB\\n[Parsed_volumedetect] max_volume: -80.0 dB',
  'no usable audio measurements'
 ]){
  const res=parseSoundtrackVolume(log);
  assert.equal(res.non_silent,false);
 }
});

test('the actual matching file needs an audible audio track before it is technically accepted',async t=>{
 const {spawnSync}=require('node:child_process');
 const hasFfmpeg=spawnSync('ffmpeg',['-version'],{encoding:'utf8'}).status===0 &&
  spawnSync('ffprobe',['-version'],{encoding:'utf8'}).status===0;
 if(!hasFfmpeg){assert.notEqual(process.env.SMA_REQUIRE_FFMPEG,'1','CI must provide FFmpeg/FFprobe for the real audio decoder test');t.skip('FFmpeg/FFprobe absent in local test environment');return;}
 const {mkdtempSync,writeFileSync,rmSync}=require('node:fs');
 const {join}=require('node:path'),{tmpdir}=require('node:os');
 const dir=mkdtempSync(join(tmpdir(),'sma-gallery-output-'));
 try{
  const input=join(dir,'original.mp4'),output=join(dir,'mixed.mp4'),silent=join(dir,'silent.aac'),muted=join(dir,'muted.mp4');
  writeFileSync(input,original);writeFileSync(output,rendered);
  const {verifyActualGalleryFile}=await modulePromise;
  const accepted=verifyActualGalleryFile(input,output);
  assert.equal(accepted.audio_aac_lc_stereo_48000,true);
  assert.equal(accepted.audio_aac_lc_stereo_supported_rate,true);
  assert.equal(accepted.audio_sample_rate_hz,48000);
  assert.equal(accepted.unchanged_video_packets,true);
  assert.equal(accepted.full_decode_passed,true);
  assert.equal(accepted.soundtrack_non_silent,true);
  assert.equal(accepted.valid,true);
  assert.ok(Number.isFinite(accepted.soundtrack_peak_dbfs));
  const generated=spawnSync('ffmpeg',['-hide_banner','-v','error','-f','lavfi','-i','anullsrc=r=48000:cl=stereo',
   '-t','3','-c:a','aac','-b:a','128k','-f','adts',silent],{encoding:'utf8'});
  assert.equal(generated.status,0,generated.stderr);
  const silentAudio=fs.readFileSync(silent);
  const silenced=soundtrackMP4(original,silentAudio);
  assert.equal(silenced.state,'rendered');
  writeFileSync(muted,silenced.bytes);
  const blocked=verifyActualGalleryFile(input,muted);
  assert.equal(blocked.audio_aac_lc_stereo_48000,true);
  assert.equal(blocked.audio_aac_lc_stereo_supported_rate,true);
  assert.equal(blocked.unchanged_video_packets,true);
  assert.equal(blocked.full_decode_passed,true);
  assert.equal(blocked.soundtrack_non_silent,false);
  assert.equal(blocked.valid,false);
  assert.equal(blocked.status,'technical_checks_incomplete');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('44.1kHz AAC output passes receipt-local checks but unsupported rates stay blocked',async t=>{
 const {spawnSync}=require('node:child_process');
 const hasFfmpeg=spawnSync('ffmpeg',['-version'],{encoding:'utf8'}).status===0 &&
  spawnSync('ffprobe',['-version'],{encoding:'utf8'}).status===0;
 if(!hasFfmpeg){assert.notEqual(process.env.SMA_REQUIRE_FFMPEG,'1','CI must provide FFmpeg/FFprobe');t.skip('FFmpeg/FFprobe absent in local test environment');return;}
 const {mkdtempSync,writeFileSync,rmSync}=require('node:fs');
 const {join}=require('node:path'),{tmpdir}=require('node:os');
 const {verifyActualGalleryFile}=await modulePromise;
 const dir=mkdtempSync(join(tmpdir(),'sma-gallery-rates-'));
 try{
  const source=join(dir,'original.mp4'),base=join(dir,'music48.mp4');
  writeFileSync(source,original);writeFileSync(base,rendered);
  const transcode=(rate,destination)=>{
   // Only remux video packets; synthetic audio is re-encoded for the rate test.
   const p=spawnSync('ffmpeg',['-nostdin','-hide_banner','-v','error','-i',base,
    '-map','0:v:0','-map','0:a:0','-c:v','copy','-c:a','aac','-ar',String(rate),
    '-ac','2','-b:a','128k','-y',destination],{encoding:'utf8',timeout:90000});
   assert.equal(p.status,0,p.stderr);
  };
  const at44100=join(dir,'music44.mp4');
  transcode(44100,at44100);
  const valid=verifyActualGalleryFile(source,at44100);
  assert.equal(valid.audio_sample_rate_hz,44100);
  assert.equal(valid.audio_aac_lc_stereo_supported_rate,true);
  assert.equal(valid.audio_aac_lc_stereo_48000,false);
  assert.equal(valid.unchanged_video_packets,true);
  assert.equal(valid.full_decode_passed,true);
  assert.equal(valid.soundtrack_non_silent,true);
  assert.equal(valid.status,'technical_checks_pass');
  assert.equal(valid.valid,true);
  const at32000=join(dir,'music32.mp4');
  transcode(32000,at32000);
  const unsupported=verifyActualGalleryFile(source,at32000);
  assert.equal(unsupported.audio_sample_rate_hz,32000);
  assert.equal(unsupported.audio_aac_lc_stereo_supported_rate,false);
  assert.equal(unsupported.audio_aac_lc_stereo_48000,false);
  assert.equal(unsupported.valid,false);
  assert.equal(unsupported.status,'technical_checks_incomplete');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('malformed inputs and mismatched formats are rejected without writes or publishing',async()=>{
 const {reconcileGalleryBytes:verify}=await modulePromise;
 const input={original,aac,expectedSha:fixture.expected,expectedSize:rendered.length};
 for(const patch of [
  {expectedSha:'bad'}, {expectedSize:0},{original:Buffer.alloc(2)},
  {aac:Buffer.alloc(0)}, {observed:Buffer.alloc(24000001)},
  {original:rendered}
 ]) assert.throws(()=>verify({...input,...patch}));
 const source=fs.readFileSync('n8n/publishing/verify-gallery-output.mjs','utf8');
 assert.doesNotMatch(source,/\b(fetch\(|http_post\b|http_get\b|upload\(|publish\(|credit\b.*\bdebit\b)\b/i);
 assert.match(source,/can_publish:false/);
});
