'use strict';
const {normalizeFrames}=require('./content-review.cjs');

// Immutable deployment profile. This policy is permanently bound to Sightengine
// and this model mapping. Another provider MUST have a different policy/cache key.
const POLICY='visual-2026-11-01.1';
const ACTIVE_PROVIDER='sightengine';
const MODELS='nudity-2.1,violence,weapon,gore-2.0,offensive-2.0,recreational_drug,self-harm';
const FIELDS=Object.freeze(Object.fromEntries(Object.entries({
 nudity:['nudity.sexual_activity','nudity.sexual_display','nudity.erotica','nudity.suggestive_classes.sextoy','nudity.suggestive'],
 violence:['violence.prob'],weapons:['weapon.classes.firearm','weapon.classes.knife','weapon.classes.firearm_gesture'],
 gore:['gore.prob'],hate:['offensive.nazi','offensive.confederate','offensive.supremacist','offensive.terrorist'],
 drugs:['recreational_drug.prob'],self_harm:['self-harm.prob']
}).map(([key,paths])=>[key,Object.freeze(paths)])));

function providerCapability(provider,kind){
 if(provider!==ACTIVE_PROVIDER)throw Error('PROVIDER_FAILED'); // No automatic paid or local fallback.
 if(kind==='video')return {available:false,code:'VIDEO_PLAN_REQUIRED'};
 if(kind!=='image')return {available:false,code:'MEDIA_UNSUPPORTED'};
 return {available:true,policy_version:POLICY};
}
function prepareReview(context,sha256){
 const capability=providerCapability(ACTIVE_PROVIDER,context?.media_kind);
 if(!capability.available)throw Error(capability.code);
 if(context?.review?.policy_version!==POLICY||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256))throw Error('REVIEW_INCOMPLETE');
 return {provider:ACTIVE_PROVIDER,policy_version:POLICY,kind:context.media_kind,duration_ms:context.duration_ms,sha256};
}
function normalizeSightengine(response,kind,durationMs){
 if(response?.status!=='success')throw Error('PROVIDER_FAILED');
 if(!['image','video'].includes(kind))throw Error('MEDIA_UNSUPPORTED');
 const raw=kind==='image'?[response]:response.data?.frames;
 if(!Array.isArray(raw)||!raw.length||raw.length>125)throw Error('REVIEW_INCOMPLETE');
 const frames=raw.map(frame=>{
  const scores={};
  for(const [category,paths] of Object.entries(FIELDS)){
   const values=paths.map(path=>path.split('.').reduce((o,k)=>o?.[k],frame));
   if(values.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>1))throw Error('REVIEW_INCOMPLETE');
   scores[category]=Math.max(...values);
  }
  return {position_ms:kind==='image'?0:frame?.info?.position,scores};
 });
 return normalizeFrames(frames,kind,durationMs,POLICY);
}
function completeReview(response,job){
 const capability=providerCapability(job?.provider,job?.kind);
 if(!capability.available)throw Error(capability.code);
 if(job?.policy_version!==POLICY||typeof job.sha256!=='string'||!/^[a-f0-9]{64}$/.test(job.sha256))throw Error('REVIEW_INCOMPLETE');
 return normalizeSightengine(response,job.kind,job.duration_ms);
}
module.exports={POLICY,ACTIVE_PROVIDER,MODELS,FIELDS,providerCapability,prepareReview,normalizeSightengine,completeReview};
