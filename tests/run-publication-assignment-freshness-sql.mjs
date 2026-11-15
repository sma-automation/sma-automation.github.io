// Offline PGlite verification of the real replacement function, not a provider call.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite(),rev='sha256:'+'a'.repeat(64)+':10';
const asset='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const owner='11111111-2222-4333-8444-555555555555';
const pre='22222222-3333-4444-8555-666666666666';
const run=(q,p=[])=>db.query(q,p);
const lookup=async v=>(await run('select public.sma_publication_assignment_v1($1,$2,$3,$4) v',[4,'syntheticDriveFile2026',v,'youtube'])).rows[0].v;
try{
 await db.exec([
  "create role anon; create role authenticated; create role service_role;",
  "create schema sma_private;",
  "create table public.sma_kunden(id bigint primary key,user_id uuid,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean,shop_oeffentlich boolean,shop_slug text);",
  "create table sma_private.publication_files_v1(id uuid,customer_id bigint,user_id uuid,drive_file_id text,revision text,verified_at timestamptz,available boolean,media_kind text);",
  "create table sma_private.publication_assignments_v1(asset_id uuid,platform text,asset_revision text,preview_id uuid,preview_revision integer,revision integer,draft jsonb);",
  "create table sma_private.publication_previews_v1(id uuid,user_id uuid,customer_id bigint,revision integer,status text,shop_url text);",
  "create function sma_private.publication_media_precheck_v1(f sma_private.publication_files_v1,p_platform text) returns jsonb language sql as $f$ select '{\"can_publish\":false,\"checks\":[]}'::jsonb $f$;",
  "create function sma_private.publication_product_link_available_v1(c public.sma_kunden,p text) returns boolean language sql as $f$ select false $f$;"
 ].join('\n'));
 const sql=await readFile('supabase/sql/publication-assignment-stale-file-reason.sql','utf8');
 assert.match(sql,/874e294631f9b69f3dfa616899438843/);
 assert.match(sql,/PUBLICATION_ASSIGNMENT_SOURCE_CHANGED/);
 assert.match(sql,/FILE_REFRESH_REQUIRED/);
 const start=sql.indexOf('CREATE OR REPLACE FUNCTION public.sma_publication_assignment_v1(');
 assert(start>0);
 await db.exec(sql.slice(start));
 await run("insert into public.sma_kunden values(4,$1,true,true,false,true,'fixture')",[owner]);
 await run("insert into sma_private.publication_files_v1 values($1,4,$2,'syntheticDriveFile2026',$3,now()-interval '35 minutes',true,'video')",[asset,owner,rev]);
 await run("insert into sma_private.publication_assignments_v1 values($1,'youtube',$2,$3,1,1,$4::jsonb)",[asset,rev,pre,JSON.stringify({title:'Synthetic title',caption:'Synthetic caption'})]);
 await run("insert into sma_private.publication_previews_v1 values($1,$2,4,1,'completed','https://sma-automation.com/app/shop.html?shop=fixture')",[pre,owner]);
 assert.equal((await lookup(rev)).code,'FILE_REFRESH_REQUIRED');
 assert.equal((await lookup('sha256:'+'b'.repeat(64)+':11')).code,'FILE_CHANGED');
 await run("update sma_private.publication_files_v1 set verified_at=now() where id=$1",[asset]);
 const valid=await lookup(rev);
 assert.equal(valid.ok,true);assert.equal(valid.can_publish,false);
 assert.equal((await lookup('sha256:'+'b'.repeat(64)+':11')).code,'FILE_CHANGED');
 await run("update sma_private.publication_files_v1 set available=false where id=$1",[asset]);
 assert.equal((await lookup(rev)).code,'FILE_UNAVAILABLE');
 await run("update public.sma_kunden set aktiv=false where id=4");
 assert.equal((await lookup(rev)).code,'ACCESS_INACTIVE');
 for(const role of ['anon','authenticated']){
  assert.equal((await run("select has_function_privilege($1,'public.sma_publication_assignment_v1(bigint,text,text,text)','EXECUTE') v",[role])).rows[0].v,false);
 }
 assert.equal((await run("select has_function_privilege('service_role','public.sma_publication_assignment_v1(bigint,text,text,text)','EXECUTE') v")).rows[0].v,true);
 console.log('Freshness SQL passed: stale != changed, all original safeguards retained.');
}catch(e){
 console.error('ASSIGNMENT_FRESHNESS_TEST_FAILED:',e.message,e.where||'');
 process.exitCode=1;
}finally{await db.close();}
