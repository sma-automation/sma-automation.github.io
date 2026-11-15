-- Offline proposal only. Deploy by a separately approved migration after CI.
-- No provider call, no export, no credit use and no publication approval.
-- Trust boundary: only the backend service_role may submit a candidate,
-- *after* independently fetching and hashing both Drive files.
-- The database checks identity/revision/shape but cannot attest raw media bytes.

-- Reject stale baseline before any DDL is attempted.
do $guard$
begin
 if md5(pg_get_functiondef('sma_private.publication_video_technical_v1(sma_private.publication_files_v1)'::regprocedure))
    is distinct from '5c2fe99118ea912caaac03e97fdf82b1' then
  raise exception 'GALLERY_EVIDENCE_SOURCE_CHANGED';
 end if;
end;
$guard$;

create table sma_private.publication_gallery_technical_v1(
 asset_id uuid primary key references sma_private.publication_files_v1(id) on delete cascade,
 gallery_job_id uuid not null unique references sma_private.gallery_music_v1(id) on delete cascade,
 source_asset_id uuid not null references sma_private.publication_files_v1(id) on delete cascade,
 user_id uuid not null,
 customer_id bigint not null references public.sma_kunden(id),
 asset_revision text not null,
 source_revision text not null,
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 size_bytes bigint not null check(size_bytes between 12 and 24000000),
 technical jsonb not null,
 mean_dbfs numeric not null,
 peak_dbfs numeric not null,
 created_at timestamptz not null default now()
);
alter table sma_private.publication_gallery_technical_v1 enable row level security;
-- No direct INSERT/UPDATE/DELETE role grant, including service_role.
-- SECURITY DEFINER registration below is the only intended write path.
revoke all on sma_private.publication_gallery_technical_v1
 from public,anon,authenticated,service_role;
grant select on sma_private.publication_gallery_technical_v1 to service_role;

-- The caller is responsible for independent Drive verification of the exact
-- SHA-256 and pixel/audio bytes. A self-reported candidate is NOT proof.
create function sma_private.publication_gallery_technical_register_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
 b jsonb; t jsonb; vol jsonb;
 f sma_private.publication_files_v1%rowtype;
 s sma_private.publication_files_v1%rowtype;
 j sma_private.gallery_music_v1%rowtype;
 existing sma_private.publication_gallery_technical_v1%rowtype;
 level_mean numeric; level_peak numeric;
begin
 if jsonb_typeof(p_input) is distinct from 'object'
    or octet_length(p_input::text)>4096
    or p_input->>'schema' is distinct from 'sma-gallery-technical-candidate-v1'
    or p_input->>'status' is distinct from 'local_technical_evidence'
    or p_input->'receipt_bytes_verified' is distinct from 'true'::jsonb
    or p_input->'packet_identity_verified' is distinct from 'true'::jsonb
    or p_input#>'{restrictions,can_publish}' is distinct from 'false'::jsonb
    or p_input#>'{restrictions,can_upload}' is distinct from 'false'::jsonb
    or p_input#>'{restrictions,requires_trusted_ingestion}' is distinct from 'true'::jsonb then
  return jsonb_build_object('ok',false,'code','UNTRUSTED_CANDIDATE','can_publish',false);
 end if;
 b:=p_input->'binding'; t:=p_input->'technical'; vol:=p_input->'volume';
 if jsonb_typeof(b) is distinct from 'object'
    or coalesce(b->>'asset_id','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or coalesce(b->>'source_asset_id','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or coalesce(b->>'sha256','') !~ '^[a-f0-9]{64}$'
    or coalesce(b->>'source_sha256','') !~ '^[a-f0-9]{64}$'
    or coalesce(b->>'asset_revision','') !~ '^sha256:[a-f0-9]{64}:[0-9]+$'
    or jsonb_typeof(b->'size_bytes') is distinct from 'number'
    or coalesce(b->>'size_bytes','') !~ '^[1-9][0-9]{1,7}$'
    or coalesce(b->>'drive_file_id','') !~ '^[A-Za-z0-9_-]{10,100}$' then
  return jsonb_build_object('ok',false,'code','INVALID_BINDING','can_publish',false);
 end if;
 select * into f from sma_private.publication_files_v1
   where id=(b->>'asset_id')::uuid for share;
 if not found or not f.available or f.media_kind<>'video' or f.mime_type<>'video/mp4'
    or f.drive_file_id is distinct from b->>'drive_file_id'
    or f.revision is distinct from b->>'asset_revision'
    or f.size_bytes is distinct from (b->>'size_bytes')::bigint
    or split_part(f.revision,':',2) is distinct from b->>'sha256' then
  return jsonb_build_object('ok',false,'code','RESULT_CHANGED','can_publish',false);
 end if;
 select * into j from sma_private.gallery_music_v1
   where result_id=f.id and customer_id=f.customer_id and user_id=f.user_id
     and state='completed' for share;
 if not found or j.expected_sha is distinct from b->>'sha256'
    or j.expected_size is distinct from f.size_bytes
    or j.source_id is distinct from (b->>'source_asset_id')::uuid then
  return jsonb_build_object('ok',false,'code','GALLERY_RECEIPT_CHANGED','can_publish',false);
 end if;
 select * into s from sma_private.publication_files_v1
   where id=j.source_id and customer_id=f.customer_id and user_id=f.user_id for share;
 if not found or not s.available or s.media_kind<>'video' or s.mime_type<>'video/mp4'
    or split_part(s.revision,':',1)<>'sha256'
    or split_part(s.revision,':',2) is distinct from b->>'source_sha256'
    or j.source_key is distinct from sma_private.gallery_music_key_v1(s.revision) then
  return jsonb_build_object('ok',false,'code','SOURCE_CHANGED','can_publish',false);
 end if;
 if not exists(select 1 from public.sma_kunden c
   where c.id=f.customer_id and c.user_id=f.user_id and c.aktiv
     and (c.demo_delta_aktiv or c.zahlung_bestaetigt)) then
  return jsonb_build_object('ok',false,'code','CUSTOMER_INACTIVE','can_publish',false);
 end if;
 if not sma_private.publication_video_streams_valid_v1(t,true)
    or t->>'video_codec' not in ('h264','hevc')
    or t->>'audio_codec'<>'aac'
    or (t->>'audio_sample_rate_hz')::integer not in (44100,48000)
    or (t->>'audio_channels')::integer<>2
    or (t->>'width_px')::integer is distinct from f.width_px
    or (t->>'height_px')::integer is distinct from f.height_px
    or t->'video_bit_rate_bps'='null'::jsonb
    or (t->>'video_bit_rate_bps')::numeric not between 1 and 25000000
    or t->'audio_bit_rate_bps'='null'::jsonb
    or (t->>'audio_bit_rate_bps')::numeric not between 1 and 512000 then
  return jsonb_build_object('ok',false,'code','TECHNICAL_INVALID','can_publish',false);
 end if;
 if jsonb_typeof(vol) is distinct from 'object'
    or vol->'non_silent' is distinct from 'true'::jsonb
    or jsonb_typeof(vol->'mean_dbfs') is distinct from 'number'
    or jsonb_typeof(vol->'peak_dbfs') is distinct from 'number' then
  return jsonb_build_object('ok',false,'code','AUDIO_NOT_VERIFIED','can_publish',false);
 end if;
 level_mean:=(vol->>'mean_dbfs')::numeric;
 level_peak:=(vol->>'peak_dbfs')::numeric;
 if level_mean not between -80 and 0 or level_peak not between -65 and 0
    or level_peak<level_mean then
  return jsonb_build_object('ok',false,'code','AUDIO_NOT_VERIFIED','can_publish',false);
 end if;
 -- Immutable receipt. Concurrent replays can return the same technical proof,
 -- but never silently overwrite it or reassign it to another source/customer.
 insert into sma_private.publication_gallery_technical_v1(
  asset_id,gallery_job_id,source_asset_id,user_id,customer_id,
  asset_revision,source_revision,sha256,source_sha256,size_bytes,
  technical,mean_dbfs,peak_dbfs)
 values(f.id,j.id,s.id,f.user_id,f.customer_id,f.revision,s.revision,
  b->>'sha256',b->>'source_sha256',f.size_bytes,t,level_mean,level_peak)
 on conflict do nothing;
 select * into existing from sma_private.publication_gallery_technical_v1
  where asset_id=f.id;
 if not found or existing.gallery_job_id<>j.id or existing.source_asset_id<>s.id
    or existing.user_id<>f.user_id or existing.customer_id<>f.customer_id
    or existing.asset_revision<>f.revision or existing.source_revision<>s.revision
    or existing.sha256<>b->>'sha256' or existing.source_sha256<>b->>'source_sha256'
    or existing.size_bytes<>f.size_bytes or existing.technical<>t
    or existing.mean_dbfs<>level_mean or existing.peak_dbfs<>level_peak then
  return jsonb_build_object('ok',false,'code','EVIDENCE_CONFLICT','can_publish',false);
 end if;
 return jsonb_build_object('ok',true,'state','technical_evidence_recorded',
   'asset_id',f.id,'asset_revision',f.revision,'can_upload',false,'can_publish',false);
end;
$function$;
revoke all on function sma_private.publication_gallery_technical_register_v1(jsonb)
 from public,anon,authenticated,service_role;
grant execute on function sma_private.publication_gallery_technical_register_v1(jsonb)
 to service_role;

-- Only the already privileged backend can read this service-side fallback.
create function sma_private.publication_gallery_technical_v1(
 f sma_private.publication_files_v1)
returns jsonb language sql stable security definer set search_path='' as $function$
 select e.technical
 from sma_private.publication_gallery_technical_v1 e
 join sma_private.gallery_music_v1 j on j.id=e.gallery_job_id
    and j.result_id=e.asset_id and j.source_id=e.source_asset_id
    and j.customer_id=e.customer_id and j.user_id=e.user_id
    and j.expected_sha=e.sha256 and j.expected_size=e.size_bytes
    and j.state='completed'
 join sma_private.publication_files_v1 s on s.id=e.source_asset_id
    and s.customer_id=e.customer_id and s.user_id=e.user_id
    and s.available and s.revision=e.source_revision
 join public.sma_kunden c on c.id=e.customer_id and c.user_id=e.user_id
    and c.aktiv and (c.demo_delta_aktiv or c.zahlung_bestaetigt)
 where e.asset_id=f.id and e.customer_id=f.customer_id and e.user_id=f.user_id
   and e.asset_revision=f.revision and e.size_bytes=f.size_bytes
   and e.sha256=split_part(f.revision,':',2)
   and f.available and f.media_kind='video' and f.mime_type='video/mp4'
 limit 1;
$function$;
revoke all on function sma_private.publication_gallery_technical_v1(
 sma_private.publication_files_v1) from public,anon,authenticated,service_role;
grant execute on function sma_private.publication_gallery_technical_v1(
 sma_private.publication_files_v1) to service_role;

-- Preserve the existing valid Magic and export paths. Only when neither
-- supplies technical evidence do we consult the completed gallery receipt.
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
  t:=sma_private.publication_export_technical_v1(f);
  if t is not null then return t; end if;
  return sma_private.publication_gallery_technical_v1(f);
 end if;
 if r.content_sha256 is distinct from split_part(f.revision,':',2)
 or r.result->'evidence'->>'source_sha256' is distinct from r.content_sha256
 or r.result->'evidence'->'source_size_bytes' is distinct from to_jsonb(f.size_bytes) then return null; end if;
 t:=r.result->'evidence'->'technical';
 if not sma_private.publication_video_technical_valid_v1(t,r.result->>'audio_status') then return null; end if;
 return t;
end;
$function$;
revoke all on function sma_private.publication_video_technical_v1(sma_private.publication_files_v1)
 from public,anon,authenticated;
grant execute on function sma_private.publication_video_technical_v1(sma_private.publication_files_v1)
 to service_role;
