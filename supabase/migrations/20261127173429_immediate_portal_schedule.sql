-- Slot numbers identify the post. Changing slot one to a later hour must keep its file.
create or replace function sma_private.publication_daily_times_valid_v1(settings jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare row_times jsonb;
begin
 if jsonb_typeof(settings) is distinct from 'object' or not settings ?& array['youtube','tiktok','instagram','facebook']
    or settings-array['youtube','tiktok','instagram','facebook']<>'{}'::jsonb then return false; end if;
 for row_times in select value from jsonb_each(settings) loop
  if jsonb_typeof(row_times)<>'array' then return false; end if;
  if jsonb_array_length(row_times)<>3 or (select count(distinct t) from jsonb_array_elements(row_times) t)<>3
    or exists(select from jsonb_array_elements(row_times) t where jsonb_typeof(t)<>'string' or
      (t#>>'{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then return false; end if;
 end loop;
 return true;
end $$;

-- The editor may change the anchor of a daily row in place. A single-file edit still
-- detaches its slot because that path changes desired_at without updating portal_times.
do $migration$
declare body text:=pg_get_functiondef('sma_private.publication_daily_capacity_v1()'::regprocedure);
 anchor text:='if tg_op=''UPDATE'' and old.daily_slot is not null then';
begin
 if array_length(string_to_array(body,anchor),1)<>2 then raise exception 'CAPACITY_BASE_CHANGED';end if;
 execute replace(body,anchor,'if tg_op=''UPDATE'' and old.daily_slot is not null
   and not (new.plan_day=old.plan_day and new.daily_slot=old.daily_slot and new.portal_times is distinct from old.portal_times
   and (new.desired_at at time zone ''Europe/Vienna'')::date=old.plan_day) then');
end $migration$;

create function sma_private.publication_retime_slots_v1(cid bigint,uid uuid,first_day date,previous jsonb,requested jsonb)
returns integer language plpgsql set search_path='' as $$
declare j sma_private.publication_joint_plans_v1%rowtype; d sma_private.publication_rotation_deliveries_v1%rowtype;
 o sma_private.publication_orders_v1%rowtype; permit sma_private.publication_provider_permissions_v1%rowtype;
 change record; revised jsonb; anchor_time timestamptz; new_time timestamptz; old_time timestamptz; fixed integer:=0;
 day_consent boolean; bound boolean; old_clock text; new_clock text;
begin
 for j in select * from sma_private.publication_joint_plans_v1 where customer_id=cid and owner_id=uid
   and plan_day>=first_day and daily_slot is not null order by plan_day,daily_slot,asset_id for update loop
  revised:=j.portal_times;anchor_time:=j.desired_at;
  for change in select key as platform,value as instant from jsonb_each_text(j.portal_times) order by key loop
   old_clock:=previous->change.platform->>(j.daily_slot-1);
   new_clock:=requested->change.platform->>(j.daily_slot-1);
   if old_clock is not distinct from new_clock then continue;end if;
   old_time:=change.instant::timestamptz;
   new_time:=(j.plan_day+new_clock::time) at time zone 'Europe/Vienna';
   if old_time=new_time then continue;end if;
   -- Preserve explicit overrides, elapsed targets, the spring DST gap and occupied one-off times.
   if to_char(old_time at time zone 'Europe/Vienna','HH24:MI')<>old_clock or new_time<=clock_timestamp()
    or to_char(new_time at time zone 'Europe/Vienna','HH24:MI')<>new_clock
    or exists(select from sma_private.publication_plan_occurrences_v1 other where other.customer_id=cid and other.owner_id=uid
      and (other.asset_id,other.asset_revision)<>(j.asset_id,j.asset_revision)
      and coalesce((other.portal_times->>change.platform)::timestamptz,case when other.portal_times is null then other.desired_at end)=new_time)
    or exists(select from sma_private.publication_rotation_deliveries_v1 b where b.customer_id=cid and b.platform=change.platform and b.due_at=new_time)
    then if j.plan_day=first_day then fixed:=fixed+1;end if;continue;end if;

   select * into d from sma_private.publication_rotation_deliveries_v1 b where b.customer_id=cid and b.platform=change.platform
     and b.due_at=old_time for update;
   bound:=found;
   if bound then
    select * into strict o from sma_private.publication_orders_v1 where id=d.order_id for update;
    select * into permit from sma_private.publication_provider_permissions_v1 where order_id=d.order_id for update;
    day_consent:=exists(select from sma_private.day_publish_entries_v1 e where e.order_id=d.order_id and e.platform=d.platform
      and e.target_id=d.target_id and e.choices=o.choices);
    if (d.asset_id,d.asset_revision,d.plan_version,o.user_id) is distinct from (j.asset_id,j.asset_revision,j.version,uid)
       or o.state not in ('approved','checked') or o.lease_until>clock_timestamp() or old_time<=clock_timestamp()
       or exists(select from sma_private.publication_provider_attempts_v1 a where a.order_id=d.order_id)
       or not sma_private.publication_rotation_current_v1(d)
       or (permit.order_id is not null and (permit.fingerprint<>d.fingerprint or permit.expires_at<=clock_timestamp()
         or (permit.expires_at<new_time+interval '30 minutes' and not(day_consent and permit.expires_at=old_time+interval '30 minutes'))))
    then if j.plan_day=first_day then fixed:=fixed+1;end if;continue;end if;
    -- Keep the original day receipt. Only an active release tied to the slot moves its window.
    if day_consent and permit.fingerprint=d.fingerprint and permit.expires_at=old_time+interval '30 minutes' then
     update sma_private.publication_provider_permissions_v1 set expires_at=new_time+interval '30 minutes' where order_id=d.order_id;
    end if;
    update sma_private.publication_rotation_deliveries_v1 set due_at=new_time,next_check=new_time where order_id=d.order_id;
   end if;
   revised:=jsonb_set(revised,array[change.platform],to_jsonb(new_time));
   if sma_private.publication_single_portal_v1(j.portal_times) is not null or change.platform='youtube' then anchor_time:=new_time;end if;
  end loop;
  if revised<>j.portal_times then
   -- The media/assignment revision stays valid. The day consent independently checks due_at
   -- on submit, so stale screens cannot approve the old instant.
   update sma_private.publication_joint_plans_v1 set portal_times=revised,desired_at=anchor_time
    where customer_id=cid and owner_id=uid and asset_id=j.asset_id and asset_revision=j.asset_revision;
  end if;
 end loop;
 return fixed;
end $$;
revoke all on function sma_private.publication_retime_slots_v1(bigint,uuid,date,jsonb,jsonb) from public,anon,authenticated,service_role;

do $migration$
declare body text:=pg_get_functiondef('sma_private.publication_daily_schedule_v1(text,uuid,date,jsonb,bigint)'::regprocedure);
 decl text:='entries jsonb;'; anchor text:='      insert into sma_private.publication_daily_settings_v1'; result text:='''files'',entries,''day'',p_day';
begin
 if array_length(string_to_array(body,decl),1)<>2 or array_length(string_to_array(body,anchor),1)<>2
 or array_length(string_to_array(body,result),1)<>2 then raise exception 'SCHEDULE_BASE_CHANGED';end if;
 body:=replace(body,decl,decl||' fixed integer:=0;');
 body:=replace(body,anchor,'      fixed:=sma_private.publication_retime_slots_v1(customer.id,uid,greatest(today,p_day),coalesce(settings.times,sma_private.publication_daily_defaults_v1()),p_times);'||chr(10)||anchor);
 execute replace(body,result,result||',''fixed_slots'',fixed');
end $migration$;

-- Only wake the dispatcher for an approved, due, off-hours order. No idle n8n runs.
create table sma_private.portal_schedule_wakes_v1 (
 source_id uuid primary key references sma_private.publication_rotation_sources_v1(id),
 ticket uuid unique not null, issued_at timestamptz not null, claimed_at timestamptz
);
alter table sma_private.portal_schedule_wakes_v1 enable row level security;
revoke all on sma_private.portal_schedule_wakes_v1 from public,anon,authenticated,service_role;

create view sma_private.custom_portal_due_v1 with (security_invoker=true) as
 select distinct d.source_id
 from sma_private.publication_rotation_deliveries_v1 d
 join sma_private.publication_orders_v1 o on o.id=d.order_id
 left join sma_private.publication_provider_attempts_v1 a on a.order_id=o.id
 left join sma_private.publication_provider_permissions_v1 p on p.order_id=o.id and p.fingerprint=d.fingerprint
 where d.next_check<=now() and d.due_at<=now() and d.due_at>now()-interval '24 hours'
 and (d.due_at at time zone 'Europe/Vienna')::time not in (time '10:00',time '14:00',time '18:00')
 and sma_private.publication_rotation_current_v1(d)
 and coalesce(o.lease_until,'-infinity')<=now() and coalesce(a.lease_until,'-infinity')<=now()
 and ((d.due_at>now()-interval '30 minutes' and p.expires_at>now() and
   (o.state in ('approved','checking') or (o.state='checked' and o.blockers='[]'::jsonb))
   and (a.order_id is null or a.state='session_ready'))
  or (o.state='checked' and a.state='processing' and a.provider_id is not null));
revoke all on sma_private.custom_portal_due_v1 from public,anon,authenticated,service_role;

-- An installation enables the optional closed-browser worker only after verifying both endpoints.
create table sma_private.portal_schedule_transport_v1(enabled boolean primary key check(enabled));
alter table sma_private.portal_schedule_transport_v1 enable row level security;
revoke all on sma_private.portal_schedule_transport_v1 from public,anon,authenticated,service_role;

create function sma_private.wake_custom_portal_schedule_v1() returns integer
language plpgsql set search_path='' as $$
declare src uuid; wake uuid; sent integer:=0;
begin
 if not exists(select from sma_private.portal_schedule_transport_v1 where enabled) then return 0;end if;
 for src in select source_id from sma_private.custom_portal_due_v1 order by source_id loop
  insert into sma_private.portal_schedule_wakes_v1 as w(source_id,ticket,issued_at)
   values(src,gen_random_uuid(),clock_timestamp())
   on conflict(source_id) do update set ticket=excluded.ticket,issued_at=excluded.issued_at,claimed_at=null
   where w.issued_at<=clock_timestamp()-interval '50 seconds' returning ticket into wake;
  if found then
   perform net.http_post(url:='https://johnmusic.app.n8n.cloud/webhook/sma-portal-versandtermin-v1',
    body:=jsonb_build_object('ticket',wake),timeout_milliseconds:=10000);
   sent:=sent+1;
  end if;
 end loop;
 return sent;
end $$;
revoke all on function sma_private.wake_custom_portal_schedule_v1() from public,anon,authenticated,service_role;

create function public.sma_claim_portal_schedule_v1(p_ticket uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare src uuid;
begin
 update sma_private.portal_schedule_wakes_v1 set claimed_at=clock_timestamp()
  where ticket=p_ticket and claimed_at is null and issued_at>clock_timestamp()-interval '60 seconds' returning source_id into src;
 if not found or not exists(select from sma_private.custom_portal_due_v1 where source_id=src) then return '{"jobs":[]}'::jsonb;end if;
 return public.sma_rotation_due_v1(src);
end $$;
revoke all on function public.sma_claim_portal_schedule_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.sma_claim_portal_schedule_v1(uuid) to service_role;
select cron.schedule('sma-offene-portaltermine-v1','* * * * *','select sma_private.wake_custom_portal_schedule_v1()');
notify pgrst,'reload schema';
