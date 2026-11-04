import {normalizeWebsite} from './website-domain-model.mjs';

const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const providers=new Set(['wordpress','hostinger']);
const states=new Set(['not_requested','pending','expired','stale','revoked']);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const integer=value=>Number.isSafeInteger(value)&&value>=0&&value<=2147483647;

// A request is never a completed connection. Reject premature capability flags
// rather than rendering a provider as connected based on local state alone.
export function readConnectionRequest(value,{now=Date.now}={}){
 if(!value||value.ok!==true)fail(typeof value?.code==='string'?value.code:'UNAVAILABLE');
 if(!states.has(value.state)||!integer(value.revision)||!integer(value.preparation_revision)
  ||value.website_connected!==false||value.can_synchronize!==false||value.can_publish!==false)fail('INVALID_RESPONSE');
 if(value.website_url!==null){
  try{if(!value.website_url||normalizeWebsite(value.website_url)!==value.website_url)fail('INVALID_RESPONSE');}
  catch{fail('INVALID_RESPONSE');}
 }
 if(value.state==='not_requested'){
  if(value.revision!==0||value.provider!==null||value.attempt_id!==null||value.expires_at!==null)fail('INVALID_RESPONSE');
 }else if(value.revision===0||!providers.has(value.provider))fail('INVALID_RESPONSE');
 let state=value.state,attempt=value.attempt_id,expires=value.expires_at;
 if(state==='pending'){
  if(value.preparation_revision===0||!value.website_url||!uuidPattern.test(attempt)
   ||typeof expires!=='string'||!Number.isFinite(Date.parse(expires)))fail('INVALID_RESPONSE');
  const current=now();if(!Number.isFinite(current))fail('INVALID_RESPONSE');
  if(Date.parse(expires)<=current){state='expired';attempt=null;expires=null;}
 }else if(attempt!==null||expires!==null)fail('INVALID_RESPONSE');
 return {state,revision:value.revision,preparationRevision:value.preparation_revision,
  websiteUrl:value.website_url,provider:value.provider,attemptId:attempt,expiresAt:expires,
  websiteConnected:false,canSynchronize:false,canPublish:false};
}

export function createConnectionRequestClient({request,getOwnerId,uuid=()=>crypto.randomUUID(),now=Date.now}){
 let owner=null,revision=0,pending=null,busy=false;
 const currentOwner=async()=>{const id=await getOwnerId();if(!id)fail('AUTH_REQUIRED');return id;};
 async function run(fn){if(busy)fail('BUSY');busy=true;try{return await fn();}finally{busy=false;}}
 const read=value=>readConnectionRequest(value,{now});
 async function mutate(action,provider){
  if(!owner||await currentOwner()!==owner)fail('AUTH_REQUIRED');
  if(action==='prepare'&&!providers.has(provider))fail('PROVIDER_UNSUPPORTED');
  const signature=JSON.stringify([action,provider??null]);
  if(!pending||pending.signature!==signature){
   const request_id=uuid();if(!uuidPattern.test(request_id))fail('INVALID_REQUEST');
   pending={signature,action,input:{expected_revision:revision,request_id,...(action==='prepare'?{provider}:{})}};
  }
  const result=read(await request(pending.action,{...pending.input}));
  if(await currentOwner()!==owner)fail('AUTH_REQUIRED');
  revision=result.revision;pending=null;return result;
 }
 return {
  load:()=>run(async()=>{
   const next=await currentOwner();
   const result=read(await request('get',{}));
   if(await currentOwner()!==next)fail('AUTH_REQUIRED');
   owner=next;revision=result.revision;pending=null;return result;
  }),
  prepare:provider=>run(()=>mutate('prepare',provider)),
  revoke:()=>run(()=>mutate('revoke'))
 };
}
