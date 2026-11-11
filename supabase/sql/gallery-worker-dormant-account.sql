-- SMA Gallery: dormant database service identity; NOT a usable login.
-- Applied only after operator approval; no password/secret material in this file.
-- The separate NOLOGIN reader group was installed in an earlier migration.
do $guard$
begin
 if to_regrole('sma_gallery_worker_login') is not null then
  raise exception 'SMA_GALLERY_WORKER_IDENTITY_ALREADY_EXISTS';
 end if;
 if to_regrole('sma_gallery_snapshot_reader') is null or
    to_regprocedure('sma_private.gallery_worker_snapshot_v1(uuid)') is null then
  raise exception 'SMA_GALLERY_READONLY_PREREQUISITES_MISSING';
 end if;
end;
$guard$;

-- This deliberately cannot authenticate, even if network/database
-- authentication settings change. A future server operator must separately
-- provision and enable its password without putting it into migrations/logs.
create role sma_gallery_worker_login
  nologin inherit password null connection limit 1
  nosuperuser nocreatedb nocreaterole noreplication nobypassrls;

grant sma_gallery_snapshot_reader to sma_gallery_worker_login
  with admin false, inherit true, set false;

alter role sma_gallery_worker_login set default_transaction_read_only = on;
alter role sma_gallery_worker_login set statement_timeout = '15s';
alter role sma_gallery_worker_login set idle_in_transaction_session_timeout = '10s';

-- No table/Storage access grants, no PUBLIC/anon/authenticated rights,
-- no server connections, no publishing or credit operations.
