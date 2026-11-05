import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const uid='ab660000-0000-4000-8000-000000000091',other='ab660000-0000-4000-8000-000000000092';
try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema net;"+
 "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;"+
 "create table public.sma_kunden(id bigint primary key,user_id uuid,paket text,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean,shop_slug text,shop_oeffentlich boolean);"+
 "create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;"+
 "create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;");
 await db.exec(await readFile(new URL('./sql-runtime/vault-test-double.sql',import.meta.url),'utf8'));
 for(const file of ['website-domain-preparation.sql','company-profiles.sql','customer-websites.sql','customer-website-images.sql','customer-website-addresses.sql','website-automatic-setup.sql'])await db.exec(await readFile(new URL('../supabase/sql/'+file,import.meta.url),'utf8'));
 await db.query('insert into public.sma_kunden(id,user_id,paket,aktiv,demo_delta_aktiv) values(91,$1,\'delta\',true,true),(92,$2,\'delta\',true,true)',[uid,other]);
 const user=async(action,input={})=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);try{return (await db.query('select public.sma_website_setup_v1($1,$2) as r',[action,input])).rows[0].r;}finally{await db.exec('reset role');}};
 const worker=async(action,input={})=>{await db.exec('set role service_role');try{return (await db.query('select public.sma_website_setup_worker_v1($1,$2) as r',[action,input])).rows[0].r;}finally{await db.exec('reset role');}};
 eq((await user('start')).code,'WEBSITE_DRAFT_REQUIRED');
 await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
 const site=(await db.query("select public.sma_customer_website_v1('generate',$1) as r",[{expected_revision:0,request_id:crypto.randomUUID()}])).rows[0].r;await db.exec('reset role');eq(site.ok,true);
 eq((await user('start')).code,'SETUP_UNAVAILABLE');
 const sha='a'.repeat(40),creds={sha,account_id:'b'.repeat(32),prefix:'fixture-prefix',ionos_key:'fixture-ionos-secret',cloudflare_token:'fixture-cloudflare-token'};
 eq((await worker('install',creds)).code,'BOOTSTRAP_REJECTED');
 await db.query("insert into sma_private.website_setup_bootstrap_v1 values($1,now()+interval '1 hour',null)",[sha]);
 eq((await worker('install',creds)).ok,true);eq((await worker('install',creds)).code,'BOOTSTRAP_REJECTED');
 const token=(await db.query('select decrypted_secret from vault.decrypted_secrets s join sma_private.website_setup_config_v1 c on c.worker_secret_id=s.id')).rows[0].decrypted_secret;
 const start=await user('start');eq(start.ok,true);eq(start.job.phase,'project');eq((await user('start')).job.id,start.job.id);
 eq((await user('start',{hostname:'stolen.example.com'})).code,'INVALID_INPUT');
 eq((await worker('claim',{token:'bad'})).code,'AUTH_REQUIRED');
 let claim=await worker('claim',{token});eq(claim.job.id,start.job.id);eq((await worker('claim',{token})).job,null);
 eq((await worker('finish',{token,id:start.job.id,lease:crypto.randomUUID(),outcome:'success',state:{}})).code,'LEASE_EXPIRED');
 eq((await worker('finish',{token,id:claim.job.id,lease:claim.job.lease,outcome:'success',state:{secret:'must-not-pass'}})).code,'INVALID_INPUT');
 const finish=async(state={})=>worker('finish',{token,id:claim.job.id,lease:claim.job.lease,outcome:'success',state});
 eq((await finish({project_id:'fixture-project'})).ok,true);eq((await user('get')).job.phase,'deploy');
 // Simulate lost response: the former lease cannot advance another stage.
 eq((await finish()).code,'LEASE_EXPIRED');
 claim=await worker('claim',{token});eq((await worker('finish',{token,id:claim.job.id,lease:claim.job.lease,outcome:'wait',code:'DEPLOYMENT_PENDING'})).ok,true);
 eq((await worker('claim',{token})).job,null);
 await db.exec("update sma_private.website_setup_jobs_v1 set next_attempt_at=now()-interval '1 second'");
 for(const phase of ['deploy','domain','dns','verify']){claim=await worker('claim',{token});eq(claim.job.phase,phase);eq((await finish()).ok,true);}
 eq((await user('get')).job.phase,'active');eq((await worker('claim',{token})).job,null);
 eq((await db.query('select published is null as private,revision from sma_private.customer_websites_v1 where customer_id=91')).rows[0],{private:true,revision:1});
 eq((await db.query('select public.sma_website_origin_v1($1,$2) as yes',[start.job.hostname,site.site_id])).rows[0].yes,true);
 await db.query('update public.sma_kunden set user_id=$1 where id=91',[other]);
 eq((await user('get')).code,'ACCOUNT_UNAVAILABLE');eq((await db.query('select public.sma_website_origin_v1($1,$2) as yes',[start.job.hostname,site.site_id])).rows[0].yes,false);
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  for(const sql of ['select * from sma_private.website_setup_config_v1',"select public.sma_website_setup_worker_v1('claim','{}')"]){let rejected=false;try{await db.exec(sql);}catch{rejected=true;}eq(rejected,true);}
  await db.exec('reset role');
 }
 console.log(`${checks} setup SQL checks passed: ownership, Delta, private draft, idempotence, leases, retry, activation, Vault ACL, no client-selected hostname.`);
}catch(e){console.error(e.message,e.where||'');process.exitCode=1;}finally{await db.close();}
