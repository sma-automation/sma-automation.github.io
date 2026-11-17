-- Join browser-rendered gallery music to the existing 24-hour file family.
-- No new RPC action, native workflow, upload, renderer or publication permission.
-- Existing editor foreign keys keep their meaning; music has its own real FK.
do $guard$
declare identity text; expected text; columns jsonb;
begin
 for identity,expected in select * from (values
  ('public.sma_file_job_v1(text,jsonb)','f795675cf23c6e6dc9d0f24326cdc2d7'),
  ('sma_private.file_job_export_context_v1(uuid)','0fa7a8b33f769275c338d36fbd7bf2a6'),
  ('sma_private.file_job_upload_current_v1(sma_private.file_jobs_v1,sma_private.file_job_uploads_v1)','34f65839882dda724290c8efc6671159')
 ) as baseline(identity,expected) loop
  if md5(pg_get_functiondef(identity::regprocedure)) is distinct from expected then
   raise exception 'Unexpected music-family baseline: %',identity;
  end if;
 end loop;
 -- The new binding and receipt path relies on these unchanged business
 -- contracts. Check their complete bodies in the same migration transaction.
 for identity,expected in select * from (values
  ('sma_private.gallery_music_key_v1(text)','ae0359ae3d775c1ed3c8c34b9a95205c'),
  ('sma_private.gallery_music_receive_file_v1()','66773f1225a26da915adaa9083c37c51'),
  ('sma_private.gallery_music_request_v1(text,jsonb)','b09821da4bd99e69a7d78df71265ef2c'),
  ('sma_private.publication_upload_request_v1(text,jsonb)','7faa29962bc995db7b6c3dc0e88edef1'),
  ('public.sma_publication_upload_finish_v1(uuid,jsonb)','21f4b04102dc5df1ab1fb0bfab530f8e')
 ) as dependency(identity,expected) loop
  if (select md5(prosrc) from pg_proc where oid=identity::regprocedure) is distinct from expected then
   raise exception 'Unexpected music-family dependency: %',identity;
  end if;
 end loop;
 select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) order by attnum)
 into columns from pg_attribute where attrelid='sma_private.file_job_uploads_v1'::regclass and attnum>0 and not attisdropped;
 if columns is distinct from '[
  ["job_id","uuid",true],["upload_id","uuid",true],["export_id","uuid",true],["artifact","text",true],
  ["source_asset_id","uuid",true],["source_asset_revision","text",true],["draft_revision","integer",true],
  ["name","text",true],["mime_type","text",true],["size_bytes","bigint",true],["sha256","text",true],["initial_reservation","jsonb",true]
 ]'::jsonb or (select relrowsecurity from pg_class where oid='sma_private.file_job_uploads_v1'::regclass) is not true then
  raise exception 'Unexpected music-family upload schema';
 end if;
 if (select jsonb_object_agg(conname,pg_get_constraintdef(oid)) from pg_constraint
     where conrelid='sma_private.file_job_uploads_v1'::regclass and contype<>'n') is distinct from
  jsonb_build_object(
   'file_job_uploads_v1_artifact_check',$c$CHECK ((artifact = ANY (ARRAY['media'::text, 'cover'::text])))$c$,
   'file_job_uploads_v1_export_id_fkey','FOREIGN KEY (export_id) REFERENCES sma_private.publication_editor_exports_v1(id)',
   'file_job_uploads_v1_job_id_export_id_artifact_key','UNIQUE (job_id, export_id, artifact)',
   'file_job_uploads_v1_job_id_fkey','FOREIGN KEY (job_id) REFERENCES sma_private.file_jobs_v1(id)',
   'file_job_uploads_v1_pkey','PRIMARY KEY (job_id, upload_id)',
   'file_job_uploads_v1_sha256_check',$c$CHECK ((sha256 ~ '^[a-f0-9]{64}$'::text))$c$,
   'file_job_uploads_v1_size_bytes_check','CHECK (((size_bytes >= 1) AND (size_bytes <= 24000000)))',
   'file_job_uploads_v1_upload_id_fkey','FOREIGN KEY (upload_id) REFERENCES sma_private.publication_uploads_v1(id)') then
  raise exception 'Unexpected music-family upload constraints';
 end if;
end $guard$;

alter table sma_private.file_job_uploads_v1
 add column gallery_music_id uuid references sma_private.gallery_music_v1(id),
 add column music_track_sha text references sma_private.music_catalog_v1(sha256),
 alter column export_id drop not null,
 alter column draft_revision drop not null,
 drop constraint file_job_uploads_v1_artifact_check,
 add constraint file_job_uploads_v1_artifact_check check(artifact in ('media','cover','music')),
 add constraint file_job_uploads_v1_kind_check check(
  (artifact in ('media','cover') and export_id is not null and draft_revision is not null
   and gallery_music_id is null and music_track_sha is null)
  or (artifact='music' and export_id is null and draft_revision is null
   and gallery_music_id is not null and gallery_music_id=upload_id and music_track_sha is not null)
 );
create index file_job_uploads_music_v1 on sma_private.file_job_uploads_v1(gallery_music_id) where gallery_music_id is not null;
create index file_job_uploads_music_track_v1 on sma_private.file_job_uploads_v1(music_track_sha) where music_track_sha is not null;

-- This private resolver separates immutable output proof from permission to
-- create a NEW binding. A retry may renew/clear its gallery lease after binding.
-- source_key identifies bytes; the current full source revision is frozen by
-- the existing family insert. No caller supplies a source, track or export ID.
create function sma_private.file_job_music_context_v1(p_upload uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare m sma_private.gallery_music_v1%rowtype;f sma_private.publication_files_v1%rowtype;
 u sma_private.publication_uploads_v1%rowtype;c public.sma_kunden%rowtype;receipt boolean:=false;current_source boolean;
begin
 select * into m from sma_private.gallery_music_v1 where id=p_upload;
 if not found then return null;end if;
 if exists(select 1 from sma_private.publication_editor_exports_v1 e where e.id=p_upload or e.cover_upload_id=p_upload)
  then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
 select * into f from sma_private.publication_files_v1 where id=m.source_id;
 if not found or f.user_id<>m.user_id or f.customer_id<>m.customer_id
  or m.expected_sha is null or m.expected_sha!~'^[a-f0-9]{64}$' or m.expected_size is null or m.expected_size not between 12 and 24000000
  or m.track_sha is null or m.state not in ('pending','check_upload','completed')
  then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
 current_source:=f.available and f.media_kind='video' and f.mime_type='video/mp4' and f.size_bytes between 12 and 24000000
  and sma_private.gallery_music_key_v1(f.revision)=m.source_key;
 select * into c from public.sma_kunden where id=m.customer_id and user_id=m.user_id;
 if not found then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
 select * into u from sma_private.publication_uploads_v1 where id=p_upload;
 if found then
  if u.user_id<>m.user_id or u.customer_id<>m.customer_id or u.name<>m.name or u.mime_type<>'video/mp4' or u.size_bytes<>m.expected_size
   or u.n8n_kunde_id is distinct from c.n8n_kunde_id or u.kunde_email is distinct from c.kunde_email
   then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
  select exists(select 1 from sma_private.publication_files_v1 result where result.id<>m.source_id
   and result.user_id=m.user_id and result.customer_id=m.customer_id and result.available
   and result.drive_file_id=u.drive_file_id and result.name=m.name and result.media_kind='video' and result.mime_type='video/mp4'
   and result.size_bytes=m.expected_size and result.revision ~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$'
   and split_part(result.revision,':',2)=m.expected_sha
   and ((u.status='completed' and u.asset_id=result.id and (m.result_id is null or m.result_id=result.id))
    or (u.status='ready' and m.state='completed' and m.result_id=result.id and (u.asset_id is null or u.asset_id=result.id)))) into receipt;
 end if;
 if (m.state='completed' or u.status='completed') and not receipt then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
 if m.background_audio is not null and not receipt then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
 return jsonb_build_object('ok',true,'artifact','music','gallery_music_id',m.id,'music_track_sha',m.track_sha,
  'user_id',m.user_id,'customer_id',m.customer_id,'source_asset_id',m.source_id,'source_asset_revision',f.revision,
  'source_current',current_source,'family_adoptable',u.id is null or u.status='completed' or u.expires_at>now(),
  'draft_current',(m.state='pending' and m.background_audio is null and m.lease is not null and m.lease_until>now()
    and exists(select 1 from sma_private.music_catalog_ready_v1 track where track.sha256=m.track_sha and sma_private.music_track_access_v1(c,track.sha256)))
    or (receipt and u.status='completed'),
  'receipt_current',receipt,'result_asset_id',case when u.status='completed' then u.asset_id else m.result_id end,
  'name',m.name,'mime_type','video/mp4','size_bytes',m.expected_size,'sha256',m.expected_sha);
end $$;
revoke all on function sma_private.file_job_music_context_v1(uuid) from public,anon,authenticated,service_role;

create or replace function sma_private.file_job_upload_current_v1(j sma_private.file_jobs_v1,b sma_private.file_job_uploads_v1) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare ctx jsonb;
begin
 if b.artifact='music' then
  ctx:=sma_private.file_job_music_context_v1(b.upload_id);
  -- Preserve the full revision saved at authorization. An editor-derived
  -- source can gain a Drive counter without changing its bytes; the root
  -- parent's independent current-revision check remains unchanged.
  return coalesce(b.job_id=j.id and b.gallery_music_id=b.upload_id and ctx->'ok'='true'::jsonb
   and ctx->>'user_id'=j.user_id::text and ctx->>'customer_id'=j.customer_id::text and ctx->'source_current'='true'::jsonb
   and ctx->>'source_asset_id'=b.source_asset_id::text
   and sma_private.gallery_music_key_v1(ctx->>'source_asset_revision')=sma_private.gallery_music_key_v1(b.source_asset_revision)
   and ctx->>'music_track_sha'=b.music_track_sha and ctx->>'name'=b.name and ctx->>'mime_type'=b.mime_type
   and ctx->>'size_bytes'=b.size_bytes::text and ctx->>'sha256'=b.sha256
   and exists(select 1 from sma_private.publication_uploads_v1 u where u.id=b.upload_id
    and u.user_id=j.user_id and u.customer_id=j.customer_id and u.name=b.name and u.mime_type=b.mime_type and u.size_bytes=b.size_bytes
    and exists(select 1 from public.sma_kunden c where c.id=j.customer_id and c.user_id=j.user_id
     and c.n8n_kunde_id=u.n8n_kunde_id and c.kunde_email=u.kunde_email)),false);
 end if;
 return coalesce(not exists(select 1 from sma_private.gallery_music_v1 m where m.id=b.upload_id)
  and exists(select 1 from sma_private.publication_editor_exports_v1 e
  join sma_private.publication_uploads_v1 u on u.id=b.upload_id
  where b.job_id=j.id and e.id=b.export_id and e.user_id=j.user_id and e.customer_id=j.customer_id
   and e.asset_id=b.source_asset_id and e.asset_revision=b.source_asset_revision and e.draft_revision=b.draft_revision
   and (case b.artifact when 'media' then e.id else e.cover_upload_id end)=b.upload_id
   and e.outputs->b.artifact->>'sha256'=b.sha256 and (e.outputs->b.artifact->>'size_bytes')::bigint=b.size_bytes
   and u.user_id=j.user_id and u.customer_id=j.customer_id and u.name=b.name and u.mime_type=b.mime_type and u.size_bytes=b.size_bytes
   and exists(select 1 from public.sma_kunden c where c.id=j.customer_id and c.user_id=j.user_id
    and c.n8n_kunde_id=u.n8n_kunde_id and c.kunde_email=u.kunde_email)),false);
end $$;

-- A catalogue receipt can precede upload_finish when the browser closes after
-- sending the bytes. Reconcile only a fully proved receipt owned by an existing
-- active parent, using the unchanged upload-finish contract and lock order.
-- Expired historical receipts remain ordinary asset candidates; neither their
-- upload deadline nor their old native parent is revived.
create function sma_private.file_job_music_reconcile_v1(p_asset uuid,p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m sma_private.gallery_music_v1%rowtype;u sma_private.publication_uploads_v1%rowtype;
 f sma_private.publication_files_v1%rowtype;j sma_private.file_jobs_v1%rowtype;b sma_private.file_job_uploads_v1%rowtype;ctx jsonb;r jsonb;
begin
 select * into m from sma_private.gallery_music_v1 where result_id=p_asset and user_id=p_user and state='completed';
 if not found then return '{"ok":true}';end if;
 if (select count(*) from sma_private.gallery_music_v1 where result_id=p_asset)<>1 then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
 select * into u from sma_private.publication_uploads_v1 where id=m.id;
 -- Completed uploads already use the existing alias/legacy authorization.
 -- Only the ready-receipt gap needs this additional reconciliation path.
 if u.status='completed' and u.asset_id=p_asset then return '{"ok":true}';end if;
 ctx:=sma_private.file_job_music_context_v1(m.id);
 if ctx->'ok' is distinct from 'true'::jsonb or ctx->'receipt_current' is distinct from 'true'::jsonb
  then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
 if u.status is distinct from 'ready' then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
 select g.* into j from sma_private.file_jobs_v1 g where g.user_id=p_user
  and g.state in ('queued','running','waiting','uncertain') and g.deadline_at>now()
  and (g.upload_id=u.id or (g.asset_id=p_asset and g.asset_revision=(select revision from sma_private.publication_files_v1 where id=p_asset))
   or exists(select 1 from sma_private.file_job_uploads_v1 x where x.job_id=g.id and x.upload_id=u.id))
  order by (g.upload_id=u.id or g.asset_id=p_asset) desc,g.created_at,g.id limit 1 for update;
 if not found then return '{"ok":true}';end if;
 -- A historical result can already have its own ordinary asset parent. That
 -- parent does not depend on completing or renewing the old music upload.
 if j.asset_id=p_asset and j.upload_id is distinct from u.id and not exists(
  select 1 from sma_private.file_job_uploads_v1 x where x.job_id=j.id and x.upload_id=u.id)
  then return '{"ok":true}';end if;
 -- Native reserve/finish takes these locks in this order too. Re-read after
 -- acquiring them: a catalogue update that won the race must never be replaced
 -- with the older metadata observed while locating the parent.
 select * into u from sma_private.publication_uploads_v1 where id=m.id for update;
 if not found then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
 select * into f from sma_private.publication_files_v1 where id=p_asset for update;
 if not found then return '{"ok":false,"code":"FILE_UNAVAILABLE"}';end if;
 ctx:=sma_private.file_job_music_context_v1(m.id);
 if ctx->'ok' is distinct from 'true'::jsonb or ctx->'receipt_current' is distinct from 'true'::jsonb
  or ctx->>'result_asset_id' is distinct from p_asset::text or f.user_id<>p_user or f.customer_id<>j.customer_id or not f.available
  then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
 if sma_private.file_job_current_v1(j) is not true or j.customer_id<>m.customer_id then return '{"ok":false,"code":"JOB_UNAVAILABLE"}';end if;
 if j.state='uncertain' then return '{"ok":false,"code":"JOB_UNCERTAIN"}';end if;
 if u.status='completed' then return '{"ok":true}';end if;
 if u.status<>'ready' then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
 if u.expires_at<=now() then return '{"ok":false,"code":"UPLOAD_EXPIRED"}';end if;
 if j.upload_id is distinct from u.id and j.asset_id is distinct from p_asset then
  select * into b from sma_private.file_job_uploads_v1 where job_id=j.id and upload_id=u.id;
  if not found or b.artifact<>'music' or sma_private.file_job_upload_current_v1(j,b) is not true
   then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
 end if;
 r:=public.sma_publication_upload_finish_v1(u.id,jsonb_build_object('upload_id',u.id,'drive_file_id',f.drive_file_id,
  'folder_id',u.folder_id,'name',f.name,'mime_type',f.mime_type,'media_kind',f.media_kind,'size_bytes',f.size_bytes,
  'revision',f.revision,'modified_at',f.modified_at,'width_px',f.width_px,'height_px',f.height_px,'duration_ms',f.duration_ms));
 if r->'ok' is distinct from 'true'::jsonb then return r;end if;
 if r->>'asset_id' is distinct from p_asset::text then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
 return '{"ok":true}';
end $$;
revoke all on function sma_private.file_job_music_reconcile_v1(uuid,uuid) from public,anon,authenticated,service_role;

do $patch$
declare original text;anchor text;replacement text;block_start integer;block_end integer;music text;
begin
 select pg_get_functiondef('sma_private.file_job_export_context_v1(uuid)'::regprocedure) into original;
 anchor:=$old$ if matches=0 then return null;end if;$old$;
 replacement:=$new$ if exists(select 1 from sma_private.gallery_music_v1 m where m.id=p_upload) then
  if matches<>0 then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
  return sma_private.file_job_music_context_v1(p_upload);
 end if;
 if matches=0 then return null;end if;$new$;
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected music resolver anchor';end if;
 execute replace(original,anchor,replacement);

 select pg_get_functiondef('public.sma_file_job_v1(text,jsonb)'::regprocedure) into original;
 anchor:=$old$   return sma_private.file_job_view_v1(j);
  end if;
  update sma_private.file_jobs_v1$old$;
 replacement:=$new$   if a->>'kind'='upload' then
    select * into b from sma_private.file_job_uploads_v1 where job_id=j.id and upload_id=(a->>'upload_id')::uuid;
    if found and sma_private.file_job_upload_current_v1(j,b) is not true then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;
   end if;
   return sma_private.file_job_view_v1(j);
  end if;
  update sma_private.file_jobs_v1$new$;
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected music replay anchor';end if;
 original:=replace(original,anchor,replacement);
 anchor:=$old$   key:='asset:'||f.id::text||':'||f.revision;$old$;
 replacement:=$new$   r:=sma_private.file_job_music_reconcile_v1(f.id,uid);
   if r->'ok' is distinct from 'true'::jsonb then return r;end if;
   key:='asset:'||f.id::text||':'||f.revision;$new$;
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected music receipt anchor';end if;
 original:=replace(original,anchor,replacement);
 anchor:=$old$     if ctx is not null and ctx->'source_current'='true'::jsonb then$old$;
 replacement:=$new$     if ctx is not null and ctx->'source_current'='true'::jsonb and coalesce(ctx->'family_adoptable','true'::jsonb)='true'::jsonb then$new$;
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected music historical anchor';end if;
 original:=replace(original,anchor,replacement);
 anchor:=$old$      if ctx->'draft_current' is distinct from 'true'::jsonb then return '{"ok":false,"code":"REVISION_CONFLICT"}';end if;$old$;
 replacement:=$new$      if ctx->>'artifact'='music' and ctx->'family_adoptable' is distinct from 'true'::jsonb then return '{"ok":false,"code":"UPLOAD_EXPIRED"}';end if;
      if ctx->'draft_current' is distinct from 'true'::jsonb then
       return jsonb_build_object('ok',false,'code',case when ctx->>'artifact'='music' then 'LEASE_CHANGED' else 'REVISION_CONFLICT' end);
      end if;$new$;
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected music lease anchor';end if;
 original:=replace(original,anchor,replacement);
 anchor:=$old$file_job_uploads_v1(job_id,upload_id,export_id,artifact,source_asset_id,source_asset_revision,draft_revision,name,mime_type,size_bytes,sha256,initial_reservation)$old$;
 replacement:=$new$file_job_uploads_v1(job_id,upload_id,export_id,artifact,source_asset_id,source_asset_revision,draft_revision,name,mime_type,size_bytes,sha256,initial_reservation,gallery_music_id,music_track_sha)$new$;
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>2 then raise exception 'Unexpected music family insert anchors';end if;
 original:=replace(original,anchor,replacement);
 anchor:=$old$(ctx->>'size_bytes')::bigint,ctx->>'sha256',r);$old$;
 replacement:=$new$(ctx->>'size_bytes')::bigint,ctx->>'sha256',r,(ctx->>'gallery_music_id')::uuid,ctx->>'music_track_sha');$new$;
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>2 then raise exception 'Unexpected music family values anchors';end if;
 original:=replace(original,anchor,replacement);
 -- Only a new music binding needs this additional atomic boundary. Reuse the
 -- guarded authoritative join code; leave the editor branch byte-for-byte
 -- unchanged. Every rejected music join rolls back its recursive source start,
 -- reservation and aliases before returning the original business error.
 anchor:=$old$      -- Reuse the same authoritative asset join, including completed-result$old$;
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected music atomic start anchor';end if;
 block_start:=strpos(original,anchor);
 anchor:=$old$      if u.status='completed' and sma_private.file_job_note_asset_v1(j,u.id) is not true then return '{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';end if;$old$;
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected music atomic end anchor';end if;
 block_end:=strpos(original,anchor)+length(anchor)-1;
 if block_end<=block_start then raise exception 'Unexpected music atomic block';end if;
 anchor:=substring(original from block_start for block_end-block_start+1);
 if (length(anchor)-length(replace(anchor,'return ','')))/length('return ')<>8 then raise exception 'Unexpected music atomic return paths';end if;
 music:=regexp_replace(anchor,$re$return ([^;]+);$re$,
  $raise$r:=\1; raise exception using errcode='SMF01',message='Music family reservation rejected';$raise$,'g');
 replacement:=$new$      if ctx->>'artifact'='music' then
       begin
$new$||music||$new$
        if sma_private.file_job_current_v1(j) is not true then
         r:='{"ok":false,"code":"JOB_UNAVAILABLE"}';raise exception using errcode='SMF01',message='Music family source changed';
        end if;
        select * into b from sma_private.file_job_uploads_v1 where job_id=j.id and upload_id=u.id;
        if sma_private.file_job_upload_current_v1(j,b) is not true then
         r:='{"ok":false,"code":"UPLOAD_UNAVAILABLE"}';raise exception using errcode='SMF01',message='Music family binding changed';
        end if;
        insert into sma_private.file_job_requests_v1(user_id,request_id,input_hash,job_id) values(uid,request,hash,j.id);
        return sma_private.file_job_view_v1(j);
       exception when sqlstate 'SMF01' then return r;
       end;
      else
$new$||anchor||$new$
      end if;$new$;
 original:=substring(original from 1 for block_start-1)||replacement||substring(original from block_end+1);
 execute original;
end $patch$;
