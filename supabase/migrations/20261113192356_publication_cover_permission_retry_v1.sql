-- Explicit operator recovery for a private YouTube video after channel verification.
-- The existing dispatcher still validates the account, the file and the permit
-- before it can reserve a new thumbnail request.
create table sma_private.publication_cover_permission_retries_v1 (
  order_id uuid not null references sma_private.publication_provider_covers_v1(order_id),
  previous_lease_id uuid not null,
  previous_attempt jsonb not null,
  provider_id text not null,
  target_id text not null,
  authorized_at timestamptz not null default now(),
  primary key (order_id, previous_lease_id)
);

alter table sma_private.publication_cover_permission_retries_v1 enable row level security;
revoke all on sma_private.publication_cover_permission_retries_v1 from public, anon, authenticated, service_role;

create function sma_private.publication_retry_private_cover_v1(
  p_order_id uuid,
  p_failed_lease uuid,
  p_video_id text,
  p_channel_id text,
  p_cover_revision text
) returns text language plpgsql security invoker set search_path = '' as $$
declare
  j sma_private.publication_orders_v1%rowtype;
  a sma_private.publication_provider_attempts_v1%rowtype;
  cv sma_private.publication_provider_covers_v1%rowtype;
begin
  select * into j from sma_private.publication_orders_v1 where id = p_order_id for update;
  if not found or j.state <> 'checked' or j.approved_at is null
     or j.blockers is distinct from '[]'::jsonb
     or j.binding->>'platform' is distinct from 'youtube'
     or j.choices->>'visibility' is distinct from 'private' then
    return 'ORDER_UNAVAILABLE';
  end if;
  select * into a from sma_private.publication_provider_attempts_v1 where order_id = j.id for update;
  select * into cv from sma_private.publication_provider_covers_v1 where order_id = j.id for update;
  if p_failed_lease is null or cv.lease_id is distinct from p_failed_lease
     or p_video_id is null or a.provider_id is distinct from p_video_id
     or p_channel_id is null or a.target_id is distinct from p_channel_id
     or p_cover_revision is null or cv.plan->>'asset_revision' is distinct from p_cover_revision
     or sma_private.publication_history_cover_v1(j)->>'status' is distinct from 'permission_required'
     or sma_private.publication_history_entry_v1(j)->>'status' is distinct from 'private_complete' then
    return 'COVER_RETRY_UNAVAILABLE';
  end if;
  if not exists (
    select 1 from public.sma_kunden c where c.id = j.customer_id and c.user_id = j.user_id
      and c.aktiv and (c.demo_delta_aktiv or c.zahlung_bestaetigt)
  ) then
    return 'ACCESS_INACTIVE';
  end if;
  if not exists (
    select 1 from sma_private.publication_provider_permissions_v1 permit
    where permit.order_id = j.id and permit.fingerprint = cv.fingerprint
      and permit.created_at > cv.finished_at and permit.created_at <= now() and permit.expires_at > now()
  ) then
    return 'FRESH_OPERATOR_APPROVAL_REQUIRED';
  end if;
  if sma_private.publication_cover_plan_v1(j) is distinct from cv.plan then
    return 'COVER_CHANGED';
  end if;

  insert into sma_private.publication_cover_permission_retries_v1
    (order_id, previous_lease_id, previous_attempt, provider_id, target_id)
    values (j.id, cv.lease_id, to_jsonb(cv), a.provider_id, a.target_id);
  update sma_private.publication_provider_covers_v1
    set state = 'bound', lease_id = null, sent_at = null, finished_at = null, code = null
    where order_id = j.id;
  return 'COVER_READY';
exception when raise_exception then
  if sqlerrm = 'COVER_UNAVAILABLE' then return 'COVER_CHANGED'; end if;
  raise;
end;
$$;

revoke all on function sma_private.publication_retry_private_cover_v1(uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;
