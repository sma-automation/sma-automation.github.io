const {test}=require('node:test');const assert=require('node:assert/strict');
const {youtubeResult,tiktokResult,youtubeTransfer,tiktokTransfer,mergeProviderObservation}=require('../n8n/publishing/provider-results.cjs');
const yt={platform:'youtube',target_id:'synthetic_channel',provider_id:'AbCdEf123_-',route:'youtube_video',visibility:'private',size_bytes:1000};
const tt={platform:'tiktok',target_id:'synthetic_creator',provider_id:'v_pub_file~v2.123',route:'direct_post',visibility:'SELF_ONLY',size_bytes:1000};
const y=(status='processed',processing='succeeded',privacy='private')=>({statusCode:200,body:{items:[{id:yt.provider_id,snippet:{channelId:yt.target_id},status:{uploadStatus:status,privacyStatus:privacy},processingDetails:{processingStatus:processing}}]}});
const t=(status,extra={})=>({statusCode:200,body:{error:{code:'ok'},data:{status,...extra}}});
test('YouTube transfer acceptance never claims publication',()=>{assert.equal(youtubeTransfer({statusCode:201,body:{id:yt.provider_id}},1000).state,'processing');assert.deepEqual(youtubeTransfer({statusCode:308,headers:{Range:'bytes=0-499'}},1000),{state:'uploading',received_bytes:500,upload_retry_allowed:false});for(const r of ['bytes=1-499','bytes=0-999','bytes=0-1000','bytes=0-99999999999999999'])assert.equal(youtubeTransfer({statusCode:308,headers:{range:r}},1000).state,'unknown');assert.equal(youtubeTransfer({statusCode:504},1000).upload_retry_allowed,false);});
test('YouTube checks ID, channel, processing and explicit visibility',()=>{assert.equal(youtubeResult(y(),yt).state,'complete');assert.equal(youtubeResult(y(),yt).publicly_available,false);assert.equal(youtubeResult(y('uploaded','processing'),yt).state,'processing');assert.equal(youtubeResult(y('processed','terminated'),yt).state,'unknown');assert.equal(youtubeResult(y('rejected'),yt).state,'failed');assert.equal(youtubeResult(y('processed','succeeded','public'),yt).state,'needs_review');const x=y();x.body.items[0].snippet.channelId='foreign';assert.equal(youtubeResult(x,yt).state,'unknown');assert.equal(youtubeResult({statusCode:200,body:{items:[]}},yt).state,'unknown');});
test('TikTok complete without public post ID is valid; inbox is not publication',()=>{assert.equal(tiktokResult(t('PUBLISH_COMPLETE'),tt).state,'complete');assert.equal(tiktokResult(t('PUBLISH_COMPLETE'),tt).publicly_available,false);assert.equal(tiktokResult(t('SEND_TO_USER_INBOX'),{...tt,route:'inbox'}).state,'awaiting_user');assert.equal(tiktokResult(t('SEND_TO_USER_INBOX'),tt).state,'unknown');assert.equal(tiktokResult(t('PROCESSING_UPLOAD',{uploaded_bytes:1000}),tt).state,'processing');assert.equal(tiktokResult(t('FAILED'),tt).state,'failed');assert.equal(tiktokTransfer({statusCode:201},1000).state,'processing');});
test('TikTok 64-bit IDs stay exact and unknown statuses fail closed',()=>{const id='7400123456789123456',r=t('PUBLISH_COMPLETE',{publicaly_available_post_id:[id]});assert.deepEqual(tiktokResult(r,{...tt,visibility:'PUBLIC_TO_EVERYONE'}).public_post_ids,[id]);assert.equal(tiktokResult(r,tt).state,'needs_review');for(const v of [Number(id),null,{},'',-1])assert.equal(tiktokResult(t('PUBLISH_COMPLETE',{publicaly_available_post_id:[v]}),tt).state,'unknown');for(const s of ['FUTURE_STATUS','PROCESSING_DOWNLOAD',''])assert.equal(tiktokResult(t(s),tt).state,'unknown');assert.equal(tiktokResult(t('PROCESSING_UPLOAD',{uploaded_bytes:1001}),tt).state,'unknown');assert.equal(tiktokResult({statusCode:429},tt).upload_retry_allowed,false);});
test('late polling and transport errors do not restart a completed upload',()=>{const good=youtubeResult(y(),yt),processing=youtubeResult(y('uploaded','processing'),yt);assert.deepEqual(mergeProviderObservation(good,processing),good);assert.equal(mergeProviderObservation(processing,youtubeResult({statusCode:500},yt)).state,'processing');assert.throws(()=>mergeProviderObservation(good,{...processing,provider_id:'foreign'}));assert.throws(()=>mergeProviderObservation(good,{...processing,target_id:'foreign'}));assert.throws(()=>mergeProviderObservation(good,{...processing,expected_visibility:'public'}));assert.equal(good.can_upload,false);assert.equal(good.can_publish,false);});
const {providerUploadPlan}=require('../n8n/publishing/provider-upload-plan.cjs');
test('later TikTok completion can add public IDs without inventing availability or losing IDs',()=>{const c={...tt,visibility:'PUBLIC_TO_EVERYONE'},waiting=tiktokResult(t('PUBLISH_COMPLETE'),c),ready=tiktokResult(t('PUBLISH_COMPLETE',{publicaly_available_post_id:['7400123456789123456']}),c);assert.equal(waiting.publicly_available,null);assert.deepEqual(mergeProviderObservation(waiting,ready),ready);assert.deepEqual(mergeProviderObservation(ready,waiting),ready);});
function planFixture(p){const draft={title:'Blaues Quadrat',caption:'Unveränderter Text.\n\n#Quadrat'},file={mime_type:'video/mp4',size_bytes:1347227,asset_revision:'sha256:'+'a'.repeat(64)+':1'},prepared={ok:true,stage:'publisher_preparation',can_upload:false,can_publish:false,binding:{platform:p,media_kind:'video',asset_revision:file.asset_revision},draft,adapter_fields:p==='youtube'?{snippet:{title:draft.title,description:draft.caption}}:{post_info:{title:draft.caption}},blockers:['MEDIA_APPROVAL_REQUIRED']};return {prepared,file};}
test('upload plans bind exact stored text, file and explicit options with dispatch disabled',()=>{for(const p of ['youtube','tiktok']){const {prepared,file}=planFixture(p),choices=p==='youtube'?{visibility:'private',made_for_kids:false,contains_synthetic_media:true}:{visibility:'SELF_ONLY',disable_comment:true,disable_duet:true,disable_stitch:true,brand_content_toggle:false,brand_organic_toggle:false,is_aigc:true};const r=providerUploadPlan(prepared,choices,file);assert.equal(r.dispatch_enabled,false);assert.equal(r.can_upload,false);assert.ok(r.blockers.includes('MEDIA_APPROVAL_REQUIRED'));assert.ok(!JSON.stringify(r).includes('Authorization'));assert.equal(p==='youtube'?r.request.body.snippet.description:r.request.body.post_info.title,prepared.draft.caption);for(const x of [{},{...choices,visibility:undefined},{...choices,rogue:true}])assert.throws(()=>providerUploadPlan(prepared,x,file));assert.throws(()=>providerUploadPlan(prepared,choices,{...file,asset_revision:file.asset_revision+'2'}));assert.throws(()=>providerUploadPlan({...prepared,can_upload:true},choices,file));}});

test('inert TikTok request planner preserves the explicit customer AIGC decision and never enables uploads',()=>{
 const {prepared,file}=planFixture('tiktok');
 const choices={visibility:'SELF_ONLY',disable_comment:true,disable_duet:true,disable_stitch:true,
  brand_content_toggle:false,brand_organic_toggle:false,is_aigc:true};
 for(const flag of [true,false]){
  const planned=providerUploadPlan(prepared,{...choices,is_aigc:flag},file);
  assert.equal(planned.request.body.post_info.is_aigc,flag);
  assert.equal(planned.request.body.post_info.title,prepared.draft.caption);
  assert.equal(planned.request.body.post_info.privacy_level,'SELF_ONLY');
  assert.equal(planned.stage,'provider_request_preview');
  assert.equal(planned.dispatch_enabled,false);
  assert.equal(planned.can_upload,false);
  assert.equal(planned.can_publish,false);
  assert.ok(planned.blockers.includes('PROVIDER_DISPATCH_DISABLED'));
 }
 for(const invalid of [undefined,null,'true','false',0,1,{},[]]){
  const selected={...choices};
  if(invalid===undefined)delete selected.is_aigc;
  else selected.is_aigc=invalid;
  assert.throws(()=>providerUploadPlan(prepared,selected,file),/INVALID_CHOICES/);
 }
 assert.throws(()=>providerUploadPlan(prepared,{...choices,other:true},file),/INVALID_CHOICES/);
 const yt=planFixture('youtube');
 assert.throws(()=>providerUploadPlan(yt.prepared,{visibility:'private',made_for_kids:false,
  contains_synthetic_media:true,is_aigc:true},yt.file),/INVALID_CHOICES/);
});
