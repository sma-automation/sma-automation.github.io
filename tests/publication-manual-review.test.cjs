const {test}=require('node:test');const assert=require('node:assert/strict');
test('personal review is optional, exact, typed and restricted to the offered order',async()=>{
 const {reviewConfirmation,humanReviewPolicy}=await import('../app/assets/publication-order.mjs');
 const order={state:'prepared',approval_window:{status:'active',expires_at:new Date(Date.now()+60000).toISOString()},binding:{platform:'youtube'},choices:{},approval_policy:'media-consent-2026-11-03.1',human_review_option:{policy_version:humanReviewPolicy,source_fingerprint:'a'.repeat(64)}};
 const base={content_checked:true,media_rights:true,music_rights:true},values={...base,human_review_enabled:true,full_playback:true,visual_clear:true,speech_text_checked:true,claims_match:true};
 assert.equal(reviewConfirmation(order,base).human_review,undefined);assert.equal(reviewConfirmation(order,values).human_review.policy_version,humanReviewPolicy);
 for(const key of ['full_playback','visual_clear','speech_text_checked','claims_match'])for(const value of [undefined,false,1,'true'])assert.throws(()=>reviewConfirmation(order,{...values,[key]:value}));
 for(const patch of [{state:'approved'},{check_error:'FILE_CHANGED'},{human_review_option:null},{binding:{platform:'instagram'}},{human_review_option:{...order.human_review_option,source_fingerprint:'bad'}},{human_review_option:{...order.human_review_option,policy_version:'old'}}])assert.throws(()=>reviewConfirmation({...order,...patch},values));
});
