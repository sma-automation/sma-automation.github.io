import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import {readPublicationCoverHistory} from '../app/assets/publication-cover-history-model.mjs';
const db=new PGlite();let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const uid='ab660000-0000-4000-8000-000000000091',other='ab660000-0000-4000-8000-000000000092';
const id=n=>'ab660000-0000-4000-9000-'+String(n).padStart(12,'0');
const sql=async f=>readFile(new URL('../supabase/sql/'+f,import.meta.url),'utf8');
try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema sma_private;grant usage on schema sma_private,auth to authenticated,service_role;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table public.sma_kunden(id bigint primary key,user_id uuid,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean);");
 await db.exec(await readFile(new URL('./sql-runtime/publication-history-fixture.sql',import.meta.url),'utf8'));
 // Exact installed cover table DDL; no dispatcher or provider functions needed.
 await db.exec((await sql('publication-provider-cover.sql')).split('create or replace function')[0]);
 for(const f of ['publication-history.sql','publication-history-months.sql','publication-cover-history.sql'])await db.exec(await sql(f));
 await db.query('insert into public.sma_kunden values(91,$1,true,true,false),(92,$2,true,true,false)',[uid,other]);
 const read=async(input={month:null},owner=uid,version=3)=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);try{return (await db.query(`select public.sma_publication_history_v${version}($1) as r`,[input])).rows[0].r;}finally{await db.exec('reset role');}};
 const binding={platform:'youtube',media_kind:'video',asset_id:id(40),asset_revision:'sha256:'+'a'.repeat(64)+':4'};
 const plan={version:1,export_id:id(42),video_asset_id:binding.asset_id,video_revision:binding.asset_revision,asset_id:id(41),asset_revision:'sha256:'+'b'.repeat(64)+':2',mime_type:'image/png',size_bytes:2000,position_ms:1000,duration_ms:3000,drive_file_id:'PRIVATE_DRIVE_ID',token:'DO_NOT_EXPOSE'};
 const insert=async(n,owner=uid,customer=91,platform='youtube')=>db.query("insert into sma_private.publication_orders_v1(id,user_id,customer_id,binding,draft,choices,target,state,created_at,updated_at) values($1,$2,$3,$4,'{\"title\":\"Fixture\"}','{\"visibility\":\"private\"}','{\"id\":\"fixture-target\"}','checked','2026-11-06T12:00:00Z','2026-11-06T12:01:00Z')",[id(n),owner,customer,{...binding,platform}]);
 eq((await read()).entries,[]);eq((await read({},'')).code,'AUTH_REQUIRED');eq((await read({},id(99))).code,'ACCOUNT_UNAVAILABLE');
 for(const input of [null,[],{user_id:other},{order_id:id(1)},{month:'2026-99'},{before_id:id(1)}])eq((await read(input)).code,'INVALID_INPUT');
 await insert(1);await insert(2,other,92);await insert(3,uid,92);await insert(4,other,91);
 eq((await read()).entries.map(e=>e.id),[id(1)]);eq((await read({},other)).entries.map(e=>e.id),[id(2)]);
 const cover=async()=>{const r=await read();readPublicationCoverHistory(r);checks++;return r.entries.find(e=>e.id===id(1)).cover;};
 eq(await cover(),{status:'not_recorded',updated_at:null});
 await db.exec('begin');await db.exec("update sma_private.publication_orders_v1 set binding=jsonb_set(binding,'{platform}','\"instagram\"')");eq((await cover()).status,'not_applicable');await db.exec('rollback');
 await db.exec('begin');await db.exec("update sma_private.publication_orders_v1 set binding=jsonb_set(binding,'{media_kind}','\"image\"')");eq((await cover()).status,'not_applicable');await db.exec('rollback');
 await db.query("insert into sma_private.publication_provider_attempts_v1(order_id,fingerprint,platform,target_id,visibility,size_bytes) select id,sma_private.publication_provider_fingerprint_v1(j),'youtube','fixture-target','private',1000 from sma_private.publication_orders_v1 j where id=$1",[id(1)]);
 eq((await cover()).status,'not_recorded'); // Legacy attempt: no guessed success.
 await db.query("insert into sma_private.publication_provider_covers_v1(order_id,fingerprint,plan) select id,sma_private.publication_provider_fingerprint_v1(j),$2 from sma_private.publication_orders_v1 j where id=$1",[id(1),plan]);
 eq((await cover()).status,'pending');
 const scenario=async(change,status,params=[])=>{await db.exec('begin');await db.query(change,params);eq((await cover()).status,status);await db.exec('rollback');};
 await scenario('update sma_private.publication_provider_covers_v1 set plan=null','none');
 for(const p of [null,{},[],{...plan,version:2},{...plan,position_ms:3000},{...plan,position_ms:-1},{...plan,position_ms:'1'},{...plan,duration_ms:60001},{...plan,video_asset_id:id(99)},{...plan,asset_id:binding.asset_id},{...plan,mime_type:'image/jpeg'}])await scenario('update sma_private.publication_provider_covers_v1 set plan=$1','needs_review',[JSON.stringify(p)]);
 for(const change of ["update sma_private.publication_provider_covers_v1 set fingerprint='changed'","update sma_private.publication_provider_attempts_v1 set fingerprint='changed'","update sma_private.publication_provider_attempts_v1 set target_id='other'","update sma_private.publication_orders_v1 set draft='{}'","update sma_private.publication_provider_covers_v1 set lease_id=gen_random_uuid()"] )await scenario(change,'needs_review');
 for(const state of ['failed','uncertain','needs_review'])await scenario('update sma_private.publication_provider_attempts_v1 set state=$1',state==='failed'?'blocked':'uncertain',[state]);
 for(const state of ['cancelled','blocked'])await scenario('update sma_private.publication_orders_v1 set state=$1','blocked',[state]);
 await scenario("update sma_private.publication_provider_attempts_v1 set state='complete'",'needs_review');
 const receipt={state:'complete',platform:'youtube',route:'youtube_video',provider_id:'synthetic_1',target_id:'fixture-target',expected_visibility:'private',visibility:'private',publicly_available:false,can_upload:false,can_publish:false,upload_retry_allowed:false,url:'https://www.youtube.com/watch?v=synthetic_1'};
 await db.query("update sma_private.publication_provider_attempts_v1 set state='complete',provider_id='synthetic_1',result=$1",[receipt]);
 eq((await cover()).status,'needs_review');
 await db.query("insert into sma_private.publication_provider_events_v1(order_id,sequence,request_id,operation,outcome,finished_at) values($1,2,$2,'status',$3,now())",[id(1),id(21),{state:'complete',observation:receipt}]);
 eq((await cover()).status,'pending');
 for(const [state,code,status] of [['sending',null,'sending'],['complete','COVER_ACCEPTED','complete'],['failed','COVER_REJECTED','failed'],['failed','COVER_PERMISSION_REQUIRED','permission_required'],['uncertain','COVER_RESPONSE_UNCERTAIN','uncertain'],['complete','COVER_REJECTED','needs_review'],['failed','COVER_ACCEPTED','needs_review']]){
  await scenario("update sma_private.publication_provider_covers_v1 set state=$1,code=$2,lease_id=$3,sent_at=now(),finished_at=case when $1='sending' then null else now() end",status,[state,code,id(22)]);
 }
 await scenario("update sma_private.publication_provider_covers_v1 set state='complete',code='COVER_ACCEPTED',finished_at=now()",'needs_review');
 await db.exec("update sma_private.publication_provider_covers_v1 set state='sending',lease_id=gen_random_uuid(),created_at=now()-interval '5 minutes',sent_at=now()-interval '4 minutes'");
 eq((await cover()).status,'uncertain');eq((await db.query('select state from sma_private.publication_provider_covers_v1')).rows[0].state,'sending');
 await scenario("update sma_private.publication_provider_covers_v1 set state='complete',code='COVER_ACCEPTED',finished_at=now()",'complete'); // Real late result may resolve uncertainty.
 await db.exec("update sma_private.publication_provider_covers_v1 set state='bound',lease_id=null,sent_at=null,finished_at=null,code=null");
 // TikTok: finished video plus init receipt, never an independent cover confirmation.
 await db.exec('begin');
 await db.exec("update sma_private.publication_orders_v1 set binding=jsonb_set(binding,'{platform}','\"tiktok\"'),choices='{\"visibility\":\"SELF_ONLY\"}'");
 const tt={...receipt,platform:'tiktok',route:'direct_post',expected_visibility:'SELF_ONLY',public_post_ids:[]};delete tt.visibility;delete tt.url;
 await db.query("update sma_private.publication_provider_attempts_v1 set platform='tiktok',visibility='SELF_ONLY',result=$1,fingerprint=(select sma_private.publication_provider_fingerprint_v1(j) from sma_private.publication_orders_v1 j where j.id=order_id)",[tt]);
 await db.exec('update sma_private.publication_provider_covers_v1 cv set fingerprint=sma_private.publication_provider_fingerprint_v1(j) from sma_private.publication_orders_v1 j where j.id=cv.order_id');
 await db.query("update sma_private.publication_provider_events_v1 set outcome=$1",[{state:'complete',observation:tt}]);
 eq((await cover()).status,'needs_review');
 await db.query("insert into sma_private.publication_provider_events_v1(order_id,sequence,request_id,operation,outcome,finished_at) values($1,1,$2,'init',$3,now())",[id(1),id(23),{state:'session_ready',provider_id:'synthetic_1',session_url:'PRIVATE_SESSION_URL'}]);
 eq((await cover()).status,'timestamp_sent');
 await db.exec("update sma_private.publication_provider_events_v1 set finished_at=null where operation='init'");eq((await cover()).status,'needs_review');
 await db.exec("update sma_private.publication_provider_events_v1 set finished_at=now() where operation='init'");
 await db.exec("update sma_private.publication_provider_covers_v1 set state='complete',code='COVER_ACCEPTED',lease_id=gen_random_uuid(),sent_at=now(),finished_at=now()");eq((await cover()).status,'needs_review');
 await db.exec('rollback');
 const snapshot=async()=>{const rows={};for(const t of ['publication_orders_v1','publication_provider_attempts_v1','publication_provider_events_v1','publication_provider_covers_v1','publication_provider_permissions_v1'])rows[t]=(await db.query('select coalesce(jsonb_agg(t),\'[]\') as r from sma_private.'+t+' t')).rows[0].r;return rows;};
 const before=await snapshot();const visible=await read();eq(await snapshot(),before);eq(visible.summary.public_confirmed,0);
 const visibleText=JSON.stringify(visible);assert.doesNotMatch(visibleText,/PRIVATE_|DO_NOT_EXPOSE|fingerprint|lease_id|provider_id|drive_file_id|asset_revision|token/);checks++;
 for(const version of [1,2])eq(Object.hasOwn((await read({},uid,version)).entries[0],'cover'),false);
 // All month/cursor results stay bounded and ordered; foreign rows stay excluded.
 for(let n=5;n<28;n++)await insert(n);
 const page=await read({month:'2026-11'}),next=await read({month:'2026-11',...page.next});
 eq(page.entries.length,20);eq(next.entries.length,4);eq(new Set([...page.entries,...next.entries].map(e=>e.id)).size,24);eq(page.summary.orders,24);readPublicationCoverHistory(page);readPublicationCoverHistory(next);checks+=2;
 eq((await read({month:'2026-10'})).entries,[]);
 for(const change of ['aktiv=false','demo_delta_aktiv=false,zahlung_bestaetigt=false']){await db.exec('begin');await db.exec('update public.sma_kunden set '+change+' where id=91');eq((await read()).code,'ACCESS_INACTIVE');await db.exec('rollback');}
 await db.exec('begin');await db.query('insert into public.sma_kunden values(93,$1,true,true,false)',[uid]);eq((await read()).code,'ACCOUNT_UNAVAILABLE');await db.exec('rollback');
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);
  await assert.rejects(()=>db.exec('select * from sma_private.publication_provider_covers_v1'),/permission denied/);checks++;
  await assert.rejects(()=>db.exec("select sma_private.publication_history_cover_v1(null::sma_private.publication_orders_v1)"),/permission denied/);checks++;
  if(role!=='authenticated'){await assert.rejects(()=>db.exec('select public.sma_publication_history_v3()'),/permission denied/);checks++;}
  await db.exec('reset role');
 }
 eq((await db.query("select prosecdef,provolatile from pg_proc where oid='public.sma_publication_history_v3(jsonb)'::regprocedure")).rows,[{prosecdef:false,provolatile:'s'}]);
 console.log(checks+' cover-history SQL checks passed.');
}finally{await db.close();}
