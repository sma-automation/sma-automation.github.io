-- One destination ID per source and content digest, including after a timeout or concurrent delivery.
create table sma_private.publication_rotation_imports_v1 (
  source_id uuid not null references sma_private.publication_rotation_sources_v1(id),
  digest text not null check(digest ~ '^[0-9a-f]{64}$'),
  original_id text not null, copy_id text not null unique, verified_at timestamptz,
  primary key(source_id,digest)
);
alter table sma_private.publication_rotation_imports_v1 enable row level security;
revoke all on sma_private.publication_rotation_imports_v1 from public,anon,authenticated;
create function public.sma_rotation_import_v1(p_source uuid,p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cfg sma_private.publication_rotation_sources_v1%rowtype; client public.sma_kunden%rowtype;
  item sma_private.publication_rotation_imports_v1%rowtype; file jsonb; dimensions jsonb;
  expected_digest text:=p_input->>'digest'; revision text; width_px int; height_px int; duration_ms bigint;
begin
  select * into strict cfg from sma_private.publication_rotation_sources_v1 where id=p_source;
  select * into strict client from public.sma_kunden where id=cfg.customer_id and user_id=cfg.owner_id
    and aktiv and (demo_delta_aktiv or zahlung_bestaetigt);
  if p_action='context' then
    return jsonb_build_object('source',cfg.source_folder,'destination',cfg.processing_folder,
      'completed',coalesce((select jsonb_agg(i.digest) from sma_private.publication_rotation_imports_v1 i
        where i.source_id=cfg.id and i.verified_at is not null),'[]'::jsonb),
      'n8n_kunde_id',client.n8n_kunde_id,'kunde_email',client.kunde_email,'ok',true);
  end if;
  if p_action='reserve' then
    if coalesce(expected_digest,'') !~ '^[0-9a-f]{64}$' or coalesce(p_input->>'original_id','') !~ '^[A-Za-z0-9_-]{10,200}$'
      or coalesce(p_input->>'copy_id','') !~ '^[A-Za-z0-9_-]{10,200}$' then raise exception 'INVALID_IMPORT'; end if;
    insert into sma_private.publication_rotation_imports_v1(source_id,digest,original_id,copy_id)
      values(cfg.id,expected_digest,p_input->>'original_id',p_input->>'copy_id') on conflict(source_id,digest) do nothing;
    select * into strict item from sma_private.publication_rotation_imports_v1 where source_id=cfg.id and publication_rotation_imports_v1.digest=p_input->>'digest';
    return jsonb_build_object('id',item.copy_id,'ok',true);
  end if;
  if p_action='verify' then
    file:=p_input->'file';
    select * into strict item from sma_private.publication_rotation_imports_v1
      where source_id=cfg.id and publication_rotation_imports_v1.digest=p_input->>'digest' for update;
    if file->>'id' is distinct from item.copy_id or file->'parents' is distinct from jsonb_build_array(cfg.processing_folder)
      or file->'trashed' is distinct from 'false'::jsonb or file->>'sha256Checksum' is distinct from item.digest
      or file->'appProperties'->>'sma_rotation_source' is distinct from cfg.id::text
      or coalesce(file->>'mimeType','') !~ '^video/[a-zA-Z0-9.+-]+$' or coalesce(file->>'version','') !~ '^[0-9]{1,30}$'
      or coalesce(file->>'size','') !~ '^[1-9][0-9]{0,17}$' or coalesce(length(file->>'name'),0) not between 1 and 500
      or file->>'name' ~ '[[:cntrl:]]' or coalesce(file->>'modifiedTime','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T'
      then raise exception 'IMPORT_COPY_CHANGED'; end if;
    -- The dashboard may already be processing a full listing. Let it finish its own lease first.
    perform 1 from sma_private.publication_file_sync_v1 where user_id=cfg.owner_id for update;
    if exists(select from sma_private.publication_file_sync_v1 where user_id=cfg.owner_id and lease_until>now()) then raise exception 'FILE_SYNC_RUNNING'; end if;
    revision:='sha256:'||item.digest||':'||(file->>'version');
    dimensions:=file->'videoMediaMetadata';
    width_px:=nullif(dimensions->>'width','')::int; height_px:=nullif(dimensions->>'height','')::int;
    duration_ms:=nullif(dimensions->>'durationMillis','')::bigint;
    insert into sma_private.publication_files_v1 as f(customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,width_px,height_px,duration_ms)
      values(client.id,client.user_id,item.copy_id,file->>'name','video',file->>'mimeType',revision,(file->>'modifiedTime')::timestamptz,
        (file->>'size')::bigint,width_px,height_px,duration_ms)
    on conflict(customer_id,drive_file_id) do update set name=excluded.name,mime_type=excluded.mime_type,revision=excluded.revision,
      modified_at=excluded.modified_at,size_bytes=excluded.size_bytes,available=true,verified_at=now(),
      width_px=coalesce(excluded.width_px,f.width_px),height_px=coalesce(excluded.height_px,f.height_px),duration_ms=coalesce(excluded.duration_ms,f.duration_ms)
      where f.user_id=excluded.user_id and split_part(f.revision,':',2)=item.digest;
    if not found then raise exception 'IMPORT_COPY_CHANGED'; end if;
    update sma_private.publication_rotation_imports_v1 set verified_at=now() where source_id=cfg.id and publication_rotation_imports_v1.digest=item.digest;
    return jsonb_build_object('ok',true,'verified',true);
  end if;
  raise exception 'INVALID_ACTION';
end $$;
revoke all on function public.sma_rotation_import_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sma_rotation_import_v1(uuid,text,jsonb) to service_role;
