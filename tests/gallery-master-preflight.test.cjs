const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const sha=data=>createHash('sha256').update(data).digest('hex');
const data=Buffer.from('SMA test only!');
const masterProbe={format:{format_name:'wav',duration:'32'},streams:[{codec_type:'audio',codec_name:'pcm_s16le',sample_rate:'44100',channels:2}]};
const sidecarProbe={format:{format_name:'aac'},streams:[{codec_type:'audio',codec_name:'aac',profile:'LC',sample_rate:'48000',channels:2,nb_read_frames:'2819'}]};
let api;
test('load reusable read-only preflight metadata functions',async()=>{api=await import('../n8n/publishing/verify-gallery-master.mjs');assert.equal(typeof api.verifyGalleryMaster,'function');});
test('WAV metadata uses content-addressed catalog object names and limits',async()=>{
 const {masterMetadata}=api;const m=masterMetadata('master.wav',data,masterProbe);
 assert.deepEqual(m,{sha256:sha(data),size_bytes:data.length,mime_type:'audio/wav',object_name:sha(data)+'.wav',duration_seconds:32});
 assert.throws(()=>masterMetadata('master.wav',data,{...masterProbe,streams:[...masterProbe.streams,{codec_type:'video'}]}),/exactly one/);
 assert.throws(()=>masterMetadata('master.mp3',data,masterProbe),/container mismatch/);
 assert.throws(()=>masterMetadata('master.wav',Buffer.alloc(8000001),masterProbe),/size outside/);
});
test('AAC checks decoded frame count instead of inaccurate ADTS duration estimate',async()=>{
 const a=api.sidecarMetadata(data,sidecarProbe,sha(data));
 assert.equal(a.duration_seconds,60.139);
 assert.equal(a.storage_path,`render/${sha(data)}/${sha(data)}.aac`);
 assert.equal(a.mime_type,'audio/aac');
 assert.throws(()=>api.sidecarMetadata(data,{...sidecarProbe,streams:[{...sidecarProbe.streams[0],nb_read_frames:'1800'}]},sha(data)),/60-second/);
 assert.throws(()=>api.sidecarMetadata(data,{...sidecarProbe,streams:[{...sidecarProbe.streams[0],sample_rate:'44100'}]},sha(data)),/stereo 48kHz/);
 assert.throws(()=>api.sidecarMetadata(data,{...sidecarProbe,format:{format_name:'mp4'}},sha(data)),/raw AAC/);
});
