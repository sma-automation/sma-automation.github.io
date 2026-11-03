// npm ci --prefix tests/sql-runtime --ignore-scripts
// node tests/run-publication-accounts-sql.mjs
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
 for(const file of ['publication-preview','publication-files','publication-media-precheck','publication-content-review','publication-magic-effect','publication-video-technical','publication-video-magic','publication-media-profiles','publication-accounts','publication-orders']) {
  await db.exec(await readFile(new URL('../supabase/sql/'+file+'.sql',import.meta.url),'utf8'));
 }
 console.log((await db.query('select version() as version')).rows[0].version);
 for(const file of ['publication-accounts','publication-orders','publication-order-creator']) {
  const sql=await readFile(new URL('./'+file+'.sql',import.meta.url),'utf8');let result;
  for(const statement of sql.split(/(?<=;)\n(?=(?:do \$\$|set local role|select set_config|reset role|rollback;|select '))/)){
   try{result=await db.exec(statement);}catch(e){console.error(file+': '+statement.slice(0,700));throw e;}
  }
  console.log(result.at(-1).rows[0].result);
 }
} catch(e) {console.error(e.message,e.where||'',e.detail||'');process.exitCode=1;}
finally {await db.close();}
