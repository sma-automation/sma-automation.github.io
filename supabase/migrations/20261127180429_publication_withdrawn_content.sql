-- An explicit withdrawal applies to a customer's exact media bytes, including
-- working copies that can still be present in Drive at the next catalog sync.
create table sma_private.publication_withdrawn_content_v1 (
  customer_id bigint not null references public.sma_kunden(id) on delete cascade,
  owner_id uuid not null,
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  withdrawn_at timestamptz not null default now(),
  primary key (customer_id, owner_id, digest)
);
alter table sma_private.publication_withdrawn_content_v1 enable row level security;
revoke all on sma_private.publication_withdrawn_content_v1 from public, anon, authenticated;

create function sma_private.publication_keep_withdrawn_file_hidden_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select from sma_private.publication_withdrawn_content_v1 w
    where w.customer_id = new.customer_id and w.owner_id = new.user_id
      and w.digest = split_part(new.revision, ':', 2)
  ) then
    new.available := false;
  end if;
  return new;
end
$$;
revoke all on function sma_private.publication_keep_withdrawn_file_hidden_v1()
  from public, anon, authenticated;
create trigger publication_keep_withdrawn_file_hidden_v1
  before insert or update of available, revision, customer_id, user_id
  on sma_private.publication_files_v1 for each row
  when (new.available and new.revision ~ '^sha256:[0-9a-f]{64}:[0-9]+$')
  execute function sma_private.publication_keep_withdrawn_file_hidden_v1();

-- A portal inventory scan is independent of file discovery. Apply the same
-- withdrawal to its membership view so it cannot authorize an old order.
create or replace view sma_private.publication_portal_content_v1 with (security_invoker=true) as
  select m.source_id, m.digest, min(m.platform) as platform
  from (
    select i.source_id, i.platform, i.digest, s.verified_at > now() - interval '48 hours' as fresh
    from sma_private.publication_portal_inventory_v1 i
    join sma_private.publication_portal_scans_v1 s using (source_id)
    union all
    select u.source_id, u.platform, split_part(f.revision, ':', 2), true
    from sma_private.publication_portal_uploads_v1 u
    join sma_private.publication_uploads_v1 x on x.id = u.upload_id and x.status = 'completed'
    join sma_private.publication_rotation_sources_v1 s
      on s.id = u.source_id and x.user_id = s.owner_id and x.customer_id = s.customer_id
    join sma_private.publication_files_v1 f
      on f.id = x.asset_id and f.customer_id = x.customer_id and f.user_id = x.user_id
      and f.available and f.revision ~ '^sha256:[a-f0-9]{64}:[0-9]+$'
  ) m
  join sma_private.publication_rotation_sources_v1 source on source.id = m.source_id
  where not exists (
    select from sma_private.publication_withdrawn_content_v1 w
    where (w.customer_id, w.owner_id, w.digest) = (source.customer_id, source.owner_id, m.digest)
  )
  group by m.source_id, m.digest
  having count(distinct m.platform) = 1 and bool_or(m.fresh);
