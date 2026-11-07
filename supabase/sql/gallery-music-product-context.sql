-- A music version is identified by the completed job and the server-bound upload.
-- The current filename can change. The Drive file and its content must still match.
create function sma_private.gallery_music_source_file_v1(output_file sma_private.publication_files_v1)
returns setof sma_private.publication_files_v1
language sql stable security invoker rows 1 set search_path='' as $$
 select source.*
 from sma_private.publication_uploads_v1 u
 join sma_private.gallery_music_v1 j on j.id=u.id and j.state='completed' and j.track_sha is not null
 join sma_private.publication_files_v1 source on source.id=j.source_id
 join public.sma_kunden c on c.id=j.customer_id and c.user_id=j.user_id
 where u.drive_file_id=output_file.drive_file_id and j.result_id=output_file.id
   and u.customer_id=c.id and u.user_id=c.user_id
   and u.n8n_kunde_id=c.n8n_kunde_id and u.kunde_email=c.kunde_email
   and (u.status='completed' and u.asset_id=output_file.id or u.status='ready' and u.asset_id is null)
   and u.name=j.name and u.mime_type='video/mp4' and u.size_bytes=j.expected_size
   and output_file.customer_id=c.id and output_file.user_id=c.user_id and output_file.available
   and output_file.media_kind='video' and output_file.mime_type=u.mime_type
   and output_file.size_bytes=j.expected_size and output_file.revision ~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$'
   and split_part(output_file.revision,':',2)=j.expected_sha
   and source.id<>output_file.id and source.user_id=c.user_id and source.customer_id=c.id and source.available
   and source.media_kind='video' and source.mime_type='video/mp4'
   and sma_private.gallery_music_key_v1(source.revision)=j.source_key;
$$;
revoke all on function sma_private.gallery_music_source_file_v1(sma_private.publication_files_v1)
 from public,anon,authenticated,service_role;

do $migration$
declare
 context_fn regprocedure:='sma_private.publication_product_context_v1(uuid)'::regprocedure;
 label_fn regprocedure:='sma_private.publication_optimizer_file_label_v1(sma_private.publication_files_v1,text)'::regprocedure;
 first_edge integer;
 next_cte integer;
 label_anchor text:='  elsif exists(select from sma_private.publication_editor_exports_v1 e where e.asset_id=f.id';
 definition text;
begin
 if (select md5(prosrc) from pg_proc where oid=context_fn)<>'79f63af16f5ceaafda1003a1589faa0a'
 or (select md5(prosrc) from pg_proc where oid=label_fn)<>'4f156948081d8db1ed0e24e01f1c4470' then
  raise exception 'GALLERY_PRODUCT_BASELINE_CHANGED';
 end if;
 -- Both edge types participate in the same deduplicated recursive walk.
 definition:=pg_get_functiondef(context_fn);
 first_edge:=strpos(definition,'    select parent.id,parent.revision,parent.size_bytes');
 next_cte:=strpos(definition,'  ), labels(value) as (');
 if first_edge=0 or next_cte<=first_edge then raise exception 'PRODUCT_LINEAGE_MISSING'; end if;
 execute left(definition,first_edge-1)||$new$    select parent.id,parent.revision,parent.size_bytes
    from lineage child
    cross join lateral (
      select p.id,p.revision,p.size_bytes
      from sma_private.publication_editor_exports_v1 e
      join sma_private.publication_files_v1 p on p.id=e.asset_id and p.revision=e.asset_revision
      where e.media_asset_id=child.id and e.customer_id=customer.id and e.user_id=owner_id and e.completed_at is not null
        and child.revision ~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$'
        and e.outputs#>>'{media,sha256}'=split_part(child.revision,':',2)
        and e.outputs#>'{media,size_bytes}'=to_jsonb(child.size_bytes)
        and p.user_id=owner_id and p.customer_id=customer.id and p.available
      union all
      select source.id,source.revision,source.size_bytes
      from sma_private.publication_files_v1 output_file
      cross join lateral sma_private.gallery_music_source_file_v1(output_file) source
      where output_file.id=child.id and output_file.revision=child.revision
        and output_file.user_id=owner_id and output_file.customer_id=customer.id
    ) parent
$new$||substr(definition,next_cte);

 -- Prefer the music receipt to the generic "original" label of a later editor export.
 execute replace(pg_get_functiondef(label_fn),label_anchor,$new$  else
    select source.* into parent from sma_private.gallery_music_source_file_v1(f) source;
    if found then
      variant:='soundtrack';
    end if;
  end if;
  if variant is null and exists(select from sma_private.publication_editor_exports_v1 e where e.asset_id=f.id$new$);
end $migration$;
