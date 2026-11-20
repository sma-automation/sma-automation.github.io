-- Editorial schedule only. The dispatch queue and customer approvals are independent.
create table sma_private.publication_daily_settings_v1 (
  customer_id bigint not null references public.sma_kunden(id),
  owner_id uuid not null,
  times jsonb not null,
  version bigint not null,
  primary key (customer_id, owner_id)
);
alter table sma_private.publication_daily_settings_v1 enable row level security;
revoke all on sma_private.publication_daily_settings_v1 from public,anon,authenticated;

alter table sma_private.publication_joint_plans_v1
  add column daily_slot smallint check (daily_slot between 1 and 3),
  add column plan_day date,
  add column portal_times jsonb,
  add check ((daily_slot is null and plan_day is null and portal_times is null) or
    (daily_slot is not null and plan_day is not null and portal_times is not null and desired_at is not null));
create unique index publication_daily_slot_v1 on sma_private.publication_joint_plans_v1
  (customer_id,owner_id,plan_day,daily_slot) where daily_slot is not null;
create index publication_daily_dates_v1 on sma_private.publication_joint_plans_v1(customer_id,owner_id,desired_at);

create function sma_private.publication_daily_defaults_v1() returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_object_agg(p, '["10:00","14:00","18:00"]'::jsonb)
  from unnest(array['youtube','tiktok','instagram','facebook']) p
$$;

create function sma_private.publication_daily_times_valid_v1(settings jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare row_times jsonb;
begin
  if jsonb_typeof(settings) is distinct from 'object' or not settings ?& array['youtube','tiktok','instagram','facebook']
    or settings - array['youtube','tiktok','instagram','facebook'] <> '{}'::jsonb then return false; end if;
  for row_times in select value from jsonb_each(settings) loop
    if jsonb_typeof(row_times) <> 'array' then return false; end if;
    if jsonb_array_length(row_times) <> 3 or exists(select from jsonb_array_elements(row_times) t
      where jsonb_typeof(t) <> 'string' or (t#>>'{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
      or not (row_times->>0 < row_times->>1 and row_times->>1 < row_times->>2) then return false; end if;
  end loop;
  return true;
end $$;

-- Keep old single-file drafts editable and serialize a manual reservation with the daily planner.
create function sma_private.publication_daily_capacity_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare start_day date; count_other int;
begin
  if tg_op='UPDATE' and new.desired_at is not distinct from old.desired_at then return new; end if;
  if tg_op='UPDATE' and old.daily_slot is not null then
    new.daily_slot:=null; new.plan_day:=null; new.portal_times:=null;
  end if;
  if new.desired_at is null then return new; end if;
  perform pg_advisory_xact_lock(new.customer_id);
  if not exists(select from sma_private.publication_daily_settings_v1 where customer_id=new.customer_id and owner_id=new.owner_id) then return new; end if;
  start_day:=(new.desired_at at time zone 'Europe/Vienna')::date;
  select count(*) into count_other from sma_private.publication_joint_plans_v1 j
    where j.customer_id=new.customer_id and j.owner_id=new.owner_id
      and j.desired_at >= start_day::timestamp at time zone 'Europe/Vienna'
      and j.desired_at < (start_day+1)::timestamp at time zone 'Europe/Vienna'
      and (j.asset_id,j.asset_revision) <> (new.asset_id,new.asset_revision);
  if count_other>=3 then raise exception 'DAILY_PLAN_FULL'; end if;
  return new;
end $$;
create trigger publication_daily_capacity_v1 before insert or update of desired_at on sma_private.publication_joint_plans_v1
  for each row execute function sma_private.publication_daily_capacity_v1();

create function sma_private.publication_daily_fill_v1(cid bigint,uid uuid,day date) returns void
language plpgsql set search_path='' as $$
declare settings jsonb; chosen record; slot int; occupied int; instants jsonb; legacy_times timestamptz[]; taken int[]; chosen_slot int; legacy_time timestamptz;
begin
  perform pg_advisory_xact_lock(cid);
  select s.times into settings from sma_private.publication_daily_settings_v1 s
    join public.sma_kunden c on c.id=s.customer_id and c.user_id=s.owner_id
    where s.customer_id=cid and s.owner_id=uid and c.aktiv and (c.demo_delta_aktiv or c.zahlung_bestaetigt);
  if not found then return; end if;
  select count(*),coalesce(array_agg(daily_slot) filter(where daily_slot is not null),'{}'),
    coalesce(array_agg(desired_at order by desired_at,asset_id) filter(where daily_slot is null),'{}') into occupied,taken,legacy_times
    from sma_private.publication_joint_plans_v1 where customer_id=cid and owner_id=uid
    and desired_at >= day::timestamp at time zone 'Europe/Vienna' and desired_at < (day+1)::timestamp at time zone 'Europe/Vienna';
  if occupied>=3 then return; end if;
  -- Reserve an existing manual time in its matching slot, otherwise the nearest unused one.
  foreach legacy_time in array legacy_times loop
    select i into chosen_slot from generate_series(1,3) i where not i=any(taken)
      order by abs(extract(epoch from ((day+(settings->'youtube'->>(i-1))::time) at time zone 'Europe/Vienna')-legacy_time)),i limit 1;
    taken:=array_append(taken,chosen_slot);
  end loop;
  for slot in 1..3 loop
    if slot=any(taken) then continue; end if;
    select jsonb_object_agg(p, ((day+(v->>(slot-1))::time) at time zone 'Europe/Vienna')) into instants from jsonb_each(settings) s(p,v);
    -- Leave a spring-forward gap free. An autumn repeat resolves once to standard time.
    if exists(select from jsonb_each_text(instants) s(p,t) where t::timestamptz<=now()
      or to_char(t::timestamptz at time zone 'Europe/Vienna','HH24:MI')<>settings->p->>(slot-1)) then continue; end if;
    if exists(select from sma_private.publication_joint_plans_v1 j cross join lateral
        jsonb_each_text(coalesce(j.portal_times,jsonb_build_object('youtube',j.desired_at,'tiktok',j.desired_at))) saved(p,t)
      where j.customer_id=cid and j.owner_id=uid and j.desired_at>=day::timestamp at time zone 'Europe/Vienna'
        and j.desired_at<(day+1)::timestamp at time zone 'Europe/Vienna' and saved.t::timestamptz=(instants->>saved.p)::timestamptz)
      then continue; end if;
    -- Only original videos. A used edit or soundtrack also reserves its source family.
    with recursive used(id) as (
      select asset_id from sma_private.publication_joint_plans_v1 where customer_id=cid and owner_id=uid
      union
      select parent.id from used u cross join lateral (
        select e.asset_id as id from sma_private.publication_editor_exports_v1 e where e.media_asset_id=u.id and e.customer_id=cid and e.user_id=uid
        union select m.source_id from sma_private.gallery_music_v1 m where m.result_id=u.id and m.customer_id=cid and m.user_id=uid
      ) parent
    )
    select f.id,f.revision into chosen from sma_private.publication_files_v1 f
      where f.customer_id=cid and f.user_id=uid and f.available and f.media_kind='video' and f.size_bytes>0
      and not exists(select from used where id=f.id)
      and not exists(select from sma_private.publication_editor_exports_v1 e where e.media_asset_id=f.id and e.customer_id=cid and e.user_id=uid)
      and not exists(select from sma_private.gallery_music_v1 m where m.result_id=f.id and m.customer_id=cid and m.user_id=uid)
      order by f.modified_at,f.id limit 1;
    if not found then return; end if;
    insert into sma_private.publication_joint_plans_v1(customer_id,owner_id,asset_id,asset_revision,desired_at,version,plan_day,daily_slot,portal_times)
      values(cid,uid,chosen.id,chosen.revision,(instants->>'youtube')::timestamptz,1,day,slot,instants);
  end loop;
end $$;

create function sma_private.publication_daily_schedule_v1(p_action text,p_owner uuid,p_day date,p_times jsonb,p_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); customer public.sma_kunden%rowtype; settings sma_private.publication_daily_settings_v1%rowtype;
  today date:=(now() at time zone 'Europe/Vienna')::date; entries jsonb;
begin
  if uid is null or uid is distinct from p_owner then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED'); end if;
  if p_action is null or p_action not in ('get','save','fill') or p_day is null or p_day not between today-31 and today+31 then
    return jsonb_build_object('ok',false,'code','INVALID_DAY'); end if;
  if (select count(*) from public.sma_kunden where user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE'); end if;
  select * into customer from public.sma_kunden where user_id=uid;
  if customer.aktiv is not true or (customer.demo_delta_aktiv is not true and customer.zahlung_bestaetigt is not true) then
    return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE'); end if;
  if p_action<>'get' then perform pg_advisory_xact_lock(customer.id); end if;
  select * into settings from sma_private.publication_daily_settings_v1 where customer_id=customer.id and owner_id=uid;
  if p_action='save' then
    if not sma_private.publication_daily_times_valid_v1(p_times) then return jsonb_build_object('ok',false,'code','INVALID_TIMES'); end if;
    if settings.times is distinct from p_times then
      if p_version is distinct from coalesce(settings.version,0) then return jsonb_build_object('ok',false,'code','VERSION_CONFLICT'); end if;
      insert into sma_private.publication_daily_settings_v1 as s(customer_id,owner_id,times,version) values(customer.id,uid,p_times,1)
      on conflict(customer_id,owner_id) do update set times=excluded.times,version=s.version+1 returning * into settings;
    end if;
    perform sma_private.publication_daily_fill_v1(customer.id,uid,today+1);
  elsif p_action='fill' then
    if p_day not between today and today+1 or settings.version is null then return jsonb_build_object('ok',false,'code','SAVE_FIRST'); end if;
    perform sma_private.publication_daily_fill_v1(customer.id,uid,p_day);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('name',f.name,'current',f.available and f.revision=j.asset_revision,
    'slot',j.daily_slot,'texts',coalesce((select jsonb_agg(a.platform order by a.platform) from sma_private.publication_assignments_v1 a
      join sma_private.publication_previews_v1 p on p.id=a.preview_id and p.user_id=uid and p.customer_id=customer.id
        and p.revision=a.preview_revision and p.status='completed'
      where a.asset_id=f.id and a.asset_revision=f.revision and f.revision=j.asset_revision and nullif(trim(a.draft->>'title'),'') is not null
        and nullif(trim(a.draft->>'caption'),'') is not null),'[]'::jsonb),'times',coalesce(j.portal_times,jsonb_build_object('youtube',j.desired_at,'tiktok',j.desired_at)))
    order by j.desired_at,j.asset_id),'[]') into entries from sma_private.publication_joint_plans_v1 j
    join sma_private.publication_files_v1 f on f.id=j.asset_id and f.user_id=uid and f.customer_id=customer.id
    where j.customer_id=customer.id and j.owner_id=uid and j.desired_at>=p_day::timestamp at time zone 'Europe/Vienna'
      and j.desired_at<(p_day+1)::timestamp at time zone 'Europe/Vienna';
  return jsonb_build_object('ok',true,'times',coalesce(settings.times,sma_private.publication_daily_defaults_v1()),
    'version',coalesce(settings.version,0),'files',entries,'day',p_day);
end $$;
create function public.sma_publication_daily_schedule_v1(p_action text,p_owner uuid,p_day date,p_times jsonb default null,p_version bigint default null)
returns jsonb language sql security invoker set search_path='' as $$
  select sma_private.publication_daily_schedule_v1(p_action,p_owner,p_day,p_times,p_version)
$$;

-- Enrich the same file-bound read that existing portal previews already use.
create function sma_private.publication_joint_plan_channels_v1(p_action text,p_owner uuid,p_asset uuid,p_revision text,p_version bigint,p_time timestamptz,p_local text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare data jsonb; slot_plan record;
begin
  data:=sma_private.publication_joint_plan_v1(p_action,p_owner,p_asset,p_revision,p_version,p_time,p_local);
  if data->>'ok'='true' then
    select daily_slot,portal_times into slot_plan from sma_private.publication_joint_plans_v1
      where owner_id=auth.uid() and customer_id=(select id from public.sma_kunden where user_id=auth.uid())
        and asset_id=p_asset and asset_revision=p_revision and daily_slot is not null;
    if found then data:=data||jsonb_build_object('daily_slot',slot_plan.daily_slot,'portal_times',slot_plan.portal_times); end if;
  end if;
  return data;
exception when raise_exception then
  if sqlerrm='DAILY_PLAN_FULL' then return jsonb_build_object('ok',false,'code','DAILY_PLAN_FULL'); end if;
  raise;
end $$;
create or replace function public.sma_publication_joint_plan_v1(p_action text,p_owner uuid,p_asset uuid,p_revision text,p_version bigint default null,p_time timestamptz default null,p_local text default null)
returns jsonb language sql security invoker set search_path='' as $$
  select sma_private.publication_joint_plan_channels_v1(p_action,p_owner,p_asset,p_revision,p_version,p_time,p_local)
$$;
create function sma_private.publication_daily_tick_v1() returns void language plpgsql set search_path='' as $$
declare client record;
begin
  for client in select customer_id,owner_id from sma_private.publication_daily_settings_v1 order by customer_id,owner_id loop
    perform sma_private.publication_daily_fill_v1(client.customer_id,client.owner_id,(now() at time zone 'Europe/Vienna')::date+1);
  end loop;
end $$;
revoke all on function sma_private.publication_daily_defaults_v1(),sma_private.publication_daily_times_valid_v1(jsonb),
  sma_private.publication_daily_capacity_v1(),sma_private.publication_daily_fill_v1(bigint,uuid,date),sma_private.publication_daily_tick_v1(),
  sma_private.publication_daily_schedule_v1(text,uuid,date,jsonb,bigint),public.sma_publication_daily_schedule_v1(text,uuid,date,jsonb,bigint),
  sma_private.publication_joint_plan_channels_v1(text,uuid,uuid,text,bigint,timestamptz,text) from public,anon,authenticated;
grant execute on function sma_private.publication_daily_schedule_v1(text,uuid,date,jsonb,bigint),public.sma_publication_daily_schedule_v1(text,uuid,date,jsonb,bigint),
  sma_private.publication_joint_plan_channels_v1(text,uuid,uuid,text,bigint,timestamptz,text) to authenticated;
-- Once daily in the afternoon UTC. Only customers with saved settings participate.
select cron.schedule('sma-publication-daily-drafts-v1','0 16 * * *','select sma_private.publication_daily_tick_v1()');
