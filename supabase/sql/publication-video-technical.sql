-- Apply before the new publication-video-magic.sql and publication-media-profiles.sql.
-- Technical decoding evidence never grants content, account or publication approval.
create or replace function sma_private.publication_video_technical_valid_v1(t jsonb, audio_status text)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare k text; n numeric;
begin
 if jsonb_typeof(t) is distinct from 'object' then return false; end if;
 if (select count(*) from jsonb_object_keys(t))<>16
 or exists(select 1 from jsonb_object_keys(t) fields(name) where fields.name not in ('schema','decode','video_codec','pixel_format','width_px','height_px','frame_rate_num','frame_rate_den','decoded_frames','min_frame_interval_us','max_frame_interval_us','video_bit_rate_bps','audio_codec','audio_sample_rate_hz','audio_channels','audio_bit_rate_bps'))
 or t->>'schema' is distinct from 'sma-video-technical-v1' or t->>'decode' is distinct from 'complete'
 or jsonb_typeof(t->'video_codec') is distinct from 'string' or coalesce(t->>'video_codec','')!~'^[a-z0-9_]{1,40}$'
 or jsonb_typeof(t->'pixel_format') is distinct from 'string' or coalesce(t->>'pixel_format','')!~'^[a-z0-9_]{1,40}$'
 or audio_status is null or audio_status not in ('transcribed','no_audio_stream','no_speech_recognized') then return false; end if;
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
 if audio_status='no_audio_stream' then
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
end $$;
revoke all on function sma_private.publication_video_technical_valid_v1(jsonb,text) from public,anon,authenticated;
grant execute on function sma_private.publication_video_technical_valid_v1(jsonb,text) to service_role;

create or replace function sma_private.publication_video_technical_v1(f sma_private.publication_files_v1)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r sma_private.publication_magic_results_v1%rowtype; t jsonb;
begin
 if f.media_kind is distinct from 'video' or not f.available then return null; end if;
 select m.* into r from sma_private.publication_magic_results_v1 m
 join public.sma_kunden c on c.id=m.customer_id and c.user_id=m.user_id and c.aktiv and (c.demo_delta_aktiv or c.zahlung_bestaetigt)
  and c.n8n_kunde_id=m.n8n_kunde_id and c.kunde_email=m.kunde_email
 where m.asset_id=f.id and m.asset_revision=f.revision and m.user_id=f.user_id and m.customer_id=f.customer_id
  and m.policy_version='magic-video-2026-11-03.1' and m.status='completed';
 if not found or r.content_sha256 is distinct from split_part(f.revision,':',2)
 or r.result->'evidence'->>'source_sha256' is distinct from r.content_sha256
 or r.result->'evidence'->'source_size_bytes' is distinct from to_jsonb(f.size_bytes) then return null; end if;
 t:=r.result->'evidence'->'technical';
 if not sma_private.publication_video_technical_valid_v1(t,r.result->>'audio_status') then return null; end if;
 return t;
end $$;
revoke all on function sma_private.publication_video_technical_v1(sma_private.publication_files_v1) from public,anon,authenticated;
grant execute on function sma_private.publication_video_technical_v1(sma_private.publication_files_v1) to service_role;
