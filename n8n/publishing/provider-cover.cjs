'use strict';
const {createHash:coverHash}=require('crypto');
const COVER_UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
// Pure adapters: constructing a request never executes it or grants permission.
function coverPlan(plan,binding){
 if(plan===null)return null;
 if(!plan||plan.version!==1||!COVER_UUID.test(plan.export_id||'')||plan.video_asset_id!==binding?.asset_id||plan.video_revision!==binding?.asset_revision||!COVER_UUID.test(plan.asset_id||'')||plan.asset_id===plan.video_asset_id||!/^sha256:[a-f0-9]{64}:[0-9]{1,30}$/.test(plan.asset_revision||'')||!/^[A-Za-z0-9_-]{10,200}$/.test(plan.drive_file_id||'')||plan.mime_type!=='image/png'||!Number.isSafeInteger(plan.size_bytes)||plan.size_bytes<33||plan.size_bytes>24000000||!Number.isInteger(plan.position_ms)||plan.position_ms<0||!Number.isInteger(plan.duration_ms)||plan.duration_ms<1||plan.duration_ms>60000||plan.position_ms>=plan.duration_ms)throw Error('COVER_BINDING_INVALID');
 return plan;
}
function withTikTokCover(request,intent){
 const c=coverPlan(intent.cover,intent.binding);
 if(!c||intent.operation!=='init'||intent.platform!=='tiktok')return request;
 if(intent.ok!==true||!COVER_UUID.test(intent.lease_id||'')||request.method!=='POST'||request.url!=='https://open.tiktokapis.com/v2/post/publish/video/init/'||request.body_type!=='json'||!request.body?.post_info||request.body?.source_info?.source!=='FILE_UPLOAD')throw Error('COVER_INTENT_INVALID');
 return {...request,body:{...request.body,post_info:{...request.body.post_info,video_cover_timestamp_ms:c.position_ms}}};
}
function coverBytes(bytes,plan){
 if(!Buffer.isBuffer(bytes)||bytes.length!==plan?.size_bytes||bytes.length<33||bytes.length>24000000||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(8)!==13||bytes.readUInt32BE(16)<1||bytes.readUInt32BE(20)<1||coverHash('sha256').update(bytes).digest('hex')!==plan.asset_revision?.split(':')[1])throw Error('COVER_BYTES_CHANGED');
 return true;
}
function youtubeCoverRequest(intent,token,bytes){
 const c=coverPlan(intent?.cover,intent?.binding);
 if(!c||intent.ok!==true||intent.operation!=='youtube_thumbnail'||intent.platform!=='youtube'||intent.video_state!=='complete'||!COVER_UUID.test(intent.lease_id||'')||!/^[A-Za-z0-9_-]{11}$/.test(intent.provider_id||'')||!/^[A-Za-z0-9_-]{24}$/.test(intent.target_id||'')||typeof token!=='string'||token.length<10||/[\r\n]/.test(token))throw Error('COVER_INTENT_INVALID');
 coverBytes(bytes,c);
 return {method:'POST',url:'https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId='+encodeURIComponent(intent.provider_id),headers:{Authorization:'Bearer '+token,'Content-Type':'image/png','Content-Length':String(bytes.length)},body_type:'binary'};
}
function youtubeCoverObservation(http){
 let body=http?.body;if(typeof body==='string')try{body=JSON.parse(body);}catch{body=null;}
 const status=Number(http?.statusCode);
 if(status===200&&body?.kind==='youtube#thumbnailSetResponse'&&Array.isArray(body.items)&&body.items.length===1&&body.items[0]&&Object.values(body.items[0]).some(t=>t&&typeof t.url==='string'&&/^https:\/\//.test(t.url)&&Number(t.width)>0&&Number(t.height)>0))return {state:'complete',code:'COVER_ACCEPTED'};
 if([400,401,403,404,413,429].includes(status)&&Number(body?.error?.code)===status)return {state:'failed',code:status===403?'COVER_PERMISSION_REQUIRED':'COVER_REJECTED'};
 return {state:'uncertain',code:'COVER_RESPONSE_UNCERTAIN'};
}
module.exports={coverPlan,withTikTokCover,coverBytes,youtubeCoverRequest,youtubeCoverObservation};
