-- Additive cover binding. Requires the separately installed PR #57 journal.
-- Does not replace that journal, its fingerprint, or create operator permits.
create table if not exists sma_private.publication_provider_covers_v1 (
 order_id uuid primary key references sma_private.publication_orders_v1(id),
 fingerprint text not null, plan jsonb, state text not null default 'bound'
 check(state in ('bound','sending','complete','failed','uncertain')),
 lease_id uuid, sent_at timestamptz, finished_at timestamptz, code text,
 created_at timestamptz not null default now()
);
alter table sma_private.publication_provider_covers_v1 enable row level security;
revoke all on sma_private.publication_provider_covers_v1 from public,anon,authenticated,service_role;

create or replace function sma_private.publication_cover_plan_v1(j sma_private.publication_orders_v1)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare f sma_private.publication_files_v1%rowtype;co sma_private.publication_files_v1%rowtype;
 e sma_private.publication_editor_exports_v1%rowtype;pos bigint;duration bigint;
begin
 select * into e from sma_private.publication_editor_exports_v1 where media_asset_id=(j.binding->>'asset_id')::uuid
  and user_id=j.user_id and customer_id=j.customer_id and completed_at is not null order by completed_at desc,id desc limit 1;
 if not found or e.outputs->'cover'='null'::jsonb then return null;end if;
 select * into f from sma_private.publication_files_v1 where id=e.media_asset_id and user_id=j.user_id and customer_id=j.customer_id and available;
 if not found or f.revision is distinct from j.binding->>'asset_revision' or f.media_kind<>'video' or f.mime_type<>'video/mp4'
  or f.revision !~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$' or split_part(f.revision,':',2) is distinct from e.outputs->'media'->>'sha256'
  or f.size_bytes is distinct from (e.outputs->'media'->>'size_bytes')::bigint then raise exception 'COVER_UNAVAILABLE';end if;
 select * into co from sma_private.publication_files_v1 where id=e.cover_asset_id and user_id=j.user_id and customer_id=j.customer_id and available;
 if not found or co.id=f.id or co.mime_type<>'image/png' or co.media_kind<>'image' or co.revision !~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$'
  or split_part(co.revision,':',2) is distinct from e.outputs->'cover'->>'sha256' or co.size_bytes is distinct from (e.outputs->'cover'->>'size_bytes')::bigint
  or co.size_bytes not between 33 and 24000000 then raise exception 'COVER_UNAVAILABLE';end if;
 pos:=(e.settings->>'cover_ms')::bigint-(e.settings->>'start_ms')::bigint;
 duration:=coalesce((e.settings->>'end_ms')::bigint-(e.settings->>'start_ms')::bigint,f.duration_ms,
  (select s.duration_ms-(e.settings->>'start_ms')::bigint from sma_private.publication_files_v1 s where s.id=e.asset_id and s.user_id=j.user_id and s.customer_id=j.customer_id and s.revision=e.asset_revision and s.available));
 if pos is null or duration is null or pos<0 or duration not between 1 and 60000 or pos>=duration then raise exception 'COVER_UNAVAILABLE';end if;
 return jsonb_build_object('version',1,'export_id',e.id,'video_asset_id',f.id,'video_revision',f.revision,
  'asset_id',co.id,'asset_revision',co.revision,'drive_file_id',co.drive_file_id,'mime_type',co.mime_type,'size_bytes',co.size_bytes,'position_ms',least(pos,greatest(0,duration-34)),'duration_ms',duration);
end $$;
revoke all on function sma_private.publication_cover_plan_v1(sma_private.publication_orders_v1) from public,anon,authenticated,service_role;

create or replace function sma_private.publication_provider_cover_request_v1(p_action text,p_id uuid,p_lease uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare j sma_private.publication_orders_v1%rowtype;c public.sma_kunden%rowtype;
 a sma_private.publication_provider_attempts_v1%rowtype;cv sma_private.publication_provider_covers_v1%rowtype;
 r jsonb;plan jsonb;fp text;ready boolean;terminal boolean;
begin
 if p_action is null or p_action not in ('context','provider_begin','cover_begin','cover_finish') or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>18000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 -- Same lock order as the existing provider journal; snapshot and init are atomic.
 select * into j from sma_private.publication_orders_v1 where id=p_id for update;
 if not found or j.binding->>'platform' not in ('youtube','tiktok') or j.binding->>'media_kind' is distinct from 'video' then return jsonb_build_object('ok',false,'code','ORDER_UNAVAILABLE');end if;
 select * into c from public.sma_kunden where id=j.customer_id and user_id=j.user_id;
 if not found or c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 fp:=sma_private.publication_provider_fingerprint_v1(j);
 select * into a from sma_private.publication_provider_attempts_v1 where order_id=p_id for update;
 select * into cv from sma_private.publication_provider_covers_v1 where order_id=p_id for update;
 if (a.order_id is not null and a.fingerprint is distinct from fp) or (cv.order_id is not null and cv.fingerprint is distinct from fp) then return jsonb_build_object('ok',false,'code','ORDER_CHANGED');end if;
 ready:=coalesce(a.platform='youtube' and a.state='complete' and cv.plan is not null and cv.state='bound',false);
 terminal:=coalesce(a.platform='youtube' and a.state='complete' and cv.plan is not null and cv.state<>'bound',false);
 if p_action='context' then
  r:=public.sma_publication_provider_v1('context',p_id);
  return r||jsonb_build_object('cover',cv.plan,'cover_ready',ready,'cover_terminal',terminal,'cover_state',case when cv.state='sending' and cv.sent_at<now()-interval '3 minutes' then 'uncertain' else cv.state end);
 end if;
 if p_action='provider_begin' then
  if ready or terminal then return jsonb_build_object('ok',false,'code','COVER_OPERATION_REQUIRED');end if;
  if a.order_id is null then plan:=sma_private.publication_cover_plan_v1(j);
  elsif cv.order_id is not null then plan:=cv.plan;
  else plan:=null;end if; -- Legacy attempts never gain a cover retroactively.
  r:=public.sma_publication_provider_v1('begin',p_id,p_lease,p_data);
  if r->'ok'='true'::jsonb and r->>'operation'='init' then
   insert into sma_private.publication_provider_covers_v1(order_id,fingerprint,plan) values(p_id,fp,plan);
  end if;
  return r||jsonb_build_object('cover',plan);
 end if;
 if p_action='cover_finish' then
  if cv.state is distinct from 'sending' or p_lease is null or cv.lease_id is distinct from p_lease then return jsonb_build_object('ok',false,'code','INVALID_LEASE');end if;
  if (select count(*) from jsonb_object_keys(p_data))<>2 or not(p_data ?& array['state','code']) or
   not (p_data=jsonb_build_object('state','complete','code','COVER_ACCEPTED') or p_data=jsonb_build_object('state','uncertain','code','COVER_RESPONSE_UNCERTAIN') or p_data=jsonb_build_object('state','failed','code','COVER_PERMISSION_REQUIRED') or p_data=jsonb_build_object('state','failed','code','COVER_REJECTED')) then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
  update sma_private.publication_provider_covers_v1 set state=p_data->>'state',code=p_data->>'code',finished_at=now() where order_id=p_id;
  return jsonb_build_object('ok',true,'state','complete','cover_state',p_data->>'state','can_upload',false,'can_publish',false);
 end if;
 -- Only a confirmed, processed video can receive one independently fenced PNG.
 if not ready or a.provider_id !~ '^[A-Za-z0-9_-]{11}$' or a.result->>'state' is distinct from 'complete'
  or a.result->>'provider_id' is distinct from a.provider_id or a.result->>'target_id' is distinct from a.target_id
  or a.target_id is distinct from j.target->>'id' or a.lease_until>now()
  or not exists(select 1 from sma_private.publication_provider_events_v1 e where e.order_id=p_id and e.operation='status' and e.finished_at is not null and e.outcome->'observation'=a.result)
  then return jsonb_build_object('ok',false,'code','COVER_NOT_READY');end if;
 if j.state<>'checked' or j.approved_at is null or j.blockers<>'[]'::jsonb then return jsonb_build_object('ok',false,'code','FINAL_APPROVAL_REQUIRED');end if;
 if not exists(select 1 from sma_private.publication_provider_permissions_v1 where order_id=p_id and fingerprint=fp and expires_at>now()) then return jsonb_build_object('ok',false,'code','UPLOAD_TEST_APPROVAL_REQUIRED');end if;
 if p_data->'target' is distinct from j.target or sma_private.publication_account_valid_v1(p_data->'account_check',j.target,j.choices) is not true then return jsonb_build_object('ok',false,'code','TARGET_PERMISSIONS_REQUIRED');end if;
 plan:=sma_private.publication_cover_plan_v1(j);
 if plan is distinct from cv.plan or p_data->'cover_verified' is distinct from 'true'::jsonb or p_data->>'cover_sha256' is distinct from split_part(plan->>'asset_revision',':',2) or p_data->'size_bytes' is distinct from plan->'size_bytes' then return jsonb_build_object('ok',false,'code','COVER_CHANGED');end if;
 update sma_private.publication_provider_covers_v1 set state='sending',lease_id=gen_random_uuid(),sent_at=now() where order_id=p_id returning * into cv;
 return jsonb_build_object('ok',true,'id',p_id,'operation','youtube_thumbnail','platform','youtube','lease_id',cv.lease_id,'provider_id',a.provider_id,'target_id',a.target_id,'video_state','complete','binding',j.binding,'cover',plan,'can_upload',false,'can_publish',false);
exception when raise_exception or invalid_text_representation or numeric_value_out_of_range then
 -- This subtransaction also rolls back a reserved init if binding failed.
 return jsonb_build_object('ok',false,'code','COVER_UNAVAILABLE');
end $$;
revoke all on function sma_private.publication_provider_cover_request_v1(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function sma_private.publication_provider_cover_request_v1(text,uuid,uuid,jsonb) to service_role;
create or replace function public.sma_publication_provider_cover_v1(p_action text,p_id uuid,p_lease uuid default null,p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select sma_private.publication_provider_cover_request_v1(p_action,p_id,p_lease,p_data);$$;
revoke all on function public.sma_publication_provider_cover_v1(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sma_publication_provider_cover_v1(text,uuid,uuid,jsonb) to service_role;
