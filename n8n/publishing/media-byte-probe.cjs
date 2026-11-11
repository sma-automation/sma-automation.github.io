'use strict';
// Offline technical facts only; no content classification or publishing decision.
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const SCHEMA='sma.media-facts.v1';
const PROFILE='ffprobe-facts-2026-11-02.1';
const MAX_BYTES=50000000;
const ENTRIES='format=format_name,duration,bit_rate:stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,pix_fmt,sample_rate,channels,bit_rate:stream_disposition=attached_pic:stream_side_data=rotation';
function fail(code){throw Error(code);}
function positive(value,integer=false){
 if(!['number','string'].includes(typeof value)||String(value).trim()==='')return null;
 const n=Number(value);return Number.isFinite(n)&&n>0&&(!integer||Number.isSafeInteger(n))?n:null;
}
function ratio(value){
 if(typeof value!=='string'||!/^\d+\/\d+$/.test(value))return null;
 const [n,d]=value.split('/').map(Number);return d>0?positive(n/d):null;
}
function codec(value){return typeof value==='string'&&/^[a-z0-9_]{1,64}$/.test(value)?value:null;}
function normalizeProbe(raw,binding){
 if(!raw||!Array.isArray(raw.streams)||raw.streams.length===0||raw.streams.length>32||!raw.format)fail('PROBE_INCOMPLETE');
 const formats=String(raw.format.format_name||'').split(',');
 const containers={mp4:'mov',mov:'mov',matroska:'matroska',webm:'matroska',png_pipe:'png',jpeg_pipe:'jpeg',webp_pipe:'webp'};
 const container=formats.includes('mov')?'mov':formats.map(f=>containers[f]).find(Boolean);
 if(!container)fail('MEDIA_UNSUPPORTED');
 const streams=raw.streams.map(s=>{
  if(!s||!Number.isSafeInteger(s.index)||s.index<0||!['video','audio'].includes(s.codec_type))fail('PROBE_INCOMPLETE');
  const common={index:s.index,kind:s.codec_type,codec:codec(s.codec_name),bit_rate:positive(s.bit_rate)};
  if(s.codec_type==='audio')return {...common,sample_rate:positive(s.sample_rate,true),channels:positive(s.channels,true)};
  const rotation=s.side_data_list?.find(v=>v&&Object.hasOwn(v,'rotation'))?.rotation;
  return {...common,width:positive(s.width,true),height:positive(s.height,true),pixel_format:codec(s.pix_fmt),average_frame_rate:ratio(s.avg_frame_rate),nominal_frame_rate:ratio(s.r_frame_rate),rotation_degrees:typeof rotation==='number'&&Number.isFinite(rotation)?rotation:null,attached_picture:s.disposition?.attached_pic===1};
 });
 if(new Set(streams.map(s=>s.index)).size!==streams.length)fail('PROBE_INCOMPLETE');
 const pictures=streams.filter(s=>s.kind==='video'&&!s.attached_picture);
 if(pictures.length!==1||!pictures[0].codec||!pictures[0].width||!pictures[0].height)fail('PROBE_INCOMPLETE');
 const image=['png','jpeg','webp'].includes(container);
 if(image)for(const s of streams){s.average_frame_rate=null;s.nominal_frame_rate=null;}
 if(image&&(streams.length!==1||!['png','mjpeg','webp'].includes(pictures[0].codec)))fail('MEDIA_UNSUPPORTED');
 const duration=positive(raw.format.duration);
 if(!image&&!duration)fail('PROBE_INCOMPLETE');
 return {schema:SCHEMA,profile:PROFILE,content_sha256:binding.content_sha256,size_bytes:binding.size_bytes,scope:'container_and_stream_headers',media_kind:image?'image':'video',container,duration_ms:image?null:Math.round(duration*1000),bit_rate:positive(raw.format.bit_rate),audio_present:streams.some(s=>s.kind==='audio'),streams,full_decode:false,content_reviewed:false,can_publish:false};
}
function probeBytes(bytes,expected){
 if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>=MAX_BYTES)fail('MEDIA_UNSUPPORTED');
 if(!expected||!Number.isSafeInteger(expected.size_bytes)||expected.size_bytes!==bytes.length||typeof expected.content_sha256!=='string'||!/^[a-f0-9]{64}$/.test(expected.content_sha256))fail('FILE_CHANGED');
 // Snapshot before subprocess work: the caller cannot alter the bytes being probed.
 const input=Buffer.from(bytes),hash=createHash('sha256').update(input).digest('hex');
 if(hash!==expected.content_sha256)fail('FILE_CHANGED');
 const result=spawnSync('ffprobe',['-v','error','-max_alloc','67108864','-protocol_whitelist','pipe','-format_whitelist','mov,matroska,png_pipe,jpeg_pipe,webp_pipe','-probesize','50000000','-analyzeduration','5000000','-show_entries',ENTRIES,'-of','json','-i','pipe:0'],{input,timeout:15000,maxBuffer:262144,windowsHide:true,shell:false,env:{PATH:process.env.PATH,LANG:'C'}});
 if(result.error?.code==='ENOENT')fail('PROBE_UNAVAILABLE');
 if(result.error||result.status!==0||result.signal)fail('PROBE_FAILED');
 // Even a successful exit with decoder errors cannot be called a clean probe.
 if(result.stderr?.toString().trim())fail('PROBE_INCOMPLETE');
 let raw;try{raw=JSON.parse(result.stdout.toString());}catch{fail('PROBE_INCOMPLETE');}
 return normalizeProbe(raw,{size_bytes:input.length,content_sha256:hash});
}
module.exports={SCHEMA,PROFILE,MAX_BYTES,normalizeProbe,probeBytes};
