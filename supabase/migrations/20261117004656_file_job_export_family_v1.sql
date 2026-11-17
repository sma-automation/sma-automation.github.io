-- One native parent for an original and its verified editor derivatives.
-- No new operation, public worker endpoint, timer or publication permission.
create table sma_private.file_job_uploads_v1 (
 job_id uuid not null references sma_private.file_jobs_v1(id),
 upload_id uuid not null references sma_private.publication_uploads_v1(id),
 export_id uuid not null references sma_private.publication_editor_exports_v1(id),
 artifact text not null check(artifact in ('media','cover')),
 source_asset_id uuid not null, source_asset_revision text not null, draft_revision integer not null,
 name text not null, mime_type text not null, size_bytes bigint not null check(size_bytes between 1 and 24000000),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), initial_reservation jsonb not null,
 primary key(job_id,upload_id), unique(job_id,export_id,artifact)
);
create index file_job_uploads_upload_v1 on sma_private.file_job_uploads_v1(upload_id,job_id);
create index file_job_uploads_export_v1 on sma_private.file_job_uploads_v1(export_id);
create index if not exists publication_editor_exports_cover_upload_v1 on sma_private.publication_editor_exports_v1(cover_upload_id);
create index if not exists publication_uploads_asset_owner_v1 on sma_private.publication_uploads_v1(asset_id,user_id) where asset_id is not null;
create table sma_private.file_job_assets_v1 (
 job_id uuid not null references sma_private.file_jobs_v1(id),
 asset_id uuid not null references sma_private.publication_files_v1(id), asset_revision text not null,
 upload_id uuid not null,
 primary key(job_id,asset_id,asset_revision), unique(job_id,upload_id),
 foreign key(job_id,upload_id) references sma_private.file_job_uploads_v1(job_id,upload_id)
);
create index file_job_assets_asset_v1 on sma_private.file_job_assets_v1(asset_id,asset_revision,job_id);
alter table sma_private.file_job_uploads_v1 enable row level security;
alter table sma_private.file_job_assets_v1 enable row level security;
revoke all on sma_private.file_job_uploads_v1,sma_private.file_job_assets_v1 from public,anon,authenticated,service_role;

-- NULL means an ordinary upload. A known but invalid/ambiguous export must
-- never fall through to ordinary upload authorization.
create function sma_private.file_job_export_context_v1(p_upload uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e sma_private.publication_editor_exports_v1%rowtype; f sma_private.publication_files_v1%rowtype;
 d sma_private.publication_editor_drafts_v1%rowtype; matches integer; kind text; output jsonb; mime text;
begin
 select count(*) into matches from sma_private.publication_editor_exports_v1 x where x.id=p_upload or x.cover_upload_id=p_upload;
 if matches=0 then return null;end if;
 if matches<>1 then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
 select * into e from sma_private.publication_editor_exports_v1 x where x.id=p_upload or x.cover_upload_id=p_upload;
 if e.id=e.cover_upload_id then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
 kind:=case when e.id=p_upload then 'media' else 'cover' end;output:=e.outputs->kind;
 select * into f from sma_private.publication_files_v1 where id=e.asset_id;
 if not found or f.user_id<>e.user_id or f.customer_id<>e.customer_id or f.media_kind not in ('image','video') or jsonb_typeof(output) is distinct from 'object'
  or coalesce(output->>'sha256','')!~'^[a-f0-9]{64}$' or coalesce(output->>'size_bytes','')!~'^[1-9][0-9]{0,7}$'
  or (output->>'size_bytes')::bigint>24000000 or (kind='cover' and (f.media_kind<>'video' or e.settings->'cover_ms'='null'::jsonb))
  then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
 select * into d from sma_private.publication_editor_drafts_v1 where asset_id=e.asset_id and asset_revision=e.asset_revision;
 mime:=case when kind='media' and f.media_kind='video' then 'video/mp4' else 'image/png' end;
 return jsonb_build_object('ok',true,'export_id',e.id,'artifact',kind,'user_id',e.user_id,'customer_id',e.customer_id,
  'source_asset_id',e.asset_id,'source_asset_revision',e.asset_revision,'draft_revision',e.draft_revision,
  'source_current',f.available and f.revision=e.asset_revision,
  'draft_current',coalesce(d.revision,0)=e.draft_revision and coalesce(d.settings,sma_private.publication_editor_defaults_v1())=e.settings
   and (d.asset_id is null or (d.user_id=e.user_id and d.customer_id=e.customer_id)),
  'name','SMA-Export-'||e.id::text||case when kind='cover' then '-Cover.png' when mime='video/mp4' then '.mp4' else '.png' end,
  'mime_type',mime,'size_bytes',(output->>'size_bytes')::bigint,'sha256',output->>'sha256');
end $$;

-- Validate a frozen private upload binding against both authoritative records.
-- The current draft was checked when this binding was created. A later draft
-- save must not invalidate a previously authorized in-flight upload.
create function sma_private.file_job_upload_current_v1(j sma_private.file_jobs_v1,b sma_private.file_job_uploads_v1) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(exists(select 1 from sma_private.publication_editor_exports_v1 e
  join sma_private.publication_uploads_v1 u on u.id=b.upload_id
  where b.job_id=j.id and e.id=b.export_id and e.user_id=j.user_id and e.customer_id=j.customer_id
   and e.asset_id=b.source_asset_id and e.asset_revision=b.source_asset_revision and e.draft_revision=b.draft_revision
   and (case b.artifact when 'media' then e.id else e.cover_upload_id end)=b.upload_id
   and e.outputs->b.artifact->>'sha256'=b.sha256 and (e.outputs->b.artifact->>'size_bytes')::bigint=b.size_bytes
   and u.user_id=j.user_id and u.customer_id=j.customer_id and u.name=b.name and u.mime_type=b.mime_type and u.size_bytes=b.size_bytes
   and exists(select 1 from public.sma_kunden c where c.id=j.customer_id and c.user_id=j.user_id
    and c.n8n_kunde_id=u.n8n_kunde_id and c.kunde_email=u.kunde_email)),false);
$$;

-- The completed-upload join is intentional: the catalogue row becomes visible
-- before the native mailbox result. Waiting for result/exports.completed_at
-- would allow another tab to create a second parent in that interval.
create function sma_private.file_job_asset_current_v1(j sma_private.file_jobs_v1,p_asset uuid,p_revision text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from sma_private.publication_files_v1 f where f.id=p_asset and f.revision=p_revision
  and f.user_id=j.user_id and f.customer_id=j.customer_id and f.available and (
   (f.id=j.asset_id and f.revision=j.asset_revision) or exists(
    select 1 from sma_private.file_job_uploads_v1 b join sma_private.publication_uploads_v1 u on u.id=b.upload_id
    where b.job_id=j.id and sma_private.file_job_upload_current_v1(j,b)
     and u.status='completed' and u.asset_id=f.id and u.drive_file_id=f.drive_file_id
     and f.name=b.name and f.mime_type=b.mime_type and f.media_kind=split_part(b.mime_type,'/',1) and f.size_bytes=b.size_bytes
     and f.revision ~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$' and split_part(f.revision,':',2)=b.sha256
     and not exists(select 1 from sma_private.file_jobs_v1 other where other.id<>j.id and other.user_id=j.user_id
      and other.deadline_at>now() and other.state in ('queued','running','waiting','uncertain')
      and ((other.asset_id=f.id and other.asset_revision=f.revision) or other.upload_id=u.id))
   )));
$$;

create function sma_private.file_job_note_asset_v1(j sma_private.file_jobs_v1,p_upload uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare u sma_private.publication_uploads_v1%rowtype;f sma_private.publication_files_v1%rowtype;b sma_private.file_job_uploads_v1%rowtype;
begin
 select * into b from sma_private.file_job_uploads_v1 where job_id=j.id and upload_id=p_upload;
 if not found or sma_private.file_job_upload_current_v1(j,b) is not true then return false;end if;
 select * into u from sma_private.publication_uploads_v1 where id=p_upload and user_id=j.user_id and customer_id=j.customer_id and status='completed';
 if not found then return false;end if;
 select * into f from sma_private.publication_files_v1 where id=u.asset_id;
 if not found or f.id=b.source_asset_id or f.drive_file_id is distinct from u.drive_file_id
  or f.name is distinct from b.name or f.mime_type is distinct from b.mime_type or f.media_kind is distinct from split_part(b.mime_type,'/',1)
  or f.size_bytes is distinct from b.size_bytes or f.revision !~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$'
  or split_part(f.revision,':',2) is distinct from b.sha256 or sma_private.file_job_asset_current_v1(j,f.id,f.revision) is not true then return false;end if;
 if exists(select 1 from sma_private.file_job_assets_v1 x where x.job_id=j.id and x.upload_id=u.id and x.asset_id<>f.id) then return false;end if;
 insert into sma_private.file_job_assets_v1(job_id,asset_id,asset_revision,upload_id) values(j.id,f.id,f.revision,u.id)
 on conflict(job_id,upload_id) do update set asset_revision=excluded.asset_revision;
 return true;
end $$;

revoke all on function sma_private.file_job_export_context_v1(uuid),
 sma_private.file_job_upload_current_v1(sma_private.file_jobs_v1,sma_private.file_job_uploads_v1),
 sma_private.file_job_asset_current_v1(sma_private.file_jobs_v1,uuid,text),
 sma_private.file_job_note_asset_v1(sma_private.file_jobs_v1,uuid) from public,anon,authenticated,service_role;

create or replace function public.sma_file_job_v1(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();j sma_private.file_jobs_v1%rowtype;c sma_private.file_commands_v1%rowtype;
 f sma_private.publication_files_v1%rowtype;u sma_private.publication_uploads_v1%rowtype;b sma_private.file_job_uploads_v1%rowtype;
 a jsonb;r jsonb;ctx jsonb;request uuid;command uuid;canonical uuid;key text;hash text;existing_hash text;v_job uuid;op text;
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
  perform pg_advisory_xact_lock(hashtextextended('file-job-owner:'||uid::text,0));
  select q.job_id,q.input_hash into v_job,existing_hash from sma_private.file_job_requests_v1 q where q.user_id=uid and q.request_id=request;
  if found then
   if hash<>existing_hash then return '{"ok":false,"code":"REQUEST_CONFLICT"}';end if;
   select * into j from sma_private.file_jobs_v1 where id=v_job;
   if sma_private.file_job_current_v1(j) is not true then return '{"ok":false,"code":"JOB_UNAVAILABLE"}';end if;
   if a->>'kind'='asset' and sma_private.file_job_asset_current_v1(j,(a->>'asset_id')::uuid,a->>'asset_revision') is not true
    then return '{"ok":false,"code":"FILE_UNAVAILABLE"}';end if;
   return sma_private.file_job_view_v1(j);
  end if;
  update sma_private.file_jobs_v1 set state='expired',resume_url=null,resume_ticket=null,delivery_lease=null,delivery_until=null
   where user_id=uid and deadline_at<=now() and state in ('queued','running','waiting','uncertain');
  if a->>'kind'='asset' then
   if exists(select 1 from jsonb_object_keys(a) k where k not in ('kind','asset_id','asset_revision')) then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
   select * into f from sma_private.publication_files_v1 where id=(a->>'asset_id')::uuid and user_id=uid and revision=a->>'asset_revision' and available;
   if not found then return '{"ok":false,"code":"FILE_UNAVAILABLE"}';end if;
   key:='asset:'||f.id::text||':'||f.revision;
   j.user_id:=uid;j.customer_id:=f.customer_id;j.asset_id:=f.id;j.asset_revision:=f.revision;
   if sma_private.file_job_current_v1(j) is not true then return '{"ok":false,"code":"JOB_UNAVAILABLE"}';end if;
   -- An already separate native job wins. Never merge or bypass uncertain work.
   select g.* into j from sma_private.file_jobs_v1 g where g.user_id=uid and g.state in ('queued','running','waiting','uncertain')
    and (g.anchor_key=key or (g.asset_id=f.id and g.asset_revision=f.revision)
     or (g.asset_id is null and exists(select 1 from sma_private.publication_uploads_v1 linked
      where linked.id=g.upload_id and linked.user_id=uid and linked.asset_id=f.id and linked.status='completed')))
    order by (g.anchor_key=key) desc,g.created_at,g.id limit 1 for update;
   if found then
    if j.asset_id is null then update sma_private.file_jobs_v1 set asset_id=f.id,asset_revision=f.revision where id=j.id returning * into j;end if;
   else
    select g.* into j from sma_private.file_jobs_v1 g
     where g.user_id=uid and g.state in ('queued','running','waiting','uncertain') and exists(
      select 1 from sma_private.file_job_uploads_v1 x join sma_private.publication_uploads_v1 linked on linked.id=x.upload_id
      where x.job_id=g.id and linked.user_id=uid and linked.status='completed' and linked.asset_id=f.id)
     order by g.created_at,g.id limit 1 for update;
    if found then
     if sma_private.file_job_asset_current_v1(j,f.id,f.revision) is not true then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
     select x.* into b from sma_private.file_job_uploads_v1 x join sma_private.publication_uploads_v1 linked on linked.id=x.upload_id
      where x.job_id=j.id and linked.asset_id=f.id and linked.status='completed' order by x.upload_id limit 1;
     perform sma_private.file_job_note_asset_v1(j,b.upload_id);
    else
     -- Even without an active family, a recognized derivative cannot turn an
     -- invalid output proof into an unrelated asset parent.
     select * into u from sma_private.publication_uploads_v1 where asset_id=f.id and status='completed' order by id limit 1;
     if found then
      ctx:=sma_private.file_job_export_context_v1(u.id);
      if ctx is not null and (ctx->'ok' is distinct from 'true'::jsonb or ctx->>'user_id' is distinct from uid::text
       or ctx->>'customer_id' is distinct from f.customer_id::text or u.user_id<>uid or u.customer_id<>f.customer_id or f.id::text=ctx->>'source_asset_id'
       or f.name is distinct from ctx->>'name' or f.mime_type is distinct from ctx->>'mime_type' or f.media_kind is distinct from split_part(ctx->>'mime_type','/',1)
       or f.size_bytes::text is distinct from ctx->>'size_bytes' or u.name<>f.name or u.mime_type<>f.mime_type or u.size_bytes<>f.size_bytes
       or f.drive_file_id is distinct from u.drive_file_id or f.revision !~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$'
       or split_part(f.revision,':',2) is distinct from ctx->>'sha256') then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
     end if;
     if ctx is not null and ctx->'source_current'='true'::jsonb then
      -- A finished legacy upload has no live native work to merge. Its fully
      -- verified result may join an ALREADY active source parent. Never create
      -- a new source parent just to adopt a historical result.
      select g.* into j from sma_private.file_jobs_v1 g where g.user_id=uid and g.state in ('queued','running','waiting','uncertain')
       and ((g.asset_id=(ctx->>'source_asset_id')::uuid and g.asset_revision=ctx->>'source_asset_revision')
        or (g.asset_id is null and exists(select 1 from sma_private.publication_uploads_v1 linked
         where linked.id=g.upload_id and linked.user_id=uid and linked.status='completed' and linked.asset_id=(ctx->>'source_asset_id')::uuid))
        or (g.asset_id is not null and sma_private.file_job_asset_current_v1(g,(ctx->>'source_asset_id')::uuid,ctx->>'source_asset_revision')))
       order by (g.asset_id=(ctx->>'source_asset_id')::uuid and g.asset_revision=ctx->>'source_asset_revision') desc,g.created_at,g.id limit 1 for update;
      if found then
       if j.asset_id is null then update sma_private.file_jobs_v1 set asset_id=(ctx->>'source_asset_id')::uuid,asset_revision=ctx->>'source_asset_revision' where id=j.id returning * into j;end if;
       if sma_private.file_job_current_v1(j) is not true or j.customer_id<>f.customer_id then return '{"ok":false,"code":"JOB_UNAVAILABLE"}';end if;
       if j.state='uncertain' then return '{"ok":false,"code":"JOB_UNCERTAIN"}';end if;
       if (select count(*) from sma_private.file_commands_v1 where job_id=j.id)>=64 then return '{"ok":false,"code":"COMMAND_LIMIT"}';end if;
       r:=sma_private.publication_upload_request_v1('start',jsonb_build_object('upload_id',u.id,'name',u.name,'mime_type',u.mime_type,'size_bytes',u.size_bytes));
       if r->'ok' is distinct from 'true'::jsonb then return r;end if;
       if r->>'status' is distinct from 'completed' then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
       insert into sma_private.file_job_uploads_v1(job_id,upload_id,export_id,artifact,source_asset_id,source_asset_revision,draft_revision,name,mime_type,size_bytes,sha256,initial_reservation)
        values(j.id,u.id,(ctx->>'export_id')::uuid,ctx->>'artifact',(ctx->>'source_asset_id')::uuid,ctx->>'source_asset_revision',
         (ctx->>'draft_revision')::integer,ctx->>'name',ctx->>'mime_type',(ctx->>'size_bytes')::bigint,ctx->>'sha256',r);
       if sma_private.file_job_note_asset_v1(j,u.id) is not true then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
      end if;
     end if;
     if j.id is null then
      insert into sma_private.file_jobs_v1(id,user_id,customer_id,anchor,anchor_key,asset_id,asset_revision)
       values(gen_random_uuid(),uid,f.customer_id,a,key,f.id,f.revision) returning * into j;
     end if;
    end if;
   end if;
  elsif a->>'kind'='upload' then
   if exists(select 1 from jsonb_object_keys(a) k where k not in ('kind','upload_id','name','mime_type','size_bytes'))
    or coalesce(a->>'upload_id','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
   key:='upload:'||(a->>'upload_id');
   select * into u from sma_private.publication_uploads_v1 where id=(a->>'upload_id')::uuid;
   if found and u.user_id<>uid then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
   if u.id is not null and (u.name is distinct from a->>'name' or u.mime_type is distinct from a->>'mime_type'
    or u.size_bytes::text is distinct from a->>'size_bytes') then return '{"ok":false,"code":"UPLOAD_CONFLICT"}';end if;
   if u.status='completed' then
    select * into f from sma_private.publication_files_v1 where id=u.asset_id and user_id=uid and available;
    if not found then return '{"ok":false,"code":"FILE_UNAVAILABLE"}';end if;
   end if;
   -- Lock the selected parent BEFORE acquiring customer/upload reservation
   -- locks. The native reserve path uses that same lock order.
   select g.* into j from sma_private.file_jobs_v1 g where g.user_id=uid and g.state in ('queued','running','waiting','uncertain')
    and (g.anchor_key=key or (f.id is not null and g.asset_id=f.id and g.asset_revision=f.revision))
    order by (g.anchor_key=key) desc,g.created_at,g.id limit 1 for update;
   if found then
    if j.anchor->>'kind'='upload' and a is distinct from j.anchor then return '{"ok":false,"code":"REQUEST_CONFLICT"}';end if;
    if j.upload_id is null and u.status='completed' and u.asset_id=j.asset_id then
     r:=sma_private.publication_upload_request_v1('start',a-'kind');if r->'ok' is distinct from 'true'::jsonb then return r;end if;
     update sma_private.file_jobs_v1 set upload_id=u.id,initial_reservation=r where id=j.id returning * into j;
    end if;
    if f.id is not null and j.asset_id is null then update sma_private.file_jobs_v1 set asset_id=f.id,asset_revision=f.revision where id=j.id returning * into j;end if;
   else
    select g.* into j from sma_private.file_jobs_v1 g where g.user_id=uid and g.state in ('queued','running','waiting','uncertain')
     and exists(select 1 from sma_private.file_job_uploads_v1 x where x.job_id=g.id and x.upload_id=(a->>'upload_id')::uuid)
     order by g.created_at,g.id limit 1 for update;
    if found then
     select * into b from sma_private.file_job_uploads_v1 where job_id=j.id and upload_id=(a->>'upload_id')::uuid;
     if sma_private.file_job_upload_current_v1(j,b) is not true then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
     if b.name is distinct from a->>'name' or b.mime_type is distinct from a->>'mime_type' or b.size_bytes::text is distinct from a->>'size_bytes'
      then return '{"ok":false,"code":"UPLOAD_CONFLICT"}';end if;
    else
     ctx:=sma_private.file_job_export_context_v1((a->>'upload_id')::uuid);
     if ctx is not null then
      if ctx->'ok' is distinct from 'true'::jsonb or ctx->>'user_id' is distinct from uid::text then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
      if ctx->'source_current' is distinct from 'true'::jsonb then return '{"ok":false,"code":"FILE_CHANGED"}';end if;
      if ctx->'draft_current' is distinct from 'true'::jsonb then return '{"ok":false,"code":"REVISION_CONFLICT"}';end if;
      if ctx->>'name' is distinct from a->>'name' or ctx->>'mime_type' is distinct from a->>'mime_type'
       or ctx->>'size_bytes' is distinct from a->>'size_bytes' then return '{"ok":false,"code":"UPLOAD_CONFLICT"}';end if;
      -- Reuse the same authoritative asset join, including completed-result
      -- aliases. This internal join performs no network or native execution.
      r:=public.sma_file_job_v1('start',jsonb_build_object('request_id',gen_random_uuid(),'anchor',
       jsonb_build_object('kind','asset','asset_id',ctx->>'source_asset_id','asset_revision',ctx->>'source_asset_revision')));
      if r->'ok' is distinct from 'true'::jsonb then return r;end if;
      select * into j from sma_private.file_jobs_v1 where id=(r->>'job_id')::uuid for update;
      if j.customer_id::text is distinct from ctx->>'customer_id' then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
      if j.state='uncertain' then return '{"ok":false,"code":"JOB_UNCERTAIN"}';end if;
      if (select count(*) from sma_private.file_commands_v1 where job_id=j.id)>=64 then return '{"ok":false,"code":"COMMAND_LIMIT"}';end if;
      r:=sma_private.publication_upload_request_v1('start',a-'kind');if r->'ok' is distinct from 'true'::jsonb then return r;end if;
      select * into u from sma_private.publication_uploads_v1 where id=(a->>'upload_id')::uuid;
      if u.user_id<>j.user_id or u.customer_id<>j.customer_id then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
      if u.status='completed' then
       select * into f from sma_private.publication_files_v1 where id=u.asset_id and user_id=j.user_id and customer_id=j.customer_id and available;
       if not found or f.id::text=ctx->>'source_asset_id' or f.name is distinct from ctx->>'name' or f.mime_type is distinct from ctx->>'mime_type' or f.media_kind is distinct from split_part(ctx->>'mime_type','/',1)
        or f.size_bytes::text is distinct from ctx->>'size_bytes' or f.drive_file_id is distinct from u.drive_file_id
        or f.revision !~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$' or split_part(f.revision,':',2) is distinct from ctx->>'sha256'
        then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
      end if;
      insert into sma_private.file_job_uploads_v1(job_id,upload_id,export_id,artifact,source_asset_id,source_asset_revision,draft_revision,name,mime_type,size_bytes,sha256,initial_reservation)
       values(j.id,u.id,(ctx->>'export_id')::uuid,ctx->>'artifact',(ctx->>'source_asset_id')::uuid,ctx->>'source_asset_revision',
        (ctx->>'draft_revision')::integer,ctx->>'name',ctx->>'mime_type',(ctx->>'size_bytes')::bigint,ctx->>'sha256',r);
      if u.status='completed' and sma_private.file_job_note_asset_v1(j,u.id) is not true then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
     else
      r:=sma_private.publication_upload_request_v1('start',a-'kind');if r->'ok' is distinct from 'true'::jsonb then return r;end if;
      select * into u from sma_private.publication_uploads_v1 where id=(a->>'upload_id')::uuid and user_id=uid;
      if not found then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
      if u.asset_id is not null then select * into f from sma_private.publication_files_v1 where id=u.asset_id and user_id=uid;end if;
      insert into sma_private.file_jobs_v1(id,user_id,customer_id,anchor,anchor_key,upload_id,asset_id,asset_revision,initial_reservation)
       values(gen_random_uuid(),uid,u.customer_id,a,key,u.id,f.id,f.revision,r) returning * into j;
     end if;
    end if;
   end if;
  else return '{"ok":false,"code":"INVALID_INPUT"}';end if;
  if sma_private.file_job_current_v1(j) is not true then return '{"ok":false,"code":"JOB_UNAVAILABLE"}';end if;
  insert into sma_private.file_job_requests_v1(user_id,request_id,input_hash,job_id) values(uid,request,hash,j.id);
  return sma_private.file_job_view_v1(j);
 end if;
 -- Remaining command lifecycle is copied below with upload-scoped canonical IDs.
 if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('job_id','command_id','operation','input')) then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
 select * into j from sma_private.file_jobs_v1 where id=(p_input->>'job_id')::uuid and user_id=uid for update;
 if not found or sma_private.file_job_current_v1(j) is not true then return '{"ok":false,"code":"JOB_UNAVAILABLE"}';end if;
 command:=(p_input->>'command_id')::uuid;
 if p_action='get' then
  if p_input ? 'operation' or p_input ? 'input' then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
  select q.command_id into canonical from sma_private.file_command_requests_v1 q where q.id=command and q.job_id=j.id;
  command:=coalesce(canonical,command);
  select * into c from sma_private.file_commands_v1 where id=command and job_id=j.id;
  if found and sma_private.file_command_input_v1(j,c.operation,c.input) is not true then return '{"ok":false,"code":"COMMAND_BINDING_CHANGED"}';end if;
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
  select * into c from sma_private.file_commands_v1 where job_id=j.id and operation=op and input->>'upload_id'=a->>'upload_id' order by command_seq limit 1;
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

create or replace function sma_private.file_job_view_v1(j sma_private.file_jobs_v1,p_command_id uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('ok',true,'job_id',j.id,'state',case when j.deadline_at<=now() then 'expired'
   when j.execution_id is null and j.start_claimed_at<=now()-interval '60 seconds' then 'uncertain' else j.state end,
  'deadline_at',j.deadline_at,'asset_id',j.asset_id,'asset_revision',j.asset_revision,'can_publish',false,
  'commands',coalesce((select jsonb_agg(jsonb_build_object('command_id',c.id,'operation',c.operation,'state',c.state,
   'response',case when c.response_status is not null then jsonb_build_object('status',c.response_status,'body',
    case when c.operation='upload_start' and c.response_body ? 'upload_url' then
     case when sma_private.file_command_input_v1(j,c.operation,c.input) is not true then '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}'::jsonb else coalesce((select jsonb_build_object('ok',true,'status','completed','upload_id',u.id,'asset_id',u.asset_id,'can_publish',false)
       from sma_private.publication_uploads_v1 u where u.id=(c.input->>'upload_id')::uuid and u.user_id=j.user_id and u.customer_id=j.customer_id
        and u.status='completed' and u.asset_id is not null),
      case when j.deadline_at<=now() or not exists(select 1 from sma_private.publication_uploads_v1 u
       where u.id=(c.input->>'upload_id')::uuid and u.user_id=j.user_id and u.customer_id=j.customer_id and u.status='ready' and u.expires_at>now()) then '{"ok":false,"code":"UPLOAD_EXPIRED"}'::jsonb else c.response_body end) end
     else c.response_body end) end,
   'error_code',c.error_code) order by c.command_seq) from sma_private.file_commands_v1 c
   where c.job_id=j.id and (p_command_id is null or c.id=p_command_id)),'[]'::jsonb));
$$;

create or replace function sma_private.file_command_input_v1(j sma_private.file_jobs_v1,p_operation text,p_input jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare allowed text[];o sma_private.publication_orders_v1%rowtype;b sma_private.file_job_uploads_v1%rowtype;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>40000 then return false;end if;
 case p_operation
 when 'upload_start','upload_finish' then
  if coalesce(p_input->>'upload_id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then return false;end if;
  allowed:=case when p_operation='upload_start' then array['upload_id','name','mime_type','size_bytes'] else array['upload_id'] end;
  if j.upload_id is not null and p_input->>'upload_id'=j.upload_id::text then
   if not exists(select 1 from sma_private.publication_uploads_v1 u where u.id=j.upload_id and u.user_id=j.user_id and u.customer_id=j.customer_id
    and exists(select 1 from public.sma_kunden customer where customer.id=j.customer_id and customer.user_id=j.user_id
     and customer.n8n_kunde_id=u.n8n_kunde_id and customer.kunde_email=u.kunde_email)
    and (p_operation='upload_finish' or (u.name=p_input->>'name' and u.mime_type=p_input->>'mime_type' and u.size_bytes::text=p_input->>'size_bytes'))) then return false;end if;
  else
   select * into b from sma_private.file_job_uploads_v1 where job_id=j.id and upload_id=(p_input->>'upload_id')::uuid;
   if not found or sma_private.file_job_upload_current_v1(j,b) is not true then return false;end if;
   if p_operation='upload_start' and (b.name is distinct from p_input->>'name' or b.mime_type is distinct from p_input->>'mime_type'
    or b.size_bytes::text is distinct from p_input->>'size_bytes') then return false;end if;
  end if;
 when 'magic_photo','magic_video','review' then
  allowed:=array['asset_id','asset_revision'];
  if j.asset_id is null or sma_private.file_job_asset_current_v1(j,(p_input->>'asset_id')::uuid,p_input->>'asset_revision') is not true then return false;end if;
 when 'preview_prepare' then
  allowed:=array['request_id','source_text','audience','goal','language','media_kind','platforms'];
  if j.asset_id is null or not exists(select 1 from sma_private.publication_files_v1 f
   where f.user_id=j.user_id and f.customer_id=j.customer_id and f.media_kind=p_input->>'media_kind'
    and (f.id=j.asset_id or f.id in (select u.asset_id from sma_private.file_job_uploads_v1 family_upload
     join sma_private.publication_uploads_v1 u on u.id=family_upload.upload_id where family_upload.job_id=j.id and u.status='completed'))
    and sma_private.file_job_asset_current_v1(j,f.id,f.revision)) then return false;end if;
 when 'account' then
  allowed:=array['id','platform'];
  if j.asset_id is null or coalesce(p_input->>'id','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   or coalesce(p_input->>'platform','') not in ('youtube','tiktok') then return false;end if;
 when 'order_prepare' then
  allowed:=array['id','asset_id','asset_revision','platform','assignment_revision','preview_id','preview_revision','choices','expected_target_id'];
  if j.asset_id is null or sma_private.file_job_asset_current_v1(j,(p_input->>'asset_id')::uuid,p_input->>'asset_revision') is not true then return false;end if;
 when 'order_approve' then
  allowed:=array['id','approval_token','confirm','review'];
  select * into o from sma_private.publication_orders_v1 where id=(p_input->>'id')::uuid;
  if not found or o.user_id<>j.user_id or o.customer_id<>j.customer_id or j.asset_id is null
   or sma_private.file_job_asset_current_v1(j,(o.binding->>'asset_id')::uuid,o.binding->>'asset_revision') is not true then return false;end if;
 else return false;
 end case;
 return not exists(select 1 from jsonb_object_keys(p_input) k where not(k=any(allowed)));
exception when invalid_text_representation then return false;
end $$;

create or replace function sma_private.file_command_reserve_v1(j sma_private.file_jobs_v1,c sma_private.file_commands_v1,p_order_read boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old_sub text:=current_setting('request.jwt.claim.sub',true);r jsonb;
begin
 perform set_config('request.jwt.claim.sub',j.user_id::text,true);
 if p_order_read then
  if c.operation<>'order_approve' then r:='{"ok":false,"code":"INVALID_OPERATION"}';
  else r:=sma_private.publication_order_request_v1('get',jsonb_build_object('id',c.input->>'id'));end if;
 else
 case c.operation
 when 'upload_start' then
  if c.input->>'upload_id'=j.upload_id::text then r:=j.initial_reservation;
  else select b.initial_reservation into r from sma_private.file_job_uploads_v1 b where b.job_id=j.id and b.upload_id=(c.input->>'upload_id')::uuid;end if;
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

create or replace function public.sma_file_job_worker_v1(p_action text,p_input jsonb) returns jsonb
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
   select * into u from sma_private.publication_uploads_v1 where id=(c.input->>'upload_id')::uuid and user_id=j.user_id and customer_id=j.customer_id and status='completed';
   select * into f from sma_private.publication_files_v1 where id=u.asset_id and user_id=j.user_id and customer_id=j.customer_id and available;
   if f.id is null or body->>'upload_id' is distinct from c.input->>'upload_id' or body->>'asset_id' is distinct from f.id::text then return '{"ok":false,"code":"UPLOAD_INCOMPLETE"}';end if;
   if c.input->>'upload_id'=j.upload_id::text then
    if j.asset_id is not null and (j.asset_id<>f.id or j.asset_revision is distinct from f.revision) then return '{"ok":false,"code":"FILE_CHANGED"}';end if;
    update sma_private.file_jobs_v1 set asset_id=f.id,asset_revision=f.revision,initial_reservation=null where id=j.id;
   elsif sma_private.file_job_note_asset_v1(j,u.id) is not true then return '{"ok":false,"code":"UPLOAD_INCOMPLETE"}';end if;
  end if;
  update sma_private.file_commands_v1 set response_status=epoch,response_body=body where id=c.id;return '{"ok":true}';
 elsif p_action='completed' then
  if coalesce(p_input->>'outcome','') not in ('completed','failed') or coalesce(p_input->>'error_code','WORKER_FAILED')<>'WORKER_FAILED' then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
  if c.state in ('completed','failed') then
   if c.state<>p_input->>'outcome' then return '{"ok":false,"code":"RESULT_CONFLICT"}';end if;return '{"ok":true}';
  end if;
  if c.state<>'running' or (p_input->>'outcome'='completed' and c.response_status is null) then return '{"ok":false,"code":"RESULT_REQUIRED"}';end if;
  if c.operation='upload_finish' and p_input->>'outcome'='completed' and c.response_body->'ok'='true'::jsonb then
   select * into u from sma_private.publication_uploads_v1 where id=(c.input->>'upload_id')::uuid and user_id=j.user_id and customer_id=j.customer_id and status='completed';
   select * into f from sma_private.publication_files_v1 where id=u.asset_id and user_id=j.user_id and customer_id=j.customer_id and available;
   if f.id is null or c.response_body->>'upload_id' is distinct from c.input->>'upload_id' or c.response_body->>'asset_id' is distinct from f.id::text then return '{"ok":false,"code":"UPLOAD_INCOMPLETE"}';end if;
   if c.input->>'upload_id'=j.upload_id::text then
    update sma_private.file_jobs_v1 set asset_id=f.id,asset_revision=f.revision,initial_reservation=null where id=j.id;
   elsif sma_private.file_job_note_asset_v1(j,u.id) is not true then return '{"ok":false,"code":"UPLOAD_INCOMPLETE"}';end if;
  end if;
  update sma_private.file_commands_v1 set state=p_input->>'outcome',completed_at=now(),
   error_code=case when p_input->>'outcome'='failed' then 'WORKER_FAILED' end where id=c.id;return '{"ok":true}';
 end if;
 return '{"ok":false,"code":"INVALID_ACTION"}';
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then return '{"ok":false,"code":"INVALID_INPUT"}';
end $$;

revoke all on function public.sma_file_job_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_file_job_v1(text,jsonb) to authenticated;
revoke all on function public.sma_file_job_worker_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_file_job_worker_v1(text,jsonb) to service_role;
revoke all on function sma_private.file_job_view_v1(sma_private.file_jobs_v1,uuid),
 sma_private.file_command_input_v1(sma_private.file_jobs_v1,text,jsonb),
 sma_private.file_command_reserve_v1(sma_private.file_jobs_v1,sma_private.file_commands_v1,boolean) from public,anon,authenticated,service_role;
