// In-memory PostgreSQL rehearsal; never touches customer or live data.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111';
const src='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const dst='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const job='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sha='a'.repeat(64),sourceSha='b'.repeat(64);
const sourceRev='sha256:'+sourceSha+':3',destRev='sha256:'+sha+':9';
const technical={schema:'sma-video-technical-v1',decode:'complete',
 video_codec:'h264',pixel_format:'yuv420p',width_px:720,height_px:1280,
 frame_rate_num:24,frame_rate_den:1,decoded_frames:240,
 min_frame_interval_us:41666,max_frame_interval_us:41667,
 video_bit_rate_bps:1558667,audio_codec:'aac',audio_sample_rate_hz:44100,
 audio_channels:2,audio_bit_rate_bps:134508};
const payload={schema:'sma-gallery-technical-candidate-v1',status:'local_technical_evidence',
 binding:{asset_id:dst,source_asset_id:src,drive_file_id:'syntheticDriveFixture123456',
 asset_revision:destRev,sha256:sha,size_bytes:2125747,source_sha256:sourceSha},
 technical,volume:{mean_dbfs:-26.3,peak_dbfs:-13.3,non_silent:true},
 packet_identity_verified:true,receipt_bytes_verified:true,
 restrictions:{registered_in_supabase:false,requires_trusted_ingestion:true,
 content_review:'not_checked',rights_review:'not_checked',
 customer_approval:false,can_upload:false,can_publish:false}};
const val=async(query,args=[])=>(await db.query(query,args)).rows[0]?.v;
const register=(obj)=>val('select sma_private.publication_gallery_technical_register_v1($1::jsonb) v',[JSON.stringify(obj)]);
const evidence=()=>val('select sma_private.publication_video_technical_v1(f) v from sma_private.publication_files_v1 f where f.id=$1',[dst]);
try{
 await db.exec([
  "create role anon; create role authenticated; create role service_role bypassrls;",
  "create schema sma_private; create schema auth;",
  "grant usage on schema sma_private,auth to service_role,authenticated,anon;",
  "create function auth.uid() returns uuid language sql stable set search_path='' as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
  "create table public.sma_kunden(id bigint primary key,user_id uuid,n8n_kunde_id text,kunde_email text,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean);",
  "create table sma_private.publication_files_v1(id uuid primary key,customer_id bigint,user_id uuid,drive_file_id text,name text,media_kind text,mime_type text,revision text,size_bytes bigint,available boolean,width_px integer,height_px integer,duration_ms bigint,verified_at timestamptz);",
  "create table sma_private.gallery_music_v1(id uuid primary key,customer_id bigint,user_id uuid,source_id uuid,source_key text,state text,expected_sha text,expected_size bigint,result_id uuid);",
  "create table sma_private.publication_magic_results_v1(asset_id uuid,asset_revision text,user_id uuid,customer_id bigint,n8n_kunde_id text,kunde_email text,policy_version text,status text,content_sha256 text,result jsonb);",
  "grant select on public.sma_kunden to service_role;",
  "grant select on sma_private.publication_files_v1,sma_private.gallery_music_v1,sma_private.publication_magic_results_v1 to service_role;",
  "create function sma_private.gallery_music_key_v1(rev text) returns text language sql immutable strict set search_path='' as $$ select split_part(rev,':',1)||':'||split_part(rev,':',2) $$;",
  // Minimal PGlite fixture. Production uses the stronger real validator;
  // regression checks that source references it, not this local substitute.
  "create function sma_private.publication_video_streams_valid_v1(t jsonb,has_audio boolean) returns boolean language sql immutable set search_path='' as $$ select coalesce(jsonb_typeof(t)='object' and (select count(*) from jsonb_object_keys(t))=16 and t->>'schema'='sma-video-technical-v1' and t->>'decode'='complete' and t->>'audio_codec'='aac' and jsonb_typeof(t->'width_px')='number' and jsonb_typeof(t->'height_px')='number' and jsonb_typeof(t->'audio_sample_rate_hz')='number' and has_audio,false) $$;",
  "create function sma_private.publication_video_technical_valid_v1(t jsonb,audio_status text) returns boolean language sql immutable set search_path='' as $$ select sma_private.publication_video_streams_valid_v1(t,audio_status<>'no_audio_stream') $$;",
  "create function sma_private.publication_export_technical_v1(f sma_private.publication_files_v1) returns jsonb language sql stable set search_path='' as $$ select null::jsonb $$;",
  "grant execute on function sma_private.publication_video_streams_valid_v1(jsonb,boolean) to service_role;",
  "grant execute on function sma_private.publication_video_technical_valid_v1(jsonb,text) to service_role;",
  "grant execute on function sma_private.publication_export_technical_v1(sma_private.publication_files_v1) to service_role;"
 ].join('\n'));
 const source=await readFile('supabase/sql/publication-gallery-technical.sql','utf8');
 assert.match(source,/GALLERY_EVIDENCE_SOURCE_CHANGED/);
 assert.match(source,/5c2fe99118ea912caaac03e97fdf82b1/);
 assert.match(source,/publication_video_streams_valid_v1\(t,true\)/);
 const start=source.indexOf('create table sma_private.publication_gallery_technical_v1');
 assert.ok(start>0);
 await db.exec(source.slice(start)); // Only the production MD5 guard is omitted in isolated fixtures.
 await db.query("insert into public.sma_kunden values(10,$1,'fixture','test@example.invalid',true,true,false)",[owner]);
 await db.query("insert into sma_private.publication_files_v1 values ($1,10,$3,'syntheticSourceFile123','original.mp4','video','video/mp4',$4,1951847,true,720,1280,9999,now()),($2,10,$3,'syntheticDriveFixture123456','music.mp4','video','video/mp4',$5,2125747,true,720,1280,9999,now())",[src,dst,owner,sourceRev,destRev]);
 await db.query("insert into sma_private.gallery_music_v1 values ($1,10,$2,$3,$4,'completed',$5,2125747,$6)",[job,owner,src,'sha256:'+sourceSha,sha,dst]);
 await db.exec('set role service_role');
 assert.equal(await evidence(),null,'before registration technical evidence must be absent');
 await db.exec('reset role');
 for(const role of ['authenticated','anon']){
  await db.exec('set role '+role);
  await assert.rejects(()=>register(payload),/permission denied/);
  await db.exec('reset role');
 }
 await db.exec('set role service_role');
 const bad=[
  {...payload,packet_identity_verified:false},
  {...payload,binding:{...payload.binding,sha256:'f'.repeat(64)}},
  {...payload,binding:{...payload.binding,asset_revision:'sha256:'+'f'.repeat(64)+':9'}},
  {...payload,binding:{...payload.binding,source_sha256:'e'.repeat(64)}},
  {...payload,binding:{...payload.binding,drive_file_id:'otherDriveFixture12345'}},
  {...payload,technical:{...technical,audio_sample_rate_hz:32000}},
  {...payload,technical:{...technical,audio_codec:'mp3'}},
  {...payload,volume:{mean_dbfs:-100,peak_dbfs:-85,non_silent:true}},
  {...payload,volume:{mean_dbfs:-26,peak_dbfs:-13,non_silent:false}},
  {...payload,restrictions:{...payload.restrictions,can_publish:true}}
 ];
 for(const candidate of bad){
  const outcome=await register(candidate);
  assert.equal(outcome?.ok,false,JSON.stringify(outcome));
  assert.equal(await val('select count(*)::int v from sma_private.publication_gallery_technical_v1'),0);
 }
 const accepted=await register(payload);
 assert.equal(accepted?.ok,true,JSON.stringify(accepted));
 assert.equal(accepted.can_publish,false);
 assert.equal((await evidence()).audio_sample_rate_hz,44100);
 assert.equal((await register(payload)).ok,true,'identical retry is idempotent');
 assert.equal((await register({...payload,technical:{...technical,decoded_frames:241}})).code,'EVIDENCE_CONFLICT');
 assert.equal(await val('select count(*)::int v from sma_private.publication_gallery_technical_v1'),1);
 await assert.rejects(()=>db.exec("insert into sma_private.publication_gallery_technical_v1(asset_id) values('"+dst+"')"),/permission denied/);
 await db.exec('reset role');
 await db.query("update sma_private.publication_files_v1 set revision=$1 where id=$2",['sha256:'+'e'.repeat(64)+':99',dst]);
 await db.exec('set role service_role');
 assert.equal(await evidence(),null,'stale output revision blocks previous proof');
 await db.exec('reset role');
 await db.query("update sma_private.publication_files_v1 set revision=$1 where id=$2",[destRev,dst]);
 await db.query("update sma_private.publication_files_v1 set revision=$1 where id=$2",['sha256:'+'f'.repeat(64)+':1',src]);
 await db.exec('set role service_role');
 assert.equal(await evidence(),null,'changed source revision invalidates proof');
 await db.exec('reset role');
 await db.query("update sma_private.publication_files_v1 set revision=$1 where id=$2",[sourceRev,src]);
 await db.exec('set role service_role');
 assert.equal((await evidence()).audio_sample_rate_hz,44100,'exact revisions restore proof');
 await db.exec('reset role');
 const magic={...technical,decoded_frames:239};
 await db.query("insert into sma_private.publication_magic_results_v1 values ($1,$2,$3,10,'fixture','test@example.invalid','magic-video-2026-11-03.1','completed',$4,$5::jsonb)",
 [dst,destRev,owner,sha,JSON.stringify({audio_status:'no_speech_recognized',evidence:{source_sha256:sha,source_size_bytes:2125747,technical:magic}})]);
 await db.exec('set role service_role');
 assert.equal((await evidence()).decoded_frames,239,'Magic source retains priority');
 await db.exec('reset role');
 await db.query("update sma_private.publication_magic_results_v1 set content_sha256=$1 where asset_id=$2",['f'.repeat(64),dst]);
 await db.exec('set role service_role');
 assert.equal(await evidence(),null,'invalid Magic evidence must not fall back');
 await db.exec('reset role');
 console.log('Gallery intake: role isolation, immutable SHA-bound receipts, strict audio, magic precedence and no publishing tested.');
}catch(error){
 console.error('GALLERY_EVIDENCE_SQL_TEST_FAILED',error.message,error.where||'');
 process.exitCode=1;
}finally{await db.close();}
