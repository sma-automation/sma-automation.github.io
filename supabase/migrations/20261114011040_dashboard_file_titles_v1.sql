-- Opt-in display metadata for the existing authenticated dashboard file list.
-- Keep portal previews and the plain file catalog on their existing paths.
do $migration$
declare
  label_definition text:=pg_get_functiondef('sma_private.publication_optimizer_file_label_v1(sma_private.publication_files_v1,text)'::regprocedure);
  list_definition text:=pg_get_functiondef('sma_private.publication_files_request_v1(text,jsonb)'::regprocedure);
  label_anchor text:=$old$  select nullif(trim(a.draft->>'title'),'') into draft_title$old$;
  assignment_anchor text:=$old$'assigned' else 'changed' end) order by a.platform$old$;
  display_anchor text:=$old$    else '{}'::jsonb end item
   from sma_private.publication_files_v1 catalog_f$old$;
begin
  if length(label_definition)-length(replace(label_definition,label_anchor,''))<>length(label_anchor)
    or length(list_definition)-length(replace(list_definition,assignment_anchor,''))<>length(assignment_anchor)
    or length(list_definition)-length(replace(list_definition,display_anchor,''))<>length(display_anchor) then
    raise exception 'DASHBOARD_FILE_CATALOG_BASELINE_CHANGED';
  end if;
  -- The dashboard already joins assignments. Only resolve the verified file lineage here.
  execute replace(label_definition,label_anchor,$new$  if portal is null then
    return jsonb_strip_nulls(jsonb_build_object('variant',variant,'source_name',parent.name));
  end if;
$new$||label_anchor);
  list_definition:=replace(list_definition,assignment_anchor,$new$'assigned' else 'changed' end) ||
      case when p_input->'dashboard_labels'='true'::jsonb and p_input->>'platform' is null
        and a.asset_revision=catalog_f.revision and p.revision=a.preview_revision and p.status='completed'
        and p.user_id=catalog_f.user_id and p.customer_id=catalog_f.customer_id
        and jsonb_typeof(a.draft->'title')='string' and nullif(trim(a.draft->>'title'),'') is not null
      then jsonb_build_object('title',trim(a.draft->>'title')) else '{}'::jsonb end order by a.platform$new$);
  execute replace(list_definition,display_anchor,$new$    when p_input->'dashboard_labels'='true'::jsonb and p_input->>'platform' is null
    then jsonb_build_object('display',sma_private.publication_optimizer_file_label_v1(catalog_f,null))
$new$||display_anchor);
end $migration$;
