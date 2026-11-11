/**
 * SMA gallery soundtrack: read-only, offline receipt reconciliation.
 *
 * Usage:
 * node n8n/publishing/verify-gallery-output.mjs SOURCE.mp4 AUDIO.aac EXPECTED_SHA256 EXPECTED_BYTES [OBSERVED.mp4]
 *
 * Without OBSERVED.mp4 the stored result remains UNVERIFIED even when
 * reconstruction matches. Never uploads, spends credits, approves or posts.
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import soundtrack from './gallery-soundtrack.cjs';

const sha256=b=>createHash('sha256').update(b).digest('hex');
const requireValue=(condition,message)=>{if(!condition)throw Error(message);};

export function reconcileGalleryBytes({original,aac,expectedSha,expectedSize,observed=null}){
 requireValue(Buffer.isBuffer(original)&&original.length<=24000000,'INVALID_ORIGINAL');
 requireValue(Buffer.isBuffer(aac)&&aac.length<=1500000,'INVALID_AUDIO');
 requireValue(/^[a-f0-9]{64}$/.test(expectedSha),'INVALID_RECEIPT_SHA');
 requireValue(Number.isSafeInteger(expectedSize)&&expectedSize>0&&expectedSize<=24000000,'INVALID_RECEIPT_SIZE');
 const reconstructed=soundtrack.soundtrackMP4(original,aac);
 requireValue(reconstructed.state==='rendered','SOURCE_NOT_SILENT');
 const result={size_bytes:reconstructed.bytes.length,sha256:sha256(reconstructed.bytes)};
 const reconstruction_matches_receipt=result.size_bytes===expectedSize&&result.sha256===expectedSha;
 const report={
  status:'requires_original_saved_output',source_sha256:sha256(original),audio_sha256:sha256(aac),
  receipt:{sha256:expectedSha,size_bytes:expectedSize},reconstructed:result,
  reconstruction_matches_receipt,actual_output_checked:false,can_publish:false
 };
 if(observed!==null){
  requireValue(Buffer.isBuffer(observed)&&observed.length<=24000000,'INVALID_OBSERVED_FILE');
  const hash=sha256(observed),same=hash===expectedSha&&observed.length===expectedSize;
  report.observed={sha256:hash,size_bytes:observed.length,receipt_match:same};
  report.actual_output_checked=true;
  report.status=same?'saved_bytes_authenticated':'observed_file_differs_from_receipt';
 }
 return report;
}

function ffprobe(path){
 const json=execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],
  {encoding:'utf8',timeout:30000,maxBuffer:3000000});
 return JSON.parse(json);
}

function packetHashes(path){
 const output=execFileSync('ffprobe',['-v','error','-select_streams','v:0',
  '-show_packets','-show_data_hash','SHA256','-show_entries','packet=data_hash','-of','csv=p=0',path],
  {encoding:'utf8',timeout:30000,maxBuffer:3000000});
 return output.trim().split('\n');
}

export function verifyActualGalleryFile(sourceFile,observedFile){
 const actual=ffprobe(observedFile),source=ffprobe(sourceFile);
 const streams=actual.streams||[];
 const video=streams.filter(s=>s.codec_type==='video');
 const audio=streams.filter(s=>s.codec_type==='audio');
 const sourceVideo=(source.streams||[]).filter(s=>s.codec_type==='video');
 if(streams.length!==2||video.length!==1||audio.length!==1||sourceVideo.length!==1)
  return {status:'stream_count_invalid',valid:false};
 const v=video[0],a=audio[0],sv=sourceVideo[0];
 const codecAllowed=['h264','hevc'].includes(v.codec_name);
 const sameVideoPackets=v.codec_name===sv.codec_name&&v.width===sv.width&&v.height===sv.height&&
  packetHashes(sourceFile).join('|')===packetHashes(observedFile).join('|');
 const aacOk=a.codec_name==='aac'&&a.profile==='LC'&&Number(a.sample_rate)===48000&&a.channels===2;
 const durationOk=Math.abs(Number(v.duration||actual.format?.duration)-
                            Number(a.duration||actual.format?.duration))<=0.10;
 const videoBitrate=Number(v.bit_rate);
 const bitrateOk=Number.isFinite(videoBitrate)&&videoBitrate>0&&videoBitrate<=25000000;
 const valid=codecAllowed&&sameVideoPackets&&aacOk&&durationOk&&bitrateOk;
 let decoded=false;
 if(valid){
  execFileSync('ffmpeg',['-nostdin','-v','error','-xerror','-i',observedFile,'-f','null','-'],
   {timeout:90000,stdio:['ignore','ignore','pipe']});
  decoded=true;
 }
 return {
  status:valid&&decoded?'technical_checks_pass':'technical_checks_incomplete',
  valid:valid&&decoded,unchanged_video_packets:sameVideoPackets,
  h264_or_hevc:codecAllowed,video_bitrate_bps:videoBitrate,
  audio_aac_lc_stereo_48000:aacOk,video_and_audio_duration_agree:durationOk,
  audio_bitrate_bps:Number(a.bit_rate)||null,full_decode_passed:decoded
 };
}

async function main(){
 const [, ,sourcePath,audioPath,hash,size,observedPath]=process.argv;
 requireValue(sourcePath&&audioPath&&hash&&size&&process.argv.length<=7,
  'USAGE: SOURCE.mp4 AUDIO.aac EXPECTED_SHA256 EXPECTED_BYTES [OBSERVED.mp4]');
 const [source,audio,observed]=await Promise.all([
  readFile(sourcePath),readFile(audioPath),observedPath?readFile(observedPath):null
 ]);
 const report=reconcileGalleryBytes({
  original:source,aac:audio,expectedSha:hash,expectedSize:Number(size),observed
 });
 if(observedPath&&report.observed?.receipt_match)
  report.technical=verifyActualGalleryFile(sourcePath,observedPath);
 console.log(JSON.stringify(report,null,2));
 if(observedPath&&(!report.observed?.receipt_match||!report.technical?.valid))
  process.exitCode=1;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error('GALLERY_VERIFY_FAILED:',e.message);process.exitCode=1});
