-- Enable unattended dispatch only for enrolled galleries, including when more customers join.
alter table sma_private.publication_rotation_sources_v1
  add column background_dispatch boolean not null default false;
update sma_private.publication_rotation_sources_v1 set background_dispatch=true
where exists(select from sma_private.portal_schedule_transport_v1 where enabled);

create function sma_private.portal_background_enabled_v1(src uuid) returns boolean
language sql stable security invoker set search_path='' as $fn$
 select exists(select from sma_private.publication_rotation_sources_v1 s
   where s.id=src and s.background_dispatch)
 and exists(select from sma_private.portal_schedule_transport_v1 where enabled)
$fn$;
revoke all on function sma_private.portal_background_enabled_v1(uuid) from public,anon,authenticated,service_role;

do $migration$
declare
 item record;
 definition text;
begin
 for item in select * from (values
  ('public.sma_manual_portal_v1(text,text,uuid,text,uuid,uuid,timestamptz)',
   'exists(select from sma_private.portal_schedule_transport_v1 where enabled)','sma_private.portal_background_enabled_v1(src)'),
  ('public.sma_refresh_portal_folder_v1(text)',
   'exists(select from sma_private.portal_schedule_transport_v1 where enabled)','sma_private.portal_background_enabled_v1(src)'),
  ('sma_private.wake_custom_portal_schedule_v1()',
   'from sma_private.custom_portal_due_v1 order by source_id','from sma_private.custom_portal_due_v1 where sma_private.portal_background_enabled_v1(source_id) order by source_id'),
  ('public.sma_claim_portal_schedule_v1(uuid)',
   'if not found then return jsonb_build_object(''jobs'',jobs);','if not found or not sma_private.portal_background_enabled_v1(src) then return jsonb_build_object(''jobs'',jobs);'),
  ('public.sma_claim_manual_portal_scan_v1(uuid)',
   'return jsonb_build_object(''source_id'',src);','return jsonb_build_object(''source_id'',case when sma_private.portal_background_enabled_v1(src) then src end);')
 ) as edits(signature,previous,updated) loop
  definition:=pg_get_functiondef(item.signature::regprocedure);
  if array_length(string_to_array(definition,item.previous),1)<>2 then
    raise exception 'Unexpected dispatch contract in %',item.signature;
  end if;
  execute replace(definition,item.previous,item.updated);
 end loop;
end $migration$;
