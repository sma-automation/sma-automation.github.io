import {deliverFileResume} from './resume.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TICKET=/^[a-f0-9]{64}$/;
const START='https://johnmusic.app.n8n.cloud/webhook/sma-file-job-start-v1';
const OPS=new Set(['upload_start','upload_finish','magic_photo','magic_video','review','preview_prepare','account','order_prepare','order_approve']);
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'https://sma-automation.com',
 'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
const response=(status,body)=>new Response(JSON.stringify(body),{status,headers});
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);

// A start claim is never resent. Only the stored native execution binding can
// establish that n8n received it; a lost HTTP reply must not create another run.
export async function wakeFileJob({jobId,worker,fetcher=fetch,now=Date.now,wait}){
 const claim=await worker('claim_start',{job_id:jobId});
 if(claim?.ok!==true)throw Error('FILE_JOB_UNAVAILABLE');
 if(claim.start!==null){
  const start=claim.start,expires=Date.parse(start?.claim_expires_at);
  if(start?.job_id!==jobId||!TICKET.test(start?.start_ticket)||!Number.isFinite(expires)||expires<=now()||expires>now()+60000)throw Error('FILE_JOB_UNAVAILABLE');
  const identity={job_id:jobId,start_ticket:start.start_ticket};
  try{
   const r=await fetcher(START,{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',
    headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(identity),
    signal:AbortSignal.timeout(Math.max(1,Math.min(10000,Math.floor(expires-now()))))});
   try{await r.body?.cancel();}catch{}
  }catch{/* Receipt, never HTTP success or an exception body, decides. */}
  let receipt;
  try{receipt=await worker('start_receipt',identity);}catch{}
  if(receipt?.ok!==true||receipt.job_id!==jobId||receipt.bound!==true||!/^[A-Za-z0-9_-]{1,80}$/.test(receipt.execution_id||'')){
   try{
    await worker('start_uncertain',identity);
    receipt=await worker('start_receipt',identity);
   }catch{}
   if(receipt?.ok!==true||receipt.job_id!==jobId||receipt.bound!==true)return {ok:false,code:'FILE_JOB_START_UNCERTAIN',can_retry:false};
  }
 }else if(claim.bound!==true){
  return {ok:false,code:'FILE_JOB_START_UNCERTAIN',can_retry:false};
 }
 return deliverFileResume({jobId,rpc:worker,fetcher,now,...(wait?{wait}:{})});
}

// Public commands are authorized and bound in Postgres before any private
// dispatch. No owner, resume URL, worker name, credential or ticket is accepted
// from the browser or returned to it.
export function createFileJobHandler({authorize,worker,fetcher=fetch,now=Date.now,wait}){
 return async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return response(405,{ok:false,code:'METHOD'});
  if(new URL(request.url).search||!request.headers.get('content-type')?.startsWith('application/json'))return response(400,{ok:false,code:'INVALID_INPUT'});
  const auth=request.headers.get('authorization');
  if(!/^Bearer [^\s]{1,8192}$/.test(auth||''))return response(401,{ok:false,code:'AUTH_REQUIRED'});
  let input;
  try{
   const body=await request.text();if(body.length>65536)throw Error();input=JSON.parse(body);
   if(!record(input)||Object.keys(input).sort().join(',')!=='command_id,input,job_id,operation'||
    !UUID.test(input.job_id)||!UUID.test(input.command_id)||!OPS.has(input.operation)||!record(input.input))throw Error();
  }catch{return response(400,{ok:false,code:'INVALID_INPUT'});}
  let view;
  try{view=await authorize(auth,'command',input);}catch{return response(403,{ok:false,code:'FILE_JOB_DENIED'});}
  if(view?.ok!==true||view.job_id!==input.job_id||!Array.isArray(view.commands)||view.commands.length!==1)return response(409,{ok:false,code:'FILE_JOB_DENIED'});
  const command=view.commands[0];
  if(!UUID.test(command?.command_id)||command.operation!==input.operation||
   command.command_id!==input.command_id&&!['upload_start','upload_finish'].includes(input.operation))return response(409,{ok:false,code:'FILE_JOB_DENIED'});
  // Only public data from the authorized view is returned. A transport problem
// remains a stored command; callers read its status instead of starting over.
  let transport;
  try{transport=await wakeFileJob({jobId:input.job_id,worker,fetcher,now,wait});}
  catch{transport={ok:false,code:'FILE_JOB_UNAVAILABLE',can_retry:false};}
  return response(202,{ok:true,job_id:input.job_id,command_id:command.command_id,accepted:true,
   transport:transport.ok===true?'accepted':'uncertain',can_retry:false,can_publish:false});
 };
}
