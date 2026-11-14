-- Widen the existing atomic snapshot without replacing the installed revision,
-- tenant, concurrent upload or lease checks. Dashboard and portal read the same snapshot.
do $migration$
declare
  list_def text := pg_get_functiondef('sma_private.publication_files_request_v1(text,jsonb)'::regprocedure);
  finish_def text := pg_get_functiondef('public.sma_publication_files_finish_v1(uuid,uuid,jsonb,text)'::regprocedure);
  list_order text := 'order by catalog_f.modified_at desc,catalog_f.id';
  list_anchor text := list_order || ' limit 1000';
  count_anchor text := 'jsonb_array_length(p_files)>1000 or ';
  size_anchor text := $old$if jsonb_typeof(p_files) is distinct from 'array' or octet_length(p_files::text)>2000000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;$old$;
begin
  if length(list_def) - length(replace(list_def,list_anchor,'')) <> length(list_anchor)
     or length(finish_def) - length(replace(finish_def,count_anchor,'')) <> length(count_anchor)
     or length(finish_def) - length(replace(finish_def,size_anchor,'')) <> length(size_anchor) then
    raise exception 'PUBLICATION_FILE_CATALOG_BASELINE_CHANGED';
  end if;
  execute replace(list_def,list_anchor,list_order);
  finish_def := replace(finish_def,count_anchor,'');
  execute replace(finish_def,size_anchor,$new$if jsonb_typeof(p_files) is distinct from 'array' then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
 if octet_length(p_files::text)>4000000 then
  return jsonb_build_object('ok',false,'code','FILE_CATALOG_TOO_LARGE');
 end if;$new$);
end $migration$;
