'use strict';
const crypto = require('crypto');
const CONTAINER = /^cntr_[a-zA-Z0-9]{10,100}$/;
const CFILE = /^cfile_[a-zA-Z0-9]{10,100}$/;
function checkedVideo(bytes, context) {
  if (context?.mime_type !== 'video/mp4' || context.media_kind !== 'video' ||
      !Number.isSafeInteger(context.size_bytes) || context.size_bytes < 1 || context.size_bytes > 24000000 ||
      !/^sha256:[a-f0-9]{64}:\d+$/.test(context.revision || '')) throw Error('VIDEO_UNSUPPORTED');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== context.size_bytes || sha256 !== context.revision.split(':')[1]) throw Error('FILE_CHANGED');
  if (bytes.subarray(4,8).toString() !== 'ftyp') throw Error('VIDEO_UNSUPPORTED');
  return {sha256, size_bytes: bytes.length};
}
// One stored ZIP member with a fixed filename. Nothing supplied by the customer
// becomes a path, command, URL, or code in the extraction environment.
function zipVideo(bytes) {
  const name = Buffer.from('source.mp4');
  let crc = 0xffffffff;
  for (const b of bytes) { crc ^= b; for (let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  crc=(crc^0xffffffff)>>>0;
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);
  local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
  central.writeUInt32LE(crc,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);
  end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+bytes.length,16);
  return Buffer.concat([local,name,bytes,central,name,end]);
}
function containerId(value) { if(!CONTAINER.test(value||''))throw Error('VIDEO_CONTAINER_INVALID');return value; }
function extractionRequest(upload, container, context, script) {
  const id=containerId(container.id);
  if(upload.container_id!==id || !CFILE.test(upload.id||'') ||
      !/^\/mnt\/data\/[a-zA-Z0-9_.-]+\.zip$/.test(upload.path||''))throw Error('VIDEO_UPLOAD_INVALID');
  const source=`SOURCE_ZIP=${JSON.stringify(upload.path)}\nEXPECTED_SHA256=${JSON.stringify(context.sha256)}\nEXPECTED_SIZE=${context.size_bytes}\n`+script;
  const code='exec('+JSON.stringify(source)+')';
  return {container_id:id,sha256:context.sha256,size_bytes:context.size_bytes,expected_code:code,request:{model:'gpt-5',store:false,reasoning:{effort:'low'},max_output_tokens:12000,
    tools:[{type:'code_interpreter',container:id}],tool_choice:'required',max_tool_calls:1,
    include:['code_interpreter_call.outputs'],
    input:'Execute exactly the following single Python statement once with the python tool. Preserve it verbatim, without code fences or comments. Do not inspect media, invent results, install software, use network, or execute any other code. The fixed program decodes a checksum-verified video and writes evidence. After execution, report only success or failure.\n'+code}};
}
function extractionResult(response, context) {
  const calls=response.output?.filter(o=>o.type==='code_interpreter_call');
  if(response.status!=='completed'||response.error||calls?.length!==1||calls[0].status!=='completed'||
     calls[0].container_id!==context.container_id||calls[0].code?.replace(/\r\n/g,'\n').trim()!==context.expected_code)
    throw Error('VIDEO_EXTRACTION_UNVERIFIED');
  const logs=calls[0].outputs?.filter(o=>o.type==='logs');
  if(logs?.length!==1||typeof logs[0].logs!=='string'||logs[0].logs.length>10000)throw Error('VIDEO_EXTRACTION_UNVERIFIED');
  let manifest;try{manifest=JSON.parse(logs[0].logs);}catch{throw Error('VIDEO_EXTRACTION_UNVERIFIED');}
  evidenceManifest(manifest,context);
  return {container_id:containerId(context.container_id),extracted_manifest:manifest};
}
function evidenceFiles(response,id) {
  containerId(id);
  if(!Array.isArray(response.data)||response.has_more)throw Error('VIDEO_EVIDENCE_INVALID');
  const result={container_id:id};
  for(const [key,name] of [['manifest','manifest.json'],['frames','frames.jpg'],['audio','audio.wav']]) {
    const matches=response.data.filter(x=>x.path==='/mnt/data/sma_evidence/'+name);
    if(matches.length!==1) {if(key==='audio'&&matches.length===0)continue;throw Error('VIDEO_EVIDENCE_INVALID');}
    // Generated container files can report bytes:null. Size is then unknown;
    // downloaded bytes must still pass the manifest's exact size and hash.
    const f=matches[0];if(f.container_id!==id||!CFILE.test(f.id)||
      (f.bytes!==null&&(!Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>8000000)))throw Error('VIDEO_EVIDENCE_INVALID');
    result[key+'_id']=f.id;
  }
  return result;
}
function evidenceManifest(m,context) {
  if(m.schema!=='sma-video-evidence-v1'||m.sha256!==context.sha256||m.size_bytes!==context.size_bytes||
     !Number.isInteger(m.duration_ms)||m.duration_ms<1||m.duration_ms>60000||
     !['extracted','no_audio_stream'].includes(m.audio_status)||
     !Array.isArray(m.positions_ms)||m.positions_ms.length<2||m.positions_ms.length>21||
     m.positions_ms[0]!==0||m.duration_ms-m.positions_ms.at(-1)>200||
     m.positions_ms.some((p,i)=>!Number.isInteger(p)||p<0||p>=m.duration_ms||(i>0&&p<=m.positions_ms[i-1]))||
     m.sampling!=='representative_frames_not_full_moderation')throw Error('VIDEO_EVIDENCE_INVALID');
  for(const key of ['frames.jpg',...(m.audio_status==='extracted'?['audio.wav']:[])]) {
    if(!/^[a-f0-9]{64}$/.test(m[key]?.sha256||'')||!Number.isInteger(m[key]?.size_bytes)||m[key].size_bytes<1||m[key].size_bytes>8000000)throw Error('VIDEO_EVIDENCE_INVALID');
  }
  return m;
}
function evidenceBytes(bytes,manifest,name) {
  if(bytes.length!==manifest[name]?.size_bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==manifest[name].sha256)throw Error('VIDEO_EVIDENCE_INVALID');
  if(name==='frames.jpg'&&bytes.subarray(0,3).toString('hex')!=='ffd8ff')throw Error('VIDEO_EVIDENCE_INVALID');
  if(name==='audio.wav'&&(bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WAVE'))throw Error('VIDEO_EVIDENCE_INVALID');
  return true;
}
module.exports={checkedVideo,zipVideo,containerId,extractionRequest,extractionResult,evidenceFiles,evidenceManifest,evidenceBytes};
