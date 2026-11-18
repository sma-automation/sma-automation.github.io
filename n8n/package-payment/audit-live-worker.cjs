'use strict';

// Read-only operator check of the published payment workflow. Uses the official
// n8n GET workflow API, never an execution endpoint or a payment webhook.
// The workflow JSON and credential references are kept in memory only.
const {auditPublishedPackageWorker}=require('./audit-published-worker.cjs');
const endpoint='https://johnmusic.app.n8n.cloud/api/v1/workflows/8v2wcz5lh0yUf3sw';
const workflowId='8v2wcz5lh0yUf3sw';
const maxBytes=12*1024*1024;
const noGrant={account_assignment_verified:false,drive_folder_access_verified:false,
  mollie_payment_verified:false,real_customer_e2e_verified:false,
  allows_checkout:false,activates_customer:false,billed_n8n_executions_measured:false};

function failure(issue){
  return {ok:false,status:'PUBLISHED_PAYMENT_CONTRACT_REVIEW_REQUIRED',
    scope:'n8n_public_api_live_readonly',issues:[issue],...noGrant};
}
function checkConfiguration(apiKey,fetchImpl,timeoutMs){
  if(typeof apiKey!=='string'||apiKey.length<1||apiKey.length>8192||
    !/^[A-Za-z0-9._~+/-]+=*$/.test(apiKey))return 'N8N_READ_API_KEY_REQUIRED';
  if(typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)
    return 'N8N_READ_CONFIGURATION_INVALID';
  return null;
}
async function inspectLivePaymentWorker({
  apiKey=process.env.SMA_N8N_READ_API_KEY,fetchImpl=globalThis.fetch,timeoutMs=12000
}={}){
  const invalid=checkConfiguration(apiKey,fetchImpl,timeoutMs);
  if(invalid)return failure(invalid);
  const controller=new AbortController();
  let timer;
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      controller.abort();
      reject(Error('N8N_READ_TIMEOUT'));
    },timeoutMs);
  });
  const bounded=action=>Promise.race([Promise.resolve().then(action),deadline]);
  let reader,response,done=false;
  try{
    response=await bounded(()=>fetchImpl(endpoint,{
      method:'GET',
      headers:{'X-N8N-API-KEY':apiKey,Accept:'application/json'},
      redirect:'error',cache:'no-store',credentials:'omit',signal:controller.signal
    }));
    if(controller.signal.aborted)return failure('N8N_READ_TIMEOUT');
    if(response?.status===401||response?.status===403)return failure('N8N_READ_AUTH_REQUIRED');
    if(response?.status===404)return failure('N8N_WORKFLOW_NOT_FOUND');
    if(response?.status!==200||response?.redirected===true||
      (response?.url&&response.url!==endpoint))return failure('N8N_READ_UNAVAILABLE');
    if(!/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type')||''))
      return failure('N8N_READ_UNEXPECTED_RESPONSE');
    const declared=response.headers.get('content-length');
    if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))
      return failure('N8N_READ_UNEXPECTED_RESPONSE');

    reader=response.body?.getReader();
    if(!reader)return failure('N8N_READ_UNEXPECTED_RESPONSE');
    const chunks=[];let count=0;
    while(true){
      const part=await bounded(()=>reader.read());
      if(part.done){done=true;break;}
      if(!(part.value instanceof Uint8Array))return failure('N8N_READ_UNEXPECTED_RESPONSE');
      count+=part.value.byteLength;
      if(count>maxBytes)return failure('N8N_READ_UNEXPECTED_RESPONSE');
      chunks.push(part.value);
    }
    const decoded=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,count));
    let data;
    try{data=JSON.parse(decoded);}catch{return failure('N8N_READ_UNEXPECTED_RESPONSE');}
    // An unrelated workflow, draft-only version, or missing publication metadata
    // must never be presented as the n8n active payment graph.
    if(!data||data.id!==workflowId)return failure('N8N_WORKFLOW_ID_MISMATCH');
    if(!data.activeVersionId)return failure('N8N_PUBLISHED_VERSION_NOT_VERIFIED');
    // The public API can return a newer mutable editor draft. The existing
    // contract checker only accepts a proven activeVersion or matching versions.
    const report=auditPublishedPackageWorker(data);
    return {...report,scope:'n8n_public_api_live_readonly',
      ...(report.ok?{checked_at:new Date().toISOString()}:{}),...noGrant};
  }catch(error){
    return failure(controller.signal.aborted||error?.message==='N8N_READ_TIMEOUT'?
      'N8N_READ_TIMEOUT':'N8N_READ_UNAVAILABLE');
  }finally{
    clearTimeout(timer);controller.abort();
    if(reader){
      // Never wait indefinitely for a transport which ignores cancellation.
      if(!done)try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}
      try{reader.releaseLock();}catch{}
    }else if(response?.body){
      try{Promise.resolve(response.body.cancel()).catch(()=>{});}catch{}
    }
  }
}
module.exports={inspectLivePaymentWorker};
if(require.main===module){
  inspectLivePaymentWorker().then(report=>{
    process.stdout.write(JSON.stringify(report)+'\n');
    if(!report.ok)process.exitCode=1;
  }).catch(()=>{
    process.stdout.write(JSON.stringify(failure('N8N_READ_UNAVAILABLE'))+'\n');
    process.exitCode=1;
  });
}
