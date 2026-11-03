-- Immutable, owner-bound publication orders. Additive; no provider credentials.
create table if not exists sma_private.publication_orders_v1 (
 id uuid primary key, user_id uuid not null, customer_id bigint not null references public.sma_kunden(id),
 binding jsonb not null, draft jsonb not null, choices jsonb not null,
 target jsonb, approval_token uuid not null default gen_random_uuid(), approved_at timestamptz,
 state text not null default 'preparing' check(state in ('preparing','prepared','approved','checking','blocked','checked','cancelled')),
 lease_id uuid, lease_until timestamptz, blockers jsonb not null default '[]',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table sma_private.publication_orders_v1 add column if not exists account_check jsonb;
create index if not exists publication_orders_owner_v1 on sma_private.publication_orders_v1(user_id,created_at desc);
-- One approved order per file revision, portal and actual target, even if the text
-- or client-generated request ID changes. A timeout never releases this key.
create table if not exists sma_private.publication_journal_v1 (
 customer_id bigint not null references public.sma_kunden(id), asset_id uuid not null,
 asset_revision text not null, platform text not null, target_id text not null,
 order_id uuid not null unique references sma_private.publication_orders_v1(id),
 created_at timestamptz not null default now(),
 primary key(customer_id,asset_id,asset_revision,platform,target_id)
);
alter table sma_private.publication_orders_v1 enable row level security;
alter table sma_private.publication_journal_v1 enable row level security;
revoke all on sma_private.publication_orders_v1,sma_private.publication_journal_v1 from public,anon,authenticated;
grant select,insert,update on sma_private.publication_orders_v1 to service_role;
grant select,insert on sma_private.publication_journal_v1 to service_role;

create or replace function sma_private.publication_order_view_v1(j sma_private.publication_orders_v1)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('ok',true,'id',j.id,'state',j.state,'binding',j.binding - 'customer_id' - 'drive_file_id',
 'draft',j.draft,'choices',j.choices,'target',j.target - 'source_revision','approval_token',case when j.state='prepared' then j.approval_token else null end,
 'account_check',j.account_check - 'target_revision','approved_at',j.approved_at,'blockers',j.blockers,'can_upload',false,'can_publish',false);
$$;
revoke all on function sma_private.publication_order_view_v1(sma_private.publication_orders_v1) from public,anon,authenticated;
grant execute on function sma_private.publication_order_view_v1(sma_private.publication_orders_v1) to service_role;

-- Recheck the immutable selection against the authoritative assignment on every
-- transition. This is intentionally separate from the worker's own Drive read.
create or replace function sma_private.publication_order_current_v1(j sma_private.publication_orders_v1)
returns jsonb language plpgsql stable set search_path='' as $$
declare r jsonb; b jsonb:=j.binding; k text;
begin
 if not exists(select 1 from public.sma_kunden where id=j.customer_id and user_id=j.user_id and aktiv and (demo_delta_aktiv or zahlung_bestaetigt)) then
  return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 r:=public.sma_publication_assignment_v1(j.customer_id,b->>'drive_file_id',b->>'asset_revision',b->>'platform');
 if r->'ok' is distinct from 'true'::jsonb then return r;end if;
 foreach k in array array['asset_id','asset_revision','platform','assignment_revision','preview_id','preview_revision','shop_url','media_kind'] loop
  if r->k is distinct from b->k then return jsonb_build_object('ok',false,'code','ORDER_CHANGED');end if;
 end loop;
 if r->'text' is distinct from j.draft then return jsonb_build_object('ok',false,'code','ORDER_CHANGED');end if;
 if (r->'media_check'->>'verified_at')::timestamptz<=now()-interval '15 minutes' or
    (r->'media_check'->>'verified_at')::timestamptz>now()+interval '1 minute' then
  return jsonb_build_object('ok',false,'code','FILE_REFRESH_REQUIRED');end if;
 return r;
end $$;
revoke all on function sma_private.publication_order_current_v1(sma_private.publication_orders_v1) from public,anon,authenticated;
grant execute on function sma_private.publication_order_current_v1(sma_private.publication_orders_v1) to service_role;

create or replace function sma_private.publication_order_request_v1(p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();c public.sma_kunden%rowtype;j sma_private.publication_orders_v1%rowtype;
 f sma_private.publication_files_v1%rowtype;a sma_private.publication_assignments_v1%rowtype;r jsonb;b jsonb;ch jsonb;other_id uuid;v_id uuid;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_action is null or p_action not in ('prepare','get','approve') or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>8000
 or coalesce(p_input->>'id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('id','asset_id','asset_revision','platform','assignment_revision','preview_id','preview_revision','choices','approval_token','confirm')) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if (select count(*) from public.sma_kunden where user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end if;
 select * into c from public.sma_kunden where user_id=uid for share;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 v_id:=(p_input->>'id')::uuid;
 -- Serialize a customer's order creation and approvals, including distinct UUIDs.
 perform pg_advisory_xact_lock(741604,(c.id % 2147483647)::integer);
 select * into j from sma_private.publication_orders_v1 where id=v_id for update;
 if found and (j.user_id<>uid or j.customer_id<>c.id) then return jsonb_build_object('ok',false,'code','ORDER_UNAVAILABLE');end if;
 if p_action='get' then
  if j.id is null then return jsonb_build_object('ok',false,'code','ORDER_UNAVAILABLE');end if;
  return sma_private.publication_order_view_v1(j);
 end if;
 if p_action='approve' then
  if j.id is null then return jsonb_build_object('ok',false,'code','ORDER_UNAVAILABLE');end if;
  if p_input->'confirm' is distinct from 'true'::jsonb or p_input->>'approval_token' is distinct from j.approval_token::text then return jsonb_build_object('ok',false,'code','FINAL_APPROVAL_REQUIRED');end if;
  if j.approved_at is not null then return sma_private.publication_order_view_v1(j);end if;
  if j.state<>'prepared' or j.target is null or j.created_at<now()-interval '30 minutes' then return jsonb_build_object('ok',false,'code','ORDER_NOT_PREPARED');end if;
  if j.binding->>'platform' in ('youtube','tiktok') and not sma_private.publication_account_valid_v1(j.account_check,j.target,j.choices) then return jsonb_build_object('ok',false,'code','TARGET_OPTIONS_CHANGED');end if;
  r:=sma_private.publication_order_current_v1(j);if r->'ok' is distinct from 'true'::jsonb then return r;end if;
  insert into sma_private.publication_journal_v1(customer_id,asset_id,asset_revision,platform,target_id,order_id)
  values(c.id,(j.binding->>'asset_id')::uuid,j.binding->>'asset_revision',j.binding->>'platform',j.target->>'id',j.id) on conflict do nothing;
  select order_id into other_id from sma_private.publication_journal_v1 where customer_id=c.id and asset_id=(j.binding->>'asset_id')::uuid and asset_revision=j.binding->>'asset_revision' and platform=j.binding->>'platform' and target_id=j.target->>'id';
  if other_id is distinct from j.id then return jsonb_build_object('ok',false,'code','DUPLICATE_PUBLICATION','existing_order_id',other_id);end if;
  update sma_private.publication_orders_v1 set approved_at=now(),state='approved',updated_at=now() where id=j.id returning * into j;
  return sma_private.publication_order_view_v1(j);
 end if;
 if coalesce(p_input->>'asset_id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or coalesce(p_input->>'platform','') not in ('youtube','instagram','facebook','tiktok') then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 ch:=p_input->'choices';
 if jsonb_typeof(ch) is distinct from 'object' or coalesce(ch->>'visibility','') not in ('private','public','unlisted','SELF_ONLY','PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR')
 or exists(select 1 from jsonb_object_keys(ch) k where k not in ('visibility','made_for_kids','contains_synthetic_media','disable_comment','disable_duet','disable_stitch','brand_content_toggle','brand_organic_toggle'))
 or exists(select 1 from jsonb_each(ch) e where e.key<>'visibility' and jsonb_typeof(e.value)<>'boolean') then return jsonb_build_object('ok',false,'code','INVALID_CHOICES');end if;
 if (p_input->>'platform'='youtube' and (ch->>'visibility' not in ('private','public','unlisted') or not(ch ?& array['made_for_kids','contains_synthetic_media'])))
 or (p_input->>'platform' in ('instagram','facebook') and ch->>'visibility'<>'public')
 or (p_input->>'platform'='tiktok' and (ch->>'visibility' not in ('SELF_ONLY','PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR') or not(ch ?& array['disable_comment','disable_duet','disable_stitch','brand_content_toggle','brand_organic_toggle']))) then return jsonb_build_object('ok',false,'code','INVALID_CHOICES');end if;
 if j.id is not null then
  if exists(select 1 from jsonb_each(p_input - 'id' - 'choices') e where j.binding->e.key is distinct from e.value) or ch is distinct from j.choices then return jsonb_build_object('ok',false,'code','REQUEST_CONFLICT');end if;
  return sma_private.publication_order_view_v1(j);
 end if;
 select * into f from sma_private.publication_files_v1 where id=(p_input->>'asset_id')::uuid and user_id=uid and customer_id=c.id for share;
 if not found or not f.available then return jsonb_build_object('ok',false,'code','FILE_UNAVAILABLE');end if;
 select * into a from sma_private.publication_assignments_v1 where asset_id=f.id and platform=p_input->>'platform' for share;
 if not found then return jsonb_build_object('ok',false,'code','ASSIGNMENT_UNAVAILABLE');end if;
 if p_input->>'asset_revision' is distinct from f.revision or p_input->'assignment_revision' is distinct from to_jsonb(a.revision) or p_input->>'preview_id' is distinct from a.preview_id::text or p_input->'preview_revision' is distinct from to_jsonb(a.preview_revision) then return jsonb_build_object('ok',false,'code','ORDER_CHANGED');end if;
 if (select count(*) from sma_private.publication_orders_v1 where user_id=uid and created_at>now()-interval '1 hour')>=30 then return jsonb_build_object('ok',false,'code','ORDER_RATE_LIMITED');end if;
 r:=public.sma_publication_assignment_v1(c.id,f.drive_file_id,f.revision,a.platform);if r->'ok' is distinct from 'true'::jsonb then return r;end if;
 b:=jsonb_build_object('version',1,'customer_id',c.id,'drive_file_id',f.drive_file_id,'asset_id',f.id,'asset_revision',f.revision,'platform',a.platform,'assignment_revision',a.revision,'preview_id',a.preview_id,'preview_revision',a.preview_revision,'shop_url',r->>'shop_url','media_kind',f.media_kind);
 j.user_id:=uid;j.customer_id:=c.id;j.binding:=b;j.draft:=a.draft;
 r:=sma_private.publication_order_current_v1(j);if r->'ok' is distinct from 'true'::jsonb then return r;end if;
 insert into sma_private.publication_orders_v1(id,user_id,customer_id,binding,draft,choices) values(v_id,uid,c.id,b,a.draft,ch) returning * into j;
 return sma_private.publication_order_view_v1(j);
end $$;
revoke all on function sma_private.publication_order_request_v1(text,jsonb) from public,anon;
grant execute on function sma_private.publication_order_request_v1(text,jsonb) to authenticated;
create or replace function public.sma_publication_order_v1(p_action text,p_input jsonb)
returns jsonb language sql security invoker set search_path='' as $$select sma_private.publication_order_request_v1(p_action,p_input);$$;
revoke all on function public.sma_publication_order_v1(text,jsonb) from public,anon;
grant execute on function public.sma_publication_order_v1(text,jsonb) to authenticated;

-- Only n8n's existing service credential can read the server binding, bind the
-- account from SMA_Kunden, claim a check, or record its result.
create or replace function public.sma_publication_order_worker_v1(p_action text,p_id uuid,p_lease uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j sma_private.publication_orders_v1%rowtype;c public.sma_kunden%rowtype;r jsonb;blocks jsonb;v_target jsonb;
begin
 select * into j from sma_private.publication_orders_v1 where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'code','ORDER_UNAVAILABLE');end if;
 select * into c from public.sma_kunden where id=j.customer_id and user_id=j.user_id;
 r:=sma_private.publication_order_current_v1(j);if r->'ok' is distinct from 'true'::jsonb then return r;end if;
 if p_action='context' then
  return jsonb_build_object('ok',true,'id',j.id,'binding',j.binding,'choices',j.choices,'target',j.target,'state',j.state,'n8n_kunde_id',c.n8n_kunde_id,'kunde_email',c.kunde_email);
 elsif p_action='bind_target' then
  v_target:=p_data->'target';
  if jsonb_typeof(v_target) is distinct from 'object' or v_target->>'platform' is distinct from j.binding->>'platform'
   or coalesce(v_target->>'id','')!~'^[A-Za-z0-9_-]{3,200}$' or char_length(coalesce(v_target->>'name','')) not between 1 and 200
   or coalesce(v_target->>'source_revision','')!~'^[a-f0-9]{64}$'
   or exists(select 1 from jsonb_object_keys(v_target) k where k not in ('platform','id','name','source_revision')) then return jsonb_build_object('ok',false,'code','TARGET_ACCOUNT_REQUIRED');end if;
  if j.binding->>'platform' in ('youtube','tiktok') and not sma_private.publication_account_valid_v1(p_data->'account_check',v_target,j.choices) then return jsonb_build_object('ok',false,'code','TARGET_PERMISSIONS_REQUIRED');end if;
  if j.state='prepared' and j.target=v_target then return sma_private.publication_order_view_v1(j);end if;
  if j.state<>'preparing' then return jsonb_build_object('ok',false,'code','ORDER_CHANGED');end if;
  update sma_private.publication_orders_v1 set target=v_target,account_check=case when j.binding->>'platform' in ('youtube','tiktok') then p_data->'account_check' else null end,state='prepared',updated_at=now() where id=j.id returning * into j;
  return sma_private.publication_order_view_v1(j);
 elsif p_action='claim' then
  if j.approved_at is null then return jsonb_build_object('ok',false,'code','FINAL_APPROVAL_REQUIRED');end if;
  if j.state='checking' and j.lease_until>now() then return jsonb_build_object('ok',false,'code','ORDER_RUNNING');end if;
  if j.state not in ('approved','blocked','checking') then return jsonb_build_object('ok',false,'code','ORDER_NOT_READY');end if;
  update sma_private.publication_orders_v1 set state='checking',lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes',updated_at=now() where id=j.id returning * into j;
  return jsonb_build_object('ok',true,'id',j.id,'lease_id',j.lease_id,'binding',j.binding,'choices',j.choices,'target',j.target,'n8n_kunde_id',c.n8n_kunde_id,'kunde_email',c.kunde_email);
 elsif p_action='finish_check' then
  if p_lease is null or j.lease_id is distinct from p_lease or j.state<>'checking' or j.lease_until<=now() then return jsonb_build_object('ok',false,'code','INVALID_LEASE');end if;
  -- The database independently retains every unresolved media/content check.
  select coalesce(jsonb_agg(x->>'code'),'[]') into blocks from jsonb_array_elements(r->'media_check'->'checks') x where x->>'status'<>'pass' and x->>'code'<>'PUBLICATION_APPROVAL_PENDING';
  if jsonb_typeof(p_data->'blockers') is distinct from 'array' or jsonb_array_length(p_data->'blockers')>30 or exists(select 1 from jsonb_array_elements(p_data->'blockers') x where jsonb_typeof(x)<>'string' or (x#>>'{}')!~'^[A-Z][A-Z0-9_]{0,79}$') then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
  blocks:=blocks||(p_data->'blockers');
  if p_data->'target' is distinct from j.target then blocks:=blocks||'"TARGET_ACCOUNT_CHANGED"'::jsonb;end if;
  if p_data->'drive_verified' is distinct from 'true'::jsonb then blocks:=blocks||'"DRIVE_RECHECK_REQUIRED"'::jsonb;end if;
  if p_data->'text_verified' is distinct from 'true'::jsonb then blocks:=blocks||'"SAVED_TEXT_INVALID"'::jsonb;end if;
  if not sma_private.publication_account_valid_v1(p_data->'account_check',j.target,j.choices) then blocks:=blocks||'"TARGET_PERMISSIONS_REQUIRED"'::jsonb;end if;
  if j.binding->>'platform'='tiktok' and sma_private.publication_account_valid_v1(p_data->'account_check',j.target,j.choices) and exists(select 1 from sma_private.publication_files_v1 where id=(j.binding->>'asset_id')::uuid and (duration_ms is null or duration_ms>(p_data->'account_check'->'policy'->>'max_duration_sec')::bigint*1000)) then blocks:=blocks||'"TARGET_DURATION_EXCEEDED"'::jsonb;end if;
  select coalesce(jsonb_agg(x order by x),'[]') into blocks from (select distinct value x from jsonb_array_elements(blocks)) s;
  update sma_private.publication_orders_v1 set state=case when jsonb_array_length(blocks)>0 then 'blocked' else 'checked' end,blockers=blocks,lease_id=null,lease_until=null,updated_at=now() where id=j.id returning * into j;
  return sma_private.publication_order_view_v1(j);
 end if;
 return jsonb_build_object('ok',false,'code','INVALID_ACTION');
end $$;
revoke all on function public.sma_publication_order_worker_v1(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sma_publication_order_worker_v1(text,uuid,uuid,jsonb) to service_role;
