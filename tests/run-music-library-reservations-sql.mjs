import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite(),uid='ab660000-0000-4000-8000-000000000091',other='ab660000-0000-4000-8000-000000000092';
let count=0;const eq=(a,b)=>{assert.deepEqual(a,b);count++;},hash=n=>n.toString(16).padStart(64,'0');
const input=n=>({name:'Fixture.wav',sha256:hash(n),size_bytes:1000,mime_type:'audio/wav'});
try{
 for(const file of ['tests/sql-runtime/music-library-fixture.sql','supabase/sql/music-library.sql','supabase/sql/music-library-reservations.sql'])await db.exec(await readFile(file,'utf8'));
 // Reapplying the function-only migration preserves its permissions and behaviour.
 await db.exec(await readFile('supabase/sql/music-library-reservations.sql','utf8'));
 await db.query('insert into public.sma_kunden values(91,$1,true,true,false),(92,$2,true,true,false)',[uid,other]);
 const asUser=async(sql,args=[],owner=uid)=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);try{return await db.query(sql,args);}finally{await db.exec('reset role');}};
 const rpc=async(a,i={},owner=uid)=>(await asUser('select public.sma_music_library_v1($1,$2) r',[a,JSON.stringify(i)],owner)).rows[0].r;
 const prepare=async(n,owner=uid)=>(await rpc('prepare',input(n),owner)).track;
 const exists=async t=>(await db.query('select count(*)::integer n from sma_private.music_library_v1 where id=$1',[t.id])).rows[0].n===1;
 const age=async(t,interval='25 hours')=>db.query('update sma_private.music_library_v1 set created_at=now()-$2::interval where id=$1',[t.id,interval]);
 const object=async(t,metadata={size:1000,mimetype:'audio/wav'})=>db.query("insert into storage.objects values('sma-musik',$1,$2)",[t.object_name,JSON.stringify(metadata)]);
 const empty=await prepare(1),recent=await prepare(2),uploaded=await prepare(3),malformed=await prepare(4),ready=await prepare(5),foreign=await prepare(6,other);
 await object(uploaded);await object(malformed,{size:1,mimetype:'wrong'});await object(ready);eq((await rpc('complete',{sha256:ready.sha256})).track.status,'ready');
 await rpc('favourite',{sha256:ready.sha256,favourite:true});
 for(const t of [empty,uploaded,malformed,ready,foreign])await age(t);
 // Unknown/invalid requests, reads and failed access cannot perform cleanup.
 for(const [action,data,owner] of [['delete',{sha256:empty.sha256},uid],['prepare',{...input(7),size_bytes:'1000'},uid],['prepare',input(7),''],['list',{},uid],['get',{sha256:empty.sha256},uid]]){await rpc(action,data,owner);eq(await exists(empty),true);}
 await db.exec('update public.sma_kunden set aktiv=false where id=91');eq((await rpc('prepare',input(7))).code,'ACCESS_INACTIVE');eq(await exists(empty),true);await db.exec('update public.sma_kunden set aktiv=true where id=91');
 // Exact 24-hour boundary is kept; only strictly older empty reservations expire.
 await db.exec('begin');await age(recent,'24 hours');eq((await rpc('prepare',input(7))).ok,true);eq(await exists(recent),true);await db.exec('commit');
 eq(await exists(empty),false);for(const t of [uploaded,malformed,ready,foreign])eq(await exists(t),true);
 eq((await rpc('get',{sha256:ready.sha256})).track.favourite,true);
 eq((await db.query('select count(*)::integer n from storage.objects')).rows[0].n,3);
 eq((await rpc('complete',{sha256:uploaded.sha256})).track.status,'ready');eq((await rpc('complete',{sha256:malformed.sha256})).code,'MUSIC_INCOMPLETE');
 const oldId=empty.id,retry=await prepare(1);eq(retry.id===oldId,false);eq(retry.object_name,empty.object_name);eq(retry.status,'pending');
 eq((await rpc('prepare',input(1))).track.id,retry.id);
 // Late uploads for a removed reservation cannot create an unregistered object.
 await assert.rejects(()=>asUser("insert into storage.objects values('sma-musik',$1,$2)",[recent.object_name,JSON.stringify({size:1000,mimetype:'audio/wav'})]),/row-level security/);count++;
 // A ready row is retained even when its object is missing; cleanup is not data repair.
 await db.query('delete from storage.objects where name=$1',[ready.object_name]);await prepare(8);eq(await exists(ready),true);
 // The same user's former customer mapping is outside the cleanup scope.
 const mapped=await prepare(9);await age(mapped);await db.query('update sma_private.music_library_v1 set customer_id=999 where id=$1',[mapped.id]);await prepare(10);eq(await exists(mapped),true);
 // No direct roles gain access; immutable objects remain protected by restrictive policies.
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(()=>db.query('select * from sma_private.music_library_v1'),/permission denied/);count++;await db.exec('reset role');}
 eq((await asUser('delete from storage.objects returning name')).rows.length,0);eq((await asUser("update storage.objects set metadata='{}' returning name")).rows.length,0);
 const config=(await db.query("select p.provolatile,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sma_private' and p.proname='music_storage_allowed_v1'")).rows[0];eq(config.provolatile,'v');eq(config.prosecdef,true);eq(config.proconfig,['search_path=""']);
 // Synthetic quota scenarios are reset locally, never on the live project.
 await db.exec('truncate sma_private.music_library_v1,storage.objects');
 for(let i=0;i<100;i++)await prepare(100+i);
 eq((await rpc('prepare',input(999))).code,'MUSIC_LIMIT');
 await db.exec("update sma_private.music_library_v1 set created_at=now()-interval '25 hours'");
 eq((await rpc('prepare',input(999))).ok,true);eq((await db.query('select count(*)::integer n from sma_private.music_library_v1')).rows[0].n,1);
 await db.exec('truncate sma_private.music_library_v1,storage.objects');
 for(let i=0;i<12;i++)eq((await rpc('prepare',{...input(200+i),size_bytes:8000000})).ok,true);
 eq((await rpc('prepare',{...input(999),size_bytes:8000000})).code,'MUSIC_LIMIT');
 await db.exec("update sma_private.music_library_v1 set created_at=now()-interval '25 hours'");
 eq((await rpc('prepare',{...input(999),size_bytes:8000000})).ok,true);
 eq((await db.query('select sum(size_bytes)::integer n from sma_private.music_library_v1')).rows[0].n,8000000);
 // Occupied pending objects still consume the quota even after 24 hours.
 await db.exec('truncate sma_private.music_library_v1,storage.objects');
 for(let i=0;i<100;i++){const t=await prepare(300+i);await object(t);}
 await db.exec("update sma_private.music_library_v1 set created_at=now()-interval '25 hours'");
 eq((await rpc('prepare',input(999))).code,'MUSIC_LIMIT');eq((await db.query('select count(*)::integer n from storage.objects')).rows[0].n,100);
 console.log(count+' music reservation SQL checks passed.');
}finally{await db.close();}
