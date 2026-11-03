'use strict';
const accountCrypto = require('crypto');
const ACCOUNT_CODES = ['TARGET_CONFIGURATION_REQUIRED','TARGET_ACCOUNT_REQUIRED','TARGET_ACCOUNT_CHANGED','TARGET_PERMISSIONS_REQUIRED','TARGET_RECONNECT_REQUIRED','TARGET_CHECK_RUNNING','TARGET_CHECK_UNAVAILABLE','TARGET_REFRESH_UNCERTAIN','TARGET_TOKEN_SAVE_FAILED','TARGET_OPTIONS_CHANGED','TARGET_RATE_LIMITED'];
const TIKTOK_PRIVACY = ['SELF_ONLY','PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR'];
const accountHash = value => accountCrypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function accountFailure(error) {
  const message = String(typeof error?.error==='string'?error.error:error?.message||error?.error?.message||error?.code||'');
  return {ok:false,can_upload:false,can_publish:false,code:ACCOUNT_CODES.find(c=>message===c||message.startsWith(c+' ['))||'TARGET_CHECK_UNAVAILABLE'};
}
function accountInput(rows, context, target) {
  const row=rows.length===1?rows[0]:null,p=context?.binding?.platform;
  if(!row||!['youtube','tiktok'].includes(p)||!Number.isSafeInteger(context.binding.customer_id)||!target?.source_revision)throw Error('TARGET_ACCOUNT_REQUIRED');
  const refresh=row[p+'_refresh_token'],access=row[p+'_access_token'];
  if(typeof refresh!=='string'||refresh.length<10||refresh.length>8000)throw Error('TARGET_RECONNECT_REQUIRED');
  return {platform:p,target,customer_id:context.binding.customer_id,row_id:row.id,kunde_id:row.kunde_id,kunde_email:row.kunde_email,
    refresh_token:refresh,access_token:typeof access==='string'?access:'',fingerprint:accountHash([refresh,access||''])};
}
// Refresh responses are persisted before any scope/profile validation. TikTok
// may rotate the refresh token even when a later creator-info request fails.
function accountRefresh(raw,input,now=Date.now()) {
  const r=raw?.body||raw,status=raw?.statusCode||200;
  if(status!==200||typeof r?.access_token!=='string'||r.access_token.length<10||r.access_token.length>8000||
    !Number.isFinite(r.expires_in)||r.expires_in<60||r.expires_in>31536000)throw Error('TARGET_RECONNECT_REQUIRED');
  const refresh=r.refresh_token|| (input.platform==='youtube'?input.refresh_token:null);
  if(typeof refresh!=='string'||refresh.length<10||refresh.length>8000)throw Error('TARGET_REFRESH_UNCERTAIN');
  if(input.platform==='tiktok'&&(!Number.isFinite(r.refresh_expires_in)||r.refresh_expires_in<60))throw Error('TARGET_REFRESH_UNCERTAIN');
  return {access_token:r.access_token,refresh_token:refresh,expires_in:r.expires_in,
    ...(input.platform==='tiktok'?{refresh_expires_in:r.refresh_expires_in,open_id:r.open_id,scope:r.scope}:{}),
    expires_at:new Date(now+r.expires_in*1000).toISOString()};
}
function accountSaved(rows,input,tokens) {
  const row=rows.length===1?rows[0]:null,p=input.platform;
  if(!row||row.id!==input.row_id||row.kunde_id!==input.kunde_id||row.kunde_email!==input.kunde_email||
    row[p+'_access_token']!==tokens.access_token||row[p+'_refresh_token']!==tokens.refresh_token)throw Error('TARGET_TOKEN_SAVE_FAILED');
  return {saved:true};
}
function accountBody(raw) {
  const status=raw?.statusCode||200,r=raw?.body||raw;
  if(status===401)throw Error('TARGET_RECONNECT_REQUIRED');
  if(status===429)throw Error('TARGET_RATE_LIMITED');
  if(status!==200||!r||r.error&&r.error.code!=='ok')throw Error(status===403?'TARGET_PERMISSIONS_REQUIRED':'TARGET_CHECK_UNAVAILABLE');
  return r;
}
function accountName(name) {
  if(typeof name!=='string'||!name.trim()||name.length>200||/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(name))throw Error('TARGET_CHECK_UNAVAILABLE');
  return name;
}
function accountEvidence(input,tokens,identity,permissions,now=Date.now()) {
  const p=input.platform,target=input.target,profile=accountBody(identity),proof=accountBody(permissions);
  let display_name,policy={},scopes;
  if(p==='youtube') {
    if(!Array.isArray(profile.items)||profile.items.length!==1||profile.items[0].id!==target.id||profile.nextPageToken)throw Error('TARGET_ACCOUNT_CHANGED');
    display_name=accountName(profile.items[0].snippet?.title);
    const granted=new Set(String(proof.scope||'').split(/\s+/));
    if(!granted.has('https://www.googleapis.com/auth/youtube.upload')||!Number.isFinite(Number(proof.expires_in))||Number(proof.expires_in)<60)throw Error('TARGET_PERMISSIONS_REQUIRED');
    scopes=['youtube.upload'];
  } else if(p==='tiktok') {
    if(profile.data?.user?.open_id!==target.id||tokens.open_id!==target.id)throw Error('TARGET_ACCOUNT_CHANGED');
    const granted=new Set(String(tokens.scope||'').split(/[,\s]+/));
    if(!granted.has('video.publish')||!granted.has('user.info.basic'))throw Error('TARGET_PERMISSIONS_REQUIRED');
    const c=proof.data;
    if(!c||!Array.isArray(c.privacy_level_options)||!c.privacy_level_options.length||c.privacy_level_options.some(x=>!TIKTOK_PRIVACY.includes(x))||
      new Set(c.privacy_level_options).size!==c.privacy_level_options.length||!['comment_disabled','duet_disabled','stitch_disabled'].every(k=>typeof c[k]==='boolean')||
      !Number.isSafeInteger(c.max_video_post_duration_sec)||c.max_video_post_duration_sec<1||c.max_video_post_duration_sec>86400)throw Error('TARGET_CHECK_UNAVAILABLE');
    display_name=accountName(c.creator_nickname);
    policy={privacy_levels:c.privacy_level_options,comment_disabled:c.comment_disabled,duet_disabled:c.duet_disabled,stitch_disabled:c.stitch_disabled,max_duration_sec:c.max_video_post_duration_sec};
    scopes=['video.publish','user.info.basic'];
  } else throw Error('TARGET_PERMISSIONS_REQUIRED');
  const expires=Math.min(Date.parse(tokens.expires_at),now+5*60*1000);
  if(!Number.isFinite(expires)||expires<=now+30000)throw Error('TARGET_RECONNECT_REQUIRED');
  return {version:1,platform:p,target_id:target.id,target_revision:target.source_revision,display_name,permissions:scopes,policy,
    checked_at:new Date(now).toISOString(),expires_at:new Date(expires).toISOString()};
}
function accountChoices(evidence,choices) {
  if(evidence.platform!=='tiktok')return true;
  const p=evidence.policy;
  if(!p.privacy_levels.includes(choices.visibility)||p.comment_disabled&&choices.disable_comment!==true||p.duet_disabled&&choices.disable_duet!==true||
    p.stitch_disabled&&choices.disable_stitch!==true||choices.brand_content_toggle===true&&choices.visibility==='SELF_ONLY')throw Error('TARGET_OPTIONS_CHANGED');
  return true;
}
module.exports={accountFailure,accountInput,accountRefresh,accountSaved,accountBody,accountEvidence,accountChoices};
