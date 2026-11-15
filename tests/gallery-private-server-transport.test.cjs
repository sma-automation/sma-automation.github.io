const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {Readable}=require('node:stream');
const fixture=require('../n8n/publishing/fixtures/gallery-music-probe.json');
const {soundtrackMP4}=require('../n8n/publishing/gallery-soundtrack.cjs');
const {Response}=globalThis;
const transportPromise=import('../n8n/publishing/gallery-private-server-transport.mjs');
const tokenPromise=import('../n8n/publishing/gallery-private-google-refresh.mjs');
const original=Buffer.from(fixture.video,'base64');
const audio=Buffer.from(fixture.audio,'base64');
const observed=soundtrackMP4(original,audio).bytes;
const sha=b=>createHash('sha256').update(b).digest('hex');
const job='11111111-2222-4333-8444-555555555555';
const sid='syntheticDriveOriginal2026',rid='syntheticDriveResult2026';
const trackSha='c'.repeat(64), audioSha=sha(audio);
const objectName='render/'+trackSha+'/'+audioSha+'.aac';
const snap=()=>({
 gallery_job_id:job,state:'completed',customer_id:13,
 user_id:'22222222-3333-4333-8333-444444444444',customer_active:true,
 track_sha:trackSha,audio_sha256:audioSha,source_key:'sha256:'+sha(original),
 expected_sha:sha(observed),expected_size:observed.length,
 audio_object_name:objectName,audio_size_bytes:audio.length,
 source:{asset_id:'11111111-aaaa-4333-8444-555555555555',
  drive_file_id:sid,revision:'sha256:'+sha(original)+':10',
  size_bytes:original.length,available:true,mime_type:'video/mp4',media_kind:'video'},
 result:{asset_id:'22222222-bbbb-4333-8444-555555555555',
  drive_file_id:rid,revision:'sha256:'+sha(observed)+':11',
  size_bytes:observed.length,available:true,mime_type:'video/mp4',media_kind:'video'}
});
function mock({snapshot=()=>snap(),override=null}={}){
 let dbCalls=0,fetchCalls=[],driveTokens=0,storageTokens=0,queries=[];
 const db={query:async(sql,params)=>{dbCalls++;queries.push([sql,params]);return {rows:[{snapshot:snapshot(dbCalls)}]};}};
 const fetchImpl=async(url,init)=>{
  fetchCalls.push({url,init});
  if(override)return override(url,init);
  if(url.startsWith('https://www.googleapis.com/drive/v3/files/'+sid+'?'))
   return new Response(original,{status:200,headers:{'content-length':String(original.length)}});
  if(url.startsWith('https://www.googleapis.com/drive/v3/files/'+rid+'?'))
   return new Response(observed,{status:200,headers:{'content-length':String(observed.length)}});
  if(url==='https://bnvnmdxosbnuzedokqgh.supabase.co/storage/v1/object/authenticated/sma-katalog/'+objectName)
   return new Response(audio,{status:200,headers:{'content-length':String(audio.length)}});
  throw Error('UNEXPECTED_TEST_URL');
 };
 const auth={
  getDriveAccessToken:async()=>{driveTokens++;return 'syntheticDriveToken2026';},
  getStorageAccessToken:async()=>{storageTokens++;return 'syntheticStorageToken2026';}
 };
 return {
  db,fetchImpl,...auth,
  supabaseUrl:'https://bnvnmdxosbnuzedokqgh.supabase.co',
  get calls(){return {db:dbCalls,requests:fetchCalls,driveTokens,storageTokens,queries};}
 };
}
function hasMedia(t){
 const ok=spawnSync('ffmpeg',['-version'],{encoding:'utf8'}).status===0&&
  spawnSync('ffprobe',['-version'],{encoding:'utf8'}).status===0;
 if(!ok){assert.notEqual(process.env.SMA_REQUIRE_FFMPEG,'1','CI MUST have media tools');t.skip('No media binaries');}
 return ok;
}
test('real existing worker uses DB-only file identifiers; exactly two Drive GET and one private AAC GET',async t=>{
 if(!hasMedia(t))return;
 const {runGalleryPrivateServerReadOnly}=await transportPromise;
 const opts=mock();
 const result=await runGalleryPrivateServerReadOnly({galleryJobId:job,...opts,
  registerEvidence:()=>{throw Error('REGISTRATION_MUST_NEVER_BE_CALLED')},
  enableRegistration:true});
 assert.equal(result.ok,true);
 assert.equal(result.state,'verified_not_registered');
 assert.equal(result.registration_attempted,false);
 assert.equal(result.can_publish,false);
 assert.equal(result.can_upload,false);
 assert.equal(result.candidate.receipt_bytes_verified,true);
 assert.equal(result.candidate.packet_identity_verified,true);
 assert.equal(result.candidate.volume.non_silent,true);
 assert.equal(opts.calls.db,2,'fresh trusted DB snapshot before and after decoding');
 assert.deepEqual(opts.calls.queries.map(x=>x[0]),[
  'select sma_private.gallery_worker_snapshot_v1($1::uuid) as snapshot',
  'select sma_private.gallery_worker_snapshot_v1($1::uuid) as snapshot']);
 assert(opts.calls.queries.every(x=>x[1].length===1&&x[1][0]===job));
 assert.equal(opts.calls.requests.length,3);
 assert.equal(opts.calls.driveTokens,2);
 assert.equal(opts.calls.storageTokens,1);
 assert.equal(opts.calls.requests.filter(x=>x.url.includes('supabase.co')).length,1);
 assert(opts.calls.requests.every(x=>x.init.redirect==='error'&&
  x.init.method==='GET'&&x.init.cache==='no-store'));
 assert(opts.calls.requests.every(x=>x.url.startsWith('https://www.googleapis.com/drive/v3/files/')
   ||x.url.startsWith('https://bnvnmdxosbnuzedokqgh.supabase.co/storage/v1/object/authenticated/sma-katalog/')));
 const headers=opts.calls.requests.map(x=>x.init.headers.authorization);
 assert.deepEqual(headers,[
  'Bearer syntheticDriveToken2026','Bearer syntheticDriveToken2026',
  'Bearer syntheticStorageToken2026']);
});
test('invalid Supabase origin, foreign IDs and attacker URLs are refused before HTTP',async()=>{
 const {createGalleryPrivateServerTransport}=await transportPromise;
 const x=mock();
 for(const bad of [
  'https://bnvnmdxosbnuzedokqgh.supabase.co.attacker.com',
  'http://bnvnmdxosbnuzedokqgh.supabase.co',
  'https://bnvnmdxosbnuzedokqgh.supabase.co:4444',
  'https://user:pass@bnvnmdxosbnuzedokqgh.supabase.co',
  'https://bnvnmdxosbnuzedokqgh.supabase.co/admin',
  'https://bnvnmdxosbnuzedokqgh.supabase.co?evil=1'
 ]){
  assert.throws(()=>createGalleryPrivateServerTransport({...x,supabaseUrl:bad}),
    /SUPABASE_ORIGIN_INVALID/);
 }
 const a=createGalleryPrivateServerTransport(x);
 await assert.rejects(()=>a.readDriveFile(sid),/SNAPSHOT_REQUIRED/);
 await assert.rejects(()=>a.getSnapshot('not-a-uuid'),/INVALID_JOB_ID/);
 await a.getSnapshot(job);
 await assert.rejects(()=>a.readDriveFile('https://external.com/file'),/DRIVE_FILE_NOT_IN_TRUSTED_JOB/);
 await assert.rejects(()=>a.readDriveFile('foreignDriveId'),/DRIVE_FILE_NOT_IN_TRUSTED_JOB/);
 await assert.rejects(()=>a.readTrackAudio('a'.repeat(64)),/TRACK_NOT_IN_TRUSTED_JOB/);
 assert.equal(x.calls.requests.length,0);
});
test('HTTP denial, redirect, partial content and network error all fail closed',async()=>{
 const {createGalleryPrivateServerTransport}=await transportPromise;
 for(const [response,pattern] of [
  [()=>new Response('denied',{status:401}),/DRIVE_DOWNLOAD_DENIED/],
  [()=>new Response('partial',{status:206}),/DRIVE_DOWNLOAD_DENIED/],
  [()=>new Response(null,{status:302,headers:{location:'https://evil.example/'}}),/DRIVE_DOWNLOAD_DENIED/],
  [()=>{throw Error('SECRET_ERROR_INTERNAL');},/DRIVE_NETWORK_FAILED/]
 ]){
  const x=mock({override:response});const a=createGalleryPrivateServerTransport(x);
  await a.getSnapshot(job);
  await assert.rejects(()=>a.readDriveFile(sid),pattern);
 }
});
test('prematurely oversized, truncated, corrupt and unexpected response lengths fail before candidate generation',async()=>{
 const {createGalleryPrivateServerTransport}=await transportPromise;
 const cases=[
  [()=>new Response('x',{status:200,headers:{'content-length':String(original.length+1)}}),/DOWNLOAD_LENGTH_EXCEEDS_LIMIT/],
  [()=>new Response('short',{status:200}),/DOWNLOAD_TRUNCATED/],
  [()=>new Response(Buffer.alloc(original.length,0),{status:200}),/BYTE_SHA_MISMATCH|DOWNLOAD_/],
  [()=>new Response(Buffer.alloc(original.length+1,0),{status:200}),/DOWNLOAD_TOO_LARGE/]
 ];
 for(const [response,pattern] of cases){
  const x=mock({override:response}),a=createGalleryPrivateServerTransport(x);
  await a.getSnapshot(job);
  if(pattern.source.includes('BYTE_SHA')) {
   const bytes=await a.readDriveFile(sid);assert.notEqual(sha(bytes),sha(original));
  }else await assert.rejects(()=>a.readDriveFile(sid),pattern);
 }
});
test('stale database revisions and changed audio sidecar are rejected with no HTTP writes',async t=>{
 if(!hasMedia(t))return;
 const {runGalleryPrivateServerReadOnly}=await transportPromise;
 for(const different of [
  {...snap(),result:{...snap().result,revision:'sha256:'+sha(observed)+':12'}},
  {...snap(),customer_active:false},
  {...snap(),audio_object_name:'render/'+trackSha+'/'+'e'.repeat(64)+'.aac'}
 ]){
  const x=mock({snapshot:n=>n===1?snap():different});
  await assert.rejects(()=>runGalleryPrivateServerReadOnly({galleryJobId:job,...x}),
    /SNAPSHOT_CHANGED_BEFORE_REGISTRATION|CUSTOMER_INACTIVE|AUDIO_OBJECT_PATH_MISMATCH/);
  assert.equal(x.calls.requests.length,3);
 }
});
test('rotating existing Google OAuth refresh token returns only access token and caches it',async()=>{
 const {createGoogleDriveRefreshProvider}=await tokenPromise;
 let ms=1000,hit=0;
 const p=createGoogleDriveRefreshProvider({
  clientId:'synthetic-client-id.apps.googleusercontent.com',clientSecret:'synthetic-secret',
  refreshToken:'synthetic-refresh',now:()=>ms,
  fetchImpl:async(url,init)=>{
   hit++;
   assert.equal(url,'https://oauth2.googleapis.com/token');
   assert.equal(init.method,'POST');
   assert.equal(init.redirect,'error');
   assert.equal(new URLSearchParams(init.body).get('grant_type'),'refresh_token');
   assert.equal(new URLSearchParams(init.body).get('refresh_token'),'synthetic-refresh');
   return new Response(JSON.stringify({token_type:'Bearer',access_token:'syntheticAccessTokenNew',expires_in:3600}),{status:200});
  }
 });
 const [a,b]=await Promise.all([p(),p()]);
 assert.equal(a,'syntheticAccessTokenNew');assert.equal(b,a);assert.equal(hit,1);
 ms+=100000;assert.equal(await p(),a);assert.equal(hit,1);
 ms+=3550000;assert.equal(await p(),a);assert.equal(hit,2);
});
test('Google OAuth refuses rejected, malformed and oversized refresh responses',async()=>{
 const {createGoogleDriveRefreshProvider}=await tokenPromise;
 for(const [response,pattern] of [
  [()=>new Response('denied',{status:400}),/GOOGLE_TOKEN_REFRESH_DENIED/],
  [()=>new Response('broken json',{status:200}),/GOOGLE_TOKEN_RESPONSE_INVALID/],
  [()=>new Response(JSON.stringify({token_type:'Bearer',access_token:'bad',expires_in:3600}),{status:200}),/GOOGLE_TOKEN_RESPONSE_INVALID/],
  [()=>new Response('z'.repeat(17000),{status:200}),/GOOGLE_TOKEN_RESPONSE_TOO_LARGE/]
 ]){
  const p=createGoogleDriveRefreshProvider({clientId:'synthetic-client-id',clientSecret:'synthetic-secret',
   refreshToken:'synthetic-refresh',fetchImpl:response});
  await assert.rejects(p(),pattern);
 }
});
test('code never opens a listener, posts to provider, writes to Supabase or exposes credentials',async()=>{
 const {readFileSync}=require('node:fs');
 const s=readFileSync('n8n/publishing/gallery-private-server-transport.mjs','utf8');
 const x=readFileSync('n8n/publishing/gallery-private-google-refresh.mjs','utf8');
 assert.doesNotMatch(s,/createServer\(|app\.listen\(|http\.listen\(/);
 assert.doesNotMatch(s,/insert into|update sma_private|delete from|registerEvidence\(/i);
 assert.doesNotMatch(s,/createSignedUrl|object\/public|https?:\/\/.*\$\{.*(token|secret)/i);
 assert.doesNotMatch(x,/console\.log|console\.error/);
});
