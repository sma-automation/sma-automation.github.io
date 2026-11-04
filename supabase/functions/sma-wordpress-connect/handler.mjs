import {createBridgeKeys,signBridgeCommand,readBridgeResult} from '../_shared/wordpress-bridge.mjs';
import {wordpressTarget} from '../_shared/wordpress-transport.mjs';
const ORIGIN='https://sma-automation.com',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const codes=new Set(['AUTH_REQUIRED','ACCOUNT_CHANGED','ACCOUNT_UNAVAILABLE','ACCESS_INACTIVE','WEBSITE_REQUIRED','SHOP_REQUIRED','SHOP_CHANGED','TARGET_REJECTED','REQUEST_STALE','TICKET_UNAVAILABLE','VERIFICATION_BUSY','REVISION_CONFLICT','REQUEST_CONFLICT','REQUEST_RATE_LIMITED','CREDENTIAL_UNAVAILABLE','PROVIDER_UNAVAILABLE','ALREADY_VERIFIED']);
export async function boundedJson(request,max=4096){
 if(!request.body||Number(request.headers.get('content-length'))>max)fail('INVALID_INPUT');
 const reader=request.body.getReader(),parts=[];let total=0;
 try{for(;;){const r=await reader.read();if(r.done)break;total+=r.value.length;if(total>max){await reader.cancel();fail('INVALID_INPUT');}parts.push(r.value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('INVALID_INPUT');}
}
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export const ticketForKey=key=>digest('SMA-WORDPRESS-TICKET-V1\n'+key);
const requireOk=r=>{if(r?.ok!==true)fail(codes.has(r?.code)?r.code:'UNAVAILABLE');return r;};
function connected(r){
 if(r?.ok!==true||r.state!=='verified'||r.provider!=='wordpress'||r.website_connected!==true||!UUID.test(r.attempt_id))return null;
 wordpressTarget(r.website_url);
 return {ok:true,state:'verified',attempt_id:r.attempt_id,website_url:r.website_url,can_publish:false,can_synchronize:false};
}
export function createConnectHandler({authenticate,userRpc,serviceRpc,probe,keys=createBridgeKeys}){
 return async request=>{
  const origin=request.headers.get('origin'),headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(origin===ORIGIN?{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}:{})};
  const reply=(r,status=200)=>new Response(JSON.stringify(r),{status,headers});
  if(origin&&origin!==ORIGIN)return reply({ok:false,code:'ORIGIN_REJECTED'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply({ok:false,code:'METHOD_NOT_ALLOWED'},405);
  const auth=request.headers.get('authorization');if(!auth||!/^Bearer [^\s]+$/.test(auth)||auth.length>8192)return reply({ok:false,code:'AUTH_REQUIRED'},401);
  let input;
  try{
   input=await boundedJson(request,1024);
   const action=input?.action,expected=action==='start'||action==='revoke'?['action','expected_revision','request_id']:['verify','resume'].includes(action)?['action','attempt_id']:['action'];
   if(!['status','start','resume','verify','revoke'].includes(action)||Object.keys(input).sort().join('|')!==expected.sort().join('|')
    ||(['start','revoke'].includes(action)&&(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<0||input.expected_revision>=2147483647||!UUID.test(input.request_id)))
    ||(['verify','resume'].includes(action)&&!UUID.test(input.attempt_id)))fail('INVALID_INPUT');
  }catch{return reply({ok:false,code:'INVALID_INPUT'},400);}
  try{
   const user=await authenticate(auth);if(!UUID.test(user?.id||''))return reply({ok:false,code:'AUTH_REQUIRED'},401);
   const uid=user.id;await serviceRpc('sma_wordpress_ticket_cleanup_v1',{});
   if(input.action==='revoke'){
    const r=requireOk(await userRpc(auth,'revoke',{expected_revision:input.expected_revision,request_id:input.request_id}));
    return reply({ok:true,state:'revoked',revision:r.revision,can_publish:false,can_synchronize:false});
   }
   const draft=requireOk(await userRpc(auth,'get',{}));
   const existing=connected(await serviceRpc('sma_website_provider_context_v1',{p_user_id:uid}));
   if(existing){if(input.action==='verify'&&input.attempt_id!==existing.attempt_id)fail('REQUEST_STALE');return reply({...existing,revision:draft.revision});}
   if(input.action==='status')return reply({ok:true,state:draft.state,revision:draft.revision,website_url:draft.website_url,attempt_id:draft.attempt_id,can_publish:false,can_synchronize:false});
   if(input.action==='start'||input.action==='resume'){
    wordpressTarget(draft.website_url);
    if(input.action==='resume'&&input.attempt_id!==draft.attempt_id)fail('REQUEST_STALE');
    const r=input.action==='resume'?draft:requireOk(await userRpc(auth,'prepare',{provider:'wordpress',expected_revision:input.expected_revision,request_id:input.request_id}));
    if(r.state!=='pending')fail('REQUEST_STALE');
    let ticket=await serviceRpc('sma_wordpress_ticket_context_v1',{p_user_id:uid,p_attempt_id:r.attempt_id});
    if(ticket?.ok!==true){
     const pair=await keys(),token=await ticketForKey(pair.privateKey);
     ticket=requireOk(await serviceRpc('sma_wordpress_ticket_issue_v1',{p_user_id:uid,p_attempt_id:r.attempt_id,p_public_key:pair.publicKey,p_private_key:pair.privateKey,p_ticket_hash:await digest(token)}));
    }
    const token=await ticketForKey(ticket.private_key);
    const target=wordpressTarget(ticket.website_url),url='https://'+target.hostname+new URL(ticket.website_url).pathname+'wp-admin/options-general.php?page=sma-bridge&ticket='+token;
    return reply({ok:true,state:'pending',revision:r.revision,attempt_id:r.attempt_id,website_url:ticket.website_url,authorization_url:url,expires_at:ticket.expires_at,can_publish:false,can_synchronize:false});
   }
   const attempt=input.attempt_id;
   const t=requireOk(await serviceRpc('sma_wordpress_ticket_context_v1',{p_user_id:uid,p_attempt_id:attempt}));
   const lease=requireOk(await serviceRpc('sma_website_provider_begin_v1',{p_user_id:uid,p_attempt_id:attempt}));
   try{
    const signed=await signBridgeCommand({privateKey:t.private_key,attemptId:attempt,requestId:crypto.randomUUID(),action:'inspect'});
    const raw=await probe(t.website_url,signed);
    readBridgeResult(raw,{attemptId:attempt,websiteUrl:t.website_url,shopSlug:t.shop_slug,action:'inspect'});
    requireOk(await serviceRpc('sma_wordpress_ticket_finish_v1',{p_user_id:uid,p_attempt_id:attempt,p_verification_id:lease.verification_id,p_proof:{website_url:t.website_url,provider_site_id:'wordpress-bridge:'+attempt,can_read:true}}));
   }finally{await serviceRpc('sma_wordpress_verify_release_v1',{p_user_id:uid,p_attempt_id:attempt,p_verification_id:lease.verification_id}).catch(()=>{});}
   const result=connected(await serviceRpc('sma_website_provider_context_v1',{p_user_id:uid}));if(!result)fail('UNAVAILABLE');
   return reply({...result,revision:draft.revision});
  }catch(e){const code=codes.has(e?.code)?e.code:'UNAVAILABLE';return reply({ok:false,code},code==='AUTH_REQUIRED'?401:409);}
 };
}
export function createTicketHandler({serviceRpc}){
 return async request=>{
  const reply=(r,status)=>new Response(JSON.stringify(r),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(request.method!=='POST'||request.headers.get('origin'))return reply({ok:false,code:'TICKET_UNAVAILABLE'},403);
  try{
   const input=await boundedJson(request,2300);
   if(!input||Object.keys(input).sort().join('|')!=='ticket|website_url'||!/^[a-f0-9]{64}$/.test(input.ticket))fail('INVALID_INPUT');
   wordpressTarget(input.website_url);
   await serviceRpc('sma_wordpress_ticket_cleanup_v1',{});
   const r=await serviceRpc('sma_wordpress_ticket_lookup_v1',{p_ticket_hash:await digest(input.ticket),p_website_url:input.website_url});
   if(r?.ok!==true)fail('TICKET_UNAVAILABLE');
   // Copy only the seven public fields expected by the WordPress consent form.
   return reply({ok:true,attempt_id:r.attempt_id,website_url:r.website_url,shop_slug:r.shop_slug,account_label:r.account_label,public_key:r.public_key,expires_at:r.expires_at},200);
  }catch{return reply({ok:false,code:'TICKET_UNAVAILABLE'},403);}
 };
}
