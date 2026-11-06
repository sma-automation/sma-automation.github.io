import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const uid='ab660000-0000-4000-8000-000000000091',other='ab660000-0000-4000-8000-000000000092';
const id=n=>'ab660000-0000-4000-9000-'+String(n).padStart(12,'0');
const source=async file=>readFile(new URL('../supabase/sql/'+file,import.meta.url),'utf8');
try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema sma_private;grant usage on schema sma_private,auth to authenticated;"+
 "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"+
 "create table public.sma_kunden(id bigint primary key,user_id uuid,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean);");
 // Actual prerequisite DDL; exclude unrelated request/generation functions.
 await db.exec((await source('publication-preview.sql')).split('-- Definer is needed only')[0]);
 await db.exec((await source('publication-caption-history.sql')).split('create or replace function sma_private.publication_caption_normalize_v1')[0]);
 await db.exec(await source('publication-text-history.sql'));
 await db.query('insert into public.sma_kunden values(91,$1,true,true,false),(92,$2,true,false,true)',[uid,other]);
 const read=async(input={},owner=uid)=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);try{return (await db.query('select public.sma_publication_text_history_v1($1) as r',[JSON.stringify(input)])).rows[0].r;}finally{await db.exec('reset role');}};
 const preview=async(n,{owner=uid,customer=91}={})=>db.query("insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status) values($1,$2,$3,'{}','https://fixture.invalid','completed')",[id(n),owner,customer]);
 const save=async(n,at,{revision=1,platform='youtube',body='A saved fixture body',customer=91}={})=>db.query('insert into sma_private.publication_caption_history_v1(preview_id,revision,customer_id,platform,body,recorded_at) values($1,$2,$3,$4,$5,$6)',[id(n),revision,customer,platform,body,at]);
 const empty=await read({month:'2026-11'});eq(empty.entries,[]);eq(empty.total,0);eq(empty.next,null);eq(empty.has_more,false);eq(empty.timezone,'Europe/Vienna');
 eq((await read()).month,(await db.query("select to_char(now() at time zone 'Europe/Vienna','YYYY-MM') as m")).rows[0].m);
 eq((await read({},'')).code,'AUTH_REQUIRED');eq((await read({},id(999))).code,'ACCOUNT_UNAVAILABLE');
 const cursor={month:'2026-11',before_at:'2026-11-03T12:00:00Z',before_id:id(1),before_revision:1,before_platform:'youtube'};
 for(const input of [null,[],true,{month:''},{month:'2026-13'},{month:202611},{month:'1999-12'},{month:'2100-01'},{month:'2026-11',user_id:other},{before_id:id(1)},{before_revision:1},{before_platform:'youtube'},{...cursor,month:undefined},{...cursor,before_at:null},{...cursor,before_at:'2026-02-31T12:00:00Z'},{...cursor,before_at:'2026-11-30T23:00:00Z'},{...cursor,before_id:'bad'},{...cursor,before_revision:0},{...cursor,before_revision:1.5},{...cursor,before_revision:9999999999},{...cursor,before_revision:'1'},{...cursor,before_platform:'__proto__'}])eq((await read(input)).code,'INVALID_INPUT');
 // Winter and DST boundaries use record time, independently of preview creation.
 const dates=['2026-10-31T22:59:59.999Z','2026-10-31T23:00:00Z','2026-11-30T22:59:59.999Z','2026-11-30T23:00:00Z','2026-03-31T21:59:59.999Z','2026-03-31T22:00:00Z'];
 for(let n=1;n<=dates.length;n++){await preview(n);await save(n,dates[n-1]);}
 eq((await read({month:'2026-11'})).entries.map(e=>e.preview_id),[id(3),id(2)]);
 eq((await read({month:'2026-03'})).entries.map(e=>e.preview_id),[id(5)]);eq((await read({month:'2026-04'})).entries.map(e=>e.preview_id),[id(6)]);
 eq((await read({month:'2025-01'})).total,0);eq((await read({month:null})).total,6);
 // Body revisions remain immutable even when the current preview changes.
 await save(2,'2026-11-10T12:00:00Z',{revision:2,body:'The next saved version'});
 await db.query("update sma_private.publication_previews_v1 set preview='{"+'"drafts":[{"title":"Current title only","body":"Current body only"}]'+"}',revision=3 where id=$1",[id(2)]);
 const revisions=(await read({month:'2026-11'})).entries.filter(e=>e.preview_id===id(2));eq(revisions.map(e=>e.body),['The next saved version','A saved fixture body']);eq(revisions.map(e=>e.revision),[2,1]);eq(Object.keys(revisions[0]).sort(),['body','platform','preview_id','recorded_at','revision']);
 // Both parent ownership and caption customer are required, including aggregates.
 await preview(7,{owner:other,customer:92});await save(7,'2026-11-10T12:00:00Z',{customer:92});
 await preview(8,{owner:other});await save(8,'2026-11-10T12:00:00Z');
 await preview(9,{customer:92});await save(9,'2026-11-10T12:00:00Z');
 await save(10,'2026-11-10T12:00:00Z'); // no parent
 await save(2,'2026-11-10T12:00:00Z',{customer:92,revision:9});
 eq((await read({month:'2026-11'})).total,3);eq((await read({month:'2026-11'},other)).total,1);
 // More than a page sharing timestamp and preview ID; all key components matter.
 await preview(11);for(let revision=1;revision<=7;revision++)for(const platform of ['youtube','tiktok','instagram','facebook'])await save(11,'2026-11-15T12:00:00Z',{revision,platform});
 const page=await read({month:'2026-11'}),second=await read({month:'2026-11',...page.next});eq(page.entries.length,20);eq(second.entries.length,11);eq(page.total,31);eq(second.total,31);eq(second.has_more,false);
 const keys=[...page.entries,...second.entries].map(e=>[e.preview_id,e.revision,e.platform].join(':'));eq(new Set(keys).size,31);
 // Other users' valid cursors cannot broaden access.
 const foreign=await read({...cursor,before_id:id(7)});eq(foreign.entries.every(e=>e.preview_id!==id(7)),true);
 const snapshot=async()=>(await db.query('select (select jsonb_agg(h order by preview_id,revision,platform) from sma_private.publication_caption_history_v1 h) as history,(select jsonb_agg(p order by id) from sma_private.publication_previews_v1 p) as previews')).rows[0];
 const before=await snapshot();await read();await read({month:null});await read({month:'2026-11',...page.next});eq(await snapshot(),before);
 await db.exec('update public.sma_kunden set aktiv=false where id=91');eq((await read()).code,'ACCESS_INACTIVE');
 await db.exec('update public.sma_kunden set aktiv=true,demo_delta_aktiv=false where id=91');eq((await read()).code,'ACCESS_INACTIVE');
 await db.query('update public.sma_kunden set user_id=$1 where id=92',[uid]);eq((await read()).code,'ACCOUNT_UNAVAILABLE');
 for(const role of ['anon','service_role']){await db.exec('set role '+role);await assert.rejects(()=>db.query('select public.sma_publication_text_history_v1()'),/permission denied/);checks++;await db.exec('reset role');}
 await db.exec('set role authenticated');await assert.rejects(()=>db.query('select * from sma_private.publication_caption_history_v1'),/permission denied/);checks++;await db.exec('reset role');
 const properties=(await db.query("select p.provolatile,p.prosecdef,p.proconfig from pg_proc p where p.oid='sma_private.publication_text_history_read_v1(jsonb)'::regprocedure")).rows[0];eq(properties.provolatile,'s');eq(properties.prosecdef,true);eq(properties.proconfig,['search_path=""']);
 console.log(`${checks} text-history SQL checks passed.`);
}finally{await db.close();}
