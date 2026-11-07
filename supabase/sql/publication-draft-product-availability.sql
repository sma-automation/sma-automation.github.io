-- Report the saved product's current public availability on read, assignment, and save.
-- Use the same scoped test as the service handoff; ordinary shop links need no listing.
do $migration$
declare
 rpc regprocedure:='sma_private.publication_files_request_v1(text,jsonb)'::regprocedure;
 definition text:=pg_get_functiondef(rpc);
 marker text:=$old$'revision',j.revision,'assignment_revision',b.revision)$old$;
begin
 if length(definition)-length(replace(definition,marker,''))<>3*length(marker) then
  raise exception 'PUBLICATION_DRAFT_RESPONSE_CHANGED';
 end if;
 execute replace(definition,marker,$new$'revision',j.revision,'assignment_revision',b.revision,
  'product_link_available',case when b.draft?'product_id' then
    jsonb_typeof(b.draft->'product_id')='string' and
    sma_private.publication_product_link_available_v1(c,b.draft->>'product_id') is true end)$new$);
end $migration$;
