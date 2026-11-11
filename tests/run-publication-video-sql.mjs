// npm ci --prefix tests/sql-runtime --ignore-scripts
// node tests/run-publication-video-sql.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
try {
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create schema auth;create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to authenticated,service_role;
  create table public.sma_kunden(id bigint primary key,user_id uuid,n8n_kunde_id text,kunde_email text,aktiv boolean default false,demo_delta_aktiv boolean default false,zahlung_bestaetigt boolean default false,shop_slug text,shop_oeffentlich boolean default false);
  grant select on public.sma_kunden to service_role;`);
 // Real publication definitions; only the external Auth/customer table is a
 // minimal fixture. This is not a hosted n8n/provider integration test.
 for(const file of ['publication-preview','publication-files','publication-media-precheck','publication-content-review','publication-magic-effect','publication-video-technical','publication-video-magic','publication-media-profiles']) {
  try {await db.exec(await readFile(new URL('../supabase/sql/'+file+'.sql',import.meta.url),'utf8'));} catch(e) {console.error(file,e.position,e.internalPosition,e.internalQuery);throw e;}
 }
 // Exercise the exact new migration function, not an altered 2026-11-01
 // historical SQL baseline. The old export-probe migration verifies the
 // original function hash and is covered by run-export-probe-sql.mjs.
 //
 // PGlite's fixture does not include editor exports. Provide only an
 // isolated, null export-evidence helper; the Magic-Effect path tested below
 // still uses real validated, owner-/revision-/SHA-bound rows.
 await db.exec("create function sma_private.publication_export_technical_v1(f sma_private.publication_files_v1) returns jsonb language sql stable security invoker set search_path='' as $stub$ select null::jsonb $stub$;");
 const rollout=await readFile(new URL('../supabase/migrations/20261111010814_publication_instagram_verified_video_precheck_v1.sql',import.meta.url),'utf8');
 const start=rollout.indexOf('CREATE OR REPLACE FUNCTION sma_private.publication_media_precheck_v1(');
 assert.ok(start>0 && rollout.includes('PRECHECK_SOURCE_CHANGED'),'Production deployment must keep a source-hash guard');
 assert.ok(rollout.includes("sma_private.publication_export_technical_v1(f)"),'Production export provenance must survive');
 await db.exec(rollout.slice(start)); // Skip only the environment-specific deployed-version guard.
 const bitrateRollout=await readFile(new URL('../supabase/migrations/20261111003851_publication_instagram_audio_video_bitrate_evidence_v1.sql',import.meta.url),'utf8');
 const bitrateStart=bitrateRollout.indexOf('CREATE OR REPLACE FUNCTION sma_private.publication_media_precheck_v1(');
 assert.ok(bitrateStart>0 && bitrateRollout.includes('INSTAGRAM_AUDIO_VIDEO_RATE_SOURCE_CHANGED'),'Bitrate migration must verify the exact live baseline');
 assert.ok(bitrateRollout.includes("publication_export_technical_v1(f)"),'Export-specific provenance remains in the deployed function');
 await db.exec(bitrateRollout.slice(bitrateStart)); // In-memory fixture bypasses only the production hash guard.
 console.log((await db.query('select version() as version')).rows[0].version);
 for(const file of ['publication-video-magic','publication-media-profiles']) {
  const sql=await readFile(new URL('./'+file+'.sql',import.meta.url),'utf8');let result;
  for(const statement of sql.split(/(?<=;)\n(?=(?:do \$\$|set local role|select set_config|reset role|rollback;|select '))/)){
   try{result=await db.exec(statement);}catch(e){console.error(file+': '+statement.slice(0,700));throw e;}
  }
  console.log(result.at(-1).rows[0].result);
 }
} catch(e) {console.error(e.message,e.where||'',e.detail||'');process.exitCode=1;}
finally {await db.close();}
