-- A policy is enrolled privately for one source and portal, independent of the
-- public customer's membership. A changed folder or reference requires fresh proof.
create table sma_private.portal_media_profiles_v1 (
 source_id uuid not null, platform text not null, folder_id text not null,
 logo_ref text, music_ref text,
 logo_sha text check (logo_sha ~ '^[0-9a-f]{64}$'),
 music_sha text check (music_sha ~ '^[0-9a-f]{64}$'),
 enrolled_at timestamptz not null default now(),
 primary key (source_id,platform),
 foreign key (source_id,platform) references sma_private.publication_portal_folders_v1
);
create table sma_private.portal_media_proofs_v1 (
 source_id uuid not null, platform text not null, folder_id text not null,
 input_sha text not null check (input_sha ~ '^[0-9a-f]{64}$'),
 output_sha text not null check (output_sha ~ '^[0-9a-f]{64}$'),
 logo_sha text not null check (logo_sha ~ '^[0-9a-f]{64}$'),
 music_sha text not null check (music_sha ~ '^[0-9a-f]{64}$'),
 creator_logo boolean not null, duration numeric not null check (duration > 0 and duration < 'Infinity'::numeric),
 checked_at timestamptz not null default now(),
 check (platform <> 'tiktok' or creator_logo),
 primary key (source_id,platform,folder_id,output_sha,logo_sha,music_sha),
 foreign key (source_id,platform) references sma_private.portal_media_profiles_v1
);
alter table sma_private.portal_media_profiles_v1 enable row level security;
alter table sma_private.portal_media_proofs_v1 enable row level security;
revoke all on sma_private.portal_media_profiles_v1,sma_private.portal_media_proofs_v1 from public,anon,authenticated,service_role;

create function sma_private.portal_media_verified_v1(src uuid, portal text, revision text)
returns boolean language sql stable set search_path='' as $$
 select not exists (select from sma_private.portal_media_profiles_v1 p where (p.source_id,p.platform)=(src,portal))
 or exists (
  select from sma_private.portal_media_profiles_v1 p
  join sma_private.publication_portal_folders_v1 f using (source_id,platform,folder_id)
  join sma_private.portal_media_proofs_v1 v using (source_id,platform,folder_id,logo_sha,music_sha)
  join sma_private.publication_rotation_sources_v1 s on s.id=p.source_id
  where (p.source_id,p.platform)=(src,portal) and revision ~ '^sha256:[0-9a-f]{64}:[0-9]+$'
    and v.output_sha=split_part(revision,':',2)
    and not exists (select from sma_private.publication_withdrawn_content_v1 w
      where (w.customer_id,w.owner_id)=(s.customer_id,s.owner_id) and w.digest in (v.input_sha,v.output_sha))
 )
$$;
revoke all on function sma_private.portal_media_verified_v1(uuid,text,text) from public,anon,authenticated,service_role;

-- Keep the raw gallery visible for editing. All portal eligibility callers
-- (daily planner, manual send and final send guard) still check membership.
create or replace function sma_private.publication_portal_allowed_v1(src uuid,p text,rev text)
returns boolean language sql stable set search_path='' as $$
 select rev ~ '^sha256:[a-f0-9]{64}:[0-9]+$'
 and sma_private.portal_media_verified_v1(src,p,rev)
 and exists(select from sma_private.publication_portal_content_v1 c
   where c.source_id=src and c.platform=p and c.digest=split_part(rev,':',2))
 and not exists(select from sma_private.publication_orders_v1 o join sma_private.publication_rotation_sources_v1 s
   on s.customer_id=o.customer_id and s.owner_id=o.user_id where s.id=src and o.approved_at is not null
   and o.binding->>'platform'<>p and split_part(o.binding->>'asset_revision',':',2)=split_part(rev,':',2)
   and (o.state<>'cancelled' or exists(select from sma_private.publication_provider_events_v1 ev
   where ev.order_id=o.id and ev.operation in ('init','upload'))))
$$;

-- Enforce the same condition on a manually saved future plan and on final
-- approval via the standalone preview. Allow removal and reconciliation.
create function sma_private.portal_media_plan_guard_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare profile record;
begin
 if new.desired_at is null or new.desired_at<now() then return new;end if;
 for profile in select p.source_id,p.platform from sma_private.portal_media_profiles_v1 p
  join sma_private.publication_rotation_sources_v1 s on s.id=p.source_id
  where (s.customer_id,s.owner_id)=(new.customer_id,new.owner_id) and
   (new.portal_times ? p.platform or (new.portal_times is null and exists
    (select from sma_private.publication_portal_content_v1 c where (c.source_id,c.platform)=(p.source_id,p.platform)
     and c.digest=split_part(new.asset_revision,':',2)))) loop
   if not sma_private.publication_portal_allowed_v1(profile.source_id,profile.platform,new.asset_revision) then
    raise exception 'PORTAL_MEDIA_PROOF_REQUIRED';
   end if;
 end loop;
 return new;
end $$;
create trigger publication_profile_plan_guard_v1 before insert or update of desired_at,portal_times,asset_revision,asset_id
 on sma_private.publication_joint_plans_v1 for each row execute function sma_private.portal_media_plan_guard_v1();

create function sma_private.portal_media_approval_guard_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.approved_at is not null and exists (
  select from sma_private.portal_media_profiles_v1 p join sma_private.publication_rotation_sources_v1 s on s.id=p.source_id
  where (s.customer_id,s.owner_id,p.platform)=(new.customer_id,new.user_id,new.binding->>'platform')
   and not sma_private.publication_portal_allowed_v1(s.id,p.platform,new.binding->>'asset_revision')
 ) then raise exception 'PORTAL_MEDIA_PROOF_REQUIRED';end if;
 return new;
end $$;
create trigger publication_profile_approval_guard_v1 before insert or update of approved_at,binding on sma_private.publication_orders_v1
 for each row execute function sma_private.portal_media_approval_guard_v1();
revoke all on function sma_private.portal_media_plan_guard_v1(),sma_private.portal_media_approval_guard_v1() from public,anon,authenticated,service_role;
