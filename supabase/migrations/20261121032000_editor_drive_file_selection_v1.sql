-- Resolve a pasted Drive file link against the signed-in user's current SMA catalog.
-- This lookup never opens the URL and never reads a remote file.
create function sma_private.editor_drive_file_v1(p_drive_file_id text)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce((
    select jsonb_build_object('ok',true,'files',jsonb_build_array(jsonb_build_object(
      'id',f.id,'revision',f.revision,'name',f.name,'mime_type',f.mime_type,'media_kind',f.media_kind,
      'duration_ms',f.duration_ms,'width_px',f.width_px,'height_px',f.height_px,
      'modified_at',f.modified_at,'size_bytes',f.size_bytes)))
    from public.sma_kunden c
    join sma_private.publication_files_v1 f on f.customer_id=c.id and f.user_id=c.user_id
    where c.user_id=auth.uid() and c.aktiv and (c.demo_delta_aktiv or c.zahlung_bestaetigt)
      and (select count(*) from public.sma_kunden k where k.user_id=auth.uid())=1
      and p_drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'
      and f.available and f.drive_file_id=p_drive_file_id
  ),jsonb_build_object('ok',false,'code','FILE_UNAVAILABLE'));
$$;
revoke all on function sma_private.editor_drive_file_v1(text) from public, anon, authenticated, service_role;
grant execute on function sma_private.editor_drive_file_v1(text) to authenticated;
create function public.sma_editor_drive_file_v1(p_drive_file_id text)
returns jsonb language sql stable security invoker set search_path='' as $$
  select sma_private.editor_drive_file_v1(p_drive_file_id);
$$;
revoke all on function public.sma_editor_drive_file_v1(text) from public, anon, authenticated, service_role;
grant execute on function public.sma_editor_drive_file_v1(text) to authenticated;
