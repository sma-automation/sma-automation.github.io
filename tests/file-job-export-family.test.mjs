// Repository PostgreSQL contracts in a disposable local database. No HTTP,
// real upload, provider permission, payment or customer record is involved.
import assert from 'node:assert/strict';
import test from 'node:test';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import {fileFamilyUUID as uuid,fileFamilyOwner as owner,fileFamilyOther as other,fileFamilySource as source,
 installFileFamilyBaseline} from './sql-runtime/file-job-family-fixture.mjs';

const sourceHash='a'.repeat(64);
const baseline=process.env.SMA_EXPORT_FAMILY_BASELINE==='1';
const settings={format:'original',fit:'contain',position_x:50,position_y:50,start_ms:0,end_ms:null,
 cover_ms:500,overlay_text:'',overlay_position:'bottom',audio_volume:100};

await test('file export family uses one native parent and keeps independent upload contracts',async t=>{
 const db=new PGlite();let counter,tick,phases,patch,businessBefore;
 const next=()=>uuid(++counter);
 const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0]?.v;
 const asRole=async(role,fn)=>{
  await db.exec('set role '+role);
  try{return await fn();}finally{await db.exec('reset role');}
 };
 async function authenticated(name,args,uid=owner){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
  return asRole('authenticated',()=>value('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args));
 }
 const user=(action,input,uid=owner)=>authenticated('sma_file_job_v1',[action,input],uid);
 const worker=(action,input)=>asRole('service_role',()=>value('select public.sma_file_job_worker_v1($1,$2) v',[action,input]));
 const business=(name,args)=>asRole('service_role',()=>value('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args));
 const assetAnchor=file=>({kind:'asset',asset_id:file.id,asset_revision:file.revision});
 const uploadAnchor=artifact=>({kind:'upload',upload_id:artifact.upload_id,name:artifact.name,
  mime_type:artifact.mime_type,size_bytes:artifact.size_bytes});
 const uploadInput=artifact=>{const {kind,...input}=uploadAnchor(artifact);return input;};
 const familyColumns=`jsonb_build_object('anchor',anchor,'anchor_key',anchor_key,'asset_id',asset_id,
  'asset_revision',asset_revision,'upload_id',upload_id,'created_at',created_at,'deadline_at',deadline_at,'execution_id',execution_id)`;
 const identity=job=>value('select '+familyColumns+' v from sma_private.file_jobs_v1 where id=$1',[job.job_id]);
 const count=table=>value('select count(*)::int v from sma_private.'+table);
 const denied=result=>assert.equal(result.ok,false,JSON.stringify(result));
 async function file(kind='video',uid=owner,customer=1){
  const id=next(),revision='sha256:'+sourceHash+':1';
  await db.query(`insert into sma_private.publication_files_v1
   (id,user_id,customer_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,width_px,height_px,duration_ms)
   values($1,$2,$3,$4,$5,$6,$7,$8,now(),2048,320,240,$9)`,
   [id,uid,customer,'synthetic_source_'+counter,'Synthetic source.'+(kind==='video'?'mp4':'png'),kind,
    kind==='video'?'video/mp4':'image/png',revision,kind==='video'?10000:null]);
  return {id,revision,kind};
 }
 async function start(anchor,requestId=next(),uid=owner){
  const result=await user('start',{request_id:requestId,anchor},uid);
  assert.equal(result.ok,true,JSON.stringify(result));
  return {...result,request_id:requestId,anchor};
 }
 async function bind(job){
  const claimed=await worker('claim_start',{job_id:job.job_id});
  assert.ok(claimed.start,JSON.stringify(claimed));
  job.execution_id='family_parent_'+ ++counter;job.start_ticket=claimed.start.start_ticket;
  assert.equal((await worker('bind',{job_id:job.job_id,start_ticket:job.start_ticket,execution_id:job.execution_id})).already_bound,false);
 }
 async function enqueue(job,operation,input,commandId=next()){
  const request={job_id:job.job_id,command_id:commandId,operation,input};
  const result=await user('command',request);assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.commands.length,1);
  return {request,command_id:result.commands[0].command_id};
 }
 async function claim(job,command){
  const phase=(phases.get(job.job_id)||0)+1;
  const waiting=await worker('wait',{job_id:job.job_id,execution_id:job.execution_id,phase_seq:phase,
   resume_url:'https://johnmusic.app.n8n.cloud/webhook-waiting/'+job.execution_id+'/file-command-'+phase+'?signature=synthetic_signature_value'});
  assert.equal(waiting.ok,true,JSON.stringify(waiting));let accepted;
  if(waiting.wait===false){accepted=waiting.dispatch;phases.set(job.job_id,waiting.phase_seq);}
  else{
   phases.set(job.job_id,phase);const {delivery}=await worker('claim_delivery',{job_id:job.job_id});
   assert.equal(delivery.event_id,command.command_id);
   accepted=await worker('accept',{job_id:job.job_id,event_id:delivery.event_id,phase_seq:phase,
    execution_id:job.execution_id,ticket:delivery.ticket});
  }
  assert.equal(accepted.command_id,command.command_id);assert.ok(accepted.command_ticket);
  const input={job_id:job.job_id,command_id:command.command_id,command_ticket:accepted.command_ticket,
   parent_execution_id:job.execution_id,child_execution_id:'family_child_'+ ++counter};
  const context=await worker('claim',input);assert.equal(context.ok,true,JSON.stringify(context));
  const {parent_execution_id,...key}=input;return {key,context};
 }
 async function run(job,operation,input){
  const command=await enqueue(job,operation,input),c=await claim(job,command);
  assert.equal(c.context.operation,operation);assert.deepEqual(c.context.input,input);
  return {...c,command,reservation:await worker('reserve',c.key)};
 }
 async function finish(command,body,outcome='completed'){
  assert.equal((await worker('result',{...command.key,status:200,body})).ok,true);
  assert.equal((await worker('completed',{...command.key,outcome})).ok,true);
 }
 async function prepare(sourceFile,{cover=sourceFile.kind==='video'}={}){
  let revision=0;
  if(cover){const saved=await authenticated('sma_publication_editor_v1',['save',{
   asset_id:sourceFile.id,asset_revision:sourceFile.revision,revision:0,request_id:next(),settings}]);
   assert.equal(saved.ok,true,JSON.stringify(saved));revision=saved.revision;
  }
  const input={asset_id:sourceFile.id,asset_revision:sourceFile.revision,draft_revision:revision,export_id:next()};
  const outputs={media:{sha256:'b'.repeat(64),size_bytes:3072},cover:cover?{sha256:'c'.repeat(64),size_bytes:512}:null};
  const receipt=await authenticated('sma_publication_editor_export_v1',['prepare',{...input,outputs}]);
  assert.equal(receipt.ok,true,JSON.stringify(receipt));assert.equal(receipt.status,'prepared');
  const artifact=kind=>receipt[kind]?{...receipt[kind],...outputs[kind],kind:kind==='cover'?'image':sourceFile.kind}:null;
  return {input,outputs,receipt,media:artifact('media'),cover:artifact('cover')};
 }
 async function family(options={}){
  const original=await file(options.kind||'video'),job=await start(assetAnchor(original));await bind(job);
  return {original,job,exp:await prepare(original,options)};
 }
 async function beginUpload(job,artifact){
  const joined=await start(uploadAnchor(artifact));assert.equal(joined.job_id,job.job_id);
  const command=await run(job,'upload_start',uploadInput(artifact));
  assert.equal(command.reservation.ok,true,JSON.stringify(command.reservation));
  assert.equal(command.reservation.initialize,true);assert.ok(command.reservation.lease_id);
  assert.equal(command.reservation.upload_id,artifact.upload_id);
  assert.deepEqual(await worker('reserve',command.key),command.reservation,'A retry retains the original initialization lease');
  const drive='synthetic_drive_'+ ++counter,folder='synthetic_processing_folder';
  const url='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=synthetic_'+counter;
  const ready=await business('sma_publication_upload_bind_v1',[artifact.upload_id,command.reservation.lease_id,drive,folder,url]);
  assert.equal(ready.status,'ready',JSON.stringify(ready));await finish(command,ready);
  return {artifact,command,drive,folder,url,ready};
 }
 async function completeUpload(job,upload,{sha=upload.artifact.sha256,beforeResult,beforeCompleted}={}){
  const {artifact}=upload,command=await run(job,'upload_finish',{upload_id:artifact.upload_id});
  assert.equal(command.reservation.status,'ready',JSON.stringify(command.reservation));
  assert.equal(command.reservation.upload_id,artifact.upload_id);
  const payload={drive_file_id:upload.drive,folder_id:upload.folder,upload_id:artifact.upload_id,
   name:artifact.name,mime_type:artifact.mime_type,size_bytes:artifact.size_bytes,media_kind:artifact.kind,
   revision:'sha256:'+sha+':1',modified_at:new Date(tick).toISOString(),width_px:320,height_px:240,
   duration_ms:artifact.kind==='video'?10000:null};
  const result=await business('sma_publication_upload_finish_v1',[artifact.upload_id,payload]);
  assert.equal(result.status,'completed',JSON.stringify(result));
  const completed={id:result.asset_id,revision:payload.revision,kind:artifact.kind};
  await beforeResult?.({completed,command,result,payload});
  assert.equal((await worker('result',{...command.key,status:200,body:result})).ok,true);
  await beforeCompleted?.({completed,command,result,payload});
  assert.equal((await worker('completed',{...command.key,outcome:'completed'})).ok,true);
  return completed;
 }
 async function completedFamily(){
  const f=await family(),m=await beginUpload(f.job,f.exp.media),c=await beginUpload(f.job,f.exp.cover);
  f.media=await completeUpload(f.job,m);f.cover=await completeUpload(f.job,c);
  assert.equal((await authenticated('sma_publication_editor_export_v1',['complete',f.exp.input])).status,'completed');
  return f;
 }
 async function parentCountJourney(){
  const original=await file(),root=await start(assetAnchor(original));await bind(root);
  const first=await run(root,'magic_video',{asset_id:original.id,asset_revision:original.revision});
  assert.equal(first.reservation.ok,true);
  await business('sma_publication_video_magic_finish_v1',[original.id,first.reservation.lease_id,null,null,'SYNTHETIC_FAILURE']);
  await finish(first,{ok:true,analysis:first.reservation.analysis},'failed');
  const exp=await prepare(original),ids=[root.job_id],assets=[];
  for(const artifact of [exp.media,exp.cover]){
   const joined=await start(uploadAnchor(artifact));
   const job=joined.job_id===root.job_id?root:joined;
   if(!job.execution_id)await bind(job);ids.push(job.job_id);
   const upload=await beginUpload(job,artifact),completed=await completeUpload(job,upload);
   assert.equal((await start(assetAnchor(completed))).job_id,job.job_id);assets.push(completed);
  }
  assert.equal((await authenticated('sma_publication_editor_export_v1',['complete',exp.input])).status,'completed');
  return {parents:new Set(ids).size,storedJobs:await count('file_jobs_v1'),
   startClaims:await value('select count(*)::int v from sma_private.file_jobs_v1 where start_claimed_at is not null'),
   aliasJobs:await Promise.all(assets.map(async asset=>(await start(assetAnchor(asset))).job_id))};
 }
 async function preparedOrderInput(file){
  const preview=next(),id=next(),shop='https://sma-automation.com/app/shop.html?shop=family-fixture';
  const draft={platform:'youtube',title:'Synthetischer Familientest',body:'Ein synthetisches blaues Testvideo.',
   caption:'Ein synthetisches blaues Testvideo.\n\n🛒 Zum Shop: '+shop,hashtags:[],review_notes:[]};
  await db.query(`insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,preview)
   values($1,$2,1,$3,$4,'completed',$5)`,[preview,owner,{platforms:['youtube'],media_kind:'video',language:'de'},shop,{can_publish:false,drafts:[draft]}]);
  await db.query(`insert into sma_private.publication_assignments_v1(asset_id,platform,preview_id,preview_revision,asset_revision,draft)
   values($1,'youtube',$2,1,$3,$4)`,[file.id,preview,file.revision,draft]);
  return {id,asset_id:file.id,asset_revision:file.revision,platform:'youtube',assignment_revision:1,
   preview_id:preview,preview_revision:1,choices:{visibility:'private',made_for_kids:false,contains_synthetic_media:false}};
 }
 const businessSnapshot=()=>db.query(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) arguments,
  md5(p.prosrc) body,p.prosecdef,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','sma_private') and p.proname like '%publication_%' order by n.nspname,p.proname,arguments`);
 async function scenario(name,fn,{beforePatch}={}){
  await t.test(name,async()=>{
   await db.exec('begin');counter=100;phases=new Map();tick=Number(await value('select extract(epoch from now())*1000 v'));
   try{const initial=await beforePatch?.();if(patch)await db.exec(patch);await fn(initial);}
   finally{await db.exec('rollback');}
  });
 }
 async function savepoint(fn){
  await db.exec('savepoint mutation');try{return await fn();}finally{await db.exec('rollback to savepoint mutation');}
 }
 try{
  await installFileFamilyBaseline(db);
  businessBefore=(await businessSnapshot()).rows;
  if(!baseline)patch=await source('file-job-export-family');

  await scenario('the same completed export journey changes from three baseline parents to one family parent',async old=>{
   assert.equal(old.parents,3);assert.equal(old.storedJobs,3);assert.equal(old.startClaims,3);
   counter=100;phases=new Map();
   const current=await parentCountJourney();
   assert.equal(current.parents,1);assert.equal(current.storedJobs,1);assert.equal(current.startClaims,1);
   assert.equal(new Set(current.aliasJobs).size,1);
  },{beforePatch:()=>savepoint(()=>parentCountJourney())});

  await scenario('original, media and cover share one parent, unique canonical commands and original leases',async()=>{
   const {original,job,exp}=await family(),before=await identity(job);
   const m=await beginUpload(job,exp.media),c=await beginUpload(job,exp.cover);
   assert.notEqual(m.command.command.command_id,c.command.command.command_id);
   assert.notEqual(m.command.reservation.lease_id,c.command.reservation.lease_id);
   for(const upload of [m,c]){
    const duplicate=await enqueue(job,'upload_start',uploadInput(upload.artifact));
    assert.equal(duplicate.command_id,upload.command.command.command_id);
    assert.notEqual(duplicate.request.command_id,duplicate.command_id);
    const view=await user('get',{job_id:job.job_id,command_id:duplicate.request.command_id});
    assert.equal(view.commands[0].response.body.upload_id,upload.artifact.upload_id);
    assert.equal(view.commands[0].response.body.upload_url,upload.url);
    assert.equal((await user('command',{job_id:job.job_id,command_id:next(),operation:'upload_start',
     input:{...uploadInput(upload.artifact),upload_id:upload.artifact.upload_id.toUpperCase()}})).code,'INVALID_INPUT');
   }
   const assertAlias=async({completed,command})=>{
    assert.equal((await start(assetAnchor(completed))).job_id,job.job_id);
    assert.deepEqual(await identity(job),before,'A derivative never replaces the parent source');
    assert.equal((await worker('claim_start',{job_id:job.job_id})).start,null);
    if(command)assert.equal((await user('get',{job_id:job.job_id,command_id:command.command.command_id})).commands[0].state,'running');
   };
   const media=await completeUpload(job,m,{beforeResult:assertAlias,beforeCompleted:assertAlias});
   const coverStillReady=await user('get',{job_id:job.job_id,command_id:c.command.command.command_id});
   assert.equal(coverStillReady.commands[0].response.body.status,'ready');
   assert.equal(coverStillReady.commands[0].response.body.upload_id,exp.cover.upload_id);
   const cover=await completeUpload(job,c,{beforeResult:assertAlias,beforeCompleted:assertAlias});
   assert.notEqual(media.id,cover.id);assert.notEqual(media.id,original.id);
   const finished=await authenticated('sma_publication_editor_export_v1',['complete',exp.input]);
   assert.equal(finished.status,'completed');assert.equal(finished.media.asset_id,media.id);assert.equal(finished.cover.asset_id,cover.id);
   for(const [upload,asset] of [[m,media],[c,cover]]){
    const response=(await user('get',{job_id:job.job_id,command_id:upload.command.command.command_id})).commands[0].response.body;
    assert.equal(response.status,'completed');assert.equal(response.asset_id,asset.id);assert.equal(response.upload_url,undefined);
    const duplicate=await enqueue(job,'upload_finish',{upload_id:upload.artifact.upload_id});
    assert.equal((await user('get',{job_id:job.job_id,command_id:duplicate.request.command_id})).commands[0].response.body.asset_id,asset.id);
    assert.equal((await user('command',{job_id:job.job_id,command_id:next(),operation:'upload_finish',
     input:{upload_id:upload.artifact.upload_id.toUpperCase()}})).code,'INVALID_INPUT');
   }
   assert.equal(await count('file_jobs_v1'),1);assert.equal(await count('file_commands_v1'),4);
   assert.equal(await value('select count(*)::int v from sma_private.file_jobs_v1 where start_claimed_at is not null'),1);
   assert.deepEqual(await identity(job),before);
   assert.doesNotMatch(JSON.stringify(await user('get',{job_id:job.job_id})),/lease_id|initial_reservation|command_ticket|execution_id|user_id|customer_id/);
  });

  await scenario('later Magic, Review and Order commands use their own family asset in the same parent',async()=>{
   const {original,job,media,cover}=await completedFamily(),before=await identity(job);
   for(const [operation,file,field,finishRpc] of [
    ['magic_video',original,'analysis','sma_publication_video_magic_finish_v1'],
    ['magic_video',media,'analysis','sma_publication_video_magic_finish_v1'],
    ['magic_photo',cover,'analysis','sma_publication_magic_finish_v1'],
    ['review',cover,'review','sma_publication_review_finish_v1']]){
    // These explicit customer actions occur outside the existing 30-second
    // cooldown; the actual reservation RPC and hourly attempt count remain.
    await db.exec("update sma_private.publication_magic_rate_v1 set last_started=now()-interval '31 seconds'");
    assert.equal((await start(assetAnchor(file))).job_id,job.job_id);
    const c=await run(job,operation,{asset_id:file.id,asset_revision:file.revision});
    assert.equal(c.reservation.ok,true,JSON.stringify(c.reservation));assert.equal(c.reservation[field].asset_id,file.id);
    const body={ok:true,[field]:c.reservation[field]};
    assert.equal((await business(finishRpc,[file.id,c.reservation.lease_id,null,null,'SYNTHETIC_FAILURE'])).ok,false);
    await finish(c,body,'failed');
   }
   const input=await preparedOrderInput(media),order=await run(job,'order_prepare',input);
   assert.equal(order.reservation.state,'preparing',JSON.stringify(order.reservation));
   const prepared=await business('sma_publication_order_worker_v1',['bind_target',input.id,null,{
    target:{platform:'youtube',id:'synthetic_youtube',name:'Synthetic target',source_revision:'d'.repeat(64)},
    account_check:{version:1,platform:'youtube',target_id:'synthetic_youtube',target_revision:'d'.repeat(64),display_name:'Synthetic target',
     permissions:['youtube.upload'],policy:{},checked_at:new Date(tick).toISOString(),expires_at:new Date(tick+240000).toISOString()}}]);
   assert.equal(prepared.state,'prepared',JSON.stringify(prepared));await finish(order,prepared);
   const rejected=await run(job,'order_approve',{id:input.id,approval_token:prepared.approval_token,confirm:true,review:{}});
   assert.equal(rejected.reservation.code,'FINAL_APPROVAL_REQUIRED');await finish(rejected,rejected.reservation,'failed');
   assert.equal(await count('file_jobs_v1'),1);assert.deepEqual(await identity(job),before);
   assert.equal(await count('publication_provider_permissions_v1'),0);assert.equal(await count('publication_provider_attempts_v1'),0);
  });

  await scenario('foreign owner and mismatched customer cannot claim a known export upload',async()=>{
   const {job,exp}=await family();
   for(const artifact of [exp.media,exp.cover]){
    const result=await user('start',{request_id:next(),anchor:uploadAnchor(artifact)},other);
    assert.equal(result.code,'UPLOAD_UNAVAILABLE');
   }
   await savepoint(async()=>{
    await db.query('update sma_private.publication_editor_exports_v1 set customer_id=2 where id=$1',[exp.input.export_id]);
    assert.equal((await user('start',{request_id:next(),anchor:uploadAnchor(exp.media)})).code,'UPLOAD_UNAVAILABLE');
   });
   assert.equal(await count('file_jobs_v1'),1);assert.equal(await count('publication_uploads_v1'),0);
   assert.equal((await user('get',{job_id:job.job_id},other)).code,'JOB_UNAVAILABLE');
  });

  await scenario('known export metadata mismatch is denied without an ordinary-upload fallback',async()=>{
   const {exp}=await family();
   for(const artifact of [exp.media,exp.cover])for(const patch of [{name:'Wrong file.mp4'},{mime_type:'image/jpeg'},{size_bytes:artifact.size_bytes+1}]){
    const result=await user('start',{request_id:next(),anchor:{...uploadAnchor(artifact),...patch}});
    assert.equal(result.code,'UPLOAD_CONFLICT',JSON.stringify({patch,result}));
    assert.equal(await count('file_jobs_v1'),1);assert.equal(await count('publication_uploads_v1'),0);
   }
  });

  await scenario('changed source revision or editor draft cannot authorize an old export family',async()=>{
   const {original,exp}=await family();
   await savepoint(async()=>{
    await db.query("update sma_private.publication_files_v1 set revision='version:changed' where id=$1",[original.id]);
    assert.equal((await user('start',{request_id:next(),anchor:uploadAnchor(exp.media)})).code,'FILE_CHANGED');
    assert.equal(await count('publication_uploads_v1'),0);
   });
   const changed=await authenticated('sma_publication_editor_v1',['save',{asset_id:original.id,asset_revision:original.revision,
    revision:1,request_id:next(),settings:{...settings,overlay_text:'A newer saved draft'}}]);
   assert.equal(changed.revision,2);
   assert.equal((await user('start',{request_id:next(),anchor:uploadAnchor(exp.media)})).code,'REVISION_CONFLICT');
   assert.equal(await count('file_jobs_v1'),1);assert.equal(await count('publication_uploads_v1'),0);
  });

  await scenario('an unknown ID with an export-like name stays an independent ordinary upload',async()=>{
   const {job,exp}=await family(),before=await identity(job);
   const ordinary=await start({...uploadAnchor(exp.media),upload_id:next()});
   assert.notEqual(ordinary.job_id,job.job_id);assert.equal(ordinary.asset_id,null);
   assert.equal(await count('file_jobs_v1'),2);assert.deepEqual(await identity(job),before);
   for(const extra of [{parent_job_id:job.job_id},{asset_id:before.asset_id},{source_asset_id:before.asset_id}]){
    assert.equal((await user('start',{request_id:next(),anchor:{...uploadAnchor(exp.media),...extra}})).code,'INVALID_INPUT');
   }
  });

  await scenario('family joins and resumes never extend the original 24-hour deadline',async()=>{
   const {job,exp}=await family();
   await db.query("update sma_private.file_jobs_v1 set created_at=now()-interval '23 hours',deadline_at=now()+interval '1 hour' where id=$1",[job.job_id]);
   const before=await identity(job),m=await beginUpload(job,exp.media);await completeUpload(job,m);
   assert.deepEqual(await identity(job),before);
   assert.equal(Date.parse((await start(uploadAnchor(exp.cover))).deadline_at),Date.parse(before.deadline_at));
   assert.equal(await value('select extract(epoch from deadline_at-created_at)::int v from sma_private.file_jobs_v1 where id=$1',[job.job_id]),86400);
  });

  await scenario('a previously reserved artifact keeps its immutable upload contract after a later draft save',async()=>{
   const {original,job,exp}=await family(),first=await start(uploadAnchor(exp.media));
   assert.equal(first.job_id,job.job_id);
   const lease=await value('select lease_id v from sma_private.publication_uploads_v1 where id=$1',[exp.media.upload_id]);
   assert.equal((await authenticated('sma_publication_editor_v1',['save',{asset_id:original.id,asset_revision:original.revision,
    revision:1,request_id:next(),settings:{...settings,overlay_text:'Saved after this upload was reserved'}}])).revision,2);
   const upload=await beginUpload(job,exp.media);
   assert.equal(upload.command.reservation.lease_id,lease);
   await completeUpload(job,upload);
   assert.equal(await count('file_jobs_v1'),1);
  });

  await scenario('ambiguous export media and cover relations are rejected before creating a binding',async()=>{
   const {exp}=await family();
   const second=await authenticated('sma_publication_editor_export_v1',['prepare',{
    ...exp.input,export_id:exp.cover.upload_id,outputs:exp.outputs}]);
   assert.equal(second.ok,true,JSON.stringify(second));
   const result=await user('start',{request_id:next(),anchor:uploadAnchor(exp.cover)});
   assert.equal(result.code,'UPLOAD_UNAVAILABLE');
   assert.equal(await count('publication_uploads_v1'),0);assert.equal(await count('file_jobs_v1'),1);
  });

  await scenario('a completed upload with altered output evidence cannot publish a family result or create an alias',async()=>{
   const {job,exp}=await family(),before=await identity(job),upload=await beginUpload(job,exp.media);
   await completeUpload(job,upload,{beforeResult:async({completed,command,result})=>{
    for(const mutation of [
     ["revision=$2",'sha256:'+'d'.repeat(64)+':1'],['size_bytes=$2',exp.media.size_bytes+1],
     ['name=$2','Different file.mp4'],['mime_type=$2','image/png'],['media_kind=$2','image'],['user_id=$2',other],['customer_id=$2',2],
     ['drive_file_id=$2','different_synthetic_drive']])await savepoint(async()=>{
      await db.query('update sma_private.publication_files_v1 set '+mutation[0]+' where id=$1',[completed.id,mutation[1]]);
      const revision=await value('select revision v from sma_private.publication_files_v1 where id=$1',[completed.id]);
      denied(await user('start',{request_id:next(),anchor:assetAnchor({...completed,revision})}));
      denied(await worker('result',{...command.key,status:200,body:result}));
      assert.equal(await count('file_jobs_v1'),1);assert.deepEqual(await identity(job),before);
    });
    for(const body of [{...result,upload_id:exp.cover.upload_id},{...result,asset_id:next()}]){
     denied(await worker('result',{...command.key,status:200,body}));
    }
    await savepoint(async()=>{
     await db.query('update sma_private.publication_uploads_v1 set asset_id=$2 where id=$1',[exp.media.upload_id,before.asset_id]);
     denied(await worker('result',{...command.key,status:200,body:{...result,asset_id:before.asset_id}}));
     assert.deepEqual(await identity(job),before,'An export result cannot be substituted with the original source');
    });
    assert.equal((await start(assetAnchor(completed))).job_id,job.job_id);
   }});
   assert.deepEqual(await identity(job),before);
  });

  await scenario('an existing family alias cannot authorize a changed result revision, hash or owner',async()=>{
   const {job,media,exp}=await completedFamily(),before=await identity(job);
   for(const mutation of [["revision=$2",'sha256:'+'d'.repeat(64)+':1'],['size_bytes=$2',exp.media.size_bytes+1],
    ['name=$2','Changed.mp4'],['media_kind=$2','image'],['user_id=$2',other],['customer_id=$2',2],['available=$2',false]])await savepoint(async()=>{
     await db.query('update sma_private.publication_files_v1 set '+mutation[0]+' where id=$1',[media.id,mutation[1]]);
     const revision=await value('select revision v from sma_private.publication_files_v1 where id=$1',[media.id]);
     denied(await user('start',{request_id:next(),anchor:assetAnchor({...media,revision})}));
     assert.equal((await user('command',{job_id:job.job_id,command_id:next(),operation:'magic_video',
      input:{asset_id:media.id,asset_revision:revision}})).code,'INVALID_INPUT');
     assert.equal(await count('file_jobs_v1'),1);assert.deepEqual(await identity(job),before);
   });
  });

  await scenario('a same-byte catalog revision change cannot throw a unique violation or create another parent',async()=>{
   const {job,media}=await completedFamily(),before=await identity(job),revision=media.revision.replace(/:1$/,':2');
   await db.query('update sma_private.publication_files_v1 set revision=$2 where id=$1',[media.id,revision]);
   const current=await user('start',{request_id:next(),anchor:assetAnchor({...media,revision})});
   if(current.ok)assert.equal(current.job_id,job.job_id);
   else assert.equal(typeof current.code,'string');
   assert.equal((await user('command',{job_id:job.job_id,command_id:next(),operation:'magic_video',
    input:{asset_id:media.id,asset_revision:media.revision}})).code,'INVALID_INPUT');
   assert.equal(await count('file_jobs_v1'),1);assert.deepEqual(await identity(job),before);
  });

  await scenario('legacy separate upload parents retain their execution and uncertain outcome across the addition',async old=>{
   const {job,exp,legacy,upload}=old;
   assert.notEqual(legacy.job_id,job.job_id);const before=await identity(legacy),rootBefore=await identity(job);
   assert.equal((await start(uploadAnchor(exp.media))).job_id,legacy.job_id);
   await savepoint(async()=>{
    await db.query("update sma_private.file_jobs_v1 set state='uncertain' where id=$1",[legacy.job_id]);
    assert.equal((await start(uploadAnchor(exp.media))).job_id,legacy.job_id);
    assert.equal((await worker('claim_start',{job_id:legacy.job_id})).start,null);
    assert.equal((await user('command',{job_id:legacy.job_id,command_id:next(),operation:'upload_finish',input:{upload_id:exp.media.upload_id}})).code,'JOB_UNCERTAIN');
    assert.equal(await count('file_jobs_v1'),2);
   });
   const completed=await completeUpload(legacy,upload);
   assert.equal((await start(assetAnchor(completed))).job_id,legacy.job_id);
   assert.equal((await start(uploadAnchor(exp.cover))).job_id,job.job_id);
   assert.equal((await identity(legacy)).execution_id,before.execution_id);
   assert.deepEqual(await identity(job),rootBefore);assert.equal(await count('file_jobs_v1'),2);
  },{beforePatch:async()=>{
   const f=await family(),legacy=await start(uploadAnchor(f.exp.media));await bind(legacy);
   return {...f,legacy,upload:await beginUpload(legacy,f.exp.media)};
  }});

  await scenario('a finished legacy export can join only its already-active source parent',async old=>{
   const {original,job,exp,legacy,media}=old,rootBefore=await identity(job),legacyBefore=await identity(legacy);
   assert.equal(await count('file_jobs_v1'),2);
   for(const state of ['running','uncertain'])await savepoint(async()=>{
    await db.query('update sma_private.file_jobs_v1 set state=$2 where id=$1',[legacy.job_id,state]);
    const join=await start(assetAnchor(media));
    assert.equal(join.job_id,legacy.job_id,'A still-active or uncertain legacy parent keeps ownership of its existing result');
    assert.equal((await worker('claim_start',{job_id:legacy.job_id})).start,null);
    assert.equal(await count('file_jobs_v1'),2);
   });
   const joined=await start(assetAnchor(media));
   assert.equal(joined.job_id,job.job_id);assert.equal(joined.asset_id,original.id);
   assert.equal((await start(uploadAnchor(exp.media))).job_id,job.job_id);
   await enqueue(job,'magic_video',{asset_id:media.id,asset_revision:media.revision});
   assert.equal((await worker('claim_start',{job_id:job.job_id})).start,null);
   assert.equal(await count('file_jobs_v1'),2,'The historical finished row stays, but no third parent is created');
   assert.deepEqual(await identity(job),rootBefore);assert.deepEqual(await identity(legacy),legacyBefore);
   assert.equal(await value('select state v from sma_private.file_jobs_v1 where id=$1',[legacy.job_id]),'finished');
   assert.equal(await value('select count(*)::int v from sma_private.file_jobs_v1 where start_claimed_at is not null'),2);
  },{beforePatch:async()=>{
   const f=await family({cover:false}),legacy=await start(uploadAnchor(f.exp.media));await bind(legacy);
   const media=await completeUpload(legacy,await beginUpload(legacy,f.exp.media));
   assert.equal((await authenticated('sma_publication_editor_export_v1',['complete',f.exp.input])).status,'completed');
   assert.equal((await worker('finish',{job_id:legacy.job_id,execution_id:legacy.execution_id})).ok,true);
   return {...f,legacy,media};
  }});

  await scenario('customer or upload identity changes remove stale upload capabilities from every public view',async()=>{
   const {original,job,exp}=await family(),upload=await beginUpload(job,exp.media),commandId=upload.command.command.command_id;
   const live=(await user('get',{job_id:job.job_id,command_id:commandId})).commands[0].response.body;
   assert.equal(live.upload_url,upload.url);assert.equal(live.status,'ready');
   for(const [sql,args,code] of [
    ["update public.sma_kunden set n8n_kunde_id='changed_family_owner' where id=1",[],'COMMAND_BINDING_CHANGED'],
    ["update public.sma_kunden set kunde_email='changed@example.invalid' where id=1",[],'COMMAND_BINDING_CHANGED'],
    ['update public.sma_kunden set user_id=$1 where id=1',[other],'JOB_UNAVAILABLE'],
    ['update sma_private.publication_uploads_v1 set user_id=$2 where id=$1',[exp.media.upload_id,other],'COMMAND_BINDING_CHANGED'],
    ['update sma_private.publication_uploads_v1 set customer_id=2 where id=$1',[exp.media.upload_id],'COMMAND_BINDING_CHANGED']
   ])await savepoint(async()=>{
    await db.query(sql,args);
    const scoped=await user('get',{job_id:job.job_id,command_id:commandId});assert.equal(scoped.code,code);
    const views=[scoped,await user('get',{job_id:job.job_id}),
     await user('start',{request_id:next(),anchor:assetAnchor(original)}),
     await user('start',{request_id:job.request_id,anchor:assetAnchor(original)})];
    for(const view of views){
     assert.doesNotMatch(JSON.stringify(view),/upload_url|www\.googleapis\.com/);
     assert.equal(JSON.stringify(view).includes(upload.url),false);
    }
    assert.equal(await count('file_jobs_v1'),1);assert.equal(await count('publication_uploads_v1'),1);
   });
   assert.equal((await user('get',{job_id:job.job_id,command_id:commandId})).commands[0].response.body.upload_url,upload.url,
    'An unchanged, still-valid upload retains its scoped capability');
  });

  await scenario('uncertain or command-exhausted source parents cannot be bypassed by an export upload',async()=>{
   const {job,exp}=await family();
   for(const condition of ['uncertain','full'])await savepoint(async()=>{
    if(condition==='uncertain')await db.query("update sma_private.file_jobs_v1 set state='uncertain' where id=$1",[job.job_id]);
    else for(let index=0;index<64;index++)await enqueue(job,'account',{id:next(),platform:'youtube'});
    const result=await user('start',{request_id:next(),anchor:uploadAnchor(exp.media)});
    if(result.ok){
     assert.equal(result.job_id,job.job_id);
     denied(await user('command',{job_id:job.job_id,command_id:next(),operation:'upload_start',input:uploadInput(exp.media)}));
    }
    assert.equal(await count('file_jobs_v1'),1);
    assert.equal((await worker('claim_start',{job_id:job.job_id})).start,null);
   });
  });

  await scenario('ordinary original uploads keep their attach-before-result contract and later exports join that parent',async()=>{
   const artifact={upload_id:next(),name:'Synthetic original.mp4',mime_type:'video/mp4',size_bytes:2048,kind:'video',sha256:sourceHash};
   const job=await start(uploadAnchor(artifact));assert.equal(job.asset_id,null);await bind(job);
   const upload=await beginUpload(job,artifact),original=await completeUpload(job,upload,{beforeResult:async({completed})=>{
    assert.equal((await start(assetAnchor(completed))).job_id,job.job_id);
   }});
   assert.equal((await identity(job)).asset_id,original.id);assert.equal((await identity(job)).upload_id,artifact.upload_id);
   const before=await identity(job),exp=await prepare(original);
   for(const output of [exp.media,exp.cover])await completeUpload(job,await beginUpload(job,output));
   assert.deepEqual(await identity(job),before);assert.equal(await count('file_jobs_v1'),1);
   assert.equal(await count('file_commands_v1'),6);
   assert.equal((await authenticated('sma_publication_editor_export_v1',['complete',exp.input])).status,'completed');
  });

  await scenario('family SQL preserves original business RPCs and keeps its bindings private',async()=>{
   assert.deepEqual((await businessSnapshot()).rows,businessBefore);
   for(const table of ['file_job_uploads_v1','file_job_assets_v1']){
    assert.equal(await value('select relrowsecurity v from pg_class where oid=$1::regclass',['sma_private.'+table]),true);
    for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE']){
     assert.equal(await value('select has_table_privilege($1,$2,$3) v',[role,'sma_private.'+table,privilege]),false,role+' '+table+' '+privilege);
    }
   }
   assert.equal(await value("select has_function_privilege('authenticated','public.sma_file_job_worker_v1(text,jsonb)','EXECUTE') v"),false);
   assert.equal(await value("select has_function_privilege('service_role','public.sma_file_job_v1(text,jsonb)','EXECUTE') v"),false);
  });
 }finally{await db.close();}
});
