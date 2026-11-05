-- Platform-owned SMA addresses. No customer-supplied hostname can reach a provider.
-- Private content is never published by this job.
create table sma_private.website_setup_config_v1 (
 id boolean primary key default true check(id),
 enabled boolean not null default false,
 account_id text not null check(account_id ~ '^[a-f0-9]{32}$'),
 zone text not null check(zone='sma-automation.com'),
 ionos_prefix text not null,
 ionos_secret_id uuid not null,
 cloudflare_secret_id uuid not null,
 worker_secret_id uuid not null,
 installed_at timestamptz not null default now()
);
create table sma_private.website_setup_bootstrap_v1 (
 sha text primary key check(sha ~ '^[a-f0-9]{40}$'),
 expires_at timestamptz not null,
 consumed_at timestamptz
);
create table sma_private.website_setup_jobs_v1 (
 id uuid primary key default gen_random_uuid(),
 customer_id bigint not null unique references public.sma_kunden(id),
 user_id uuid not null,
 site_id uuid not null unique references sma_private.customer_websites_v1(site_id),
 hostname text not null unique check(sma_private.website_domain_valid_v1(hostname)),
 project_name text not null unique,
 marker uuid not null default gen_random_uuid(),
 phase text not null default 'project' check(phase in ('project','deploy','domain','dns','verify','active')),
 blocked boolean not null default false,
 error_code text check(error_code ~ '^[A-Z][A-Z0-9_]{0,99}$'),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 lease uuid,
 lease_until timestamptz,
 provider_state jsonb not null default '{}',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 completed_at timestamptz
);
alter table sma_private.website_setup_config_v1 enable row level security;
alter table sma_private.website_setup_bootstrap_v1 enable row level security;
alter table sma_private.website_setup_jobs_v1 enable row level security;
revoke all on sma_private.website_setup_config_v1,sma_private.website_setup_bootstrap_v1,sma_private.website_setup_jobs_v1 from public,anon,authenticated,service_role;

-- Called only by an installed cron task or a transaction that queued work.
create function sma_private.website_setup_wake_v1() returns void
language plpgsql security definer set search_path='' as $$
declare token text;
begin
 if not exists(select 1 from sma_private.website_setup_jobs_v1 where phase<>'active' and not blocked and next_attempt_at<=now() and coalesce(lease_until,'-infinity')<now()) then return;end if;
 select s.decrypted_secret into token from sma_private.website_setup_config_v1 c
 join vault.decrypted_secrets s on s.id=c.worker_secret_id where c.enabled;
 if token is null then return;end if;
 perform net.http_post(
  url:='https://bnvnmdxosbnuzedokqgh.supabase.co/functions/v1/sma-website-setup',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
  body:='{}'::jsonb,timeout_milliseconds:=5000);
end $$;
revoke all on function sma_private.website_setup_wake_v1() from public,anon,authenticated,service_role;

create function sma_private.website_setup_request_v1(p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();c public.sma_kunden%rowtype;w sma_private.customer_websites_v1%rowtype;
 j sma_private.website_setup_jobs_v1%rowtype; ready boolean; new_id uuid; generated jsonb;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_action is null or p_action not in ('get','start','retry') or p_input is distinct from '{}'::jsonb then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 begin select * into strict c from public.sma_kunden where user_id=uid for update;
 exception when no_data_found or too_many_rows then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true)
  or (c.demo_delta_aktiv is not true and lower(btrim(coalesce(c.paket,'')))<>'delta') then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 select * into w from sma_private.customer_websites_v1 where customer_id=c.id;
 if w.site_id is not null and w.user_id is distinct from uid then return jsonb_build_object('ok',false,'code','ACCOUNT_CHANGED');end if;
 select exists(select 1 from sma_private.website_setup_config_v1 where enabled) into ready;
 select * into j from sma_private.website_setup_jobs_v1 where customer_id=c.id for update;
 if j.id is not null and (j.user_id is distinct from uid or j.site_id is distinct from w.site_id) then return jsonb_build_object('ok',false,'code','ACCOUNT_CHANGED');end if;
 if p_action in ('start','retry') then
  if not ready then return jsonb_build_object('ok',false,'code','SETUP_UNAVAILABLE');end if;
  if w.site_id is null then
   if p_action<>'start' then return jsonb_build_object('ok',false,'code','WEBSITE_DRAFT_REQUIRED');end if;
   -- The customer row is locked. Reuse the existing generator and company-profile
   -- checks; draft and setup job commit together. GET never creates anything.
   generated:=sma_private.customer_website_request_v1('generate',jsonb_build_object('expected_revision',0,'request_id',gen_random_uuid()));
   if generated->>'ok' is distinct from 'true' then return generated;end if;
   select * into strict w from sma_private.customer_websites_v1 where customer_id=c.id and user_id=uid;
  end if;
  if j.id is null then
   new_id:=gen_random_uuid();
   insert into sma_private.website_setup_jobs_v1(id,customer_id,user_id,site_id,hostname,project_name)
   values(new_id,c.id,uid,w.site_id,'seite-'||c.id||'-'||left(w.site_id::text,8)||'.sma-automation.com','sma-site-'||replace(new_id::text,'-','')) returning * into j;
  elsif p_action='retry' and j.blocked then
   -- Never retry an ownership conflict or adopt a foreign resource.
   if j.error_code in ('ACCOUNT_CHANGED','RESOURCE_CONFLICT','DNS_RECORD_CONFLICT','DNS_SUBTREE_CONFLICT','DNS_ANCESTOR_CONFLICT','DNS_WILDCARD_CONFLICT') then return jsonb_build_object('ok',false,'code','REVIEW_REQUIRED');end if;
   update sma_private.website_setup_jobs_v1 set blocked=false,error_code=null,attempts=0,next_attempt_at=now() where id=j.id returning * into j;
  end if;
  perform sma_private.website_setup_wake_v1();
 end if;
 return jsonb_build_object('ok',true,'available',ready,'draft_exists',w.site_id is not null,'job',case when j.id is null then null else jsonb_build_object(
  'id',j.id,'hostname',j.hostname,'phase',j.phase,'blocked',j.blocked,'code',j.error_code,'updated_at',j.updated_at,'completed_at',j.completed_at) end);
end $$;
revoke all on function sma_private.website_setup_request_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function sma_private.website_setup_request_v1(text,jsonb) to authenticated;
create function public.sma_website_setup_v1(p_action text,p_input jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select sma_private.website_setup_request_v1(p_action,p_input)$$;
revoke all on function public.sma_website_setup_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_website_setup_v1(text,jsonb) to authenticated;

-- This RPC is only callable by the server. Tokens and provider credentials are
-- never returned through the customer-facing RPC or included in status/errors.
create function sma_private.website_setup_worker_v1(p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg sma_private.website_setup_config_v1%rowtype; j sma_private.website_setup_jobs_v1%rowtype;
 c public.sma_kunden%rowtype; token text; ionos_id uuid;cf_id uuid;worker_id uuid; next_phase text;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>12000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if p_action='install' then
  -- Edge verifies GitHub's signed OIDC claims, including the exact allowed SHA.
  perform 1 from sma_private.website_setup_bootstrap_v1 where sha=p_input->>'sha' and expires_at>now() and consumed_at is null for update;
  if not found or exists(select 1 from sma_private.website_setup_config_v1) then return jsonb_build_object('ok',false,'code','BOOTSTRAP_REJECTED');end if;
  if not(p_input ?& array['sha','account_id','ionos_key','cloudflare_token','prefix']) or p_input->>'account_id' !~ '^[a-f0-9]{32}$' or length(p_input->>'ionos_key') not between 16 and 1024 or length(p_input->>'cloudflare_token') not between 16 and 1024 or p_input->>'prefix' !~ '^[A-Za-z0-9_-]{8,128}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  ionos_id:=vault.create_secret(p_input->>'ionos_key','sma-website-ionos-v1');
  cf_id:=vault.create_secret(p_input->>'cloudflare_token','sma-website-cloudflare-v1');
  -- UUIDs come from pgcrypto's cryptographically secure generator.
  token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  worker_id:=vault.create_secret(token,'sma-website-worker-v1');
  insert into sma_private.website_setup_config_v1(id,enabled,account_id,zone,ionos_prefix,ionos_secret_id,cloudflare_secret_id,worker_secret_id)
  values(true,true,p_input->>'account_id','sma-automation.com',p_input->>'prefix',ionos_id,cf_id,worker_id);
  update sma_private.website_setup_bootstrap_v1 set consumed_at=now() where sha=p_input->>'sha';
  return jsonb_build_object('ok',true,'code','PROVIDERS_INSTALLED');
 end if;
 select * into cfg from sma_private.website_setup_config_v1 where enabled;
 select decrypted_secret into token from vault.decrypted_secrets where id=cfg.worker_secret_id;
 if token is null or p_input->>'token' is distinct from token then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_action='claim' then
  select * into j from sma_private.website_setup_jobs_v1 where phase<>'active' and not blocked and next_attempt_at<=now() and coalesce(lease_until,'-infinity')<now() order by next_attempt_at for update skip locked limit 1;
  if j.id is null then return jsonb_build_object('ok',true,'job',null);end if;
 elsif p_action='finish' then
  select * into j from sma_private.website_setup_jobs_v1 where id=(p_input->>'id')::uuid and lease=(p_input->>'lease')::uuid and lease_until>now() for update;
  if j.id is null then return jsonb_build_object('ok',false,'code','LEASE_EXPIRED');end if;
 else return jsonb_build_object('ok',false,'code','INVALID_ACTION');end if;
 select * into c from public.sma_kunden where id=j.customer_id;
 if c.user_id is distinct from j.user_id or c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true)
  or (c.demo_delta_aktiv is not true and lower(btrim(coalesce(c.paket,'')))<>'delta')
  or not exists(select 1 from sma_private.customer_websites_v1 where site_id=j.site_id and customer_id=j.customer_id and user_id=j.user_id) then
  update sma_private.website_setup_jobs_v1 set blocked=true,error_code='ACCOUNT_CHANGED',lease=null,lease_until=null,updated_at=now() where id=j.id;
  return jsonb_build_object('ok',false,'code','ACCOUNT_CHANGED');
 end if;
 if p_action='claim' then
  update sma_private.website_setup_jobs_v1 set lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now() where id=j.id returning * into j;
  return jsonb_build_object('ok',true,'job',to_jsonb(j),'providers',jsonb_build_object('account_id',cfg.account_id,'zone',cfg.zone,'prefix',cfg.ionos_prefix,
   'ionos_key',(select decrypted_secret from vault.decrypted_secrets where id=cfg.ionos_secret_id),
   'cloudflare_token',(select decrypted_secret from vault.decrypted_secrets where id=cfg.cloudflare_secret_id)));
 end if;
 if p_input->>'outcome'='success' then
  next_phase:=case j.phase when 'project' then 'deploy' when 'deploy' then 'domain' when 'domain' then 'dns' when 'dns' then 'verify' when 'verify' then 'active' end;
  if next_phase is null or jsonb_typeof(p_input->'state') is distinct from 'object' or octet_length((p_input->'state')::text)>3000
   or exists(select 1 from jsonb_object_keys(p_input->'state') k where k not in ('project_id','deployment_id','dns_record_id','dns_zone_id')) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  if next_phase='active' then
   insert into sma_private.customer_website_addresses_v1(customer_id,user_id,site_id,hostname,evidence)
   values(j.customer_id,j.user_id,j.site_id,j.hostname,'Automatic setup: owned Pages project, deployment, IONOS CNAME, public DNS and HTTPS binding verified; job '||j.id)
   on conflict(customer_id) do update set user_id=excluded.user_id,site_id=excluded.site_id,hostname=excluded.hostname,verified_at=now(),evidence=excluded.evidence,revoked_at=null;
  end if;
  update sma_private.website_setup_jobs_v1 set phase=next_phase,provider_state=provider_state||(p_input->'state'),error_code=null,attempts=0,next_attempt_at=now(),lease=null,lease_until=null,updated_at=now(),completed_at=case when next_phase='active' then now() else null end where id=j.id;
 elsif p_input->>'outcome' in ('wait','error') and p_input->>'code' ~ '^[A-Z][A-Z0-9_]{0,99}$' then
  update sma_private.website_setup_jobs_v1 set error_code=p_input->>'code',blocked=(p_input->>'outcome'='error' or attempts>=120),next_attempt_at=now()+make_interval(secs=>least(300,greatest(30,attempts*15))),lease=null,lease_until=null,updated_at=now() where id=j.id;
 else return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform sma_private.website_setup_wake_v1();
 return jsonb_build_object('ok',true,'code','CHECKPOINT_SAVED');
end $$;
revoke all on function sma_private.website_setup_worker_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function sma_private.website_setup_worker_v1(text,jsonb) to service_role;
create function public.sma_website_setup_worker_v1(p_action text,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select sma_private.website_setup_worker_v1(p_action,p_input)$$;
revoke all on function public.sma_website_setup_worker_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_website_setup_worker_v1(text,jsonb) to service_role;

-- Resolve only active addresses, and recheck current owner and access for every image request.
create function sma_private.website_origin_v1(p_hostname text,p_site uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from sma_private.customer_website_addresses_v1 a
 join sma_private.customer_websites_v1 w on w.site_id=a.site_id and w.customer_id=a.customer_id and w.user_id=a.user_id
 join public.sma_kunden c on c.id=a.customer_id and c.user_id=a.user_id
 where a.hostname=p_hostname and a.site_id=p_site and a.revoked_at is null and a.verified_at<=now()
 and c.aktiv is true and (c.demo_delta_aktiv is true or (c.zahlung_bestaetigt is true and lower(btrim(c.paket))='delta')));
$$;
revoke all on function sma_private.website_origin_v1(text,uuid) from public,anon,authenticated,service_role;
grant usage on schema sma_private to service_role;
grant execute on function sma_private.website_origin_v1(text,uuid) to service_role;
create function public.sma_website_origin_v1(p_hostname text,p_site uuid) returns boolean
language sql stable security invoker set search_path='' as $$select sma_private.website_origin_v1(p_hostname,p_site)$$;
revoke all on function public.sma_website_origin_v1(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sma_website_origin_v1(text,uuid) to service_role;
