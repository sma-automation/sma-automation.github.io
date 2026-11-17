// Two real PostgreSQL sessions, one NEW dedicated localhost CI database.
// This runner never connects to an application database or transfers media.
import assert from 'node:assert/strict';
import pg from './postgres-runtime/node_modules/pg/lib/index.js';
import {owner,source,assetAnchor,uploadAnchor,uploadInput,installMusicFileFamilyBaseline,musicFileFamilyHarness}
 from './sql-runtime/file-job-music-family-fixture.mjs';

const database='sma_file_music_family_test';
const url=new URL(process.env.SMA_FILE_MUSIC_FAMILY_DATABASE_URL??'postgresql://postgres@127.0.0.1:55439/'+database);
assert.ok(['postgresql:','postgres:'].includes(url.protocol)&&['127.0.0.1','localhost'].includes(url.hostname)&&
 url.port==='55439'&&url.username==='postgres'&&url.pathname==='/'+database&&!url.search&&!url.hash,
 'Only the dedicated localhost:55439/sma_file_music_family_test database is permitted');
const bootstrapURL=new URL(url);bootstrapURL.pathname='/postgres';
const connection=connectionString=>new pg.Client({connectionString,statement_timeout:8000,lock_timeout:6000,query_timeout:10000});
const bootstrap=connection(bootstrapURL.href),clients=[];let admin,a,b,h;
const value=async(client,sql,args=[])=>(await client.query(sql,args)).rows[0]?.v;
const raw=(client,name,args)=>value(client,'select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args);
const user=(client,action,input)=>raw(client,'sma_file_job_v1',[action,input]);
const worker=(client,action,input)=>raw(client,'sma_file_job_worker_v1',[action,input]);
const request=anchor=>({request_id:h.next(),anchor});
const settled=promise=>promise.then(value=>({value}),error=>({error}));
const unwrap=async promise=>{const result=await promise;if(result.error)throw result.error;return result.value;};
async function begin(client,role){
 assert.ok(['authenticated','service_role'].includes(role));await client.query('begin');
 await client.query('set local role '+role);await client.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
}
async function waitForLock(pid,blocker=null){
 const until=Date.now()+4000;
 while(Date.now()<until){
  const row=(await admin.query('select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[pid])).rows[0];
  if(row?.wait_event_type==='Lock'&&(blocker===null||row.blockers.includes(blocker)))return;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 throw Error('The second independent PostgreSQL session did not reach the intended lock boundary');
}

try{
 await bootstrap.connect();
 assert.equal(await value(bootstrap,'select count(*)::int v from pg_database where datname=$1',[database]),0,
  'Refusing to reuse, overwrite or drop an existing music-family test database');
 const roles=(await bootstrap.query("select rolname,rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role') order by rolname")).rows;
 assert.equal(roles.length,3,'Run after the isolated music concurrency fixture creates its global roles');
 assert.equal(roles.find(role=>role.rolname==='service_role').rolbypassrls,true);
 await bootstrap.query('create database sma_file_music_family_test');await bootstrap.end();
 [admin,a,b]=[0,1,2].map(()=>connection(url.href));clients.push(admin,a,b);
 await Promise.all(clients.map(client=>client.connect()));
 assert.equal(await value(admin,"select to_regnamespace('sma_private') v"),null);
 assert.equal(await value(admin,"select count(*)::int v from information_schema.tables where table_schema='public'"),0);
 const db={exec:sql=>admin.query(sql),query:(sql,args)=>admin.query(sql,args)};
 await installMusicFileFamilyBaseline(db,{createRoles:false});await admin.query(await source('file-job-music-family'));
 h=musicFileFamilyHarness(db);const bpid=await value(b,'select pg_backend_pid() v'),apid=await value(a,'select pg_backend_pid() v');

 // Source first: a new music upload races a source start. The second session
 // must observe the committed source family, never create an upload parent.
 const original=await h.file(),{artifact,claimed}=await h.claimMusic(original);
 await begin(a,'authenticated');await begin(b,'authenticated');
 const sourceStart=await user(a,'start',request(assetAnchor(original)));assert.equal(sourceStart.ok,true);
 const musicPending=settled(user(b,'start',request(uploadAnchor(artifact))));await waitForLock(bpid);
 await a.query('commit');const musicStart=await unwrap(musicPending);await b.query('commit');
 assert.equal(musicStart.ok,true,JSON.stringify(musicStart));assert.equal(musicStart.job_id,sourceStart.job_id);
 assert.equal(musicStart.asset_id,original.id);assert.equal(await h.count('file_jobs_v1'),1);
 const job={...sourceStart,execution_id:'concurrent_music_family_parent'};

 // Two native workers compete for the same initial start ticket.
 await begin(a,'service_role');await begin(b,'service_role');
 const first=await worker(a,'claim_start',{job_id:job.job_id});assert.ok(first.start);
 const second=settled(worker(b,'claim_start',{job_id:job.job_id}));await waitForLock(bpid);
 await a.query('commit');assert.equal((await unwrap(second)).start,null);await b.query('commit');
 assert.equal((await h.worker('bind',{job_id:job.job_id,start_ticket:first.start.start_ticket,execution_id:job.execution_id})).already_bound,false);
 const before=await h.identity(job);

 // Distinct browser request IDs still share one reserved upload and job.
 await begin(a,'authenticated');await begin(b,'authenticated');
 assert.equal((await user(a,'start',request(uploadAnchor(artifact)))).job_id,job.job_id);
 const joinAgain=settled(user(b,'start',request(uploadAnchor(artifact))));await waitForLock(bpid);
 await a.query('commit');assert.equal((await unwrap(joinAgain)).job_id,job.job_id);await b.query('commit');

 // Competing upload_start commands keep one canonical ID and one lease.
 const commandInput={job_id:job.job_id,operation:'upload_start',input:uploadInput(artifact)};
 await begin(a,'authenticated');await begin(b,'authenticated');
 const command=await user(a,'command',{...commandInput,command_id:h.next()});assert.equal(command.ok,true);
 const requested=h.next(),commandPending=settled(user(b,'command',{...commandInput,command_id:requested}));await waitForLock(bpid);
 await a.query('commit');const duplicate=await unwrap(commandPending);await b.query('commit');
 const commandId=command.commands[0].command_id;assert.equal(duplicate.commands[0].command_id,commandId);
 assert.equal((await h.user('get',{job_id:job.job_id,command_id:requested})).commands[0].command_id,commandId);
 const taken=await h.take(job,{command_id:commandId});
 await begin(a,'service_role');await begin(b,'service_role');
 const reservation=await worker(a,'reserve',taken.key),reservePending=settled(worker(b,'reserve',taken.key));await waitForLock(bpid);
 await a.query('commit');assert.deepEqual(await unwrap(reservePending),reservation);await b.query('commit');
 assert.equal(reservation.initialize,true);assert.ok(reservation.lease_id);
 const drive='synthetic_concurrent_music_output',folder='synthetic_processing_folder';
 const ready=await h.business('sma_publication_upload_bind_v1',[artifact.upload_id,reservation.lease_id,drive,folder,
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=synthetic_music_family']);
 assert.equal(ready.status,'ready');await h.finish(taken,ready);

 // Real catalogue receipt while the upload is still ready (e.g. a closed
 // tab). An actual concurrent catalogue writer must win over stale reads.
 const resultId=h.next(),revision='sha256:'+artifact.sha256+':1';
 await admin.query(`insert into sma_private.publication_files_v1(id,user_id,customer_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,width_px,height_px,duration_ms)
  values($1,$2,1,$3,$4,'video','video/mp4',$5,now(),$6,320,240,10000)`,[resultId,owner,drive,artifact.name,revision,artifact.size_bytes]);
 assert.equal(await h.value('select state v from sma_private.gallery_music_v1 where id=$1',[claimed.id]),'completed');
 assert.equal(await h.value('select status v from sma_private.publication_uploads_v1 where id=$1',[artifact.upload_id]),'ready');
 const asset={id:resultId,revision};
 const uploadBefore=await h.value('select to_jsonb(u) v from sma_private.publication_uploads_v1 u where id=$1',[artifact.upload_id]);
 for(const [column,changed,originalValue] of [
  ['revision','sha256:'+'f'.repeat(64)+':2',revision],
  ['name','Synthetic file changed during reconciliation.mp4',artifact.name]
 ]){
  // Session A is a synthetic trusted catalogue writer. Session B gets the
  // original committed proof, then must block specifically on A's row lock.
  await a.query('begin');await a.query('update sma_private.publication_files_v1 set '+column+'=$2 where id=$1',[resultId,changed]);
  await begin(b,'authenticated');const writerPending=settled(user(b,'start',request(assetAnchor(asset))));
  await waitForLock(bpid,apid);await a.query('commit');const rejected=await unwrap(writerPending);await b.query('commit');
  assert.equal(rejected.ok,false,'A changed catalogue '+column+' must invalidate the proof after the lock wait');
  assert.equal(await h.value('select '+column+' v from sma_private.publication_files_v1 where id=$1',[resultId]),changed);
  assert.deepEqual(await h.value('select to_jsonb(u) v from sma_private.publication_uploads_v1 u where id=$1',[artifact.upload_id]),uploadBefore);
  assert.equal(await h.count('file_job_assets_v1'),0);assert.deepEqual(await h.identity(job),before);
  assert.deepEqual(await h.counts(),{jobs:1,starts:1});
  // Restore only this synthetic fixture's value before the next independent
  // race; no application database or existing test database is touched.
  await admin.query('update sma_private.publication_files_v1 set '+column+'=$2 where id=$1',[resultId,originalValue]);
 }
 const freshModifiedAt='2026-11-02T04:05:06Z';
 await a.query('begin');await a.query('update sma_private.publication_files_v1 set modified_at=$2 where id=$1',[resultId,freshModifiedAt]);
 await begin(b,'authenticated');const currentPending=settled(user(b,'start',request(assetAnchor(asset))));
 await waitForLock(bpid,apid);await a.query('commit');const currentJoin=await unwrap(currentPending);await b.query('commit');
 assert.equal(currentJoin.job_id,job.job_id,JSON.stringify(currentJoin));
 assert.equal(await h.value('select modified_at=$2::timestamptz v from sma_private.publication_files_v1 where id=$1',[resultId,freshModifiedAt]),true,
  'Reconciliation must preserve fresh catalogue metadata, not write its pre-lock timestamp back');
 assert.equal(await h.value('select status v from sma_private.publication_uploads_v1 where id=$1',[artifact.upload_id]),'completed');

 // Independent replays of the now reconciled receipt still join that parent.
 await begin(a,'authenticated');await begin(b,'authenticated');
 const receiptJoin=await user(a,'start',request(assetAnchor(asset)));assert.equal(receiptJoin.job_id,job.job_id,JSON.stringify(receiptJoin));
 const receiptPending=settled(user(b,'start',request(assetAnchor(asset))));await waitForLock(bpid);
 await a.query('commit');assert.equal((await unwrap(receiptPending)).job_id,job.job_id);await b.query('commit');
 assert.equal(await h.value('select status v from sma_private.publication_uploads_v1 where id=$1',[artifact.upload_id]),'completed');

 // A late native upload_finish and another asset join retain the original
 // result and do not invert the existing owner/job/upload locking order.
 const finished=await h.run(job,'upload_finish',{upload_id:artifact.upload_id});assert.equal(finished.reservation.status,'completed');
 await begin(a,'service_role');await begin(b,'authenticated');
 assert.deepEqual(await worker(a,'reserve',finished.key),finished.reservation);
 const aliasPending=settled(user(b,'start',request(assetAnchor(asset))));await waitForLock(bpid);
 assert.equal((await worker(a,'result',{...finished.key,status:200,body:finished.reservation})).ok,true);
 await a.query('commit');assert.equal((await unwrap(aliasPending)).job_id,job.job_id);await b.query('commit');
 assert.equal((await h.worker('completed',{...finished.key,outcome:'completed'})).ok,true);
 assert.deepEqual(await h.identity(job),before);assert.deepEqual(await h.counts(),{jobs:1,starts:1});
 assert.equal(await h.count('file_commands_v1'),2);assert.equal(await h.count('file_job_uploads_v1'),1);assert.equal(await h.count('file_job_assets_v1'),1);

 // Reverse lock ordering: music creates the family first; a simultaneous
 // explicit source action must reuse it. This is a second independent file.
 const nextSource=await h.file(),nextMusic=await h.claimMusic(nextSource);
 await begin(a,'authenticated');await begin(b,'authenticated');
 const musicFirst=await user(a,'start',request(uploadAnchor(nextMusic.artifact)));assert.equal(musicFirst.ok,true);
 const sourcePending=settled(user(b,'start',request(assetAnchor(nextSource))));await waitForLock(bpid);
 await a.query('commit');const sourceAfter=await unwrap(sourcePending);await b.query('commit');
 assert.equal(sourceAfter.job_id,musicFirst.job_id);assert.equal(musicFirst.asset_id,nextSource.id);
 assert.notEqual(musicFirst.job_id,job.job_id);await h.bind(musicFirst);
 assert.deepEqual(await h.counts(),{jobs:2,starts:2});
 assert.equal((await h.worker('claim_start',{job_id:job.job_id})).start,null);
 assert.equal((await h.worker('claim_start',{job_id:musicFirst.job_id})).start,null);
 console.log('Native PostgreSQL music family concurrency passed: source/music joins in both orders, one start claim per file, canonical commands and original lease, catalogue writer hash/name rejection and fresh metadata after a measured row-lock wait, ready-receipt reconciliation, late worker/asset join; two independent files, two parents total.');
}finally{
 await Promise.allSettled(clients.map(client=>client.query('rollback')));
 await Promise.allSettled(clients.map(client=>client.end()));
 try{await bootstrap.end();}catch{}
}
