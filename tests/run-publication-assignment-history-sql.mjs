import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const uid='ab660000-0000-4000-8000-000000000091',other='ab660000-0000-4000-8000-000000000092';
const id=n=>'ab660000-0000-4000-9000-'+String(n).padStart(12,'0');
const source=async file=>readFile(new URL('../supabase/sql/'+file,import.meta.url),'utf8');
try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema sma_private;grant usage on schema sma_private,auth to authenticated,service_role;"+
 "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"+
 "create table public.sma_kunden(id bigint primary key,user_id uuid,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean);");
 await db.exec((await source('publication-preview.sql')).split('-- Definer is needed only')[0]);
 await db.exec((await source('publication-files.sql')).split('-- Metadata precheck')[0]);
 await db.query('insert into public.sma_kunden values(91,$1,true,true,false),(92,$2,true,false,true)',[uid,other]);
 const parents=async(n,{owner=uid,customer=91,previewOwner=owner,previewCustomer=customer}={})=>{
  await db.query("insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status) values($1,$2,$3,'{}','https://fixture.invalid','completed')",[id(n),previewOwner,previewCustomer]);
  await db.query("insert into sma_private.publication_files_v1(id,user_id,customer_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes) values($1,$2,$3,$4,'Original filename.mp4','video','video/mp4','r1',now(),1234)",[id(n),owner,customer,'fixture-'+n]);
 };
 const assign=async(n,{revision=1,previewRevision=1,title='Saved title',body='A saved fixture body',platform='youtube'}={})=>db.query("insert into sma_private.publication_assignments_v1(asset_id,platform,preview_id,preview_revision,asset_revision,revision,draft,updated_at) values($1,$2,$1,$3,'r1',$4,$5,'2026-10-01T10:00:00Z') on conflict(asset_id,platform) do update set preview_revision=excluded.preview_revision,revision=excluded.revision,draft=excluded.draft,updated_at=now()",[id(n),platform,previewRevision,revision,JSON.stringify({platform,title,body})]);
 const snapshot=async()=>(await db.query('select (select jsonb_agg(a order by asset_id,platform) from sma_private.publication_assignments_v1 a) as assignments,(select jsonb_agg(f order by id) from sma_private.publication_files_v1 f) as files,(select jsonb_agg(p order by id) from sma_private.publication_previews_v1 p) as previews')).rows[0];
 await parents(1);await assign(1,{revision:3});await parents(2,{owner:other,customer:92});await assign(2);
 await parents(3,{previewOwner:other});await assign(3); // inconsistent parent is never exposed
 const before=await snapshot(),sql=await source('publication-assignment-history.sql');
 await db.exec('begin;'+sql+'commit;');eq(await snapshot(),before);
 const read=async(input={},owner=uid)=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);try{return (await db.query('select public.sma_publication_assignment_history_v1($1) as r',[JSON.stringify(input)])).rows[0].r;}finally{await db.exec('reset role');}};
 const all=()=>read({month:null});const count=async()=>(await db.query('select count(*)::int as n from sma_private.publication_assignment_history_v1')).rows[0].n;
 const baseline=(await all()).entries[0];eq(baseline.event_kind,'baseline');eq(baseline.assignment_revision,3);eq(baseline.body,'A saved fixture body');eq(baseline.source_updated_at,'2026-10-01T10:00:00+00:00');eq(baseline.recorded_at!==baseline.source_updated_at,true);eq((await all()).total,1);eq((await read({month:null},other)).total,1);eq(await count(),2);
 // Reinstall does not create another baseline or mutate current data.
 await db.exec('begin;'+sql+'commit;');eq(await count(),2);eq(await snapshot(),before);
 await db.query("update sma_private.publication_assignments_v1 set updated_at=now(),revision=revision+1 where asset_id=$1",[id(1)]);eq(await count(),2);
 // Actual ON CONFLICT path fires exactly once, and old values remain snapshots.
 await assign(1,{revision:5,previewRevision:2,body:'Second saved fixture body'});eq(await count(),3);
 await db.query("update sma_private.publication_files_v1 set name='Renamed now.mp4' where id=$1",[id(1)]);
 const versions=(await all()).entries;eq(versions.map(e=>e.event_kind),['updated','baseline']);eq(versions.map(e=>e.body),['Second saved fixture body','A saved fixture body']);eq(versions.map(e=>e.file_name),['Original filename.mp4','Original filename.mp4']);eq(versions[0].preview_revision,2);
 await parents(4);await db.exec('set role service_role');await assign(4);await db.exec('reset role');eq(await count(),4);eq((await all()).entries[0].event_kind,'assigned');
 await db.exec('begin');await assign(4,{revision:2,body:'This change is rolled back'});eq(await count(),5);await db.exec('rollback');eq(await count(),4);eq((await all()).entries.some(e=>e.body==='This change is rolled back'),false);
 // Ownership changes hide retained snapshots from BOTH accounts.
 await db.query('update sma_private.publication_files_v1 set user_id=$1,customer_id=92 where id=$2',[other,id(4)]);eq((await all()).total,2);eq((await read({month:null},other)).total,1);
 await db.query('update sma_private.publication_files_v1 set user_id=$1,customer_id=91 where id=$2',[uid,id(4)]);
 await db.query('update sma_private.publication_previews_v1 set user_id=$1 where id=$2',[other,id(4)]);eq((await all()).total,2);
 await db.query('delete from sma_private.publication_assignments_v1 where asset_id=$1',[id(4)]);await db.query('delete from sma_private.publication_previews_v1 where id=$1',[id(4)]);eq((await all()).total,2);eq(await count(),4);
 eq(Object.keys(baseline).sort(),['id','asset_id','platform','preview_id','preview_revision','assignment_revision','asset_revision','file_name','title','body','event_kind','recorded_at','source_updated_at'].sort());
 eq((await read()).month,(await db.query("select to_char(now() at time zone 'Europe/Vienna','YYYY-MM') as m")).rows[0].m);eq((await read({},'')).code,'AUTH_REQUIRED');eq((await read({},id(999))).code,'ACCOUNT_UNAVAILABLE');
 const cursor={month:'2026-11',before_at:'2026-11-03T12:00:00Z',before_id:id(1)};
 for(const input of [null,[],true,{month:''},{month:'2026-13'},{month:202611},{month:'1999-12'},{month:'2100-01'},{month:'2026-11',user_id:other},{before_id:id(1)},{...cursor,month:undefined},{...cursor,before_at:null},{...cursor,before_at:'2026-02-31T12:00:00Z'},{...cursor,before_at:'2026-11-30T23:00:00Z'},{...cursor,before_id:'bad'},{...cursor,before_id:null},{extra:'x'.repeat(1100)}])eq((await read(input)).code,'INVALID_INPUT');
 // Controlled fixture timestamps around winter and daylight-saving boundaries.
 await db.exec('delete from sma_private.publication_assignment_history_v1');
 const dates=['2026-10-31T22:59:59.999Z','2026-10-31T23:00:00Z','2026-11-30T22:59:59.999Z','2026-11-30T23:00:00Z','2026-03-31T21:59:59.999Z','2026-03-31T22:00:00Z'];
 const seed=async(n,at)=>db.query("insert into sma_private.publication_assignment_history_v1(id,user_id,customer_id,asset_id,platform,preview_id,preview_revision,assignment_revision,asset_revision,file_name,title,body,event_kind,recorded_at,source_updated_at) values($1,$2,91,$3,'youtube',$3,1,1,'r1','Fixture.mp4','Saved title','Saved body','updated',$4,$4)",[id(n),uid,id(1),at]);
 for(let n=1;n<=dates.length;n++)await seed(n,dates[n-1]);
 eq((await read({month:'2026-11'})).entries.map(e=>e.id),[id(3),id(2)]);eq((await read({month:'2026-03'})).entries.map(e=>e.id),[id(5)]);eq((await read({month:'2026-04'})).entries.map(e=>e.id),[id(6)]);eq((await read({month:'2025-01'})).total,0);eq((await all()).total,6);
 for(let n=10;n<40;n++)await seed(n,'2026-11-15T12:00:00Z');
 const page=await read({month:'2026-11'}),second=await read({month:'2026-11',...page.next});eq(page.entries.length,20);eq(second.entries.length,12);eq(page.total,32);eq(second.total,32);eq(second.has_more,false);eq(second.next,null);eq(new Set([...page.entries,...second.entries].map(e=>e.id)).size,32);
 const history=await db.query('select * from sma_private.publication_assignment_history_v1 order by id'),sources=await snapshot();await all();await read({month:'2026-11',...page.next});eq(await db.query('select * from sma_private.publication_assignment_history_v1 order by id'),history);eq(await snapshot(),sources);
 await db.exec('update public.sma_kunden set aktiv=false where id=91');eq((await read()).code,'ACCESS_INACTIVE');await db.exec('update public.sma_kunden set aktiv=true,demo_delta_aktiv=false where id=91');eq((await read()).code,'ACCESS_INACTIVE');await db.query('update public.sma_kunden set user_id=$1 where id=92',[uid]);eq((await read()).code,'ACCOUNT_UNAVAILABLE');
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);
  for(const action of ['select * from','delete from','update']){const query=action==='update'?"update sma_private.publication_assignment_history_v1 set body='tampered'":action+' sma_private.publication_assignment_history_v1';await assert.rejects(()=>db.query(query),/permission denied/);checks++;}
  if(role!=='authenticated'){await assert.rejects(()=>db.query('select public.sma_publication_assignment_history_v1()'),/permission denied/);checks++;}
  await db.exec('reset role');
 }
 const properties=(await db.query("select p.provolatile,p.prosecdef,p.proconfig from pg_proc p where p.oid='sma_private.publication_assignment_history_read_v1(jsonb)'::regprocedure")).rows[0];eq(properties.provolatile,'s');eq(properties.prosecdef,true);eq(properties.proconfig,['search_path=""']);
 console.log(`${checks} assignment-history SQL checks passed.`);
}finally{await db.close();}
