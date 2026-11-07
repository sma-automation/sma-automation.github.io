-- Display metadata for the authenticated optimizer catalog. File identity and names stay intact.
create function sma_private.publication_optimizer_file_label_v1(f sma_private.publication_files_v1, portal text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  parent sma_private.publication_files_v1%rowtype;
  output_kind text;
  variant text;
  draft_title text;
  product_name text;
begin
  -- Only completed exports whose current bytes match the recorded output get a version label.
  select artifact.kind, e.asset_id, e.asset_revision into output_kind,parent.id,parent.revision
  from sma_private.publication_editor_exports_v1 e
  cross join lateral (values ('media',e.media_asset_id),('cover',e.cover_asset_id)) artifact(kind,id)
  where e.user_id=f.user_id and e.customer_id=f.customer_id and e.completed_at is not null
    and artifact.id=f.id and f.revision ~ '^sha256:[a-f0-9]{64}:[0-9]+$'
    and e.outputs->artifact.kind->>'sha256'=split_part(f.revision,':',2)
    and e.outputs->artifact.kind->'size_bytes'=to_jsonb(f.size_bytes)
  order by e.completed_at desc,e.id desc limit 1;
  if found then
    select p.* into parent from sma_private.publication_files_v1 p
      where p.id=parent.id and p.revision=parent.revision and p.user_id=f.user_id and p.customer_id=f.customer_id and p.available;
    variant:=case when output_kind='cover' then 'cover'
      when f.media_kind='video' and parent.duration_ms-f.duration_ms>250 then 'clip' else 'export' end;
  elsif exists(select from sma_private.publication_editor_exports_v1 e where e.asset_id=f.id and e.asset_revision=f.revision
      and e.user_id=f.user_id and e.customer_id=f.customer_id and e.completed_at is not null) then
    variant:='original';
  end if;
  select nullif(trim(a.draft->>'title'),'') into draft_title
  from sma_private.publication_assignments_v1 a join sma_private.publication_previews_v1 p on p.id=a.preview_id
  where a.asset_id=f.id and a.asset_revision=f.revision and a.platform=portal and p.revision=a.preview_revision
    and p.status='completed' and p.user_id=f.user_id and p.customer_id=f.customer_id;
  product_name:=sma_private.publication_product_context_v1(case when output_kind='cover' and parent.id is not null then parent.id else f.id end)->>'name';
  return jsonb_strip_nulls(jsonb_build_object('variant',variant,'product',product_name,'draft_title',draft_title,'source_name',parent.name));
end $$;
revoke all on function sma_private.publication_optimizer_file_label_v1(sma_private.publication_files_v1,text)
  from public, anon, authenticated, service_role;

-- Extend only the list projection. Keep the installed dispatcher's account, revision and write checks.
do $$
declare
  definition text:=pg_get_functiondef('sma_private.publication_files_request_v1(text,jsonb)'::regprocedure);
  anchor text:=$old$),'[]')) item
   from sma_private.publication_files_v1 catalog_f$old$;
  replacement text:=$new$),'[]')) || case when p_input->>'platform' in ('youtube','tiktok','instagram','facebook')
    then jsonb_build_object('display',sma_private.publication_optimizer_file_label_v1(catalog_f,p_input->>'platform'))
    else '{}'::jsonb end item
   from sma_private.publication_files_v1 catalog_f$new$;
begin
  if (length(definition)-length(replace(definition,anchor,'')))<>length(anchor) then
    raise exception 'PUBLICATION_FILES_LIST_CHANGED';
  end if;
  execute replace(definition,anchor,replacement);
end $$;
