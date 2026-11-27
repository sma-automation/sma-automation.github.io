create table sma_private.portal_media_intake_v1 (
 source_id uuid not null, platform text not null, folder_id text not null,
 drive_id text not null, input_sha text not null check(input_sha ~ '^[a-f0-9]{64}$'),
 logo_sha text not null, music_sha text not null, ticket uuid not null, lease_until timestamptz not null,
 output_sha text check(output_sha ~ '^[a-f0-9]{64}$'), creator_logo boolean, duration numeric,
 saved_id text, finished_at timestamptz,
 primary key(source_id,platform,folder_id,input_sha,logo_sha,music_sha),
 foreign key(source_id,platform) references sma_private.portal_media_profiles_v1
);
create index portal_media_output_v1 on sma_private.portal_media_intake_v1(source_id,output_sha)
 where output_sha is not null;
alter table sma_private.portal_media_intake_v1 enable row level security;
revoke all on sma_private.portal_media_intake_v1 from public,anon,authenticated,service_role;

-- Called by the private Drive processor after checking live folder membership.
-- Reserve the output hash before upload so an interrupted upload can be found
-- and cannot later be mistaken for the creator's own TikTok original.
create function sma_private.process_portal_media_v1(src uuid, portal text, folder text, original text, sha text,
 action text default 'claim', lease uuid default null, rendered text default null, branded boolean default null,
 seconds numeric default null, saved text default null) returns jsonb
language plpgsql set search_path='' as $$
declare p sma_private.portal_media_profiles_v1%rowtype; job sma_private.portal_media_intake_v1%rowtype;
begin
 select x.* into strict p from sma_private.portal_media_profiles_v1 x join sma_private.publication_portal_folders_v1 f using(source_id,platform,folder_id)
 where (x.source_id,x.platform,x.folder_id)=(src,portal,folder);
 if sha is null or sha !~ '^[0-9a-f]{64}$' or original is null or original !~ '^[A-Za-z0-9_-]{10,200}$' then raise exception 'INVALID_INPUT';end if;
 if p.logo_sha is null or p.music_sha is null then return jsonb_build_object('state','references_required');end if;
 perform pg_advisory_xact_lock(hashtextextended(src::text||portal||sha,0));
 if exists(select from sma_private.publication_withdrawn_content_v1 w join sma_private.publication_rotation_sources_v1 s
 on (s.customer_id,s.owner_id)=(w.customer_id,w.owner_id) where s.id=src and w.digest in (sha,rendered))
 then return jsonb_build_object('state','withdrawn');end if;
 select * into job from sma_private.portal_media_intake_v1 j
 where (j.source_id,j.platform,j.folder_id,j.input_sha,j.logo_sha,j.music_sha)=(src,portal,folder,sha,p.logo_sha,p.music_sha) for update;
 if action='claim' then
  if exists(select from sma_private.portal_media_proofs_v1 v where
    (v.source_id,v.platform,v.folder_id,v.logo_sha,v.music_sha,v.output_sha)=(src,portal,folder,p.logo_sha,p.music_sha,sha))
   or exists(select from sma_private.portal_media_intake_v1 j where j.source_id=src and j.input_sha<>sha and j.output_sha=sha)
   then return jsonb_build_object('state','known_output');end if;
  if job.finished_at is not null then return jsonb_build_object('state','finished');end if;
  if job.lease_until>now() then return jsonb_build_object('state','busy');end if;
  insert into sma_private.portal_media_intake_v1 as j(source_id,platform,folder_id,drive_id,input_sha,logo_sha,music_sha,ticket,lease_until)
   values(src,portal,folder,original,sha,p.logo_sha,p.music_sha,gen_random_uuid(),now()+interval '45 minutes')
   on conflict(source_id,platform,folder_id,input_sha,logo_sha,music_sha) do update
   set ticket=excluded.ticket,lease_until=excluded.lease_until,drive_id=excluded.drive_id returning * into job;
  return jsonb_build_object('state','claimed','ticket',job.ticket,'expected',job.output_sha,'creator_logo',job.creator_logo,
    'logo_ref',p.logo_ref,'logo_sha',p.logo_sha,'music_ref',p.music_ref,'music_sha',p.music_sha);
 end if;
 if job.ticket is null or job.ticket is distinct from lease or job.lease_until<=now() or job.drive_id<>original
  or job.finished_at is not null then raise exception 'LEASE_CHANGED';end if;
 if action='reserve' then
  if rendered is null or rendered !~ '^[a-f0-9]{64}$' or seconds is null or seconds<=0 or seconds>='Infinity'::numeric
    or branded is null or job.output_sha is not null and (job.output_sha,job.creator_logo) is distinct from (rendered,branded)
   then raise exception 'RENDER_CHANGED';end if;
  update sma_private.portal_media_intake_v1 set output_sha=rendered,creator_logo=branded,duration=seconds where ticket=lease;
  return jsonb_build_object('state','reserved');
 end if;
 if action is distinct from 'finish' or saved is null or saved !~ '^[A-Za-z0-9_-]{10,200}$'
   or job.output_sha is null or job.output_sha is distinct from rendered then raise exception 'SAVED_BYTES_CHANGED';end if;
 if portal<>'tiktok' or job.creator_logo then
  insert into sma_private.portal_media_proofs_v1(source_id,platform,folder_id,input_sha,output_sha,logo_sha,music_sha,creator_logo,duration)
   values(src,portal,folder,sha,rendered,p.logo_sha,p.music_sha,job.creator_logo,job.duration) on conflict do nothing;
 end if;
 update sma_private.portal_media_intake_v1 set saved_id=saved,finished_at=now() where ticket=lease;
 return jsonb_build_object('state',case when portal='tiktok' and not job.creator_logo then 'private_preview_only' else 'verified' end);
end $$;
revoke all on function sma_private.process_portal_media_v1(uuid,text,text,text,text,text,uuid,text,boolean,numeric,text)
 from public, anon, authenticated, service_role;

-- Publish the precise, safe error code from the journal in the existing
-- authenticated manual-send response. Do not expose raw provider responses.
do $migration$
declare b text:=pg_get_functiondef('public.sma_manual_portal_v1(text,text,uuid,text,uuid,uuid,timestamptz)'::regprocedure);
 anchor text:=' select * into strict f from sma_private.publication_files_v1 where id=p_asset';
 state_anchor text:=' if p_action=''read'' then return body;end if;';
begin
 if array_length(string_to_array(b,anchor),1)<>2 or array_length(string_to_array(b,state_anchor),1)<>2 then raise exception 'MANUAL_PORTAL_BASE_CHANGED';end if;
 b:=replace(b,anchor,' if not sma_private.portal_media_verified_v1(src,p_platform,p_revision) and exists
 (select from sma_private.publication_files_v1 x join sma_private.publication_portal_content_v1 c on c.source_id=src and c.platform=p_platform and c.digest=split_part(x.revision,'':'',2)
 where x.id=p_asset and x.customer_id=cid and x.user_id=uid and x.available and x.revision=p_revision)
 then return jsonb_build_object(''ok'',false,''code'',''PORTAL_MEDIA_PROOF_REQUIRED'');end if;'||chr(10)||anchor);
 execute replace(b,state_anchor,' if a.order_id is not null then body:=body||jsonb_build_object(''provider_code'',
 (select e.outcome->>''code'' from sma_private.publication_provider_events_v1 e where e.order_id=a.order_id and e.sequence=a.sequence));end if;'||chr(10)||state_anchor);
end $migration$;
