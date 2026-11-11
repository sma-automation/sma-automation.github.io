const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const loaded=import('../n8n/publishing/gallery-private-server-readiness.mjs');
const project='bnvnmdxosbnuzedokqgh';
const url='https://'+project+'.supabase.co';
const goodPG='postgresql://sma_gallery_worker_login:syntheticStrongPasswordOnly@db.'+project+'.supabase.co:5432/postgres';
const env=()=>({
 SMA_GALLERY_ALLOW_READONLY:'1',
 SMA_GALLERY_PG_URL:goodPG,
 SMA_GALLERY_SUPABASE_URL:url,
 SMA_GALLERY_STORAGE_SERVICE_KEY:'syntheticStorageSecretOnly',
 SMA_GALLERY_GOOGLE_ACCESS_TOKEN:'syntheticDriveAccessToken',
});
const fakeSpawn=()=>({status:0});
const ready=async(x)=>{const {assessGalleryServerReadiness}=await loaded;
 return assessGalleryServerReadiness({environment:x||env(),nodeVersion:'22.13.0',
  spawn:fakeSpawn,pgInstalled:true,caChecker:()=>true});
};
test('offline preflight reports booleans only and never claims a live connection',async()=>{
 const x=await ready();
 assert.equal(x.configuration_complete,true);
 assert.equal(x.mode,'offline_no_network');
 assert.equal(x.server_connection_verified,false);
 assert.equal(x.worker_executed,false);
 assert.equal(x.registration_attempted,false);
 assert.equal(x.can_publish,false);
 assert(x.checks.every(v=>v.ok));
 const out=JSON.stringify(x);
 assert.doesNotMatch(out,/syntheticStrongPasswordOnly|syntheticStorageSecretOnly|syntheticDriveAccessToken|bnvnmdxosbnuzedokqgh/i);
});
test('only dedicated DB identity on matching Supabase project or pooler is accepted',async()=>{
 const {checkGalleryPgTarget}=await loaded;
 const pooler='postgresql://sma_gallery_worker_login.'+project+
  ':syntheticStrongPasswordOnly@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
 assert.equal(checkGalleryPgTarget(goodPG,url),true);
 assert.equal(checkGalleryPgTarget(pooler,url),true);
 for(const bad of [
  goodPG.replace('sma_gallery_worker_login','postgres'),
  goodPG.replace('db.'+project+'.supabase.co','evil.example'),
  goodPG.replace('db.'+project+'.supabase.co','db.otherproject00000000.supabase.co'),
  goodPG.replace('5432','8443'),
  goodPG.replace('postgresql://','http://'),
  goodPG+'?sslmode=disable',
  goodPG.replace('syntheticStrongPasswordOnly',''),
  pooler.replace('sma_gallery_worker_login.'+project,'postgres.'+project),
  pooler.replace('aws-0-eu-central-1.pooler.supabase.com','aws-0-eu-central-1.pooler.supabase.com.attacker.io')
 ])assert.equal(checkGalleryPgTarget(bad,url),false,bad.slice(0,30));
 for(const badUrl of ['http://'+project+'.supabase.co',
  'https://'+project+'.supabase.co.evil.com',
  'https://'+project+'.supabase.co/path',
  'https://'+project+'.supabase.co?mode=unsafe'])
  assert.equal(checkGalleryPgTarget(goodPG,badUrl),false);
});
test('missing secrets, disabled opt-in, stale runtimes and binaries fail closed',async()=>{
 const {assessGalleryServerReadiness}=await loaded;
 for(const [key,value] of [
  ['SMA_GALLERY_ALLOW_READONLY','0'],['SMA_GALLERY_PG_URL',undefined],
  ['SMA_GALLERY_STORAGE_SERVICE_KEY',undefined],
  ['SMA_GALLERY_GOOGLE_ACCESS_TOKEN',undefined],
  ['SMA_GALLERY_SUPABASE_URL',undefined]
 ]){const e=env();if(value===undefined)delete e[key];else e[key]=value;
  assert.equal((await ready(e)).configuration_complete,false,key);
 }
 const old=assessGalleryServerReadiness({environment:env(),nodeVersion:'20.9.0',
  spawn:fakeSpawn,pgInstalled:true,caChecker:()=>true});
 assert.equal(old.configuration_complete,false);
 const noMedia=assessGalleryServerReadiness({environment:env(),nodeVersion:'22.9.0',
  spawn:()=>({status:127}),pgInstalled:true,caChecker:()=>true});
 assert.equal(noMedia.configuration_complete,false);
 assert.equal(noMedia.checks.filter(x=>/ffmpeg|ffprobe/.test(x.id)).every(x=>!x.ok),true);
 const noPg=assessGalleryServerReadiness({environment:env(),nodeVersion:'22.9.0',
  spawn:fakeSpawn,pgInstalled:false,caChecker:()=>true});
 assert.equal(noPg.configuration_complete,false);
});
test('existing Google OAuth refresh triple is acceptable without a raw access token',async()=>{
 const e=env();delete e.SMA_GALLERY_GOOGLE_ACCESS_TOKEN;
 e.SMA_GALLERY_GOOGLE_CLIENT_ID='synthetic-existing-client-id';
 e.SMA_GALLERY_GOOGLE_CLIENT_SECRET='synthetic-existing-client-secret';
 e.SMA_GALLERY_GOOGLE_REFRESH_TOKEN='synthetic-existing-refresh-token';
 assert.equal((await ready(e)).configuration_complete,true);
 delete e.SMA_GALLERY_GOOGLE_REFRESH_TOKEN;
 assert.equal((await ready(e)).configuration_complete,false);
});
test('manual runner refuses wrong PG project/identity before connection',()=>{
 const code=readFileSync('n8n/publishing/gallery-private-server-runner.mjs','utf8');
 const guard=code.indexOf("assert(checkGalleryPgTarget(connectionString,supabaseUrl),'PRIVATE_PG_TARGET_OR_IDENTITY_INVALID')");
 const newClient=code.indexOf('const db=new pg.Client(config);');
 assert(guard>0&&newClient>guard);
 assert.doesNotMatch(code,/rejectUnauthorized:false/);
});
test('readiness script has no network or credential output path',()=>{
 const code=readFileSync('n8n/publishing/gallery-private-server-readiness.mjs','utf8');
 assert.doesNotMatch(code,/\bfetch\(|\bhttps\.request\(|createServer\(/);
 assert.doesNotMatch(code,/console\.(log|error)|JSON.stringify\(environment\)/);
 assert.match(code,/server_connection_verified:false,worker_executed:false/);
});
