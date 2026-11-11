'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');const {spawnSync}=require('node:child_process');
const {mkdtempSync,readFileSync,rmSync}=require('node:fs');const {tmpdir}=require('node:os');const {join}=require('node:path');
const {normalizeProbe,probeBytes}=require('../n8n/publishing/media-byte-probe.cjs');
const binding={content_sha256:'a'.repeat(64),size_bytes:100};
const fixture=()=>({format:{format_name:'mov,mp4,m4a,3gp,3g2,mj2',duration:'1.5',bit_rate:'1000',tags:{secret:'never expose'}},streams:[{index:0,codec_type:'video',codec_name:'h264',width:160,height:90,avg_frame_rate:'25/1',r_frame_rate:'25/1',pix_fmt:'yuv420p',tags:{title:'private'},side_data_list:[{rotation:90}]}]});
test('technical facts retain unknown values, rotation and exact byte binding without metadata tags',()=>{
 const raw=fixture(),r=normalizeProbe(raw,binding);
 assert.equal(r.duration_ms,1500);assert.equal(r.streams[0].average_frame_rate,25);assert.equal(r.streams[0].rotation_degrees,90);assert.equal(r.audio_present,false);assert.equal(r.can_publish,false);assert.equal(r.full_decode,false);assert.equal(r.content_reviewed,false);assert.equal(r.content_sha256,binding.content_sha256);assert.ok(!JSON.stringify(r).includes('private'));assert.ok(!JSON.stringify(r).includes('secret'));
 raw.streams[0].avg_frame_rate='0/0';raw.streams[0].bit_rate='N/A';assert.equal(normalizeProbe(raw,binding).streams[0].average_frame_rate,null);assert.equal(normalizeProbe(raw,binding).streams[0].bit_rate,null);
 raw.streams.push({index:1,codec_type:'audio',codec_name:'aac',sample_rate:'48000',channels:2});assert.equal(normalizeProbe(raw,binding).audio_present,true);
});
test('missing visual facts, unknown containers, ambiguous streams and invalid duration remain incomplete',()=>{
 for(const change of [r=>delete r.streams,r=>r.streams=[],r=>r.streams[0].width=0,r=>r.streams[0].codec_name='',r=>r.streams.push({...r.streams[0]}),r=>r.format.duration='N/A',r=>r.streams.push({index:2,codec_type:'subtitle'})]){const r=fixture();change(r);assert.throws(()=>normalizeProbe(r,binding),/PROBE_INCOMPLETE/);}
 const r=fixture();r.format.format_name='hls';assert.throws(()=>normalizeProbe(r,binding),/MEDIA_UNSUPPORTED/);
});
test('byte size and checksum are verified before any external process; URLs are never inputs',()=>{
 const b=Buffer.from('not-media'),e={size_bytes:b.length,content_sha256:createHash('sha256').update(b).digest('hex')};
 assert.throws(()=>probeBytes('https://example.invalid/file',e),/MEDIA_UNSUPPORTED/);
 assert.throws(()=>probeBytes(b,{...e,size_bytes:1}),/FILE_CHANGED/);assert.throws(()=>probeBytes(b,{...e,content_sha256:'a'.repeat(64)}),/FILE_CHANGED/);
});
const integration=process.env.SMA_FFPROBE_INTEGRATION==='1';
test('real generated MP4, PNG and invalid bytes exercise the offline subprocess',{skip:!integration},()=>{
 const dir=mkdtempSync(join(tmpdir(),'sma-probe-'));
 try{
  const video=join(dir,'test.mp4'),image=join(dir,'test.png');
  for(const [path,args] of [[video,['-f','lavfi','-i','color=c=blue:s=160x90:r=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart']],[image,['-f','lavfi','-i','color=c=white:s=160x90','-frames:v','1','-threads','1']]]){
   const gen=spawnSync('ffmpeg',['-v','error',...args,path],{timeout:15000});assert.equal(gen.status,0,gen.stderr?.toString());
   const b=readFileSync(path),e={size_bytes:b.length,content_sha256:createHash('sha256').update(b).digest('hex')},r=probeBytes(b,e);
   assert.equal(r.streams[0].width,160);assert.equal(r.streams[0].height,90);assert.equal(r.can_publish,false);
   if(path===video){assert.equal(r.media_kind,'video');assert.equal(r.streams[0].codec,'h264');assert.equal(r.streams[0].average_frame_rate,25);assert.equal(r.audio_present,true);assert.equal(r.duration_ms,1000);}else{assert.equal(r.media_kind,'image');assert.equal(r.duration_ms,null);assert.equal(r.audio_present,false);}
  }
  const b=Buffer.from('#EXTM3U\nhttps://example.invalid/remote.ts\n'),e={size_bytes:b.length,content_sha256:createHash('sha256').update(b).digest('hex')};assert.throws(()=>probeBytes(b,e),/PROBE_FAILED/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
