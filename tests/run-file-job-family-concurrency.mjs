// Real PostgreSQL sessions against one NEW dedicated localhost CI database.
// This runner never connects to an application database or transfers media.
import assert from 'node:assert/strict';
import pg from './postgres-runtime/node_modules/pg/lib/index.js';
import {fileFamilyUUID as uuid,fileFamilyOwner as owner,fileFamilySource,
 installFileFamilyBaseline} from './sql-runtime/file-job-family-fixture.mjs';

const url=new URL(process.env.SMA_FILE_FAMILY_DATABASE_URL??'postgresql://postgres@127.0.0.1:55439/sma_file_family_test');
assert.ok(['postgresql:','postgres:'].includes(url.protocol)&&['127.0.0.1','localhost'].includes(url.hostname)&&
 url.port==='55439'&&url.username==='postgres'&&url.pathname==='/sma_file_family_test'&&!url.search&&!url.hash,
 'Only the dedicated localhost:55439/sma_file_family_test database is permitted');
const bootstrapURL=new URL(url);bootstrapURL.pathname='/postgres';
const connection=connectionString=>new pg.Client({connectionString,statement_timeout:8000,lock_timeout:6000,query_timeout:10000});
const bootstrap=connection(bootstrapURL.href),clients=[];let admin,a,b,counter=100,phases=new Map();
const next=()=>uuid(++counter),value=async(client,sql,args=[])=>(await client.query(sql,args)).rows[0]?.v;
const settled=promise=>promise.then(value=>({value}),error=>({error}));
const unwrap=async promise=>{const result=await promise;if(result.error)throw result.error;return result.value;};
const raw=(client,name,args)=>value(client,'select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args);
const user=(client,action,input)=>raw(client,'sma_file_job_v1',[action,input]);
const worker=(client,action,input)=>raw(client,'sma_file_job_worker_v1',[action,input]);
async function begin(client,role){
 assert.ok(['authenticated','service_role'].includes(role));await client.query('begin');
 await client.query('set local role '+role);await client.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
}
async function one(role,fn){
 await begin(admin,role);
 try{const result=await fn(admin);await admin.query('commit');return result;}
 catch(error){await admin.query('rollback');throw error;}
}
const oneUser=(action,input)=>one('authenticated',client=>user(client,action,input));
const oneWorker=(action,input)=>one('service_role',client=>worker(client,action,input));
const oneBusiness=(name,args)=>one('service_role',client=>raw(client,name,args));
const anchor=artifact=>({kind:'upload',upload_id:artifact.upload_id,name:artifact.name,mime_type:artifact.mime_type,size_bytes:artifact.size_bytes});
const input=artifact=>{const {kind,...rest}=anchor(artifact);return rest;};
const assetAnchor=file=>({kind:'asset',asset_id:file.id,asset_revision:file.revision});
const request=artifact=>({request_id:next(),anchor:anchor(artifact)});
async function waitForLock(pid){
 const until=Date.now()+4000;
 while(Date.now()<until){
  const row=(await admin.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0];
  if(row?.wait_event_type==='Lock')return;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 throw Error('The second independent PostgreSQL session did not reach the intended lock boundary');
}
async function sourceExport(){
 const id=next(),revision='sha256:'+'a'.repeat(64)+':1';
 await admin.query(`insert into sma_private.publication_files_v1
  (id,user_id,customer_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,width_px,height_px,duration_ms)
  values($1,$2,1,$3,'Synthetic source.mp4','video','video/mp4',$4,now(),2048,320,240,10000)`,[id,owner,'synthetic_source_'+counter,revision]);
 const source={id,revision};
 const saved=await one('authenticated',client=>raw(client,'sma_publication_editor_v1',['save',{
  asset_id:id,asset_revision:revision,revision:0,request_id:next(),settings:{format:'original',fit:'contain',position_x:50,position_y:50,
   start_ms:0,end_ms:null,cover_ms:500,overlay_text:'',overlay_position:'bottom',audio_volume:100}}]));
 assert.equal(saved.revision,1);
 const prepared={asset_id:id,asset_revision:revision,draft_revision:1,export_id:next()};
 const outputs={media:{sha256:'b'.repeat(64),size_bytes:3072},cover:{sha256:'c'.repeat(64),size_bytes:512}};
 const receipt=await one('authenticated',client=>raw(client,'sma_publication_editor_export_v1',['prepare',{...prepared,outputs}]));
 assert.equal(receipt.ok,true);
 return {source,prepared,media:{...receipt.media,...outputs.media,kind:'video'},cover:{...receipt.cover,...outputs.cover,kind:'image'}};
}
async function enqueue(job,operation,payload){
 const result=await oneUser('command',{job_id:job.job_id,command_id:next(),operation,input:payload});
 assert.equal(result.ok,true,JSON.stringify(result));return result.commands[0].command_id;
}
async function take(job,commandId){
 const phase=(phases.get(job.job_id)||0)+1;
 const wait=await oneWorker('wait',{job_id:job.job_id,execution_id:job.execution_id,phase_seq:phase,
  resume_url:'https://johnmusic.app.n8n.cloud/webhook-waiting/'+job.execution_id+'/file-command-'+phase+'?signature=synthetic_signature_value'});
 assert.equal(wait.ok,true);assert.equal(wait.wait,false,'Queued work is accepted inline by the same parent');
 phases.set(job.job_id,wait.phase_seq);assert.equal(wait.dispatch.command_id,commandId);
 const claim={job_id:job.job_id,command_id:commandId,command_ticket:wait.dispatch.command_ticket,
  parent_execution_id:job.execution_id,child_execution_id:'concurrent_child_'+ ++counter};
 assert.equal((await oneWorker('claim',claim)).ok,true);
 const {parent_execution_id,...key}=claim;return key;
}
async function result(key,body){
 assert.equal((await oneWorker('result',{...key,status:200,body})).ok,true);
 assert.equal((await oneWorker('completed',{...key,outcome:'completed'})).ok,true);
}
async function readyUpload(artifact,key,reservation){
 assert.equal(reservation.initialize,true);assert.equal(reservation.upload_id,artifact.upload_id);
 const drive='synthetic_drive_'+ ++counter,folder='synthetic_processing_folder',
  uploadURL='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=synthetic_'+counter;
 const ready=await oneBusiness('sma_publication_upload_bind_v1',[artifact.upload_id,reservation.lease_id,drive,folder,uploadURL]);
 assert.equal(ready.status,'ready');await result(key,ready);return {artifact,drive,folder,reservation};
}
async function finishRow(job,upload){
 const id=await enqueue(job,'upload_finish',{upload_id:upload.artifact.upload_id}),key=await take(job,id);
 const reservation=await oneWorker('reserve',key);assert.equal(reservation.status,'ready');
 const artifact=upload.artifact,revision='sha256:'+artifact.sha256+':1';
 const response=await oneBusiness('sma_publication_upload_finish_v1',[artifact.upload_id,{
  drive_file_id:upload.drive,folder_id:upload.folder,upload_id:artifact.upload_id,name:artifact.name,mime_type:artifact.mime_type,
  size_bytes:artifact.size_bytes,media_kind:artifact.kind,revision,modified_at:new Date().toISOString(),width_px:320,height_px:240,
  duration_ms:artifact.kind==='video'?10000:null}]);
 assert.equal(response.status,'completed');
 return {key,response,reservation,asset:{id:response.asset_id,revision}};
}
try{
 await bootstrap.connect();
 assert.equal(await value(bootstrap,"select count(*)::int v from pg_database where datname='sma_file_family_test'"),0,
  'Refusing to reuse or overwrite an existing file-family test database');
 const roles=(await bootstrap.query("select rolname,rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role') order by rolname")).rows;
 assert.equal(roles.length,3,'Run after the isolated music concurrency fixture creates its global roles');
 assert.equal(roles.find(role=>role.rolname==='service_role').rolbypassrls,true);
 await bootstrap.query('create database sma_file_family_test');await bootstrap.end();
 [admin,a,b]=[0,1,2].map(()=>connection(url.href));clients.push(admin,a,b);
 await Promise.all(clients.map(client=>client.connect()));
 assert.equal(await value(admin,"select to_regnamespace('sma_private') v"),null);
 assert.equal(await value(admin,"select count(*)::int v from information_schema.tables where table_schema='public'"),0);
 await installFileFamilyBaseline({exec:sql=>admin.query(sql),query:(sql,args)=>admin.query(sql,args)},{createRoles:false});
 await admin.query(await fileFamilySource('file-job-export-family'));
 const bpid=await value(b,'select pg_backend_pid() v'),exp=await sourceExport();

 // A media start and a cover start race before any parent exists. The second
 // transaction must observe the committed family rather than create its own.
 await begin(a,'authenticated');await begin(b,'authenticated');
 const mediaJoin=await user(a,'start',request(exp.media));assert.equal(mediaJoin.ok,true,JSON.stringify(mediaJoin));
 const coverPending=settled(user(b,'start',request(exp.cover)));await waitForLock(bpid);await a.query('commit');
 const coverJoin=await unwrap(coverPending);assert.equal(coverJoin.ok,true,JSON.stringify(coverJoin));await b.query('commit');
 assert.equal(mediaJoin.job_id,coverJoin.job_id);assert.equal(mediaJoin.asset_id,exp.source.id);
 assert.equal(await value(admin,'select count(*)::int v from sma_private.file_jobs_v1'),1);
 const job={...mediaJoin,execution_id:'concurrent_family_parent'};

 // The shared job still has exactly one initial execution claim under two
 // independent worker sessions; no second claim may mint a second start.
 await begin(a,'service_role');await begin(b,'service_role');
 const firstClaim=await worker(a,'claim_start',{job_id:job.job_id});assert.ok(firstClaim.start);
 const secondClaim=settled(worker(b,'claim_start',{job_id:job.job_id}));await waitForLock(bpid);await a.query('commit');
 assert.equal((await unwrap(secondClaim)).start,null);await b.query('commit');
 assert.equal((await oneWorker('bind',{job_id:job.job_id,start_ticket:firstClaim.start.start_ticket,execution_id:job.execution_id})).already_bound,false);

 // Two fresh browser request IDs for the same upload join the existing family,
 // including its still-initializing upload and original lease reservation.
 await begin(a,'authenticated');await begin(b,'authenticated');
 assert.equal((await user(a,'start',request(exp.media))).job_id,job.job_id);
 const sameUpload=settled(user(b,'start',request(exp.media)));await waitForLock(bpid);await a.query('commit');
 assert.equal((await unwrap(sameUpload)).job_id,job.job_id);await b.query('commit');

 // Competing start commands get one canonical ID for THIS artifact. Replaying
 // reserve in two sessions must return the original initialize=true lease.
 const commandInput={job_id:job.job_id,operation:'upload_start',input:input(exp.media)};
 await begin(a,'authenticated');await begin(b,'authenticated');
 const canonical=await user(a,'command',{...commandInput,command_id:next()});assert.equal(canonical.ok,true);
 const requested=next(),duplicate=settled(user(b,'command',{...commandInput,command_id:requested}));
 await waitForLock(bpid);await a.query('commit');const replay=await unwrap(duplicate);await b.query('commit');
 assert.equal(replay.commands[0].command_id,canonical.commands[0].command_id);
 assert.equal((await oneUser('get',{job_id:job.job_id,command_id:requested})).commands[0].command_id,canonical.commands[0].command_id);
 const mediaKey=await take(job,canonical.commands[0].command_id);
 await begin(a,'service_role');await begin(b,'service_role');
 const mediaLease=await worker(a,'reserve',mediaKey),leasePending=settled(worker(b,'reserve',mediaKey));
 await waitForLock(bpid);await a.query('commit');assert.deepEqual(await unwrap(leasePending),mediaLease);await b.query('commit');
 assert.equal(mediaLease.initialize,true);assert.ok(mediaLease.lease_id);
 const media=await readyUpload(exp.media,mediaKey,mediaLease);
 const coverCommand=await enqueue(job,'upload_start',input(exp.cover));assert.notEqual(coverCommand,canonical.commands[0].command_id);
 const coverKey=await take(job,coverCommand),coverLease=await oneWorker('reserve',coverKey);
 assert.notEqual(coverLease.lease_id,mediaLease.lease_id);assert.equal(coverLease.initialize,true);
 const cover=await readyUpload(exp.cover,coverKey,coverLease);

 // Worker-first ordering: a reserve holds its locks; an asset join waits.
 // Capturing the completed upload must not invert the owner/job/file lock
 // order or deadlock against that join. Result is still before completed.
 const mediaFinish=await finishRow(job,media);
 await begin(a,'service_role');await begin(b,'authenticated');
 assert.deepEqual(await worker(a,'reserve',mediaFinish.key),mediaFinish.reservation);
 const mediaAlias=settled(user(b,'start',{request_id:next(),anchor:assetAnchor(mediaFinish.asset)}));
 await waitForLock(bpid);
 assert.equal((await worker(a,'result',{...mediaFinish.key,status:200,body:mediaFinish.response})).ok,true);
 await a.query('commit');assert.equal((await unwrap(mediaAlias)).job_id,job.job_id);await b.query('commit');
 assert.equal((await oneUser('get',{job_id:job.job_id,command_id:mediaFinish.key.command_id})).commands[0].state,'running');
 assert.equal((await oneWorker('completed',{...mediaFinish.key,outcome:'completed'})).ok,true);

 // Join-first ordering: the real upload row is already completed but no
 // mailbox result or editor completion exists. The asset join must resolve
 // the same parent; a simultaneous reserve waits and returns its first lease.
 const coverFinish=await finishRow(job,cover);
 await begin(a,'authenticated');await begin(b,'service_role');
 const earlyAlias=await user(a,'start',{request_id:next(),anchor:assetAnchor(coverFinish.asset)});
 assert.equal(earlyAlias.job_id,job.job_id);
 assert.equal(await value(admin,'select response_status is null v from sma_private.file_commands_v1 where id=$1',[coverFinish.key.command_id]),true);
 assert.equal(await value(admin,'select completed_at is null v from sma_private.publication_editor_exports_v1 where id=$1',[exp.prepared.export_id]),true);
 const afterAlias=settled(worker(b,'reserve',coverFinish.key));await waitForLock(bpid);await a.query('commit');
 assert.deepEqual(await unwrap(afterAlias),coverFinish.reservation);
 assert.equal((await worker(b,'result',{...coverFinish.key,status:200,body:coverFinish.response})).ok,true);
 await b.query('commit');assert.equal((await oneWorker('completed',{...coverFinish.key,outcome:'completed'})).ok,true);

 const done=await one('authenticated',client=>raw(client,'sma_publication_editor_export_v1',['complete',exp.prepared]));
 assert.equal(done.status,'completed');assert.equal(done.media.asset_id,mediaFinish.asset.id);assert.equal(done.cover.asset_id,coverFinish.asset.id);
 assert.equal(await value(admin,'select count(*)::int v from sma_private.file_jobs_v1'),1);
 assert.equal(await value(admin,'select count(*)::int v from sma_private.file_jobs_v1 where start_claimed_at is not null'),1);
 assert.equal(await value(admin,'select count(*)::int v from sma_private.file_commands_v1'),4);
 const identity=(await admin.query('select asset_id,asset_revision,execution_id from sma_private.file_jobs_v1 where id=$1',[job.job_id])).rows[0];
 assert.deepEqual(identity,{asset_id:exp.source.id,asset_revision:exp.source.revision,execution_id:job.execution_id});
 console.log('Native PostgreSQL family concurrency passed: parallel media/cover, one start claim, canonical upload replay, original lease replay, worker-first and join-first completion races; one parent and four upload commands.');
}finally{
 await Promise.allSettled(clients.map(client=>client.query('rollback')));
 await Promise.allSettled(clients.map(client=>client.end()));
 try{await bootstrap.end();}catch{}
}
