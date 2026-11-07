-- Trusted local decoding of completed exports; clients can only read the media check.
do $$begin
 if md5((select prosrc from pg_proc where oid='sma_private.publication_video_technical_valid_v1(jsonb,text)'::regprocedure)) <> 'eac3452fa6adf80616898fd72a357fa7'
 or md5((select prosrc from pg_proc where oid='sma_private.publication_video_technical_v1(sma_private.publication_files_v1)'::regprocedure)) <> '8afda52db5f72c2e2d27bbada70d2909'
 or md5((select prosrc from pg_proc where oid='sma_private.publication_media_precheck_v1(sma_private.publication_files_v1,text)'::regprocedure)) <> '946d7d9650f01021ce2553d3b7cc8adf'
 then raise exception 'EXPORT_PROBE_BASELINE_CHANGED'; end if;
end $$;

CREATE OR REPLACE FUNCTION sma_private.publication_video_streams_valid_v1(t jsonb, has_audio boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare k text; n numeric;
begin
 if jsonb_typeof(t) is distinct from 'object' then return false; end if;
 if (select count(*) from jsonb_object_keys(t))<>16
 or exists(select 1 from jsonb_object_keys(t) fields(name) where fields.name not in ('schema','decode','video_codec','pixel_format','width_px','height_px','frame_rate_num','frame_rate_den','decoded_frames','min_frame_interval_us','max_frame_interval_us','video_bit_rate_bps','audio_codec','audio_sample_rate_hz','audio_channels','audio_bit_rate_bps'))
 or t->>'schema' is distinct from 'sma-video-technical-v1' or t->>'decode' is distinct from 'complete'
 or jsonb_typeof(t->'video_codec') is distinct from 'string' or coalesce(t->>'video_codec','')!~'^[a-z0-9_]{1,40}$'
 or jsonb_typeof(t->'pixel_format') is distinct from 'string' or coalesce(t->>'pixel_format','')!~'^[a-z0-9_]{1,40}$'
 or has_audio is null then return false; end if;
 foreach k in array array['width_px','height_px','frame_rate_num','frame_rate_den','decoded_frames'] loop
  if jsonb_typeof(t->k) is distinct from 'number' or (t->>k)!~'^[0-9]{1,10}$' then return false; end if;
  n:=(t->>k)::numeric;
  if n<1 or n>(case k when 'width_px' then 4096 when 'height_px' then 4096 when 'decoded_frames' then 14400 else 1000000000 end) then return false; end if;
 end loop;
 if (t->>'frame_rate_num')::numeric/(t->>'frame_rate_den')::numeric>240 then return false; end if;
 foreach k in array array['min_frame_interval_us','max_frame_interval_us'] loop
  if (t->>'decoded_frames')::integer=1 then
   if t->k is distinct from 'null'::jsonb then return false; end if;
  else
   if jsonb_typeof(t->k) is distinct from 'number' or (t->>k)!~'^[0-9]{1,8}$' then return false; end if;
   if (t->>k)::numeric not between 1 and 60000000 then return false; end if;
  end if;
 end loop;
 if (t->>'min_frame_interval_us')::numeric>(t->>'max_frame_interval_us')::numeric then return false; end if;
 foreach k in array array['video_bit_rate_bps','audio_bit_rate_bps'] loop
  if t->k is distinct from 'null'::jsonb then
   if jsonb_typeof(t->k) is distinct from 'number' or (t->>k)!~'^[0-9]{1,13}$' then return false; end if;
   if (t->>k)::numeric not between 1 and 1000000000000 then return false; end if;
  end if;
 end loop;
 if not has_audio then
  foreach k in array array['audio_codec','audio_sample_rate_hz','audio_channels','audio_bit_rate_bps'] loop
   if t->k is distinct from 'null'::jsonb then return false; end if;
  end loop;
 else
  if jsonb_typeof(t->'audio_codec') is distinct from 'string' or coalesce(t->>'audio_codec','')!~'^[a-z0-9_]{1,40}$' then return false; end if;
  foreach k in array array['audio_sample_rate_hz','audio_channels'] loop
   if jsonb_typeof(t->k) is distinct from 'number' or (t->>k)!~'^[0-9]{1,6}$' then return false; end if;
   if (t->>k)::numeric<1 or (t->>k)::numeric>(case k when 'audio_channels' then 64 else 768000 end) then return false; end if;
  end loop;
 end if;
 return true;
end $function$;

revoke all on function sma_private.publication_video_streams_valid_v1(jsonb,boolean)
 from public, anon, authenticated;
grant execute on function sma_private.publication_video_streams_valid_v1(jsonb,boolean) to service_role;

-- Magic Effect retains its own closed set of transcription states.
create or replace function sma_private.publication_video_technical_valid_v1(t jsonb, audio_status text)
returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(audio_status in ('transcribed','no_audio_stream','no_speech_recognized'),false)
 and sma_private.publication_video_streams_valid_v1(t, audio_status <> 'no_audio_stream');
$$;

alter table sma_private.publication_editor_exports_v1 add column local_probe jsonb
 check (local_probe is null or (
  completed_at is not null and media_asset_id is not null
  and octet_length(local_probe::text)<=8192
  and jsonb_typeof(local_probe)='object'
  and local_probe ?& array['source','asset_revision','sha256','size_bytes','duration_ms','audio_status','technical']
  and local_probe->>'source'='local_ffmpeg'
  and jsonb_typeof(local_probe->'asset_revision')='string'
  and local_probe->>'asset_revision' ~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$'
  and split_part(local_probe->>'asset_revision',':',2)=local_probe->>'sha256'
  and jsonb_typeof(local_probe->'sha256')='string'
  and local_probe->'sha256'=outputs#>'{media,sha256}'
  and jsonb_typeof(local_probe->'size_bytes')='number'
  and local_probe->'size_bytes'=outputs#>'{media,size_bytes}'
  and (local_probe->>'size_bytes')::numeric between 1 and 24000000
  and jsonb_typeof(local_probe->'duration_ms')='number'
  and (local_probe->>'duration_ms') ~ '^[1-9][0-9]{0,4}$'
  and (local_probe->>'duration_ms')::numeric between 1 and 60000
  and local_probe->>'audio_status' in ('extracted','no_audio_stream')
  and sma_private.publication_video_streams_valid_v1(local_probe->'technical',local_probe->>'audio_status'='extracted')
 ) is true);
comment on column sma_private.publication_editor_exports_v1.local_probe is
 'Operator-recorded FFmpeg measurements for the exact finished MP4 revision. Customer export RPCs never write this column.';

create function sma_private.publication_export_technical_v1(f sma_private.publication_files_v1)
returns jsonb language sql stable security definer set search_path='' as $$
 select e.local_probe->'technical'
 from sma_private.publication_editor_exports_v1 e
 join sma_private.publication_files_v1 actual on actual.id=e.media_asset_id
  and actual.user_id=e.user_id and actual.customer_id=e.customer_id
 join public.sma_kunden c on c.id=actual.customer_id and c.user_id=actual.user_id
 where actual.id=f.id and actual.user_id=f.user_id and actual.customer_id=f.customer_id
  and actual.revision=f.revision and actual.size_bytes=f.size_bytes
  and actual.available and f.available and actual.media_kind='video' and f.media_kind='video'
  and actual.mime_type='video/mp4' and f.mime_type='video/mp4'
  and c.aktiv and (c.demo_delta_aktiv or c.zahlung_bestaetigt)
  and e.completed_at is not null and e.local_probe->>'asset_revision'=actual.revision
  and e.local_probe->>'sha256'=split_part(actual.revision,':',2)
  and e.local_probe->'size_bytes'=to_jsonb(actual.size_bytes)
  and e.outputs#>'{media,sha256}'=e.local_probe->'sha256'
  and e.outputs#>'{media,size_bytes}'=e.local_probe->'size_bytes'
  and not exists (select 1 from sma_private.publication_magic_results_v1 m
   where m.asset_id=actual.id and m.asset_revision=actual.revision and m.user_id=actual.user_id
   and m.customer_id=actual.customer_id and m.policy_version='magic-video-2026-11-03.1')
 order by e.completed_at desc, e.id desc limit 1;
$$;
revoke all on function sma_private.publication_export_technical_v1(sma_private.publication_files_v1)
 from public, anon, authenticated;
grant execute on function sma_private.publication_export_technical_v1(sma_private.publication_files_v1) to service_role;

CREATE OR REPLACE FUNCTION sma_private.publication_video_technical_v1(f sma_private.publication_files_v1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare r sma_private.publication_magic_results_v1%rowtype; t jsonb;
begin
 if f.media_kind is distinct from 'video' or not f.available then return null; end if;
 select m.* into r from sma_private.publication_magic_results_v1 m
 join public.sma_kunden c on c.id=m.customer_id and c.user_id=m.user_id and c.aktiv and (c.demo_delta_aktiv or c.zahlung_bestaetigt)
  and c.n8n_kunde_id=m.n8n_kunde_id and c.kunde_email=m.kunde_email
 where m.asset_id=f.id and m.asset_revision=f.revision and m.user_id=f.user_id and m.customer_id=f.customer_id
  and m.policy_version='magic-video-2026-11-03.1' and m.status='completed';
 if not found then
  return sma_private.publication_export_technical_v1(f);
 end if;
 if r.content_sha256 is distinct from split_part(f.revision,':',2)
 or r.result->'evidence'->>'source_sha256' is distinct from r.content_sha256
 or r.result->'evidence'->'source_size_bytes' is distinct from to_jsonb(f.size_bytes) then return null; end if;
 t:=r.result->'evidence'->'technical';
 if not sma_private.publication_video_technical_valid_v1(t,r.result->>'audio_status') then return null; end if;
 return t;
end $function$;

-- Keep the installed portal rules and expose the provenance in the existing binary check.
do $migration$
declare
 definition text := pg_get_functiondef('sma_private.publication_media_precheck_v1(sma_private.publication_files_v1,text)'::regprocedure);
 previous_message text := $old$'Die hashgeprüfte Datei wurde vollständig ohne gemeldeten Decodierfehler gelesen; Codec, Bildzeiten und Tonstatus sind belegt. Dies ist keine Inhalts- oder Veröffentlichungsfreigabe.'$old$;
 updated_message text := 'case when sma_private.publication_export_technical_v1(f) is not null then '
  || quote_literal('Lokale FFmpeg-Prüfung des gespeicherten Exports. Die Prüfsumme stimmt. Bildfolge und Tonstatus wurden vollständig geprüft.')
  || ' else ' || previous_message || ' end';
begin
 if position(previous_message in definition)=0 then raise exception 'EXPORT_PROBE_MESSAGE_CHANGED'; end if;
 execute replace(definition,previous_message,updated_message);
end $migration$;
