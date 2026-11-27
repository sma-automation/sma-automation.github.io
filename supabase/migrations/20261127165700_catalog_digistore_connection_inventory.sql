-- Keep remote draft references when an operator detaches an incorrect vendor.
create table sma_private.catalog_detached_digi_products_v1(
 product_id bigint not null references public.sma_produkte(id),
 customer_id bigint not null references sma_private.catalog_merchants_v1,
 identity text not null,remote_id text not null,plan_id text,recorded_at timestamptz not null default now(),
 primary key(customer_id,identity,remote_id)
);
alter table sma_private.catalog_detached_digi_products_v1 enable row level security;
revoke all on sma_private.catalog_detached_digi_products_v1 from public,anon,authenticated,service_role;

create function public.sma_catalog_digi_expected_v1(owner_in uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(e.remote_id),'[]'::jsonb) from sma_private.catalog_digi_existing_v1 e
 join public.sma_produkte p on p.id=e.product_id
 join public.sma_kunden k on (k.user_id,k.kunde_id)=(p.user_id,p.kunde_id)
 join sma_private.catalog_merchants_v1 m on m.customer_id=k.id
 where k.user_id=owner_in and k.aktiv and (k.zahlung_bestaetigt or k.demo_delta_aktiv)
$$;
revoke all on function public.sma_catalog_digi_expected_v1(uuid) from public,anon,authenticated;
grant execute on function public.sma_catalog_digi_expected_v1(uuid) to service_role;

-- A vendor login may differ from an earlier suggested name. The trusted Edge
-- verifies the expected inventory before calling this connection function.
do $migration$
declare body text; anchor text:=' return true;';
begin
 body:=pg_get_functiondef('public.sma_catalog_connect_worker_v1(uuid,text,text,text,integer)'::regprocedure);
 if array_length(string_to_array(body,anchor),1)<>2 then raise exception 'CATALOG_CONNECTION_CHANGED';end if;
 execute replace(body,anchor,$s$ if market_in='digistore24' then
   update sma_private.catalog_digi_existing_v1 e set vendor=identity_in from sma_private.catalog_work_v1 w
   where w.product_id=e.product_id and w.customer_id=cid and w.market=market_in and e.vendor<>identity_in;
 end if;
$s$||anchor);
end $migration$;
notify pgrst,'reload schema';
