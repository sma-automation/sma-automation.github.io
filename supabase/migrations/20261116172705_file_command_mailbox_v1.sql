-- PREPARATION ONLY. No cron, network request, provider permission or new workflow.
-- Requires the installed publication/upload/Magic/preview/account/order SQL.
-- A file's absolute 24-hour candidate lifetime never grows on join or resume.
create table sma_private.file_jobs_v1 (
 id uuid primary key, user_id uuid not null, customer_id bigint not null references public.sma_kunden(id),
 anchor jsonb not null, anchor_key text not null,
 upload_id uuid references sma_private.publication_uploads_v1(id),
 asset_id uuid references sma_private.publication_files_v1(id), asset_revision text,
 initial_reservation jsonb,
 state text not null default 'queued' check(state in ('queued','running','waiting','uncertain','finished','expired')),
 execution_id text unique, start_ticket text, start_claimed_at timestamptz,
 phase_seq integer not null default 0 check(phase_seq between 0 and 64),
 resume_url text, resume_ticket text, delivery_lease uuid, delivery_until timestamptz,
 created_at timestamptz not null default now(), deadline_at timestamptz not null default now()+interval '24 hours',
 check(deadline_at=created_at+interval '24 hours'),
 check(execution_id is null or execution_id ~ '^[A-Za-z0-9_-]{1,80}$'),
 check(upload_id is not null or asset_id is not null)
);
create unique index file_jobs_active_anchor_v1 on sma_private.file_jobs_v1(user_id,anchor_key)
 where state in ('queued','running','waiting','uncertain');
create unique index file_jobs_active_asset_v1 on sma_private.file_jobs_v1(user_id,asset_id,asset_revision)
 where asset_id is not null and state in ('queued','running','waiting','uncertain');

create table sma_private.file_job_requests_v1 (
 user_id uuid not null, request_id uuid not null, input_hash text not null,
 job_id uuid not null references sma_private.file_jobs_v1(id), primary key(user_id,request_id)
);
create table sma_private.file_commands_v1 (
 id uuid primary key, job_id uuid not null references sma_private.file_jobs_v1(id), command_seq integer not null,
 operation text not null check(operation in ('upload_start','upload_finish','magic_photo','magic_video','review','preview_prepare','account','order_prepare','order_approve')),
 input jsonb not null, input_hash text not null,
 state text not null default 'queued' check(state in ('queued','offered','accepted','running','completed','failed','uncertain')),
 phase_seq integer, ticket_hash text, accepted_execution_id text, accepted_at timestamptz,
 command_ticket text, child_execution_id text, operation_deadline timestamptz,
 reservation jsonb, response_status integer, response_body jsonb, error_code text,
 created_at timestamptz not null default now(), completed_at timestamptz,
 unique(job_id,command_seq),
 check(command_seq between 1 and 64),
 check(child_execution_id is null or child_execution_id ~ '^[A-Za-z0-9_-]{1,80}$')
);
create index file_commands_pending_v1 on sma_private.file_commands_v1(job_id,command_seq)
 where state in ('queued','offered','accepted','running','uncertain');
create table sma_private.file_command_requests_v1 (
 id uuid primary key, job_id uuid not null references sma_private.file_jobs_v1(id),
 command_id uuid not null references sma_private.file_commands_v1(id), input_hash text not null
);
alter table sma_private.file_jobs_v1 enable row level security;
alter table sma_private.file_job_requests_v1 enable row level security;
alter table sma_private.file_commands_v1 enable row level security;
alter table sma_private.file_command_requests_v1 enable row level security;
revoke all on sma_private.file_jobs_v1,sma_private.file_job_requests_v1,sma_private.file_commands_v1,sma_private.file_command_requests_v1
 from public,anon,authenticated,service_role;

create function sma_private.file_job_current_v1(j sma_private.file_jobs_v1) returns boolean
language plpgsql security definer set search_path='' as $$
declare old_sub text:=current_setting('request.jwt.claim.sub',true);r jsonb;
begin
 if j.asset_id is not null then
  perform set_config('request.jwt.claim.sub',j.user_id::text,true);
  r:=sma_private.publication_asset_preview_v1(j.asset_id,j.asset_revision);
  perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
  return r->'ok'='true'::jsonb and exists(select 1 from sma_private.publication_files_v1 f
   where f.id=j.asset_id and f.user_id=j.user_id and f.customer_id=j.customer_id);
 end if;
 -- Upload has no asset yet. These are exactly the existing upload request's
 -- owner/access/identity gates, without its side-effecting lease renewal.
 return exists(select 1 from sma_private.publication_uploads_v1 u join public.sma_kunden c on c.id=u.customer_id
  where u.id=j.upload_id and u.user_id=j.user_id and c.user_id=j.user_id and c.id=j.customer_id
   and c.aktiv is true and (c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true)
   and c.n8n_kunde_id is not null and c.kunde_email is not null
   and c.n8n_kunde_id=u.n8n_kunde_id and c.kunde_email=u.kunde_email
   and (select count(*) from public.sma_kunden d where d.user_id=j.user_id)=1 and u.expires_at>now());
exception when others then
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);raise;
end $$;

create function sma_private.file_job_view_v1(j sma_private.file_jobs_v1,p_command_id uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('ok',true,'job_id',j.id,'state',case when j.deadline_at<=now() then 'expired'
   when j.execution_id is null and j.start_claimed_at<=now()-interval '60 seconds' then 'uncertain' else j.state end,
  'deadline_at',j.deadline_at,'asset_id',j.asset_id,'asset_revision',j.asset_revision,'can_publish',false,
  'commands',coalesce((select jsonb_agg(jsonb_build_object('command_id',c.id,'operation',c.operation,'state',c.state,
   'response',case when c.response_status is not null then jsonb_build_object('status',c.response_status,'body',
    case when c.operation='upload_start' and c.response_body ? 'upload_url' then
     coalesce((select jsonb_build_object('ok',true,'status','completed','upload_id',u.id,'asset_id',u.asset_id,'can_publish',false)
       from sma_private.publication_uploads_v1 u where u.id=j.upload_id and u.user_id=j.user_id and u.customer_id=j.customer_id
        and u.status='completed' and u.asset_id is not null),
      case when j.deadline_at<=now() or not exists(select 1 from sma_private.publication_uploads_v1 u
       where u.id=j.upload_id and u.status='ready' and u.expires_at>now()) then '{"ok":false,"code":"UPLOAD_EXPIRED"}'::jsonb else c.response_body end)
     else c.response_body end) end,
   'error_code',c.error_code) order by c.command_seq) from sma_private.file_commands_v1 c
   where c.job_id=j.id and (p_command_id is null or c.id=p_command_id)),'[]'::jsonb));
$$;

create function sma_private.file_command_input_v1(j sma_private.file_jobs_v1,p_operation text,p_input jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare allowed text[];o sma_private.publication_orders_v1%rowtype;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>40000 then return false;end if;
 case p_operation
 when 'upload_start' then
  allowed:=array['upload_id','name','mime_type','size_bytes'];
  if j.upload_id is null or p_input->>'upload_id' is distinct from j.upload_id::text
   or not exists(select 1 from sma_private.publication_uploads_v1 u where u.id=j.upload_id and u.user_id=j.user_id
    and u.customer_id=j.customer_id and u.name=p_input->>'name' and u.mime_type=p_input->>'mime_type'
    and u.size_bytes::text=p_input->>'size_bytes') then return false;end if;
 when 'upload_finish' then
  allowed:=array['upload_id'];if p_input->>'upload_id' is distinct from j.upload_id::text then return false;end if;
 when 'magic_photo','magic_video','review' then
  allowed:=array['asset_id','asset_revision'];
  if j.asset_id is null or p_input->>'asset_id' is distinct from j.asset_id::text or p_input->>'asset_revision' is distinct from j.asset_revision then return false;end if;
 when 'preview_prepare' then
  allowed:=array['request_id','source_text','audience','goal','language','media_kind','platforms'];
  if j.asset_id is null or not exists(select 1 from sma_private.publication_files_v1 f
   where f.id=j.asset_id and f.media_kind=p_input->>'media_kind') then return false;end if;
 when 'account' then
  allowed:=array['id','platform'];
  if j.asset_id is null or coalesce(p_input->>'id','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   or coalesce(p_input->>'platform','') not in ('youtube','tiktok') then return false;end if;
 when 'order_prepare' then
  allowed:=array['id','asset_id','asset_revision','platform','assignment_revision','preview_id','preview_revision','choices','expected_target_id'];
  if j.asset_id is null or p_input->>'asset_id' is distinct from j.asset_id::text or p_input->>'asset_revision' is distinct from j.asset_revision then return false;end if;
 when 'order_approve' then
  allowed:=array['id','approval_token','confirm','review'];
  select * into o from sma_private.publication_orders_v1 where id=(p_input->>'id')::uuid;
  if not found or o.user_id<>j.user_id or o.customer_id<>j.customer_id or j.asset_id is null
   or o.binding->>'asset_id' is distinct from j.asset_id::text or o.binding->>'asset_revision' is distinct from j.asset_revision then return false;end if;
 else return false;
 end case;
 return not exists(select 1 from jsonb_object_keys(p_input) k where not(k=any(allowed)));
exception when invalid_text_representation then return false;
end $$;

create function public.sma_file_job_v1(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();j sma_private.file_jobs_v1%rowtype;c sma_private.file_commands_v1%rowtype;
 f sma_private.publication_files_v1%rowtype;u sma_private.publication_uploads_v1%rowtype;
 a jsonb;r jsonb;request uuid;command uuid;canonical uuid;key text;hash text;existing_hash text;v_job uuid;op text;
begin
 if uid is null then return '{"ok":false,"code":"AUTH_REQUIRED"}';end if;
 if p_action is null or p_action not in ('start','command','get') or jsonb_typeof(p_input) is distinct from 'object'
  or octet_length(p_input::text)>45000 then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
 if p_action='start' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('request_id','anchor'))
   or coalesce(p_input->>'request_id','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   or jsonb_typeof(p_input->'anchor') is distinct from 'object' then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
  request:=(p_input->>'request_id')::uuid;a:=p_input->'anchor';
  hash:=encode(sha256(convert_to(a::text,'UTF8')),'hex');
  -- One owner's requests serialize only during this short, network-free RPC.
  perform pg_advisory_xact_lock(hashtextextended('file-job-owner:'||uid::text,0));
  select q.job_id,q.input_hash into v_job,existing_hash from sma_private.file_job_requests_v1 q where q.user_id=uid and q.request_id=request;
  if found then
   if hash<>existing_hash then return '{"ok":false,"code":"REQUEST_CONFLICT"}';end if;
   select * into j from sma_private.file_jobs_v1 where id=v_job;
   if sma_private.file_job_current_v1(j) is not true then return '{"ok":false,"code":"JOB_UNAVAILABLE"}';end if;
   return sma_private.file_job_view_v1(j);
  end if;
  if a->>'kind'='asset' then
   if exists(select 1 from jsonb_object_keys(a) k where k not in ('kind','asset_id','asset_revision')) then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
   select * into f from sma_private.publication_files_v1 where id=(a->>'asset_id')::uuid and user_id=uid and revision=a->>'asset_revision' and available;
   if not found then return '{"ok":false,"code":"FILE_UNAVAILABLE"}';end if;
   key:='asset:'||f.id::text||':'||f.revision;
   j.user_id:=uid;j.customer_id:=f.customer_id;j.asset_id:=f.id;j.asset_revision:=f.revision;
   if sma_private.file_job_current_v1(j) is not true then return '{"ok":false,"code":"JOB_UNAVAILABLE"}';end if;
  elsif a->>'kind'='upload' then
   if exists(select 1 from jsonb_object_keys(a) k where k not in ('kind','upload_id','name','mime_type','size_bytes'))
    or coalesce(a->>'upload_id','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
   key:='upload:'||(a->>'upload_id');
   select * into u from sma_private.publication_uploads_v1 where id=(a->>'upload_id')::uuid and user_id=uid;
   if found and u.status='completed' then
    r:=sma_private.publication_upload_request_v1('start',a-'kind');
    if r->'ok' is distinct from 'true'::jsonb then return r;end if;
    select * into f from sma_private.publication_files_v1 where id=u.asset_id and user_id=uid and available;
    if not found then return '{"ok":false,"code":"FILE_UNAVAILABLE"}';end if;
   end if;
  else return '{"ok":false,"code":"INVALID_INPUT"}';end if;
  update sma_private.file_jobs_v1 set state='expired',resume_url=null,resume_ticket=null,delivery_lease=null,delivery_until=null
   where user_id=uid and deadline_at<=now() and state in ('queued','running','waiting','uncertain');
  select g.* into j from sma_private.file_jobs_v1 g where g.user_id=uid and g.state in ('queued','running','waiting','uncertain')
   and (g.anchor_key=key or (f.id is not null and ((g.asset_id=f.id and g.asset_revision=f.revision)
    or (g.asset_id is null and exists(select 1 from sma_private.publication_uploads_v1 linked
      where linked.id=g.upload_id and linked.user_id=uid and linked.asset_id=f.id and linked.status='completed'))))) for update;
  if found then
   if a->>'kind'='upload' and j.anchor->>'kind'='upload' and a is distinct from j.anchor then return '{"ok":false,"code":"REQUEST_CONFLICT"}';end if;
   if a->>'kind'='upload' and j.upload_id is null and u.status='completed' and u.asset_id=j.asset_id then
    update sma_private.file_jobs_v1 set upload_id=u.id,initial_reservation=r where id=j.id returning * into j;
   end if;
   if f.id is not null and j.asset_id is null then
    update sma_private.file_jobs_v1 set asset_id=f.id,asset_revision=f.revision where id=j.id returning * into j;
   end if;
   if sma_private.file_job_current_v1(j) is not true then return '{"ok":false,"code":"JOB_UNAVAILABLE"}';end if;
  else
   if a->>'kind'='upload' then
    -- Atomically retain the ORIGINAL lease-bearing reply. Re-running start
    -- later would otherwise yield UPLOAD_INITIALIZING and lose this context.
    if r is null then r:=sma_private.publication_upload_request_v1('start',a-'kind');end if;
    if r->'ok' is distinct from 'true'::jsonb then return r;end if;
    select * into u from sma_private.publication_uploads_v1 where id=(a->>'upload_id')::uuid and user_id=uid;
    if not found then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
    if u.asset_id is not null then select * into f from sma_private.publication_files_v1 where id=u.asset_id and user_id=uid;end if;
   end if;
   insert into sma_private.file_jobs_v1(id,user_id,customer_id,anchor,anchor_key,upload_id,asset_id,asset_revision,initial_reservation)
   values(gen_random_uuid(),uid,coalesce(u.customer_id,f.customer_id),a,key,u.id,f.id,f.revision,r) returning * into j;
  end if;
  insert into sma_private.file_job_requests_v1(user_id,request_id,input_hash,job_id) values(uid,request,hash,j.id);
  return sma_private.file_job_view_v1(j);
 end if;
 if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('job_id','command_id','operation','input')) then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
 select * into j from sma_private.file_jobs_v1 where id=(p_input->>'job_id')::uuid and user_id=uid for update;
 if not found or sma_private.file_job_current_v1(j) is not true then return '{"ok":false,"code":"JOB_UNAVAILABLE"}';end if;
 command:=(p_input->>'command_id')::uuid;
 if p_action='get' then
  if p_input ? 'operation' or p_input ? 'input' then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
  select q.command_id into canonical from sma_private.file_command_requests_v1 q where q.id=command and q.job_id=j.id;
  command:=coalesce(canonical,command);
  return sma_private.file_job_view_v1(j,command);
 end if;
 if j.deadline_at<=now() or j.state in ('finished','expired') then return '{"ok":false,"code":"JOB_EXPIRED"}';end if;
 if j.state='uncertain' then return '{"ok":false,"code":"JOB_UNCERTAIN"}';end if;
 op:=p_input->>'operation';a:=p_input->'input';
 if command is null or sma_private.file_command_input_v1(j,op,a) is not true then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
 hash:=encode(sha256(convert_to(jsonb_build_object('operation',op,'input',a)::text,'UTF8')),'hex');
 select q.command_id,q.job_id,q.input_hash into canonical,v_job,existing_hash from sma_private.file_command_requests_v1 q where q.id=command;
 if found then
  if v_job<>j.id or hash<>existing_hash then return '{"ok":false,"code":"COMMAND_CONFLICT"}';end if;
  return sma_private.file_job_view_v1(j,canonical);
 end if;
 select * into c from sma_private.file_commands_v1 where id=command;
 if found then
  if c.job_id<>j.id or c.input_hash<>hash then return '{"ok":false,"code":"COMMAND_CONFLICT"}';end if;
  return sma_private.file_job_view_v1(j,c.id);
 end if;
 if op in ('upload_start','upload_finish') then
  select * into c from sma_private.file_commands_v1 where job_id=j.id and operation=op order by command_seq limit 1;
  if found then
   if c.input_hash<>hash then return '{"ok":false,"code":"COMMAND_CONFLICT"}';end if;
   insert into sma_private.file_command_requests_v1(id,job_id,command_id,input_hash) values(command,j.id,c.id,hash);
   return sma_private.file_job_view_v1(j,c.id);
  end if;
 end if;
 if (select count(*) from sma_private.file_commands_v1 where job_id=j.id)>=64 then return '{"ok":false,"code":"COMMAND_LIMIT"}';end if;
 insert into sma_private.file_commands_v1(id,job_id,command_seq,operation,input,input_hash)
 values(command,j.id,(select count(*)+1 from sma_private.file_commands_v1 where job_id=j.id),op,a,hash);
 insert into sma_private.file_command_requests_v1(id,job_id,command_id,input_hash) values(command,j.id,command,hash);
 return sma_private.file_job_view_v1(j,command);
exception when invalid_text_representation then return '{"ok":false,"code":"INVALID_INPUT"}';
end $$;
revoke all on function public.sma_file_job_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_file_job_v1(text,jsonb) to authenticated;

-- Only a private claimed command can select an original authenticated RPC.
-- No dynamic SQL, caller-supplied owner, function name or arbitrary arguments.
create function sma_private.file_command_reserve_v1(j sma_private.file_jobs_v1,c sma_private.file_commands_v1,p_order_read boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old_sub text:=current_setting('request.jwt.claim.sub',true);r jsonb;
begin
 perform set_config('request.jwt.claim.sub',j.user_id::text,true);
 if p_order_read then
  if c.operation<>'order_approve' then r:='{"ok":false,"code":"INVALID_OPERATION"}';
  else r:=sma_private.publication_order_request_v1('get',jsonb_build_object('id',c.input->>'id'));end if;
 else
 case c.operation
 when 'upload_start' then r:=j.initial_reservation;
 when 'upload_finish' then r:=sma_private.publication_upload_request_v1('finish',c.input);
 when 'magic_photo' then r:=sma_private.publication_magic_request_v1('start',c.input);
 when 'magic_video' then r:=sma_private.publication_video_magic_request_v1('start',c.input);
 when 'review' then r:=sma_private.publication_review_request_v1('start',c.input);
 when 'preview_prepare' then r:=sma_private.publication_preview_request_v1('prepare',c.input,null);
 when 'account' then r:=sma_private.publication_account_context_v1(c.input->>'platform');
 when 'order_prepare' then r:=sma_private.publication_order_request_v1('prepare',c.input);
 when 'order_approve' then r:=sma_private.publication_order_request_v1('approve',c.input);
 else r:='{"ok":false,"code":"INVALID_OPERATION"}';
 end case;
 end if;
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);return r;
exception when others then
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);raise;
end $$;

-- Reject accidental internal credentials in a captured public HTTP response.
-- approval_token and the scoped upload_url are intentional existing UI fields.
create function sma_private.file_command_public_body_v1(v jsonb) returns boolean
language sql immutable set search_path='' as $$
 with recursive fields(v) as (
  select v union all select child.value from fields f cross join lateral (
   select value from jsonb_each(case when jsonb_typeof(f.v)='object' then f.v else '{}'::jsonb end)
   union all select value from jsonb_array_elements(case when jsonb_typeof(f.v)='array' then f.v else '[]'::jsonb end)
  ) child
 ) select coalesce(jsonb_typeof(v)='object' and octet_length(v::text)<=262144
  and not exists(select 1 from fields f cross join lateral jsonb_object_keys(case when jsonb_typeof(f.v)='object' then f.v else '{}'::jsonb end) k
   where lower(k) in ('authorization','access_token','refresh_token','client_secret','service_role','apikey','password',
    'resume_url','resume_ticket','command_ticket','start_ticket','lease_id','user_id','n8n_kunde_id','kunde_email')),false);
$$;

create function public.sma_file_job_worker_v1(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j sma_private.file_jobs_v1%rowtype;c sma_private.file_commands_v1%rowtype;
 f sma_private.publication_files_v1%rowtype;u sma_private.publication_uploads_v1%rowtype;
 o sma_private.publication_orders_v1%rowtype;a sma_private.publication_provider_attempts_v1%rowtype;
 cv sma_private.publication_provider_covers_v1%rowtype;
 r jsonb;v_job uuid;v_command uuid;epoch integer;url text;ticket text;child text;allowed text[];op_action text;body jsonb;fp text;
begin
 if p_action is null or p_action not in ('claim_start','start_receipt','start_uncertain','bind','parent_context','fail','wait','claim_delivery','accept','receipt','uncertain','context','claim','reserve','order_continue','result','completed','finish')
  or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>270000 then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
 v_job:=(p_input->>'job_id')::uuid;
 select * into j from sma_private.file_jobs_v1 where id=v_job for update;
 if not found then return '{"ok":false,"code":"JOB_UNAVAILABLE"}';end if;
 if p_action='parent_context' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('job_id','execution_id'))
   or j.execution_id is null or p_input->>'execution_id' is distinct from j.execution_id then return '{"ok":false,"code":"EXECUTION_MISMATCH"}';end if;
  return jsonb_build_object('ok',true,'job_id',j.id,'execution_id',j.execution_id,'phase_seq',j.phase_seq,'deadline_at',j.deadline_at,
   'state',case when j.deadline_at<=now() then 'expired' else j.state end,
   'terminal',j.deadline_at<=now() or j.state in ('finished','expired','uncertain') or j.phase_seq>=64,
   'has_pending',exists(select 1 from sma_private.file_commands_v1 where job_id=j.id and state not in ('completed','failed')));
 end if;
 if p_action='fail' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('job_id','execution_id','error_code'))
   or j.execution_id is null or p_input->>'execution_id' is distinct from j.execution_id
   or p_input->>'error_code' is distinct from 'WORKER_FAILED' then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
  if j.state in ('finished','expired') then return '{"ok":true}';end if;
  update sma_private.file_jobs_v1 set state='uncertain',resume_url=null,resume_ticket=null,delivery_lease=null,delivery_until=null where id=j.id;
  update sma_private.file_commands_v1 set state='uncertain',error_code='WORKER_FAILED'
   where job_id=j.id and state in ('offered','accepted','running');
  return '{"ok":true}';
 end if;
 if p_action='start_receipt' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('job_id','start_ticket'))
   or j.start_ticket is null or p_input->>'start_ticket' is distinct from j.start_ticket then return '{"ok":false,"code":"INVALID_START_TICKET"}';end if;
  return jsonb_build_object('ok',true,'job_id',j.id,'bound',j.execution_id is not null,'execution_id',j.execution_id,'state',j.state);
 end if;
 if p_action='receipt' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('job_id','event_id')) then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
  select * into c from sma_private.file_commands_v1 where id=(p_input->>'event_id')::uuid and job_id=j.id;
  if not found then return '{"ok":false,"code":"COMMAND_UNAVAILABLE"}';end if;
  return jsonb_build_object('ok',true,'job_id',j.id,'event_id',c.id,'accepted',c.accepted_at is not null,
   'phase_seq',c.phase_seq,'execution_id',c.accepted_execution_id,'state',case when c.accepted_at is not null then 'accepted' else c.state end);
 end if;
 if sma_private.file_job_current_v1(j) is not true then return '{"ok":false,"code":"JOB_UNAVAILABLE"}';end if;
 if j.deadline_at<=now() or j.state in ('finished','expired') then return '{"ok":false,"code":"JOB_EXPIRED"}';end if;
 if p_action='claim_start' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k<>'job_id') then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
  if j.state<>'queued' or j.start_claimed_at is not null then return jsonb_build_object('ok',true,'start',null,'bound',j.execution_id is not null,
   'state',case when j.execution_id is null and j.start_claimed_at<=now()-interval '60 seconds' then 'uncertain' else j.state end);end if;
  ticket:=encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex');
  update sma_private.file_jobs_v1 set start_ticket=ticket,start_claimed_at=now() where id=j.id;
  return jsonb_build_object('ok',true,'start',jsonb_build_object('job_id',j.id,'start_ticket',ticket,
   'deadline_at',j.deadline_at,'claim_expires_at',least(now()+interval '60 seconds',j.deadline_at)));
 elsif p_action='start_uncertain' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('job_id','start_ticket'))
   or j.start_ticket is null or p_input->>'start_ticket' is distinct from j.start_ticket then return '{"ok":false,"code":"INVALID_START_TICKET"}';end if;
  if j.execution_id is not null then return jsonb_build_object('ok',true,'bound',true,'execution_id',j.execution_id);end if;
  update sma_private.file_jobs_v1 set state='uncertain' where id=j.id;return '{"ok":true,"bound":false}';
 elsif p_action='bind' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('job_id','start_ticket','execution_id'))
   or coalesce(p_input->>'execution_id','')!~'^[A-Za-z0-9_-]{1,80}$'
   or j.start_ticket is null or p_input->>'start_ticket' is distinct from j.start_ticket then return '{"ok":false,"code":"INVALID_START_TICKET"}';end if;
  if j.execution_id is not null then
   if j.execution_id is distinct from p_input->>'execution_id' then return '{"ok":false,"code":"EXECUTION_MISMATCH"}';end if;
   return jsonb_build_object('ok',true,'already_bound',true,'job_id',j.id,'deadline_at',j.deadline_at);
  end if;
  if j.state not in ('queued','uncertain') or j.start_claimed_at is null or j.start_claimed_at<=now()-interval '60 seconds' then return '{"ok":false,"code":"START_EXPIRED"}';end if;
  update sma_private.file_jobs_v1 set execution_id=p_input->>'execution_id',state='running' where id=j.id;
  return jsonb_build_object('ok',true,'already_bound',false,'job_id',j.id,'deadline_at',j.deadline_at);
 elsif p_action='wait' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('job_id','execution_id','phase_seq','resume_url'))
   or p_input->>'execution_id' is distinct from j.execution_id then return '{"ok":false,"code":"EXECUTION_MISMATCH"}';end if;
  epoch:=(p_input->>'phase_seq')::integer;url:=p_input->>'resume_url';
  if epoch is null or epoch not between 1 and 64 or char_length(url)>2000
   or char_length(split_part(url,'?signature=',2)) not between 16 and 1024 or url is null
   or url!~('^https://johnmusic\.app\.n8n\.cloud/webhook-waiting/'||j.execution_id||'/file-command-'||epoch::text||'\?signature=[A-Za-z0-9._~%=-]+$') then return '{"ok":false,"code":"INVALID_RESUME_URL"}';end if;
  if epoch=j.phase_seq and j.state='waiting' and j.resume_url=url then return jsonb_build_object('ok',true,'wait',true,'phase_seq',epoch,'deadline_at',j.deadline_at);end if;
  if epoch<>j.phase_seq+1 or j.state<>'running' or exists(select 1 from sma_private.file_commands_v1
   where job_id=j.id and state in ('offered','accepted','running','uncertain')) then return '{"ok":false,"code":"PHASE_CONFLICT"}';end if;
  -- Serialize queue inspection and wait registration with authenticated enqueue.
  -- A command queued during child work is dispatched in this same parent, with
  -- no HTTP wake, polling, second parent or consumed native Wait phase.
  select * into c from sma_private.file_commands_v1 where job_id=j.id and state='queued' order by command_seq limit 1 for update;
  if found then
   if sma_private.file_command_input_v1(j,c.operation,c.input) is not true then return '{"ok":false,"code":"COMMAND_BINDING_CHANGED"}';end if;
   ticket:=encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex');
   update sma_private.file_commands_v1 set state='accepted',phase_seq=j.phase_seq,accepted_at=now(),
    accepted_execution_id=j.execution_id,command_ticket=ticket where id=c.id;
   return jsonb_build_object('ok',true,'wait',false,'phase_seq',j.phase_seq,'deadline_at',j.deadline_at,
    'dispatch',jsonb_build_object('ok',true,'accepted',true,'already_accepted',false,'job_id',j.id,'command_id',c.id,
     'operation',c.operation,'command_ticket',ticket,'parent_execution_id',j.execution_id,'deadline_at',j.deadline_at));
  end if;
  ticket:=encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex');
  update sma_private.file_jobs_v1 set state='waiting',phase_seq=epoch,resume_url=url,resume_ticket=ticket,delivery_lease=null,delivery_until=null where id=j.id;
  return jsonb_build_object('ok',true,'wait',true,'phase_seq',epoch,'deadline_at',j.deadline_at);
 elsif p_action='claim_delivery' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k<>'job_id') then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
  if j.state<>'waiting' or j.delivery_lease is not null then return '{"ok":true,"delivery":null}';end if;
  select * into c from sma_private.file_commands_v1 where job_id=j.id and state='queued' order by command_seq limit 1 for update;
  if not found then return '{"ok":true,"delivery":null}';end if;
  if sma_private.file_command_input_v1(j,c.operation,c.input) is not true then return '{"ok":false,"code":"COMMAND_BINDING_CHANGED"}';end if;
  update sma_private.file_jobs_v1 set delivery_lease=gen_random_uuid(),delivery_until=least(now()+interval '60 seconds',deadline_at) where id=j.id returning * into j;
  update sma_private.file_commands_v1 set state='offered',phase_seq=j.phase_seq,ticket_hash=encode(sha256(convert_to(j.resume_ticket,'UTF8')),'hex') where id=c.id;
  return jsonb_build_object('ok',true,'delivery',jsonb_build_object('job_id',j.id,'event_id',c.id,'phase_seq',j.phase_seq,
   'execution_id',j.execution_id,'lease_id',j.delivery_lease,'expires_at',j.delivery_until,'resume_url',j.resume_url,'ticket',j.resume_ticket));
 elsif p_action='accept' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('job_id','event_id','phase_seq','execution_id','ticket'))
   or p_input->>'execution_id' is distinct from j.execution_id then return '{"ok":false,"code":"EXECUTION_MISMATCH"}';end if;
  epoch:=(p_input->>'phase_seq')::integer;ticket:=p_input->>'ticket';
  if coalesce(ticket,'')!~'^[a-f0-9]{64}$' then return '{"ok":false,"code":"INVALID_TICKET"}';end if;
  select * into c from sma_private.file_commands_v1 where id=(p_input->>'event_id')::uuid and job_id=j.id for update;
  if not found or c.phase_seq is distinct from epoch or c.ticket_hash is distinct from encode(sha256(convert_to(ticket,'UTF8')),'hex') then return '{"ok":false,"code":"INVALID_TICKET"}';end if;
  if c.accepted_at is not null then return jsonb_build_object('ok',true,'accepted',true,'already_accepted',true,'command_id',c.id);end if;
  if j.state not in ('waiting','uncertain') or j.phase_seq<>epoch or j.resume_ticket is distinct from ticket
   or j.delivery_until is null or j.delivery_until<=now() or c.state not in ('offered','uncertain') then return '{"ok":false,"code":"INVALID_TICKET"}';end if;
  if sma_private.file_command_input_v1(j,c.operation,c.input) is not true then return '{"ok":false,"code":"COMMAND_BINDING_CHANGED"}';end if;
  ticket:=encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex');
  update sma_private.file_commands_v1 set state='accepted',accepted_at=now(),accepted_execution_id=j.execution_id,command_ticket=ticket where id=c.id;
  update sma_private.file_jobs_v1 set state='running',resume_url=null,resume_ticket=null,delivery_lease=null,delivery_until=null where id=j.id;
  return jsonb_build_object('ok',true,'accepted',true,'already_accepted',false,'job_id',j.id,'command_id',c.id,'operation',c.operation,
   'command_ticket',ticket,'parent_execution_id',j.execution_id,'deadline_at',j.deadline_at);
 elsif p_action='uncertain' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('job_id','event_id','lease_id')) then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
  select * into c from sma_private.file_commands_v1 where id=(p_input->>'event_id')::uuid and job_id=j.id for update;
  if not found then return '{"ok":false,"code":"COMMAND_UNAVAILABLE"}';end if;
  if c.accepted_at is not null then return '{"ok":true,"accepted":true}';end if;
  if j.delivery_lease is null or j.delivery_lease is distinct from (p_input->>'lease_id')::uuid or c.state not in ('offered','uncertain') then return '{"ok":false,"code":"INVALID_LEASE"}';end if;
  update sma_private.file_commands_v1 set state='uncertain' where id=c.id;
  update sma_private.file_jobs_v1 set state='uncertain' where id=j.id;return '{"ok":true,"accepted":false}';
 elsif p_action='finish' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('job_id','execution_id'))
   or p_input->>'execution_id' is distinct from j.execution_id or j.state<>'running' then return '{"ok":false,"code":"EXECUTION_MISMATCH"}';end if;
  if exists(select 1 from sma_private.file_commands_v1 where job_id=j.id and state not in ('completed','failed')) then return '{"ok":false,"code":"COMMANDS_PENDING"}';end if;
  update sma_private.file_jobs_v1 set state='finished' where id=j.id;return '{"ok":true}';
 end if;

 v_command:=(p_input->>'command_id')::uuid;
 select * into c from sma_private.file_commands_v1 where id=v_command and job_id=j.id for update;
 if not found or c.accepted_at is null then return '{"ok":false,"code":"COMMAND_UNAVAILABLE"}';end if;
 if p_action='context' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('job_id','command_id','execution_id'))
   or p_input->>'execution_id' is distinct from j.execution_id or c.state<>'accepted' then return '{"ok":false,"code":"COMMAND_UNAVAILABLE"}';end if;
  return jsonb_build_object('ok',true,'job_id',j.id,'command_id',c.id,'operation',c.operation,'command_ticket',c.command_ticket,'parent_execution_id',j.execution_id,'deadline_at',j.deadline_at);
 end if;
 child:=p_input->>'child_execution_id';
 if c.command_ticket is null or p_input->>'command_ticket' is distinct from c.command_ticket or coalesce(child,'')!~'^[A-Za-z0-9_-]{1,80}$' then return '{"ok":false,"code":"INVALID_COMMAND_TICKET"}';end if;
 allowed:=array['job_id','command_id','command_ticket','child_execution_id'];
 if p_action='claim' then allowed:=allowed||'parent_execution_id'::text;
 elsif p_action='result' then allowed:=allowed||array['status','body'];
 elsif p_action='completed' then allowed:=allowed||array['outcome','error_code'];end if;
 if exists(select 1 from jsonb_object_keys(p_input) k where not(k=any(allowed))) then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
 if p_action='claim' then
  if p_input->>'parent_execution_id' is distinct from j.execution_id then return '{"ok":false,"code":"EXECUTION_MISMATCH"}';end if;
  if c.child_execution_id is not null and c.child_execution_id<>child then return '{"ok":false,"code":"COMMAND_ALREADY_CLAIMED"}';end if;
  if c.state not in ('accepted','running') then return '{"ok":false,"code":"COMMAND_FINISHED"}';end if;
  if c.child_execution_id is null then
   update sma_private.file_commands_v1 set child_execution_id=child,state='running',operation_deadline=least(j.deadline_at,
    now()+case when operation in ('magic_video','order_prepare','order_approve') then interval '600 seconds'
      when operation in ('magic_photo','review') then interval '210 seconds'
      when operation in ('upload_start','upload_finish') then interval '120 seconds' else interval '150 seconds' end)
    where id=c.id returning * into c;
  end if;
  if c.operation_deadline<=now() then return '{"ok":false,"code":"OPERATION_EXPIRED"}';end if;
  op_action:=case c.operation when 'upload_start' then 'start' when 'upload_finish' then 'finish' when 'order_prepare' then 'prepare' when 'order_approve' then 'approve' when 'account' then 'account' else null end;
  body:=case when c.operation in ('upload_start','upload_finish') then c.input||jsonb_build_object('action',op_action)
   when c.operation in ('account','order_prepare','order_approve') then jsonb_build_object('action',op_action,'input',c.input) else c.input end;
  return jsonb_build_object('ok',true,'operation',c.operation,'input',c.input,'action',op_action,
   'request',jsonb_build_object('body',body,'headers','{}'::jsonb),'deadline_at',c.operation_deadline);
 end if;
 if c.child_execution_id is distinct from child then return '{"ok":false,"code":"EXECUTION_MISMATCH"}';end if;
 if c.operation_deadline is null or c.operation_deadline<=now() then return '{"ok":false,"code":"OPERATION_EXPIRED"}';end if;
 if p_action='order_continue' then
  if c.state<>'running' or c.operation<>'order_approve' or c.reservation->>'state' not in ('approved','checked')
   or c.reservation->>'id' is distinct from c.input->>'id' then return '{"ok":false,"code":"COMMAND_UNAVAILABLE"}';end if;
  r:=sma_private.file_command_reserve_v1(j,c,true);
  if r->'ok' is distinct from 'true'::jsonb then return r;end if;
  select * into o from sma_private.publication_orders_v1 where id=(c.input->>'id')::uuid and user_id=j.user_id and customer_id=j.customer_id;
  if not found then return '{"ok":false,"code":"ORDER_UNAVAILABLE"}';end if;
  fp:=sma_private.publication_provider_fingerprint_v1(o);
  select * into a from sma_private.publication_provider_attempts_v1 where order_id=o.id;
  select * into cv from sma_private.publication_provider_covers_v1 where order_id=o.id;
  if (a.order_id is not null and a.fingerprint is distinct from fp) or (cv.order_id is not null and cv.fingerprint is distinct from fp) then return '{"ok":false,"code":"ORDER_CHANGED"}';end if;
  return jsonb_build_object('ok',true,'order',r,'provider',jsonb_build_object('state',coalesce(a.state,'not_started'),
   'updated_at',a.updated_at,'lease_until',a.lease_until,'last_operation',a.last_operation,'has_provider_id',a.provider_id is not null,
   'has_session',a.session_url is not null,'cover_state',cv.state,'has_cover_plan',cv.plan is not null,
   'permission_valid',exists(select 1 from sma_private.publication_provider_permissions_v1 p where p.order_id=o.id and p.fingerprint=fp and p.expires_at>now())));
 elsif p_action='reserve' then
  if c.state<>'running' then return '{"ok":false,"code":"COMMAND_FINISHED"}';end if;
  if c.reservation is not null then return c.reservation;end if;
  if sma_private.file_command_input_v1(j,c.operation,c.input) is not true then return '{"ok":false,"code":"COMMAND_BINDING_CHANGED"}';end if;
  r:=sma_private.file_command_reserve_v1(j,c);
  update sma_private.file_commands_v1 set reservation=r where id=c.id;return r;
 elsif p_action='result' then
  if c.state not in ('running','completed','failed') then return '{"ok":false,"code":"COMMAND_FINISHED"}';end if;
  epoch:=(p_input->>'status')::integer;body:=p_input->'body';
  if epoch is null or epoch not between 200 and 599 or sma_private.file_command_public_body_v1(body) is not true then return '{"ok":false,"code":"INVALID_PUBLIC_RESULT"}';end if;
  -- Existing body validation can reject before the original reservation RPC.
  if c.reservation is null and body->'ok' is distinct from 'false'::jsonb then return '{"ok":false,"code":"COMMAND_NOT_RESERVED"}';end if;
  if c.response_status is not null then
   if epoch<>c.response_status or body is distinct from c.response_body then return '{"ok":false,"code":"RESULT_CONFLICT"}';end if;
   return '{"ok":true}';
  end if;
  if c.operation='upload_finish' and body->'ok'='true'::jsonb and body->>'status'='completed' then
   -- File identity must commit in the SAME transaction as the first visible
   -- completion body. A browser can select that file immediately after get().
   select * into u from sma_private.publication_uploads_v1 where id=j.upload_id and user_id=j.user_id and status='completed';
   select * into f from sma_private.publication_files_v1 where id=u.asset_id and user_id=j.user_id and customer_id=j.customer_id and available;
   if f.id is null or body->>'asset_id' is distinct from f.id::text then return '{"ok":false,"code":"UPLOAD_INCOMPLETE"}';end if;
   if j.asset_id is not null and (j.asset_id<>f.id or j.asset_revision is distinct from f.revision) then return '{"ok":false,"code":"FILE_CHANGED"}';end if;
   update sma_private.file_jobs_v1 set asset_id=f.id,asset_revision=f.revision,initial_reservation=null where id=j.id;
  end if;
  update sma_private.file_commands_v1 set response_status=epoch,response_body=body where id=c.id;return '{"ok":true}';
 elsif p_action='completed' then
  if coalesce(p_input->>'outcome','') not in ('completed','failed') or coalesce(p_input->>'error_code','WORKER_FAILED')<>'WORKER_FAILED' then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
  if c.state in ('completed','failed') then
   if c.state<>p_input->>'outcome' then return '{"ok":false,"code":"RESULT_CONFLICT"}';end if;return '{"ok":true}';
  end if;
  if c.state<>'running' or (p_input->>'outcome'='completed' and c.response_status is null) then return '{"ok":false,"code":"RESULT_REQUIRED"}';end if;
  if c.operation='upload_finish' and p_input->>'outcome'='completed' and c.response_body->'ok'='true'::jsonb then
   select * into u from sma_private.publication_uploads_v1 where id=j.upload_id and user_id=j.user_id and status='completed';
   select * into f from sma_private.publication_files_v1 where id=u.asset_id and user_id=j.user_id and customer_id=j.customer_id and available;
   if f.id is null or c.response_body->>'asset_id' is distinct from f.id::text then return '{"ok":false,"code":"UPLOAD_INCOMPLETE"}';end if;
   update sma_private.file_jobs_v1 set asset_id=f.id,asset_revision=f.revision,initial_reservation=null where id=j.id;
  end if;
  update sma_private.file_commands_v1 set state=p_input->>'outcome',completed_at=now(),
   error_code=case when p_input->>'outcome'='failed' then 'WORKER_FAILED' end where id=c.id;return '{"ok":true}';
 end if;
 return '{"ok":false,"code":"INVALID_ACTION"}';
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then return '{"ok":false,"code":"INVALID_INPUT"}';
end $$;
revoke all on function public.sma_file_job_worker_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_file_job_worker_v1(text,jsonb) to service_role;
revoke all on function sma_private.file_job_current_v1(sma_private.file_jobs_v1),
 sma_private.file_job_view_v1(sma_private.file_jobs_v1,uuid),
 sma_private.file_command_input_v1(sma_private.file_jobs_v1,text,jsonb),
 sma_private.file_command_reserve_v1(sma_private.file_jobs_v1,sma_private.file_commands_v1,boolean),
 sma_private.file_command_public_body_v1(jsonb) from public,anon,authenticated,service_role;
