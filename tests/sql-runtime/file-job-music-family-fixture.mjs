// Synthetic PostgreSQL schema and real repository RPCs shared by the PGlite
// contract tests and the dedicated localhost concurrency runner. No HTTP.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileFamilyUUID as uuid,fileFamilyOwner as owner,fileFamilyOther as other,
 fileFamilySource as source,installFileFamilyBaseline} from './file-job-family-fixture.mjs';

export {uuid,owner,other,source};
export const musicSourceHash='a'.repeat(64),musicOutputHash='b'.repeat(64),musicTrackHash='d'.repeat(64);
export const assetAnchor=file=>({kind:'asset',asset_id:file.id,asset_revision:file.revision});
export const uploadInput=artifact=>({upload_id:artifact.upload_id,name:artifact.name,
 mime_type:artifact.mime_type,size_bytes:artifact.size_bytes});
export const uploadAnchor=artifact=>({kind:'upload',...uploadInput(artifact)});

export async function installMusicFileFamilyBaseline(db,options={}){
 await installFileFamilyBaseline(db,options);
 await db.exec(await source('file-job-export-family'));
 await db.exec(`alter table public.sma_kunden add column paket text;
  create schema storage;grant usage on schema storage to authenticated,anon;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
  alter table storage.objects enable row level security;
  grant select,insert,update,delete on storage.objects to authenticated,anon;
  -- Registration is inert here; this local database has no scheduler or HTTP extension.
  create schema cron;
  create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;`);
 for(const name of ['music-credits','gallery-music','gallery-music-receipt','gallery-music-background'])await db.exec(await source(name));
 await db.exec(await readFile(new URL('../../supabase/migrations/20261111123000_gallery_music_no_track_backoff_v1.sql',import.meta.url),'utf8'));
 // Install the production music lineage resolver without unrelated product UI
 // functions. Its complete definition precedes that migration's product patch.
 const lineage=await source('gallery-music-product-context'),boundary=lineage.indexOf('\ndo $migration$');
 assert.ok(boundary>0);await db.exec(lineage.slice(0,boundary));
 await db.query(`insert into sma_private.music_catalog_v1(sha256,name,mime_type,size_bytes,listed)
  values($1,'Synthetic licensed music','audio/wav',1200,true)`,[musicTrackHash]);
 await db.query("insert into storage.objects values('sma-katalog',$1,$2)",[musicTrackHash+'.wav',{size:1200,mimetype:'audio/wav'}]);
}

export function musicFileFamilyHarness(db){
 let counter=100,phases=new Map();
 const next=()=>uuid(++counter);
 const value=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.v;
 async function role(name,fn){
  assert.ok(['authenticated','service_role'].includes(name));
  await db.exec('set role '+name);try{return await fn();}finally{await db.exec('reset role');}
 }
 const raw=(name,args)=>value('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args);
 async function authenticated(name,args,uid=owner){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
  return role('authenticated',()=>raw(name,args));
 }
 const user=(action,input,uid=owner)=>authenticated('sma_file_job_v1',[action,input],uid);
 const music=(action,input={},uid=owner)=>authenticated('sma_gallery_music_v1',[action,input],uid);
 const worker=(action,input)=>role('service_role',()=>raw('sma_file_job_worker_v1',[action,input]));
 const business=(name,args)=>role('service_role',()=>raw(name,args));
 const count=table=>value('select count(*)::int v from sma_private.'+table);
 const counts=async()=>({jobs:await count('file_jobs_v1'),starts:await value('select count(*)::int v from sma_private.file_jobs_v1 where start_claimed_at is not null')});
 const identity=job=>value(`select jsonb_build_object('anchor',anchor,'anchor_key',anchor_key,
  'asset_id',asset_id,'asset_revision',asset_revision,'upload_id',upload_id,'created_at',created_at,
  'deadline_at',deadline_at,'execution_id',execution_id) v from sma_private.file_jobs_v1 where id=$1`,[job.job_id]);
 async function file({uid=owner,customer=1,revision='sha256:'+musicSourceHash+':1',kind='video'}={}){
  const id=next(),mime=kind==='video'?'video/mp4':'image/png';
  await db.query(`insert into sma_private.publication_files_v1
   (id,user_id,customer_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,width_px,height_px,duration_ms)
   values($1,$2,$3,$4,$5,$6,$7,$8,now(),2048,320,240,$9)`,
   [id,uid,customer,'synthetic_music_source_'+counter,'Synthetic source.'+(kind==='video'?'mp4':'png'),kind,mime,revision,kind==='video'?10000:null]);
  return {id,revision,kind};
 }
 async function start(anchor,requestId=next(),uid=owner){
  const result=await user('start',{request_id:requestId,anchor},uid);
  assert.equal(result.ok,true,JSON.stringify(result));return {...result,request_id:requestId,anchor};
 }
 async function bind(job){
  const result=await worker('claim_start',{job_id:job.job_id});assert.ok(result.start,JSON.stringify(result));
  job.execution_id='synthetic_music_parent_'+ ++counter;job.start_ticket=result.start.start_ticket;
  assert.equal((await worker('bind',{job_id:job.job_id,start_ticket:job.start_ticket,execution_id:job.execution_id})).already_bound,false);
  return job;
 }
 async function claimMusic(original,{reserve=true,sha256=musicOutputHash,size_bytes=3072,uid=owner}={}){
  const claimed=await music('claim',{},uid);assert.equal(claimed.state,'claimed',JSON.stringify(claimed));
  assert.equal(claimed.file.id,original.id);assert.equal(claimed.file.revision,original.revision);
  if(reserve)assert.equal((await music('reserve',{id:claimed.id,lease:claimed.lease,sha256,size_bytes},uid)).ok,true);
  return {claimed,artifact:{upload_id:claimed.id,name:claimed.name,mime_type:'video/mp4',size_bytes,sha256,kind:'video'}};
 }
 async function family(){
  const original=await file(),job=await start(assetAnchor(original));await bind(job);
  return {original,job,...await claimMusic(original)};
 }
 async function enqueue(job,operation,input,commandId=next()){
  const request={job_id:job.job_id,command_id:commandId,operation,input};
  const result=await user('command',request);assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.commands.length,1);return {request,command_id:result.commands[0].command_id};
 }
 async function take(job,command){
  const phase=(phases.get(job.job_id)||0)+1;
  const waiting=await worker('wait',{job_id:job.job_id,execution_id:job.execution_id,phase_seq:phase,
   resume_url:'https://johnmusic.app.n8n.cloud/webhook-waiting/'+job.execution_id+'/file-command-'+phase+'?signature=synthetic_signature_value'});
  assert.equal(waiting.ok,true,JSON.stringify(waiting));let dispatch;
  if(waiting.wait===false){dispatch=waiting.dispatch;phases.set(job.job_id,waiting.phase_seq);}
  else{
   phases.set(job.job_id,phase);const {delivery}=await worker('claim_delivery',{job_id:job.job_id});
   assert.equal(delivery.event_id,command.command_id);
   dispatch=await worker('accept',{job_id:job.job_id,event_id:delivery.event_id,phase_seq:phase,
    execution_id:job.execution_id,ticket:delivery.ticket});
  }
  assert.equal(dispatch.command_id,command.command_id);assert.ok(dispatch.command_ticket);
  const key={job_id:job.job_id,command_id:command.command_id,command_ticket:dispatch.command_ticket,child_execution_id:'synthetic_music_child_'+ ++counter};
  const context=await worker('claim',{...key,parent_execution_id:job.execution_id});assert.equal(context.ok,true,JSON.stringify(context));
  return {key,context};
 }
 async function run(job,operation,input){
  const command=await enqueue(job,operation,input),claimed=await take(job,command);
  assert.equal(claimed.context.operation,operation);assert.deepEqual(claimed.context.input,input);
  return {...claimed,command,reservation:await worker('reserve',claimed.key)};
 }
 async function finish(command,body,outcome='completed'){
  assert.equal((await worker('result',{...command.key,status:200,body})).ok,true);
  assert.equal((await worker('completed',{...command.key,outcome})).ok,true);
 }
 async function beginUpload(job,artifact){
  assert.equal((await start(uploadAnchor(artifact))).job_id,job.job_id);
  const command=await run(job,'upload_start',uploadInput(artifact)),reservation=command.reservation;
  assert.equal(reservation.ok,true,JSON.stringify(reservation));assert.equal(reservation.initialize,true);
  assert.ok(reservation.lease_id);assert.equal(reservation.upload_id,artifact.upload_id);
  assert.deepEqual(await worker('reserve',command.key),reservation,'The original upload initialization lease survives retries');
  const drive='synthetic_music_output_'+ ++counter,folder='synthetic_processing_folder';
  const url='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=synthetic_music_'+counter;
  const ready=await business('sma_publication_upload_bind_v1',[artifact.upload_id,reservation.lease_id,drive,folder,url]);
  assert.equal(ready.status,'ready',JSON.stringify(ready));await finish(command,ready);
  return {artifact,command,drive,folder,url,ready};
 }
 async function materializeUpload(job,upload){
  const {artifact}=upload,command=await run(job,'upload_finish',{upload_id:artifact.upload_id});
  assert.equal(command.reservation.status,'ready',JSON.stringify(command.reservation));
  assert.equal(command.reservation.upload_id,artifact.upload_id);
  const payload={drive_file_id:upload.drive,folder_id:upload.folder,upload_id:artifact.upload_id,
   name:artifact.name,mime_type:artifact.mime_type,size_bytes:artifact.size_bytes,media_kind:artifact.kind,
   revision:'sha256:'+artifact.sha256+':1',modified_at:new Date().toISOString(),width_px:320,height_px:240,
   duration_ms:artifact.kind==='video'?10000:null};
  const result=await business('sma_publication_upload_finish_v1',[artifact.upload_id,payload]);
  assert.equal(result.status,'completed',JSON.stringify(result));
  return {command,result,payload,asset:{id:result.asset_id,revision:payload.revision,kind:artifact.kind}};
 }
 async function completeUpload(job,upload){const completed=await materializeUpload(job,upload);await finish(completed.command,completed.result);return completed;}
 async function editorExport(original,{id=next(),cover=false}={}){
  let draft_revision=0;
  if(cover){
   const result=await authenticated('sma_publication_editor_v1',['save',{asset_id:original.id,asset_revision:original.revision,revision:0,request_id:next(),
    settings:{format:'original',fit:'contain',position_x:50,position_y:50,start_ms:0,end_ms:null,cover_ms:500,overlay_text:'',overlay_position:'bottom',audio_volume:100}}]);
   assert.equal(result.ok,true,JSON.stringify(result));draft_revision=result.revision;
  }
  const input={asset_id:original.id,asset_revision:original.revision,draft_revision,export_id:id};
  const outputs={media:{sha256:'c'.repeat(64),size_bytes:4096},cover:cover?{sha256:'e'.repeat(64),size_bytes:512}:null};
  const receipt=await authenticated('sma_publication_editor_export_v1',['prepare',{...input,outputs}]);assert.equal(receipt.ok,true,JSON.stringify(receipt));
  return {input,outputs,receipt,media:{...receipt.media,...outputs.media,kind:original.kind},
   cover:receipt.cover?{...receipt.cover,...outputs.cover,kind:'image'}:null};
 }
 return {db,next,value,raw,role,authenticated,user,music,worker,business,count,counts,identity,file,start,bind,
  claimMusic,family,enqueue,take,run,finish,beginUpload,materializeUpload,completeUpload,editorExport,
  reset(){counter=100;phases=new Map();}};
}
