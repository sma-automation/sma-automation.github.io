import {boundedJson} from '../sma-wordpress-connect/handler.mjs';
import {signBridgeCommand,readBridgeResult} from '../_shared/wordpress-bridge.mjs';
import {wordpressTarget} from '../_shared/wordpress-transport.mjs';
const originAllowed='https://sma-automation.com',uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const safeCodes=new Set(['AUTH_REQUIRED','ACCOUNT_CHANGED','ACCOUNT_UNAVAILABLE','ACCESS_INACTIVE','SHOP_REQUIRED','REQUEST_STALE','NOT_CONNECTED','CREDENTIAL_UNAVAILABLE','SYNC_BUSY','LEASE_STALE','RESULT_CONFLICT','PROVIDER_UNAVAILABLE','TARGET_REJECTED','PAGE_CHANGED','REVISION_CONFLICT','REQUEST_CONFLICT','WEBSITE_CHANGED','ACCESS_REVOKED','TRANSACTION_REQUIRED','CONTENT_FILTERED','INVALID_PROVIDER_RESULT']);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const ok=r=>{if(r?.ok!==true)fail(safeCodes.has(r?.code)?r.code:'UNAVAILABLE');return r;};
function publicState(r){
 if(!uuid.test(r.attempt_id)||!['idle','running','retry','draft','blocked'].includes(r.state))fail('UNAVAILABLE');
 wordpressTarget(r.website_url);
 const done=r.state==='draft';if(done&&(!Number.isSafeInteger(r.post_id)||r.post_id<=0||!Number.isSafeInteger(r.revision)||r.revision<1||typeof r.completed_at!=='string'))fail('UNAVAILABLE');
 return {ok:true,attempt_id:r.attempt_id,website_url:r.website_url,state:r.state,can_synchronize:['idle','retry'].includes(r.state),can_publish:false,
  post_id:done?r.post_id:null,revision:done?r.revision:null,completed_at:done?r.completed_at:null,
  edit_url:done?r.website_url+'wp-admin/post.php?post='+r.post_id+'&action=edit':null,
  last_error:safeCodes.has(r.last_error)?r.last_error:null,retry_after:Number.isSafeInteger(r.retry_after)?r.retry_after:null};
}
function bridgeResult(raw,context){
 if(raw?.ok===false&&safeCodes.has(raw.code))fail(raw.code);
 try{return readBridgeResult(raw,context);}catch{fail('INVALID_PROVIDER_RESULT');}
}
export function createSyncHandler({authenticate,serviceRpc,probe,sign=signBridgeCommand}){
 return async request=>{
  const origin=request.headers.get('origin'),headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(origin===originAllowed?{'Access-Control-Allow-Origin':originAllowed,'Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}:{})};
  const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
  if(origin&&origin!==originAllowed)return reply({ok:false,code:'ORIGIN_REJECTED'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply({ok:false,code:'METHOD_NOT_ALLOWED'},405);
  const auth=request.headers.get('authorization');if(!auth||!/^Bearer [^\s]+$/.test(auth)||auth.length>8192)return reply({ok:false,code:'AUTH_REQUIRED'},401);
  let input;
  try{input=await boundedJson(request,1024);if(!input||Object.keys(input).sort().join('|')!=='action|attempt_id'||!['status','sync'].includes(input.action)||!uuid.test(input.attempt_id))fail('INVALID_INPUT');}
  catch{return reply({ok:false,code:'INVALID_INPUT'},400);}
  try{
   const user=await authenticate(auth);if(!uuid.test(user?.id||''))fail('AUTH_REQUIRED');
   const job=async(action,data={})=>ok(await serviceRpc('sma_wordpress_sync_job_v1',{p_user_id:user.id,p_attempt_id:input.attempt_id,p_action:action,p_input:data}));
   let state=await job(input.action==='status'?'status':'claim');
   if(input.action==='status'||['draft','blocked'].includes(state.state))return reply(publicState(state));
   if(!uuid.test(state.lease_id)||!uuid.test(state.request_id)||state.attempt_id!==input.attempt_id)fail('UNAVAILABLE');
   const lease=state.lease_id,requestId=state.request_id;
   try{
    const credential=ok(await serviceRpc('sma_website_provider_credential_v1',{p_user_id:user.id,p_attempt_id:input.attempt_id,p_action:'get'}));
    if(credential.provider!=='wordpress'||credential.attempt_id!==input.attempt_id||credential.website_url!==state.website_url||credential.provider_site_id!=='wordpress-bridge:'+input.attempt_id||typeof credential.credentials?.bridge_private_key!=='string')fail('NOT_CONNECTED');
    const base={privateKey:credential.credentials.bridge_private_key,attemptId:input.attempt_id};
    const context={attemptId:input.attempt_id,websiteUrl:state.website_url,shopSlug:state.shop_slug};
    let proof=null;
    if(state.expected_revision===null){
     const raw=await probe(state.website_url,await sign({...base,requestId:crypto.randomUUID(),action:'inspect'}));
     const inspected=bridgeResult(raw,{...context,action:'inspect'});proof={revision:inspected.revision,post_id:inspected.postId};
    }
    // Persist baseline and recheck the current binding immediately before dispatch.
    state=await job('dispatch',{lease_id:lease,proof});
    if(state.request_id!==requestId||state.lease_id!==lease||state.website_url!==context.websiteUrl||state.shop_slug!==context.shopSlug)fail('REQUEST_STALE');
    const signed=await sign({...base,requestId,action:'sync_draft',expectedRevision:state.expected_revision});
    const raw=await probe(state.website_url,signed);
    const result=bridgeResult(raw,{...context,action:'sync_draft',expectedRevision:state.expected_revision});
    if(state.previous_post_id!==null&&result.postId!==state.previous_post_id)fail('INVALID_PROVIDER_RESULT');
    state=await job('complete',{lease_id:lease,proof:{revision:result.revision,post_id:result.postId}});
    return reply(publicState(state));
   }catch(e){
    const code=safeCodes.has(e?.code)?e.code:'PROVIDER_UNAVAILABLE';
    // Unknown outcomes keep the original UUID and expected revision for a safe replay.
    const block=['TARGET_REJECTED','PAGE_CHANGED','REVISION_CONFLICT','REQUEST_CONFLICT','WEBSITE_CHANGED','ACCESS_REVOKED','NOT_CONNECTED','TRANSACTION_REQUIRED','CONTENT_FILTERED','INVALID_PROVIDER_RESULT'].includes(code);
    try{const saved=await job(block?'block':'retry',{lease_id:lease,code:block?code:'PROVIDER_UNAVAILABLE'});return reply(publicState(saved));}catch{throw e;}
   }
  }catch(e){const code=safeCodes.has(e?.code)?e.code:'UNAVAILABLE';return reply({ok:false,code},code==='AUTH_REQUIRED'?401:409);}
 };
}
