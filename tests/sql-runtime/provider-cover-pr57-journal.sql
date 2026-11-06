-- Test-only snapshot of PR #57 commit 4b846e8525dbed26dbc4ef8907e0050d3fb25464. Not a migration.
-- Exactly one provider attempt per approved publication key. No client grants.
create table if not exists sma_private.publication_provider_permissions_v1 (
 order_id uuid primary key references sma_private.publication_orders_v1(id),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null, created_at timestamptz not null default now()
);
-- Deliberately no service INSERT/UPDATE grant: explicit operator approval only.
create table if not exists sma_private.publication_provider_attempts_v1 (
 order_id uuid primary key references sma_private.publication_orders_v1(id),
 fingerprint text not null, platform text not null check(platform in ('youtube','tiktok')),
 target_id text not null, visibility text not null, size_bytes bigint not null check(size_bytes between 1 and 24000000),
 state text not null default 'reserved' check(state in ('reserved','session_ready','uploading','processing','complete','failed','uncertain','needs_review')),
 provider_id text, session_url text, session_expires_at timestamptz, received_bytes bigint not null default 0,
 sequence integer not null default 0, lease_id uuid, lease_until timestamptz,
 last_operation text, result jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists sma_private.publication_provider_events_v1 (
 order_id uuid not null references sma_private.publication_provider_attempts_v1(order_id),
 sequence integer not null, request_id uuid not null unique, operation text not null check(operation in ('init','upload','probe','status')),
 outcome jsonb, created_at timestamptz not null default now(), finished_at timestamptz,
 primary key(order_id,sequence)
);
alter table sma_private.publication_provider_permissions_v1 enable row level security;
alter table sma_private.publication_provider_attempts_v1 enable row level security;
alter table sma_private.publication_provider_events_v1 enable row level security;
revoke all on sma_private.publication_provider_permissions_v1,sma_private.publication_provider_attempts_v1,sma_private.publication_provider_events_v1 from public,anon,authenticated,service_role;
grant select on sma_private.publication_provider_permissions_v1 to service_role;
grant select,insert,update on sma_private.publication_provider_attempts_v1,sma_private.publication_provider_events_v1 to service_role;

create or replace function sma_private.publication_provider_fingerprint_v1(j sma_private.publication_orders_v1)
returns text language sql immutable security invoker set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object('owner',j.user_id,'binding',j.binding,'draft',j.draft,'target',j.target,'choices',j.choices,'approved_at',j.approved_at,'review',j.approval_review)::text,'UTF8')),'hex');
$$;
revoke all on function sma_private.publication_provider_fingerprint_v1(sma_private.publication_orders_v1) from public,anon,authenticated;
grant execute on function sma_private.publication_provider_fingerprint_v1(sma_private.publication_orders_v1) to service_role;

create or replace function sma_private.publication_provider_session_valid_v1(p_platform text,u text)
returns boolean language sql immutable set search_path='' as $$
 -- No arbitrary hosts, ports, credentials, redirects, fragments or escaped path.
 select u is not null and octet_length(u) between 40 and 4000 and u !~ '[[:space:]\\#]' and
 case p_platform when 'youtube' then u ~ '^https://www\.googleapis\.com/upload/youtube/v3/videos\?[^#]*$' and u ~ '[?&]upload_id=[A-Za-z0-9_-]+' and u ~ '[?&]uploadType=resumable(&|$)'
 when 'tiktok' then u ~ '^https://(open-upload|upload\.us)\.tiktokapis\.com/(video|upload)/\?[A-Za-z0-9_=&.%-]+$'
 else false end;
$$;
revoke all on function sma_private.publication_provider_session_valid_v1(text,text) from public,anon,authenticated;
grant execute on function sma_private.publication_provider_session_valid_v1(text,text) to service_role;

create or replace function public.sma_publication_provider_v1(p_action text,p_id uuid,p_lease uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j sma_private.publication_orders_v1%rowtype;a sma_private.publication_provider_attempts_v1%rowtype;
 e sma_private.publication_provider_events_v1%rowtype;c public.sma_kunden%rowtype;r jsonb;m jsonb;fp text;op text;v_state text;receipt jsonb;sz bigint;ids jsonb;
begin
 if p_action is null or p_action not in ('context','begin','finish') or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>18000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into j from sma_private.publication_orders_v1 where id=p_id for update;
 if not found or j.binding->>'platform' not in ('youtube','tiktok') or j.binding->>'media_kind' is distinct from 'video' then return jsonb_build_object('ok',false,'code','ORDER_UNAVAILABLE');end if;
 select * into c from public.sma_kunden where id=j.customer_id and user_id=j.user_id;
 if not found or c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 select * into a from sma_private.publication_provider_attempts_v1 where order_id=p_id for update;
 fp:=sma_private.publication_provider_fingerprint_v1(j);
 if a.order_id is not null and fp is distinct from a.fingerprint then return jsonb_build_object('ok',false,'code','ORDER_CHANGED');end if;
 if p_action='context' then
  return jsonb_build_object('ok',true,'id',j.id,'binding',j.binding,'draft',j.draft,'choices',j.choices,'target',j.target,'n8n_kunde_id',c.n8n_kunde_id,'kunde_email',c.kunde_email,
   'attempt_state',a.state,'requires_file',(a.order_id is null or a.state='session_ready' or (a.platform='youtube' and a.last_operation='probe' and a.state='uploading' and a.lease_until is null)),'can_upload',false,'can_publish',false);
 end if;
 if p_action='finish' then
  -- A late response is useful until a newer claim supersedes it. Sequence +
  -- request UUID fence all writes; a timed-out response cannot replace a poll.
  if a.order_id is null or p_lease is null or a.lease_id is distinct from p_lease then return jsonb_build_object('ok',false,'code','INVALID_LEASE');end if;
  select * into e from sma_private.publication_provider_events_v1 where order_id=p_id and sequence=a.sequence for update;
  if e.request_id is distinct from p_lease or e.finished_at is not null then return jsonb_build_object('ok',false,'code','INVALID_LEASE');end if;
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('state','provider_id','session_url','session_expires_at','received_bytes','observation','code'))
   or coalesce(p_data->>'state','') not in ('session_ready','uploading','processing','complete','failed','uncertain','needs_review') then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
  v_state:=p_data->>'state';
  if (p_data?'code' and (jsonb_typeof(p_data->'code') is distinct from 'string' or p_data->>'code' !~ '^[A-Z][A-Z0-9_]{0,79}$'))
   or (p_data?'provider_id' and (jsonb_typeof(p_data->'provider_id') is distinct from 'string' or p_data->>'provider_id' !~ '^[A-Za-z0-9_.~:-]{1,64}$'))
   or (a.platform='youtube' and p_data?'provider_id' and p_data->>'provider_id' !~ '^[A-Za-z0-9_-]{11}$')
   or (a.provider_id is not null and p_data?'provider_id' and p_data->>'provider_id' is distinct from a.provider_id)
   then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
  if p_data?'session_url' then
   if e.operation<>'init' or not sma_private.publication_provider_session_valid_v1(a.platform,p_data->>'session_url') then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
  end if;
  if p_data?'session_expires_at' then
   if e.operation<>'init' or jsonb_typeof(p_data->'session_expires_at') is distinct from 'string' or p_data->>'session_expires_at' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
   if (p_data->>'session_expires_at')::timestamptz<=now() or (p_data->>'session_expires_at')::timestamptz>now()+interval '7 days' then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
  end if;
  if e.operation='init' and v_state not in ('session_ready','uncertain','failed') then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
  if v_state='session_ready' and (e.operation<>'init' or not(p_data ?& array['session_url','session_expires_at']) or (a.platform='tiktok' and not(p_data?'provider_id'))) then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
  if e.operation in ('upload','probe') and v_state not in ('uploading','processing','uncertain','needs_review') then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
  if e.operation='status' and v_state not in ('processing','complete','failed','uncertain','needs_review') then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
  if p_data?'received_bytes' then
   if e.operation not in ('upload','probe','status') or jsonb_typeof(p_data->'received_bytes') is distinct from 'number' or p_data->>'received_bytes' !~ '^[0-9]{1,8}$' then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
   sz:=(p_data->>'received_bytes')::bigint;
   if sz<a.received_bytes or sz>a.size_bytes then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
  end if;
  receipt:=p_data->'observation';
  if receipt is not null then
   if e.operation<>'status' or jsonb_typeof(receipt) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(receipt) k where k not in ('platform','target_id','provider_id','route','expected_visibility','state','upload_retry_allowed','can_upload','can_publish','code','visibility','publicly_available','public_post_ids','url'))
    or receipt->>'platform' is distinct from a.platform or receipt->>'target_id' is distinct from a.target_id or receipt->>'provider_id' is distinct from a.provider_id
    or receipt->>'route' is distinct from (case a.platform when 'youtube' then 'youtube_video' else 'direct_post' end)
    or receipt->>'expected_visibility' is distinct from a.visibility or receipt->>'state' is distinct from v_state
    or receipt->'upload_retry_allowed' is distinct from 'false'::jsonb or receipt->'can_upload' is distinct from 'false'::jsonb or receipt->'can_publish' is distinct from 'false'::jsonb
    then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
   if v_state='complete' then
    if not(receipt?'publicly_available') or receipt->'publicly_available' not in ('true'::jsonb,'false'::jsonb,'null'::jsonb) then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
    if a.platform='youtube' and (receipt->>'visibility' is distinct from a.visibility or receipt->>'url' is distinct from 'https://www.youtube.com/watch?v='||a.provider_id or receipt->'publicly_available' is distinct from to_jsonb(a.visibility='public')) then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
    if a.platform='tiktok' then
     if jsonb_typeof(receipt->'public_post_ids') is distinct from 'array' then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
     if jsonb_array_length(receipt->'public_post_ids')>20 or exists(select 1 from jsonb_array_elements(receipt->'public_post_ids') x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[1-9][0-9]{0,19}$') then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
     select coalesce(jsonb_agg(x order by x),'[]'::jsonb) into ids from (select distinct value x from jsonb_array_elements(coalesce(a.result->'public_post_ids','[]'::jsonb)||(receipt->'public_post_ids'))) s;
     if jsonb_array_length(ids)>0 and a.visibility<>'PUBLIC_TO_EVERYONE' then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
     receipt:=receipt||jsonb_build_object('public_post_ids',ids,'publicly_available',case when jsonb_array_length(ids)>0 then true when a.visibility='PUBLIC_TO_EVERYONE' then null else false end);
    end if;
   end if;
  end if;
  if v_state in ('complete','failed') and e.operation='status' and receipt is null then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
  if a.state in ('complete','failed') and v_state<>a.state then v_state:=a.state;receipt:=a.result;end if;
  update sma_private.publication_provider_attempts_v1 set state=v_state,provider_id=coalesce(p_data->>'provider_id',a.provider_id),
   session_url=coalesce(p_data->>'session_url',a.session_url),session_expires_at=coalesce((p_data->>'session_expires_at')::timestamptz,a.session_expires_at),
   received_bytes=coalesce(sz,a.received_bytes),result=coalesce(receipt,a.result),lease_until=null,updated_at=now() where order_id=p_id returning * into a;
  -- Never journal credential-bearing session URLs or raw HTTP responses.
  update sma_private.publication_provider_events_v1 set outcome=(p_data-'session_url'-'session_expires_at'),finished_at=now() where order_id=p_id and sequence=a.sequence;
  return jsonb_build_object('ok',true,'state',a.state,'sequence',a.sequence,'result',a.result,'can_upload',false,'can_publish',false);
 end if;
 -- BEGIN: each permitted HTTP request gets a durable, unique intent BEFORE send.
 if p_data->'target' is distinct from j.target or not sma_private.publication_account_valid_v1(p_data->'account_check',j.target,j.choices) then return jsonb_build_object('ok',false,'code','TARGET_PERMISSIONS_REQUIRED');end if;
 if a.lease_until>now() then return jsonb_build_object('ok',false,'code','PROVIDER_RUNNING');end if;
 if a.order_id is null then op:='init';
 elsif a.state='failed' then return jsonb_build_object('ok',true,'state','failed','can_upload',false,'can_publish',false);
 elsif a.provider_id is not null and a.state<>'session_ready' then op:='status';
 elsif a.last_operation='init' and a.session_url is null then return jsonb_build_object('ok',false,'code','PROVIDER_INIT_UNCERTAIN');
 elsif a.state='session_ready' then op:='upload';
 elsif a.session_url is not null and a.platform='youtube' then op:='probe';
 else return jsonb_build_object('ok',false,'code','PROVIDER_RECONCILIATION_REQUIRED');end if;
 -- Only a completed probe can authorize an exact YouTube remainder. Lost upload
 -- responses always select probe/status first, never another init.
 if a.platform='youtube' and a.last_operation='probe' and a.state='uploading' and a.lease_until is null then op:='upload';end if;
 if op in ('upload','probe') and a.session_expires_at<=now() then return jsonb_build_object('ok',false,'code','PROVIDER_SESSION_EXPIRED');end if;
 if op in ('init','upload') then
  if j.approved_at is null or sma_private.publication_order_review_valid_v1(j.approval_review,j.binding->>'platform',j.choices) is not true then return jsonb_build_object('ok',false,'code','FINAL_APPROVAL_REQUIRED');end if;
  if not exists(select 1 from sma_private.publication_journal_v1 where order_id=j.id and customer_id=j.customer_id and asset_id=(j.binding->>'asset_id')::uuid and asset_revision=j.binding->>'asset_revision' and platform=j.binding->>'platform' and target_id=j.target->>'id') then return jsonb_build_object('ok',false,'code','PUBLICATION_RESERVATION_REQUIRED');end if;
  if not exists(select 1 from sma_private.publication_provider_permissions_v1 where order_id=j.id and fingerprint=fp and expires_at>now()) then return jsonb_build_object('ok',false,'code','UPLOAD_TEST_APPROVAL_REQUIRED');end if;
  r:=sma_private.publication_order_current_v1(j);if r->'ok' is distinct from 'true'::jsonb then return r;end if;
  m:=sma_private.publication_order_media_v1(j,r->'media_check',p_data->'account_check');
  if j.state<>'checked' or j.blockers<>'[]'::jsonb or jsonb_typeof(m->'checks') is distinct from 'array' then return jsonb_build_object('ok',false,'code','MEDIA_REVIEW_REQUIRED');end if;
  if not(m->'checks' @> '[{"code":"PORTAL_TEXT_COMPARISON","status":"pass"}]'::jsonb) or jsonb_array_length(m->'checks')=0 or exists(select 1 from jsonb_array_elements(m->'checks') x where x->>'code' is distinct from 'PUBLICATION_APPROVAL_PENDING' and x->>'status' is distinct from 'pass') then return jsonb_build_object('ok',false,'code','MEDIA_REVIEW_REQUIRED');end if;
  if p_data->'drive_verified' is distinct from 'true'::jsonb or p_data->'text_verified' is distinct from 'true'::jsonb then return jsonb_build_object('ok',false,'code','FILE_CHANGED');end if;
  select size_bytes into sz from sma_private.publication_files_v1 where id=(j.binding->>'asset_id')::uuid and revision=j.binding->>'asset_revision' and customer_id=j.customer_id and user_id=j.user_id and mime_type='video/mp4';
  if sz is null or sz not between 1 and 24000000 or p_data->'size_bytes' is distinct from to_jsonb(sz) then return jsonb_build_object('ok',false,'code','FILE_CHANGED');end if;
  if a.order_id is null then
   insert into sma_private.publication_provider_attempts_v1(order_id,fingerprint,platform,target_id,visibility,size_bytes) values(j.id,fp,j.binding->>'platform',j.target->>'id',j.choices->>'visibility',sz) returning * into a;
  end if;
 end if;
 if op='status' and a.updated_at>now()-interval '10 seconds' then return jsonb_build_object('ok',false,'code','PROVIDER_POLL_WAIT');end if;
 update sma_private.publication_provider_attempts_v1 set state=case when op='upload' then 'uploading' else state end,sequence=sequence+1,lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes',last_operation=op,updated_at=now() where order_id=p_id returning * into a;
 insert into sma_private.publication_provider_events_v1(order_id,sequence,request_id,operation) values(p_id,a.sequence,a.lease_id,op);
 return jsonb_build_object('ok',true,'id',j.id,'lease_id',a.lease_id,'sequence',a.sequence,'operation',op,'platform',a.platform,'target_id',a.target_id,'visibility',a.visibility,'provider_id',a.provider_id,
  'size_bytes',a.size_bytes,'received_bytes',a.received_bytes,'session_url',a.session_url,'session_expires_at',a.session_expires_at,'binding',j.binding,'draft',j.draft,'choices',j.choices,'can_upload',false,'can_publish',false);
end $$;
revoke all on function public.sma_publication_provider_v1(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sma_publication_provider_v1(text,uuid,uuid,jsonb) to service_role;
