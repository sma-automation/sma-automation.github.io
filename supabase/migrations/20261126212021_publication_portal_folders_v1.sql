create table sma_private.publication_portal_folders_v1 (
 source_id uuid references sma_private.publication_rotation_sources_v1(id), platform text not null
 check(platform in ('youtube','tiktok','facebook','instagram')), folder_id text not null unique,
 primary key(source_id,platform)
);
create table sma_private.publication_portal_scans_v1 (
 source_id uuid primary key references sma_private.publication_rotation_sources_v1(id),
 ticket uuid not null, verified_at timestamptz
);
create table sma_private.publication_portal_inventory_v1 (
 source_id uuid not null,platform text not null,digest text not null check(digest ~ '^[a-f0-9]{64}$'),
 primary key(source_id,platform,digest),
 foreign key(source_id,platform) references sma_private.publication_portal_folders_v1(source_id,platform)
);
create table sma_private.publication_portal_uploads_v1 (
 upload_id uuid primary key references sma_private.publication_uploads_v1(id),source_id uuid not null,platform text not null,
 foreign key(source_id,platform) references sma_private.publication_portal_folders_v1(source_id,platform)
);
alter table sma_private.publication_portal_folders_v1 enable row level security;
alter table sma_private.publication_portal_scans_v1 enable row level security;
alter table sma_private.publication_portal_inventory_v1 enable row level security;
alter table sma_private.publication_portal_uploads_v1 enable row level security;
revoke all on sma_private.publication_portal_folders_v1,sma_private.publication_portal_scans_v1,
 sma_private.publication_portal_inventory_v1,sma_private.publication_portal_uploads_v1 from public,anon,authenticated;
-- Preserve the exact version of a private future slot when its video leaves its portal.
create table sma_private.publication_portal_withdrawals_v1(
 id bigint generated always as identity primary key,source_id uuid not null references sma_private.publication_rotation_sources_v1(id),
 prior_plan jsonb not null,recorded_at timestamptz not null default now()
);
alter table sma_private.publication_portal_withdrawals_v1 enable row level security;
revoke all on sma_private.publication_portal_withdrawals_v1 from public,anon,authenticated;
create view sma_private.publication_portal_content_v1 with (security_invoker=true) as
 select source_id,digest,min(platform) as platform from (
  select i.source_id,i.platform,i.digest,s.verified_at>now()-interval '48 hours' as fresh from sma_private.publication_portal_inventory_v1 i
   join sma_private.publication_portal_scans_v1 s using(source_id)
  union all
  select u.source_id,u.platform,split_part(f.revision,':',2),true from sma_private.publication_portal_uploads_v1 u
   join sma_private.publication_uploads_v1 x on x.id=u.upload_id and x.status='completed'
   join sma_private.publication_rotation_sources_v1 s on s.id=u.source_id and x.user_id=s.owner_id and x.customer_id=s.customer_id
   join sma_private.publication_files_v1 f on f.id=x.asset_id and f.customer_id=x.customer_id and f.user_id=x.user_id and f.available
    and f.revision ~ '^sha256:[a-f0-9]{64}:[0-9]+$'
 ) memberships group by source_id,digest having count(distinct platform)=1 and bool_or(fresh);
revoke all on sma_private.publication_portal_content_v1 from public,anon,authenticated;

create function sma_private.publication_portal_scan_v1(p_source uuid,p_action text,p_ticket uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg sma_private.publication_rotation_sources_v1%rowtype; folder_map jsonb; token uuid;
begin
 select s.* into strict cfg from sma_private.publication_rotation_sources_v1 s join public.sma_kunden c on
  c.id=s.customer_id and c.user_id=s.owner_id and c.aktiv and (c.demo_delta_aktiv or c.zahlung_bestaetigt) where s.id=p_source;
 perform pg_advisory_xact_lock(cfg.customer_id);
 select jsonb_object_agg(folder_id,platform) into folder_map from sma_private.publication_portal_folders_v1 where source_id=cfg.id;
 if folder_map is null or (select count(*) from jsonb_object_keys(folder_map))<>4 then raise exception 'FOLDERS_NOT_CONFIGURED'; end if;
 if p_action='start' then
  insert into sma_private.publication_portal_scans_v1(source_id,ticket) values(cfg.id,gen_random_uuid())
   on conflict(source_id) do update set ticket=excluded.ticket returning ticket into token;
  return jsonb_build_object('root',cfg.source_folder,'folders',folder_map,'ticket',token);
 end if;
 if p_action is distinct from 'finish' or p_ticket is null or not exists(select from sma_private.publication_portal_scans_v1 where source_id=cfg.id and ticket=p_ticket)
  then raise exception 'STALE_PORTAL_SCAN'; end if;
 if jsonb_typeof(p_rows) is distinct from 'object' or not p_rows ?& array(select jsonb_object_keys(folder_map)) or p_rows-array(select jsonb_object_keys(folder_map))<>'{}'
  or octet_length(p_rows::text)>4000000 then raise exception 'INCOMPLETE_PORTAL_SCAN'; end if;
 if exists(select from jsonb_each(p_rows) v where jsonb_typeof(v.value)<>'array') then raise exception 'INVALID_PORTAL_SCAN'; end if;
 if exists(select from jsonb_each(p_rows) v cross join lateral jsonb_array_elements_text(v.value) h where h is null or h !~ '^[a-f0-9]{64}$') then raise exception 'INVALID_PORTAL_DIGEST'; end if;
 delete from sma_private.publication_portal_inventory_v1 where source_id=cfg.id;
 insert into sma_private.publication_portal_inventory_v1 select distinct cfg.id,folder_map->>v.key,h
  from jsonb_each(p_rows) v cross join lateral jsonb_array_elements_text(v.value) h;
 update sma_private.publication_portal_scans_v1 set ticket=gen_random_uuid(),verified_at=now() where source_id=cfg.id;
 -- Manual/shared plans and signed orders keep their original record. The send check always
 -- revalidates membership. Only unapproved, generated future slots can be replanned.
 with withdrawn as (
  delete from sma_private.publication_joint_plans_v1 j where j.customer_id=cfg.customer_id and j.owner_id=cfg.owner_id
   and j.desired_at>now() and j.daily_slot is not null and sma_private.publication_single_portal_v1(j.portal_times) is not null
   and not exists(select from sma_private.publication_portal_content_v1 m where m.source_id=cfg.id and m.platform=sma_private.publication_single_portal_v1(j.portal_times)
    and m.digest=split_part(j.asset_revision,':',2))
   and not exists(select from sma_private.publication_orders_v1 o where o.customer_id=j.customer_id and o.user_id=j.owner_id and o.approved_at is not null
    and o.binding->>'asset_id'=j.asset_id::text and o.binding->>'asset_revision'=j.asset_revision)
   returning j.*
 ) insert into sma_private.publication_portal_withdrawals_v1(source_id,prior_plan) select cfg.id,to_jsonb(w) from withdrawn w;
 return jsonb_build_object('ok',true,'videos',(select count(*) from sma_private.publication_portal_content_v1 where source_id=cfg.id));
end $$;
create function public.sma_publication_portal_scan_v1(p_source uuid,p_action text,p_ticket uuid default null,p_rows jsonb default null) returns jsonb
language sql security invoker set search_path='' as $$select sma_private.publication_portal_scan_v1(p_source,p_action,p_ticket,p_rows)$$;
revoke all on function sma_private.publication_portal_scan_v1(uuid,text,uuid,jsonb),public.sma_publication_portal_scan_v1(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function sma_private.publication_portal_scan_v1(uuid,text,uuid,jsonb),public.sma_publication_portal_scan_v1(uuid,text,uuid,jsonb) to service_role;

create function sma_private.publication_upload_portal_v1(p_upload uuid,p_platform text) returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); src uuid;
begin
 if uid is null or p_platform is null or p_platform not in ('youtube','tiktok','facebook','instagram') then return false; end if;
 if not exists(select from sma_private.publication_uploads_v1 u where u.id=p_upload and u.user_id=uid) then return false; end if;
 select s.id into src from sma_private.publication_uploads_v1 u join sma_private.publication_rotation_sources_v1 s on s.customer_id=u.customer_id and s.owner_id=u.user_id
  join sma_private.publication_portal_folders_v1 pf on pf.source_id=s.id and pf.platform=p_platform
  where u.id=p_upload and u.user_id=uid and u.mime_type like 'video/%';
 if src is null then return true; end if;
 insert into sma_private.publication_portal_uploads_v1 values(p_upload,src,p_platform) on conflict do nothing;
 return exists(select from sma_private.publication_portal_uploads_v1 where upload_id=p_upload and source_id=src and platform=p_platform);
end $$;
create function public.sma_publication_upload_portal_v1(p_upload uuid,p_platform text) returns boolean language sql security invoker set search_path='' as $$
 select sma_private.publication_upload_portal_v1(p_upload,p_platform)
$$;
revoke all on function public.sma_publication_upload_portal_v1(uuid,text),sma_private.publication_upload_portal_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.sma_publication_upload_portal_v1(uuid,text),sma_private.publication_upload_portal_v1(uuid,text) to authenticated;

create function sma_private.publication_single_portal_v1(times jsonb) returns text language sql immutable strict set search_path='' as $$
 select k from jsonb_object_keys(times) k where times-k='{}'::jsonb and k in ('youtube','tiktok','facebook','instagram')
$$;
revoke all on function sma_private.publication_single_portal_v1(jsonb) from public,anon,authenticated;
create unique index publication_daily_portal_slot_v1 on sma_private.publication_joint_plans_v1
(customer_id,owner_id,plan_day,daily_slot,coalesce(sma_private.publication_single_portal_v1(portal_times),'shared')) where daily_slot is not null;
drop index sma_private.publication_daily_slot_v1;

create or replace function sma_private.publication_daily_capacity_v1() returns trigger
 language plpgsql security definer set search_path='' as $$
declare start_day date; route text;
begin
 if tg_op='UPDATE' and new.desired_at is not distinct from old.desired_at then return new; end if;
 if tg_op='UPDATE' and old.daily_slot is not null then new.daily_slot:=null;new.plan_day:=null;new.portal_times:=null; end if;
 if new.desired_at is null then return new; end if;
 perform pg_advisory_xact_lock(new.customer_id);
 if not exists(select from sma_private.publication_daily_settings_v1 where customer_id=new.customer_id and owner_id=new.owner_id) then return new; end if;
 start_day:=(new.desired_at at time zone 'Europe/Vienna')::date;
 route:=sma_private.publication_single_portal_v1(new.portal_times);
 if exists(select from unnest(array['youtube','tiktok','facebook','instagram']) p
 where (route is null or route=p) and
  (select count(*) from sma_private.publication_joint_plans_v1 j where j.customer_id=new.customer_id and j.owner_id=new.owner_id
   and j.desired_at>=start_day::timestamp at time zone 'Europe/Vienna' and j.desired_at<(start_day+1)::timestamp at time zone 'Europe/Vienna'
   and (j.asset_id,j.asset_revision)<>(new.asset_id,new.asset_revision) and (j.portal_times is null or j.portal_times?p))>=3) then raise exception 'DAILY_PLAN_FULL'; end if;
 return new;
end $$;

create function sma_private.publication_portal_allowed_v1(src uuid,p text,rev text) returns boolean language sql stable set search_path='' as $$
 select rev ~ '^sha256:[a-f0-9]{64}:[0-9]+$' and exists(select from sma_private.publication_portal_content_v1 c
 where c.source_id=src and c.platform=p and c.digest=split_part(rev,':',2))
 and not exists(select from sma_private.publication_orders_v1 o join sma_private.publication_rotation_sources_v1 s on s.customer_id=o.customer_id and s.owner_id=o.user_id
  where s.id=src and o.approved_at is not null and o.binding->>'platform'<>p and split_part(o.binding->>'asset_revision',':',2)=split_part(rev,':',2)
  and (o.state<>'cancelled' or exists(select from sma_private.publication_provider_events_v1 ev where ev.order_id=o.id and ev.operation in ('init','upload'))))
$$;
revoke all on function sma_private.publication_portal_allowed_v1(uuid,text,text) from public,anon,authenticated;

create function sma_private.publication_portal_fill_v1(src uuid,cid bigint,uid uuid,day date) returns void language plpgsql set search_path='' as $$
declare r record; clip record; old_plan sma_private.publication_joint_plans_v1%rowtype; v bigint;
begin
 perform pg_advisory_xact_lock(cid);
 for r in select pf.platform,slot,((day+(st.times->pf.platform->>(slot-1))::time) at time zone 'Europe/Vienna') as due
  from sma_private.publication_portal_folders_v1 pf
  join sma_private.publication_daily_settings_v1 st on st.customer_id=cid and st.owner_id=uid
  join public.sma_kunden c on c.id=cid and c.user_id=uid and c.aktiv and (c.demo_delta_aktiv or c.zahlung_bestaetigt)
  cross join generate_series(1,3) slot where pf.source_id=src and to_char(((day+(st.times->pf.platform->>(slot-1))::time) at time zone 'Europe/Vienna') at time zone 'Europe/Vienna','HH24:MI')=st.times->pf.platform->>(slot-1)
  order by slot,pf.platform loop
  if r.due<=now() or exists(select from sma_private.publication_joint_plans_v1 j where j.customer_id=cid and j.owner_id=uid and
    ((j.plan_day=day and j.daily_slot=r.slot and j.portal_times?r.platform) or
     coalesce((j.portal_times->>r.platform)::timestamptz,case when j.portal_times is null then j.desired_at end)=r.due)) then continue; end if;
  if (select count(*) from sma_private.publication_joint_plans_v1 j where j.customer_id=cid and j.owner_id=uid and (j.desired_at at time zone 'Europe/Vienna')::date=day
    and (j.portal_times is null or j.portal_times?r.platform))>=3 then continue; end if;
  select f.id,f.revision into clip from sma_private.publication_files_v1 f
   join sma_private.publication_portal_content_v1 m on m.source_id=src and m.platform=r.platform and m.digest=split_part(f.revision,':',2)
   left join lateral (select max(j.desired_at) as last_use,bool_or(j.desired_at is null or j.desired_at>=date_trunc('day',now(),'Europe/Vienna')) as booked
     from sma_private.publication_plan_occurrences_v1 j where j.customer_id=cid and j.owner_id=uid and
      (j.asset_id=f.id or split_part(j.asset_revision,':',2)=m.digest)) use_history on true
   where f.customer_id=cid and f.user_id=uid and f.available and f.media_kind='video' and f.size_bytes>0 and not coalesce(use_history.booked,false)
    and sma_private.publication_portal_allowed_v1(src,r.platform,f.revision)
    and not exists(select from sma_private.publication_rotation_exclusions_v1 x join sma_private.publication_files_v1 b on b.id=x.asset_id
      where x.source_id=src and (b.id=f.id or split_part(b.revision,':',2)=m.digest))
    and not exists(select from sma_private.publication_editor_exports_v1 e where e.customer_id=cid and e.user_id=uid and e.media_asset_id=f.id)
    and not exists(select from sma_private.gallery_music_v1 g where g.customer_id=cid and g.user_id=uid and g.result_id=f.id)
   order by use_history.last_use nulls first,f.modified_at,f.id limit 1;
  if not found then continue; end if;
  select * into old_plan from sma_private.publication_joint_plans_v1 where customer_id=cid and owner_id=uid and asset_id=clip.id and asset_revision=clip.revision for update;
  v:=1;
  if found then
   if old_plan.desired_at is null or old_plan.desired_at>=date_trunc('day',now(),'Europe/Vienna') then continue; end if;
   insert into sma_private.publication_rotation_history_v1 select old_plan.*;
   delete from sma_private.publication_joint_plans_v1 where customer_id=cid and owner_id=uid and asset_id=clip.id and asset_revision=clip.revision;
   v:=old_plan.version+1;
  end if;
  insert into sma_private.publication_joint_plans_v1(customer_id,owner_id,asset_id,asset_revision,desired_at,version,plan_day,daily_slot,portal_times)
   values(cid,uid,clip.id,clip.revision,r.due,v,day,r.slot,jsonb_build_object(r.platform,r.due));
 end loop;
end $$;
revoke all on function sma_private.publication_portal_fill_v1(uuid,bigint,uuid,date) from public,anon,authenticated;

do $migration$
declare d text; a text:='  perform pg_advisory_xact_lock(cid);';
begin
 d:=pg_get_functiondef('sma_private.publication_daily_fill_v1(bigint,uuid,date)'::regprocedure);
 if length(d)-length(replace(d,a,''))<>length(a) then raise exception 'DAILY_FILL_BASELINE_CHANGED'; end if;
 execute replace(d,a,a||$x$
  select s.id into source from sma_private.publication_rotation_sources_v1 s where s.customer_id=cid and s.owner_id=uid
    and exists(select from sma_private.publication_portal_folders_v1 pf where pf.source_id=s.id);
  if source is not null then perform sma_private.publication_portal_fill_v1(source,cid,uid,day); return; end if;$x$);
 d:=pg_get_functiondef('sma_private.publication_rotation_current_v1(sma_private.publication_rotation_deliveries_v1)'::regprocedure);
 a:='where s.id=d.source_id';
 if length(d)-length(replace(d,a,''))<>length(a) then raise exception 'CURRENT_ROTATION_BASELINE_CHANGED'; end if;
 execute replace(d,a,a||' and (not exists(select from sma_private.publication_portal_folders_v1 pf where pf.source_id=s.id) or sma_private.publication_portal_allowed_v1(s.id,d.platform,f.revision))');
end $migration$;

-- Prevent dispatch of a clip through another portal, including a manually resumed order.
create function sma_private.publication_portal_send_guard_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare src uuid; rev text; platform text;
begin
 if new.operation not in ('init','upload') then return new; end if;
 select s.id,o.binding->>'asset_revision',o.binding->>'platform' into src,rev,platform from sma_private.publication_orders_v1 o
 join sma_private.publication_rotation_sources_v1 s on s.customer_id=o.customer_id and s.owner_id=o.user_id
 where o.id=new.order_id and exists(select from sma_private.publication_portal_folders_v1 f where f.source_id=s.id);
 if found and sma_private.publication_portal_allowed_v1(src,platform,rev) is not true then raise exception 'PORTAL_CONTENT_CONFLICT'; end if;
 return new;
end $$;
revoke all on function sma_private.publication_portal_send_guard_v1() from public,anon,authenticated;
create trigger publication_portal_send_guard_v1 before insert on sma_private.publication_provider_events_v1 for each row execute function sma_private.publication_portal_send_guard_v1();
