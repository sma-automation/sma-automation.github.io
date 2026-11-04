-- Candidate: run after website-connection-requests.sql. Requires Supabase Vault.
-- Only a trusted server adapter may submit independently verified credentials.
alter table sma_private.website_connection_requests_v1
 add column verification_id uuid,
 add column verification_started_at timestamptz;

create table sma_private.website_provider_connections_v1 (
 customer_id bigint primary key references public.sma_kunden(id),
 user_id uuid not null,
 attempt_id uuid not null unique,
 verification_id uuid not null unique,
 preparation_revision integer not null,
 provider text not null check(provider in ('wordpress','hostinger')),
 website_url text not null,
 provider_site_id text not null check(octet_length(provider_site_id) between 1 and 255),
 secret_id uuid not null unique,
 credential_hash text not null check(credential_hash ~ '^[a-f0-9]{64}$'),
 proof jsonb not null,
 verified_at timestamptz not null default clock_timestamp()
);
alter table sma_private.website_provider_connections_v1 enable row level security;
revoke all on sma_private.website_provider_connections_v1 from public,anon,authenticated,service_role;

-- Returns server context only. Every caller locks customer -> draft -> request.
-- A completed connection outlives its initial ten-minute authorization window.
create function sma_private.website_provider_binding_v1(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.sma_kunden%rowtype;d sma_private.website_preparations_v1%rowtype;r sma_private.website_connection_requests_v1%rowtype;
begin
 if p_user_id is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 begin select * into strict c from public.sma_kunden where user_id=p_user_id for update;
 exception when no_data_found or too_many_rows then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end;
 select * into d from sma_private.website_preparations_v1 where customer_id=c.id for update;
 select * into r from sma_private.website_connection_requests_v1 where customer_id=c.id for update;
 if d.user_id is distinct from p_user_id or r.user_id is distinct from p_user_id then return jsonb_build_object('ok',false,'code','ACCOUNT_CHANGED');end if;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or (c.zahlung_bestaetigt is true and lower(btrim(coalesce(c.paket,'')))='delta'))
 then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 if r.state<>'pending' or d.mode<>'existing' or r.preparation_revision<>d.revision or r.website_url<>d.website_url
 then return jsonb_build_object('ok',false,'code','REQUEST_STALE');end if;
 return jsonb_build_object('ok',true,'customer_id',c.id,'user_id',p_user_id,'attempt_id',r.attempt_id,
  'provider',r.provider,'website_url',r.website_url,'preparation_revision',r.preparation_revision,
  'expires_at',r.expires_at,'verification_id',r.verification_id,'verification_started_at',r.verification_started_at);
end $$;
revoke all on function sma_private.website_provider_binding_v1(uuid) from public,anon,authenticated,service_role;

create function sma_private.website_provider_begin_v1(p_user_id uuid,p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb;v uuid;
begin
 b:=sma_private.website_provider_binding_v1(p_user_id);
 if b->>'ok'<>'true' then return b;end if;
 if p_attempt_id is null or (b->>'attempt_id')::uuid<>p_attempt_id or (b->>'expires_at')::timestamptz<=clock_timestamp()
 then return jsonb_build_object('ok',false,'code','REQUEST_STALE');end if;
 if exists(select 1 from sma_private.website_provider_connections_v1 where customer_id=(b->>'customer_id')::bigint)
 then return jsonb_build_object('ok',false,'code','ALREADY_VERIFIED');end if;
 if b->>'verification_id' is not null and (b->>'verification_started_at')::timestamptz>clock_timestamp()-interval '2 minutes'
 then return jsonb_build_object('ok',false,'code','VERIFICATION_BUSY');end if;
 v:=gen_random_uuid();
 update sma_private.website_connection_requests_v1 set verification_id=v,verification_started_at=clock_timestamp() where customer_id=(b->>'customer_id')::bigint;
 return jsonb_build_object('ok',true,'attempt_id',p_attempt_id,'verification_id',v,
  'provider',b->>'provider','website_url',b->>'website_url','preparation_revision',b->'preparation_revision');
end $$;

create function sma_private.website_provider_finish_v1(p_user_id uuid,p_attempt_id uuid,p_verification_id uuid,p_proof jsonb,p_credentials jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb;c sma_private.website_provider_connections_v1%rowtype;h text;s uuid;
begin
 if p_attempt_id is null or p_verification_id is null or jsonb_typeof(p_proof) is distinct from 'object' or octet_length(p_proof::text)>4096
 then return jsonb_build_object('ok',false,'code','INVALID_PROOF');end if;
 if jsonb_typeof(p_credentials) is distinct from 'object' or octet_length(p_credentials::text)>16384
 then return jsonb_build_object('ok',false,'code','INVALID_CREDENTIALS');end if;
 if not(p_proof ?& array['website_url','provider_site_id','can_read'])
  or exists(select 1 from jsonb_object_keys(p_proof) k where k not in ('website_url','provider_site_id','can_read'))
  or p_proof->'can_read' is distinct from 'true'::jsonb
  or jsonb_typeof(p_proof->'website_url') is distinct from 'string'
  or jsonb_typeof(p_proof->'provider_site_id') is distinct from 'string'
  or octet_length(p_proof->>'provider_site_id') not between 1 and 255 or p_proof->>'provider_site_id' ~ '[[:cntrl:]]'
 then return jsonb_build_object('ok',false,'code','INVALID_PROOF');end if;
 b:=sma_private.website_provider_binding_v1(p_user_id);
 if b->>'ok'<>'true' then return b;end if;
 if (b->>'attempt_id')::uuid<>p_attempt_id or b->>'website_url'<>p_proof->>'website_url'
 then return jsonb_build_object('ok',false,'code','REQUEST_STALE');end if;
 if b->>'provider'='hostinger' then
  if not(p_credentials ? 'access_token') or (select count(*) from jsonb_object_keys(p_credentials))<>1
   or jsonb_typeof(p_credentials->'access_token') is distinct from 'string'
   or octet_length(p_credentials->>'access_token') not between 16 and 8192
   or p_credentials->>'access_token' ~ '[[:space:][:cntrl:]]'
  then return jsonb_build_object('ok',false,'code','INVALID_CREDENTIALS');end if;
 else
  if not(p_credentials ?& array['username','password']) or (select count(*) from jsonb_object_keys(p_credentials))<>2
   or jsonb_typeof(p_credentials->'username') is distinct from 'string' or jsonb_typeof(p_credentials->'password') is distinct from 'string'
   or octet_length(p_credentials->>'username') not between 1 and 255 or octet_length(p_credentials->>'password') not between 16 and 256
   or position(':' in p_credentials->>'username')>0 or p_credentials->>'username' ~ '[[:cntrl:]]' or p_credentials->>'password' ~ '[[:cntrl:]]'
  then return jsonb_build_object('ok',false,'code','INVALID_CREDENTIALS');end if;
 end if;
 h:=encode(sha256(convert_to(p_credentials::text,'UTF8')),'hex');
 select * into c from sma_private.website_provider_connections_v1 where customer_id=(b->>'customer_id')::bigint for update;
 if c.customer_id is not null then
  if c.user_id=p_user_id and c.attempt_id=p_attempt_id and c.verification_id=p_verification_id and c.credential_hash=h and c.proof=p_proof
  then
   if not exists(select 1 from vault.secrets where id=c.secret_id) then return jsonb_build_object('ok',false,'code','CREDENTIAL_UNAVAILABLE');end if;
   return jsonb_build_object('ok',true,'state','verified','verified_at',c.verified_at);
  end if;
  return jsonb_build_object('ok',false,'code','VERIFICATION_CONFLICT');
 end if;
 if (b->>'verification_id')::uuid is distinct from p_verification_id
  or b->>'verification_started_at' is null
  or (b->>'verification_started_at')::timestamptz<=clock_timestamp()-interval '2 minutes'
  or (b->>'expires_at')::timestamptz<=clock_timestamp()
 then return jsonb_build_object('ok',false,'code','VERIFICATION_STALE');end if;
 s:=vault.create_secret(p_credentials::text,null,'SMA website provider credential');
 insert into sma_private.website_provider_connections_v1(customer_id,user_id,attempt_id,verification_id,preparation_revision,provider,website_url,provider_site_id,secret_id,credential_hash,proof)
 values((b->>'customer_id')::bigint,p_user_id,p_attempt_id,p_verification_id,(b->>'preparation_revision')::integer,b->>'provider',b->>'website_url',p_proof->>'provider_site_id',s,h,p_proof)
 returning * into c;
 update sma_private.website_connection_requests_v1 set verification_id=null,verification_started_at=null where customer_id=c.customer_id;
 return jsonb_build_object('ok',true,'state','verified','verified_at',c.verified_at);
end $$;

-- Only the server can load credentials, bound to the current owner and attempt.
-- A provider's rejection can forget the matching secret without affecting a
-- newer connection. No secret is returned when forgetting.
create function sma_private.website_provider_credential_v1(p_user_id uuid,p_attempt_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb;c sma_private.website_provider_connections_v1%rowtype;v text;
begin
 if p_action is null or p_action not in ('get','forget') then return jsonb_build_object('ok',false,'code','INVALID_ACTION');end if;
 b:=sma_private.website_provider_binding_v1(p_user_id);
 if b->>'ok'<>'true' then return b;end if;
 if p_attempt_id is null or (b->>'attempt_id')::uuid<>p_attempt_id then return jsonb_build_object('ok',false,'code','REQUEST_STALE');end if;
 select * into c from sma_private.website_provider_connections_v1 where customer_id=(b->>'customer_id')::bigint for update;
 if c.user_id is distinct from p_user_id or c.attempt_id is distinct from p_attempt_id or c.website_url is distinct from b->>'website_url'
  or c.preparation_revision is distinct from (b->>'preparation_revision')::integer
 then return jsonb_build_object('ok',false,'code','NOT_CONNECTED');end if;
 if p_action='forget' then
  delete from vault.secrets where id=c.secret_id;
  delete from sma_private.website_provider_connections_v1 where customer_id=c.customer_id;
  return jsonb_build_object('ok',true,'state','disconnected');
 end if;
 select decrypted_secret into v from vault.decrypted_secrets where id=c.secret_id;
 if v is null then return jsonb_build_object('ok',false,'code','CREDENTIAL_UNAVAILABLE');end if;
 return jsonb_build_object('ok',true,'provider',c.provider,'website_url',c.website_url,'provider_site_id',c.provider_site_id,
  'attempt_id',c.attempt_id,'verified_at',c.verified_at,'credentials',v::jsonb);
end $$;

-- Resolves the durable attempt after a reload, even after the login window.
-- A worker then loads credentials for this exact attempt; a concurrent change
-- makes that load fail instead of silently switching the worker to another site.
create function sma_private.website_provider_context_v1(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb;c sma_private.website_provider_connections_v1%rowtype;
begin
 b:=sma_private.website_provider_binding_v1(p_user_id);
 if b->>'ok'<>'true' then return b;end if;
 select * into c from sma_private.website_provider_connections_v1 where customer_id=(b->>'customer_id')::bigint for update;
 if c.user_id is distinct from p_user_id or c.attempt_id is distinct from (b->>'attempt_id')::uuid
  or c.website_url is distinct from b->>'website_url' or c.preparation_revision is distinct from (b->>'preparation_revision')::integer
  or not exists(select 1 from vault.secrets where id=c.secret_id)
 then return jsonb_build_object('ok',true,'state','not_connected','website_connected',false,'can_synchronize',false,'can_publish',false);end if;
 return jsonb_build_object('ok',true,'state','verified','provider',c.provider,'website_url',c.website_url,'attempt_id',c.attempt_id,
  'verified_at',c.verified_at,'website_connected',true,'can_synchronize',false,'can_publish',false);
end $$;

create function sma_private.website_provider_status_v1()
returns jsonb language sql security definer set search_path='' as $$select sma_private.website_provider_context_v1(auth.uid())$$;

-- Delete only the SMA-owned secret tied to the changed customer. Existing
-- credentials cannot survive a changed target, new attempt, withdrawal or owner.
create function sma_private.website_provider_invalidate_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare cid bigint;s uuid;
begin
 if TG_TABLE_NAME='website_connection_requests_v1' then
  if TG_OP='UPDATE' and new.attempt_id=old.attempt_id and new.state=old.state and new.user_id=old.user_id
   and new.customer_id=old.customer_id and new.provider=old.provider and new.website_url=old.website_url
   and new.preparation_revision=old.preparation_revision then return new;end if;
  if TG_OP='UPDATE' then new.verification_id:=null;new.verification_started_at:=null;end if;
  cid:=old.customer_id;
 elsif TG_TABLE_NAME='website_preparations_v1' then
  if TG_OP='UPDATE' and new.user_id=old.user_id and new.revision=old.revision and new.website_url=old.website_url and new.mode=old.mode then return new;end if;
  cid:=old.customer_id;
 elsif TG_TABLE_NAME='sma_kunden' then
  if TG_OP='UPDATE' and new.user_id is not distinct from old.user_id then return new;end if;
  cid:=old.id;
 else raise exception 'Unexpected credential trigger';end if;
 select secret_id into s from sma_private.website_provider_connections_v1 where customer_id=cid for update;
 if s is not null then
  delete from vault.secrets where id=s;
  delete from sma_private.website_provider_connections_v1 where customer_id=cid;
 end if;
 return case when TG_OP='DELETE' then old else new end;
end $$;
revoke all on function sma_private.website_provider_invalidate_v1() from public,anon,authenticated,service_role;
create trigger website_provider_request_invalidated before update or delete on sma_private.website_connection_requests_v1 for each row execute function sma_private.website_provider_invalidate_v1();
create trigger website_provider_target_invalidated before update or delete on sma_private.website_preparations_v1 for each row execute function sma_private.website_provider_invalidate_v1();
create trigger website_provider_owner_invalidated before update or delete on public.sma_kunden for each row execute function sma_private.website_provider_invalidate_v1();

revoke all on function sma_private.website_provider_begin_v1(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function sma_private.website_provider_finish_v1(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function sma_private.website_provider_credential_v1(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function sma_private.website_provider_status_v1() from public,anon,authenticated,service_role;
revoke all on function sma_private.website_provider_context_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function sma_private.website_provider_begin_v1(uuid,uuid) to service_role;
grant execute on function sma_private.website_provider_finish_v1(uuid,uuid,uuid,jsonb,jsonb) to service_role;
grant execute on function sma_private.website_provider_credential_v1(uuid,uuid,text) to service_role;
grant execute on function sma_private.website_provider_status_v1() to authenticated;
grant execute on function sma_private.website_provider_context_v1(uuid) to service_role;

create function public.sma_website_provider_begin_v1(p_user_id uuid,p_attempt_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select sma_private.website_provider_begin_v1(p_user_id,p_attempt_id)$$;
create function public.sma_website_provider_finish_v1(p_user_id uuid,p_attempt_id uuid,p_verification_id uuid,p_proof jsonb,p_credentials jsonb)
returns jsonb language sql security invoker set search_path='' as $$select sma_private.website_provider_finish_v1(p_user_id,p_attempt_id,p_verification_id,p_proof,p_credentials)$$;
create function public.sma_website_provider_credential_v1(p_user_id uuid,p_attempt_id uuid,p_action text)
returns jsonb language sql security invoker set search_path='' as $$select sma_private.website_provider_credential_v1(p_user_id,p_attempt_id,p_action)$$;
create function public.sma_website_provider_status_v1()
returns jsonb language sql security invoker set search_path='' as $$select sma_private.website_provider_status_v1()$$;
create function public.sma_website_provider_context_v1(p_user_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select sma_private.website_provider_context_v1(p_user_id)$$;
revoke all on function public.sma_website_provider_begin_v1(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.sma_website_provider_finish_v1(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.sma_website_provider_credential_v1(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.sma_website_provider_status_v1() from public,anon,authenticated,service_role;
revoke all on function public.sma_website_provider_context_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.sma_website_provider_begin_v1(uuid,uuid) to service_role;
grant execute on function public.sma_website_provider_finish_v1(uuid,uuid,uuid,jsonb,jsonb) to service_role;
grant execute on function public.sma_website_provider_credential_v1(uuid,uuid,text) to service_role;
grant execute on function public.sma_website_provider_status_v1() to authenticated;
grant execute on function public.sma_website_provider_context_v1(uuid) to service_role;
