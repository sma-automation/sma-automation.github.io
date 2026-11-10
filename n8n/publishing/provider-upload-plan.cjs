'use strict';
// Inert request construction. No fetch, credentials, upload session or approval.
function providerUploadPlan(prepared,choices,file){
 const p=prepared?.binding?.platform;
 if(prepared?.ok!==true||prepared.stage!=='publisher_preparation'||prepared.can_upload!==false||prepared.can_publish!==false||!Array.isArray(prepared.blockers)||!prepared.blockers.length||!['youtube','tiktok'].includes(p)||prepared.binding.media_kind!=='video')throw Error('PUBLISHER_NOT_READY');
 if(!choices||typeof choices!=='object'||Array.isArray(choices)||!file||file.mime_type!=='video/mp4'||!Number.isSafeInteger(file.size_bytes)||file.size_bytes<1||file.size_bytes>24000000||!/^sha256:[a-f0-9]{64}:\d+$/.test(file.asset_revision||'')||file.asset_revision!==prepared.binding.asset_revision)throw Error('FILE_CHANGED');
 if(typeof prepared.draft?.title!=='string'||!prepared.draft.title||typeof prepared.draft?.caption!=='string'||!prepared.draft.caption)throw Error('SAVED_TEXT_INVALID');
 const wanted=p==='youtube'?['visibility','made_for_kids','contains_synthetic_media']:['visibility','disable_comment','disable_duet','disable_stitch','brand_content_toggle','brand_organic_toggle'];
 if(Object.keys(choices).sort().join()!==wanted.sort().join()||wanted.filter(k=>k!=='visibility').some(k=>typeof choices[k]!=='boolean'))throw Error('INVALID_CHOICES');
 let request;
 if(p==='youtube'){
  if(!['private','unlisted','public'].includes(choices.visibility)||prepared.adapter_fields?.snippet?.title!==prepared.draft?.title||prepared.adapter_fields?.snippet?.description!==prepared.draft?.caption)throw Error('INVALID_CHOICES');
  request={method:'POST',url:'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',headers:{'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':file.mime_type,'X-Upload-Content-Length':String(file.size_bytes)},body:{snippet:{title:prepared.draft.title,description:prepared.draft.caption,categoryId:'22'},status:{privacyStatus:choices.visibility,selfDeclaredMadeForKids:choices.made_for_kids,containsSyntheticMedia:choices.contains_synthetic_media}}};
 }else{
  if(!['SELF_ONLY','PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR'].includes(choices.visibility)||choices.brand_content_toggle&&choices.visibility==='SELF_ONLY'||prepared.adapter_fields?.post_info?.title!==prepared.draft?.caption)throw Error('INVALID_CHOICES');
  request={method:'POST',url:'https://open.tiktokapis.com/v2/post/publish/video/init/',body:{post_info:{title:prepared.draft.caption,privacy_level:choices.visibility,disable_comment:choices.disable_comment,disable_duet:choices.disable_duet,disable_stitch:choices.disable_stitch,brand_content_toggle:choices.brand_content_toggle,brand_organic_toggle:choices.brand_organic_toggle},source_info:{source:'FILE_UPLOAD',video_size:file.size_bytes,chunk_size:file.size_bytes,total_chunk_count:1}}};
 }
 return {stage:'provider_request_preview',platform:p,dispatch_enabled:false,can_upload:false,can_publish:false,blockers:[...prepared.blockers,'PROVIDER_DISPATCH_DISABLED'],request};
}
module.exports={providerUploadPlan};
