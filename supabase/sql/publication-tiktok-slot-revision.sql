-- An operator can designate one exact future reservation and one byte-identical
-- Drive revision. The designation grants neither publication nor provider access.
create table sma_private.publication_tiktok_slot_revisions_v1 (
  original_order_id uuid primary key references sma_private.publication_orders_v1(id),
  original_fingerprint text not null check (original_fingerprint ~ '^[0-9a-f]{64}$'),
  plan_version bigint not null,
  due_at timestamptz not null,
  new_revision text not null check (new_revision ~ '^sha256:[0-9a-f]{64}:[0-9]{1,30}$'),
  replacement_order_id uuid unique references sma_private.publication_orders_v1(id),
  check (replacement_order_id is distinct from original_order_id)
);
alter table sma_private.publication_tiktok_slot_revisions_v1 enable row level security;
revoke all on sma_private.publication_tiktok_slot_revisions_v1 from public,anon,authenticated,service_role;

create function sma_private.publication_take_tiktok_slot_revision_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
  original sma_private.publication_orders_v1%rowtype;
  intent sma_private.publication_tiktok_slot_revisions_v1%rowtype;
  delivery sma_private.publication_rotation_deliveries_v1%rowtype;
  next_plan_version bigint;
begin
  -- The ordinary authenticated approval already holds the customer and new order
  -- locks. Unregistered posts use the regular scheduling trigger unchanged.
  begin
    select repair.* into strict intent
    from sma_private.publication_tiktok_slot_revisions_v1 repair
    join sma_private.publication_orders_v1 prior on prior.id=repair.original_order_id
    where repair.replacement_order_id is null and repair.new_revision=new.binding->>'asset_revision'
      and prior.user_id=new.user_id and prior.customer_id=new.customer_id
      and prior.binding->>'asset_id'=new.binding->>'asset_id'
      and prior.binding->>'platform'='tiktok' and prior.target->>'id'=new.target->>'id'
    for update of repair,prior;
  exception when no_data_found then return new;
  end;
  select * into strict original from sma_private.publication_orders_v1 where id=intent.original_order_id;
  select * into delivery from sma_private.publication_rotation_deliveries_v1
    where order_id=original.id for update;

  if not found or delivery.platform<>'tiktok' or delivery.target_id is distinct from new.target->>'id'
    or delivery.asset_id::text is distinct from new.binding->>'asset_id'
    or delivery.asset_revision is distinct from original.binding->>'asset_revision'
    or delivery.fingerprint<>intent.original_fingerprint
    or delivery.fingerprint<>sma_private.publication_provider_fingerprint_v1(original)
    or delivery.plan_version<>intent.plan_version or delivery.due_at<>intent.due_at
    or delivery.due_at<=clock_timestamp()
    or original.state<>'blocked' or original.approved_at is null or original.lease_id is not null or original.lease_until is not null
    or original.binding->>'drive_file_id' is null or original.binding->>'drive_file_id' is distinct from new.binding->>'drive_file_id'
    or delivery.asset_revision !~ '^sha256:[0-9a-f]{64}:[0-9]{1,30}$'
    or split_part(delivery.asset_revision,':',2)<>split_part(intent.new_revision,':',2)
    or split_part(delivery.asset_revision,':',3)::numeric>=split_part(intent.new_revision,':',3)::numeric
    or original.choices is distinct from new.choices or new.state<>'approved'
    or sma_private.publication_order_review_valid_v1(new.approval_review,'tiktok',new.choices) is not true
    or exists (select from sma_private.publication_provider_attempts_v1 where order_id in (original.id,new.id))
    or exists (select from sma_private.publication_provider_permissions_v1 where order_id in (original.id,new.id))
    or not exists (select from sma_private.publication_journal_v1 where order_id=new.id
      and customer_id=new.customer_id and asset_id=delivery.asset_id and asset_revision=intent.new_revision
      and platform='tiktok' and target_id=delivery.target_id)
  then raise exception 'SCHEDULE_NOT_CURRENT'; end if;

  -- Keep the unique time occupied throughout the approval transaction. A stale
  -- plan or a separately planned new revision must roll back the entire approval.
  update sma_private.publication_joint_plans_v1 p
    set asset_revision=intent.new_revision,version=p.version+1
    where p.customer_id=new.customer_id and p.owner_id=new.user_id and p.asset_id=delivery.asset_id
      and p.asset_revision=delivery.asset_revision and p.version=intent.plan_version and p.daily_slot is not null
      and p.portal_times-'tiktok'='{}'::jsonb and (p.portal_times->>'tiktok')::timestamptz=intent.due_at
    returning version into next_plan_version;
  if not found then raise exception 'SCHEDULE_NOT_CURRENT'; end if;
  update sma_private.publication_rotation_deliveries_v1
    set order_id=new.id,asset_revision=intent.new_revision,plan_version=next_plan_version,
      fingerprint=sma_private.publication_provider_fingerprint_v1(new),next_check=intent.due_at
    where order_id=original.id returning * into strict delivery;
  if sma_private.publication_rotation_current_v1(delivery) is not true then raise exception 'SCHEDULE_NOT_CURRENT'; end if;
  update sma_private.publication_tiktok_slot_revisions_v1
    set replacement_order_id=new.id where original_order_id=original.id;
  return new;
end $$;
revoke all on function sma_private.publication_take_tiktok_slot_revision_v1() from public,anon,authenticated,service_role;
create trigger publication_rebind_tiktok_slot_v1 after update of approved_at on sma_private.publication_orders_v1
  for each row when (old.approved_at is null and new.approved_at is not null and new.binding->>'platform'='tiktok')
  execute function sma_private.publication_take_tiktok_slot_revision_v1();
