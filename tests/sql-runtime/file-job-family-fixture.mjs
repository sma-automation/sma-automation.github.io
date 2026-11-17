// Shared synthetic schema fixture for PGlite and the dedicated localhost-only
// PostgreSQL concurrency database. All business functions are repository SQL.
import {readFile} from 'node:fs/promises';

export const fileFamilyUUID=n=>'bc780000-0000-4000-8000-'+String(n).padStart(12,'0');
export const fileFamilyOwner=fileFamilyUUID(9001),fileFamilyOther=fileFamilyUUID(9002);
export const fileFamilySource=name=>readFile(new URL('../../supabase/sql/'+name+'.sql',import.meta.url),'utf8');
const fixture=name=>readFile(new URL('./'+name,import.meta.url),'utf8');

export async function installFileFamilyBaseline(db,{createRoles=true}={}){
 if(createRoles)await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 await db.exec(`create schema auth;grant usage on schema auth to authenticated,service_role;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table public.sma_kunden(id bigint primary key,user_id uuid,n8n_kunde_id text,kunde_email text,aktiv boolean,
   demo_delta_aktiv boolean,zahlung_bestaetigt boolean,shop_slug text,shop_oeffentlich boolean);
  grant select on public.sma_kunden to service_role;`);
 for(const name of ['publication-preview','publication-files','publication-media-precheck','publication-content-review',
  'publication-magic-effect','publication-video-technical','publication-video-magic','publication-media-profiles',
  'publication-accounts','publication-content-comparison','publication-orders','publication-comparison-queue','publication-asset-preview',
  'publication-device-upload','publication-editor-history','publication-editor-exports','publication-caption-history','publication-text-edits'])await db.exec(await fileFamilySource(name));
 for(const fn of JSON.parse(await fixture('manual-review-live-baseline.json')))await db.exec(fn.definition);
 await db.exec(await fixture('provider-cover-pr57-journal.sql'));
 for(const name of ['publication-manual-review','publication-provider-cover','publication-history','publication-history-months',
  'publication-cover-history','publication-approval-window','publication-pending-preparation','publication-history-order-caption',
  'publication-history-order-page','publication-existing-approval','publication-cancel-preparation','publication-tiktok-aigc','file-command-mailbox'])await db.exec(await fileFamilySource(name));
 await db.query(`insert into public.sma_kunden values
  (1,$1,'synthetic_family_owner','owner@example.invalid',true,true,false,'family-fixture',true),
  (2,$2,'synthetic_family_other','other@example.invalid',true,true,false,'other-family-fixture',true)`,[fileFamilyOwner,fileFamilyOther]);
}
