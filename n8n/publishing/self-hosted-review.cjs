'use strict';
const {CATEGORIES,eligible,normalizeFrames}=require('./content-review.cjs');
const {POLICY}=require('./review-providers.cjs');
const SCHEMA='sma.visual-review.v1';

// Protocol only: no network, URL, credential or model is configured here.
// An operator-selected, evaluated model profile must cover all seven categories.
function validateProfile(profile){
 if(!profile||typeof profile.policy_version!=='string'||!/^local-[-a-z0-9.]{3,90}$/.test(profile.policy_version)||profile.policy_version===POLICY||typeof profile.model_revision!=='string'||!/^[-a-zA-Z0-9._:@/]{3,160}$/.test(profile.model_revision))throw Error('REVIEW_INCOMPLETE');
}
function buildLocalRequest(context,sha256,profile){
 validateProfile(profile);
 if(typeof context?.lease_id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(context.lease_id)||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256)||context.review?.policy_version!==profile.policy_version)throw Error('REVIEW_INCOMPLETE');
 eligible({...context,revision:context.asset_revision});
 if(context.asset_revision.startsWith('sha256:')&&context.asset_revision.split(':')[1]!==sha256)throw Error('FILE_CHANGED');
 return {schema:SCHEMA,request_id:context.lease_id,content_sha256:sha256,policy_version:profile.policy_version,model_revision:profile.model_revision,media_kind:context.media_kind,mime_type:context.mime_type,size_bytes:Number(context.size_bytes),duration_ms:context.duration_ms??null,sampling_ms:context.media_kind==='video'?1000:0,required_categories:[...CATEGORIES]};
}
function normalizeLocalResponse(response,request,profile){
 validateProfile(profile);
 if(request?.schema!==SCHEMA||request.policy_version!==profile.policy_version||request.model_revision!==profile.model_revision||typeof request.request_id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(request.request_id)||typeof request.content_sha256!=='string'||!/^[a-f0-9]{64}$/.test(request.content_sha256)||request.sampling_ms!==(request.media_kind==='video'?1000:0))throw Error('REVIEW_INCOMPLETE');
 for(const key of ['schema','request_id','content_sha256','policy_version','model_revision','media_kind','sampling_ms']){
  if(request[key]===undefined||response?.[key]!==request[key])throw Error('REVIEW_INCOMPLETE');
 }
 // A remote "clear"/"can_publish" assertion is never trusted; SMA evaluates scores.
 return normalizeFrames(response.frames,request.media_kind,request.duration_ms,profile.policy_version);
}
module.exports={SCHEMA,buildLocalRequest,normalizeLocalResponse};
