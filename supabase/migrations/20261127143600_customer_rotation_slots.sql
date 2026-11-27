-- Enrolling an existing source for a different customer must not carry over its reserved times.
alter table sma_private.publication_rotation_deliveries_v1 add column customer_id bigint;

update sma_private.publication_rotation_deliveries_v1 d
set customer_id=o.customer_id
from sma_private.publication_orders_v1 o
where o.id=d.order_id;

alter table sma_private.publication_rotation_deliveries_v1
  alter column customer_id set not null,
  add constraint publication_rotation_customer_slot_v1 unique(source_id, platform, due_at, customer_id);

-- Derive the tenant from the immutable order, including when an approved revision replaces it.
create function sma_private.publication_rotation_slot_customer_v1() returns trigger
language plpgsql set search_path='' as $$
begin
  select o.customer_id into strict new.customer_id
  from sma_private.publication_orders_v1 o where o.id=new.order_id;
  return new;
end $$;
revoke all on function sma_private.publication_rotation_slot_customer_v1() from public,anon,authenticated,service_role;

create trigger publication_rotation_slot_customer_v1
before insert or update of order_id,customer_id on sma_private.publication_rotation_deliveries_v1
for each row execute function sma_private.publication_rotation_slot_customer_v1();

alter table sma_private.publication_rotation_deliveries_v1
  drop constraint publication_rotation_deliveries_v_source_id_platform_due_at_key;
