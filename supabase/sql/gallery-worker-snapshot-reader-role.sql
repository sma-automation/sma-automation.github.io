-- SMA: stage-only GRANTS for a private, least-privileged read-only worker.
-- NOT applied to Supabase by this PR. No LOGIN, password, credentials, API
-- exposure, browser role, table read or data change is created.
--
-- A future operator may provision one separate LOGIN through the private
-- server's credential manager and make it a member of this NOLOGIN group
-- after explicit authorization and security review.

do $guard$
begin
 if to_regrole('sma_gallery_snapshot_reader') is not null then
  raise exception 'SMA_GALLERY_SNAPSHOT_READER_ALREADY_EXISTS';
 end if;
 if to_regprocedure('sma_private.gallery_worker_snapshot_v1(uuid)') is null then
  raise exception 'SMA_GALLERY_SNAPSHOT_FUNCTION_MISSING';
 end if;
end;
$guard$;

create role sma_gallery_snapshot_reader
  nologin inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;

grant usage on schema sma_private to sma_gallery_snapshot_reader;

grant execute on function sma_private.gallery_worker_snapshot_v1(uuid)
  to sma_gallery_snapshot_reader;

-- The group has NO direct SELECT, INSERT, UPDATE or DELETE on any table,
-- no login rights, no membership in service_role, and no public endpoint.
-- The snapshot function itself is service-owned and SECURITY DEFINER.
