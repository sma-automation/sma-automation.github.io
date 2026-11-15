/**
 * Offline only: bind a locally verified gallery MP4 to a catalog receipt.
 * No Supabase, Drive, n8n, approval, credit or publishing writes.
 * Usage: node gallery-technical-candidate.mjs SOURCE.mp4 MUSIC.aac SAVED.mp4 RECEIPT.json
 * Receipt fields: asset_id, source_asset_id, drive_file_id,
 * asset_revision, sha256, size_bytes, source_sha256.
 */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {reconcileGalleryBytes,verifyActualGalleryFile} from './verify-gallery-output.mjs';
const SHA=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireValue=(ok,reason)=>{if(!ok)throw Error(reason);};
function probe(file,args){
 return JSON.parse(execFileSync('ffprobe',['-v','error',...args,'-of','json',file],
  {encoding:'utf8',timeout:30000,maxBuffer:6000000}));
}
function streamEvidence(file){
 const streams=probe(file,['-show_streams']).streams||[];
 requireValue(streams.length===2,'STREAM_COUNT_INVALID');
 const video=streams.find(x=>x.codec_type==='video'),audio=streams.find(x=>x.codec_type==='audio');
 requireValue(Boolean(video&&audio),'STREAMS_MISSING');
 const fps=String(video.avg_frame_rate||'').split('/').map(Number);
 requireValue(fps.length===2&&fps.every(x=>Number.isSafeInteger(x)&&x>0),'FRAME_RATE_INVALID');
 const frames=probe(file,['-select_streams','v:0','-show_frames',
  '-show_entries','frame=best_effort_timestamp_time']).frames||[];
 const times=frames.map(f=>Math.round(Number(f.best_effort_timestamp_time)*1e6));
 requireValue(times.length>=2&&times.length<=14400&&times.every(Number.isSafeInteger),'FRAME_COUNT_INVALID');
 const gaps=times.slice(1).map((time,i)=>time-times[i]);
 requireValue(gaps.every(g=>g>0),'FRAME_TIMING_INVALID');
 const bitRate=x=>x===undefined||x===null?null:Number(x);
 const technical={
  schema:'sma-video-technical-v1',decode:'complete',
  video_codec:video.codec_name,pixel_format:video.pix_fmt,
  width_px:video.width,height_px:video.height,
  frame_rate_num:fps[0],frame_rate_den:fps[1],decoded_frames:times.length,
  min_frame_interval_us:Math.min(...gaps),max_frame_interval_us:Math.max(...gaps),
  video_bit_rate_bps:bitRate(video.bit_rate),
  audio_codec:audio.codec_name,audio_sample_rate_hz:Number(audio.sample_rate),
  audio_channels:audio.channels,audio_bit_rate_bps:bitRate(audio.bit_rate)
 };
 requireValue(Object.values(technical).every(x=>x!==undefined&&x===x),'TECHNICAL_METADATA_INCOMPLETE');
 return technical;
}
export async function prepareGalleryTechnicalCandidate({sourcePath,audioPath,savedPath,receipt}){
 requireValue(receipt&&typeof receipt==='object'&&!Array.isArray(receipt),'RECEIPT_REQUIRED');
 requireValue(UUID.test(receipt.asset_id)&&UUID.test(receipt.source_asset_id),'ASSET_ID_INVALID');
 requireValue(typeof receipt.drive_file_id==='string'&&/^[a-zA-Z0-9_-]{10,100}$/.test(receipt.drive_file_id),'DRIVE_ID_INVALID');
 requireValue(SHA.test(receipt.sha256)&&SHA.test(receipt.source_sha256),'RECEIPT_HASH_INVALID');
 requireValue(Number.isSafeInteger(receipt.size_bytes)&&receipt.size_bytes>0,'RECEIPT_SIZE_INVALID');
 requireValue(typeof receipt.asset_revision==='string'&&
  new RegExp('^sha256:'+receipt.sha256+':[1-9][0-9]*$').test(receipt.asset_revision),
  'ASSET_REVISION_MISMATCH');
 const [source,audio,saved]=await Promise.all([readFile(sourcePath),readFile(audioPath),readFile(savedPath)]);
 requireValue(sha256(source)===receipt.source_sha256,'SOURCE_SHA_MISMATCH');
 const compared=reconcileGalleryBytes({original:source,aac:audio,observed:saved,
  expectedSha:receipt.sha256,expectedSize:receipt.size_bytes});
 requireValue(compared.observed?.receipt_match===true,'SAVED_RECEIPT_MISMATCH');
 const checked=verifyActualGalleryFile(sourcePath,savedPath);
 requireValue(checked.valid===true&&checked.status==='technical_checks_pass'&&
  checked.unchanged_video_packets===true&&checked.soundtrack_non_silent===true,
  'TECHNICAL_CHECKS_INCOMPLETE');
 const technical=streamEvidence(savedPath);
 requireValue(checked.audio_sample_rate_hz===technical.audio_sample_rate_hz&&
  checked.video_bitrate_bps===technical.video_bit_rate_bps,'STREAM_PROBE_DISAGREES');
 return {
  schema:'sma-gallery-technical-candidate-v1',status:'local_technical_evidence',
  binding:{asset_id:receipt.asset_id,source_asset_id:receipt.source_asset_id,
   drive_file_id:receipt.drive_file_id,asset_revision:receipt.asset_revision,
   sha256:receipt.sha256,size_bytes:receipt.size_bytes,source_sha256:receipt.source_sha256},
  technical,volume:{mean_dbfs:checked.soundtrack_mean_dbfs,
   peak_dbfs:checked.soundtrack_peak_dbfs,non_silent:checked.soundtrack_non_silent},
  packet_identity_verified:checked.unchanged_video_packets,
  receipt_bytes_verified:compared.observed.receipt_match,
  reconstructed_matches_receipt:compared.reconstruction_matches_receipt,
  restrictions:{registered_in_supabase:false,requires_trusted_ingestion:true,
   content_review:'not_checked',rights_review:'not_checked',
   customer_approval:false,can_upload:false,can_publish:false}
 };
}
async function main(){
 const args=process.argv.slice(2);
 requireValue(args.length===4,'USAGE: SOURCE.mp4 MUSIC.aac SAVED.mp4 RECEIPT.json');
 const receipt=JSON.parse(await readFile(args[3],'utf8'));
 const candidate=await prepareGalleryTechnicalCandidate({sourcePath:args[0],audioPath:args[1],
  savedPath:args[2],receipt});
 process.stdout.write(JSON.stringify(candidate,null,2)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(err=>{console.error('GALLERY_CANDIDATE_REJECTED:',err.message);process.exitCode=1});
