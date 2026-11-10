// Run with: npm ci --prefix tests/sql-runtime --ignore-scripts
//           node tests/run-publication-tiktok-aigc-sql.mjs
// In-memory PGlite only: no hosted Supabase, provider HTTP, n8n or customer data.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';

const db=new PGlite();
const src=async file=>readFile(new URL('../supabase/sql/'+file+'.sql',import.meta.url),'utf8');
const pinned=async file=>readFile(new URL('sql-runtime/'+file,import.meta.url),'utf8');
const uid='fa660000-0000-4000-8000-000000000091';
const id=n=>'fa660000-0000-4000-8000-'+String(n).padStart(12,'0');
let checks=0;
const eq=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};

try {
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated,service_role;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table public.sma_kunden(id bigint primary key,user_id uuid,n8n_kunde_id text,kunde_email text,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean,shop_slug text,shop_oeffentlich boolean);grant select on public.sma_kunden to service_role;");
 for(const f of [
  'publication-preview','publication-files','publication-media-precheck',
  'publication-content-review','publication-magic-effect','publication-video-technical',
  'publication-video-magic','publication-media-profiles','publication-accounts',
  'publication-orders'
 ])await db.exec(await src(f));
 for(const f of JSON.parse(await pinned('manual-review-live-baseline.json')))await db.exec(f.definition);
 await db.exec(await pinned('provider-cover-pr57-journal.sql'));
 await db.exec(await src('publication-manual-review'));
 // Read-only history and approval overlays are prerequisites for the actual
 // installed order source. This is an isolated database, not production.
 await db.exec((await src('publication-provider-cover')).split('create or replace function')[0]);
 for(const f of [
  'publication-history','publication-history-months','publication-cover-history',
  'publication-approval-window','publication-pending-preparation',
  'publication-history-order-caption','publication-history-order-page',
  'publication-existing-approval','publication-cancel-preparation'
 ])await db.exec(await src(f));
 const fn="'sma_private.publication_order_request_v1(text,jsonb)'::regprocedure";
 const md5=async()=>(await db.query('select md5(prosrc) hash from pg_proc where oid='+fn)).rows[0].hash;
 eq(await md5(),'ce9dc4edbe66a00ce89924c1a91b49d1');
 const migration=await src('publication-tiktok-aigc');
 eq(migration,await readFile(new URL('../supabase/migrations/20261110110100_publication_tiktok_aigc_v1.sql',import.meta.url),'utf8'));
 await db.query("insert into public.sma_kunden values(91,$1,'aigc-test','test@example.invalid',true,true,false,'aigc-test',true)",[uid]);
 const binding={platform:'tiktok',asset_id:id(1),asset_revision:'version:1',media_kind:'video'};
 const baseChoices={visibility:'SELF_ONLY',disable_comment:true,disable_duet:true,disable_stitch:true,brand_content_toggle:false,brand_organic_toggle:false};
 // An unfinished, legacy order must stop a partial deployment.
 await db.query("insert into sma_private.publication_orders_v1(id,user_id,customer_id,binding,draft,choices,state) values($1,$2,91,$3,$4,$5,'prepared')",[id(20),uid,binding,{title:'Synthetic',caption:'Synthetic video only'},baseChoices]);
 await assert.rejects(()=>db.exec(migration),/TIKTOK_AIGC_LEGACY_ACTIVE_ORDER/);checks++;
 eq(await md5(),'ce9dc4edbe66a00ce89924c1a91b49d1');
 await db.query('delete from sma_private.publication_orders_v1 where id=$1',[id(20)]);
 // Cancelled historical orders remain unchanged and cannot be republished.
 await db.query("insert into sma_private.publication_orders_v1(id,user_id,customer_id,binding,draft,choices,state) values($1,$2,91,$3,$4,$5,'cancelled')",[id(21),uid,binding,{title:'Synthetic',caption:'Cancelled historical test'},baseChoices]);
 await db.exec(migration);
 assert.notEqual(await md5(),'ce9dc4edbe66a00ce89924c1a91b49d1');checks++;
 await assert.rejects(()=>db.exec(migration),/TIKTOK_AIGC_ORDER_BASELINE_CHANGED/);checks++;
 const legacy=(await db.query('select choices,state from sma_private.publication_orders_v1 where id=$1',[id(21)])).rows[0];
 eq(legacy.state,'cancelled');eq(legacy.choices,baseChoices);
 const asCustomer=async input=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
  await db.exec('set role authenticated');
  try{return (await db.query("select public.sma_publication_order_v1('prepare',$1) as r",[input])).rows[0].r;}
  finally{await db.exec('reset role');}
 };
 const base={id:id(22),asset_id:id(1),asset_revision:'version:1',platform:'tiktok',assignment_revision:1,preview_id:id(2),preview_revision:1,choices:baseChoices};
 for(const bad of [
  baseChoices,{...baseChoices,is_aigc:null},{...baseChoices,is_aigc:'true'},
  {...baseChoices,is_aigc:'false'},{...baseChoices,is_aigc:1},
  {...baseChoices,is_aigc:[]},{...baseChoices,is_aigc:{}},
  {...baseChoices,is_aigc:true,can_publish:true}
 ])eq((await asCustomer({...base,choices:bad})).code,'INVALID_CHOICES');
 for(const is_aigc of [true,false]){
  // Both real Boolean values pass the input gate. No file is inserted,
  // so the next response is FILE_UNAVAILABLE, never a new order.
  eq((await asCustomer({...base,choices:{...baseChoices,is_aigc}})).code,'FILE_UNAVAILABLE');
 }
 eq((await asCustomer({...base,platform:'youtube',choices:{visibility:'private',made_for_kids:false,contains_synthetic_media:false,is_aigc:false}})).code,'INVALID_CHOICES');
 eq((await db.query('select count(*)::int n from sma_private.publication_orders_v1')).rows[0].n,1);
 eq((await db.query('select count(*)::int n from sma_private.publication_journal_v1')).rows[0].n,0);
 eq((await db.query('select count(*)::int n from sma_private.publication_provider_permissions_v1')).rows[0].n,0);
 eq((await db.query('select count(*)::int n from sma_private.publication_provider_attempts_v1')).rows[0].n,0);
 eq((await db.query('select count(*)::int n from sma_private.publication_provider_events_v1')).rows[0].n,0);
 eq((await db.query("select has_function_privilege('authenticated','public.sma_publication_provider_v1(text,uuid,uuid,jsonb)','EXECUTE') b")).rows[0].b,false);
 console.log(checks+' TikTok AIGC isolated SQL checks passed; no real account, upload or provider interaction.');
}catch(e){
 console.error('AIGC SQL TEST FAILED:',e.message,e.detail||'',e.where||'');
 process.exitCode=1;
}finally{await db.close();}
