-- Explicit customer delivery request for one approved, journalled revision and target.
create table sma_private.manual_portal_sends_v1(
 order_id uuid primary key references sma_private.publication_orders_v1, source_id uuid not null references sma_private.publication_rotation_sources_v1,
 fingerprint text not null, request_id uuid unique not null, due_at timestamptz not null,
 next_check timestamptz not null, restart_sequence integer, requested_at timestamptz not null default now()
);
alter table sma_private.manual_portal_sends_v1 enable row level security;
revoke all on sma_private.manual_portal_sends_v1 from public,anon,authenticated,service_role;

create function sma_private.manual_empty_tiktok_init_v1(a sma_private.publication_provider_attempts_v1) returns boolean
language sql stable set search_path='' as $$
 select a.platform='tiktok' and a.state='uncertain' and a.received_bytes=0 and a.provider_id is null and a.session_url is null
 and a.last_operation='init' and a.lease_until is null and exists(select from sma_private.publication_provider_events_v1 e
 where e.order_id=a.order_id and e.sequence=a.sequence and e.operation='init' and e.finished_at is not null
 and e.outcome->>'state'='uncertain' and e.outcome->>'code'='PROVIDER_INIT_UNCERTAIN')
 and not exists(select from sma_private.publication_provider_events_v1 e where e.order_id=a.order_id and
  (e.operation<>'init' or e.finished_at is null or e.outcome->>'state' is distinct from 'uncertain' or e.outcome?'provider_id'))
$$;
revoke all on function sma_private.manual_empty_tiktok_init_v1(sma_private.publication_provider_attempts_v1) from public,anon,authenticated,service_role;

create function public.sma_manual_portal_v1(p_action text,p_platform text,p_asset uuid default null,p_revision text default null,
 p_order uuid default null,p_request uuid default null,p_time timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();cid bigint;src uuid;folder text;bound_target text;f sma_private.publication_files_v1%rowtype;
 o sma_private.publication_orders_v1%rowtype;a sma_private.publication_provider_attempts_v1%rowtype;
 m sma_private.manual_portal_sends_v1%rowtype;stamp timestamptz:=coalesce(p_time,now()); fp text;held boolean;body jsonb;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_platform is null or p_platform not in ('youtube','tiktok','facebook','instagram') or p_action is null or p_action not in ('folder','read','send') then
 return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select s.customer_id,s.id,pf.folder_id,cfg.target_id into strict cid,src,folder,bound_target
 from sma_private.publication_rotation_sources_v1 s join public.sma_kunden k on (k.id,k.user_id)=(s.customer_id,s.owner_id)
 join sma_private.publication_portal_folders_v1 pf on pf.source_id=s.id and pf.platform=p_platform
 left join sma_private.day_publish_channels_v1 cfg on (cfg.source_id,cfg.customer_id,cfg.owner_id,cfg.platform,cfg.folder_id)=(s.id,k.id,uid,p_platform,pf.folder_id)
 left join sma_private.publication_rotation_channels_v1 ch on (ch.source_id,ch.platform,ch.target_id)=(s.id,p_platform,cfg.target_id)
 where k.user_id=uid and k.aktiv and (k.zahlung_bestaetigt or k.demo_delta_aktiv) and (cfg.target_id is null or ch.target_id is not null);
 if p_action='folder' then return jsonb_build_object('ok',true,'folder',folder,'verified_at',(select verified_at from sma_private.publication_portal_scans_v1 where source_id=src),'enabled',bound_target is not null and p_platform in ('youtube','tiktok'));end if;
 select * into strict f from sma_private.publication_files_v1 where id=p_asset and customer_id=cid and user_id=uid and available
  and revision=p_revision and media_kind='video' and mime_type='video/mp4' and sma_private.publication_portal_allowed_v1(src,p_platform,revision);
 if bound_target is null or p_platform not in ('youtube','tiktok') then return jsonb_build_object('ok',false,'code','TARGET_ACCOUNT_REQUIRED');end if;
 if p_action='send' then perform pg_advisory_xact_lock(cid);end if;
 select v.* into o from sma_private.publication_journal_v1 j join sma_private.publication_orders_v1 v on v.id=j.order_id
 where (j.customer_id,j.asset_id,j.asset_revision,j.platform,j.target_id)=(cid,f.id,f.revision,p_platform,bound_target)
 and (v.customer_id,v.user_id,v.target->>'id',v.binding->>'asset_id',v.binding->>'asset_revision',v.binding->>'platform')=(cid,uid,bound_target,f.id::text,f.revision,p_platform)
 and v.approved_at is not null for update of v;
 if o.id is null then return jsonb_build_object('ok',true,'state','approval_required');end if;
 select * into a from sma_private.publication_provider_attempts_v1 where order_id=o.id for update;
 select * into m from sma_private.manual_portal_sends_v1 where order_id=o.id;
 fp:=sma_private.publication_provider_fingerprint_v1(o);
 held:=a.order_id is not null and not coalesce(sma_private.manual_empty_tiktok_init_v1(a),false);
 body:=jsonb_build_object('ok',true,'order',o.id,'title',o.draft->>'title','caption',o.draft->>'caption','account',coalesce(o.account_check->>'display_name',o.target->>'name'),
 'visibility',o.choices->>'visibility','state',coalesce(a.state,o.state),'bytes',a.received_bytes,'due',m.due_at,'sequence',coalesce(a.sequence,0),'background',exists(select from sma_private.portal_schedule_transport_v1 where enabled),'pending',coalesce(m.due_at>now()-interval '30 minutes' and o.state in ('approved','checking','checked')
 and (a.order_id is null or a.state in ('session_ready','uploading','processing') or
   (m.restart_sequence=a.sequence and sma_private.manual_empty_tiktok_init_v1(a))),false),
 'can_send',not held and o.state in ('approved','checked') and coalesce(o.lease_until,'-infinity')<=now()
 and (m.order_id is null or m.due_at>now() or (a.sequence is not null and m.restart_sequence is distinct from a.sequence) or m.due_at<now()-interval '30 minutes'));
 if p_action='read' then return body;end if;
 if p_order is distinct from o.id or p_request is null then return jsonb_build_object('ok',false,'code','ORDER_CHANGED');end if;
 if m.request_id=p_request then return body||jsonb_build_object('accepted',true);end if;
 if not (body->>'can_send')::boolean then return body||jsonb_build_object('accepted',false);end if;
 if p_time is not null and (stamp<=now() or (stamp at time zone 'Europe/Vienna')::date<>(now() at time zone 'Europe/Vienna')::date) then return jsonb_build_object('ok',false,'code','INVALID_TIME');end if;
 if sma_private.publication_order_review_valid_v1(o.approval_review,p_platform,o.choices) is not true
 or (a.order_id is not null and a.fingerprint<>fp)
 or not exists(select from sma_private.publication_assignments_v1 x where x.asset_id=f.id and x.platform=p_platform
 and x.asset_revision=f.revision and x.preview_id::text=o.binding->>'preview_id' and x.preview_revision::text=o.binding->>'preview_revision'
 and x.revision::text=o.binding->>'assignment_revision') then return jsonb_build_object('ok',false,'code','ORDER_CHANGED');end if;
 insert into sma_private.manual_portal_sends_v1 as prev(order_id,source_id,fingerprint,request_id,due_at,next_check,restart_sequence)
 values(o.id,src,fp,p_request,stamp,stamp,a.sequence) on conflict(order_id) do update set request_id=excluded.request_id,
 due_at=excluded.due_at,next_check=excluded.next_check,restart_sequence=excluded.restart_sequence,requested_at=now() where prev.fingerprint=excluded.fingerprint;
 if not found then return jsonb_build_object('ok',false,'code','ORDER_CHANGED');end if;
 insert into sma_private.publication_provider_permissions_v1 as p(order_id,fingerprint,expires_at) values(o.id,fp,stamp+interval '30 minutes')
 on conflict(order_id) do update set expires_at=excluded.expires_at where p.fingerprint=excluded.fingerprint;
 if not found then raise exception 'ORDER_CHANGED';end if;
 if p_time is null then perform sma_private.wake_custom_portal_schedule_v1();end if;
 return body||jsonb_build_object('accepted',true,'due',stamp);
exception when no_data_found or too_many_rows then return jsonb_build_object('ok',false,'code','FOLDER_OR_FILE_UNAVAILABLE');
end $$;
revoke all on function public.sma_manual_portal_v1(text,text,uuid,text,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.sma_manual_portal_v1(text,text,uuid,text,uuid,uuid,timestamptz) to authenticated;

create function sma_private.manual_send_window_v1(oid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select from sma_private.manual_portal_sends_v1 m join sma_private.publication_orders_v1 o on o.id=m.order_id
 join sma_private.day_publish_channels_v1 c on (c.source_id,c.platform,c.target_id,c.owner_id,c.customer_id)=(m.source_id,o.binding->>'platform',o.target->>'id',o.user_id,o.customer_id)
 join sma_private.publication_portal_folders_v1 f on (f.source_id,f.platform,f.folder_id)=(c.source_id,c.platform,c.folder_id)
 join sma_private.publication_rotation_channels_v1 ch on (ch.source_id,ch.platform,ch.target_id)=(c.source_id,c.platform,c.target_id)
 where m.order_id=oid and m.fingerprint=sma_private.publication_provider_fingerprint_v1(o)
 and m.due_at<=now() and m.due_at>now()-interval '30 minutes'
 and sma_private.publication_portal_allowed_v1(m.source_id,c.platform,o.binding->>'asset_revision'))
$$;
revoke all on function sma_private.manual_send_window_v1(uuid) from public,anon,authenticated;
grant execute on function sma_private.manual_send_window_v1(uuid) to service_role;

create function sma_private.manual_restart_allowed_v1(oid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select from sma_private.manual_portal_sends_v1 m join sma_private.publication_provider_attempts_v1 a using(order_id)
 where m.order_id=oid and m.restart_sequence=a.sequence and sma_private.manual_empty_tiktok_init_v1(a)
 and m.fingerprint=a.fingerprint and sma_private.manual_send_window_v1(oid))
$$;
revoke all on function sma_private.manual_restart_allowed_v1(uuid) from public,anon,authenticated;
grant execute on function sma_private.manual_restart_allowed_v1(uuid) to service_role;

do $patch$
declare b text; anchor text:=' select * into d from sma_private.publication_rotation_deliveries_v1 where order_id=new.order_id;';
begin
 b:=pg_get_functiondef('sma_private.publication_rotation_send_guard_v1()'::regprocedure);
 if array_length(string_to_array(b,anchor),1)<>2 then raise exception 'SEND_GUARD_CHANGED';end if;
 execute replace(b,anchor,' if exists(select from sma_private.manual_portal_sends_v1 where order_id=new.order_id) then
  if not sma_private.manual_send_window_v1(new.order_id) then raise exception ''SCHEDULE_NOT_CURRENT'';end if;return new;end if;'||chr(10)||anchor);
 b:=pg_get_functiondef('public.sma_publication_provider_v1(text,uuid,uuid,jsonb)'::regprocedure);
 anchor:='if a.order_id is null then op:=''init'';';
 if array_length(string_to_array(b,anchor),1)<>2 or strpos(b,'''requires_file'',(a.order_id is null or')=0 then raise exception 'PROVIDER_BASE_CHANGED';end if;
 b:=replace(b,anchor,'if a.order_id is null or sma_private.manual_restart_allowed_v1(j.id) then op:=''init'';');
 execute replace(b,'''requires_file'',(a.order_id is null or','''requires_file'',(a.order_id is null or sma_private.manual_restart_allowed_v1(j.id) or');
end $patch$;

create view sma_private.due_manual_portal_jobs_v1 with (security_invoker=true) as
 select m.order_id,m.source_id,case when o.state in ('approved','checking') then 'publication.execution_check' else 'provider.cover' end as operation
 from sma_private.manual_portal_sends_v1 m join sma_private.publication_orders_v1 o on o.id=m.order_id
 left join sma_private.publication_provider_attempts_v1 a on a.order_id=m.order_id
 where m.next_check<=now() and m.due_at<=now() and m.fingerprint=sma_private.publication_provider_fingerprint_v1(o)
 and coalesce(o.lease_until,'-infinity')<=now() and coalesce(a.lease_until,'-infinity')<=now()
 and ((sma_private.manual_send_window_v1(m.order_id) and o.state in ('approved','checking','checked')
 and (a.order_id is null or a.state='session_ready' or sma_private.manual_restart_allowed_v1(o.id)))
 or (a.state='processing' and a.provider_id is not null and m.due_at>now()-interval '24 hours' and o.state='checked'));
revoke all on sma_private.due_manual_portal_jobs_v1 from public,anon,authenticated,service_role;
alter view sma_private.custom_portal_due_v1 rename to custom_timed_portal_due_v1;
create view sma_private.custom_portal_due_v1 with(security_invoker=true) as
 select source_id from sma_private.custom_timed_portal_due_v1 union select source_id from sma_private.due_manual_portal_jobs_v1;
revoke all on sma_private.custom_portal_due_v1 from public,anon,authenticated,service_role;

create or replace function public.sma_claim_portal_schedule_v1(p_ticket uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare src uuid; jobs jsonb:='[]'; more jsonb; item record;
begin
 update sma_private.portal_schedule_wakes_v1 set claimed_at=clock_timestamp()
  where ticket=p_ticket and claimed_at is null and issued_at>clock_timestamp()-interval '60 seconds' returning source_id into src;
 if not found then return jsonb_build_object('jobs',jobs);end if;
 if exists(select from sma_private.custom_timed_portal_due_v1 where source_id=src) then
  more:=public.sma_rotation_due_v1(src);
  select coalesce(jsonb_agg(j),'[]') into jobs from jsonb_array_elements(more->'jobs') j
   where not exists(select from sma_private.manual_portal_sends_v1 m where m.order_id::text=j#>>'{payload,id}');
 end if;
 for item in select v.order_id,v.operation from sma_private.due_manual_portal_jobs_v1 v join sma_private.manual_portal_sends_v1 m using(order_id)
 where v.source_id=src order by m.due_at limit 20 for update of m skip locked loop
  update sma_private.manual_portal_sends_v1 set next_check=now()+interval '30 seconds' where order_id=item.order_id;
  jobs:=jobs||jsonb_build_array(jsonb_build_object('operation',item.operation,'payload',jsonb_build_object('id',item.order_id),'context',jsonb_build_object('deadlineAt',null)));
 end loop;
 return jsonb_build_object('jobs',jobs);
end $$;
notify pgrst,'reload schema';

do $normal$
declare b text:=pg_get_functiondef('public.sma_rotation_due_v1(uuid)'::regprocedure);
 anchor text:='where source_id=p_source and next_check<=now()';
begin
 if array_length(string_to_array(b,anchor),1)<>2 then raise exception 'DUE_BASE_CHANGED';end if;
 execute replace(b,anchor,anchor||' and not exists(select from sma_private.manual_portal_sends_v1 manual
   where manual.order_id=publication_rotation_deliveries_v1.order_id)');
end $normal$;

create table sma_private.on_demand_portal_scans_v1(source_id uuid primary key references sma_private.publication_rotation_sources_v1,
 ticket uuid unique not null,requested_at timestamptz not null,claimed_at timestamptz);
alter table sma_private.on_demand_portal_scans_v1 enable row level security;
revoke all on sma_private.on_demand_portal_scans_v1 from public,anon,authenticated,service_role;

create function public.sma_refresh_portal_folder_v1(p_platform text) returns jsonb language plpgsql security definer set search_path='' as $$
declare src uuid;t uuid;verified timestamptz;
begin
 select s.id,sc.verified_at into strict src,verified from sma_private.publication_rotation_sources_v1 s
 join public.sma_kunden k on (k.id,k.user_id)=(s.customer_id,s.owner_id) join sma_private.publication_portal_folders_v1 pf on pf.source_id=s.id
 left join sma_private.publication_portal_scans_v1 sc on sc.source_id=s.id
 where k.user_id=auth.uid() and k.aktiv and (k.demo_delta_aktiv or k.zahlung_bestaetigt) and pf.platform=p_platform;
 if not exists(select from sma_private.portal_schedule_transport_v1 where enabled) then return jsonb_build_object('ok',true,'verified_at',verified,'refreshing',false,'background',false);end if;
 if verified is null or verified<now()-interval '1 minute' then
  insert into sma_private.on_demand_portal_scans_v1 as old values(src,gen_random_uuid(),now(),null)
   on conflict(source_id) do update set ticket=excluded.ticket,requested_at=excluded.requested_at,claimed_at=null
    where old.requested_at<now()-interval '2 minutes' returning ticket into t;
  if found then perform net.http_post(url:='https://johnmusic.app.n8n.cloud/webhook/sma-portalordner-oeffnen-v1',
   body:=jsonb_build_object('ticket',t),timeout_milliseconds:=10000);end if;
 end if;
 return jsonb_build_object('ok',true,'verified_at',verified,'refreshing',verified is null or verified<now()-interval '1 minute');
exception when no_data_found or too_many_rows then return jsonb_build_object('ok',false,'code','FOLDER_OR_FILE_UNAVAILABLE');
end $$;
revoke all on function public.sma_refresh_portal_folder_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.sma_refresh_portal_folder_v1(text) to authenticated;
create function public.sma_claim_manual_portal_scan_v1(p_ticket uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare src uuid;
begin
 update sma_private.on_demand_portal_scans_v1 set claimed_at=now()
 where ticket=p_ticket and claimed_at is null and requested_at>now()-interval '65 seconds' returning source_id into src;
 return jsonb_build_object('source_id',src);
end $$;
revoke all on function public.sma_claim_manual_portal_scan_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.sma_claim_manual_portal_scan_v1(uuid) to service_role;
notify pgrst,'reload schema';
