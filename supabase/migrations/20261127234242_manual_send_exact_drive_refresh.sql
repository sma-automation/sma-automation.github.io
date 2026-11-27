-- The existing Drive worker must refresh an explicitly requested immediate send at its
-- actual send time. Its ordinary rotation slot can be hours later.
do $migration$
declare scheduled text:=rtrim(rtrim(pg_get_viewdef('sma_private.scheduled_drive_files_v1'::regclass)), ';');
begin
 execute 'create or replace view sma_private.scheduled_drive_files_v1 with (security_invoker=true) as
 select previous.* from ('||scheduled||') previous
 where not exists (select from sma_private.manual_portal_sends_v1 m where m.order_id=previous.order_id
   and sma_private.manual_send_window_v1(m.order_id))
 union all
 select o.id,m.source_id,enabled.platform,o.target->>''id'',f.id,f.revision,
   f.drive_file_id,f.size_bytes,f.mime_type,i.digest,c.n8n_kunde_id,f.verified_at,o.state,m.due_at
 from sma_private.manual_portal_sends_v1 m
 join sma_private.publication_orders_v1 o on o.id=m.order_id
 join sma_private.scheduled_drive_sources_v1 enabled on enabled.source_id=m.source_id and enabled.platform=o.binding->>''platform''
 join public.sma_kunden c on (c.id,c.user_id)=(o.customer_id,o.user_id)
 join sma_private.publication_files_v1 f on (f.id::text,f.revision,f.customer_id,f.user_id)=(o.binding->>''asset_id'',o.binding->>''asset_revision'',o.customer_id,o.user_id)
 join sma_private.publication_rotation_imports_v1 i on i.source_id=m.source_id and i.copy_id=f.drive_file_id
 where o.approved_at is not null and sma_private.portal_background_enabled_v1(m.source_id)
 and sma_private.manual_send_window_v1(m.order_id) and f.available and i.verified_at is not null
 and i.digest=split_part(f.revision,'':'',2)
 and (o.state in (''approved'',''checked'') or (o.state=''blocked'' and o.blockers=''["FILE_REFRESH_REQUIRED"]''::jsonb))
 and not exists(select from sma_private.publication_provider_attempts_v1 a where a.order_id=o.id)';
end $migration$;
