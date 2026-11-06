-- Read-only cover status. No provider RPC, dispatch, approval or retry.
-- The old v1/v2 history and all write paths remain unchanged.
create or replace function sma_private.publication_history_cover_v1(j sma_private.publication_orders_v1)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare cv sma_private.publication_provider_covers_v1%rowtype;
 a sma_private.publication_provider_attempts_v1%rowtype;
 stage text:='not_recorded'; stamp timestamptz; fp text; valid_video boolean;
begin
 select * into cv from sma_private.publication_provider_covers_v1 where order_id=j.id;
 if not found then
  return jsonb_build_object('status',case when j.binding->>'platform' not in ('youtube','tiktok')
   or j.binding->>'media_kind' is distinct from 'video' then 'not_applicable' else 'not_recorded' end,'updated_at',null);
 end if;
 stamp:=greatest(cv.created_at,cv.sent_at,cv.finished_at);
 select * into a from sma_private.publication_provider_attempts_v1 where order_id=j.id;
 fp:=sma_private.publication_provider_fingerprint_v1(j);
 if cv.fingerprint is distinct from fp or a.order_id is null or a.fingerprint is distinct from fp
  or a.platform is distinct from j.binding->>'platform' or a.target_id is distinct from j.target->>'id'
  or a.visibility is distinct from j.choices->>'visibility' or j.binding->>'media_kind' is distinct from 'video' then
  stage:='needs_review';
 elsif cv.plan is null then
  stage:=case when cv.state='bound' and cv.lease_id is null and cv.sent_at is null and cv.finished_at is null and cv.code is null then 'none' else 'needs_review' end;
 elsif jsonb_typeof(cv.plan) is distinct from 'object' or cv.plan->'version' is distinct from '1'::jsonb
  or coalesce(cv.plan->>'export_id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  or coalesce(cv.plan->>'video_asset_id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  or coalesce(cv.plan->>'video_revision','') !~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$'
  or cv.plan->>'video_asset_id' is distinct from j.binding->>'asset_id'
  or cv.plan->>'video_revision' is distinct from j.binding->>'asset_revision'
  or coalesce(cv.plan->>'asset_id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  or cv.plan->>'asset_id'=cv.plan->>'video_asset_id'
  or coalesce(cv.plan->>'asset_revision','') !~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$'
  or cv.plan->>'mime_type' is distinct from 'image/png'
  or coalesce(cv.plan->>'drive_file_id','') !~ '^[A-Za-z0-9_-]{10,200}$'
  or jsonb_typeof(cv.plan->'size_bytes') is distinct from 'number'
  or coalesce(cv.plan->>'size_bytes','') !~ '^[0-9]{1,8}$'
  or jsonb_typeof(cv.plan->'position_ms') is distinct from 'number'
  or coalesce(cv.plan->>'position_ms','') !~ '^[0-9]{1,5}$'
  or jsonb_typeof(cv.plan->'duration_ms') is distinct from 'number'
  or coalesce(cv.plan->>'duration_ms','') !~ '^[0-9]{1,5}$' then stage:='needs_review';
 elsif (cv.plan->>'size_bytes')::integer not between 33 and 24000000
  or (cv.plan->>'duration_ms')::integer not between 1 and 60000
  or (cv.plan->>'position_ms')::integer >= (cv.plan->>'duration_ms')::integer then stage:='needs_review';
 else
  stamp:=greatest(stamp,a.updated_at);
  valid_video:=a.state='complete'
   and sma_private.publication_history_entry_v1(j)->>'status' in ('public_confirmed','private_complete','unlisted_complete','limited_complete')
   and exists(select 1 from sma_private.publication_provider_events_v1 e where e.order_id=j.id
    and e.operation='status' and e.finished_at is not null and e.outcome->'observation'=a.result);
  if cv.state='bound' then
   if cv.lease_id is not null or cv.sent_at is not null or cv.finished_at is not null or cv.code is not null then stage:='needs_review';
   elsif a.state='complete' and not valid_video then stage:='needs_review';
   elsif a.platform='tiktok' and valid_video then
    -- TikTok has no independent cover receipt. Only report the timestamp handoff
    -- when both the initial request and the finished video are recorded.
    stage:=case when exists(select 1 from sma_private.publication_provider_events_v1 e where e.order_id=j.id
     and e.operation='init' and e.finished_at is not null and e.outcome->>'state'='session_ready'
     and e.outcome->>'provider_id'=a.provider_id and e.created_at>=cv.created_at)
     then 'timestamp_sent' else 'needs_review' end;
   elsif a.state in ('uncertain','needs_review') then stage:='uncertain';
   elsif a.state='failed' or j.state in ('cancelled','blocked') then stage:='blocked';
   else stage:='pending';end if;
  elsif a.platform<>'youtube' or not valid_video or cv.lease_id is null or cv.sent_at is null
   or cv.sent_at<cv.created_at or cv.sent_at>now() then stage:='needs_review';
  elsif cv.state='sending' then
   stage:=case when cv.code is not null or cv.finished_at is not null then 'needs_review'
    when cv.sent_at<now()-interval '3 minutes' then 'uncertain' else 'sending' end;
  elsif cv.finished_at is null or cv.finished_at<cv.sent_at or cv.finished_at>now() then stage:='needs_review';
  elsif cv.state='complete' and cv.code='COVER_ACCEPTED' then stage:='complete';
  elsif cv.state='failed' and cv.code='COVER_PERMISSION_REQUIRED' then stage:='permission_required';
  elsif cv.state='failed' and cv.code='COVER_REJECTED' then stage:='failed';
  elsif cv.state='uncertain' and cv.code='COVER_RESPONSE_UNCERTAIN' then stage:='uncertain';
  else stage:='needs_review';end if;
 end if;
 return jsonb_build_object('status',stage,'updated_at',stamp);
end $$;
revoke all on function sma_private.publication_history_cover_v1(sma_private.publication_orders_v1) from public,anon,authenticated,service_role;

create or replace function sma_private.publication_history_read_v3(p_input jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); r jsonb; rows jsonb;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 -- v2 enforces the same active, unambiguous customer, filters and page bounds.
 r:=sma_private.publication_history_read_v2(p_input);
 if r->'ok' is distinct from 'true'::jsonb then return r;end if;
 select coalesce(jsonb_agg(e.value||jsonb_build_object('cover',sma_private.publication_history_cover_v1(j)) order by e.ordinality),'[]'::jsonb)
 into rows from jsonb_array_elements(r->'entries') with ordinality e(value,ordinality)
 join sma_private.publication_orders_v1 j on j.id=(e.value->>'id')::uuid
  and j.user_id=uid and j.customer_id=(select c.id from public.sma_kunden c where c.user_id=uid);
 return r||jsonb_build_object('version',3,'entries',rows);
end $$;
revoke all on function sma_private.publication_history_read_v3(jsonb) from public,anon,service_role;
grant execute on function sma_private.publication_history_read_v3(jsonb) to authenticated;

create or replace function public.sma_publication_history_v3(p_input jsonb default '{}')
returns jsonb language sql stable security invoker set search_path='' as $$
 select sma_private.publication_history_read_v3(p_input);
$$;
revoke all on function public.sma_publication_history_v3(jsonb) from public,anon,service_role;
grant execute on function public.sma_publication_history_v3(jsonb) to authenticated;
