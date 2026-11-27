-- Only a configured customer, portal folder and target can produce day orders.
create table sma_private.day_publish_channels_v1 (
 source_id uuid not null, platform text not null, owner_id uuid not null, customer_id bigint not null,
 target_id text not null, folder_id text not null, tiktok_ai boolean,
 primary key(source_id,platform),
 foreign key(source_id,platform) references sma_private.publication_rotation_channels_v1
);
create table sma_private.day_publish_receipts_v1 (
 id uuid primary key, customer_id bigint not null, owner_id uuid not null, plan_day date not null, request_hash text not null,
 created_at timestamptz not null default now()
);
create table sma_private.day_publish_entries_v1 (
 order_id uuid primary key references sma_private.publication_orders_v1,
 receipt_id uuid not null references sma_private.day_publish_receipts_v1, source_id uuid not null,
 asset_id uuid not null, revision text not null, plan_version bigint not null, due_at timestamptz not null,
 platform text not null, target_id text not null, choices jsonb not null
);
alter table sma_private.day_publish_channels_v1 enable row level security;
alter table sma_private.day_publish_receipts_v1 enable row level security;
alter table sma_private.day_publish_entries_v1 enable row level security;
revoke all on sma_private.day_publish_channels_v1,sma_private.day_publish_receipts_v1,sma_private.day_publish_entries_v1 from public,anon,authenticated,service_role;

-- Existing approvals keep their exact validator. A day consent records no personal playback claim.
alter function sma_private.publication_order_review_valid_v1(jsonb,text,jsonb) rename to publication_single_order_review_valid_v1;
create function sma_private.publication_order_review_valid_v1(v jsonb,p_platform text,ch jsonb)
returns boolean language sql stable security definer set search_path='' as $$
 select case when v->>'policy_version'='sma-day-plan-v1' then exists(
  select from sma_private.day_publish_entries_v1 e where e.order_id::text=v->>'order_id'
    and e.platform=p_platform and e.choices=ch and v=jsonb_build_object('policy_version','sma-day-plan-v1','order_id',e.order_id,'receipt_id',e.receipt_id))
 else sma_private.publication_single_order_review_valid_v1(v,p_platform,ch) end
$$;
revoke all on function sma_private.publication_order_review_valid_v1(jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function sma_private.publication_order_review_valid_v1(jsonb,text,jsonb) to service_role;

-- Never let a second order use the receipt belonging to the first.
do $migration$
declare body text:=pg_get_functiondef('sma_private.publication_order_request_v1(text,jsonb)'::regprocedure);
 anchor text:=' if p_action=''approve'' then';
begin
 if array_length(string_to_array(body,anchor),1)<>2 then raise exception 'DAY_APPROVAL_BASE_CHANGED'; end if;
 execute replace(body,anchor,anchor||$check$
  if p_input#>>'{review,policy_version}'='sma-day-plan-v1' and
    (p_input#>>'{review,order_id}' is distinct from j.id::text or not exists(select from sma_private.day_publish_entries_v1 e
     where e.order_id=j.id and e.receipt_id::text=p_input#>>'{review,receipt_id}')) then
    return jsonb_build_object('ok',false,'code','FINAL_APPROVAL_REQUIRED'); end if;
$check$);
end $migration$;

create function sma_private.day_publish_plan_v1(day_in date) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(rows) order by due_at,platform),'[]') from (
 select cfg.source_id,pf.folder_id,cfg.platform,cfg.target_id,cfg.tiktok_ai,j.asset_id,j.asset_revision,j.version as plan_version,
 (j.portal_times->>cfg.platform)::timestamptz as due_at,j.daily_slot as slot,f.name,f.mime_type,f.size_bytes,
 (f.available and f.revision=j.asset_revision and sma_private.publication_portal_allowed_v1(s.id,cfg.platform,f.revision)) as current_file,
 a.revision as assignment_revision,p.id as preview_id,p.revision as preview_revision,
 case when p.id is not null then a.draft->>'title' end as title,case when p.id is not null then a.draft->>'caption' end as caption,
 case when cfg.platform='youtube' then public.sma_youtube_file_defaults_v1(f.id,j.asset_revision,cfg.target_id) end as defaults,
 case when (direct.asset_id,direct.asset_revision,direct.plan_version,direct.target_id)=(j.asset_id,j.asset_revision,j.version,cfg.target_id) then direct.order_id end as existing_order,
 (direct.order_id is not null and (direct.asset_id,direct.asset_revision,direct.plan_version,direct.target_id) is distinct from (j.asset_id,j.asset_revision,j.version,cfg.target_id)) as slot_conflict, prior.order_id as previous_order,
 coalesce(prior_result.state='complete' and (prior_result.updated_at at time zone 'Europe/Vienna')::date<day_in,false) as repeatable,
 f.verified_at
 from sma_private.day_publish_channels_v1 cfg
 join sma_private.publication_rotation_sources_v1 s on (s.id,s.owner_id,s.customer_id)=(cfg.source_id,cfg.owner_id,cfg.customer_id)
 join public.sma_kunden c on (c.id,c.user_id)=(s.customer_id,s.owner_id) and c.user_id=auth.uid() and c.aktiv and (c.zahlung_bestaetigt or c.demo_delta_aktiv)
 join sma_private.publication_rotation_channels_v1 ch on (ch.source_id,ch.platform,ch.target_id)=(s.id,cfg.platform,cfg.target_id)
 join sma_private.publication_portal_folders_v1 pf on (pf.source_id,pf.platform,pf.folder_id)=(s.id,cfg.platform,cfg.folder_id)
 join sma_private.publication_joint_plans_v1 j on (j.customer_id,j.owner_id)=(c.id,c.user_id) and j.plan_day=day_in and j.daily_slot is not null and j.portal_times ? cfg.platform
 join sma_private.publication_files_v1 f on (f.id,f.user_id,f.customer_id)=(j.asset_id,c.user_id,c.id)
 left join sma_private.publication_assignments_v1 a on (a.asset_id,a.asset_revision,a.platform)=(f.id,j.asset_revision,cfg.platform)
 left join sma_private.publication_previews_v1 p on (p.id,p.revision,p.user_id,p.customer_id)=(a.preview_id,a.preview_revision,c.user_id,c.id) and p.status='completed'
 left join sma_private.publication_rotation_deliveries_v1 direct on (direct.source_id,direct.customer_id,direct.platform,direct.due_at)=(s.id,c.id,cfg.platform,(j.portal_times->>cfg.platform)::timestamptz)
 left join sma_private.publication_journal_v1 prior on (prior.customer_id,prior.asset_id,prior.asset_revision,prior.platform,prior.target_id)=(c.id,f.id,j.asset_revision,cfg.platform,cfg.target_id)
 left join sma_private.publication_provider_attempts_v1 prior_result on prior_result.order_id=prior.order_id
 where (j.portal_times->>cfg.platform)::timestamptz>now()
 ) rows
$$;
revoke all on function sma_private.day_publish_plan_v1(date) from public,anon,authenticated,service_role;

create function public.sma_rotating_day_v1(p_day date,p_request uuid default null,p_entries jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();cid bigint; today date:=(now() at time zone 'Europe/Vienna')::date;
 plan jsonb; item jsonb; entry jsonb; result jsonb; review jsonb; fingerprint text;
 receipt sma_private.day_publish_receipts_v1%rowtype; job sma_private.publication_orders_v1%rowtype;
 schedule sma_private.publication_rotation_deliveries_v1%rowtype; n integer:=0; slot_time timestamptz;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 select id into strict cid from public.sma_kunden where user_id=uid and aktiv and (zahlung_bestaetigt or demo_delta_aktiv);
 if p_day is null or p_day not between today and today+2 then return jsonb_build_object('ok',false,'code','INVALID_DAY');end if;
 if p_request is null and p_entries is null then return jsonb_build_object('ok',true,'items',sma_private.day_publish_plan_v1(p_day),'day',p_day);end if;
 if p_request is not null and p_entries is null then
  select * into receipt from sma_private.day_publish_receipts_v1 where id=p_request and owner_id=uid and customer_id=cid and plan_day=p_day;
  return jsonb_build_object('ok',true,'receipt',receipt.id,'approved',(select count(*) from sma_private.day_publish_entries_v1 where receipt_id=receipt.id));
 end if;
 if p_request is null or jsonb_typeof(p_entries) is distinct from 'array' then raise exception 'INVALID_INPUT';end if;
 if jsonb_array_length(p_entries) not between 1 and 6 or octet_length(p_entries::text)>16000 then raise exception 'INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(cid);
 perform pg_advisory_xact_lock(741604,(cid%2147483647)::integer);
 fingerprint:=encode(sha256(convert_to(p_entries::text,'UTF8')),'hex');
 select * into receipt from sma_private.day_publish_receipts_v1 where id=p_request;
 if found then
  if (receipt.owner_id,receipt.customer_id,receipt.plan_day,receipt.request_hash) is distinct from (uid,cid,p_day,fingerprint) then raise exception 'REQUEST_CONFLICT';end if;
  return jsonb_build_object('ok',true,'receipt',receipt.id,'approved',jsonb_array_length(p_entries));end if;
 insert into sma_private.day_publish_receipts_v1 values(p_request,cid,uid,p_day,fingerprint,now());
 plan:=sma_private.day_publish_plan_v1(p_day);
 for entry in select value from jsonb_array_elements(p_entries) loop
  select * into strict job from sma_private.publication_orders_v1 where id=(entry->>'order_id')::uuid and user_id=uid and customer_id=cid for update;
  select value into strict item from jsonb_array_elements(plan) where value->>'asset_id'=job.binding->>'asset_id'
    and value->>'platform'=job.binding->>'platform' and value->>'asset_revision'=job.binding->>'asset_revision';
  slot_time:=(item->>'due_at')::timestamptz;
  if (item->>'slot_conflict')::boolean or item->>'existing_order' is not null or (item->>'current_file')::boolean is not true or item->>'preview_id' is null
     or (item->>'plan_version')::bigint is distinct from (entry->>'plan_version')::bigint or slot_time is distinct from (entry->>'due_at')::timestamptz
     or job.binding->'assignment_revision' is distinct from item->'assignment_revision' or job.binding->'preview_revision' is distinct from item->'preview_revision'
     or job.binding->'preview_id' is distinct from item->'preview_id' or job.draft->'title' is distinct from item->'title' or job.draft->'caption' is distinct from item->'caption'
     or job.target->>'id' is distinct from item->>'target_id' or job.choices is distinct from entry->'choices'
     or job.state<>'prepared' or job.approved_at is not null or job.replaces_blocked_order_id is not null
     or job.approval_token::text is distinct from entry->>'token' or (sma_private.publication_approval_window_v1(job)->>'status') is distinct from 'active'
  then raise exception 'PLAN_CHANGED';end if;
  if item->>'previous_order' is not null then
   -- Reuse only after a positive provider result on an earlier day. Preserve both orders and their provider history.
   if item->'repeatable' is distinct from 'true'::jsonb then raise exception 'DUPLICATE_PUBLICATION';end if;
   update sma_private.publication_journal_v1 set order_id=job.id,created_at=now()
   where customer_id=cid and asset_id=(item->>'asset_id')::uuid and asset_revision=item->>'asset_revision'
    and platform=item->>'platform' and target_id=item->>'target_id' and order_id=(item->>'previous_order')::uuid;
   if not found then raise exception 'PLAN_CHANGED';end if;
  end if;
  insert into sma_private.day_publish_entries_v1 values(job.id,p_request,(item->>'source_id')::uuid,(item->>'asset_id')::uuid,item->>'asset_revision',
   (item->>'plan_version')::bigint,slot_time,item->>'platform',item->>'target_id',job.choices);
  review:=jsonb_build_object('policy_version','sma-day-plan-v1','order_id',job.id,'receipt_id',p_request);
  result:=sma_private.publication_order_request_v1('approve',jsonb_build_object('id',job.id,'approval_token',job.approval_token,'confirm',true,'review',review));
  if result->'ok' is distinct from 'true'::jsonb or result->>'state' is distinct from 'approved' then raise exception '%',coalesce(result->>'code','FINAL_APPROVAL_REQUIRED');end if;
  select * into strict schedule from sma_private.publication_rotation_deliveries_v1 where order_id=job.id and due_at=slot_time;
  if sma_private.publication_rotation_current_v1(schedule) is not true then raise exception 'PLAN_CHANGED'; end if;
  insert into sma_private.publication_provider_permissions_v1(order_id,fingerprint,expires_at) values(job.id,schedule.fingerprint,slot_time+interval '30 minutes');
  if job.binding->>'platform'='tiktok' and entry->'save_folder_ai'='true'::jsonb then
   update sma_private.day_publish_channels_v1 set tiktok_ai=(job.choices->>'is_aigc')::boolean where source_id=schedule.source_id and platform='tiktok' and owner_id=uid and customer_id=cid and target_id=schedule.target_id;
  end if;
  n:=n+1;
 end loop;
 return jsonb_build_object('ok',true,'approved',n,'receipt',p_request);
exception when no_data_found or too_many_rows then return jsonb_build_object('ok',false,'code','PLAN_CHANGED');
 when invalid_text_representation or unique_violation then return jsonb_build_object('ok',false,'code','REQUEST_CONFLICT');
 when raise_exception then return jsonb_build_object('ok',false,'code',sqlerrm);
end $$;
revoke all on function public.sma_rotating_day_v1(date,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_rotating_day_v1(date,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
-- The customer releases the exact media and text. Keep a separate record of any
-- optional personal playback checks. Never describe a sample as a full review.
alter function sma_private.publication_order_media_v1(sma_private.publication_orders_v1,jsonb,jsonb)
  rename to publication_single_order_media_v1;

create function sma_private.publication_order_media_v1(j sma_private.publication_orders_v1, media jsonb, evidence jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare checked jsonb; optional_checks jsonb;
begin
 checked:=sma_private.publication_single_order_media_v1(j,media,evidence);
 if j.approved_at is null or j.approval_review->>'policy_version' is distinct from 'sma-day-plan-v1'
    or (checked->'checks' @> '[{"code":"PORTAL_TEXT_COMPARISON","status":"pass"}]') is not true
    or checked->>'asset_id' is distinct from j.binding->>'asset_id' or checked->>'asset_revision' is distinct from j.binding->>'asset_revision'
    or not exists (
      select from sma_private.day_publish_entries_v1 e
      join sma_private.day_publish_receipts_v1 r on r.id=e.receipt_id
      join sma_private.publication_magic_results_v1 m on (m.user_id,m.customer_id,m.asset_id,m.asset_revision)=(r.owner_id,r.customer_id,e.asset_id,e.revision)
      where e.order_id=j.id and r.id::text=j.approval_review->>'receipt_id'
        and (r.owner_id,r.customer_id,e.platform,e.choices)=(j.user_id,j.customer_id,j.binding->>'platform',j.choices)
        and m.status='completed' and m.policy_version='magic-video-2026-11-03.1'
        and m.content_sha256=split_part(e.revision,':',2) and m.result#>>'{evidence,source_sha256}'=m.content_sha256
        and m.result->>'content_comparison'='model_checked_sampled_evidence' and m.result->>'subject_type'<>'unclear'
    ) then return checked; end if;
 select jsonb_agg(c order by n) into optional_checks from jsonb_array_elements(checked->'checks') with ordinality as a(c,n)
 where c->>'status'='pending' and (c->>'code'='SEMANTIC_REVIEW_PENDING'
   or (c->>'code'='CONTENT_REVIEW_PENDING' and checked#>>'{content_review,status}'='unreviewed'));
 if optional_checks is null then return checked; end if;
 return checked||jsonb_build_object('optional_personal_checks',optional_checks,'checks',(
  select coalesce(jsonb_agg(c order by n),'[]'::jsonb) from jsonb_array_elements(checked->'checks') with ordinality as a(c,n)
  where not (optional_checks @> jsonb_build_array(c))
 )||jsonb_build_array(jsonb_build_object('code','DAY_MEDIA_RELEASE','status','pass',
    'message','Der Kunde hat diese Datei und den abgeglichenen Beitrag im Tagesplan zur Veröffentlichung freigegeben. Die automatische Videoanalyse beruht auf Stichproben.')));
end $$;
revoke all on function sma_private.publication_order_media_v1(sma_private.publication_orders_v1,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function sma_private.publication_order_media_v1(sma_private.publication_orders_v1,jsonb,jsonb) to service_role;
