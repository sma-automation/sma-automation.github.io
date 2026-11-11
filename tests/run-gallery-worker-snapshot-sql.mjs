// Isolated PGlite validation. No network, production queries, media, or credits.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
const customer='11111111-1111-4111-8111-111111111111';
const job='22222222-2222-4222-8222-222222222222';
const source='33333333-3333-4333-8333-333333333333';
const result='44444444-4444-4444-8444-444444444444';
const sourceSha='a'.repeat(64),resultSha='b'.repeat(64),trackSha='c'.repeat(64),audioSha='d'.repeat(64);
const sourceRev='sha256:'+sourceSha+':10',resultRev='sha256:'+resultSha+':11';
const sidecar='render/'+trackSha+'/'+audioSha+'.aac';
const value=async(q,args=[])=>(await db.query(q,args)).rows[0]?.v;
const snapshot=()=>value('select sma_private.gallery_worker_snapshot_v1($1::uuid) v',[job]);
async function update(q,params=[]){await db.query(q,params);}
try{
 await db.exec([
 "create role anon; create role authenticated; create role service_role bypassrls;",
 "create schema sma_private; create schema storage;",
 "grant usage on schema sma_private to anon,authenticated,service_role;",
 "create table public.sma_kunden(id bigint primary key,user_id uuid,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean);",
 "create table sma_private.publication_files_v1(id uuid primary key,customer_id bigint,user_id uuid,drive_file_id text,revision text,size_bytes bigint,available boolean,media_kind text,mime_type text);",
 "create table sma_private.gallery_music_v1(id uuid primary key,customer_id bigint,user_id uuid,source_id uuid,source_key text,state text,expected_sha text,expected_size integer,track_sha text,result_id uuid);",
 "create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));",
 "create function sma_private.gallery_music_key_v1(rev text) returns text language sql immutable strict set search_path='' as $$ select split_part(rev,':',1)||':'||split_part(rev,':',2) $$;",
 "revoke all on sma_private.publication_files_v1,sma_private.gallery_music_v1,storage.objects from public,anon,authenticated,service_role;"
 ].join('\n'));
 const sql=await readFile('supabase/sql/gallery-worker-private-snapshot.sql','utf8');
 assert.match(sql,/GALLERY_WORKER_SNAPSHOT_ALREADY_EXISTS/);
 assert.match(sql,/security definer set search_path=''/);
 await db.exec(sql);
 await update("insert into public.sma_kunden values (1,$1,true,true,false)",[customer]);
 await update("insert into sma_private.publication_files_v1 values($1,1,$3,'syntheticSourceDriveId2026',$4,1951847,true,'video','video/mp4'),($2,1,$3,'syntheticResultDriveId2026',$5,2125747,true,'video','video/mp4')",
 [source,result,customer,sourceRev,resultRev]);
 await update("insert into sma_private.gallery_music_v1 values($1,1,$2,$3,$4,'completed',$5,2125747,$6,$7)",
 [job,customer,source,'sha256:'+sourceSha,resultSha,trackSha,result]);
 await update("insert into storage.objects values('sma-katalog',$1,$2::jsonb)",[sidecar,JSON.stringify({size:1063935,mimetype:'audio/vnd.dlna.adts'})]);
 assert.equal((await snapshot()).audio_sha256,audioSha);
 assert.equal((await snapshot()).audio_object_name,sidecar);
 assert.equal((await snapshot()).audio_size_bytes,1063935);
 assert.equal((await snapshot()).source.revision,sourceRev);
 assert.equal((await snapshot()).result.revision,resultRev);
 assert.equal((await snapshot()).track_sha,trackSha);
 assert.equal((await snapshot()).state,'completed');
 assert.equal((await snapshot()).customer_active,true);
 const before=(await value('select count(*)::int v from sma_private.gallery_music_v1'));
 assert.equal(before,1);

 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  await assert.rejects(snapshot,/permission denied/);
  await db.exec('reset role');
 }
 assert.equal(await value("select has_function_privilege('service_role','sma_private.gallery_worker_snapshot_v1(uuid)','EXECUTE') v"),true);
 assert.equal(await value("select has_function_privilege('authenticated','sma_private.gallery_worker_snapshot_v1(uuid)','EXECUTE') v"),false);
 await db.exec('set role service_role');
 assert.equal((await snapshot()).audio_sha256,audioSha);
 await assert.rejects(()=>update("insert into sma_private.gallery_music_v1(id) values($1)",[job]),/permission denied/);
 await db.exec('reset role');

 // Each tampering case must fail without returning any candidate.
 const cases=[
  ["update sma_private.gallery_music_v1 set state='pending' where id=$1","update sma_private.gallery_music_v1 set state='completed' where id=$1",[job]],
  ["update public.sma_kunden set aktiv=false where id=1","update public.sma_kunden set aktiv=true where id=1",[]],
  ["update sma_private.publication_files_v1 set revision='sha256:'||repeat('e',64)||':20' where id=$1","update sma_private.publication_files_v1 set revision=$2 where id=$1",[source,sourceRev]],
  ["update sma_private.publication_files_v1 set revision='sha256:'||repeat('f',64)||':22' where id=$1","update sma_private.publication_files_v1 set revision=$2 where id=$1",[result,resultRev]],
  ["update sma_private.publication_files_v1 set available=false where id=$1","update sma_private.publication_files_v1 set available=true where id=$1",[result]],
  ["update sma_private.gallery_music_v1 set expected_size=1 where id=$1","update sma_private.gallery_music_v1 set expected_size=2125747 where id=$1",[job]],
  ["update sma_private.gallery_music_v1 set source_key='sha256:'||repeat('e',64) where id=$1","update sma_private.gallery_music_v1 set source_key=$2 where id=$1",[job,'sha256:'+sourceSha]],
  ["update sma_private.gallery_music_v1 set track_sha=repeat('e',64) where id=$1","update sma_private.gallery_music_v1 set track_sha=$2 where id=$1",[job,trackSha]],
 ];
 for(const [change,restore,params] of cases){
   await update(change,params.slice(0,1));
   assert.equal(await snapshot(),null,change);
   await update(restore,params);
   assert.equal((await snapshot()).gallery_job_id,job,'state recovered after synthetic rollback');
 }
 const variants=[
  {size:1063935,mimetype:'application/octet-stream'},
  {size:1600000,mimetype:'audio/aac'},
  {size:0,mimetype:'audio/aac'},
  {size:1063935},
  {mimetype:'audio/aac'},
 ];
 for(const m of variants){
  await update("update storage.objects set metadata=$1::jsonb where name=$2",[JSON.stringify(m),sidecar]);
  assert.equal(await snapshot(),null,'invalid audio storage metadata must be rejected');
 }
 await update("update storage.objects set metadata=$1::jsonb where name=$2",[JSON.stringify({size:1063935,mimetype:'audio/aac'}),sidecar]);
 assert.equal((await snapshot()).audio_sha256,audioSha,'normal AAC MIME is accepted');
 const second='render/'+trackSha+'/'+ 'e'.repeat(64)+'.aac';
 await update("insert into storage.objects values ('sma-katalog',$1,$2::jsonb)",[second,JSON.stringify({size:100000,mimetype:'audio/aac'})]);
 assert.equal(await snapshot(),null,'ambiguous AAC output must not choose arbitrarily');
 await update("delete from storage.objects where name=$1",[second]);
 assert.equal((await snapshot()).audio_sha256,audioSha);

 assert.equal(await value('select count(*)::int v from sma_private.gallery_music_v1'),before);
 console.log('Worker snapshot: role isolation, exact source/result receipts, sidecar SHA, metadata integrity and ambiguity gates passed.');
}catch(e){
 console.error('GALLERY_WORKER_SNAPSHOT_TEST_FAILED',e.message,e.where||'');
 process.exitCode=1;
}finally{await db.close();}
