-- Return the scheduled revision, including for unavailable entries, so a later
-- replacement or a second file with the same name cannot open in its place.
do $migration$
declare
  definition text := pg_get_functiondef('sma_private.publication_daily_schedule_v1(text,uuid,date,jsonb,bigint)'::regprocedure);
  needle text := $old$jsonb_build_object('name',f.name,'current',$old$;
  replacement text := $new$jsonb_build_object('asset_id',j.asset_id,'asset_revision',j.asset_revision,'media_kind',f.media_kind,'name',f.name,'current',$new$;
begin
  if array_length(string_to_array(definition,needle),1) <> 2 then
    raise exception 'SCHEDULE_FILE_CONTRACT_CHANGED';
  end if;
  execute replace(definition,needle,replacement);
end $migration$;
