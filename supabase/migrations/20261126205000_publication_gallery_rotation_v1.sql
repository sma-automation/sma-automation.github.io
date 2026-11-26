-- Only explicitly enrolled galleries rotate. All entries here are editorial plans.
create table sma_private.publication_rotation_sources_v1 (
  id uuid primary key default gen_random_uuid(),
  customer_id bigint not null references public.sma_kunden(id),
  owner_id uuid not null, source_folder text not null, processing_folder text not null,
  unique(customer_id,owner_id), check(source_folder<>processing_folder)
);
create table sma_private.publication_rotation_exclusions_v1 (
  source_id uuid not null references sma_private.publication_rotation_sources_v1(id),
  asset_id uuid not null references sma_private.publication_files_v1(id),
  primary key(source_id,asset_id)
);
create table sma_private.publication_rotation_history_v1 (
  like sma_private.publication_joint_plans_v1 including constraints,
  primary key(customer_id,owner_id,asset_id,asset_revision,version)
);
alter table sma_private.publication_rotation_sources_v1 enable row level security;
alter table sma_private.publication_rotation_exclusions_v1 enable row level security;
alter table sma_private.publication_rotation_history_v1 enable row level security;
revoke all on sma_private.publication_rotation_sources_v1,sma_private.publication_rotation_exclusions_v1,
  sma_private.publication_rotation_history_v1 from public,anon,authenticated;
create view sma_private.publication_plan_occurrences_v1 as
  select * from sma_private.publication_joint_plans_v1 union all
  select * from sma_private.publication_rotation_history_v1;
revoke all on sma_private.publication_plan_occurrences_v1 from public,anon,authenticated;

-- The Drive version is metadata. Identical bytes in two Drive files share one rotation position.
create function sma_private.publication_rotation_key_v1(asset uuid,revision text) returns text
language sql immutable strict set search_path='' as $$
  select case when revision ~ '^(sha256:[0-9a-f]{64}|md5:[0-9a-f]{32}):[0-9]+$'
    then split_part(revision,':',1)||':'||split_part(revision,':',2) else asset::text end
$$;
create function sma_private.publication_rotation_pick_v1(cid bigint,uid uuid,source uuid)
returns table(id uuid,revision text) language sql stable set search_path='' as $$
  with recursive uses(asset_id,revision,at_time,locked) as (
    select p.asset_id,p.asset_revision,p.desired_at,
      p.desired_at is null or greatest(p.desired_at,(select max(t::timestamptz) from jsonb_each_text(p.portal_times) pt(k,t)))
        >= ((now() at time zone 'Europe/Vienna')::date::timestamp at time zone 'Europe/Vienna')
    from sma_private.publication_plan_occurrences_v1 p where p.customer_id=cid and p.owner_id=uid
    union
    select f.id,f.revision,u.at_time,u.locked from uses u cross join lateral (
      select e.asset_id from sma_private.publication_editor_exports_v1 e where e.customer_id=cid and e.user_id=uid and e.media_asset_id=u.asset_id
      union select m.source_id from sma_private.gallery_music_v1 m where m.customer_id=cid and m.user_id=uid and m.result_id=u.asset_id
    ) parent join sma_private.publication_files_v1 f on f.id=parent.asset_id and f.customer_id=cid and f.user_id=uid
  ), usage as (
    select sma_private.publication_rotation_key_v1(asset_id,revision) as content_key,
      max(at_time) as last_used,bool_or(locked) as reserved from uses group by 1
  )
  select f.id,f.revision from sma_private.publication_files_v1 f left join usage u
    on u.content_key=sma_private.publication_rotation_key_v1(f.id,f.revision)
  where f.customer_id=cid and f.user_id=uid and f.available and f.media_kind='video' and f.size_bytes>0
    and coalesce(u.reserved,false)=false
    and not exists(select from uses where uses.asset_id=f.id and uses.locked)
    and not exists(select from sma_private.publication_rotation_exclusions_v1 ex
      join sma_private.publication_files_v1 blocked on blocked.id=ex.asset_id and blocked.customer_id=cid and blocked.user_id=uid
      where ex.source_id=source and (blocked.id=f.id or sma_private.publication_rotation_key_v1(blocked.id,blocked.revision)
        =sma_private.publication_rotation_key_v1(f.id,f.revision)))
    and not exists(select from sma_private.publication_editor_exports_v1 e where e.customer_id=cid and e.user_id=uid and e.media_asset_id=f.id)
    and not exists(select from sma_private.gallery_music_v1 m where m.customer_id=cid and m.user_id=uid and m.result_id=f.id)
  order by u.last_used nulls first,f.modified_at,f.id limit 1
$$;
revoke all on function sma_private.publication_rotation_key_v1(uuid,text),
  sma_private.publication_rotation_pick_v1(bigint,uuid,uuid) from public,anon,authenticated;

create or replace function sma_private.publication_daily_fill_v1(cid bigint,uid uuid,day date) returns void
language plpgsql set search_path='' as $$
declare source uuid; next_version bigint; old_plan sma_private.publication_joint_plans_v1%rowtype; settings jsonb; chosen record; slot int; occupied int; instants jsonb; legacy_times timestamptz[]; taken int[]; chosen_slot int; legacy_time timestamptz;
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
  select id into source from sma_private.publication_rotation_sources_v1 where customer_id=cid and owner_id=uid;
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
    next_version:=1;
    if source is not null then
      select * into chosen from sma_private.publication_rotation_pick_v1(cid,uid,source);
      if not found then return; end if;
      select * into old_plan from sma_private.publication_joint_plans_v1
        where customer_id=cid and owner_id=uid and asset_id=chosen.id and asset_revision=chosen.revision for update;
      if found then
        if old_plan.desired_at is null or old_plan.desired_at >= date_trunc('day',now(),'Europe/Vienna') then return; end if;
        insert into sma_private.publication_rotation_history_v1 select old_plan.*;
        delete from sma_private.publication_joint_plans_v1 where customer_id=cid and owner_id=uid and asset_id=chosen.id and asset_revision=chosen.revision;
        next_version:=old_plan.version+1;
      end if;
    else
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
    end if;
    insert into sma_private.publication_joint_plans_v1(customer_id,owner_id,asset_id,asset_revision,desired_at,version,plan_day,daily_slot,portal_times)
      values(cid,uid,chosen.id,chosen.revision,(instants->>'youtube')::timestamptz,next_version,day,slot,instants);
  end loop;
end $$;

create or replace function sma_private.publication_daily_schedule_v1(p_action text,p_owner uuid,p_day date,p_times jsonb,p_version bigint)
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
    order by j.desired_at,j.asset_id),'[]') into entries from sma_private.publication_plan_occurrences_v1 j
    join sma_private.publication_files_v1 f on f.id=j.asset_id and f.user_id=uid and f.customer_id=customer.id
    where j.customer_id=customer.id and j.owner_id=uid and j.desired_at>=p_day::timestamp at time zone 'Europe/Vienna'
      and j.desired_at<(p_day+1)::timestamp at time zone 'Europe/Vienna';
  return jsonb_build_object('ok',true,'times',coalesce(settings.times,sma_private.publication_daily_defaults_v1()),
    'version',coalesce(settings.version,0),'files',entries,'day',p_day);
end $$;
