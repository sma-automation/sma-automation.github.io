-- A profile gallery lists only content verified in that customer's portal folder.
-- A list without a platform remains the complete customer file search.
do $migration$
declare
  definition text := pg_get_functiondef('sma_private.publication_files_request_v1(text,jsonb)'::regprocedure);
  anchor text := 'catalog_f.customer_id=c.id and catalog_f.available order by catalog_f.modified_at';
  replacement text := $filter$catalog_f.customer_id=c.id and catalog_f.available
     and (not (p_input ? 'platform') or exists (
       select from sma_private.publication_rotation_sources_v1 source
       join sma_private.publication_portal_content_v1 membership on membership.source_id=source.id
       where source.owner_id=uid and source.customer_id=c.id
         and membership.platform=p_input->>'platform'
         and catalog_f.revision ~ '^sha256:[a-f0-9]{64}:[0-9]+$'
         and membership.digest=split_part(catalog_f.revision,':',2)
     )) order by catalog_f.modified_at$filter$;
begin
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'PORTAL_GALLERY_BASELINE_CHANGED';
  end if;
  execute replace(definition,anchor,replacement);
end $migration$;
