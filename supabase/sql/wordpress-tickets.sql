-- Install after website-provider-credentials.sql. All raw ticket/key I/O is
-- service-only. Public WordPress lookup is mediated by the bounded Edge handler.
create table sma_private.wordpress_tickets_v1(
 customer_id bigint primary key references public.sma_kunden(id),
 user_id uuid not null,attempt_id uuid not null unique,ticket_hash text not null unique check(ticket_hash~'^[a-f0-9]{64}$'),
 secret_id uuid not null unique,public_key text not null,shop_slug text not null,account_label text not null,
 website_url text not null,expires_at timestamptz not null
);
alter table sma_private.wordpress_tickets_v1 enable row level security;
revoke all on sma_private.wordpress_tickets_v1 from public,anon,authenticated,service_role;

create function sma_private.wordpress_ticket_context_v1(p_user_id uuid,p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb;t sma_private.wordpress_tickets_v1%rowtype;c public.sma_kunden%rowtype;k text;
begin
 b:=sma_private.website_provider_binding_v1(p_user_id);
 if b->>'ok'<>'true' then return b;end if;
 if (b->>'attempt_id')::uuid is distinct from p_attempt_id or b->>'provider'<>'wordpress' or (b->>'expires_at')::timestamptz<=clock_timestamp()
 then return jsonb_build_object('ok',false,'code','REQUEST_STALE');end if;
 select * into c from public.sma_kunden where id=(b->>'customer_id')::bigint;
 select * into t from sma_private.wordpress_tickets_v1 where customer_id=c.id for update;
 if t.user_id is distinct from p_user_id or t.attempt_id is distinct from p_attempt_id or t.website_url is distinct from b->>'website_url'
  or t.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','TICKET_UNAVAILABLE');end if;
 if c.shop_oeffentlich is not true or c.shop_slug is distinct from t.shop_slug then return jsonb_build_object('ok',false,'code','SHOP_CHANGED');end if;
 select decrypted_secret into k from vault.decrypted_secrets where id=t.secret_id;
 if k is null then return jsonb_build_object('ok',false,'code','CREDENTIAL_UNAVAILABLE');end if;
 return jsonb_build_object('ok',true,'attempt_id',t.attempt_id,'website_url',t.website_url,'shop_slug',t.shop_slug,
  'account_label',t.account_label,'public_key',t.public_key,'private_key',k,'expires_at',floor(extract(epoch from t.expires_at))::bigint);
end $$;

create function sma_private.wordpress_ticket_issue_v1(p_user_id uuid,p_attempt_id uuid,p_public_key text,p_private_key text,p_ticket_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb;t sma_private.wordpress_tickets_v1%rowtype;c public.sma_kunden%rowtype;s uuid;label text;
begin
 b:=sma_private.website_provider_binding_v1(p_user_id);
 if b->>'ok'<>'true' then return b;end if;
 if (b->>'attempt_id')::uuid is distinct from p_attempt_id or b->>'provider'<>'wordpress' or (b->>'expires_at')::timestamptz<=clock_timestamp()
 then return jsonb_build_object('ok',false,'code','REQUEST_STALE');end if;
 select * into c from public.sma_kunden where id=(b->>'customer_id')::bigint;
 if c.shop_oeffentlich is not true or c.shop_slug is null or octet_length(c.shop_slug)>63 or c.shop_slug!~'^[a-z0-9]+(-[a-z0-9]+)*$'
 then return jsonb_build_object('ok',false,'code','SHOP_REQUIRED');end if;
 if exists(select 1 from sma_private.website_provider_connections_v1 where customer_id=c.id)
 then return jsonb_build_object('ok',false,'code','ALREADY_VERIFIED');end if;
 select * into t from sma_private.wordpress_tickets_v1 where customer_id=c.id for update;
 -- Same attempt always reuses the first key, including a lost issue response.
 if t.attempt_id=p_attempt_id then return sma_private.wordpress_ticket_context_v1(p_user_id,p_attempt_id);end if;
 if p_public_key is null or octet_length(p_public_key) not between 400 and 4096 or p_public_key not like '-----BEGIN PUBLIC KEY-----%'
  or p_private_key is null or octet_length(p_private_key) not between 1024 and 8192 or p_private_key not like '-----BEGIN PRIVATE KEY-----%'
  or p_ticket_hash is null or p_ticket_hash!~'^[a-f0-9]{64}$'
 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select email into label from auth.users where id=p_user_id;
 if label is null or octet_length(label) not between 1 and 200 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end if;
 if t.secret_id is not null then delete from vault.secrets where id=t.secret_id;delete from sma_private.wordpress_tickets_v1 where customer_id=c.id;end if;
 s:=vault.create_secret(p_private_key,null,'SMA pending WordPress signing key');
 insert into sma_private.wordpress_tickets_v1 values(c.id,p_user_id,p_attempt_id,p_ticket_hash,s,p_public_key,c.shop_slug,label,b->>'website_url',(b->>'expires_at')::timestamptz);
 return sma_private.wordpress_ticket_context_v1(p_user_id,p_attempt_id);
end $$;

create function sma_private.wordpress_ticket_lookup_v1(p_ticket_hash text,p_website_url text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t sma_private.wordpress_tickets_v1%rowtype;r jsonb;
begin
 if p_ticket_hash is null or p_ticket_hash!~'^[a-f0-9]{64}$' or p_website_url is null or octet_length(p_website_url)>2048
 then return jsonb_build_object('ok',false,'code','TICKET_UNAVAILABLE');end if;
 -- Read identity first, then take the common customer -> draft -> request locks.
 select * into t from sma_private.wordpress_tickets_v1 where ticket_hash=p_ticket_hash and website_url=p_website_url;
 if t.customer_id is null then return jsonb_build_object('ok',false,'code','TICKET_UNAVAILABLE');end if;
 r:=sma_private.wordpress_ticket_context_v1(t.user_id,t.attempt_id);
 if r->>'ok'<>'true' or not exists(select 1 from sma_private.wordpress_tickets_v1 where customer_id=t.customer_id and ticket_hash=p_ticket_hash and website_url=p_website_url)
 then return jsonb_build_object('ok',false,'code','TICKET_UNAVAILABLE');end if;
 return r-'private_key';
end $$;

create function sma_private.wordpress_ticket_finish_v1(p_user_id uuid,p_attempt_id uuid,p_verification_id uuid,p_proof jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;outcome jsonb;t sma_private.wordpress_tickets_v1%rowtype;
begin
 r:=sma_private.wordpress_ticket_context_v1(p_user_id,p_attempt_id);
 if r->>'ok'<>'true' then return r;end if;
 if p_proof->>'provider_site_id' is distinct from 'wordpress-bridge:'||p_attempt_id::text then return jsonb_build_object('ok',false,'code','INVALID_PROOF');end if;
 outcome:=sma_private.website_provider_finish_v1(p_user_id,p_attempt_id,p_verification_id,p_proof,jsonb_build_object('bridge_private_key',r->>'private_key'));
 if outcome->>'ok'='true' then
  select * into t from sma_private.wordpress_tickets_v1 where user_id=p_user_id and attempt_id=p_attempt_id for update;
  delete from vault.secrets where id=t.secret_id;
  delete from sma_private.wordpress_tickets_v1 where customer_id=t.customer_id;
 end if;
 return outcome;
end $$;

create function sma_private.wordpress_ticket_invalidate_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare cid bigint;s uuid;
begin
 if TG_TABLE_NAME='website_connection_requests_v1' then
  if TG_OP='UPDATE' and new.attempt_id=old.attempt_id and new.state=old.state and new.user_id=old.user_id then return new;end if;
  cid:=old.customer_id;
 elsif TG_TABLE_NAME='website_preparations_v1' then
  if TG_OP='UPDATE' and new.user_id=old.user_id and new.revision=old.revision and new.website_url=old.website_url and new.mode=old.mode then return new;end if;
  cid:=old.customer_id;
 else
  if TG_OP='UPDATE' and new.user_id is not distinct from old.user_id and new.shop_slug is not distinct from old.shop_slug and new.shop_oeffentlich is not distinct from old.shop_oeffentlich then return new;end if;
  cid:=old.id;
  -- A different public shop must never retain a WordPress signing authority.
  select secret_id into s from sma_private.website_provider_connections_v1 where customer_id=cid and provider='wordpress' for update;
  if s is not null then delete from vault.secrets where id=s;delete from sma_private.website_provider_connections_v1 where customer_id=cid and provider='wordpress';end if;
 end if;
 select secret_id into s from sma_private.wordpress_tickets_v1 where customer_id=cid for update;
 if s is not null then delete from vault.secrets where id=s;delete from sma_private.wordpress_tickets_v1 where customer_id=cid;end if;
 return case when TG_OP='DELETE' then old else new end;
end $$;
create trigger wordpress_ticket_request_invalidated before update or delete on sma_private.website_connection_requests_v1 for each row execute function sma_private.wordpress_ticket_invalidate_v1();
create trigger wordpress_ticket_target_invalidated before update or delete on sma_private.website_preparations_v1 for each row execute function sma_private.wordpress_ticket_invalidate_v1();
create trigger wordpress_ticket_owner_invalidated before update or delete on public.sma_kunden for each row execute function sma_private.wordpress_ticket_invalidate_v1();

create function sma_private.wordpress_ticket_cleanup_v1()
returns integer language plpgsql security definer set search_path='' as $$
declare t sma_private.wordpress_tickets_v1%rowtype;n integer:=0;
begin
 for t in select * from sma_private.wordpress_tickets_v1 where expires_at<=clock_timestamp() order by expires_at limit 50 for update skip locked loop
  delete from vault.secrets where id=t.secret_id;delete from sma_private.wordpress_tickets_v1 where customer_id=t.customer_id;n:=n+1;
 end loop;return n;
end $$;
create index wordpress_tickets_expiry_idx on sma_private.wordpress_tickets_v1(expires_at);

create function sma_private.wordpress_verify_release_v1(p_user_id uuid,p_attempt_id uuid,p_verification_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare b jsonb;
begin
 b:=sma_private.website_provider_binding_v1(p_user_id);
 if b->>'ok'<>'true' then return false;end if;
 update sma_private.website_connection_requests_v1 set verification_id=null,verification_started_at=null
 where customer_id=(b->>'customer_id')::bigint and attempt_id=p_attempt_id and verification_id=p_verification_id;
 return found;
end $$;
revoke all on function sma_private.wordpress_verify_release_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function sma_private.wordpress_verify_release_v1(uuid,uuid,uuid) to service_role;
create function public.sma_wordpress_verify_release_v1(p_user_id uuid,p_attempt_id uuid,p_verification_id uuid) returns boolean language sql security invoker set search_path='' as $$select sma_private.wordpress_verify_release_v1(p_user_id,p_attempt_id,p_verification_id)$$;
revoke all on function public.sma_wordpress_verify_release_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sma_wordpress_verify_release_v1(uuid,uuid,uuid) to service_role;

revoke all on function sma_private.wordpress_ticket_context_v1(uuid,uuid),sma_private.wordpress_ticket_issue_v1(uuid,uuid,text,text,text),sma_private.wordpress_ticket_lookup_v1(text,text),sma_private.wordpress_ticket_finish_v1(uuid,uuid,uuid,jsonb),sma_private.wordpress_ticket_cleanup_v1(),sma_private.wordpress_ticket_invalidate_v1() from public,anon,authenticated,service_role;
grant execute on function sma_private.wordpress_ticket_context_v1(uuid,uuid),sma_private.wordpress_ticket_issue_v1(uuid,uuid,text,text,text),sma_private.wordpress_ticket_lookup_v1(text,text),sma_private.wordpress_ticket_finish_v1(uuid,uuid,uuid,jsonb),sma_private.wordpress_ticket_cleanup_v1() to service_role;
create function public.sma_wordpress_ticket_context_v1(p_user_id uuid,p_attempt_id uuid) returns jsonb language sql security invoker set search_path='' as $$select sma_private.wordpress_ticket_context_v1(p_user_id,p_attempt_id)$$;
create function public.sma_wordpress_ticket_issue_v1(p_user_id uuid,p_attempt_id uuid,p_public_key text,p_private_key text,p_ticket_hash text) returns jsonb language sql security invoker set search_path='' as $$select sma_private.wordpress_ticket_issue_v1(p_user_id,p_attempt_id,p_public_key,p_private_key,p_ticket_hash)$$;
create function public.sma_wordpress_ticket_lookup_v1(p_ticket_hash text,p_website_url text) returns jsonb language sql security invoker set search_path='' as $$select sma_private.wordpress_ticket_lookup_v1(p_ticket_hash,p_website_url)$$;
create function public.sma_wordpress_ticket_finish_v1(p_user_id uuid,p_attempt_id uuid,p_verification_id uuid,p_proof jsonb) returns jsonb language sql security invoker set search_path='' as $$select sma_private.wordpress_ticket_finish_v1(p_user_id,p_attempt_id,p_verification_id,p_proof)$$;
create function public.sma_wordpress_ticket_cleanup_v1() returns integer language sql security invoker set search_path='' as $$select sma_private.wordpress_ticket_cleanup_v1()$$;
revoke all on function public.sma_wordpress_ticket_context_v1(uuid,uuid),public.sma_wordpress_ticket_issue_v1(uuid,uuid,text,text,text),public.sma_wordpress_ticket_lookup_v1(text,text),public.sma_wordpress_ticket_finish_v1(uuid,uuid,uuid,jsonb),public.sma_wordpress_ticket_cleanup_v1() from public,anon,authenticated,service_role;
grant execute on function public.sma_wordpress_ticket_context_v1(uuid,uuid),public.sma_wordpress_ticket_issue_v1(uuid,uuid,text,text,text),public.sma_wordpress_ticket_lookup_v1(text,text),public.sma_wordpress_ticket_finish_v1(uuid,uuid,uuid,jsonb),public.sma_wordpress_ticket_cleanup_v1() to service_role;
