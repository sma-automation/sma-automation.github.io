'use strict';
// Pure provider response interpretation. No HTTP client, credentials, dispatcher,
// automatic upload retries or claim of durable delivery/idempotency.
const providerObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const providerId=(s,max=200)=>typeof s==='string'&&s.length>0&&s.length<=max&&/^[A-Za-z0-9_.~:-]+$/.test(s);
function providerContext(c){
 if(!providerObject(c)||!['youtube','tiktok'].includes(c.platform)||!providerId(c.target_id)||!providerId(c.provider_id, c.platform==='tiktok'?64:11)||
  (c.platform==='youtube'&&!/^[A-Za-z0-9_-]{11}$/.test(c.provider_id))||
  !Number.isSafeInteger(c.size_bytes)||c.size_bytes<=0||
  !['direct_post','inbox','youtube_video'].includes(c.route)||
  (c.platform==='youtube'?c.route!=='youtube_video':c.route==='youtube_video')||
  !['private','unlisted','public','SELF_ONLY','FOLLOWER_OF_CREATOR','MUTUAL_FOLLOW_FRIENDS','PUBLIC_TO_EVERYONE'].includes(c.visibility)||
  (c.platform==='youtube'?!['private','unlisted','public'].includes(c.visibility):!['SELF_ONLY','FOLLOWER_OF_CREATOR','MUTUAL_FOLLOW_FRIENDS','PUBLIC_TO_EVERYONE'].includes(c.visibility)))throw Error('PROVIDER_CONTEXT_INVALID');
 return c;
}
function providerResult(c,state,extra={}){
 return {platform:c.platform,target_id:c.target_id,provider_id:c.provider_id,route:c.route,expected_visibility:c.visibility,state,upload_retry_allowed:false,can_upload:false,can_publish:false,...extra};
}
function youtubeResult(http,c){
 providerContext(c);if(c.platform!=='youtube')throw Error('PROVIDER_CONTEXT_INVALID');
 if(http?.statusCode!==200||!providerObject(http.body)||!Array.isArray(http.body.items)||http.body.items.length!==1)return providerResult(c,'unknown',{code:'STATUS_UNAVAILABLE'});
 const v=http.body.items[0],s=v?.status,p=v?.processingDetails;
 if(v?.id!==c.provider_id||v?.snippet?.channelId!==c.target_id)return providerResult(c,'unknown',{code:'PROVIDER_BINDING_MISMATCH'});
 if(['deleted','failed','rejected'].includes(s?.uploadStatus)||p?.processingStatus==='failed')return providerResult(c,'failed',{code:'PROVIDER_REJECTED'});
 if(!['uploaded','processed'].includes(s?.uploadStatus)||!['processing','succeeded','terminated'].includes(p?.processingStatus))return providerResult(c,'unknown',{code:'STATUS_INCOMPLETE'});
 if(!['public','private','unlisted'].includes(s.privacyStatus)||s.privacyStatus!==c.visibility||s.publishAt)return providerResult(c,'needs_review',{code:'VISIBILITY_MISMATCH'});
 if(s.uploadStatus!=='processed'||p.processingStatus==='processing')return providerResult(c,'processing');
 if(p.processingStatus!=='succeeded')return providerResult(c,'unknown',{code:'STATUS_INCOMPLETE'});
 // A private/unlisted upload is complete without claiming public availability.
 return providerResult(c,'complete',{visibility:s.privacyStatus,publicly_available:s.privacyStatus==='public',url:'https://www.youtube.com/watch?v='+v.id});
}
function tiktokResult(http,c){
 providerContext(c);if(c.platform!=='tiktok')throw Error('PROVIDER_CONTEXT_INVALID');
 if(http?.statusCode!==200||http.body?.error?.code!=='ok'||!providerObject(http.body.data))return providerResult(c,'unknown',{code:'STATUS_UNAVAILABLE'});
 const d=http.body.data;
 // The fetch endpoint does not echo the publish_id or account. Its trusted
 // request context must come from the persisted attempt, never the response.
 if(d.uploaded_bytes!==undefined&&(!Number.isSafeInteger(d.uploaded_bytes)||d.uploaded_bytes<0||d.uploaded_bytes>c.size_bytes))return providerResult(c,'unknown',{code:'STATUS_INCOMPLETE'});
 if(d.status==='FAILED')return providerResult(c,'failed',{code:'PROVIDER_REJECTED'});
 if(d.status==='PROCESSING_UPLOAD')return providerResult(c,'processing');
 if(d.status==='SEND_TO_USER_INBOX')return c.route==='inbox'?providerResult(c,'awaiting_user'):providerResult(c,'unknown',{code:'PROVIDER_ROUTE_MISMATCH'});
 if(d.status!=='PUBLISH_COMPLETE')return providerResult(c,'unknown',{code:'STATUS_INCOMPLETE'});
 // TikTok's documented misspelling is deliberate. Int64 IDs must remain
 // strings; unsafe JS numbers are not silently rounded into another post ID.
 const raw=d.publicaly_available_post_id;
 if(raw!==undefined&&(!Array.isArray(raw)||raw.length>20))return providerResult(c,'unknown',{code:'STATUS_INCOMPLETE'});
 const ids=(raw||[]).map(x=>typeof x==='string'?x:Number.isSafeInteger(x)?String(x):null);
 if(ids.some(x=>!x||!/^[1-9][0-9]{0,19}$/.test(x))||new Set(ids).size!==ids.length)return providerResult(c,'unknown',{code:'STATUS_INCOMPLETE'});
 if(ids.length&&c.visibility!=='PUBLIC_TO_EVERYONE')return providerResult(c,'needs_review',{code:'VISIBILITY_MISMATCH'});
 return providerResult(c,'complete',{publicly_available:ids.length>0?true:c.visibility==='PUBLIC_TO_EVERYONE'?null:false,public_post_ids:ids});
}
function youtubeTransfer(http,size){
 if(!Number.isSafeInteger(size)||size<=0)throw Error('PROVIDER_CONTEXT_INVALID');
 if(http?.statusCode===308){
  const range=http.headers?.range??http.headers?.Range;
  if(range===undefined)return {state:'uploading',received_bytes:0,upload_retry_allowed:false};
  const m=typeof range==='string'&&/^bytes=0-(\d+)$/.exec(range),n=m?Number(m[1])+1:NaN;
  if(!Number.isSafeInteger(n)||n<1||n>=size)return {state:'unknown',code:'TRANSFER_UNCERTAIN',upload_retry_allowed:false};
  return {state:'uploading',received_bytes:n,upload_retry_allowed:false};
 }
 if([200,201].includes(http?.statusCode)&&/^[A-Za-z0-9_-]{11}$/.test(http.body?.id||''))return {state:'processing',provider_id:http.body.id,upload_retry_allowed:false};
 return {state:'unknown',code:'TRANSFER_UNCERTAIN',upload_retry_allowed:false};
}
function tiktokTransfer(http,size){
 if(!Number.isSafeInteger(size)||size<=0)throw Error('PROVIDER_CONTEXT_INVALID');
 // A 201 only completes transfer; the authenticated status endpoint is still required.
 if(http?.statusCode===201)return {state:'processing',upload_retry_allowed:false};
 if(http?.statusCode===206)return {state:'uploading',upload_retry_allowed:false};
 return {state:'unknown',code:'TRANSFER_UNCERTAIN',upload_retry_allowed:false};
}
function mergeProviderObservation(previous,next){
 if(!providerObject(previous)||!providerObject(next)||['platform','target_id','provider_id','route','expected_visibility'].some(k=>!previous[k]||previous[k]!==next[k]))throw Error('PROVIDER_BINDING_MISMATCH');
 const terminal=['complete','failed'];
 // Moderation can expose public TikTok IDs only on a later completed poll.
 // Accumulate confirmed IDs without losing them to a delayed empty response.
 if(previous.state==='complete'&&next.state==='complete'&&previous.platform==='tiktok'){
  const ids=[...new Set([...(previous.public_post_ids||[]),...(next.public_post_ids||[])])];
  return {...previous,...next,public_post_ids:ids,publicly_available:ids.length>0?true:next.publicly_available};
 }
 if(terminal.includes(previous.state))return {...previous};
 // A transient polling error cannot erase confirmed receipt; it still never
 // authorizes another upload. Caller persists attempt+sequence atomically.
 if(next.state==='unknown'&&previous.state!=='unknown')return {...previous,last_check:'unavailable'};
 return {...next};
}
module.exports={providerContext,youtubeResult,tiktokResult,youtubeTransfer,tiktokTransfer,mergeProviderObservation};
