const test=require('node:test');
const assert=require('node:assert/strict');
const {createPublicKey,verify}=require('node:crypto');
const moduleReady=import('../supabase/functions/_shared/wordpress-bridge.mjs');
const keysReady=moduleReady.then(m=>m.createBridgeKeys());
const attemptId='a1000000-0000-4000-8000-000000000101',requestId='b1000000-0000-4000-8000-000000000101';
const context={attemptId,websiteUrl:'https://example.com/',shopSlug:'sma-testkunde',action:'inspect'};
const result={ok:true,attempt_id:attemptId,website_url:context.websiteUrl,shop_slug:context.shopSlug,revision:0,post_id:null,can_read:true,can_sync_draft:true,can_publish:false};
test('bridge signs the exact body and endpoint using a server-only RSA key',async()=>{
 const {signBridgeCommand}=await moduleReady,keys=await keysReady;
 const signed=await signBridgeCommand({...keys,attemptId,requestId,action:'sync_draft',expectedRevision:0,issuedAt:100});
 const signature=Buffer.from(signed.headers['X-SMA-Signature'],'base64');
 const prefix='SMA-BRIDGE-V1\nPOST\n/sma-bridge/v1/command\n';
 assert(verify('RSA-SHA256',Buffer.from(prefix+signed.body),createPublicKey(keys.publicKey),signature));
 assert(!verify('RSA-SHA256',Buffer.from(prefix+signed.body.replace('sync_draft','publish')),createPublicKey(keys.publicKey),signature));
 assert(!verify('RSA-SHA256',Buffer.from(signed.body),createPublicKey(keys.publicKey),signature));
 assert(!JSON.stringify(signed).includes('PRIVATE KEY'));
});
test('bridge refuses publishing, bad revisions and malformed operation IDs before signing',async()=>{
 const {signBridgeCommand}=await moduleReady,keys=await keysReady;
 for(const patch of [{action:'publish'},{attemptId:'other'},{requestId:'other'},{action:'sync_draft'},{expectedRevision:0},{issuedAt:NaN},{issuedAt:-1}])
  await assert.rejects(signBridgeCommand({...keys,attemptId,requestId,action:'inspect',...patch}),/INVALID_BRIDGE_DATA/);
});
test('bridge key import errors are sanitized',async()=>{
 const {signBridgeCommand}=await moduleReady;
 await assert.rejects(signBridgeCommand({privateKey:'SECRET_MUST_NOT_LEAK',attemptId,requestId,action:'inspect'}),{message:'INVALID_BRIDGE_DATA'});
});
test('bridge result is tied to the selected site, account shop and attempt',async()=>{
 const {readBridgeResult}=await moduleReady;
 assert.equal(readBridgeResult(result,context).postId,null);
 for(const patch of [{attempt_id:requestId},{website_url:'https://other.example/'},{shop_slug:'other-shop'},{can_publish:true},{can_read:false},{credentials:'private'}, {post_id:1}])
  assert.throws(()=>readBridgeResult({...result,...patch},context),/INVALID_BRIDGE_DATA/);
});
test('bridge accepts only the exact completed draft revision, including a repeated reply',async()=>{
 const {readBridgeResult}=await moduleReady;
 const ctx={...context,action:'sync_draft',expectedRevision:2};
 const r={...result,revision:3,post_id:45,state:'draft'};
 assert.deepEqual(readBridgeResult(r,ctx),readBridgeResult(r,ctx));
 for(const patch of [{revision:2},{revision:4},{post_id:null},{state:'publish'},{can_sync_draft:false}])assert.throws(()=>readBridgeResult({...r,...patch},ctx),/INVALID_BRIDGE_DATA/);
});
