const {test}=require('node:test'),assert=require('node:assert/strict');
const moduleReady=import('../app/assets/media-metadata.mjs');
const owner='fixture-owner',session={user:{id:owner},access_token:'fixture-token'},ok=()=>({ok:true,json:async()=>({ok:true})});
test('video metadata distinguishes missing values from complete but unsupported video lengths',async()=>{const {missingVideoMetadata,videoMetadataNotice}=await moduleReady;assert.deepEqual(missingVideoMetadata({media_kind:'image'}),[]);assert.deepEqual(missingVideoMetadata({media_kind:'video'}),['Videolänge','Bildgröße']);assert.deepEqual(missingVideoMetadata({media_kind:'video',duration_ms:100000,width_px:320,height_px:240}),[]);assert.match(videoMetadataNotice({media_kind:'video',duration_ms:1000}),/Bildgröße/);assert.equal(videoMetadataNotice(null),'');});
test('catalog refresh uses only existing owner-scoped endpoint and verifies owner on return',async()=>{const {refreshMediaCatalog}=await moduleReady;let checks=0,calls=[];await refreshMediaCatalog({owner,getSession:async()=>{checks++;return session;},request:async(...args)=>{calls.push(args);return ok();}});assert.equal(checks,2);assert.equal(calls.length,1);assert.equal(calls[0][0],'https://johnmusic.app.n8n.cloud/webhook/sma-publication-files-v1');assert.equal(calls[0][1].method,'POST');assert.equal(calls[0][1].body,undefined);assert.equal(calls[0][1].redirect,'error');assert.equal(calls[0][1].credentials,'omit');});
test('catalog refresh rejects missing or changing owner and abort during authentication before network',async()=>{const {refreshMediaCatalog}=await moduleReady;let requests=0;const request=async()=>{requests++;return ok();};await assert.rejects(refreshMediaCatalog({owner,getSession:async()=>null,request}),/AUTH_REQUIRED/);const controller=new AbortController();await assert.rejects(refreshMediaCatalog({owner,signal:controller.signal,getSession:async()=>{controller.abort();return session;},request}),{name:'AbortError'});assert.equal(requests,0);let count=0;await assert.rejects(refreshMediaCatalog({owner,getSession:async()=>++count===1?session:{...session,user:{id:'other'}},request}),/AUTH_REQUIRED/);assert.equal(requests,1);});
test('catalog refresh exposes known retry guidance and masks arbitrary upstream error details',async()=>{const {refreshMediaCatalog}=await moduleReady;for(const [code,expected] of [['FILE_SYNC_RUNNING','FILE_SYNC_RUNNING'],['FILE_SYNC_RATE_LIMITED','FILE_SYNC_RATE_LIMITED'],['sensitive backend detail','FILE_SYNC_UNAVAILABLE']])await assert.rejects(refreshMediaCatalog({owner,getSession:async()=>session,request:async()=>({ok:false,json:async()=>({ok:false,code})})}),new RegExp('^Error: '+expected+'$'));});


test('fresh metadata-only Drive version rebinds an empty unsaved video without changing content',async()=>{
 const {canAdoptVerifiedVideoRevision}=await moduleReady;
 const now=Date.parse('2026-11-10T12:10:00Z');
 const old={id:'59142d3e-0410-49de-bb70-cd667fa8919d',name:'SMA_STUMMER_GALERIE_TEST_10S.mp4',
  media_kind:'video',mime_type:'video/mp4',size_bytes:1951847,revision:'sha256:'+'a'.repeat(64)+':8',
  assignments:[],verified_at:'2026-11-10T12:01:00Z'};
 const fresh={...old,revision:'sha256:'+'a'.repeat(64)+':9',
  duration_ms:9999,width_px:720,height_px:1280,verified_at:'2026-11-10T12:08:00Z'};
 assert.equal(canAdoptVerifiedVideoRevision(old,fresh,'youtube',now),true);
 for(const patch of [
  {id:'another-file'},{revision:old.revision},{revision:'sha256:'+'b'.repeat(64)+':9'},
  {size_bytes:1951848},{name:'Other.mp4'},{mime_type:'video/quicktime'},
  {width_px:null},{duration_ms:null},{assignments:[{platform:'youtube',status:'changed'}]},
  {verified_at:'2026-11-10T11:50:00Z'},{verified_at:'invalid'}
 ])assert.equal(canAdoptVerifiedVideoRevision(old,{...fresh,...patch},'youtube',now),false,JSON.stringify(patch));
 for(const patch of [
  {assignments:[{platform:'youtube',status:'assigned'}]},
  {size_bytes:1951848},{revision:'sha256:'+'b'.repeat(64)+':8'},
  {media_kind:'image'}
 ])assert.equal(canAdoptVerifiedVideoRevision({...old,...patch},fresh,'youtube',now),false,JSON.stringify(patch));
 assert.equal(canAdoptVerifiedVideoRevision(old,fresh,'invalid',now),false);
 assert.equal(canAdoptVerifiedVideoRevision(null,fresh,'youtube',now),false);
 assert.equal(canAdoptVerifiedVideoRevision(old,null,'youtube',now),false);
});

test('rebind runs only in explicit video-metadata refresh with no draft, edits, or assignment',()=>{
 const fs=require('node:fs');
 const source=fs.readFileSync('app/assets/publication-preview.js','utf8');
 const segment=source.slice(source.indexOf('async function recoverMetadataOnlyVideoRevision('),source.indexOf("$('refreshVideoMetadata').addEventListener"));
 assert.match(segment,/assignmentRevision!==0\|\|current\|\|attempt\|\|tabRecord/);
 assert.match(segment,/hasDraftEdits\(\)\|\|hasSourceEdits\(\)/);
 assert.match(segment,/canAdoptVerifiedVideoRevision\(old,fresh,selectedPortal\)/);
 assert.match(segment,/if\(e.code==='FILE_CHANGED'\)/);
 assert.match(segment,/clearDraft\(\);renderSelectedFile\(\);renderFilePicker\(\)/);
 assert.doesNotMatch(segment,/generatePreview\(|client\.approve\(|runMagicAction\(|fetch\(uploadEndpoint/);
 assert.match(fs.readFileSync('app/publication-preview.html','utf8'),/publication-preview\.js\?v=95/);
 assert.match(fs.readFileSync('app/dashboard.html','utf8'),/url\.searchParams\.set\('v','45'\)/);
});
