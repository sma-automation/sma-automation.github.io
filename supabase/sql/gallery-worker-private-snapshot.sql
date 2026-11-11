-- Offline-only SQL proposal: trusted read-only snapshot for a private gallery worker.
-- No client-facing RPC, no job creation, no uploads, no credits, no publishing.
-- Deployed separately only after explicit approval. Its result is NOT proof
-- of media decoding: the server worker must fetch and hash all three objects.

do $guard$
begin
 if to_regprocedure('sma_private.gallery_worker_snapshot_v1(uuid)') is not null then
  raise exception 'GALLERY_WORKER_SNAPSHOT_ALREADY_EXISTS';
 end if;
end;
$guard$;

create function sma_private.gallery_worker_snapshot_v1(p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare
 j sma_private.gallery_music_v1%rowtype;
 s sma_private.publication_files_v1%rowtype;
 r sma_private.publication_files_v1%rowtype;
 c public.sma_kunden%rowtype;
 audio_count integer;
 audio_name text;
 audio_sha text;
 audio_size_text text;
 audio_mime text;
begin
 if p_job_id is null then return null; end if;
 select * into j from sma_private.gallery_music_v1
  where id=p_job_id and state='completed';
 if not found or j.result_id is null or j.expected_sha !~ '^[a-f0-9]{64}$'
    or j.track_sha !~ '^[a-f0-9]{64}$'
    or j.expected_size not between 12 and 24000000
    or j.source_key !~ '^sha256:[a-f0-9]{64}$' then
  return null;
 end if;
 select * into c from public.sma_kunden
  where id=j.customer_id and user_id=j.user_id
    and aktiv and (demo_delta_aktiv or zahlung_bestaetigt);
 if not found then return null; end if;
 select * into s from sma_private.publication_files_v1
  where id=j.source_id and customer_id=j.customer_id and user_id=j.user_id
    and available and media_kind='video' and mime_type='video/mp4'
    and size_bytes between 12 and 24000000;
 if not found then return null; end if;
 select * into r from sma_private.publication_files_v1
  where id=j.result_id and customer_id=j.customer_id and user_id=j.user_id
    and available and media_kind='video' and mime_type='video/mp4'
    and size_bytes between 12 and 24000000;
 if not found or r.id=s.id or r.drive_file_id=s.drive_file_id then return null; end if;
 if s.revision !~ '^sha256:[a-f0-9]{64}:[0-9]+$'
    or r.revision !~ '^sha256:[a-f0-9]{64}:[0-9]+$'
    or sma_private.gallery_music_key_v1(s.revision) is distinct from j.source_key
    or split_part(r.revision,':',2) is distinct from j.expected_sha
    or r.size_bytes is distinct from j.expected_size
    or s.drive_file_id !~ '^[A-Za-z0-9_-]{10,100}$'
    or r.drive_file_id !~ '^[A-Za-z0-9_-]{10,100}$' then
  return null;
 end if;

 -- An already-completed job may refer to an unlisted private music track.
 -- Never select a different track as a substitute. Reject ambiguous sidecars.
 select count(*)::integer,min(o.name),min(o.metadata->>'size'),
  min(o.metadata->>'mimetype')
 into audio_count,audio_name,audio_size_text,audio_mime
 from storage.objects o
 where o.bucket_id='sma-katalog'
   and o.name like 'render/'||j.track_sha||'/%'
   and o.name ~ ('^render/'||j.track_sha||'/[a-f0-9]{64}[.]aac$');
 if audio_count<>1 or audio_name is null
    or audio_mime is null or audio_mime not in ('audio/aac','audio/vnd.dlna.adts')
    or audio_size_text is null or audio_size_text !~ '^[1-9][0-9]{0,6}$'
    or audio_size_text::bigint>1500000 then return null; end if;
 audio_sha:=split_part(split_part(audio_name,'/',3),'.',1);
 if audio_sha !~ '^[a-f0-9]{64}$' then return null; end if;

 return jsonb_build_object(
  'gallery_job_id',j.id,'state','completed',
  'customer_id',j.customer_id,'user_id',j.user_id,'customer_active',true,
  'source_key',j.source_key,'expected_sha',j.expected_sha,
  'expected_size',j.expected_size,'track_sha',j.track_sha,
  'audio_sha256',audio_sha,'audio_object_name',audio_name,
  'audio_size_bytes',audio_size_text::bigint,
  'source',jsonb_build_object(
   'asset_id',s.id,'drive_file_id',s.drive_file_id,'revision',s.revision,
   'size_bytes',s.size_bytes,'available',true,'media_kind','video',
   'mime_type','video/mp4'),
  'result',jsonb_build_object(
   'asset_id',r.id,'drive_file_id',r.drive_file_id,'revision',r.revision,
   'size_bytes',r.size_bytes,'available',true,'media_kind','video',
   'mime_type','video/mp4')
 );
end;
$function$;

-- A private-schema, service-only read; browsers cannot request account lists.
revoke all on function sma_private.gallery_worker_snapshot_v1(uuid)
 from public,anon,authenticated,service_role;
grant execute on function sma_private.gallery_worker_snapshot_v1(uuid)
 to service_role;
