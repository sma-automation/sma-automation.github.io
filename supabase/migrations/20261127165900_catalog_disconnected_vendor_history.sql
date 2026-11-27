create table sma_private.catalog_disconnected_digi_channels_v1(
 customer_id bigint not null references sma_private.catalog_merchants_v1,identity text not null,secret_id uuid not null,
 category integer,disconnected_at timestamptz not null default now(),primary key(customer_id,secret_id)
);
alter table sma_private.catalog_disconnected_digi_channels_v1 enable row level security;
revoke all on sma_private.catalog_disconnected_digi_channels_v1 from public,anon,authenticated,service_role;
do $migration$
declare b text;anchor text:='   update sma_private.catalog_digi_existing_v1';
begin
 b:=pg_get_functiondef('public.sma_catalog_connect_worker_v1(uuid,text,text,text,integer)'::regprocedure);
 if strpos(b,anchor)=0 then raise exception 'CATALOG_CONNECT_CHANGED';end if;
 execute replace(b,anchor,$s$   update sma_private.catalog_work_v1 w set remote_id=h.remote_id,plan_id=h.plan_id
   from sma_private.catalog_detached_digi_products_v1 h where w.customer_id=cid and w.market=market_in and w.remote_id is null
   and (h.customer_id,h.product_id,h.identity)=(w.customer_id,w.product_id,identity_in);
$s$||anchor);
end $migration$;
