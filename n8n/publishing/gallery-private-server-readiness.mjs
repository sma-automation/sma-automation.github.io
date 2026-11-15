/**
 * SMA private gallery SERVER preflight.
 * LOCAL-ONLY. No HTTP request, DB connection, credential upload, media read,
 * n8n activation, registration, credit, or publishing operation.
 * Prints check IDs and booleans ONLY; never prints environment values.
 */
import {spawnSync} from 'node:child_process';
import {lstatSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const requirePg=createRequire(new URL('../private-gallery-runtime/package.json',import.meta.url));
const USER='sma_gallery_worker_login';
const REF=/^[a-z0-9]{16,40}$/;
const SECRET=s=>typeof s==='string'&&s.length>=12&&s.length<=16384&&!/[\r\n]/.test(s);
const asBool=b=>Boolean(b);
function parseProjectUrl(input){
 if(typeof input!=='string')return null;
 try {
  const u=new URL(input);
  const m=/^([a-z0-9]{16,40})[.]supabase[.]co$/.exec(u.hostname);
  if(!m||u.protocol!=='https:'||u.port||u.username||u.password||
   u.pathname!=='/'||u.hash||u.search)return null;
  return m[1];
 }catch{return null}
}
export function checkGalleryPgTarget(connectionString,supabaseUrl){
 const project=parseProjectUrl(supabaseUrl);
 if(!project||typeof connectionString!=='string'||connectionString.length>1800)
  return false;
 let u;try{u=new URL(connectionString)}catch{return false}
 const direct=u.hostname==='db.'+project+'.supabase.co'&&u.username===USER;
 const pooler=/^[a-z0-9-]+[.]pooler[.]supabase[.]com$/.test(u.hostname)
  &&u.username===USER+'.'+project;
 return ['postgres:','postgresql:'].includes(u.protocol)
  &&(direct||pooler)&&Boolean(u.password)&&u.password.length>=12
  &&!u.hash&&!u.search&&(!u.port||u.port==='5432'||u.port==='6543');
}
function existingCA(path){
 if(path===undefined||path===null||path==='')return true;
 if(typeof path!=='string'||path.length>4096)return false;
 try {const stat=lstatSync(path);return stat.isFile()&&stat.size>0&&stat.size<=1048576;}
 catch{return false}
}
function binaryAvailable(name,spawn){
 try {const res=spawn(name,['-version'],{encoding:'utf8',timeout:5000,windowsHide:true});
  return res.status===0&&!res.error;
 }catch{return false}
}
function pgAvailable(){
 try {return typeof requirePg('pg')?.Client==='function';}
 catch{return false}
}
export function assessGalleryServerReadiness({
 environment=process.env,nodeVersion=process.versions.node,
 spawn=spawnSync,pgInstalled=pgAvailable(),caChecker=existingCA
}={}){
 const env=environment||{};
 const major=Number(String(nodeVersion).split('.')[0]);
 const token=SECRET(env.SMA_GALLERY_GOOGLE_ACCESS_TOKEN);
 const refresh=SECRET(env.SMA_GALLERY_GOOGLE_CLIENT_ID)
  &&SECRET(env.SMA_GALLERY_GOOGLE_CLIENT_SECRET)
  &&SECRET(env.SMA_GALLERY_GOOGLE_REFRESH_TOKEN);
 const items=[
  ['node_22_or_newer',Number.isInteger(major)&&major>=22],
  ['ffmpeg_installed',binaryAvailable('ffmpeg',spawn)],
  ['ffprobe_installed',binaryAvailable('ffprobe',spawn)],
  ['postgres_client_installed',asBool(pgInstalled)],
  ['manual_readonly_optin',env.SMA_GALLERY_ALLOW_READONLY==='1'],
  ['supabase_project_url',parseProjectUrl(env.SMA_GALLERY_SUPABASE_URL)!==null],
  ['private_pg_target',checkGalleryPgTarget(env.SMA_GALLERY_PG_URL,env.SMA_GALLERY_SUPABASE_URL)],
  ['private_storage_credential',SECRET(env.SMA_GALLERY_STORAGE_SERVICE_KEY)],
  ['existing_google_credential',token||refresh],
  ['postgres_ca_file',asBool(caChecker(env.SMA_GALLERY_PG_CA_FILE))]
 ];
 const checks=items.map(([id,ok])=>({id,ok:Boolean(ok)}));
 const configComplete=checks.every(x=>x.ok);
 return Object.freeze({
  schema:'sma-private-gallery-readiness-v1',mode:'offline_no_network',
  configuration_complete:configComplete,
  server_connection_verified:false,worker_executed:false,
  registration_attempted:false,can_publish:false,checks
 });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 const report=assessGalleryServerReadiness();
 process.stdout.write(JSON.stringify(report)+'\n');
 if(!report.configuration_complete)process.exitCode=1;
}
