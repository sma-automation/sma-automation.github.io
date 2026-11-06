-- Browser-rendered derivatives are private preparation files, never publication approval.
create table if not exists sma_private.publication_editor_exports_v1 (
 id uuid primary key, user_id uuid not null, customer_id bigint not null,
 asset_id uuid not null, asset_revision text not null, draft_revision integer not null,
 settings jsonb not null, outputs jsonb not null, cover_upload_id uuid not null default gen_random_uuid(),
 media_asset_id uuid, cover_asset_id uuid, created_at timestamptz not null default now(), completed_at timestamptz
);
create index if not exists publication_editor_exports_v1_owner_created on sma_private.publication_editor_exports_v1(user_id,customer_id,created_at desc);
alter table sma_private.publication_editor_exports_v1 enable row level security;
revoke all on sma_private.publication_editor_exports_v1 from public,anon,authenticated,service_role;

create or replace function sma_private.publication_editor_export_request_v1(p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid();c public.sma_kunden%rowtype;f sma_private.publication_files_v1%rowtype;d sma_private.publication_editor_drafts_v1%rowtype;
 j sma_private.publication_editor_exports_v1%rowtype;u sma_private.publication_uploads_v1%rowtype;r sma_private.publication_files_v1%rowtype;
 s jsonb;outp jsonb;artifact_key text;expected_id uuid;result_ids jsonb:='{}';mime text;filename text;has_cover boolean;items jsonb;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_action is null or p_action not in ('prepare','complete','list') or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>3000
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('asset_id','asset_revision','draft_revision','export_id','outputs'))
  or coalesce(p_input->>'asset_id','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or jsonb_typeof(p_input->'asset_revision') is distinct from 'string' or char_length(p_input->>'asset_revision') not between 1 and 250 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if (select count(*) from public.sma_kunden where user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end if;
 select * into c from public.sma_kunden where user_id=uid for update;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 select * into f from sma_private.publication_files_v1 where id=(p_input->>'asset_id')::uuid and user_id=uid and customer_id=c.id and available for update;
 if not found then return jsonb_build_object('ok',false,'code','FILE_UNAVAILABLE');end if;
 if f.revision is distinct from p_input->>'asset_revision' then return jsonb_build_object('ok',false,'code','FILE_CHANGED');end if;
 if p_action='list' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('asset_id','asset_revision')) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  select coalesce(jsonb_agg(q.item order by q.completed_at desc),'[]') into items from (
   select e.completed_at,jsonb_build_object('export_id',e.id,'draft_revision',e.draft_revision,'completed_at',e.completed_at,
    'media',jsonb_build_object('asset_id',m.id,'asset_revision',m.revision,'name',m.name),'cover',case when co.id is not null then jsonb_build_object('asset_id',co.id,'asset_revision',co.revision,'name',co.name) else null end) item
   from sma_private.publication_editor_exports_v1 e
   join sma_private.publication_files_v1 m on m.id=e.media_asset_id and m.user_id=e.user_id and m.customer_id=e.customer_id and m.available and m.revision ~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$' and split_part(m.revision,':',2)=e.outputs->'media'->>'sha256'
   left join sma_private.publication_files_v1 co on co.id=e.cover_asset_id and co.user_id=e.user_id and co.customer_id=e.customer_id and co.available and co.revision ~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$' and split_part(co.revision,':',2)=e.outputs->'cover'->>'sha256'
   where e.user_id=uid and e.customer_id=c.id and e.asset_id=f.id and e.asset_revision=f.revision and e.completed_at is not null
    and (e.cover_asset_id is null or co.id is not null)
   order by e.completed_at desc limit 5) q;
  return jsonb_build_object('ok',true,'version',1,'can_publish',false,'exports',items);
 end if;
 if coalesce(p_input->>'export_id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  or jsonb_typeof(p_input->'draft_revision') is distinct from 'number' or coalesce(p_input->>'draft_revision','') !~ '^[0-9]{1,9}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into d from sma_private.publication_editor_drafts_v1 where asset_id=f.id and asset_revision=f.revision;
 if found and (d.user_id<>uid or d.customer_id<>c.id) then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end if;
 if coalesce(d.revision,0)<>(p_input->>'draft_revision')::integer then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT');end if;
 s:=coalesce(d.settings,sma_private.publication_editor_defaults_v1());
 if f.mime_type not in ('video/mp4','image/jpeg','image/png','image/webp') or f.size_bytes not between 1 and 24000000
  or f.width_px is null or f.height_px is null or f.width_px not between 1 and 4096 or f.height_px not between 1 and 4096
  or f.width_px::bigint*f.height_px>12000000 or (f.media_kind='video' and (f.duration_ms is null or f.duration_ms not between 1 and 60000))
  then return jsonb_build_object('ok',false,'code','EXPORT_UNSUPPORTED');end if;
 has_cover:=f.media_kind='video' and s->'cover_ms'<>'null'::jsonb;
 select * into j from sma_private.publication_editor_exports_v1 where id=(p_input->>'export_id')::uuid for update;
 if found and (j.user_id<>uid or j.customer_id<>c.id or j.asset_id<>f.id or j.asset_revision<>f.revision or j.draft_revision<>coalesce(d.revision,0) or j.settings<>s) then return jsonb_build_object('ok',false,'code','EXPORT_CONFLICT');end if;
 if p_action='prepare' then
  outp:=p_input->'outputs';
  if jsonb_typeof(outp) is distinct from 'object' or (select count(*) from jsonb_object_keys(outp))<>2 or not(outp?'media' and outp?'cover') then return jsonb_build_object('ok',false,'code','INVALID_OUTPUT');end if;
  foreach artifact_key in array array['media','cover'] loop
   if artifact_key='cover' and not has_cover then if outp->artifact_key<>'null'::jsonb then return jsonb_build_object('ok',false,'code','INVALID_OUTPUT');end if;continue;end if;
   if jsonb_typeof(outp->artifact_key) is distinct from 'object' or (select count(*) from jsonb_object_keys(outp->artifact_key))<>2 or not((outp->artifact_key)?'sha256' and (outp->artifact_key)?'size_bytes')
    or coalesce(outp->artifact_key->>'sha256','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(outp->artifact_key->'size_bytes') is distinct from 'number'
    or coalesce(outp->artifact_key->>'size_bytes','') !~ '^[1-9][0-9]{0,7}$' then return jsonb_build_object('ok',false,'code','INVALID_OUTPUT');end if;
   if (outp->artifact_key->>'size_bytes')::bigint>24000000 then return jsonb_build_object('ok',false,'code','INVALID_OUTPUT');end if;
  end loop;
  if j.id is not null then
   if j.outputs<>outp then return jsonb_build_object('ok',false,'code','EXPORT_CONFLICT');end if;
  else
   if (select count(*) from sma_private.publication_editor_exports_v1 where user_id=uid and customer_id=c.id and created_at>now()-interval '1 hour')>=10 then return jsonb_build_object('ok',false,'code','RATE_LIMITED');end if;
   insert into sma_private.publication_editor_exports_v1(id,user_id,customer_id,asset_id,asset_revision,draft_revision,settings,outputs)
    values((p_input->>'export_id')::uuid,uid,c.id,f.id,f.revision,coalesce(d.revision,0),s,outp) returning * into j;
  end if;
 else
  if p_input?'outputs' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  if j.id is null then return jsonb_build_object('ok',false,'code','EXPORT_UNAVAILABLE');end if;
  foreach artifact_key in array array['media','cover'] loop
   if artifact_key='cover' and not has_cover then continue;end if;
   expected_id:=case when artifact_key='media' then j.id else j.cover_upload_id end;
   mime:=case when artifact_key='media' and f.media_kind='video' then 'video/mp4' else 'image/png' end;
   filename:='SMA-Export-'||j.id::text||case when artifact_key='cover' then '-Cover.png' when f.media_kind='video' then '.mp4' else '.png' end;
   select * into u from sma_private.publication_uploads_v1 where id=expected_id and user_id=uid and customer_id=c.id and status='completed';
   if not found or u.n8n_kunde_id is distinct from c.n8n_kunde_id or lower(u.kunde_email) is distinct from lower(c.kunde_email) or u.name<>filename or u.mime_type<>mime or u.size_bytes<>(j.outputs->artifact_key->>'size_bytes')::bigint then return jsonb_build_object('ok',false,'code','EXPORT_INCOMPLETE');end if;
   select * into r from sma_private.publication_files_v1 where id=u.asset_id and user_id=uid and customer_id=c.id and available;
   if not found or r.id=f.id or r.drive_file_id<>u.drive_file_id or r.name<>filename or r.mime_type<>mime or r.size_bytes<>u.size_bytes or r.revision !~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$' or split_part(r.revision,':',2) is distinct from j.outputs->artifact_key->>'sha256' then return jsonb_build_object('ok',false,'code','EXPORT_INCOMPLETE');end if;
   result_ids:=result_ids||jsonb_build_object(artifact_key,r.id);
  end loop;
  if j.completed_at is null then update sma_private.publication_editor_exports_v1 set media_asset_id=(result_ids->>'media')::uuid,cover_asset_id=(result_ids->>'cover')::uuid,completed_at=now() where id=j.id returning * into j;end if;
 end if;
 return jsonb_build_object('ok',true,'version',1,'can_publish',false,'export_id',j.id,'draft_revision',j.draft_revision,'status',case when j.completed_at is null then 'prepared' else 'completed' end,
  'media',jsonb_build_object('upload_id',j.id,'name','SMA-Export-'||j.id::text||case when f.media_kind='video' then '.mp4' else '.png' end,'mime_type',case when f.media_kind='video' then 'video/mp4' else 'image/png' end,'asset_id',j.media_asset_id),
  'cover',case when has_cover then jsonb_build_object('upload_id',j.cover_upload_id,'name','SMA-Export-'||j.id::text||'-Cover.png','mime_type','image/png','asset_id',j.cover_asset_id) else null end);
end $$;
revoke all on function sma_private.publication_editor_export_request_v1(text,jsonb) from public,anon,service_role;
grant execute on function sma_private.publication_editor_export_request_v1(text,jsonb) to authenticated;
create or replace function public.sma_publication_editor_export_v1(p_action text,p_input jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select sma_private.publication_editor_export_request_v1(p_action,p_input);$$;
revoke all on function public.sma_publication_editor_export_v1(text,jsonb) from public,anon,service_role;
grant execute on function public.sma_publication_editor_export_v1(text,jsonb) to authenticated;

-- Authenticated source-byte proxy uses the existing owner/folder gate, with bounded media.
create or replace function sma_private.publication_editor_source_v1(p_asset_id uuid,p_revision text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;f sma_private.publication_files_v1%rowtype;
begin
 r:=sma_private.publication_asset_preview_v1(p_asset_id,p_revision);
 if r->>'ok'<>'true' then return r;end if;
 select * into f from sma_private.publication_files_v1 where id=p_asset_id;
 if f.mime_type not in ('video/mp4','image/jpeg','image/png','image/webp') or f.size_bytes not between 1 and 24000000
  then return jsonb_build_object('ok',false,'code','EXPORT_UNSUPPORTED');end if;
 return r||jsonb_build_object('width_px',f.width_px,'height_px',f.height_px,'duration_ms',f.duration_ms);
end $$;
revoke all on function sma_private.publication_editor_source_v1(uuid,text) from public,anon,service_role;
grant execute on function sma_private.publication_editor_source_v1(uuid,text) to authenticated;
create or replace function public.sma_publication_editor_source_v1(p_asset_id uuid,p_revision text)
returns jsonb language sql security invoker set search_path='' as $$select sma_private.publication_editor_source_v1(p_asset_id,p_revision);$$;
revoke all on function public.sma_publication_editor_source_v1(uuid,text) from public,anon,service_role;
grant execute on function public.sma_publication_editor_source_v1(uuid,text) to authenticated;
