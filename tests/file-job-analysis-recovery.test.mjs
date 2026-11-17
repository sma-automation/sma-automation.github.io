import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';

const sourceURL=name=>process.env.SMA_ANALYSIS_RECOVERY_SOURCE_ROOT
 ?pathToFileURL(resolve(process.env.SMA_ANALYSIS_RECOVERY_SOURCE_ROOT,'app/assets',name))
 :new URL('../app/assets/'+name,import.meta.url);
const source=await readFile(sourceURL('publication-preview.js'),'utf8');
const {createFileJobClient,fileJobAnchor}=await import(sourceURL('file-job-client.mjs').href);
const part=(start,end)=>{
 const from=source.indexOf(start),to=source.indexOf(end,from);
 assert.ok(from>=0&&to>from,'Actual UI function boundaries must still exist');
 return source.slice(from,to);
};
const id=n=>'ac880000-0000-4000-8000-'+String(n).padStart(12,'0');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const operations=['magic_photo','magic_video','review'];

// Execute the actual UI functions and file-job client. Only DOM elements,
// authentication and transports are synthetic; no external service is called.
function fixture(t,operation,{plan=['failed','completed']}={}){
 const kind=operation==='magic_video'?'video':'image',key=operation==='review'?'review':'analysis';
 const policy=operation==='review'?'visual-2026-11-01.1':kind==='video'?'magic-video-2026-11-03.1':'magic-photo-2026-11-02.1';
 const rpcName=operation==='review'?'sma_publication_review_v1':kind==='video'?'sma_publication_video_magic_v1':'sma_publication_magic_v1';
 const file={id:id(2),revision:'sha256:'+'a'.repeat(64)+':1',media_kind:kind,name:'Synthetic media',
  mime_type:kind==='video'?'video/mp4':'image/jpeg',size_bytes:1000,duration_ms:5000};
 const input={asset_id:file.id,asset_revision:file.revision};
 const summary={...input,policy_version:policy,can_publish:false,result:null,finished_at:null,error_code:null};
 const empty={...summary,status:operation==='review'?'unreviewed':'unrecognized'};
 const processing={...summary,status:'processing'};
 const failed={...summary,status:'failed',finished_at:new Date().toISOString(),
  error_code:operation==='review'?'PROVIDER_FAILED':kind==='video'?'VIDEO_RECOGNITION_FAILED':'MODEL_FAILED'};
 const recognized='Recognized synthetic content for the same unchanged customer file.';
 const result=operation==='review'?{can_publish:false,outcome:'clear',categories:[],frames_checked:1,sampling_ms:0}:
  {policy_version:policy,can_publish:false,requires_confirmation:true,subject_type:'product',
   description:'A synthetic product in a controlled fixture.',source_text:recognized,uncertainties:[],
   ...(kind==='video'?{content_comparison:'model_checked_sampled_evidence',audio_status:'no_audio_stream',evidence:{source_sha256:'a'.repeat(64)}}:{})};
 const completed={...summary,status:'completed',finished_at:new Date().toISOString(),result};
 let business=empty,sequence=10,freshReadError=false,freshReadGate=null;
 const calls=[],uiReads=[],refreshes=[],receipts=new Map(),elements=new Map(),handlers=new Map(),messages=[];
 const job={ok:true,job_id:id(3),state:'waiting',deadline_at:new Date(Date.now()+86400000).toISOString()};
 const session=async()=>({user:{id:id(1)},access_token:'synthetic-session'});
 const fileJobs=createFileJobClient({session,uuid:()=>id(++sequence),
  wait:async()=>{throw Error('Synthetic pending receipt');},
  fetcher:async(url,options)=>{
   const body=JSON.parse(options.body),path=new URL(url).pathname;calls.push({path,body});
   if(path==='/rest/v1/rpc/sma_file_job_v1'){
    if(body.p_action==='start')return Response.json({...job,commands:[]});
    assert.equal(body.p_action,'get');
    return Response.json({...job,commands:[receipts.get(body.p_input.command_id)].filter(Boolean)});
   }
   if(path==='/rest/v1/rpc/'+rpcName){
    assert.deepEqual(body,{p_action:'get',p_input:input});
    if(freshReadGate){const gate=freshReadGate;freshReadGate=null;gate.started.resolve();await gate.release.promise;}
    if(freshReadError)throw Error('Synthetic result read unavailable');
    return Response.json({ok:true,[key]:business});
   }
   assert.equal(path,'/functions/v1/sma-file-job');
   assert.equal(body.operation,operation,'Recovery cannot publish, upload or run an unrelated operation');
   assert.deepEqual(body.input,input);assert.equal(body.job_id,job.job_id);
   assert.equal(receipts.has(body.command_id),false,'A delivered command must not be retransmitted');
   const outcome=plan[receipts.size]||'failed';
   if(outcome==='failed'||outcome==='completed')business=outcome==='completed'?completed:failed;
   receipts.set(body.command_id,{command_id:body.command_id,operation,
    state:outcome==='completed'?'completed':'failed',
    response:{status:200,body:outcome==='failed'||outcome==='completed'?{ok:true,[key]:processing}:{ok:false,code:outcome}}});
   return Response.json({ok:true,job_id:job.job_id,command_id:body.command_id});
  }});
 const $=name=>{
  if(!elements.has(name))elements.set(name,{value:'',textContent:'',hidden:false,disabled:false,
   addEventListener:(event,handler)=>handlers.set(name+':'+event,handler),scrollIntoView(){},focus(){}});
  return elements.get(name);
 };
 const originalSource='Unsaved customer description must survive a status check and recognition retry.';
 $('source_text').value=originalSource;$('youtube-body').value='Saved post text stays unchanged.';
 const scope={signedOut:false,busy:false,selectedAsset:file,selectedPortal:'youtube',magicState:empty,
  reviewStatus:'unreviewed',magicLoadTicket:0,magicPreparationError:null,automaticMode:null,pendingAutomatic:null,
  automaticInputSignature:null,workspace:null,fileJobs,fileJobAnchor,session,$,messages:{},
  magicPhotoHint:()=>'',magicActionHint:()=>'',syncMagicActions:()=>{},syncMedia:()=>{},
  hasSourceEdits:()=>true,hasDraftEdits:()=>false,sourceInput:()=>({source_text:$('source_text').value}),
  getDraftProduct:async()=>null,generatePreview:async()=>{scope.generated++;},generated:0,
  fileContext:()=>({...input,platform:'youtube',assignment_revision:1}),
  assertFileContext:context=>{assert.equal(scope.selectedAsset?.id,context.asset_id);assert.equal(scope.selectedAsset?.revision,context.asset_revision);},
  ensureFreshFile:async(context,force=false)=>{refreshes.push({context,force});},
  status:message=>messages.push(message),errorText:response=>response?.code||'Unknown synthetic result',
  loadMediaCheck:async()=>{},setTimeout:handler=>{queueMicrotask(handler);return 1;},
  supabase:{rpc:async(name,args)=>{
   assert.equal(name,rpcName);assert.equal(args.p_action,'get');assert.deepEqual({...args.p_input},input);
   uiReads.push(args);return {data:{ok:true,[key]:business}};
  }}};
 scope.lock=value=>{scope.busy=value;scope.syncMagicButton?.();scope.syncReviewButton?.();};
 scope.resetMagic=()=>{scope.magicState=null;scope.magicLoadTicket++;};
 vm.createContext(scope);
 vm.runInContext(part('async function withFreshFile(','\nfunction fileChanged('),scope);
 if(operation==='review'){
  vm.runInContext(part('function syncReviewButton(){','\nconst orderUuid='),scope);
 }else{
  vm.runInContext(part('function magicHint(','\n$(\'applyMagic\').addEventListener')+'\n'+
   part('async function runMagicAction(','\nasync function refreshFiles('),scope);
 }
 const action=()=>handlers.get((operation==='review'?'reviewContent':'recognizePhoto')+':click')();
 const edges=()=>calls.filter(call=>call.path==='/functions/v1/sma-file-job');
 t.after(()=>{
  fileJobs.clear();
  assert.ok(edges().every(call=>call.body.operation===operation));
 });
 return {scope,$,file,input,job,receipts,calls,uiReads,refreshes,action,edges,originalSource,recognized,messages,
  status:()=>operation==='review'?scope.reviewStatus:scope.magicState?.status,
  starts:()=>calls.filter(call=>call.body.p_action==='start'),
  setBusiness:status=>{business=status==='completed'?completed:status==='processing'?processing:status==='failed'?failed:empty;},
  first:()=>receipts.values().next().value,
  freshReadError:()=>{freshReadError=true;},
  holdFreshRead:()=>{const gate={started:deferred(),release:deferred()};freshReadGate=gate;return gate;},
  signOut:()=>{scope.signedOut=true;scope.selectedAsset=null;fileJobs.clear();}};
}

for(const operation of operations)test(`${operation}: explicit retry recovers a confirmed processing failure in the existing file job`,async t=>{
 const f=fixture(t,operation);await f.action();
 assert.equal(f.status(),'failed');assert.equal(f.edges().length,1);
 const original=structuredClone(f.first());
 await f.action();
 assert.equal(f.status(),'completed');assert.equal(f.edges().length,2);
 assert.equal(f.starts().length,1);
 const [first,second]=f.edges().map(call=>call.body);
 assert.equal(second.job_id,first.job_id);assert.deepEqual(second.input,first.input);
 assert.notEqual(second.command_id,first.command_id);
 assert.deepEqual(f.receipts.get(first.command_id),original,'The first processing response remains immutable');
 assert.equal(f.$('source_text').value,f.originalSource);
 assert.equal(f.$('youtube-body').value,'Saved post text stays unchanged.');
 assert.equal(f.scope.busy,false);
});

for(const operation of operations){
 const prefix=operation==='review'?'REVIEW':'MAGIC';
 for(const code of [prefix+'_RATE_LIMITED',prefix+'_RUNNING'])test(`${operation}: a later explicit attempt can recover after ${code} without an automatic loop`,async t=>{
  const f=fixture(t,operation,{plan:['failed',code,'completed']});await f.action();
  await f.action();assert.equal(f.edges().length,2);assert.notEqual(f.status(),'completed');
  assert.equal(f.$('source_text').value,f.originalSource);
  await f.action();assert.equal(f.status(),'completed');assert.equal(f.edges().length,3);
  assert.equal(f.starts().length,1);
  assert.equal(new Set(f.edges().map(call=>call.body.command_id)).size,3);
 });
}

for(const operation of operations)test(`${operation}: an already completed current result is read without another worker`,async t=>{
 const f=fixture(t,operation);await f.action();f.setBusiness('completed');
 await f.action();assert.equal(f.status(),'completed');assert.equal(f.edges().length,1);
 assert.equal(f.$('source_text').value,f.originalSource);assert.equal(f.starts().length,1);
});

for(const operation of operations)test(`${operation}: another active result is only observed and never restarted`,async t=>{
 const f=fixture(t,operation);await f.action();f.setBusiness('processing');
 await f.action();assert.equal(f.status(),'processing');assert.equal(f.edges().length,1);
 assert.equal(f.$('source_text').value,f.originalSource);assert.equal(f.starts().length,1);
});

test('review refreshes one confirmed stale-file rejection and completes in the same file job',async t=>{
 const f=fixture(t,'review',{plan:['FILE_REFRESH_REQUIRED','completed']});
 await f.action();assert.equal(f.status(),'completed');assert.equal(f.edges().length,2);
 assert.equal(f.refreshes.filter(item=>item.force).length,1);assert.equal(f.starts().length,1);
 assert.equal(f.$('source_text').value,f.originalSource);
});

test('a repeated review freshness rejection stops after its single bounded refresh',async t=>{
 const f=fixture(t,'review',{plan:['FILE_REFRESH_REQUIRED','FILE_REFRESH_REQUIRED','completed']});
 await f.action();assert.equal(f.edges().length,2);assert.notEqual(f.status(),'completed');
 assert.equal(f.refreshes.filter(item=>item.force).length,1);assert.equal(f.scope.busy,false);
 assert.equal(f.$('source_text').value,f.originalSource);
});

for(const operation of operations)test(`${operation}: an unavailable fresh result cannot restart the failed worker`,async t=>{
 const f=fixture(t,operation);await f.action();f.freshReadError();
 await f.action();assert.equal(f.edges().length,1);assert.notEqual(f.status(),'completed');
 assert.equal(f.$('source_text').value,f.originalSource);assert.equal(f.scope.busy,false);
});

for(const state of ['running','uncertain'])test(`an expired business lease with a ${state} native command does not permit another analysis`,async t=>{
 const f=fixture(t,'magic_video');await f.action();f.first().state=state;
 await f.action();assert.equal(f.edges().length,1);assert.equal(f.status(),'failed');
});

for(const operation of ['magic_photo','magic_video']){
 test(`${operation}: background loading and a default status continuation cannot retry failed work`,async t=>{
  const f=fixture(t,operation);await f.action();
  await f.scope.loadMagicEffect(false);await f.scope.loadMagicEffect(true);
  await f.scope.recognizePhoto();
  assert.equal(f.edges().length,1);assert.equal(f.status(),'failed');
  assert.equal(f.$('source_text').value,f.originalSource);
 });
 test(`${operation}: the explicit Magic action can recover before applying its confirmed description`,async t=>{
  const f=fixture(t,operation);await f.action();
  await f.scope.runMagicAction('source',true);
  assert.equal(f.status(),'completed');assert.equal(f.edges().length,2);assert.equal(f.starts().length,1);
  assert.equal(f.$('source_text').value,f.recognized);
  assert.equal(f.$('youtube-body').value,'Saved post text stays unchanged.');
 });
}

test('a double click while the fresh result is being read shares one deliberate photo retry',async t=>{
 const f=fixture(t,'magic_photo');await f.action();
 const gate=f.holdFreshRead(),pending=f.action();await gate.started.promise;
 await f.action();assert.equal(f.edges().length,1);assert.equal(f.scope.busy,true);
 gate.release.resolve();await pending;
 assert.equal(f.status(),'completed');assert.equal(f.edges().length,2);assert.equal(f.starts().length,1);
});

test('logout during a fresh review read prevents a later worker restart',async t=>{
 const f=fixture(t,'review');await f.action();
 const gate=f.holdFreshRead(),pending=f.action();await gate.started.promise;
 f.signOut();gate.release.resolve();await pending;
 assert.equal(f.edges().length,1);assert.equal(f.$('source_text').value,f.originalSource);
});
