'use strict';
const CATEGORIES=Object.freeze(['nudity','violence','weapons','gore','hate','drugs','self_harm']);
function eligible(f){
 if(!f||!Number.isSafeInteger(Number(f.size_bytes))||Number(f.size_bytes)<=0)throw Error('FILE_METADATA_INVALID');
 if(!/^(sha256:[a-f0-9]{64}|md5:[a-f0-9]{32}):\d+$/.test(f.revision||''))throw Error('CHECKSUM_REQUIRED');
 if(f.media_kind==='image'){
  if(!['image/jpeg','image/png','image/webp'].includes(f.mime_type)||Number(f.size_bytes)>12000000)throw Error('MEDIA_UNSUPPORTED');
 }else if(f.media_kind==='video'){
  if(!['video/mp4','video/quicktime','video/webm'].includes(f.mime_type)||Number(f.size_bytes)>=50000000||!Number.isFinite(f.duration_ms)||f.duration_ms<=0||f.duration_ms>=60000)throw Error('MEDIA_UNSUPPORTED');
 }else throw Error('MEDIA_UNSUPPORTED');
 return f;
}
function sameFile(meta,context,folders,catalogFiles){
 const f=catalogFiles({files:[meta]},folders)[0];eligible(f);
 if(meta.capabilities?.canDownload!==true||f.drive_file_id!==context.drive_file_id||f.revision!==context.asset_revision||f.mime_type!==context.mime_type||String(f.size_bytes)!==String(context.size_bytes)||f.duration_ms!==context.duration_ms)throw Error('FILE_CHANGED');
 return f;
}
function verifyBytes(buffer,f){
 eligible(f);if(buffer.length!==Number(f.size_bytes))throw Error('FILE_CHANGED');
 const crypto=require('crypto');const [algorithm,expected]=f.revision.split(':');
 if(crypto.createHash(algorithm).update(buffer).digest('hex')!==expected)throw Error('FILE_CHANGED');
 // Signature/animation gate, not a decoder or codec/colour-space validation.
 if(f.mime_type==='image/jpeg'&&!(buffer[0]===255&&buffer[1]===216&&buffer[2]===255))throw Error('MEDIA_UNSUPPORTED');
 if(f.mime_type==='image/png'){
  if(buffer.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('MEDIA_UNSUPPORTED');
  let pos=8,end=false;while(pos+12<=buffer.length){const n=buffer.readUInt32BE(pos),type=buffer.subarray(pos+4,pos+8).toString('ascii');if(n>buffer.length-pos-12||type==='acTL')throw Error('MEDIA_UNSUPPORTED');pos+=n+12;if(type==='IEND'){end=true;break;}}
  if(!end||pos!==buffer.length)throw Error('MEDIA_UNSUPPORTED');
 }
 if(f.mime_type==='image/webp'){
  if(buffer.subarray(0,4).toString()!=='RIFF'||buffer.subarray(8,12).toString()!=='WEBP'||buffer.length!==buffer.readUInt32LE(4)+8)throw Error('MEDIA_UNSUPPORTED');
  let pos=12;while(pos+8<=buffer.length){const type=buffer.subarray(pos,pos+4).toString(),n=buffer.readUInt32LE(pos+4);if(n>buffer.length-pos-8||['ANIM','ANMF'].includes(type)||(type==='VP8X'&&n>0&&(buffer[pos+8]&2)))throw Error('MEDIA_UNSUPPORTED');pos+=8+n+(n%2);}if(pos!==buffer.length)throw Error('MEDIA_UNSUPPORTED');
 }
 if(['video/mp4','video/quicktime'].includes(f.mime_type)&&buffer.subarray(4,8).toString()!=='ftyp')throw Error('MEDIA_UNSUPPORTED');
 if(f.mime_type==='video/webm'&&buffer.subarray(0,4).toString('hex')!=='1a45dfa3')throw Error('MEDIA_UNSUPPORTED');
 return crypto.createHash('sha256').update(buffer).digest('hex');
}
// Provider-neutral frame contract. Providers map their full coverage into these
// categories; absent categories are errors, never zero-probability defaults.
function normalizeFrames(frames,kind,durationMs,policyVersion){
 if(!['image','video'].includes(kind))throw Error('MEDIA_UNSUPPORTED');
 if(typeof policyVersion!=='string'||!/^[-a-z0-9.]{3,100}$/.test(policyVersion))throw Error('REVIEW_INCOMPLETE');
 if(!Array.isArray(frames)||!frames.length||frames.length>125)throw Error('REVIEW_INCOMPLETE');
 if(kind==='image'&&(frames.length!==1||frames[0]?.position_ms!==0))throw Error('REVIEW_INCOMPLETE');
 if(kind==='video'){
  if(!Number.isFinite(durationMs)||durationMs<=0||durationMs>=60000)throw Error('MEDIA_UNSUPPORTED');
  let last=-1;for(const f of frames){const p=f?.position_ms;if(!Number.isFinite(p)||p<0||p<=last||p>durationMs||p-last>1100)throw Error('REVIEW_INCOMPLETE');last=p;}
  if(frames[0].position_ms>100||durationMs-last>1100)throw Error('REVIEW_INCOMPLETE');
 }
 const scores={};for(const category of CATEGORIES){
  let score=0;for(const f of frames){const v=f?.scores?.[category];if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)throw Error('REVIEW_INCOMPLETE');score=Math.max(score,v);}
  scores[category]=score;
 }
 const flagged=Object.entries(scores).filter(([,v])=>v>=0.35).map(([k])=>k);
 return {policy_version:policyVersion,outcome:flagged.length?'needs_review':'clear',categories:flagged,frames_checked:frames.length,sampling_ms:kind==='video'?1000:0,can_publish:false};
}
module.exports={CATEGORIES,eligible,sameFile,verifyBytes,normalizeFrames};
