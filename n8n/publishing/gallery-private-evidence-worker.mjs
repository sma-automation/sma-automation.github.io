/**
 * Private gallery evidence worker core; NO automatic deployment or network.
 *
 * A future authenticated service adapter must provide all four functions.
 * No request body is accepted as evidence: the only caller input is a job UUID.
 * All source metadata is loaded from the authoritative private database.
 * Registration is opt-in and is never enabled by this module.
 *
 * Required adapters:
 *   getSnapshot(jobId): trusted DB read of gallery job + source/result files
 *   readDriveFile(fileId): authenticated, size-bounded raw Google Drive bytes
 *   readTrackAudio(trackSha): authenticated private AAC sidecar bytes
 *   registerEvidence(candidate): private service-role-only DB RPC
 *
 * The adapter must independently authenticate upstream accounts and limit
 * response size BEFORE buffering. Do not use public URLs or browser tokens.
 */
import {createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareGalleryTechnicalCandidate} from './gallery-technical-candidate.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const DRIVE=/^[a-zA-Z0-9_-]{10,100}$/;
const REV=/^sha256:([a-f0-9]{64}):[0-9]+$/;
const sha256=b=>createHash('sha256').update(b).digest('hex');
const must=(condition,code)=>{if(!condition)throw Error(code);};

function assertFile(file,kind){
 must(file&&typeof file==='object','SNAPSHOT_FILE_MISSING');
 must(UUID.test(file.asset_id)&&DRIVE.test(file.drive_file_id),'SNAPSHOT_FILE_ID_INVALID');
 must(file.available===true&&file.mime_type==='video/mp4'&&file.media_kind==='video',
  'SNAPSHOT_MEDIA_INVALID');
 const rev=REV.exec(file.revision||'');
 must(rev!==null,'SNAPSHOT_REVISION_INVALID');
 must(Number.isSafeInteger(file.size_bytes)&&file.size_bytes>=12&&file.size_bytes<=24000000,
  'SNAPSHOT_FILE_SIZE_INVALID');
 return {asset_id:file.asset_id,drive_file_id:file.drive_file_id,
  revision:file.revision,sha256:rev[1],size_bytes:file.size_bytes,kind};
}

export function validateGallerySnapshot(jobId,snapshot){
 must(UUID.test(jobId),'JOB_ID_INVALID');
 must(snapshot&&typeof snapshot==='object','SNAPSHOT_MISSING');
 must(snapshot.gallery_job_id===jobId&&snapshot.state==='completed',
  'JOB_NOT_COMPLETED');
 must(Number.isSafeInteger(snapshot.customer_id)&&snapshot.customer_id>0
  &&UUID.test(snapshot.user_id)&&snapshot.customer_active===true,'CUSTOMER_INACTIVE');
 must(SHA.test(snapshot.track_sha)&&SHA.test(snapshot.audio_sha256),'AUDIO_BINDING_MISSING');
 const source=assertFile(snapshot.source,'source');
 const result=assertFile(snapshot.result,'result');
 must(source.asset_id!==result.asset_id&&source.drive_file_id!==result.drive_file_id,
  'SOURCE_EQUALS_RESULT');
 must(snapshot.expected_sha===result.sha256
  &&snapshot.expected_size===result.size_bytes,'GALLERY_RECEIPT_MISMATCH');
 must(snapshot.source_key==='sha256:'+source.sha256,'GALLERY_SOURCE_KEY_CHANGED');
 return {
  gallery_job_id:jobId,customer_id:snapshot.customer_id,user_id:snapshot.user_id,
  customer_active:true,track_sha:snapshot.track_sha,audio_sha256:snapshot.audio_sha256,
  source,result,source_key:snapshot.source_key,expected_sha:snapshot.expected_sha,
  expected_size:snapshot.expected_size
 };
}
const fingerprint=x=>sha256(Buffer.from(JSON.stringify(x)));

function verifiedBuffer(bytes,expectedSha,maxBytes,expectedSize=null){
 must(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=maxBytes,'BYTE_LIMIT_OR_TYPE_INVALID');
 if(expectedSize!==null)must(bytes.length===expectedSize,'BYTE_SIZE_MISMATCH');
 must(sha256(bytes)===expectedSha,'BYTE_SHA_MISMATCH');
 return bytes;
}

/**
 * By default this returns a proof candidate and never calls registerEvidence.
 * The registration option exists only for a separately approved private
 * deployment. It must never be set by browser/customer-provided data.
 */
export async function runPrivateGalleryEvidenceWorker({
 galleryJobId,getSnapshot,readDriveFile,readTrackAudio,registerEvidence,
 enableRegistration=false
}){
 must(UUID.test(galleryJobId),'JOB_ID_INVALID');
 must(typeof getSnapshot==='function'&&typeof readDriveFile==='function'
  &&typeof readTrackAudio==='function','TRUSTED_ADAPTERS_REQUIRED');
 must(enableRegistration===false||enableRegistration===true,'REGISTRATION_SWITCH_INVALID');
 if(enableRegistration)must(typeof registerEvidence==='function','REGISTRAR_REQUIRED');

 // The caller cannot inject file IDs, customer IDs or a fabricated receipt.
 const initial=validateGallerySnapshot(galleryJobId,await getSnapshot(galleryJobId));
 const [sourceBytes,resultBytes,audioBytes]=await Promise.all([
  readDriveFile(initial.source.drive_file_id),
  readDriveFile(initial.result.drive_file_id),
  readTrackAudio(initial.track_sha)
 ]);
 verifiedBuffer(sourceBytes,initial.source.sha256,24000000,initial.source.size_bytes);
 verifiedBuffer(resultBytes,initial.result.sha256,24000000,initial.result.size_bytes);
 verifiedBuffer(audioBytes,initial.audio_sha256,1500000);

 const dir=await mkdtemp(join(tmpdir(),'sma-gallery-evidence-'));
 let candidate;
 try{
  const sourcePath=join(dir,'source.mp4'),audioPath=join(dir,'track.aac'),
        savedPath=join(dir,'saved.mp4');
  await Promise.all([
   writeFile(sourcePath,sourceBytes,{flag:'wx',mode:0o600}),
   writeFile(audioPath,audioBytes,{flag:'wx',mode:0o600}),
   writeFile(savedPath,resultBytes,{flag:'wx',mode:0o600})
  ]);
  candidate=await prepareGalleryTechnicalCandidate({
   sourcePath,audioPath,savedPath,
   receipt:{asset_id:initial.result.asset_id,source_asset_id:initial.source.asset_id,
    drive_file_id:initial.result.drive_file_id,
    asset_revision:initial.result.revision,sha256:initial.result.sha256,
    size_bytes:initial.result.size_bytes,source_sha256:initial.source.sha256}
  });
 }finally{
  await rm(dir,{recursive:true,force:true});
 }
 must(candidate.receipt_bytes_verified===true
  &&candidate.packet_identity_verified===true
  &&candidate.volume?.non_silent===true
  &&candidate.restrictions?.can_publish===false
  &&candidate.restrictions?.can_upload===false,'PROOF_NOT_VERIFIED');
 // Prevent source/receipt replacement while expensive decoding happened.
 const current=validateGallerySnapshot(galleryJobId,await getSnapshot(galleryJobId));
 must(fingerprint(initial)===fingerprint(current),'SNAPSHOT_CHANGED_BEFORE_REGISTRATION');

 if(!enableRegistration)return {
  ok:true,state:'verified_not_registered',registration_attempted:false,
  can_upload:false,can_publish:false,candidate
 };
 const received=await registerEvidence(candidate);
 must(received?.ok===true&&received?.state==='technical_evidence_recorded'
  &&received?.asset_id===initial.result.asset_id
  &&received?.asset_revision===initial.result.revision
  &&received?.can_upload===false&&received?.can_publish===false,
  'REGISTRATION_REJECTED');
 return {ok:true,state:'registered_technical_only',
  registration_attempted:true,can_upload:false,can_publish:false,
  asset_id:received.asset_id,asset_revision:received.asset_revision};
}
