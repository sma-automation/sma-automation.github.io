-- Storage compatibility for Windows/Brave AAC (ADTS) uploads, 09 Nov 2026.
-- Browser sends audio/vnd.dlna.adts; catalog's AAC sidecar path and SHA remain strict.
-- No client write privileges, customer data, credits, scheduled jobs or posting rights change.
do $sma_windows_aac$
declare
  old_definition text;
  old_predicate text := 'a.metadata->>''mimetype''=''audio/aac''';
  new_predicate text := 'a.metadata->>''mimetype'' in (''audio/aac'',''audio/vnd.dlna.adts'')';
  old_types text[];
begin
  select allowed_mime_types into old_types from storage.buckets
    where id='sma-katalog' and public=false and file_size_limit=8000000;
  if old_types is distinct from array['audio/mpeg','audio/wav','audio/aac']::text[] then
    raise exception 'Unexpected SMA private music bucket config';
  end if;
  if (select md5(prosrc) from pg_proc
      where oid='sma_private.gallery_background_pick_v1()'::regprocedure)
     <> 'c4a38484a0218563954a58c7a3edfe3f' then
    raise exception 'Unexpected gallery background picker source';
  end if;
  old_definition := pg_get_functiondef('sma_private.gallery_background_pick_v1()'::regprocedure);
  if old_definition is null or
     (length(old_definition)-length(replace(old_definition,old_predicate,'')))<>length(old_predicate) then
    raise exception 'AAC MIME predicate missing or not unique';
  end if;
  -- Preserve the existing definer's ownership, grants, expiry, bound paths and size checks.
  execute replace(old_definition,old_predicate,new_predicate);
  update storage.buckets
     set allowed_mime_types=array_append(allowed_mime_types,'audio/vnd.dlna.adts')
   where id='sma-katalog';
end $sma_windows_aac$;
