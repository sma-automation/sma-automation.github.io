// Isolated local PostgreSQL database only; never use an application database.
import assert from 'node:assert/strict';
import {checkCreditRaces} from './postgres-runtime/music-credit-races.mjs';
import {readFile} from 'node:fs/promises';
import pg from './postgres-runtime/node_modules/pg/lib/index.js';
const url=new URL(process.env.SMA_TEST_DATABASE_URL??'postgresql://postgres@127.0.0.1:55439/sma_music_reservation_test');
assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname==='/sma_music_reservation_test','Use the dedicated local test database');
const clients=[0,1,2].map(()=>new pg.Client({connectionString:url.href,statement_timeout:8000,query_timeout:10000}));
const [admin,a,b]=clients,uid='ab660000-0000-4000-8000-000000000091';
const hash=n=>n.toString(16).padStart(64,'0'),input=n=>({name:'Fixture.wav',sha256:hash(n),size_bytes:1000,mime_type:'audio/wav'});
const rpc=(c,n)=>c.query('select public.sma_music_library_v1($1,$2) r',['prepare',JSON.stringify(input(n))]);
async function owner(c){await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);}
async function waiting(pid){const until=Date.now()+4000;while(Date.now()<until){const r=await admin.query("select wait_event_type,wait_event from pg_stat_activity where pid=$1",[pid]);if(r.rows[0]?.wait_event_type==='Lock'&&r.rows[0]?.wait_event==='advisory')return;await new Promise(r=>setTimeout(r,25));}throw Error('Second session did not wait for the shared reservation lock');}
async function pending(n){await owner(a);const t=(await rpc(a,n)).rows[0].r.track;await a.query('commit');await admin.query("update sma_private.music_library_v1 set created_at=now()-interval '25 hours' where id=$1",[t.id]);return t;}
let started=false;
try{
 await Promise.all(clients.map(c=>c.connect()));started=true;
 // Refuse to overwrite an already-populated test database.
 assert.equal((await admin.query("select to_regnamespace('sma_private') as schema")).rows[0].schema,null);
 for(const f of ['tests/sql-runtime/music-library-fixture.sql','supabase/sql/music-library.sql','supabase/sql/music-library-reservations.sql'])await admin.query(await readFile(f,'utf8'));
 await admin.query('insert into public.sma_kunden values(91,$1,true,true,false)',[uid]);
 const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
 // Storage INSERT wins: cleanup waits, then sees the committed object and keeps its row.
 const first=await pending(1);await owner(a);
 await a.query("insert into storage.objects values('sma-musik',$1,$2)",[first.object_name,JSON.stringify({size:1000,mimetype:'audio/wav'})]);
 await owner(b);const prepareLater=rpc(b,2);await waiting(pid);await a.query('commit');
 assert.equal((await prepareLater).rows[0].r.ok,true);await b.query('commit');
 assert.equal((await admin.query('select count(*)::integer n from sma_private.music_library_v1 where id=$1',[first.id])).rows[0].n,1);
 await owner(a);assert.equal((await a.query('select public.sma_music_library_v1($1,$2) r',['complete',JSON.stringify({sha256:first.sha256})])).rows[0].r.track.status,'ready');await a.query('commit');
 // Cleanup wins: the late INSERT waits, then checks a fresh snapshot and is rejected.
 const second=await pending(3);await owner(a);assert.equal((await rpc(a,4)).rows[0].r.ok,true);
 await owner(b);const late=b.query("insert into storage.objects values('sma-musik',$1,$2)",[second.object_name,JSON.stringify({size:1000,mimetype:'audio/wav'})]).then(()=>null,e=>e);
 await waiting(pid);await a.query('commit');const rejected=await late;assert.equal(rejected?.code,'42501');await b.query('rollback');
 assert.equal((await admin.query('select count(*)::integer n from sma_private.music_library_v1 where id=$1',[second.id])).rows[0].n,0);
 assert.equal((await admin.query('select count(*)::integer n from storage.objects where name=$1',[second.object_name])).rows[0].n,0);
 // A fresh retry reserves the same immutable path and succeeds after the rejected late write.
 await owner(a);const fresh=(await rpc(a,3)).rows[0].r.track;assert.notEqual(fresh.id,second.id);assert.equal(fresh.object_name,second.object_name);
 await a.query("insert into storage.objects values('sma-musik',$1,$2)",[fresh.object_name,JSON.stringify({size:1000,mimetype:'audio/wav'})]);await a.query('commit');
 await checkCreditRaces({admin,a,b,owner,waiting,pid,uid});
 console.log('3 native PostgreSQL music reservation scenarios passed: upload first, cleanup first, safe retry.');
}finally{
 if(started)await Promise.allSettled(clients.map(c=>c.query('rollback')));
 await Promise.allSettled(clients.map(c=>c.end()));
}
