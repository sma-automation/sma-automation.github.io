/**
 * Private-only adapters for runPrivateGalleryEvidenceWorker().
 * No credentials, network calls, database writes, or browser entrypoint.
 *
 * A privileged backend must inject three authenticated operations:
 *  getSnapshotFromDB(jobId)      -> service-only gallery_worker_snapshot_v1
 *  streamDriveFile(driveFileId)  -> async iterable of authenticated Drive bytes
 *  streamStorageFile(bucket,key) -> async iterable of private Supabase bytes
 *
 * Byte limits are applied while consuming every stream. Do not replace these
 * with download-to-buffer helpers or public/signed URLs.
 */
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const MAX_VIDEO=24000000,MAX_AUDIO=1500000;
const requireValue=(ok,code)=>{if(!ok)throw Error(code);};

export async function boundedPrivateDownload(stream,maxBytes,expectedBytes){
 requireValue(stream&&typeof stream[Symbol.asyncIterator]==='function','UNBOUNDED_DOWNLOAD_NOT_ALLOWED');
 requireValue(Number.isSafeInteger(maxBytes)&&maxBytes>0,'DOWNLOAD_LIMIT_INVALID');
 requireValue(Number.isSafeInteger(expectedBytes)&&expectedBytes>0&&expectedBytes<=maxBytes,'EXPECTED_SIZE_INVALID');
 let size=0;const parts=[];
 try{
  for await(const part of stream){
   requireValue(part instanceof Uint8Array&&part.byteLength>0,'INVALID_DOWNLOAD_CHUNK');
   size+=part.byteLength;
   requireValue(size<=expectedBytes&&size<=maxBytes,'DOWNLOAD_TOO_LARGE');
   parts.push(Buffer.from(part.buffer,part.byteOffset,part.byteLength));
  }
 }catch(e){
  if(typeof stream.destroy==='function')stream.destroy();
  throw e;
 }
 requireValue(size===expectedBytes,'DOWNLOAD_TRUNCATED');
 return Buffer.concat(parts,size);
}

export function createGalleryPrivateAdapters({getSnapshotFromDB,streamDriveFile,streamStorageFile}){
 requireValue(typeof getSnapshotFromDB==='function'&&typeof streamDriveFile==='function'
   &&typeof streamStorageFile==='function','MISSING_TRUSTED_TRANSPORT');
 let jobId=null,first=null;
 const trusted=async id=>{
  requireValue(UUID.test(id),'INVALID_JOB_ID');
  if(jobId!==null)requireValue(jobId===id,'CONCURRENT_JOB_FORBIDDEN');
  const snap=await getSnapshotFromDB(id);
  requireValue(snap&&snap.gallery_job_id===id&&snap.state==='completed','NO_TRUSTED_JOB');
  requireValue(SHA.test(snap.track_sha)&&SHA.test(snap.audio_sha256),'UNVERIFIED_AUDIO_ID');
  requireValue(typeof snap.audio_object_name==='string'&&
   snap.audio_object_name==='render/'+snap.track_sha+'/'+snap.audio_sha256+'.aac',
   'AUDIO_OBJECT_PATH_MISMATCH');
  requireValue(Number.isSafeInteger(snap.audio_size_bytes)&&
   snap.audio_size_bytes>0&&snap.audio_size_bytes<=MAX_AUDIO,'AUDIO_SIZE_INVALID');
  if(first!==null){
   requireValue(snap.audio_object_name===first.audio_object_name&&
    snap.audio_size_bytes===first.audio_size_bytes,'AUDIO_OBJECT_CHANGED');
  }else first=snap;
  jobId=id;
  return snap;
 };
 return {
  getSnapshot:trusted,
  readDriveFile:async fileId=>{
   requireValue(jobId!==null&&first!==null,'SNAPSHOT_REQUIRED');
   const items=[first.source,first.result];
   const chosen=items.find(i=>i?.drive_file_id===fileId);
   requireValue(chosen&&chosen.available===true&&chosen.mime_type==='video/mp4',
     'DRIVE_FILE_NOT_IN_TRUSTED_JOB');
   requireValue(Number.isSafeInteger(chosen.size_bytes)&&
     chosen.size_bytes>0&&chosen.size_bytes<=MAX_VIDEO,'VIDEO_SIZE_INVALID');
   const stream=await streamDriveFile(fileId,{maxBytes:chosen.size_bytes});
   return boundedPrivateDownload(stream,MAX_VIDEO,chosen.size_bytes);
  },
  readTrackAudio:async trackSha=>{
   requireValue(jobId!==null&&first!==null,'SNAPSHOT_REQUIRED');
   requireValue(trackSha===first.track_sha,'TRACK_NOT_IN_TRUSTED_JOB');
   const stream=await streamStorageFile('sma-katalog',first.audio_object_name,
     {maxBytes:first.audio_size_bytes});
   return boundedPrivateDownload(stream,MAX_AUDIO,first.audio_size_bytes);
  }
 };
}
