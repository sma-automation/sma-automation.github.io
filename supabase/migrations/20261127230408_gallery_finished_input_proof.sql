-- Let the file picker use the same exact-revision proof as the posting and scheduling guards.
do $migration$
declare
  definition text := pg_get_functiondef('sma_private.portal_gallery_previews_v1(bigint,uuid,jsonb)'::regprocedure);
  previous text := 'case when shown.creator_logo then ''verified'' else ''private_preview_only'' end';
  updated text := 'case when sma_private.portal_media_verified_v1(profile.source_id,profile.platform,f.item->>''revision'') then ''verified'' else ''private_preview_only'' end';
begin
  if array_length(string_to_array(definition,previous),1) <> 2 then
    raise exception 'PORTAL_GALLERY_BASE_CHANGED';
  end if;
  execute replace(definition,previous,updated);
end $migration$;
