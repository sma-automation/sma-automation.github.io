-- Run after wordpress-tickets.sql. One durable product-draft intent per connection.
-- Old attempts remain recorded but are inaccessible after connection/owner changes.
create table sma_private.wordpress_sync_jobs_v1 (
 attempt_id uuid primary key,
 customer_id bigint not null references public.sma_kunden(id),user_id uuid not null,
 website_url text not null,shop_slug text not null,request_id uuid not null unique default gen_random_uuid(),
 state text not null check(state in ('pending','running','succeeded','blocked')),
 expected_revision integer check(expected_revision>=0 and expected_revision<2147483647),
 previous_post_id bigint check(previous_post_id>0 and previous_post_id<=9007199254740991),
 post_id bigint check(post_id>0 and post_id<=9007199254740991),result_revision integer,
 lease_id uuid,lease_until timestamptz,next_retry_at timestamptz,
 dispatch_started_at timestamptz,completed_at timestamptz,last_error text,
 tries integer not null default 0,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create index wordpress_sync_jobs_customer_idx on sma_private.wordpress_sync_jobs_v1(customer_id);
alter table sma_private.wordpress_sync_jobs_v1 enable row level security;
revoke all on sma_private.wordpress_sync_jobs_v1 from public,anon,authenticated,service_role;

create function sma_private.wordpress_sync_job_v1(p_user_id uuid,p_attempt_id uuid,p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb;c sma_private.website_provider_connections_v1%rowtype;k public.sma_kunden%rowtype;
 j sma_private.wordpress_sync_jobs_v1%rowtype;proof jsonb;rev integer;pid bigint;lease uuid;code text;
begin
 if p_action is null or p_action not in ('status','claim','dispatch','complete','retry','block') then return jsonb_build_object('ok',false,'code','INVALID_ACTION');end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>2048 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 -- Keep the existing lock order: customer -> preparation -> request -> connection -> job.
 b:=sma_private.website_provider_binding_v1(p_user_id);
 if b->>'ok'<>'true' then return b;end if;
 if p_attempt_id is null or (b->>'attempt_id')::uuid<>p_attempt_id or b->>'provider'<>'wordpress' then return jsonb_build_object('ok',false,'code','REQUEST_STALE');end if;
 select * into c from sma_private.website_provider_connections_v1 where customer_id=(b->>'customer_id')::bigint for update;
 if c.user_id is distinct from p_user_id or c.attempt_id is distinct from p_attempt_id or c.website_url is distinct from b->>'website_url'
  or c.preparation_revision is distinct from (b->>'preparation_revision')::integer or c.provider_site_id is distinct from 'wordpress-bridge:'||p_attempt_id::text
  or not exists(select 1 from vault.secrets where id=c.secret_id)
 then return jsonb_build_object('ok',false,'code','NOT_CONNECTED');end if;
 select * into k from public.sma_kunden where id=c.customer_id;
 if k.shop_oeffentlich is not true or k.shop_slug is null or length(k.shop_slug)>63 or k.shop_slug!~'^[a-z0-9]+(-[a-z0-9]+)*$'
 then return jsonb_build_object('ok',false,'code','SHOP_REQUIRED');end if;
 select * into j from sma_private.wordpress_sync_jobs_v1 where attempt_id=p_attempt_id for update;
 if j.attempt_id is not null and (j.customer_id<>c.customer_id or j.user_id<>p_user_id or j.website_url<>c.website_url or j.shop_slug<>k.shop_slug)
 then return jsonb_build_object('ok',false,'code','REQUEST_STALE');end if;
 if p_action in ('status','claim') then
  if p_input<>'{}'::jsonb then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  if p_action='claim' and coalesce(j.state,'pending') not in ('succeeded','blocked') then
   if j.lease_until>clock_timestamp() or j.next_retry_at>clock_timestamp() then return jsonb_build_object('ok',false,'code','SYNC_BUSY');end if;
   insert into sma_private.wordpress_sync_jobs_v1(attempt_id,customer_id,user_id,website_url,shop_slug,state,lease_id,lease_until,tries)
   values(p_attempt_id,c.customer_id,p_user_id,c.website_url,k.shop_slug,'running',gen_random_uuid(),clock_timestamp()+interval '2 minutes',1)
   on conflict(attempt_id) do update set state='running',lease_id=excluded.lease_id,lease_until=excluded.lease_until,next_retry_at=null,tries=wordpress_sync_jobs_v1.tries+1,updated_at=clock_timestamp()
   returning * into j;
  end if;
 else
  if jsonb_typeof(p_input->'lease_id') is distinct from 'string' or p_input->>'lease_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   or exists(select 1 from jsonb_object_keys(p_input) x where x not in ('lease_id','proof','code'))
   or (p_action in ('retry','block')) is distinct from (p_input ? 'code')
   or (p_action in ('dispatch','complete')) is distinct from (p_input ? 'proof')
  then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  lease:=(p_input->>'lease_id')::uuid;
  if j.attempt_id is null or j.lease_id is distinct from lease then return jsonb_build_object('ok',false,'code','LEASE_STALE');end if;
  -- The exact successful completion may be repeated after a lost database reply.
  if p_action='complete' and j.state='succeeded' then
   if p_input->'proof' is distinct from jsonb_build_object('revision',j.result_revision,'post_id',j.post_id) then return jsonb_build_object('ok',false,'code','RESULT_CONFLICT');end if;
  else
   if j.state<>'running' or j.lease_until<=clock_timestamp() then return jsonb_build_object('ok',false,'code','LEASE_STALE');end if;
   if p_action in ('dispatch','complete') then
    proof:=p_input->'proof';
    -- A resume uses the persisted expected revision, never a fresh inspect baseline.
    if p_action='dispatch' and proof='null'::jsonb then
     if j.expected_revision is null then return jsonb_build_object('ok',false,'code','BASELINE_REQUIRED');end if;
    else
     if jsonb_typeof(proof) is distinct from 'object' or not(proof ?& array['revision','post_id'])
      or (select count(*) from jsonb_object_keys(proof))<>2
      or jsonb_typeof(proof->'revision') is distinct from 'number' or proof->>'revision' !~ '^[0-9]{1,10}$'
     then return jsonb_build_object('ok',false,'code','INVALID_PROOF');end if;
     if (proof->>'revision')::numeric>2147483647 then return jsonb_build_object('ok',false,'code','INVALID_PROOF');end if;
     rev:=(proof->>'revision')::integer;
     if rev=0 then
      if proof->'post_id'<>'null'::jsonb then return jsonb_build_object('ok',false,'code','INVALID_PROOF');end if;pid:=null;
     else
      if jsonb_typeof(proof->'post_id') is distinct from 'number' or proof->>'post_id' !~ '^[1-9][0-9]{0,15}$' then return jsonb_build_object('ok',false,'code','INVALID_PROOF');end if;
      if (proof->>'post_id')::numeric>9007199254740991 then return jsonb_build_object('ok',false,'code','INVALID_PROOF');end if;
      pid:=(proof->>'post_id')::bigint;
     end if;
     if p_action='dispatch' then
      if rev>=2147483647 then return jsonb_build_object('ok',false,'code','INVALID_PROOF');end if;
      if j.expected_revision is not null and (j.expected_revision<>rev or j.previous_post_id is distinct from pid) then return jsonb_build_object('ok',false,'code','RESULT_CONFLICT');end if;
      update sma_private.wordpress_sync_jobs_v1 set expected_revision=rev,previous_post_id=pid where attempt_id=p_attempt_id returning * into j;
     else
      if j.dispatch_started_at is null or j.expected_revision is null or rev<>j.expected_revision+1 or pid is null
       or (j.previous_post_id is not null and pid<>j.previous_post_id) then return jsonb_build_object('ok',false,'code','RESULT_CONFLICT');end if;
      update sma_private.wordpress_sync_jobs_v1 set state='succeeded',result_revision=rev,post_id=pid,completed_at=clock_timestamp(),lease_until=null,last_error=null,updated_at=clock_timestamp() where attempt_id=p_attempt_id returning * into j;
     end if;
    end if;
    if p_action='dispatch' then
     update sma_private.wordpress_sync_jobs_v1 set dispatch_started_at=coalesce(dispatch_started_at,clock_timestamp()),updated_at=clock_timestamp() where attempt_id=p_attempt_id returning * into j;
    end if;
   else
    code:=p_input->>'code';
    if jsonb_typeof(p_input->'code') is distinct from 'string' or code not in ('PROVIDER_UNAVAILABLE','TARGET_REJECTED','PAGE_CHANGED','REVISION_CONFLICT','REQUEST_CONFLICT','WEBSITE_CHANGED','ACCESS_REVOKED','NOT_CONNECTED','TRANSACTION_REQUIRED','CONTENT_FILTERED','INVALID_PROVIDER_RESULT')
     or (p_action='retry' and code<>'PROVIDER_UNAVAILABLE') then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
    update sma_private.wordpress_sync_jobs_v1 set state=case when p_action='retry' then 'pending' else 'blocked' end,last_error=code,lease_id=null,lease_until=null,
     next_retry_at=case when p_action='retry' then clock_timestamp()+interval '15 seconds' end,updated_at=clock_timestamp() where attempt_id=p_attempt_id returning * into j;
   end if;
  end if;
 end if;
 return jsonb_build_object('ok',true,'attempt_id',p_attempt_id,'website_url',c.website_url,'shop_slug',k.shop_slug,
  'state',case when j.attempt_id is null then 'idle' when j.state='succeeded' then 'draft' when j.state='blocked' then 'blocked' when j.lease_until>clock_timestamp() then 'running' else 'retry' end,
  'request_id',j.request_id,'lease_id',case when p_action in ('claim','dispatch') and j.state='running' then j.lease_id end,
  'expected_revision',j.expected_revision,'previous_post_id',j.previous_post_id,'post_id',j.post_id,'revision',j.result_revision,
  'completed_at',j.completed_at,'last_error',j.last_error,'retry_after',ceil(extract(epoch from greatest(j.lease_until,j.next_retry_at)))::bigint,
  'can_publish',false);
end $$;
revoke all on function sma_private.wordpress_sync_job_v1(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function sma_private.wordpress_sync_job_v1(uuid,uuid,text,jsonb) to service_role;
create function public.sma_wordpress_sync_job_v1(p_user_id uuid,p_attempt_id uuid,p_action text,p_input jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select sma_private.wordpress_sync_job_v1(p_user_id,p_attempt_id,p_action,p_input)$$;
revoke all on function public.sma_wordpress_sync_job_v1(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_wordpress_sync_job_v1(uuid,uuid,text,jsonb) to service_role;
