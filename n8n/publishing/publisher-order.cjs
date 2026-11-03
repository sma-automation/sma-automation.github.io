'use strict';
const orderCrypto = require('crypto');
const ORDER_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function orderRequest(item) {
  const auth=item?.headers?.authorization, body=item?.body;
  if(typeof auth!=='string'||!/^Bearer [A-Za-z0-9._-]{20,8000}$/.test(auth))throw Error('AUTH_REQUIRED');
  if(!body||!['prepare','approve','get'].includes(body.action)||!body.input||!ORDER_UUID.test(body.input.id||'')||
    Object.keys(body).some(k=>!['action','input'].includes(k))||JSON.stringify(body).length>8000)throw Error('INVALID_INPUT');
  return {auth,action:body.action,input:body.input};
}
// Source rows never leave this node. Only the selected non-secret identity does.
function orderTarget(rows,context) {
  if(context?.ok!==true||!context.binding||!context.n8n_kunde_id||!context.kunde_email)throw Error('ORDER_UNAVAILABLE');
  const matches=rows.filter(r=>r?.kunde_id), k=matches.length===1?matches[0]:null;
  if(!k||k.kunde_id!==context.n8n_kunde_id||String(k.kunde_email||'').trim().toLowerCase()!==context.kunde_email.trim().toLowerCase()||
    k.zugang_aktiv!==true||!(k.demo_delta_aktiv===true||k.zahlung_bestaetigt===true))throw Error('TARGET_ACCOUNT_REQUIRED');
  const p=context.binding.platform;
  const fields={youtube:['youtube_channel_id','youtube_channel_title'],instagram:['instagram_user_id','instagram_username'],
    facebook:['facebook_page_id','facebook_page_name'],tiktok:['tiktok_open_id','tiktok_display_name']}[p];
  if(!fields)throw Error('TARGET_ACCOUNT_REQUIRED');
  const id=k[fields[0]],name=String(k[fields[1]]||id||'');
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{3,200}$/.test(id)||name.length<1||name.length>200||/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(name))throw Error('TARGET_ACCOUNT_REQUIRED');
  const target={platform:p,id,name,source_revision:orderCrypto.createHash('sha256').update(JSON.stringify([k.id,k.kunde_id,k.kunde_email,p,id,name])).digest('hex')};
  if(context.target&&JSON.stringify(Object.entries(context.target).sort())!==JSON.stringify(Object.entries(target).sort()))throw Error('TARGET_ACCOUNT_CHANGED');
  return {target};
}
function orderDrive(metadata,context,folders) {
  const b=context?.binding;
  if(!b||metadata?.id!==b.drive_file_id||metadata.trashed!==false||!Array.isArray(metadata.parents)||!metadata.parents.some(x=>folders.includes(x)))throw Error('FILE_CHANGED');
  const hash=/^[a-f0-9]{64}$/.test(metadata.sha256Checksum||'')?'sha256:'+metadata.sha256Checksum:/^[a-f0-9]{32}$/.test(metadata.md5Checksum||'')?'md5:'+metadata.md5Checksum:'version';
  if(!/^\d{1,30}$/.test(metadata.version||'')||hash+':'+metadata.version!==b.asset_revision||
    metadata.mimeType?.split('/')[0]!==b.media_kind||metadata.capabilities?.canDownload!==true)throw Error('FILE_CHANGED');
  return {drive_verified:true};
}
function orderCheck(prepared,context,target,drive) {
  if(!context?.lease_id||!ORDER_UUID.test(context.id||''))throw Error('INVALID_LEASE');
  const same=prepared?.binding&&JSON.stringify(Object.entries(prepared.binding).sort())===JSON.stringify(Object.entries(context.binding).sort());
  const textVerified=prepared?.ok===true&&prepared.stage==='publisher_preparation'&&prepared.can_upload===false&&prepared.can_publish===false&&same;
  const blockers=[];
  if(!textVerified)blockers.push('SAVED_TEXT_INVALID');
  // Final consent and duplicate reservation are authoritative database facts.
  // No client/provider failure is converted into a positive permission decision.
  if(textVerified&&prepared.draft.review_notes.length)blockers.push('TEXT_REVIEW_REQUIRED');
  return {p_action:'finish_check',p_id:context.id,p_lease:context.lease_id,
    p_data:{target:target?.target||null,drive_verified:drive?.drive_verified===true,text_verified:textVerified,blockers}};
}
function orderFailure(error) {
  const message=String(error?.message||error?.error?.message||error?.code||'');
  const known=['AUTH_REQUIRED','INVALID_INPUT','ORDER_UNAVAILABLE','TARGET_ACCOUNT_REQUIRED','TARGET_ACCOUNT_CHANGED','FILE_CHANGED','FINAL_APPROVAL_REQUIRED','ORDER_RUNNING','FILE_REFRESH_REQUIRED'];
  return {ok:false,can_upload:false,can_publish:false,code:known.find(x=>message===x||message.startsWith(x+' ['))||'ORDER_UNAVAILABLE'};
}
module.exports={orderRequest,orderTarget,orderDrive,orderCheck,orderFailure};
