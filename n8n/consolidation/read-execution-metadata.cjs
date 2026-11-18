'use strict';

// Operator-only sample of SAVED n8n execution metadata. This does not run
// workflows, read their item data, call webhooks, or assert billable usage.
const endpoint='https://johnmusic.app.n8n.cloud/api/v1/executions';
const maxResponseBytes=2*1024*1024;
const maxCursorLength=2048;
const validKey=/^[A-Za-z0-9._~+/-]+=*$/;
const validCursor=/^[A-Za-z0-9_+/=-]+$/;
const modeNames=new Set(['manual','trigger','webhook','error','integrated','internal','retry','cli','evaluation']);
const statusNames=new Set(['success','error','waiting','running','new','canceled','crashed','unknown']);
const noGrant=Object.freeze({
  billed_n8n_executions_measured:false,per_file_cost_measured:false,
  real_customer_e2e_verified:false,allows_execution:false,
  allows_checkout:false,allows_publication:false
});
class AuditError extends Error {constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new AuditError(code);};
function resultError(code){
  return {ok:false,status:'SAVED_EXECUTION_SNAPSHOT_UNAVAILABLE',
    scope:'n8n_execution_metadata_readonly',issue:code,...noGrant};
}
const isUtcTime=s=>typeof s==='string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0,10)===s.slice(0,10);
function firstOfUtcMonth(now=new Date()){
  return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString();
}
function tally(map,key){map.set(key,(map.get(key)||0)+1);}
function asObject(map){
  return Object.fromEntries([...map.entries()].sort(([a],[b])=>a.localeCompare(b)));
}
function checkInputs({apiKey,fetchImpl,sinceUtc,untilUtc,maxPages,timeoutMs}){
  if(typeof apiKey!=='string'||!apiKey||apiKey.length>8192||!validKey.test(apiKey))
    return 'N8N_READ_API_KEY_REQUIRED';
  if(typeof fetchImpl!=='function'||!Number.isInteger(maxPages)||maxPages<1||maxPages>40||
    !Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)
    return 'N8N_READ_CONFIGURATION_INVALID';
  if(!isUtcTime(sinceUtc)||!isUtcTime(untilUtc)||Date.parse(sinceUtc)>=Date.parse(untilUtc))
    return 'N8N_READ_WINDOW_INVALID';
  return null;
}
async function inspectSavedExecutionMetadata({
  apiKey=process.env.SMA_N8N_READ_API_KEY,
  fetchImpl=globalThis.fetch,
  sinceUtc=firstOfUtcMonth(),
  untilUtc=new Date().toISOString(),
  maxPages=10,
  timeoutMs=15000
}={}){
  const invalid=checkInputs({apiKey,fetchImpl,sinceUtc,untilUtc,maxPages,timeoutMs});
  if(invalid)return resultError(invalid);
  const controller=new AbortController();
  let timer;
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(new AuditError('N8N_READ_TIMEOUT'));},timeoutMs);
  });
  const bounded=fn=>Promise.race([Promise.resolve().then(fn),deadline]);
  async function readJson(url){
    let response,reader,finished=false;
    try{
      response=await bounded(()=>fetchImpl(url,{
        method:'GET',headers:{'X-N8N-API-KEY':apiKey,Accept:'application/json'},
        redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal
      }));
      if(controller.signal.aborted)fail('N8N_READ_TIMEOUT');
      if(response?.status===401||response?.status===403)fail('N8N_READ_AUTH_REQUIRED');
      if(response?.status!==200||response?.redirected===true||
        (response?.url&&response.url!==url))fail('N8N_READ_UNAVAILABLE');
      if(!/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type')||''))
        fail('N8N_READ_UNEXPECTED_RESPONSE');
      const declared=response.headers.get('content-length');
      if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxResponseBytes))
        fail('N8N_READ_UNEXPECTED_RESPONSE');
      reader=response.body?.getReader();
      if(!reader)fail('N8N_READ_UNEXPECTED_RESPONSE');
      const parts=[];let bytes=0;
      while(true){
        const next=await bounded(()=>reader.read());
        if(next.done){finished=true;break;}
        if(!(next.value instanceof Uint8Array))fail('N8N_READ_UNEXPECTED_RESPONSE');
        bytes+=next.value.byteLength;
        if(bytes>maxResponseBytes)fail('N8N_READ_UNEXPECTED_RESPONSE');
        parts.push(next.value);
      }
      const encoding=response.headers.get('content-encoding');
      if(declared!==null&&(!encoding||encoding==='identity')&&Number(declared)!==bytes)
        fail('N8N_READ_UNEXPECTED_RESPONSE');
      try{
        const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts,bytes)));
        if(!data||typeof data!=='object'||Array.isArray(data))
          fail('N8N_READ_UNEXPECTED_RESPONSE');
        return data;
      }catch(error){
        if(error instanceof AuditError)throw error;
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
    const modes=new Map(),statuses=new Map(),workflows=new Map(),ids=new Set(),cursors=new Set();
    let pagesRead=0,recordsSeen=0,withinWindow=0,undated=0,productionCandidates=0,nextCursor=null;
    for(;pagesRead<maxPages;){
      const url=new URL(endpoint);
      url.searchParams.set('limit','100');
      url.searchParams.set('includeData','false');
      if(nextCursor)url.searchParams.set('cursor',nextCursor);
      const payload=await readJson(url.href);
      if(!Array.isArray(payload.data)||payload.data.length>100)
        fail('N8N_READ_UNEXPECTED_RESPONSE');
      for(const entry of payload.data){
        if(!entry||typeof entry!=='object'||Array.isArray(entry))
          fail('N8N_READ_UNEXPECTED_RESPONSE');
        const id=String(entry.id??'');
        if(!/^\d{1,32}$/.test(id)||ids.has(id))fail('N8N_READ_INCONSISTENT_PAGES');
        ids.add(id);recordsSeen++;
        if(entry.startedAt===null||entry.startedAt===undefined){undated++;continue;}
        if(!isUtcTime(entry.startedAt))fail('N8N_READ_UNEXPECTED_RESPONSE');
        if(Date.parse(entry.startedAt)<Date.parse(sinceUtc)||
           Date.parse(entry.startedAt)>=Date.parse(untilUtc))continue;
        withinWindow++;
        const mode=modeNames.has(entry.mode)?entry.mode:'other';
        const status=statusNames.has(entry.status)?entry.status:'other';
        tally(modes,mode);tally(statuses,status);
        if(mode==='webhook'||mode==='trigger')productionCandidates++;
        // Workflow IDs are machine references, not customer or execution records.
        const workflow=typeof entry.workflowId==='string'&&
          /^[A-Za-z0-9_-]{1,128}$/.test(entry.workflowId)?entry.workflowId:'unidentified';
        tally(workflows,workflow);
      }
      pagesRead++;
      const cursor=payload.nextCursor;
      if(cursor===null||cursor===undefined){nextCursor=null;break;}
      if(typeof cursor!=='string'||cursor.length>maxCursorLength||
         !validCursor.test(cursor)||cursors.has(cursor))
        fail('N8N_READ_INCONSISTENT_PAGES');
      cursors.add(cursor);nextCursor=cursor;
    }
    return {ok:true,
      status:nextCursor?'SAVED_EXECUTION_PARTIAL_SNAPSHOT_NOT_BILLING':'SAVED_EXECUTION_SNAPSHOT_NOT_BILLING',
      scope:'n8n_execution_metadata_readonly',checked_at:new Date().toISOString(),
      since_utc:sinceUtc,until_utc_exclusive:untilUtc,
      pages_read:pagesRead,records_seen:recordsSeen,records_in_window:withinWindow,
      records_without_start_time:undated,more_saved_pages_available:nextCursor!==null,
      production_mode_candidates:productionCandidates,
      by_mode:asObject(modes),by_status:asObject(statuses),
      by_workflow:asObject(workflows),
      history_retention_and_deleted_executions_not_verified:true,
      note:'Saved execution metadata is not the n8n Cloud billing counter; correlate one permitted file E2E and the cloud usage display separately.',
      ...noGrant};
  }catch(error){
    return resultError(error instanceof AuditError?error.code:'N8N_READ_UNAVAILABLE');
  }finally{
    clearTimeout(timer);controller.abort();
  }
}
module.exports={inspectSavedExecutionMetadata,firstOfUtcMonth};
if(require.main===module){
  const args=process.argv.slice(2);
  const opts={};
  if(args.length===2){opts.sinceUtc=args[0];opts.untilUtc=args[1];}
  else if(args.length)opts.sinceUtc='invalid';
  inspectSavedExecutionMetadata(opts).then(report=>{
    process.stdout.write(JSON.stringify(report)+'\n');
    if(!report.ok)process.exitCode=1;
  }).catch(()=>{
    process.stdout.write(JSON.stringify(resultError('N8N_READ_UNAVAILABLE'))+'\n');
    process.exitCode=1;
  });
}
