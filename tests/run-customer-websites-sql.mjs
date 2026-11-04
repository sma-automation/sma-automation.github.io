import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;"+
 "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;"+
 "create table public.sma_kunden(id bigint primary key,user_id uuid,paket text,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean,shop_slug text,shop_oeffentlich boolean);");
 await db.exec("create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;");
 for(const file of ['website-domain-preparation.sql','company-profiles.sql','customer-websites.sql','customer-website-images.sql'])await db.exec(await readFile(new URL('../supabase/sql/'+file,import.meta.url),'utf8'));
 for(const file of ['customer-websites.sql','company-profiles.sql','customer-website-design.sql','customer-website-images.sql']){
  const results=await db.exec(await readFile(new URL('./'+file,import.meta.url),'utf8'));console.log(results.at(-1).rows[0].result);
 }
 const r=await db.query('select count(*)::int as n from public.sma_kunden');if(r.rows[0].n)throw Error('fixture residue');
}catch(e){console.error(e.message,e.where||'');process.exitCode=1;}finally{await db.close();}
