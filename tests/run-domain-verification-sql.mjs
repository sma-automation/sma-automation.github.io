import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;"+
  "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"+
  "grant usage on schema auth to authenticated,service_role;"+
  "create table public.sma_kunden(id bigint primary key,user_id uuid,paket text,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean,shop_slug text,shop_oeffentlich boolean);");
 for(const name of ['website-domain-preparation','website-domain-verification'])await db.exec(await readFile(new URL('../supabase/sql/'+name+'.sql',import.meta.url),'utf8'));
 const results=await db.exec(await readFile(new URL('./domain-verification.sql',import.meta.url),'utf8'));
 console.log(results.at(-1).rows[0].result);
}catch(e){console.error(e.message,e.where||'');process.exitCode=1;}finally{await db.close();}
