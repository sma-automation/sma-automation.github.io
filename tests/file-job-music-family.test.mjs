// Actual repository SQL in disposable PGlite. No provider request, bytes,
// payment, public post, real customer record or native n8n execution.
import assert from 'node:assert/strict';
import test from 'node:test';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import {owner,other,source,musicSourceHash,musicOutputHash,musicTrackHash,assetAnchor,uploadAnchor,uploadInput,
 installMusicFileFamilyBaseline,musicFileFamilyHarness} from './sql-runtime/file-job-music-family-fixture.mjs';

await test('browser gallery music retains one authoritative file family and one native start',async t=>{
 const db=new PGlite(),h=musicFileFamilyHarness(db);let patch,businessBefore;
 const denied=(result,code)=>{assert.equal(result.ok,false,JSON.stringify(result));if(code)assert.equal(result.code,code,JSON.stringify(result));};
 const request=artifact=>({request_id:h.next(),anchor:uploadAnchor(artifact)});
 async function savepoint(fn){await db.exec('savepoint fixture_mutation');try{return await fn();}finally{await db.exec('rollback to savepoint fixture_mutation');}}
 async function scenario(name,fn,{beforePatch}={}){
  await t.test(name,async()=>{
   await db.exec('begin;set constraints all immediate');h.reset();
   try{const old=await beforePatch?.();await db.exec(patch);await fn(old);}finally{await db.exec('rollback');}
  });
 }
 const businessSnapshot=async()=>(await db.query(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) arguments,
  md5(p.prosrc) body,p.prosecdef,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','sma_private') and p.proname ~ '^(sma_)?(publication_|gallery_|music_)'
  order by n.nspname,p.proname,arguments`)).rows;
 async function journey(){
  const f=await h.family(),joined=await h.start(uploadAnchor(f.artifact));
  if(joined.job_id!==f.job.job_id)await h.bind(joined);
  await h.enqueue(joined,'upload_start',uploadInput(f.artifact));
  return {distinct:new Set([f.job.job_id,joined.job_id]).size,...await h.counts()};
 }
 async function catalogueReceipt(upload){
  const {artifact}=upload,id=h.next(),revision='sha256:'+artifact.sha256+':1';
  await db.query(`insert into sma_private.publication_files_v1(id,user_id,customer_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,width_px,height_px,duration_ms)
   values($1,$2,1,$3,$4,'video','video/mp4',$5,'2026-11-01T12:34:56Z',$6,320,240,10000)`,[id,owner,upload.drive,artifact.name,revision,artifact.size_bytes]);
  return {id,revision,kind:'video'};
 }
 try{
  await installMusicFileFamilyBaseline(db);patch=await source('file-job-music-family');businessBefore=await businessSnapshot();

  await scenario('the demonstrated two-parent baseline becomes exactly one parent and start claim',async old=>{
   assert.deepEqual(old,{distinct:2,jobs:2,starts:2});h.reset();
   assert.deepEqual(await journey(),{distinct:1,jobs:1,starts:1});
  },{beforePatch:()=>savepoint(journey)});

  await scenario('source, reserved music upload and verified result retain the original parent through mailbox completion',async()=>{
   const {original,job,claimed,artifact}=await h.family(),before=await h.identity(job);
   const upload=await h.beginUpload(job,artifact),firstCommand=upload.command.command.command_id;
   const replay=await h.enqueue(job,'upload_start',uploadInput(artifact));assert.equal(replay.command_id,firstCommand);
   assert.equal((await h.user('get',{job_id:job.job_id,command_id:replay.request.command_id})).commands[0].response.body.upload_url,upload.url);
   const complete=await h.materializeUpload(job,upload);
   assert.equal((await h.start(assetAnchor(complete.asset))).job_id,job.job_id,'The catalogue result joins before the mailbox response');
   assert.equal((await h.user('get',{job_id:job.job_id,command_id:complete.command.command.command_id})).commands[0].state,'running');
   await h.finish(complete.command,complete.result);
   const receipt=await h.music('complete',{id:claimed.id,lease:claimed.lease});assert.equal(receipt.state,'completed');
   assert.equal(receipt.asset_id,complete.asset.id);assert.deepEqual(await h.music('complete',{id:claimed.id,lease:claimed.lease}),receipt);
   assert.equal((await h.start(assetAnchor(complete.asset))).job_id,job.job_id);
   const finishReplay=await h.enqueue(job,'upload_finish',{upload_id:artifact.upload_id});assert.equal(finishReplay.command_id,complete.command.command.command_id);
   assert.equal((await h.worker('claim_start',{job_id:job.job_id})).start,null);
   assert.deepEqual(await h.identity(job),before);assert.equal(before.asset_id,original.id);
   assert.deepEqual(await h.counts(),{jobs:1,starts:1});assert.equal(await h.count('file_commands_v1'),2);
   assert.equal(await h.count('file_job_uploads_v1'),1);assert.equal(await h.count('file_job_assets_v1'),1);
   assert.doesNotMatch(JSON.stringify(await h.user('get',{job_id:job.job_id})),/upload_url|lease_id|start_ticket|execution_id|user_id|customer_id/);
  });

  await scenario('a music-first join creates one source-rooted family and freezes server-owned metadata',async()=>{
   const original=await h.file(),{artifact}=await h.claimMusic(original),job=await h.start(uploadAnchor(artifact));await h.bind(job);
   assert.equal(job.asset_id,original.id);assert.equal(job.asset_revision,original.revision);
   const before=await h.identity(job);assert.equal(before.anchor.kind,'asset');assert.equal(before.upload_id,null);
   assert.equal((await h.start(assetAnchor(original))).job_id,job.job_id);
   const binding=await h.value(`select jsonb_build_object('artifact',artifact,'gallery_music_id',gallery_music_id,
    'export_id',export_id,'draft_revision',draft_revision,'source_asset_id',source_asset_id,'source_asset_revision',source_asset_revision,
    'sha256',sha256,'size_bytes',size_bytes,'music_track_sha',music_track_sha) v from sma_private.file_job_uploads_v1 where job_id=$1`,[job.job_id]);
   assert.deepEqual(binding,{artifact:'music',gallery_music_id:artifact.upload_id,export_id:null,draft_revision:null,
    source_asset_id:original.id,source_asset_revision:original.revision,sha256:musicOutputHash,size_bytes:3072,music_track_sha:musicTrackHash});
   await h.completeUpload(job,await h.beginUpload(job,artifact));assert.deepEqual(await h.identity(job),before);
   assert.deepEqual(await h.counts(),{jobs:1,starts:1});
  });

  await scenario('a music version of an editor result stays in the original media-and-cover family',async()=>{
   const original=await h.file(),job=await h.start(assetAnchor(original));await h.bind(job);
   const sourceMusic=await h.claimMusic(original,{reserve:false});
   assert.equal((await h.music('audio_present',{id:sourceMusic.claimed.id,lease:sourceMusic.claimed.lease})).ok,true);
   const exp=await h.editorExport(original,{cover:true}),before=await h.identity(job);
   const media=await h.completeUpload(job,await h.beginUpload(job,exp.media));
   const cover=await h.completeUpload(job,await h.beginUpload(job,exp.cover));
   assert.equal((await h.authenticated('sma_publication_editor_export_v1',['complete',exp.input])).status,'completed');
   const {artifact}=await h.claimMusic(media.asset),music=await h.completeUpload(job,await h.beginUpload(job,artifact));
   for(const asset of [original,media.asset,cover.asset,music.asset])assert.equal((await h.start(assetAnchor(asset))).job_id,job.job_id);
   assert.deepEqual(await h.identity(job),before);assert.deepEqual(await h.counts(),{jobs:1,starts:1});
   assert.equal(await h.count('file_commands_v1'),6);assert.equal(await h.count('file_job_uploads_v1'),3);
  });

  await scenario('foreign users and inconsistent customer ownership cannot borrow a reserved music ID',async()=>{
   const {job,artifact}=await h.family();
   denied(await h.user('start',request(artifact),other),'UPLOAD_UNAVAILABLE');
   denied(await h.user('get',{job_id:job.job_id},other),'JOB_UNAVAILABLE');
   for(const [sql,args] of [
    ['update sma_private.gallery_music_v1 set customer_id=2 where id=$1',[artifact.upload_id]],
    ['update sma_private.gallery_music_v1 set user_id=$2 where id=$1',[artifact.upload_id,other]]
   ])await savepoint(async()=>{await db.query(sql,args);denied(await h.user('start',request(artifact)),'UPLOAD_UNAVAILABLE');});
   assert.deepEqual(await h.counts(),{jobs:1,starts:1});assert.equal(await h.count('publication_uploads_v1'),0);
  });

  await scenario('known unreserved, background-rendered or unsupported music IDs never fall through to an ordinary upload',async()=>{
   const original=await h.file(),job=await h.start(assetAnchor(original));await h.bind(job);
   const {claimed,artifact}=await h.claimMusic(original,{reserve:false});
   denied(await h.user('start',request(artifact)),'UPLOAD_UNAVAILABLE');
   assert.equal((await h.music('reserve',{id:claimed.id,lease:claimed.lease,sha256:artifact.sha256,size_bytes:artifact.size_bytes})).ok,true);
   for(const [sql,args] of [
    ['update sma_private.gallery_music_v1 set expected_size=null where id=$1',[claimed.id]],
    ['update sma_private.gallery_music_v1 set expected_sha=null where id=$1',[claimed.id]],
    ["update sma_private.gallery_music_v1 set background_audio='render/synthetic.aac' where id=$1",[claimed.id]],
    ["update sma_private.gallery_music_v1 set state='unsupported' where id=$1",[claimed.id]]
   ])await savepoint(async()=>{await db.query(sql,args);denied(await h.user('start',request(artifact)),'UPLOAD_UNAVAILABLE');});
   assert.deepEqual(await h.counts(),{jobs:1,starts:1});assert.equal(await h.count('publication_uploads_v1'),0);
  });

  await scenario('a new pending binding requires a live music lease and exact reserved output metadata',async()=>{
   const {job,claimed,artifact}=await h.family();
   await savepoint(async()=>{
    await db.query("update sma_private.gallery_music_v1 set lease_until=now()-interval '1 second' where id=$1",[claimed.id]);
    denied(await h.user('start',request(artifact)),'LEASE_CHANGED');
   });
   for(const change of [{name:'Other.mp4'},{mime_type:'image/png'},{size_bytes:artifact.size_bytes+1}]){
    denied(await h.user('start',request({...artifact,...change})),'UPLOAD_CONFLICT');
   }
   assert.equal(await h.count('publication_uploads_v1'),0);assert.equal(await h.count('file_job_uploads_v1'),0);
   assert.equal((await h.start(uploadAnchor(artifact))).job_id,job.job_id);
  });

  for(const failure of ['UPLOAD_INITIALIZING','UPLOAD_RATE_LIMITED'])await scenario('a real '+failure+' reservation leaves no empty source parent or request alias',async()=>{
   const original=await h.file(),{artifact}=await h.claimMusic(original);
   if(failure==='UPLOAD_INITIALIZING'){
    const initializing=await h.authenticated('sma_publication_upload_v1',['start',uploadInput(artifact)]);assert.equal(initializing.status,'initializing');
   }else for(let n=0;n<30;n++){
    const initializing=await h.authenticated('sma_publication_upload_v1',['start',{
     upload_id:h.next(),name:'Synthetic quota reservation '+n+'.mp4',mime_type:'video/mp4',size_bytes:1024}]);
    assert.equal(initializing.status,'initializing');
   }
   const before=(await db.query('select to_jsonb(u) row from sma_private.publication_uploads_v1 u order by id')).rows;
   denied(await h.user('start',request(artifact)),failure);
   assert.equal(await h.count('file_jobs_v1'),0);assert.equal(await h.count('file_job_requests_v1'),0);assert.equal(await h.count('file_job_uploads_v1'),0);
   assert.deepEqual((await db.query('select to_jsonb(u) row from sma_private.publication_uploads_v1 u order by id')).rows,before);
  });

  await scenario('unknown IDs cannot select a parent by copying its music filename or supplying client family fields',async()=>{
   const {job,original,artifact}=await h.family(),before=await h.identity(job);
   const ordinary=await h.start(uploadAnchor({...artifact,upload_id:h.next()}));assert.notEqual(ordinary.job_id,job.job_id);assert.equal(ordinary.asset_id,null);
   for(const extra of [{parent_job_id:job.job_id},{source_asset_id:original.id},{gallery_music_id:artifact.upload_id},{asset_revision:original.revision}]){
    denied(await h.user('start',{request_id:h.next(),anchor:{...uploadAnchor(artifact),...extra}}),'INVALID_INPUT');
   }
   assert.deepEqual(await h.identity(job),before);assert.equal(await h.count('file_jobs_v1'),2);
  });

  await scenario('content changes before binding are denied and a same-byte version uses only the current full source revision',async()=>{
   const original=await h.file(),{artifact}=await h.claimMusic(original);
   await savepoint(async()=>{
    await db.query('update sma_private.publication_files_v1 set revision=$2 where id=$1',[original.id,'sha256:'+'f'.repeat(64)+':2']);
    denied(await h.user('start',request(artifact)),'FILE_CHANGED');assert.equal(await h.count('file_jobs_v1'),0);
   });
   const revision='sha256:'+musicSourceHash+':2';await db.query('update sma_private.publication_files_v1 set revision=$2 where id=$1',[original.id,revision]);
   const job=await h.start(uploadAnchor(artifact));assert.equal(job.asset_revision,revision);
   assert.equal(await h.value('select source_asset_revision v from sma_private.file_job_uploads_v1 where job_id=$1',[job.job_id]),revision);
   denied(await h.user('start',{request_id:h.next(),anchor:assetAnchor(original)}),'FILE_UNAVAILABLE');
   assert.equal((await h.start(assetAnchor({...original,revision}))).job_id,job.job_id);assert.equal(await h.count('file_jobs_v1'),1);
  });

  await scenario('an existing binding survives retry and a replacement gallery lease without granting another parent',async()=>{
   const {job,claimed,original,artifact}=await h.family(),joined=await h.start(uploadAnchor(artifact)),before=await h.identity(job);
   const lease=await h.value('select lease_id v from sma_private.publication_uploads_v1 where id=$1',[artifact.upload_id]);
   assert.equal((await h.music('retry',{id:claimed.id,lease:claimed.lease})).ok,true);
   assert.equal((await h.start(uploadAnchor(artifact))).job_id,job.job_id);
   assert.equal((await h.user('start',{request_id:joined.request_id,anchor:uploadAnchor(artifact)})).job_id,job.job_id);
   await db.query('update sma_private.gallery_music_v1 set next_attempt=now() where id=$1',[claimed.id]);
   const reclaimed=await h.claimMusic(original);assert.equal(reclaimed.claimed.id,claimed.id);assert.notEqual(reclaimed.claimed.lease,claimed.lease);
   const upload=await h.beginUpload(job,artifact);assert.equal(upload.command.reservation.lease_id,lease);
   await h.completeUpload(job,upload);assert.deepEqual(await h.identity(job),before);
   assert.deepEqual(await h.counts(),{jobs:1,starts:1});
  });

  await scenario('request replay keeps the same binding while changed requests and commands are rejected',async()=>{
   const {job,artifact}=await h.family(),joined=await h.start(uploadAnchor(artifact));
   assert.equal((await h.user('start',{request_id:joined.request_id,anchor:uploadAnchor(artifact)})).job_id,job.job_id);
   denied(await h.user('start',{request_id:joined.request_id,anchor:uploadAnchor({...artifact,name:'Changed.mp4'})}),'REQUEST_CONFLICT');
   const command=await h.enqueue(job,'upload_start',uploadInput(artifact));
   denied(await h.user('command',{...command.request,input:{...uploadInput(artifact),size_bytes:artifact.size_bytes+1}}));
   denied(await h.user('command',{job_id:job.job_id,command_id:h.next(),operation:'upload_finish',input:{upload_id:artifact.upload_id.toUpperCase()}}),'INVALID_INPUT');
   assert.equal(await h.count('file_jobs_v1'),1);assert.equal(await h.count('file_commands_v1'),1);
  });

  for(const collision of ['media','cover'])await scenario('ambiguous '+collision+' export and music IDs are rejected before binding and on later replay',async()=>{
   const {original,job,artifact}=await h.family();
   async function collide(){
    const exp=await h.editorExport(original,{id:collision==='media'?artifact.upload_id:h.next(),cover:collision==='cover'});
    if(collision==='cover')await db.query('update sma_private.publication_editor_exports_v1 set cover_upload_id=$2 where id=$1',[exp.input.export_id,artifact.upload_id]);
   }
   await savepoint(async()=>{await collide();denied(await h.user('start',request(artifact)),'UPLOAD_UNAVAILABLE');assert.equal(await h.count('publication_uploads_v1'),0);});
   const joined=await h.start(uploadAnchor(artifact)),upload=await h.beginUpload(job,artifact);await collide();
   denied(await h.user('start',request(artifact)),'UPLOAD_UNAVAILABLE');
   denied(await h.user('start',{request_id:joined.request_id,anchor:uploadAnchor(artifact)}),'UPLOAD_UNAVAILABLE');
   denied(await h.user('command',{job_id:job.job_id,command_id:h.next(),operation:'upload_finish',input:{upload_id:artifact.upload_id}}),'INVALID_INPUT');
   assert.doesNotMatch(JSON.stringify(await h.user('get',{job_id:job.job_id})),/upload_url|www\.googleapis\.com/);
   assert.equal((await h.user('get',{job_id:job.job_id,command_id:upload.command.command.command_id})).code,'COMMAND_BINDING_CHANGED');
   assert.deepEqual(await h.counts(),{jobs:1,starts:1});
  });

  await scenario('a completed catalogue receipt with a still-ready upload retains its binding and later verified alias',async()=>{
   const {job,claimed,artifact}=await h.family(),upload=await h.beginUpload(job,artifact),before=await h.identity(job);
   const asset=await catalogueReceipt(upload);
   const metadata=()=>h.value(`select to_jsonb(f)-'verified_at' v from sma_private.publication_files_v1 f where id=$1`,[asset.id]);
   const metadataBefore=await metadata();
   assert.deepEqual(await h.value("select jsonb_build_object('state',state,'result_id',result_id,'lease_until',lease_until) v from sma_private.gallery_music_v1 where id=$1",[claimed.id]),{state:'completed',result_id:asset.id,lease_until:null});
   assert.equal(await h.value('select status v from sma_private.publication_uploads_v1 where id=$1',[artifact.upload_id]),'ready');
   assert.equal((await h.start(uploadAnchor(artifact))).job_id,job.job_id);
   assert.equal((await h.start(assetAnchor(asset))).job_id,job.job_id,'A tab closed before upload_finish must not cause a second native parent');
   assert.equal(await h.value('select status v from sma_private.publication_uploads_v1 where id=$1',[artifact.upload_id]),'completed');
   assert.deepEqual(await metadata(),metadataBefore,'Database-only reconciliation preserves verified file metadata');
   const lateFinish=await h.run(job,'upload_finish',{upload_id:artifact.upload_id});assert.equal(lateFinish.reservation.status,'completed');
   assert.equal(lateFinish.reservation.asset_id,asset.id);await h.finish(lateFinish,lateFinish.reservation);
   assert.deepEqual(await h.identity(job),before);assert.deepEqual(await h.counts(),{jobs:1,starts:1});
  });

  await scenario('an expired ready receipt remains usable as historical asset work without extending any upload or old job deadline',async()=>{
   const {job,artifact}=await h.family(),upload=await h.beginUpload(job,artifact),asset=await catalogueReceipt(upload);
   await db.query("update sma_private.file_jobs_v1 set created_at=now()-interval '25 hours',deadline_at=now()-interval '1 hour' where id=$1",[job.job_id]);
   await db.query("update sma_private.publication_uploads_v1 set created_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' where id=$1",[artifact.upload_id]);
   const before=await h.identity(job),uploadBefore=await h.value('select to_jsonb(u) v from sma_private.publication_uploads_v1 u where id=$1',[artifact.upload_id]);
   denied(await h.user('start',request(artifact)),'UPLOAD_EXPIRED');
   assert.equal(await h.count('file_jobs_v1'),1,'An expired upload request must not create an empty source parent');
   const current=await h.start(assetAnchor(asset));assert.notEqual(current.job_id,job.job_id);assert.equal(current.asset_id,asset.id);await h.bind(current);
   assert.deepEqual(await h.identity(job),before);
   assert.deepEqual(await h.value('select to_jsonb(u) v from sma_private.publication_uploads_v1 u where id=$1',[artifact.upload_id]),uploadBefore);
   assert.equal((await h.start(assetAnchor(asset))).job_id,current.job_id);assert.deepEqual(await h.counts(),{jobs:2,starts:2});
  });

  await scenario('a completed upload receipt remains valid after its upload deadline and joins an already active source family',async old=>{
   const {job,artifact,legacy,complete}=old,before=await h.identity(job),legacyBefore=await h.identity(legacy);
   await db.query("update sma_private.publication_uploads_v1 set created_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' where id=$1",[artifact.upload_id]);
   const receiptBefore=await h.value('select to_jsonb(u) v from sma_private.publication_uploads_v1 u where id=$1',[artifact.upload_id]);
   assert.equal(receiptBefore.status,'completed');
   assert.equal((await h.start(assetAnchor(complete.asset))).job_id,job.job_id);
   assert.equal((await h.start(uploadAnchor(artifact))).job_id,job.job_id);
   assert.deepEqual(await h.identity(job),before);assert.deepEqual(await h.identity(legacy),legacyBefore);
   assert.deepEqual(await h.value('select to_jsonb(u) v from sma_private.publication_uploads_v1 u where id=$1',[artifact.upload_id]),receiptBefore);
   assert.deepEqual(await h.counts(),{jobs:2,starts:2});assert.equal((await h.worker('claim_start',{job_id:job.job_id})).start,null);
  },{beforePatch:async()=>{
   const f=await h.family(),legacy=await h.start(uploadAnchor(f.artifact));await h.bind(legacy);
   const complete=await h.completeUpload(legacy,await h.beginUpload(legacy,f.artifact));
   assert.equal((await h.worker('finish',{job_id:legacy.job_id,execution_id:legacy.execution_id})).ok,true);
   return {...f,legacy,complete};
  }});

  await scenario('a completed background music result stays usable while a pending background job cannot create a browser parent',async()=>{
   const {job,claimed,artifact}=await h.family(),before=await h.identity(job);
   await db.query("update sma_private.gallery_music_v1 set background_audio='render/synthetic-background.aac' where id=$1",[claimed.id]);
   denied(await h.user('start',request(artifact)),'UPLOAD_UNAVAILABLE');assert.equal(await h.count('publication_uploads_v1'),0);
   const reservation=await h.authenticated('sma_publication_upload_v1',['start',uploadInput(artifact)]);
   assert.equal(reservation.status,'initializing');
   const drive='synthetic_background_output',folder='synthetic_processing_folder';
   const ready=await h.business('sma_publication_upload_bind_v1',[artifact.upload_id,reservation.lease_id,drive,folder,
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=synthetic_background']);assert.equal(ready.status,'ready');
   const asset=await catalogueReceipt({artifact,drive});
   const receipt=await h.business('sma_publication_upload_finish_v1',[artifact.upload_id,{upload_id:artifact.upload_id,drive_file_id:drive,folder_id:folder,
    name:artifact.name,mime_type:artifact.mime_type,size_bytes:artifact.size_bytes,media_kind:'video',revision:asset.revision,
    modified_at:new Date().toISOString(),width_px:320,height_px:240,duration_ms:10000}]);
   assert.equal(receipt.status,'completed');assert.equal(receipt.asset_id,asset.id);
   assert.equal(await h.value('select state v from sma_private.gallery_music_v1 where id=$1',[claimed.id]),'completed');
   const usable=await h.start(assetAnchor(asset));assert.equal(usable.ok,true);assert.equal((await h.start(assetAnchor(asset))).job_id,usable.job_id);
   assert.deepEqual(await h.identity(job),before);assert.equal(await h.count('publication_uploads_v1'),1);
  });

  await scenario('tampered result receipts cannot gain a family alias or mutate its source',async()=>{
   const {job,artifact}=await h.family(),upload=await h.beginUpload(job,artifact),complete=await h.materializeUpload(job,upload),before=await h.identity(job);
   for(const [assignment,value] of [['revision=$2','sha256:'+'f'.repeat(64)+':1'],['size_bytes=$2',artifact.size_bytes+1],
    ['name=$2','Other.mp4'],['drive_file_id=$2','synthetic_other_drive'],['user_id=$2',other],['customer_id=$2',2]])await savepoint(async()=>{
    await db.query('update sma_private.publication_files_v1 set '+assignment+' where id=$1',[complete.asset.id,value]);
    const revision=await h.value('select revision v from sma_private.publication_files_v1 where id=$1',[complete.asset.id]);
    denied(await h.user('start',{request_id:h.next(),anchor:assetAnchor({...complete.asset,revision})}));
    denied(await h.user('command',{job_id:job.job_id,command_id:h.next(),operation:'magic_video',input:{asset_id:complete.asset.id,asset_revision:revision}}),'INVALID_INPUT');
    assert.equal(await h.count('file_jobs_v1'),1);assert.deepEqual(await h.identity(job),before);
   });
   assert.equal((await h.start(assetAnchor(complete.asset))).job_id,job.job_id);await h.finish(complete.command,complete.result);
   assert.deepEqual(await h.counts(),{jobs:1,starts:1});
  });

  await scenario('frozen music/source/owner changes revoke stale upload capabilities without rewriting the binding',async()=>{
   const {original,job,artifact}=await h.family(),upload=await h.beginUpload(job,artifact),before=await h.identity(job);
   for(const [sql,args] of [
    ["update sma_private.gallery_music_v1 set expected_sha=$2 where id=$1",[artifact.upload_id,'f'.repeat(64)]],
    ["update sma_private.gallery_music_v1 set expected_size=expected_size+1 where id=$1",[artifact.upload_id]],
    ["update sma_private.gallery_music_v1 set source_key=$2 where id=$1",[artifact.upload_id,'sha256:'+'f'.repeat(64)]],
    ["update sma_private.gallery_music_v1 set user_id=$2 where id=$1",[artifact.upload_id,other]],
    ["update sma_private.publication_files_v1 set revision=$2 where id=$1",[original.id,'sha256:'+musicSourceHash+':2']],
    ["update sma_private.publication_files_v1 set revision=$2 where id=$1",[original.id,'sha256:'+'f'.repeat(64)+':3']],
    ["update public.sma_kunden set kunde_email='changed@example.invalid' where id=1",[]]
   ])await savepoint(async()=>{
    await db.query(sql,args);denied(await h.user('start',request(artifact)));
    denied(await h.user('get',{job_id:job.job_id,command_id:upload.command.command.command_id}));
    assert.doesNotMatch(JSON.stringify(await h.user('get',{job_id:job.job_id})),/upload_url|www\.googleapis\.com/);
    assert.equal(await h.count('file_jobs_v1'),1);assert.deepEqual(await h.identity(job),before);
   });
  });

  await scenario('a same-byte editor alias revision reuses the frozen music binding while a changed hash stays blocked',async()=>{
   const original=await h.file(),job=await h.start(assetAnchor(original));await h.bind(job);
   const originalMusic=await h.claimMusic(original,{reserve:false});
   assert.equal((await h.music('audio_present',{id:originalMusic.claimed.id,lease:originalMusic.claimed.lease})).ok,true);
   const exp=await h.editorExport(original),media=await h.completeUpload(job,await h.beginUpload(job,exp.media));
   assert.equal((await h.authenticated('sma_publication_editor_export_v1',['complete',exp.input])).status,'completed');
   const {artifact}=await h.claimMusic(media.asset),joined=await h.start(uploadAnchor(artifact));
   const upload=await h.beginUpload(job,artifact),before=await h.identity(job);
   await savepoint(async()=>{
    await db.query('update sma_private.publication_files_v1 set revision=$2 where id=$1',[media.asset.id,'sha256:'+'f'.repeat(64)+':2']);
    denied(await h.user('start',request(artifact)),'UPLOAD_UNAVAILABLE');
    denied(await h.user('start',{request_id:joined.request_id,anchor:uploadAnchor(artifact)}),'UPLOAD_UNAVAILABLE');
    denied(await h.user('get',{job_id:job.job_id,command_id:upload.command.command.command_id}),'COMMAND_BINDING_CHANGED');
    assert.doesNotMatch(JSON.stringify(await h.user('get',{job_id:job.job_id})),/upload_url|www\.googleapis\.com/);
    assert.deepEqual(await h.counts(),{jobs:1,starts:1});
   });
   const revision=media.asset.revision.replace(/:1$/,':2');await db.query('update sma_private.publication_files_v1 set revision=$2 where id=$1',[media.asset.id,revision]);
   assert.equal((await h.start(assetAnchor({...media.asset,revision}))).job_id,job.job_id,'The original editor family remains valid');
   assert.equal((await h.start(uploadAnchor(artifact))).job_id,job.job_id);
   assert.equal((await h.user('start',{request_id:joined.request_id,anchor:uploadAnchor(artifact)})).job_id,job.job_id);
   assert.equal((await h.user('get',{job_id:job.job_id,command_id:upload.command.command.command_id})).commands[0].response.body.upload_url,upload.url);
   assert.equal(await h.value('select source_asset_revision v from sma_private.file_job_uploads_v1 where upload_id=$1',[artifact.upload_id]),media.asset.revision);
   const completed=await h.completeUpload(job,upload);assert.equal((await h.start(assetAnchor(completed.asset))).job_id,job.job_id);
   assert.equal((await h.worker('claim_start',{job_id:job.job_id})).start,null);
   assert.deepEqual(await h.identity(job),before);assert.deepEqual(await h.counts(),{jobs:1,starts:1});
  });

  await scenario('uncertain and command-exhausted source jobs cannot be bypassed by a music upload',async()=>{
   const {job,artifact}=await h.family();
   for(const condition of ['uncertain','full'])await savepoint(async()=>{
    if(condition==='uncertain')await db.query("update sma_private.file_jobs_v1 set state='uncertain' where id=$1",[job.job_id]);
    else for(let n=0;n<64;n++)await h.enqueue(job,'account',{id:h.next(),platform:'youtube'});
    denied(await h.user('start',request(artifact)),condition==='uncertain'?'JOB_UNCERTAIN':'COMMAND_LIMIT');
    assert.equal(await h.count('file_jobs_v1'),1);assert.equal(await h.count('publication_uploads_v1'),0);
    assert.equal((await h.worker('claim_start',{job_id:job.job_id})).start,null);
   });
  });

  await scenario('joins preserve the 24-hour deadline and an expired job can only be replaced by explicit new work',async()=>{
   const {original,job,artifact}=await h.family();
   await db.query("update sma_private.file_jobs_v1 set created_at=now()-interval '23 hours',deadline_at=now()+interval '1 hour' where id=$1",[job.job_id]);
   const before=await h.identity(job),joined=await h.start(uploadAnchor(artifact));
   assert.equal(joined.job_id,job.job_id);assert.deepEqual(await h.identity(job),before);
   await h.beginUpload(job,artifact);
   await db.query("update sma_private.file_jobs_v1 set created_at=now()-interval '25 hours',deadline_at=now()-interval '1 hour' where id=$1",[job.job_id]);
   denied(await h.user('command',{job_id:job.job_id,command_id:h.next(),operation:'upload_start',input:uploadInput(artifact)}),'JOB_EXPIRED');
   denied(await h.worker('claim_start',{job_id:job.job_id}),'JOB_EXPIRED');
   const oldIdentity=await h.identity(job),newJob=await h.start(assetAnchor(original));assert.notEqual(newJob.job_id,job.job_id);await h.bind(newJob);
   assert.equal((await h.start(uploadAnchor(artifact))).job_id,newJob.job_id);
   assert.deepEqual(await h.identity(job),oldIdentity);assert.deepEqual(await h.counts(),{jobs:2,starts:2});
   assert.equal(await h.value('select extract(epoch from deadline_at-created_at)::int v from sma_private.file_jobs_v1 where id=$1',[newJob.job_id]),86400);
  });

  await scenario('an already-bound legacy music upload retains its own parent across expired leases and uncertain outcomes',async old=>{
   const {original,job,claimed,artifact,legacy,upload}=old,before=await h.identity(legacy),sourceBefore=await h.identity(job);
   await db.query("update sma_private.gallery_music_v1 set lease_until=now()-interval '1 second' where id=$1",[claimed.id]);
   assert.equal((await h.start(uploadAnchor(artifact))).job_id,legacy.job_id);
   assert.equal((await h.user('start',{request_id:legacy.request_id,anchor:uploadAnchor(artifact)})).job_id,legacy.job_id);
   await savepoint(async()=>{
    await db.query("update sma_private.file_jobs_v1 set state='uncertain' where id=$1",[legacy.job_id]);
    assert.equal((await h.start(uploadAnchor(artifact))).job_id,legacy.job_id);
    denied(await h.user('command',{job_id:legacy.job_id,command_id:h.next(),operation:'upload_finish',input:{upload_id:artifact.upload_id}}),'JOB_UNCERTAIN');
    assert.equal((await h.worker('claim_start',{job_id:legacy.job_id})).start,null);
   });
   const renewed=await h.claimMusic(original);assert.equal(renewed.claimed.id,claimed.id);assert.notEqual(renewed.claimed.lease,claimed.lease);
   assert.equal((await h.start(uploadAnchor(artifact))).job_id,legacy.job_id);
   const complete=await h.completeUpload(legacy,upload);assert.equal((await h.start(assetAnchor(complete.asset))).job_id,legacy.job_id);
   assert.deepEqual(await h.identity(legacy),{...before,asset_id:complete.asset.id,asset_revision:complete.asset.revision});
   assert.deepEqual(await h.identity(job),sourceBefore);
   assert.deepEqual(await h.counts(),{jobs:2,starts:2});
  },{beforePatch:async()=>{
   const f=await h.family(),legacy=await h.start(uploadAnchor(f.artifact));await h.bind(legacy);
   return {...f,legacy,upload:await h.beginUpload(legacy,f.artifact)};
  }});

  await scenario('business RPCs and private bindings retain their original permission boundaries',async()=>{
   assert.deepEqual(await businessSnapshot(),businessBefore);
   for(const table of ['file_job_uploads_v1','file_job_assets_v1']){
    assert.equal(await h.value('select relrowsecurity v from pg_class where oid=$1::regclass',['sma_private.'+table]),true);
    for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE']){
     assert.equal(await h.value('select has_table_privilege($1,$2,$3) v',[role,'sma_private.'+table,privilege]),false);
    }
   }
   assert.equal(await h.value("select has_function_privilege('authenticated','public.sma_file_job_worker_v1(text,jsonb)','EXECUTE') v"),false);
   assert.equal(await h.value("select has_function_privilege('service_role','public.sma_file_job_v1(text,jsonb)','EXECUTE') v"),false);
  });
 }finally{await db.close();}
});
