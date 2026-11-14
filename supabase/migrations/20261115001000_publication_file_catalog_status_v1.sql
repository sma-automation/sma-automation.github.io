-- Read the file list, last complete timestamp and latest attempt in one snapshot.
-- The existing reservation and finish operations already maintain these timestamps.
do $migration$
declare
  definition text := pg_get_functiondef('sma_private.publication_files_request_v1(text,jsonb)'::regprocedure);
  list_start text := $old$select coalesce(jsonb_agg(x.item order by x.modified_at desc,x.id),'[]') into items from ($old$;
  list_end text := $old$) x;
  select * into s from sma_private.publication_file_sync_v1 where user_id=uid;
  return jsonb_build_object('ok',true,'files',items,'synced_at',s.finished_at);$old$;
begin
  if length(definition)-length(replace(definition,list_start,'')) <> length(list_start)
     or length(definition)-length(replace(definition,list_end,'')) <> length(list_end) then
    raise exception 'PUBLICATION_FILE_CATALOG_LIST_CHANGED';
  end if;
  definition := replace(definition,list_start,$new$with catalog as (
   select coalesce(jsonb_agg(x.item order by x.modified_at desc,x.id),'[]') as files from ($new$);
  execute replace(definition,list_end,$new$) x
  )
  select jsonb_build_object('ok',true,'files',catalog.files,'synced_at',sync.finished_at) ||
    case when p_input->'dashboard_labels'='true'::jsonb and p_input->>'platform' is null
      then jsonb_build_object('sync_state',case
        when sync.lease_id is not null and sync.lease_until > statement_timestamp() then 'running'
        when sync.lease_id is not null or (sync.started_at is not null and
          (sync.finished_at is null or sync.started_at > sync.finished_at)) then 'interrupted'
        when sync.finished_at is not null then 'complete'
        else 'idle' end)
      else '{}'::jsonb end into items
  from catalog left join sma_private.publication_file_sync_v1 sync
    on sync.user_id=uid and sync.customer_id=c.id;
  return items;$new$);
end $migration$;
