-- A retired customer can keep an audit history without accepting new shop writes.
create table sma_private.retired_shop_owners_v1(customer_id bigint primary key references public.sma_kunden(id));
alter table sma_private.retired_shop_owners_v1 enable row level security;
revoke all on sma_private.retired_shop_owners_v1 from public,anon,authenticated,service_role;
create function sma_private.catalog_block_retired_owner_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select from sma_private.retired_shop_owners_v1 r join public.sma_kunden k on k.id=r.customer_id where new.kunde_id in(k.kunde_id,k.n8n_kunde_id)) then raise exception 'SHOP_ACCOUNT_RETIRED';end if;
 return new;
end $$;
revoke all on function sma_private.catalog_block_retired_owner_v1() from public,anon,authenticated,service_role;
create trigger catalog_retired_writes_v1 before insert or update on public.sma_bestellungen for each row execute function sma_private.catalog_block_retired_owner_v1();
create trigger catalog_retired_writes_v1 before insert or update on public.sma_produkte for each row execute function sma_private.catalog_block_retired_owner_v1();

-- Existing order identity stays immutable. A new merchant connection receives
-- its own verified Shopify history and uses the same version/conflict checks.
do $migration$
declare b text:=pg_get_functiondef('public.sma_order_reconcile_v1(text,bigint,uuid,jsonb)'::regprocedure);
 anchor text:='where q.enabled and q.next_run_at<=clock_timestamp()';
begin
 if array_length(string_to_array(b,anchor),1)<>2 then raise exception 'ORDER_RECONCILIATION_CHANGED';end if;
 execute replace(b,anchor,anchor||' and not exists(select from sma_private.catalog_merchants_v1 m where m.customer_id=a.sma_kunden_id and m.shopify_delegate)');
end $migration$;
-- Existing service-role reconciliation needs only the enrolled-account and mode fields.
grant select(customer_id,shopify_delegate) on sma_private.catalog_merchants_v1 to service_role;

create function sma_private.catalog_import_shop_orders_v1(domain_in text, orders_in jsonb,pages_in integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.sma_shopify_konten%rowtype; c public.sma_kunden%rowtype; lease uuid:=gen_random_uuid();
begin
 select s.* into strict a from public.sma_shopify_konten s join sma_private.catalog_merchants_v1 m on (m.customer_id,m.expected_shop)=(s.sma_kunden_id,s.shopify_domain)
 where s.shopify_domain=domain_in and m.shopify_delegate;
 select * into strict c from public.sma_kunden where id=a.sma_kunden_id and aktiv and (zahlung_bestaetigt or demo_delta_aktiv);
 update sma_private.order_reconciliation_v1 set lease_id=lease,lease_until=now()+interval '10 minutes',started_at=now(),status='running' where account_id=a.id and enabled and (lease_until is null or lease_until<=now());
 if not found then return '{"ok":false,"code":"BUSY"}';end if;
 return public.sma_order_reconcile_v1('complete',a.id,lease,jsonb_build_object('complete',true,'pages',pages_in,'orders',orders_in,'shop_domain',domain_in,'markt_konto_id',a.markt_konto_id,'kunde_id',c.n8n_kunde_id));
end $$;
revoke all on function sma_private.catalog_import_shop_orders_v1(text,jsonb,integer) from public,anon,authenticated,service_role;
