-- Screen renditions are private UI media. They never enter the publication file catalogue.
create table sma_private.portal_playback_chunks_v1 (
 source_id uuid not null references sma_private.publication_rotation_sources_v1(id) on delete cascade,
 source_sha text not null check(source_sha ~ '^[a-f0-9]{64}$'),
 rendition_sha text not null check(rendition_sha ~ '^[a-f0-9]{64}$'),
 part integer not null check(part between 0 and 127),
 payload bytea not null check(octet_length(payload) between 1 and 262144),
 primary key(source_id,source_sha,rendition_sha,part)
);
create table sma_private.portal_playback_manifest_v1 (
 source_id uuid not null references sma_private.publication_rotation_sources_v1(id) on delete cascade,
 source_sha text not null check(source_sha ~ '^[a-f0-9]{64}$'),
 rendition_sha text not null check(rendition_sha ~ '^[a-f0-9]{64}$'),
 byte_size integer not null check(byte_size between 1 and 33554432),
 primary key(source_id,source_sha)
);
alter table sma_private.portal_playback_chunks_v1 enable row level security;
alter table sma_private.portal_playback_manifest_v1 enable row level security;
revoke all on sma_private.portal_playback_chunks_v1,sma_private.portal_playback_manifest_v1 from public,anon,authenticated;
create function public.sma_portal_playback_v1(p_asset uuid,p_revision text,p_portal text,p_part integer default null)
returns jsonb language sql stable security definer set search_path='' as $$
 select case when p_part is null then jsonb_build_object('size',v.byte_size,'sha',v.rendition_sha,'parts',(v.byte_size+262143)/262144)
  else (select to_jsonb(replace(encode(c.payload,'base64'),chr(10),''))
        from sma_private.portal_playback_chunks_v1 c
        where (c.source_id,c.source_sha,c.rendition_sha,c.part)=(v.source_id,v.source_sha,v.rendition_sha,p_part)) end
 from public.sma_kunden k
 join sma_private.publication_rotation_sources_v1 s on (s.customer_id,s.owner_id)=(k.id,k.user_id)
 join sma_private.publication_files_v1 f on (f.customer_id,f.user_id)=(k.id,k.user_id)
 join sma_private.publication_portal_content_v1 m on (m.source_id,m.platform,m.digest)=(s.id,p_portal,split_part(f.revision,':',2))
 join sma_private.portal_playback_manifest_v1 v on (v.source_id,v.source_sha)=(s.id,m.digest)
 where k.user_id=(select auth.uid()) and k.aktiv and (k.demo_delta_aktiv or k.zahlung_bestaetigt)
 and f.id=p_asset and f.revision=p_revision and f.available and f.media_kind='video' and f.mime_type='video/mp4'
 and (p_part is null or p_part between 0 and 127)
$$;
revoke all on function public.sma_portal_playback_v1(uuid,text,text,integer) from public,anon;
grant execute on function public.sma_portal_playback_v1(uuid,text,text,integer) to authenticated;
notify pgrst,'reload schema';
