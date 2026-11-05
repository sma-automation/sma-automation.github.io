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
 for(const file of ['website-domain-preparation.sql','company-profiles.sql','customer-websites.sql','customer-website-images.sql','customer-website-addresses.sql','website-automatic-setup.sql','website-setup-origin.sql'])await db.exec(await readFile(new URL('../supabase/sql/'+file,import.meta.url),'utf8'));
 await db.query('insert into public.sma_kunden(id,user_id,paket,aktiv,demo_delta_aktiv) values(91,$1,\'delta\',true,true),(92,$2,\'delta\',true,true)',[uid,other]);
 const user=async(action,input={},owner=uid)=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);try{return (await db.query('select public.sma_website_setup_v1($1,$2) as r',[action,input])).rows[0].r;}finally{await db.exec('reset role');}};
 const worker=async(action,input={})=>{await db.exec('set role service_role');try{return (await db.query('select public.sma_website_setup_worker_v1($1,$2) as r',[action,input])).rows[0].r;}finally{await db.exec('reset role');}};
 eq(await user('get'),{ok:true,available:false,draft_exists:false,job:null});
 eq((await user('start')).code,'SETUP_UNAVAILABLE');
 eq((await db.query('select count(*)::int as n from sma_private.customer_websites_v1')).rows[0].n,0);
 const sha='a'.repeat(40),creds={sha,account_id:'b'.repeat(32),prefix:'fixture-prefix',ionos_key:'fixture-ionos-secret',cloudflare_token:'fixture-cloudflare-token'};
 eq((await worker('install',creds)).code,'BOOTSTRAP_REJECTED');
 await db.query("insert into sma_private.website_setup_bootstrap_v1 values($1,now()+interval '1 hour',null)",[sha]);
 eq((await worker('install',creds)).ok,true);eq((await worker('install',creds)).code,'BOOTSTRAP_REJECTED');
 const token=(await db.query('select decrypted_secret from vault.decrypted_secrets s join sma_private.website_setup_config_v1 c on c.worker_secret_id=s.id')).rows[0].decrypted_secret;
 eq(await user('get'),{ok:true,available:true,draft_exists:false,job:null});
 eq((await user('retry')).code,'WEBSITE_DRAFT_REQUIRED');
 eq((await db.query('select count(*)::int as n from sma_private.customer_websites_v1')).rows[0].n,0);
 const profile=Object.fromEntries(['company_name','legal_form','industry','representative','street','house_number','postal_code','city','country','public_email','phone','contact_person','opening_hours','vat_id','register_number','register_court'].map(k=>[k,'']));
 Object.assign(profile,{company_name:'Fixture Installation',street:'Musterstraße',house_number:'12',postal_code:'1010',city:'Wien',country:'Österreich',public_email:'fixture@example.com',phone:'+43 123'});
 await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
 eq((await db.query("select public.sma_company_profile_v1('save',$1) as r",[{profile,expected_revision:0,request_id:crypto.randomUUID()}])).rows[0].r.ok,true);await db.exec('reset role');
 const start=await user('start');eq(start.ok,true);eq(start.job.phase,'project');eq((await user('start')).job.id,start.job.id);
 eq(start.draft_exists,true);
 const site=(await db.query('select site_id,draft,revision,published from sma_private.customer_websites_v1 where customer_id=91')).rows[0];
 eq(site.revision,1);eq(site.published,null);eq(site.draft.name,'Fixture Installation');eq(site.draft.contact_email,'fixture@example.com');eq(site.draft.contact_address,'Musterstraße 12\n1010 Wien\nÖsterreich');
 eq((await db.query('select count(*)::int as n from sma_private.website_setup_jobs_v1 where customer_id=91')).rows[0].n,1);
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
 // A fixture publication remains local; test address withdrawal for browser reads.
 await db.exec('update sma_private.customer_websites_v1 set published=draft where customer_id=91');
 await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({origin:'https://'+start.job.hostname})]);
 eq((await db.query('select public.sma_customer_website_public_v1($1) as r',[site.site_id])).rows[0].r.ok,true);
 // A repeat never regenerates, edits or unpublishes an existing website.
 const beforeRepeat=(await db.query('select draft,published,revision from sma_private.customer_websites_v1 where customer_id=91')).rows[0];
 eq((await user('start')).job.id,start.job.id);
 eq((await db.query('select draft,published,revision from sma_private.customer_websites_v1 where customer_id=91')).rows[0],beforeRepeat);
 await db.exec('update sma_private.customer_website_addresses_v1 set revoked_at=now() where customer_id=91');
 eq((await db.query('select public.sma_customer_website_public_v1($1) as r',[site.site_id])).rows[0].r.code,'NOT_AVAILABLE');
 await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({origin:'https://sma-automation.com'})]);
 eq((await db.query('select public.sma_customer_website_public_v1($1) as r',[site.site_id])).rows[0].r.ok,true);
 await db.exec('update sma_private.customer_website_addresses_v1 set revoked_at=null where customer_id=91');
 // Rejected new customers create neither a draft nor a provisioning job.
 eq((await user('start',{},'')).code,'AUTH_REQUIRED');
 await db.exec('update public.sma_kunden set aktiv=false where id=92');
 eq((await user('start',{},other)).code,'ACCESS_INACTIVE');
 await db.exec("update public.sma_kunden set aktiv=true,demo_delta_aktiv=false,zahlung_bestaetigt=true,paket='alpha' where id=92");
 eq((await user('start',{},other)).code,'ACCESS_INACTIVE');
 await db.exec("update public.sma_kunden set paket='delta' where id=92");
 await db.query('insert into sma_private.company_profiles_v1(customer_id,user_id,profile,revision,last_request_id) values(92,$1,$2,1,$3)',[uid,profile,crypto.randomUUID()]);
 eq((await user('start',{},other)).code,'ACCOUNT_CHANGED');
 eq((await db.query('select count(*)::int as n from sma_private.customer_websites_v1 where customer_id=92')).rows[0].n,0);
 eq((await db.query('select count(*)::int as n from sma_private.website_setup_jobs_v1 where customer_id=92')).rows[0].n,0);
 await db.query('update sma_private.company_profiles_v1 set user_id=$1 where customer_id=92',[other]);
 // A failed job insert rolls back the newly generated draft in the same statement.
 await db.exec("alter table sma_private.website_setup_jobs_v1 add constraint fixture_fail_job check(customer_id<>92)");
 let failed=false;try{await user('start',{},other);}catch{failed=true;}eq(failed,true);
 eq((await db.query('select count(*)::int as n from sma_private.customer_websites_v1 where customer_id=92')).rows[0].n,0);
 await db.exec('alter table sma_private.website_setup_jobs_v1 drop constraint fixture_fail_job');
 const second=await user('start',{},other);eq(second.ok,true);eq(second.job.id!==start.job.id,true);
 eq((await db.query('select published is null as private,revision from sma_private.customer_websites_v1 where customer_id=92')).rows[0],{private:true,revision:1});
 await db.query('update public.sma_kunden set user_id=$1 where id=91',[other]);
 eq((await user('get')).code,'ACCOUNT_UNAVAILABLE');eq((await db.query('select public.sma_website_origin_v1($1,$2) as yes',[start.job.hostname,site.site_id])).rows[0].yes,false);
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  for(const sql of ['select * from sma_private.website_setup_config_v1',"select public.sma_website_setup_worker_v1('claim','{}')"]){let rejected=false;try{await db.exec(sql);}catch{rejected=true;}eq(rejected,true);}
  await db.exec('reset role');
 }
 console.log(`${checks} setup SQL checks passed: ownership, Delta, private draft, idempotence, leases, retry, activation, Vault ACL, no client-selected hostname.`);
}catch(e){console.error(e.message,e.where||'');process.exitCode=1;}finally{await db.close();}
