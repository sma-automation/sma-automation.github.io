-- An operator enrolls a particular gallery, platform and verified account. An
-- actual customer approval then binds one immutable post to its existing slot.
create table sma_private.publication_rotation_channels_v1 (
 source_id uuid not null references sma_private.publication_rotation_sources_v1(id),
 platform text not null check(platform in ('youtube','tiktok')), target_id text not null,
 enabled_at timestamptz not null default now(),primary key(source_id,platform)
);
create table sma_private.publication_rotation_deliveries_v1 (
 order_id uuid primary key references sma_private.publication_orders_v1(id),source_id uuid not null,
 platform text not null,target_id text not null,asset_id uuid not null,asset_revision text not null,
 fingerprint text not null,plan_version bigint not null,due_at timestamptz not null,next_check timestamptz not null,
 foreign key(source_id,platform) references sma_private.publication_rotation_channels_v1(source_id,platform),
 unique(source_id,platform,due_at)
);
alter table sma_private.publication_rotation_channels_v1 enable row level security;
alter table sma_private.publication_rotation_deliveries_v1 enable row level security;
revoke all on sma_private.publication_rotation_channels_v1,sma_private.publication_rotation_deliveries_v1 from public,anon,authenticated;
create function sma_private.publication_rotation_bind_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.approved_at is null or old.approved_at is not null then return new; end if;
 insert into sma_private.publication_rotation_deliveries_v1(order_id,source_id,platform,target_id,asset_id,asset_revision,fingerprint,plan_version,due_at,next_check)
 select new.id,source.id,ch.platform,ch.target_id,j.asset_id,j.asset_revision,sma_private.publication_provider_fingerprint_v1(new),
  j.version,(j.portal_times->>ch.platform)::timestamptz,(j.portal_times->>ch.platform)::timestamptz
 from sma_private.publication_rotation_sources_v1 source
 join sma_private.publication_rotation_channels_v1 ch on ch.source_id=source.id and ch.platform=new.binding->>'platform' and ch.target_id=new.target->>'id'
 join sma_private.publication_joint_plans_v1 j on j.customer_id=source.customer_id and j.owner_id=source.owner_id
  and j.asset_id::text=new.binding->>'asset_id' and j.asset_revision=new.binding->>'asset_revision' and j.daily_slot is not null
 where source.customer_id=new.customer_id and source.owner_id=new.user_id and new.created_at>=ch.enabled_at
  and (j.portal_times->>ch.platform)::timestamptz>now()
  and sma_private.publication_order_review_valid_v1(new.approval_review,ch.platform,new.choices) is true
 on conflict do nothing;
 return new;
end $$;
create trigger publication_rotation_bind_v1 after update of approved_at on sma_private.publication_orders_v1
 for each row execute function sma_private.publication_rotation_bind_v1();
create function sma_private.publication_rotation_current_v1(d sma_private.publication_rotation_deliveries_v1) returns boolean
 language sql stable security definer set search_path='' as $$
 select exists(select from sma_private.publication_rotation_sources_v1 s
 join public.sma_kunden c on c.id=s.customer_id and c.user_id=s.owner_id and c.aktiv and (c.demo_delta_aktiv or c.zahlung_bestaetigt)
 join sma_private.publication_rotation_channels_v1 ch on ch.source_id=s.id and ch.platform=d.platform and ch.target_id=d.target_id
 join sma_private.publication_orders_v1 o on o.id=d.order_id and o.user_id=s.owner_id and o.customer_id=s.customer_id
 join sma_private.publication_files_v1 f on f.user_id=s.owner_id and f.customer_id=s.customer_id and f.id=d.asset_id and f.revision=d.asset_revision and f.available
 join sma_private.publication_joint_plans_v1 j on j.owner_id=s.owner_id and j.customer_id=s.customer_id and j.asset_id=f.id and j.asset_revision=f.revision
 join sma_private.publication_assignments_v1 a on a.asset_id=f.id and a.asset_revision=f.revision and a.platform=ch.platform
   and a.preview_id::text=o.binding->>'preview_id' and a.preview_revision::text=o.binding->>'preview_revision'
   and a.revision::text=o.binding->>'assignment_revision'
 where s.id=d.source_id and j.version=d.plan_version and j.daily_slot is not null and (j.portal_times->>ch.platform)::timestamptz=d.due_at
   and o.approved_at is not null and o.created_at>=ch.enabled_at and o.target->>'id'=ch.target_id
   and sma_private.publication_order_review_valid_v1(o.approval_review,ch.platform,o.choices) is true
   and sma_private.publication_provider_fingerprint_v1(o)=d.fingerprint
   and not exists(select from sma_private.publication_rotation_exclusions_v1 x where x.source_id=s.id and x.asset_id=f.id))
$$;
-- Guard other entry points too, including a dashboard refresh between approval and the slot.
create function sma_private.publication_rotation_send_guard_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare d sma_private.publication_rotation_deliveries_v1%rowtype;
begin
 if new.operation not in ('init','upload') then return new; end if;
 select * into d from sma_private.publication_rotation_deliveries_v1 where order_id=new.order_id;
 if found and (d.due_at>now() or d.due_at+interval '30 minutes'<=now() or not sma_private.publication_rotation_current_v1(d)) then
   raise exception 'SCHEDULE_NOT_CURRENT'; end if;
 return new;
end $$;
create trigger publication_rotation_send_guard_v1 before insert on sma_private.publication_provider_events_v1
 for each row execute function sma_private.publication_rotation_send_guard_v1();

create function public.sma_rotation_due_v1(p_source uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d sma_private.publication_rotation_deliveries_v1%rowtype; o sma_private.publication_orders_v1%rowtype;
 a sma_private.publication_provider_attempts_v1%rowtype; op text; items jsonb:='[]';
begin
 for d in select * from sma_private.publication_rotation_deliveries_v1
   where source_id=p_source and next_check<=now() and due_at<=now() and due_at>now()-interval '24 hours'
   order by due_at,platform for update skip locked loop
  select * into strict o from sma_private.publication_orders_v1 where id=d.order_id;
  select * into a from sma_private.publication_provider_attempts_v1 where order_id=d.order_id;
  if o.state in ('blocked','cancelled') or a.state in ('complete','failed','uncertain','needs_review') or
    not sma_private.publication_rotation_current_v1(d) then continue; end if;
  if a.lease_until>now() or o.lease_until>now() then continue; end if;
  op:=null;
  if o.state in ('approved','checking') and d.due_at+interval '30 minutes'>now() then op:='publication.execution_check';
  elsif o.state='checked' and o.blockers='[]'::jsonb then
    if d.due_at+interval '30 minutes'>now() and (a.order_id is null or a.state='session_ready') then
      -- A gallery or Drive share never grants the separate provider permission.
      if not exists(select from sma_private.publication_provider_permissions_v1 permit
        where permit.order_id=o.id and permit.fingerprint=d.fingerprint and permit.expires_at>now()) then continue; end if;
      op:='provider.cover';
    elsif a.state='processing' and a.provider_id is not null then op:='provider.cover';
    end if;
  end if;
  if op is not null then
    update sma_private.publication_rotation_deliveries_v1 set next_check=now()+interval '15 seconds' where order_id=d.order_id;
    items:=items||jsonb_build_array(jsonb_build_object('operation',op,'payload',jsonb_build_object('id',o.id),'context',jsonb_build_object('deadlineAt',null)));
  end if;
 end loop;
 return jsonb_build_object('jobs',items);
end $$;
revoke all on function sma_private.publication_rotation_bind_v1(),sma_private.publication_rotation_current_v1(sma_private.publication_rotation_deliveries_v1),
 sma_private.publication_rotation_send_guard_v1(),public.sma_rotation_due_v1(uuid) from public,anon,authenticated;
grant execute on function public.sma_rotation_due_v1(uuid) to service_role;
