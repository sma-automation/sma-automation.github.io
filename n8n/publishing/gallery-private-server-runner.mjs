#!/usr/bin/env node
/**
 * SINGLE manually invoked, private server read-only gallery check.
 * No scheduler, browser route, webhook, registration, credit or publication.
 * Requires existing, operator-provisioned secret credentials in ENV.
 * One internal gallery job UUID is the only command-line argument.
 */
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {runGalleryPrivateServerReadOnly} from './gallery-private-server-transport.mjs';
import {createGoogleDriveRefreshProvider} from './gallery-private-google-refresh.mjs';

const requirePg=createRequire(new URL('../private-gallery-runtime/package.json',import.meta.url));
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const env=process.env;
const JOB=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const assert=(yes,reason)=>{if(!yes)throw Error(reason);};
const secret=(name,source)=>{
 const value=source[name];
 assert(typeof value==='string'&&value.length>=8&&value.length<=16384,'MISSING_PRIVATE_'+name);
 return value;
};
export async function runPrivateGalleryCLI({argv=process.argv.slice(2),environment=env}={}){
 assert(Array.isArray(argv)&&argv.length===1&&JOB.test(argv[0]),'JOB_UUID_REQUIRED');
 assert(environment.SMA_GALLERY_ALLOW_READONLY==='1','READONLY_OPERATOR_OPT_IN_REQUIRED');
 // Never parse arbitrary URLs from the gallery job or a request payload.
 const connectionString=secret('SMA_GALLERY_PG_URL',environment);
 let dbUrl;try{dbUrl=new URL(connectionString);}catch{throw Error('PRIVATE_PG_URL_INVALID');}
 assert(['postgres:','postgresql:'].includes(dbUrl.protocol)&&
  Boolean(dbUrl.hostname)&&Boolean(dbUrl.username)&&Boolean(dbUrl.password),
  'PRIVATE_PG_URL_INVALID');
 assert(!['sslmode','sslcert','sslkey','sslrootcert'].some(k=>dbUrl.searchParams.has(k)),
  'PRIVATE_PG_SSL_PARAMETERS_NOT_ALLOWED');
 const supabaseUrl=secret('SMA_GALLERY_SUPABASE_URL',environment);
 const storageKey=secret('SMA_GALLERY_STORAGE_SERVICE_KEY',environment);
 const directToken=environment.SMA_GALLERY_GOOGLE_ACCESS_TOKEN;
 let getDriveAccessToken;
 if(directToken){
  assert(directToken.length>=12,'GOOGLE_ACCESS_TOKEN_INVALID');
  getDriveAccessToken=async()=>directToken;
 }else{
  getDriveAccessToken=createGoogleDriveRefreshProvider({
   clientId:secret('SMA_GALLERY_GOOGLE_CLIENT_ID',environment),
   clientSecret:secret('SMA_GALLERY_GOOGLE_CLIENT_SECRET',environment),
   refreshToken:secret('SMA_GALLERY_GOOGLE_REFRESH_TOKEN',environment)
  });
 }
 const pg=requirePg('pg');
 const config={connectionString,connectionTimeoutMillis:10000,query_timeout:15000,
  application_name:'sma_gallery_private_readonly',
  ssl:{rejectUnauthorized:true}};
 if(environment.SMA_GALLERY_PG_CA_FILE){
  config.ssl.ca=readFileSync(environment.SMA_GALLERY_PG_CA_FILE);
 }
 const db=new pg.Client(config);
 try{
  await db.connect();
  // Each statement sees current committed data, including the late recheck;
  // unlike REPEATABLE READ, this doesn't hide revision changes during FFmpeg.
  await db.query('SET default_transaction_read_only = on');
  const result=await runGalleryPrivateServerReadOnly({
   galleryJobId:argv[0],db,supabaseUrl,
   getDriveAccessToken,getStorageAccessToken:async()=>storageKey
  });
  return {
   ok:result.ok,state:result.state,
   registration_attempted:false,can_upload:false,can_publish:false,
   receipt_bytes_verified:result.candidate?.receipt_bytes_verified===true,
   packet_identity_verified:result.candidate?.packet_identity_verified===true,
   soundtrack_non_silent:result.candidate?.volume?.non_silent===true
  };
 }finally{
  try{await db.end();}catch{/* avoid logging private connection details */}
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 runPrivateGalleryCLI().then(x=>{process.stdout.write(JSON.stringify(x)+'\n');})
 .catch(()=>{process.stderr.write('SMA_GALLERY_READONLY_CHECK_FAILED\n');process.exitCode=1;});
}
