'use strict';

// One bounded operator-only n8n Public API snapshot. This never invokes a
// webhook, execution, customer action, provider or write endpoint.
// Editor contents may differ from the published graph: fetch the exact
// activeVersionId from n8n's version API, then confirm it remained active.
const {auditPublishedPackageWorker}=require('./audit-published-worker.cjs');
const {summarizeActivePaymentGraph}=require('./diagnose-active-payment-graph.cjs');
const {inspectPaymentWebhookPaths}=require('./inspect-payment-webhook-paths.cjs');
const endpoint='https://johnmusic.app.n8n.cloud/api/v1/workflows/8v2wcz5lh0yUf3sw';
const workflowId='8v2wcz5lh0yUf3sw';
const activeId=/^[A-Za-z0-9_-]{8,128}$/;
const maxBytes=12*1024*1024;
const noGrant={account_assignment_verified:false,drive_folder_access_verified:false,
  mollie_payment_verified:false,real_customer_e2e_verified:false,
  allows_checkout:false,activates_customer:false,billed_n8n_executions_measured:false};

class ReadFailure extends Error{
  constructor(code){super(code);this.code=code;}
}
const fail=code=>{throw new ReadFailure(code);};
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
    timer=setTimeout(()=>{controller.abort();reject(new ReadFailure('N8N_READ_TIMEOUT'));},timeoutMs);
  });
  const bounded=action=>Promise.race([Promise.resolve().then(action),deadline]);

  // One total deadline, including all three response bodies. No response,
  // credential ID, customer data or request key is written to disk or printed.
  async function readJson(url,notFoundCode){
    let reader,response,finished=false;
    try{
      response=await bounded(()=>fetchImpl(url,{
        method:'GET',
        headers:{'X-N8N-API-KEY':apiKey,Accept:'application/json'},
        redirect:'error',cache:'no-store',credentials:'omit',signal:controller.signal
      }));
      if(controller.signal.aborted)fail('N8N_READ_TIMEOUT');
      if(response?.status===401||response?.status===403)fail('N8N_READ_AUTH_REQUIRED');
      if(response?.status===404)fail(notFoundCode);
      if(response?.status!==200||response?.redirected===true||
        (response?.url&&response.url!==url))fail('N8N_READ_UNAVAILABLE');
      if(!/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type')||''))
        fail('N8N_READ_UNEXPECTED_RESPONSE');
      const declared=response.headers.get('content-length');
      if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))
        fail('N8N_READ_UNEXPECTED_RESPONSE');
      reader=response.body?.getReader();
      if(!reader)fail('N8N_READ_UNEXPECTED_RESPONSE');
      const chunks=[];let total=0;
      while(true){
        const part=await bounded(()=>reader.read());
        if(part.done){finished=true;break;}
        if(!(part.value instanceof Uint8Array))fail('N8N_READ_UNEXPECTED_RESPONSE');
        total+=part.value.byteLength;
        if(total>maxBytes)fail('N8N_READ_UNEXPECTED_RESPONSE');
        chunks.push(part.value);
      }
      const enc=response.headers.get('content-encoding');
      if(declared!==null&&(!enc||enc==='identity')&&Number(declared)!==total)
        fail('N8N_READ_UNEXPECTED_RESPONSE');
      try{
        const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,total)));
        if(parsed===null||typeof parsed!=='object'||Array.isArray(parsed))
          fail('N8N_READ_UNEXPECTED_RESPONSE');
        return parsed;
      }catch(error){
        if(error instanceof ReadFailure)throw error;
        fail('N8N_READ_UNEXPECTED_RESPONSE');
      }
    }finally{
      if(reader){
        if(!finished)try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}
        try{reader.releaseLock();}catch{}
      }else if(response?.body){
        try{Promise.resolve(response.body.cancel()).catch(()=>{});}catch{}
      }
    }
  }

  try{
    const current=await readJson(endpoint,'N8N_WORKFLOW_NOT_FOUND');
    if(current.id!==workflowId)fail('N8N_WORKFLOW_ID_MISMATCH');
    if(current.isArchived===true)fail('N8N_WORKFLOW_ARCHIVED');
    const versionId=current.activeVersionId;
    if(typeof versionId!=='string'||!activeId.test(versionId))
      fail('N8N_PUBLISHED_VERSION_NOT_VERIFIED');

    // Always use the n8n workflow-version endpoint, even when the latest
    // editor version happens to share the published version ID.
    const versionUrl=endpoint+'/versions/'+encodeURIComponent(versionId);
    const published=await readJson(versionUrl,'N8N_ACTIVE_VERSION_UNAVAILABLE');
    if(published.workflowId!==workflowId||published.versionId!==versionId||
      !Array.isArray(published.nodes)||published.connections===null||
      typeof published.connections!=='object'||Array.isArray(published.connections))
      fail('N8N_ACTIVE_VERSION_MISMATCH');
    // Build the offline auditor's envelope using the independently attested
    // activeVersionId and exact fetched version, not the editor's live draft.
    const report=auditPublishedPackageWorker({
      active:true,activeVersionId:versionId,versionId,
      nodes:published.nodes,connections:published.connections
    });
    // Even a mismatch must be bound to a stable PUBLISHED version. Never
    // interpret a stale snapshot as evidence about the current active graph.
    const after=await readJson(endpoint,'N8N_WORKFLOW_NOT_FOUND');
    if(after.id!==workflowId||after.isArchived===true||
      after.activeVersionId!==versionId)fail('N8N_PUBLISHED_VERSION_CHANGED_DURING_AUDIT');
    if(!report.ok){
      const trace=inspectPaymentWebhookPaths({
        nodes:published.nodes,connections:published.connections
      });
      return {...report,scope:'n8n_public_api_live_readonly',
        diagnostic:summarizeActivePaymentGraph(published.nodes),
        path_trace:{...trace,active_version_stability_verified:true},
        published_version_stability_rechecked:true,
        checked_at:new Date().toISOString(),...noGrant};
    }
    return {...report,scope:'n8n_public_api_live_readonly',
      checked_at:new Date().toISOString(),...noGrant};
  }catch(error){
    return failure(error instanceof ReadFailure?error.code:'N8N_READ_UNAVAILABLE');
  }finally{
    clearTimeout(timer);controller.abort();
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
