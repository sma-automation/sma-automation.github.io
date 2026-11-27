-- Reuse the immutable cover binding on an explicitly requested empty TikTok restart.
-- The provider still fences the lease and validates the original order and exact bytes.
do $migration$
declare
 cover text:=pg_get_functiondef('sma_private.publication_provider_cover_request_v1(text,uuid,uuid,jsonb)'::regprocedure);
 original text:='if r->''ok''=''true''::jsonb and r->>''operation''=''init'' then';
 drive text:=rtrim(rtrim(pg_get_viewdef('sma_private.scheduled_drive_files_v1'::regclass)), ';');
 previous text:='WHERE (a.order_id = o.id)';
begin
 if array_length(string_to_array(cover,original),1)<>2 or array_length(string_to_array(drive,previous),1)<>2 then raise exception 'Unexpected provider restart contract';end if;
 execute replace(cover,original,'if r->''ok''=''true''::jsonb and r->>''operation''=''init'' and cv.order_id is null then');
 execute 'create or replace view sma_private.scheduled_drive_files_v1 with (security_invoker=true) as '||
 replace(drive,previous,'WHERE (a.order_id = o.id) and not sma_private.manual_restart_allowed_v1(o.id)');
end $migration$;
