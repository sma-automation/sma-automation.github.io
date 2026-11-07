-- Add the saved caption on the same owner-scoped rows already selected for cover history.
do $migration$
declare
  reader regprocedure := 'sma_private.publication_history_read_v3(jsonb)'::regprocedure;
  definition text := pg_get_functiondef(reader);
  marker constant text := $field$'cover',sma_private.publication_history_cover_v1(j)$field$;
  caption constant text := $field$'order_caption',case
    when j.binding->>'platform' in ('youtube','tiktok','instagram','facebook')
      and j.draft->>'platform'=j.binding->>'platform'
      and jsonb_typeof(j.draft->'caption')='string'
      and octet_length(j.draft->>'caption') between 1 and 5000
      and (j.draft->>'caption') ~ '[^[:space:]]'
    then j.draft->>'caption' end,$field$;
begin
  if array_length(string_to_array(definition,marker),1)<>2
     or position('''order_caption''' in definition)>0 then
    raise exception 'PUBLICATION_HISTORY_CAPTION_BASELINE_CHANGED';
  end if;
  execute replace(definition,marker,caption||marker);
end
$migration$;
