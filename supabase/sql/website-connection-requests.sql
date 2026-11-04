-- Candidate only: durable connection requests, not provider authorization.
-- No credentials, outgoing network calls, purchases or publication permissions.
create table sma_private.website_connection_requests_v1 (
 customer_id bigint primary key references public.sma_kunden(id),
 user_id uuid not null,
 revision integer not null check(revision>0),
 preparation_revision integer not null check(preparation_revision>0),
 website_url text not null check(octet_length(website_url) between 1 and 2048),
 provider text not null check(provider in ('wordpress','hostinger')),
 state text not null check(state in ('pending','revoked')),
 attempt_id uuid not null unique,
 requested_at timestamptz not null,
 expires_at timestamptz not null,
 revoked_at timestamptz,
 last_request_id uuid not null,
 last_action text not null check(last_action in ('prepare','revoke')),
 last_input jsonb not null,
 check(expires_at>requested_at)
);
alter table sma_private.website_connection_requests_v1 enable row level security;
revoke all on sma_private.website_connection_requests_v1 from public,anon,authenticated,service_role;

-- Private definer: rows are inaccessible directly and owner/access are checked
-- while the customer, preparation and request are locked in that order.
create function sma_private.website_connection_request_v1(p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid();c public.sma_kunden%rowtype;
 d sma_private.website_preparations_v1%rowtype;
 r sma_private.website_connection_requests_v1%rowtype;
 expected integer; req uuid; state text;allowed boolean;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_action is null or p_action not in ('get','prepare','revoke') then return jsonb_build_object('ok',false,'code','INVALID_ACTION');end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>1024 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if p_action='get' then
  if p_input<>'{}'::jsonb then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 else
  if not(p_input ?& array['expected_revision','request_id'])
   or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('expected_revision','request_id','provider'))
   or jsonb_typeof(p_input->'expected_revision') is distinct from 'number'
   or (p_input->>'expected_revision') !~ '^[0-9]{1,10}$'
   or jsonb_typeof(p_input->'request_id') is distinct from 'string'
   or (p_input->>'request_id') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   or (p_action='revoke' and p_input ? 'provider')
   or (p_action='prepare' and (jsonb_typeof(p_input->'provider') is distinct from 'string' or p_input->>'provider' not in ('wordpress','hostinger')))
  then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  if (p_input->>'expected_revision')::numeric>2147483646 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  expected:=(p_input->>'expected_revision')::integer;req:=(p_input->>'request_id')::uuid;
 end if;
 begin select * into strict c from public.sma_kunden where user_id=uid for update;
 exception when no_data_found or too_many_rows then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end;
 select * into d from sma_private.website_preparations_v1 where customer_id=c.id for update;
 select * into r from sma_private.website_connection_requests_v1 where customer_id=c.id for update;
 if (d.customer_id is not null and d.user_id is distinct from uid) or (r.customer_id is not null and r.user_id is distinct from uid)
 then return jsonb_build_object('ok',false,'code','ACCOUNT_CHANGED');end if;
 allowed:=c.aktiv is true and (c.demo_delta_aktiv is true or (c.zahlung_bestaetigt is true and lower(btrim(coalesce(c.paket,'')))='delta'));
 -- Revocation must remain possible after access or package expiry.
 if not allowed and p_action<>'revoke' then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 if p_action<>'get' then
  if r.last_request_id=req then
   if r.last_action<>p_action or r.last_input<>p_input then return jsonb_build_object('ok',false,'code','REQUEST_CONFLICT');end if;
   -- Exact replay returns the current effective state; it never renews expiry.
  else
   if expected<>coalesce(r.revision,0) then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT');end if;
   if r.revision=2147483647 then return jsonb_build_object('ok',false,'code','REVISION_LIMIT');end if;
   if p_action='revoke' then
    if r.customer_id is null then return jsonb_build_object('ok',false,'code','REQUEST_REQUIRED');end if;
    update sma_private.website_connection_requests_v1 set state='revoked',revoked_at=clock_timestamp(),
     revision=revision+1,last_request_id=req,last_action=p_action,last_input=p_input
     where customer_id=c.id returning * into r;
   else
    if d.customer_id is null or d.mode<>'existing' or d.website_url='' then return jsonb_build_object('ok',false,'code','WEBSITE_REQUIRED');end if;
    if r.requested_at>clock_timestamp()-interval '60 seconds' then return jsonb_build_object('ok',false,'code','REQUEST_RATE_LIMITED');end if;
    insert into sma_private.website_connection_requests_v1(customer_id,user_id,revision,preparation_revision,website_url,provider,state,attempt_id,requested_at,expires_at,last_request_id,last_action,last_input)
    values(c.id,uid,1,d.revision,d.website_url,p_input->>'provider','pending',gen_random_uuid(),clock_timestamp(),clock_timestamp()+interval '10 minutes',req,p_action,p_input)
    on conflict(customer_id) do update set revision=website_connection_requests_v1.revision+1,preparation_revision=excluded.preparation_revision,
     website_url=excluded.website_url,provider=excluded.provider,state='pending',attempt_id=excluded.attempt_id,
     requested_at=excluded.requested_at,expires_at=excluded.expires_at,revoked_at=null,last_request_id=req,last_action=p_action,last_input=p_input
    returning * into r;
   end if;
  end if;
 end if;
 state:=case when r.customer_id is null then 'not_requested'
  when r.state='revoked' then 'revoked'
  when d.customer_id is null or d.mode<>'existing' or r.preparation_revision<>d.revision or r.website_url<>d.website_url then 'stale'
  when r.expires_at<=clock_timestamp() then 'expired' else 'pending' end;
 return jsonb_build_object('ok',true,'state',state,'revision',coalesce(r.revision,0),
  'preparation_revision',coalesce(d.revision,0),'website_url',case when d.mode='existing' then d.website_url else null end,
  'provider',r.provider,'attempt_id',case when state='pending' then r.attempt_id else null end,
  'expires_at',case when state='pending' then r.expires_at else null end,
  'website_connected',false,'can_synchronize',false,'can_publish',false);
end $$;
revoke all on function sma_private.website_connection_request_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function sma_private.website_connection_request_v1(text,jsonb) to authenticated;
create function public.sma_website_connection_request_v1(p_action text,p_input jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select sma_private.website_connection_request_v1(p_action,p_input)$$;
revoke all on function public.sma_website_connection_request_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_website_connection_request_v1(text,jsonb) to authenticated;

-- Future adapters must revalidate this owner-bound context before credential
-- use. This read is not a lease or completion receipt; a future completion RPC
-- must check the same binding atomically after provider I/O before storing
-- credentials. This function does NOT authorize a provider.
create function sma_private.website_connection_context_v1(p_user_id uuid,p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.sma_kunden%rowtype;d sma_private.website_preparations_v1%rowtype;r sma_private.website_connection_requests_v1%rowtype;
begin
 if p_user_id is null or p_attempt_id is null then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 begin select * into strict c from public.sma_kunden where user_id=p_user_id for update;
 exception when no_data_found or too_many_rows then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end;
 select * into d from sma_private.website_preparations_v1 where customer_id=c.id for update;
 select * into r from sma_private.website_connection_requests_v1 where customer_id=c.id for update;
 if d.user_id is distinct from p_user_id or r.user_id is distinct from p_user_id then return jsonb_build_object('ok',false,'code','ACCOUNT_CHANGED');end if;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or (c.zahlung_bestaetigt is true and lower(btrim(coalesce(c.paket,'')))='delta'))
 then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 if r.attempt_id is distinct from p_attempt_id or r.state<>'pending' or r.expires_at<=clock_timestamp()
  or d.mode<>'existing' or r.preparation_revision<>d.revision or r.website_url<>d.website_url
 then return jsonb_build_object('ok',false,'code','REQUEST_STALE');end if;
 return jsonb_build_object('ok',true,'provider',r.provider,'website_url',r.website_url,'attempt_id',r.attempt_id,
  'revision',r.revision,'preparation_revision',r.preparation_revision,'expires_at',r.expires_at);
end $$;
revoke all on function sma_private.website_connection_context_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function sma_private.website_connection_context_v1(uuid,uuid) to service_role;
create function public.sma_website_connection_context_v1(p_user_id uuid,p_attempt_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select sma_private.website_connection_context_v1(p_user_id,p_attempt_id)$$;
revoke all on function public.sma_website_connection_context_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sma_website_connection_context_v1(uuid,uuid) to service_role;
