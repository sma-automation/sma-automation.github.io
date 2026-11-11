// Synthetic owner-scoped search regression, no real customer files or IDs.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const foreign='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id=n=>'11111111-2222-4333-8444-'+String(n).padStart(12,'0');
const lookup=async term=>(await db.query('select public.sma_publication_history_find_v1($1) v',[term])).rows[0].v;
const rows=async q=>(await db.query(q)).rows;
try{
 await db.exec([
  "create role anon; create role authenticated; create role service_role;",
  "create schema auth; create schema sma_private;",
  "create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $f$;",
  "grant usage on schema auth to authenticated;",
  "grant execute on function auth.uid() to authenticated;",
  "create table public.sma_kunden(id bigint primary key,user_id uuid,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean);",
  "create table sma_private.publication_orders_v1(id uuid primary key,user_id uuid,customer_id bigint,draft jsonb,binding jsonb,account_check jsonb,state text,created_at timestamptz);",
  "alter table sma_private.publication_orders_v1 enable row level security;",
  "revoke all on public.sma_kunden,sma_private.publication_orders_v1 from public,anon,authenticated;"
 ].join('\n'));
 const sql=await readFile('supabase/sql/publication-history-find.sql','utf8');
 assert.match(sql,/security definer set search_path=''/);
 assert.match(sql,/c[.]user_id=uid/);
 assert.match(sql,/o[.]user_id=uid/);
 assert.match(sql,/revoke all on function public[.]sma_publication_history_find_v1\(text\) from public,anon,authenticated/);
 assert.doesNotMatch(sql,/\b(insert|update|delete|truncate|call)\s+(into|from|public[.]|sma_private[.])/i);
 await db.exec(sql);
 await db.query('insert into public.sma_kunden values (4,$1,true,true,false),(5,$2,true,true,false),(6,$1,false,true,false)',[owner,foreign]);
 for(let n=1;n<=25;n++){
  await db.query("insert into sma_private.publication_orders_v1 values($1,$2,4,$3::jsonb,$4::jsonb,$5::jsonb,'prepared',$6::timestamptz)",
  [id(n),owner,JSON.stringify({title:'Türgriff Test '+String(n).padStart(2,'0')}),JSON.stringify({platform:'youtube'}),JSON.stringify({display_name:'Hotel Testkonto'}),new Date(Date.UTC(2026,10,1,0,0,n)).toISOString()]);
 }
 await db.query("insert into sma_private.publication_orders_v1 values($1,$2,5,$3::jsonb,$4::jsonb,$5::jsonb,'prepared',now())",
 [id(99),foreign,JSON.stringify({title:'Türgriff Fremdkonto geheim'}),JSON.stringify({platform:'youtube'}),JSON.stringify({display_name:'Privates Fremdkonto'})]);
 await db.query("insert into sma_private.publication_orders_v1 values($1,$2,6,$3::jsonb,$4::jsonb,$5::jsonb,'prepared',now())",
 [id(100),owner,JSON.stringify({title:'Türgriff inaktives Konto'}),JSON.stringify({platform:'youtube'}),JSON.stringify({display_name:'Inaktiv'})]);
 const countBefore=(await rows('select count(*)::int n from sma_private.publication_orders_v1'))[0].n;
 assert.equal(await rows("select has_function_privilege('anon','public.sma_publication_history_find_v1(text)','EXECUTE') v").then(r=>r[0].v),false);
 assert.equal(await rows("select has_function_privilege('authenticated','public.sma_publication_history_find_v1(text)','EXECUTE') v").then(r=>r[0].v),true);
 assert.equal(await rows("select has_table_privilege('authenticated','sma_private.publication_orders_v1','SELECT') v").then(r=>r[0].v),false);
 await db.exec('set role authenticated;');
 let unauthenticated=await lookup('Türgriff');
 assert.equal(unauthenticated.ok,false);
 assert.equal(unauthenticated.code,'AUTH_REQUIRED');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
 for(const term of ['',null,'a',' '.repeat(5),'x'.repeat(81)]){
  const invalid=await lookup(term);assert.equal(invalid.code,'INVALID_INPUT');
 }
 const all=await lookup('Türgriff');
 assert.equal(all.ok,true);
 assert.equal(all.entries.length,20);
 assert.equal(all.has_more,true);
 assert.equal(all.can_publish,false);
 assert.equal(all.can_upload,false);
 assert(all.entries.every(x=>x.id!==id(99)&&x.id!==id(100)));
 assert.equal(all.entries[0].id,id(25));
 assert.equal(all.entries[19].id,id(6));
 const exact=await lookup('Test 23');
 assert.equal(exact.entries.length,1);
 assert.equal(exact.entries[0].id,id(23));
 assert.equal(exact.has_more,false);
 const byId=await lookup(id(8).slice(-12));
 assert.deepEqual(byId.entries.map(x=>x.id),[id(8)]);
 const percent=await lookup('%');
 assert.equal(percent.ok,false,'one-character wildcard must be rejected');
 const literal=await lookup('%%');
 assert.equal(literal.ok,true);
 assert.equal(literal.entries.length,0,'wildcards never match arbitrary orders');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[foreign]);
 const hidden=await lookup('Test 23');
 assert.equal(hidden.entries.length,0);
 const own=await lookup('Fremdkonto');
 assert.deepEqual(own.entries.map(x=>x.id),[id(99)]);
 await db.exec('reset role;');
 assert.equal((await rows('select count(*)::int n from sma_private.publication_orders_v1'))[0].n,countBefore);
 console.log('History lookup: owner/account isolation, bounded complete search, literal wildcard and permission gates passed.');
}catch(e){
 console.error('HISTORY_FIND_SQL_FAILED',e.message,e.where||'',e.detail||'');
 process.exitCode=1;
}finally{await db.close();}
