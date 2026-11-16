// An authenticated file action joins one durable native execution. Status reads
// use Supabase directly. Unknown transport outcomes never fall back to n8n.
const origin='https://bnvnmdxosbnuzedokqgh.supabase.co';
const key='sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const operations=new Set(['upload_start','upload_finish','magic_photo','magic_video','review','preview_prepare','account','order_prepare','order_approve']);
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
const fail=(code,extra={})=>{throw Object.assign(Error(code==='AUTH_REQUIRED'?'Bitte melde dich erneut an.':
 code==='FILE_JOB_EXPIRED'?'Der Datei-Auftrag ist abgelaufen. Wähle die Datei erneut aus, um neue Arbeit zu beginnen.':
 code==='FILE_JOB_PENDING'?'Die Verarbeitung läuft weiter. Lade den gespeicherten Status erneut.':
 code==='FILE_JOB_UNCERTAIN'?'Die Rückmeldung wird geprüft. Starte dieselbe Verarbeitung bitte nicht erneut.':
 'Die Dateiverarbeitung ist gerade nicht verfügbar.'),{code,...extra});};
const delay=(ms,signal)=>new Promise((resolve,reject)=>{
 const done=()=>{signal?.removeEventListener('abort',abort);resolve();};
 const timer=setTimeout(done,ms);const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal.reason);};
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
});
export const fileJobAnchor=file=>({kind:'asset',asset_id:file.asset_id||file.id,asset_revision:file.asset_revision||file.revision});

const cancelled=()=>new DOMException('Die Anfrage wurde beendet.','AbortError');
function abortable(promise,signal){
 if(!signal)return promise;
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason);};
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  if(signal.aborted)abort();
 });
}

export function createFileJobClient({session,fetcher=fetch,uuid=()=>crypto.randomUUID(),now=Date.now,wait=delay}){
 const jobs=new Map(),commands=new Map(),controllers=new Set();let epoch=0,commandGeneration=0;
 const guard=context=>{
  context?.signal?.throwIfAborted();
  if(context&&(context.epoch!==epoch||context.binding?.retired))throw cancelled();
 };
 async function auth(owner,context){
  guard(context);const s=await abortable(session(),context?.signal);guard(context);
  const id=s?.user?.id;
  if(typeof s?.access_token!=='string'||!s.access_token||typeof id!=='string'||!id.trim()||id.length>200||owner&&id!==owner)fail('AUTH_REQUIRED');return s;
 }
 async function post(path,body,owner,signal,context){
  const s=await auth(owner,context);signal?.throwIfAborted();
  const r=await abortable(fetcher(origin+path,{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',signal,
   headers:{'Content-Type':'application/json',apikey:key,Authorization:'Bearer '+s.access_token},body:JSON.stringify(body)}),signal);
  guard(context);
  if(!r.ok)fail(r.status===401?'AUTH_REQUIRED':'FILE_JOB_UNAVAILABLE');
  const result=await abortable(r.json(),signal);await auth(owner,context);guard(context);
  if(!record(result)||result.ok!==true)fail(result?.code||'FILE_JOB_UNAVAILABLE');return result;
 }
 async function join(anchor,owner,signal,context){
  if(!record(anchor)||!['asset','upload'].includes(anchor.kind))fail('INVALID_INPUT');
  const cacheKey=owner+'\n'+JSON.stringify(anchor);let job=jobs.get(cacheKey);
  if(job?.view&&Date.parse(job.view.deadline_at)<=now())fail('FILE_JOB_EXPIRED');
  if(!job){
   if(jobs.size>=64){const first=[...jobs.keys()][0];jobs.delete(first);}
   job={requestId:uuid(),view:null};jobs.set(cacheKey,job);
  }
  context.binding=job;guard(context);
  // Each retry keeps this request ID even if the first RPC reply was lost.
  if(!job.view)job.view=await post('/rest/v1/rpc/sma_file_job_v1',{p_action:'start',p_input:{request_id:job.requestId,anchor}},owner,signal,context);
  if(!UUID.test(job.view.job_id)||!Number.isFinite(Date.parse(job.view.deadline_at))||Date.parse(job.view.deadline_at)<=now())fail('FILE_JOB_EXPIRED');
  return job.view;
 }
 async function request({anchor,operation,input,signal,timeoutMs=145000,retryAfter}){
  if(!operations.has(operation)||retryAfter!==undefined&&retryAfter!=='FILE_REFRESH_REQUIRED'&&
     !(operation==='order_prepare'&&retryAfter==='TARGET_CHECK_UNAVAILABLE'))fail('INVALID_INPUT');
  const entryGeneration=commandGeneration;
  const controller=new AbortController();controllers.add(controller);
  const limit=AbortSignal.timeout(timeoutMs),combined=AbortSignal.any([controller.signal,limit,...(signal?[signal]:[])]);
  const context={epoch,signal:combined,binding:null};
  let job,command;
  try{
   const owner=(await auth(undefined,context)).user.id;
   job=await join(anchor,owner,combined,context);
   const identity=job.job_id+'\n'+operation+'\n'+JSON.stringify(input);
   command=commands.get(identity);
   // An explicit target retry may replace only the command that already
   // existed when this call began, never its own newly submitted replacement.
   let retryCommand=retryAfter==='TARGET_CHECK_UNAVAILABLE'&&command?.generation<=entryGeneration?command:null;
   const newCommand=()=>{
    if(commands.size>=256)commands.delete([...commands.keys()][0]);
    const next={id:uuid(),generation:++commandGeneration,submissions:0,acknowledged:false,observed:false,retryableCode:null};
    commands.set(identity,next);return next;
   };
   // A deliberate retry may replace only a confirmed non-work rejection.
   // Unknown transport, pending work and successful results retain their ID.
   if(!command||retryAfter==='FILE_REFRESH_REQUIRED'&&command.retryableCode===retryAfter){
    command=newCommand();
   }
   const submit=async()=>{
    // Mark before transmission. Reconciliation always keeps this command ID;
    // only an authoritative absent receipt permits one bounded resubmission.
    command.submissions++;
    try{
     const accepted=await post('/functions/v1/sma-file-job',{job_id:job.job_id,command_id:command.id,operation,input},owner,combined,context);
     if(accepted.job_id!==job.job_id||!UUID.test(accepted.command_id)||accepted.command_id!==command.id&&!['upload_start','upload_finish'].includes(operation))fail('FILE_JOB_UNAVAILABLE');
     command.id=accepted.command_id;command.acknowledged=true;
    }
    catch(error){guard(context);if(error?.code==='AUTH_REQUIRED')throw error;}
   };
   if(command.submissions===0)await submit();
   for(;;){
    const view=await post('/rest/v1/rpc/sma_file_job_v1',{p_action:'get',p_input:{job_id:job.job_id,command_id:command.id}},owner,combined,context);
    if(view.job_id!==job.job_id||!Array.isArray(view.commands))fail('FILE_JOB_UNAVAILABLE');
    const item=view.commands.find(c=>c.command_id===command.id)||(['upload_start','upload_finish'].includes(operation)&&view.commands.length===1&&view.commands[0].operation===operation?view.commands[0]:null);
    if(item&&UUID.test(item.command_id)){command.id=item.command_id;command.observed=true;}
    if(item?.operation!==operation&&item)fail('FILE_JOB_UNAVAILABLE');
    if(item?.response){
     const r=item.response;
     if(!Number.isInteger(r.status)||r.status<200||r.status>599||!record(r.body))fail('FILE_JOB_UNAVAILABLE');
     await auth(owner,context);guard(context);
     command.retryableCode=r.status===200&&r.body.ok===false&&r.body.code==='FILE_REFRESH_REQUIRED'&&!operation.startsWith('upload_')?'FILE_REFRESH_REQUIRED':null;
     // The public reply can precede the worker's final state. A fresh failed
     // receipt is required before retrying this one non-approving operation.
     if(command===retryCommand&&item.state==='failed'&&r.status===200&&
        r.body.ok===false&&r.body.code==='TARGET_CHECK_UNAVAILABLE'&&
        ['queued','running','waiting'].includes(view.state)&&
        Number.isFinite(Date.parse(view.deadline_at))&&Date.parse(view.deadline_at)>now()){
      const current=commands.get(identity);
      if(!current)fail('FILE_JOB_UNAVAILABLE');
      // Parallel explicit retries share the first replacement. No await may
      // separate this identity check from installing that replacement.
      command=current===retryCommand?newCommand():current;
      retryCommand=null;
      if(command.submissions===0)await submit();
      continue;
     }
     return new Response(JSON.stringify(r.body),{status:r.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    }
    if(['failed','uncertain'].includes(item?.state)||['failed','uncertain','start_uncertain'].includes(view.state))fail('FILE_JOB_UNCERTAIN');
    if(Date.parse(view.deadline_at)<=now()||['expired','finished'].includes(view.state))fail('FILE_JOB_EXPIRED');
    if(view.commands.length===0&&!command.acknowledged&&!command.observed&&command.submissions===1&&
       ['queued','running','waiting'].includes(view.state)&&Number.isFinite(Date.parse(view.deadline_at))){
     await submit();continue;
    }
    await abortable(wait(1000,combined),combined);guard(context);
   }
  }catch(error){
   if(signal?.aborted)throw signal.reason;
   if(limit.aborted)fail('FILE_JOB_PENDING',{jobId:job?.job_id,commandId:command?.id});
   throw error;
  }finally{controllers.delete(controller);}
 }
 async function beginNewWork(anchor,{signal}={}){
  if(!record(anchor)||!['asset','upload'].includes(anchor.kind))fail('INVALID_INPUT');
  const context={epoch,signal:AbortSignal.any([AbortSignal.timeout(10000),...(signal?[signal]:[])])},owner=(await auth(undefined,context)).user.id;
  const cacheKey=owner+'\n'+JSON.stringify(anchor),job=jobs.get(cacheKey);
  const deadline=Date.parse(job?.view?.deadline_at);
  if(!job?.view||!Number.isFinite(deadline)||deadline>now())return false;
  job.retired=true;jobs.delete(cacheKey);
  for(const id of commands.keys())if(id.startsWith(job.view.job_id+'\n'))commands.delete(id);
  return true;
 }
 return {request,beginNewWork,clear(){epoch++;for(const controller of controllers)controller.abort(cancelled());jobs.clear();commands.clear();}};
}
