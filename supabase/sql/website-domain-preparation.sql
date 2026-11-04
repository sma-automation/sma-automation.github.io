-- Preparation only: no DNS, domain purchase, website verification or publishing.
-- Candidate definition. Apply only after the included SQL tests pass.
create schema if not exists sma_private;

create table if not exists sma_private.website_preparations_v1 (
 customer_id bigint primary key references public.sma_kunden(id),
 user_id uuid not null,
 mode text not null check(mode in ('existing','new')),
 website_url text not null default '' check(octet_length(website_url)<=2048),
 desired_domain text not null default '' check(octet_length(desired_domain)<=253),
 revision integer not null check(revision>0),
 last_request_id uuid not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table sma_private.website_preparations_v1 enable row level security;
revoke all on sma_private.website_preparations_v1 from public,anon,authenticated,service_role;

create or replace function sma_private.website_domain_valid_v1(host text)
returns boolean language sql immutable security invoker set search_path='' as $$
 select host is not null and octet_length(host) between 4 and 253
 and host=lower(host) and host ~ '^[a-z0-9.-]+$'
 and host ~ '[.][a-z]{2,63}$'
 and host !~ '[.](localhost|local|internal|test|invalid|example)$'
 and not exists(select 1 from unnest(string_to_array(host,'.')) label
   where length(label) not between 1 and 63 or label !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$');
$$;
revoke all on function sma_private.website_domain_valid_v1(text) from public,anon,authenticated,service_role;

-- A private definer is needed to keep customer data and drafts inaccessible to
-- direct client writes. The public wrapper is invoker-only; this function checks
-- auth.uid(), one current customer mapping and live Delta access on every call.
create or replace function sma_private.website_preparation_request_v1(p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); c public.sma_kunden%rowtype;
 d sma_private.website_preparations_v1%rowtype;
 v_mode text; v_url text; v_domain text; host text; expected integer; req uuid; shop text;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_action is null or p_action not in ('get','save') then return jsonb_build_object('ok',false,'code','INVALID_ACTION');end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>6000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 begin
  select * into strict c from public.sma_kunden where user_id=uid for update;
 exception when no_data_found or too_many_rows then
  return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');
 end;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 if c.demo_delta_aktiv is not true and lower(btrim(coalesce(c.paket,'')))<>'delta' then return jsonb_build_object('ok',false,'code','DELTA_REQUIRED');end if;
 select * into d from sma_private.website_preparations_v1 where customer_id=c.id for update;
 if d.customer_id is not null and d.user_id is distinct from uid then return jsonb_build_object('ok',false,'code','ACCOUNT_CHANGED');end if;
 if p_action='get' then
  if p_input<>'{}'::jsonb then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 else
  if not(p_input ?& array['mode','website_url','desired_domain','expected_revision','request_id'])
   or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('mode','website_url','desired_domain','expected_revision','request_id'))
   or jsonb_typeof(p_input->'mode') is distinct from 'string'
   or jsonb_typeof(p_input->'website_url') is distinct from 'string'
   or jsonb_typeof(p_input->'desired_domain') is distinct from 'string'
   or jsonb_typeof(p_input->'expected_revision') is distinct from 'number'
   or jsonb_typeof(p_input->'request_id') is distinct from 'string'
   or p_input->>'mode' not in ('existing','new')
   or p_input->>'expected_revision' !~ '^[0-9]{1,10}$'
   or p_input->>'request_id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  if (p_input->>'expected_revision')::numeric>2147483646 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  v_mode:=p_input->>'mode';v_url:=p_input->>'website_url';v_domain:=p_input->>'desired_domain';
  expected:=(p_input->>'expected_revision')::integer;req:=(p_input->>'request_id')::uuid;
  if octet_length(v_url)>2048 or v_url ~ '[^!-~]' or position(chr(92) in v_url)>0
   or (v_mode='new' and v_url<>'') or (v_mode='existing' and v_url='')
  then return jsonb_build_object('ok',false,'code','INVALID_WEBSITE');end if;
  if v_url<>'' then
   if v_url !~ '^https://[^/?#]+(/[^?#]*)?$' then return jsonb_build_object('ok',false,'code','INVALID_WEBSITE');end if;
   host:=substring(v_url from '^https://([^/?#]+)');
   if not sma_private.website_domain_valid_v1(host) then return jsonb_build_object('ok',false,'code','INVALID_WEBSITE');end if;
  end if;
  if v_domain<>'' and not sma_private.website_domain_valid_v1(v_domain) then return jsonb_build_object('ok',false,'code','INVALID_DOMAIN');end if;
  if d.last_request_id=req then
   if d.mode<>v_mode or d.website_url<>v_url or d.desired_domain<>v_domain then return jsonb_build_object('ok',false,'code','REQUEST_CONFLICT');end if;
   -- Exact replay after a lost response returns the already saved revision.
  else
   if expected<>coalesce(d.revision,0) then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT');end if;
   insert into sma_private.website_preparations_v1(customer_id,user_id,mode,website_url,desired_domain,revision,last_request_id)
   values(c.id,uid,v_mode,v_url,v_domain,1,req)
   on conflict(customer_id) do update set mode=excluded.mode,website_url=excluded.website_url,
    desired_domain=excluded.desired_domain,revision=website_preparations_v1.revision+1,
    last_request_id=excluded.last_request_id,updated_at=clock_timestamp()
   returning * into d;
  end if;
 end if;
 if c.shop_oeffentlich is true and length(c.shop_slug)<=80 and c.shop_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
  shop:='https://sma-automation.com/app/shop.html?shop='||c.shop_slug;
 end if;
 return jsonb_build_object('ok',true,'state','preparation','revision',coalesce(d.revision,0),
  'draft',case when d.customer_id is null then null else jsonb_build_object('mode',d.mode,'website_url',d.website_url,'desired_domain',d.desired_domain) end,
  'updated_at',d.updated_at,'shop_url',shop,'domain_verified',false,'website_connected',false,'can_publish',false);
end $$;
revoke all on function sma_private.website_preparation_request_v1(text,jsonb) from public,anon,authenticated,service_role;
grant usage on schema sma_private to authenticated;
grant execute on function sma_private.website_preparation_request_v1(text,jsonb) to authenticated;

create or replace function public.sma_website_preparation_v1(p_action text,p_input jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$
 select sma_private.website_preparation_request_v1(p_action,p_input);
$$;
revoke all on function public.sma_website_preparation_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_website_preparation_v1(text,jsonb) to authenticated;
