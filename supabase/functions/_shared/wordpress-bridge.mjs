// Server-only signing protocol. A private key never travels to WordPress.
// Network transport, ticket issuance and Vault lifecycle are separate; this
// module deliberately cannot fetch arbitrary customer URLs.
const prefix='SMA-BRIDGE-V1\nPOST\n/sma-bridge/v1/command\n';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const integer=n=>Number.isSafeInteger(n)&&n>=0&&n<2147483647;
const fail=()=>{throw Error('INVALID_BRIDGE_DATA');};
const bytesToBase64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const pem=(label,bytes)=>`-----BEGIN ${label}-----\n${bytesToBase64(bytes).match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
export async function createBridgeKeys(){
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:3072,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 return {publicKey:pem('PUBLIC KEY',await crypto.subtle.exportKey('spki',keys.publicKey)),privateKey:pem('PRIVATE KEY',await crypto.subtle.exportKey('pkcs8',keys.privateKey))};
}
export async function signBridgeCommand({privateKey,attemptId,requestId,action,expectedRevision,issuedAt=Math.floor(Date.now()/1000)}){
 if(!uuid.test(attemptId)||!uuid.test(requestId)||!['inspect','sync_draft'].includes(action)||!Number.isSafeInteger(issuedAt)||issuedAt<0
  ||(action==='sync_draft'?!integer(expectedRevision):expectedRevision!==undefined))fail();
 const p={action,attempt_id:attemptId,request_id:requestId,issued_at:issuedAt,...(action==='sync_draft'?{expected_revision:expectedRevision}:{})};
 const body=JSON.stringify(p);
 if(typeof privateKey!=='string'||privateKey.length>8192||!/^-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+-----END PRIVATE KEY-----\n?$/.test(privateKey))fail();
 try{
  const data=Uint8Array.from(atob(privateKey.replace(/-----[^-]+-----/g,'').replace(/\s/g,'')),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('pkcs8',data,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  if(key.algorithm.modulusLength<2048||key.algorithm.modulusLength>4096)fail();
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(prefix+body));
  return {body,headers:{'Content-Type':'application/json','X-SMA-Signature':bytesToBase64(signature)}};
 }catch{fail();}
}
export function readBridgeResult(value,{attemptId,websiteUrl,shopSlug,action,expectedRevision}){
 const keys=['ok','attempt_id','website_url','shop_slug','revision','post_id','can_read','can_sync_draft','can_publish',...(action==='sync_draft'?['state']:[])].sort();
 if(!['inspect','sync_draft'].includes(action)||!value||Object.keys(value).sort().join('|')!==keys.join('|')
  ||value.ok!==true||value.attempt_id!==attemptId||value.website_url!==websiteUrl||value.shop_slug!==shopSlug
  ||!Number.isSafeInteger(value.revision)||value.revision<0||value.revision>2147483647||value.can_read!==true||value.can_sync_draft!==true||value.can_publish!==false
  ||(value.revision===0?value.post_id!==null:!Number.isSafeInteger(value.post_id)||value.post_id<=0)
  ||(action==='sync_draft'&&(!integer(expectedRevision)||value.revision!==expectedRevision+1||value.state!=='draft')))fail();
 return {attemptId,websiteUrl,shopSlug,revision:value.revision,postId:value.post_id,canRead:true,canSyncDraft:true,canPublish:false};
}
