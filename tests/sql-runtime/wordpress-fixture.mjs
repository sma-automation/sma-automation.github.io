import {readFile} from 'node:fs/promises';

export async function installWordpressFixture(db) {
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;"+
  "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"+
  "grant usage on schema auth to authenticated,service_role;"+
  "create table auth.users(id uuid primary key,email text);"+
  "create table public.sma_kunden(id bigint primary key,user_id uuid,paket text,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean,shop_slug text,shop_oeffentlich boolean);");
 await db.exec(await readFile(new URL('./vault-test-double.sql',import.meta.url),'utf8'));
 for(const name of ['website-domain-preparation','website-domain-verification','website-connection-requests','website-provider-credentials','wordpress-tickets','wordpress-sync-jobs'])
  await db.exec(await readFile(new URL('../../supabase/sql/'+name+'.sql',import.meta.url),'utf8'));
}
