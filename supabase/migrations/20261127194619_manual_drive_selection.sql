create function public.sma_manual_drive_selection_v1(p_drive text default null,p_sha text default null)
returns jsonb language sql stable security definer set search_path='' as $$
 with files as materialized (
  select f.id,f.revision,f.drive_file_id,s.id source_id,m.platform,m.digest
  from public.sma_kunden k join sma_private.publication_rotation_sources_v1 s
   on (s.customer_id,s.owner_id)=(k.id,k.user_id)
  join sma_private.publication_portal_content_v1 m on m.source_id=s.id
  join sma_private.publication_files_v1 f on (f.customer_id,f.user_id)=(k.id,k.user_id)
   and split_part(f.revision,':',2)=m.digest
  where k.user_id=auth.uid() and k.aktiv and (k.zahlung_bestaetigt or k.demo_delta_aktiv)
   and f.available and f.media_kind='video' and f.mime_type='video/mp4'
   and ((p_drive ~ '^[A-Za-z0-9_-]{10,200}$' and p_sha is null) or
        (p_sha ~ '^[0-9a-f]{64}$' and p_drive is null))
 ), matches as (
  select 1 priority,f.id,f.revision,f.platform from files f where f.drive_file_id=p_drive or f.digest=p_sha
  union
  select 0,d.id,d.revision,d.platform from sma_private.portal_media_intake_v1 j
  join sma_private.portal_media_profiles_v1 p using(source_id,platform,folder_id,logo_sha,music_sha)
  join sma_private.publication_portal_folders_v1 b using(source_id,platform,folder_id)
  join files d on (d.source_id,d.platform,d.digest)=(j.source_id,j.platform,j.output_sha)
  join files o on (o.source_id,o.platform,o.digest)=(j.source_id,j.platform,j.input_sha)
  where j.finished_at is not null and j.saved_id is not null and
   (p_drive in(j.drive_id,j.saved_id,o.drive_file_id,d.drive_file_id) or p_sha in(j.input_sha,j.output_sha))
 ), best as (select distinct id,revision,platform from matches where priority=(select min(priority) from matches))
 select case when count(*)=1 then jsonb_agg(to_jsonb(best))->0 else jsonb_build_object('code',case when count(*)>1 then 'AMBIGUOUS' else 'FILE_UNAVAILABLE' end) end from best;
$$;
revoke all on function public.sma_manual_drive_selection_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.sma_manual_drive_selection_v1(text,text) to authenticated;
