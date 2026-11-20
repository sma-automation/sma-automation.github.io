-- A shared editorial draft for one customer and one exact video revision.
-- This table has no connection to the dispatch queue or its workers.
create table sma_private.publication_joint_plans_v1 (
  customer_id bigint not null references public.sma_kunden(id),
  asset_id uuid not null references sma_private.publication_files_v1(id) on delete cascade,
  asset_revision text not null,
  owner_id uuid not null,
  desired_at timestamptz,
  version bigint not null check (version > 0),
  primary key (asset_id, asset_revision, customer_id, owner_id)
);
alter table sma_private.publication_joint_plans_v1 enable row level security;
revoke all on sma_private.publication_joint_plans_v1 from public, anon, authenticated;

create function sma_private.publication_joint_plan_v1(
  p_action text, p_owner uuid, p_asset uuid, p_revision text,
  p_version bigint, p_time timestamptz, p_local text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  customer public.sma_kunden%rowtype;
  file sma_private.publication_files_v1%rowtype;
  plan sma_private.publication_joint_plans_v1%rowtype;
  channels jsonb;
begin
  if uid is null or uid is distinct from p_owner then
    return jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED');
  end if;
  if p_action is null or p_action not in ('get','save','clear') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  if (select count(*) from public.sma_kunden where user_id = uid) <> 1 then
    return jsonb_build_object('ok', false, 'code', 'ACCOUNT_UNAVAILABLE');
  end if;
  select * into customer from public.sma_kunden where user_id = uid;
  if customer.aktiv is not true or (customer.demo_delta_aktiv is not true and customer.zahlung_bestaetigt is not true) then
    return jsonb_build_object('ok', false, 'code', 'ACCESS_INACTIVE');
  end if;

  -- The file lock serializes first saves as well as saves racing a Drive revision change.
  select * into file from sma_private.publication_files_v1
   where id = p_asset and user_id = uid and customer_id = customer.id and available
     and media_kind = 'video' and revision = p_revision for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'FILE_CHANGED'); end if;
  select * into plan from sma_private.publication_joint_plans_v1
    where asset_id = file.id and asset_revision = file.revision and customer_id = customer.id and owner_id = uid;

  if p_action <> 'get' then
    if p_version is null or p_version < 0 or
      (p_action = 'clear' and (p_time is not null or p_local is not null)) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    end if;
    if p_action = 'save' and (p_time is null or not isfinite(p_time) or p_time <= clock_timestamp()
      or p_time <> date_trunc('minute',p_time)
      or p_local is distinct from to_char(p_time at time zone 'Europe/Vienna','YYYY-MM-DD"T"HH24:MI')) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_TIME');
    end if;
    if plan.desired_at is distinct from p_time then
      if p_version <> coalesce(plan.version,0) then
        return jsonb_build_object('ok', false, 'code', 'VERSION_CONFLICT');
      end if;
      insert into sma_private.publication_joint_plans_v1 as saved
        (customer_id, asset_id, asset_revision, owner_id, desired_at, version)
        values (customer.id, file.id, file.revision, uid, p_time, 1)
        on conflict (asset_id,asset_revision,customer_id,owner_id)
        do update set desired_at = excluded.desired_at, version = saved.version + 1
        returning * into plan;
    end if;
  end if;

  -- Only show an account from an order bound to this owner's current file and portal text.
  select jsonb_agg(jsonb_build_object('platform', platform.name, 'target', latest.display_name,
    'order_state', latest.state, 'approved', latest.approved_at is not null) order by platform.position)
    into channels
    from (values ('youtube',1), ('tiktok',2)) as platform(name,position)
    left join sma_private.publication_assignments_v1 a on a.asset_id = file.id and a.platform = platform.name
      and a.asset_revision = file.revision
    left join sma_private.publication_previews_v1 preview on preview.id = a.preview_id and preview.revision = a.preview_revision
      and preview.user_id = uid and preview.customer_id = customer.id and preview.status = 'completed'
    left join lateral (
      select o.state, o.approved_at,
        case when o.target->>'platform' = platform.name and o.account_check->>'target_id' = o.target->>'id'
          and o.account_check->>'target_revision' = o.target->>'source_revision'
          then nullif(o.account_check->>'display_name','') end as display_name
      from sma_private.publication_orders_v1 o
      where o.customer_id = customer.id and o.user_id = uid and o.binding->>'asset_id' = file.id::text
        and o.binding->>'asset_revision' = file.revision and o.binding->>'platform' = platform.name
        and o.binding->>'preview_id' = preview.id::text and o.binding->>'preview_revision' = a.preview_revision::text
        and o.binding->>'assignment_revision' = a.revision::text and o.state <> 'cancelled'
      order by o.created_at desc, o.id desc limit 1
    ) latest on true;
  return jsonb_build_object('ok',true,'desired_at',plan.desired_at,'version',coalesce(plan.version,0),
    'channels',channels,'status',case when plan.desired_at is null then 'empty' else 'draft' end);
end $$;
create function public.sma_publication_joint_plan_v1(
  p_action text, p_owner uuid, p_asset uuid, p_revision text,
  p_version bigint default null, p_time timestamptz default null, p_local text default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select sma_private.publication_joint_plan_v1(p_action,p_owner,p_asset,p_revision,p_version,p_time,p_local)
$$;
revoke all on function sma_private.publication_joint_plan_v1(text,uuid,uuid,text,bigint,timestamptz,text),
  public.sma_publication_joint_plan_v1(text,uuid,uuid,text,bigint,timestamptz,text) from public, anon;
grant execute on function sma_private.publication_joint_plan_v1(text,uuid,uuid,text,bigint,timestamptz,text),
  public.sma_publication_joint_plan_v1(text,uuid,uuid,text,bigint,timestamptz,text) to authenticated;
