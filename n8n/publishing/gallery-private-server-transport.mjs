/**
 * SMA private server: authenticated, bounded, READ-ONLY gallery transport.
 *
 * Runs only when a trusted backend calls this module with its private
 * PostgreSQL query client and secret-backed token providers. There are no
 * webhooks, listeners, automatic jobs, registration, or provider uploads.
 *
 * The sole database statement calls the already installed, service-only
 * snapshot function. Client-supplied Drive IDs, storage paths or URLs are
 * never accepted by this module.
 */
import {Readable} from 'node:stream';
import {createGalleryPrivateAdapters} from './gallery-private-transport-adapters.mjs';
import {runPrivateGalleryEvidenceWorker} from './gallery-private-evidence-worker.mjs';

const JOB=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const DRIVE=/^[A-Za-z0-9_-]{10,100}$/;
const OBJECT=/^render\/[a-f0-9]{64}\/[a-f0-9]{64}[.]aac$/;
const MAX_VIDEO=24000000,MAX_AUDIO=1500000;
const SNAPSHOT_SQL='select sma_private.gallery_worker_snapshot_v1($1::uuid) as snapshot';
function requireSafe(ok,code){if(!ok)throw Error(code);}
function asSecret(token){
 requireSafe(typeof token==='string'&&token.length>=12&&token.length<=16384
  &&!/[\s\r\n]/.test(token),'SERVER_CREDENTIAL_INVALID');
 return token;
}
function allowedSupabaseUrl(url){
 requireSafe(typeof url==='string'&&url.length<160,'SUPABASE_ORIGIN_INVALID');
 let x;try{x=new URL(url);}catch{throw Error('SUPABASE_ORIGIN_INVALID');}
 requireSafe(x.protocol==='https:'&&/^[a-z0-9]{16,40}[.]supabase[.]co$/.test(x.hostname)
  &&x.username===''&&x.password===''&&x.pathname==='/'&&x.search===''&&x.hash===''
  &&x.port==='','SUPABASE_ORIGIN_INVALID');
 return x.origin;
}
function safeSize(value,max){
 requireSafe(Number.isSafeInteger(value)&&value>0&&value<=max,'EXPECTED_DOWNLOAD_SIZE_INVALID');
 return value;
}

function readContentLength(response,maxBytes){
 const h=response?.headers?.get?.('content-length');
 if(h===null||h===undefined)return;
 requireSafe(/^[0-9]{1,9}$/.test(h),'DOWNLOAD_LENGTH_HEADER_INVALID');
 requireSafe(Number(h)>0&&Number(h)<=maxBytes,'DOWNLOAD_LENGTH_EXCEEDS_LIMIT');
}
async function authenticatedStream({fetchImpl,url,tokenProvider,maxBytes,category,timeoutMs}){
 // Fetch only to hardcoded Google Drive or the validated project origin.
 const token=asSecret(await tokenProvider());
 let res;
 try{
  res=await fetchImpl(url,{
   method:'GET',headers:{authorization:'Bearer '+token,accept:'application/octet-stream',
    'accept-encoding':'identity'},
   redirect:'error',cache:'no-store',signal:AbortSignal.timeout(timeoutMs)
  });
 }catch{throw Error(category+'_NETWORK_FAILED');}
 requireSafe(res?.status===200,category+'_DOWNLOAD_DENIED');
 requireSafe(res.body&&typeof res.body.getReader==='function',category+'_BODY_MISSING');
 readContentLength(res,maxBytes);
 return Readable.fromWeb(res.body);
}
/**
 * @param db Private server-owned PG client exposing query(sql, [jobUUID]).
 * @param getDriveAccessToken Function bound to the existing Drive credential.
 * @param getStorageAccessToken Function bound to a backend-only secret.
 * @param supabaseUrl Fixed Supabase project URL; never from an HTTP request.
 * @param fetchImpl Only for offline integration test injection.
 */
export function createGalleryPrivateServerTransport({
 db,getDriveAccessToken,getStorageAccessToken,supabaseUrl,
 fetchImpl=globalThis.fetch,timeoutMs=30000
}){
 requireSafe(db&&typeof db.query==='function','PRIVATE_DB_REQUIRED');
 requireSafe(typeof getDriveAccessToken==='function'&&
  typeof getStorageAccessToken==='function','PRIVATE_AUTH_REQUIRED');
 requireSafe(typeof fetchImpl==='function','PRIVATE_FETCH_REQUIRED');
 requireSafe(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=90000,
  'TIMEOUT_INVALID');
 const origin=allowedSupabaseUrl(supabaseUrl);
 const getSnapshotFromDB=async galleryJobId=>{
  requireSafe(JOB.test(galleryJobId),'GALLERY_JOB_ID_INVALID');
  let result;
  try{result=await db.query(SNAPSHOT_SQL,[galleryJobId]);}
  catch{throw Error('PRIVATE_SNAPSHOT_QUERY_FAILED');}
  requireSafe(Array.isArray(result?.rows)&&result.rows.length===1,
   'PRIVATE_SNAPSHOT_RESULT_INVALID');
  return result.rows[0].snapshot||null;
 };
 const streamDriveFile=async(fileId,{maxBytes}={})=>{
  requireSafe(DRIVE.test(fileId),'DRIVE_ID_INVALID');
  safeSize(maxBytes,MAX_VIDEO);
  return authenticatedStream({
   fetchImpl,category:'DRIVE',maxBytes,timeoutMs,tokenProvider:getDriveAccessToken,
   url:'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)
    +'?alt=media&supportsAllDrives=true'
  });
 };
 const streamStorageFile=async(bucket,path,{maxBytes}={})=>{
  requireSafe(bucket==='sma-katalog'&&typeof path==='string'&&OBJECT.test(path),
   'STORAGE_OBJECT_NOT_ALLOWED');
  safeSize(maxBytes,MAX_AUDIO);
  const name=path.split('/').map(encodeURIComponent).join('/');
  return authenticatedStream({fetchImpl,category:'STORAGE',maxBytes,timeoutMs,
   tokenProvider:getStorageAccessToken,
   url:origin+'/storage/v1/object/authenticated/sma-katalog/'+name});
 };
 return createGalleryPrivateAdapters({
  getSnapshotFromDB,streamDriveFile,streamStorageFile
 });
}

/** Always read-only. No registrar is accepted, even if extra props are passed. */
export async function runGalleryPrivateServerReadOnly({
 galleryJobId,db,getDriveAccessToken,getStorageAccessToken,supabaseUrl,
 fetchImpl=globalThis.fetch,timeoutMs=30000
}){
 requireSafe(JOB.test(galleryJobId),'GALLERY_JOB_ID_INVALID');
 const transport=createGalleryPrivateServerTransport({
  db,getDriveAccessToken,getStorageAccessToken,supabaseUrl,fetchImpl,timeoutMs
 });
 return runPrivateGalleryEvidenceWorker({galleryJobId,...transport,
  enableRegistration:false});
}
