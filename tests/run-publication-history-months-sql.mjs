import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const uid='ab660000-0000-4000-8000-000000000091',other='ab660000-0000-4000-8000-000000000092';
const id=n=>'ab660000-0000-4000-9000-'+String(n).padStart(12,'0');
try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema sma_private;grant usage on schema sma_private,auth to authenticated;"+
 "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"+
 "create table public.sma_kunden(id bigint primary key,user_id uuid,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean);");
 await db.exec(await readFile(new URL('./sql-runtime/publication-history-fixture.sql',import.meta.url),'utf8'));
 for(const file of ['publication-history.sql','publication-history-months.sql'])await db.exec(await readFile(new URL('../supabase/sql/'+file,import.meta.url),'utf8'));
 await db.query('insert into public.sma_kunden values(91,$1,true,true,false),(92,$2,true,false,true)',[uid,other]);
 const read=async(input={},owner=uid,version=2)=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);try{return (await db.query(`select public.sma_publication_history_v${version}($1) as r`,[JSON.stringify(input)])).rows[0].r;}finally{await db.exec('reset role');}};
 const insert=async(n,created,{owner=uid,customer=91,platform='youtube'}={})=>db.query(`insert into sma_private.publication_orders_v1(id,user_id,customer_id,binding,draft,choices,target,state,created_at,updated_at) values($1,$2,$3,$4,'{"title":"Fixture"}','{"visibility":"public"}','{"id":"fixture-target"}','cancelled',$5,$5)`,[id(n),owner,customer,{platform},created]);
 const empty=await read({month:'2026-11'});eq(empty.summary,{orders:0,public_confirmed:0,platforms:[]});eq(empty.entries,[]);eq(empty.months,[]);eq(empty.month,'2026-11');eq(empty.timezone,'Europe/Vienna');
 eq((await read()).month,(await db.query("select to_char(now() at time zone 'Europe/Vienna','YYYY-MM') as m")).rows[0].m);
 eq((await read({},'',2)).code,'AUTH_REQUIRED');eq((await read({},id(99))).code,'ACCOUNT_UNAVAILABLE');
 for(const input of [null,[],false,{month:''},{month:202611},{month:'2026-13'},{month:'2026-00'},{month:'2026-1'},{month:'2026-11-01'},{month:'1999-12'},{month:'2100-01'},{month:'2026-11',user_id:other},{before_at:'2026-11-03T00:00:00Z',before_id:id(1)},{month:'2026-11',before_at:'2026-10-31T22:59:59Z',before_id:id(1)},{month:'2026-11',before_at:'2026-11-30T23:00:00Z',before_id:id(1)}])eq((await read(input)).code,'INVALID_INPUT');
 // Exact winter boundary: November starts October 31 at 23:00 UTC.
 await insert(1,'2026-10-31T22:59:59.999Z');await insert(2,'2026-10-31T23:00:00Z',{platform:'tiktok'});
 await insert(3,'2026-11-30T22:59:59.999Z');await insert(4,'2026-11-30T23:00:00Z');
 const november=await read({month:'2026-11'});eq(november.entries.map(e=>e.id),[id(3),id(2)]);eq(november.summary,{orders:2,public_confirmed:0,platforms:['tiktok','youtube']});
 eq(november.months,[{month:'2026-12',orders:1},{month:'2026-11',orders:2},{month:'2026-10',orders:1}]);
 // DST starts within March, so the April boundary is 22:00 UTC.
 await insert(5,'2026-03-31T21:59:59.999Z');await insert(6,'2026-03-31T22:00:00Z');
 eq((await read({month:'2026-03'})).entries.map(e=>e.id),[id(5)]);eq((await read({month:'2026-04'})).entries.map(e=>e.id),[id(6)]);
 await insert(7,'2026-10-31T23:00:00Z',{owner:other,customer:92,platform:'facebook'});
 await insert(8,'2026-10-31T23:00:00Z',{owner:uid,customer:92,platform:'instagram'});
 await insert(9,'2026-10-31T23:00:00Z',{owner:other,customer:91,platform:'instagram'});
 eq((await read({month:'2026-11'})).summary,november.summary);eq((await read({month:'2026-11'},other)).summary,{orders:1,public_confirmed:0,platforms:['facebook']});
 for(let n=10;n<=32;n++)await insert(n,'2026-11-03T12:00:00Z');
 const page=await read({month:'2026-11'}),next=await read({month:'2026-11',...page.next});
 eq(page.entries.length,20);eq(next.entries.length,5);eq(page.summary.orders,25);eq(next.summary.orders,25);eq(new Set([...page.entries,...next.entries].map(e=>e.id)).size,25);eq(next.has_more,false);
 const all=await read({month:null});eq(all.month,null);eq(all.summary.orders,29);eq(all.months.some(m=>m.month==='2026-04'),true);
 // A final public receipt counts only with a matching immutable fingerprint.
 await db.query(`insert into sma_private.publication_provider_attempts_v1(order_id,fingerprint,platform,target_id,visibility,size_bytes,state,provider_id,result) select j.id,sma_private.publication_provider_fingerprint_v1(j),'youtube','fixture-target','public',10,'complete','fixture_001',$2 from sma_private.publication_orders_v1 j where id=$1`,[id(3),{platform:'youtube',target_id:'fixture-target',provider_id:'fixture_001',expected_visibility:'public',visibility:'public',route:'youtube_video',state:'complete',can_upload:false,can_publish:false,upload_retry_allowed:false,url:'https://www.youtube.com/watch?v=fixture_001',publicly_available:true}]);
 eq((await read({month:'2026-11'})).summary.public_confirmed,1);eq((await read({month:'2026-10'})).summary.public_confirmed,0);
 await db.query("update sma_private.publication_orders_v1 set draft='{"+'"title":"Changed"'+"}' where id=$1",[id(3)]);eq((await read({month:'2026-11'})).summary.public_confirmed,0);
 // Shortcuts are bounded, but older dates and the v1 all-time reader remain usable.
 for(let n=1;n<=12;n++)await insert(40+n,`2025-${String(n).padStart(2,'0')}-15T12:00:00Z`);
 eq((await read({month:null})).months.length,12);eq((await read({month:'2025-01'})).summary.orders,1);eq((await read({},uid,1)).version,1);
 const snapshot=async()=>(await db.query("select (select jsonb_agg(j order by id) from sma_private.publication_orders_v1 j) as orders,(select jsonb_agg(a order by order_id) from sma_private.publication_provider_attempts_v1 a) as attempts")).rows[0];
 const before=await snapshot();await read();await read({month:null});await read({month:'2025-01'});eq(await snapshot(),before);
 await db.exec('update public.sma_kunden set aktiv=false where id=91');eq((await read()).code,'ACCESS_INACTIVE');
 await db.exec('update public.sma_kunden set aktiv=true,demo_delta_aktiv=false where id=91');eq((await read()).code,'ACCESS_INACTIVE');
 await db.query('update public.sma_kunden set user_id=$1 where id=92',[uid]);eq((await read()).code,'ACCOUNT_UNAVAILABLE');
 for(const role of ['anon','service_role']){await db.exec('set role '+role);let denied=false;try{await db.exec('select public.sma_publication_history_v2()');}catch{denied=true;}eq(denied,true);await db.exec('reset role');}
 eq((await db.query("select provolatile,prosecdef from pg_proc where proname='sma_publication_history_v2'")).rows,[{provolatile:'s',prosecdef:false}]);
 console.log(`${checks} monthly history SQL checks passed: Vienna/DST boundaries, tenant totals, all-time/empty/older months, pagination, conservative publication counts, unchanged journals.`);
}catch(e){console.error(e.message,e.where||'');process.exitCode=1;}finally{await db.close();}
