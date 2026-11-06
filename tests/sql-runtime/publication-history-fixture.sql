-- Isolated prerequisite fixture, not a deployment script.
-- Orders: website-v1; provider schema/fingerprint: PR #57 4b846e8525dbed26dbc4ef8907e0050d3fb25464.
-- Immutable, owner-bound publication orders. Additive; no provider credentials.
create table if not exists sma_private.publication_orders_v1 (
 id uuid primary key, user_id uuid not null, customer_id bigint not null references public.sma_kunden(id),
 binding jsonb not null, draft jsonb not null, choices jsonb not null,
 target jsonb, approval_token uuid not null default gen_random_uuid(), approved_at timestamptz,
 state text not null default 'preparing' check(state in ('preparing','prepared','approved','checking','blocked','checked','cancelled')),
 lease_id uuid, lease_until timestamptz, blockers jsonb not null default '[]',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table sma_private.publication_orders_v1 add column if not exists account_check jsonb;
-- User declarations, never machine evidence. The row already binds these to
-- the immutable owner, file/text revision, target, choices and approved_at.
alter table sma_private.publication_orders_v1 add column if not exists approval_review jsonb;
-- Exactly one provider attempt per approved publication key. No client grants.
create table if not exists sma_private.publication_provider_permissions_v1 (
 order_id uuid primary key references sma_private.publication_orders_v1(id),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null, created_at timestamptz not null default now()
);
-- Deliberately no service INSERT/UPDATE grant: explicit operator approval only.
create table if not exists sma_private.publication_provider_attempts_v1 (
 order_id uuid primary key references sma_private.publication_orders_v1(id),
 fingerprint text not null, platform text not null check(platform in ('youtube','tiktok')),
 target_id text not null, visibility text not null, size_bytes bigint not null check(size_bytes between 1 and 24000000),
 state text not null default 'reserved' check(state in ('reserved','session_ready','uploading','processing','complete','failed','uncertain','needs_review')),
 provider_id text, session_url text, session_expires_at timestamptz, received_bytes bigint not null default 0,
 sequence integer not null default 0, lease_id uuid, lease_until timestamptz,
 last_operation text, result jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists sma_private.publication_provider_events_v1 (
 order_id uuid not null references sma_private.publication_provider_attempts_v1(order_id),
 sequence integer not null, request_id uuid not null unique, operation text not null check(operation in ('init','upload','probe','status')),
 outcome jsonb, created_at timestamptz not null default now(), finished_at timestamptz,
 primary key(order_id,sequence)
);
alter table sma_private.publication_provider_permissions_v1 enable row level security;
alter table sma_private.publication_provider_attempts_v1 enable row level security;
alter table sma_private.publication_provider_events_v1 enable row level security;
revoke all on sma_private.publication_provider_permissions_v1,sma_private.publication_provider_attempts_v1,sma_private.publication_provider_events_v1 from public,anon,authenticated,service_role;
grant select on sma_private.publication_provider_permissions_v1 to service_role;
grant select,insert,update on sma_private.publication_provider_attempts_v1,sma_private.publication_provider_events_v1 to service_role;

create or replace function sma_private.publication_provider_fingerprint_v1(j sma_private.publication_orders_v1)
returns text language sql immutable security invoker set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object('owner',j.user_id,'binding',j.binding,'draft',j.draft,'target',j.target,'choices',j.choices,'approved_at',j.approved_at,'review',j.approval_review)::text,'UTF8')),'hex');
$$;
revoke all on function sma_private.publication_provider_fingerprint_v1(sma_private.publication_orders_v1) from public,anon,authenticated;
grant execute on function sma_private.publication_provider_fingerprint_v1(sma_private.publication_orders_v1) to service_role;


alter table sma_private.publication_orders_v1 enable row level security;
revoke all on sma_private.publication_orders_v1 from public,anon,authenticated;
