'use strict';
// One journalled request at a time. Never re-init/retry inside HTTP handling.
const transportCrypto=require('crypto');
const {providerUploadPlan}=require('./provider-upload-plan.cjs');
const {providerContext,youtubeResult,tiktokResult,youtubeTransfer,tiktokTransfer}=require('./provider-results.cjs');
function providerSession(platform,raw){
 if(typeof raw!=='string'||raw.length>4000||/[\s\\#]/.test(raw))throw Error('PROVIDER_SESSION_INVALID');
 let u;try{u=new URL(raw);}catch{throw Error('PROVIDER_SESSION_INVALID');}
 const keys=[...u.searchParams.keys()];
 if(u.protocol!=='https:'||u.username||u.password||u.port||new Set(keys).size!==keys.length)throw Error('PROVIDER_SESSION_INVALID');
 if(platform==='youtube'){
  if(u.hostname!=='www.googleapis.com'||u.pathname!=='/upload/youtube/v3/videos'||u.searchParams.get('uploadType')!=='resumable'||!u.searchParams.get('upload_id')||keys.some(k=>!['part','uploadType','upload_id','alt'].includes(k)))throw Error('PROVIDER_SESSION_INVALID');
 }else if(platform==='tiktok'){
  if(!['open-upload.tiktokapis.com','upload.us.tiktokapis.com'].includes(u.hostname)||!['/video/','/upload/'].includes(u.pathname)||!u.searchParams.get('upload_id')||!u.searchParams.get('upload_token')||keys.some(k=>!['upload_id','upload_token'].includes(k)))throw Error('PROVIDER_SESSION_INVALID');
 }else throw Error('PROVIDER_SESSION_INVALID');
 return raw;
}
function providerHttp(raw){
 if(!raw||!Number.isInteger(raw.statusCode))return {statusCode:0,body:{},headers:{}};
 let b=raw.body;
 if(typeof b==='string'){
  if(b.length>65536)throw Error('PROVIDER_RESPONSE_INVALID');
  // Preserve int64 IDs before JSON.parse can round them. Strings are untouched.
  const safe=b.replace(/"(?:\\.|[^"\\])*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,(all,num)=>num&&/^-?\d+$/.test(num)&&!Number.isSafeInteger(Number(num))?JSON.stringify(num):all);
  try{b=safe.trim()?JSON.parse(safe):{};}catch{b={};}
 }
 return {statusCode:raw.statusCode,body:b,headers:raw.headers||{}};
}
function providerBytes(bytes,c){
 if(!Buffer.isBuffer(bytes)||bytes.length!==c.size_bytes||bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp'||!/^sha256:[a-f0-9]{64}:\d+$/.test(c.binding?.asset_revision||'')||transportCrypto.createHash('sha256').update(bytes).digest('hex')!==c.binding.asset_revision.split(':')[1])throw Error('FILE_CHANGED');
 return bytes;
}
function providerRequest(i,token,now=Date.now()){
 if(i?.ok!==true||!/^[a-f0-9-]{36}$/.test(i.lease_id||'')||!Number.isInteger(i.sequence)||i.sequence<1||!['init','upload','probe','status'].includes(i.operation)||!['youtube','tiktok'].includes(i.platform)||!Number.isSafeInteger(i.size_bytes)||i.size_bytes<1||i.size_bytes>24000000||typeof token!=='string'||token.length<10||/[\r\n]/.test(token))throw Error('PROVIDER_INTENT_REQUIRED');
 const p=i.platform,auth={Authorization:'Bearer '+token},json={'Content-Type':'application/json; charset=UTF-8'};
 if(i.operation==='init'){
  const b=i.binding,d=i.draft;
  if(b?.platform!==p||typeof d?.title!=='string'||typeof d?.caption!=='string')throw Error('SAVED_TEXT_INVALID');
  // Reuse the exact saved-text/choice validator; the preview's blockers are not
  // used as authorization. The database has already issued this request lease.
  const prepared={ok:true,stage:'publisher_preparation',binding:b,draft:d,can_upload:false,can_publish:false,blockers:['PROVIDER_DISPATCH_DISABLED'],adapter_fields:p==='youtube'?{snippet:{title:d.title,description:d.caption}}:{post_info:{title:d.caption}}};
  const plan=providerUploadPlan(prepared,i.choices,{asset_revision:b.asset_revision,size_bytes:i.size_bytes,mime_type:'video/mp4'}).request;
  return {...plan,headers:{...json,...plan.headers,...auth},body_type:'json'};
 }
 if(i.operation==='status'){
  const c={...i,route:p==='youtube'?'youtube_video':'direct_post'};providerContext(c);
  return p==='youtube'?{method:'GET',url:'https://www.googleapis.com/youtube/v3/videos?part=snippet,status,processingDetails&id='+encodeURIComponent(i.provider_id),headers:auth,body_type:'none'}:{method:'POST',url:'https://open.tiktokapis.com/v2/post/publish/status/fetch/',headers:{...auth,...json},body:{publish_id:i.provider_id},body_type:'json'};
 }
 const url=providerSession(p,i.session_url);
 if(!Number.isFinite(Date.parse(i.session_expires_at))||Date.parse(i.session_expires_at)<=now)throw Error('PROVIDER_SESSION_EXPIRED');
 if(i.operation==='probe'){
  if(p!=='youtube')throw Error('PROVIDER_INTENT_REQUIRED');
  return {method:'PUT',url,headers:{...auth,'Content-Length':'0','Content-Range':'bytes */'+i.size_bytes},body_type:'none'};
 }
 const start=i.received_bytes;
 if(!Number.isSafeInteger(start)||start<0||start>=i.size_bytes||p==='tiktok'&&start!==0)throw Error('PROVIDER_RECONCILIATION_REQUIRED');
 return {method:'PUT',url,headers:{...(p==='youtube'?auth:{}),'Content-Type':'video/mp4','Content-Length':String(i.size_bytes-start),'Content-Range':`bytes ${start}-${i.size_bytes-1}/${i.size_bytes}`},body_type:'binary',offset:start};
}
function providerObservation(raw,i,now=Date.now()){
 const h=providerHttp(raw),p=i.platform;
 if(i.operation==='init'){
  if(h.statusCode!==200||(p==='tiktok'&&h.body?.error?.code!=='ok'))return {state:'uncertain',code:'PROVIDER_INIT_UNCERTAIN'};
  const session=p==='youtube'?(h.headers.location||h.headers.Location):h.body?.data?.upload_url;
  const pid=p==='tiktok'?h.body?.data?.publish_id:null;
  if(p==='tiktok'&&!(typeof pid==='string'&&/^[A-Za-z0-9_.~:-]{1,64}$/.test(pid)))return {state:'uncertain',code:'PROVIDER_INIT_UNCERTAIN'};
  try{providerSession(p,session);}catch{return {state:'uncertain',code:'PROVIDER_SESSION_INVALID',...(pid?{provider_id:pid}:{})};}
  // TikTok validity is one hour. YouTube has no guaranteed fixed lifetime:
  // conservative local deadline, and an expired server session never re-inits.
  return {state:'session_ready',session_url:session,session_expires_at:new Date(now+(p==='tiktok'?55:60)*60000).toISOString(),...(pid?{provider_id:pid}:{})};
 }
 if(i.operation==='status'){
  const c={...i,route:p==='youtube'?'youtube_video':'direct_post'};
  const r=p==='youtube'?youtubeResult(h,c):tiktokResult(h,c);
  if(r.state==='unknown')return {state:'uncertain',code:r.code};
  return {state:r.state,observation:r};
 }
 const r=p==='youtube'?youtubeTransfer(h,i.size_bytes):tiktokTransfer(h,i.size_bytes);
 if(r.state==='unknown')return {state:'uncertain',code:r.code};
 return {state:r.state,...(r.provider_id?{provider_id:r.provider_id}:{}),...(Number.isSafeInteger(r.received_bytes)?{received_bytes:r.received_bytes}:{})};
}
module.exports={providerSession,providerHttp,providerBytes,providerRequest,providerObservation};
