-- Administrative records of externally verified hosting. This does not provision DNS.
-- Customer roles cannot assign a hostname or certify their own hosting.
create table if not exists sma_private.customer_website_addresses_v1 (
 customer_id bigint primary key references public.sma_kunden(id),
 user_id uuid not null,
 site_id uuid not null unique references sma_private.customer_websites_v1(site_id) on delete cascade,
 hostname text not null unique check(sma_private.website_domain_valid_v1(hostname)),
 verified_at timestamptz not null default now(),
 evidence text not null check(length(evidence) between 1 and 2000),
 revoked_at timestamptz,
 check(revoked_at is null or revoked_at>=verified_at)
);
alter table sma_private.customer_website_addresses_v1 enable row level security;
revoke all on sma_private.customer_website_addresses_v1 from public,anon,authenticated,service_role;

create or replace function sma_private.customer_website_address_v1(p_site_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();c public.sma_kunden%rowtype;result jsonb;
begin
 if uid is null or p_site_id is null then return null;end if;
 begin select * into strict c from public.sma_kunden where user_id=uid;
 exception when no_data_found or too_many_rows then return null;end;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true)
  or (c.demo_delta_aktiv is not true and lower(btrim(coalesce(c.paket,'')))<>'delta') then return null;end if;
 select jsonb_build_object('site_id',w.site_id,'hostname',a.hostname,'verified_at',a.verified_at)
 into result from sma_private.customer_websites_v1 w
 join sma_private.customer_website_addresses_v1 a on a.customer_id=w.customer_id and a.user_id=w.user_id and a.site_id=w.site_id
 where w.customer_id=c.id and w.user_id=uid and w.site_id=p_site_id and a.revoked_at is null and a.verified_at<=now();
 return result;
end $$;
revoke all on function sma_private.customer_website_address_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function sma_private.customer_website_address_v1(uuid) to authenticated;

-- Keep the existing owner/action/revision checks and add only an owner-visible projection.
-- The canonical SMA URL remains unchanged for old clients and private previews.
create or replace function public.sma_customer_website_v1(p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb;
begin
 r:=sma_private.customer_website_request_v1(p_action,p_input);
 if r->>'ok'='true' then
  r:=r||jsonb_build_object('custom_domain',sma_private.customer_website_address_v1((r->>'site_id')::uuid));
 end if;
 return r;
end $$;
revoke all on function public.sma_customer_website_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_customer_website_v1(text,jsonb) to authenticated;
