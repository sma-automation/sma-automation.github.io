-- Private pilot offers are created from a fresh Mollie first-payment lookup.
create table sma_private.onboarding_package_bookings_v1 (
  id uuid primary key default gen_random_uuid(),
  customer_id bigint not null, user_id uuid not null,
  foreign key(customer_id,user_id) references sma_private.onboarding_plan_choices_v1(customer_id,user_id) on delete cascade,
  n8n_ref text not null, n8n_row_id bigint not null, email text not null,
  plan text not null check (plan in ('alpha','beta','delta')),
  terms_version text not null default '2026-11-15-v1',
  payment_id text unique not null, merchant_customer text not null,
  checkout text not null, expires_at timestamptz not null, booked_at timestamptz,
  state text not null check (state in ('offered','booked','paid','active','closed','reversed'))
);
create unique index onboarding_package_one_open_v1 on sma_private.onboarding_package_bookings_v1(customer_id,user_id)
where state in ('offered','booked','paid','active');
alter table sma_private.onboarding_package_bookings_v1 enable row level security;
revoke all on sma_private.onboarding_package_bookings_v1 from public,anon,authenticated,service_role;

-- Keep earlier versions of the reservation form from changing a binding order.
create function sma_private.onboarding_plan_booking_guard_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.plan is distinct from old.plan then
    if exists(select from sma_private.onboarding_package_bookings_v1 b
      where (b.customer_id,b.user_id)=(old.customer_id,old.user_id) and b.state in ('booked','paid','active')) then
      raise exception 'BOOKING_IN_PROGRESS';
    end if;
    update sma_private.onboarding_package_bookings_v1 set state='closed'
      where (customer_id,user_id)=(old.customer_id,old.user_id) and state='offered';
  end if;
  return new;
end $$;
revoke all on function sma_private.onboarding_plan_booking_guard_v1() from public,anon,authenticated,service_role;
create trigger onboarding_plan_booking_guard before update of plan on sma_private.onboarding_plan_choices_v1
for each row execute function sma_private.onboarding_plan_booking_guard_v1();

-- Only the private operator may supply the projection of a provider GET. No client receipt endpoint.
create function sma_private.sync_onboarding_booking_v1(p_receipt jsonb, p_row jsonb default null)
returns text language plpgsql security invoker set search_path='' as $$
declare
  r sma_private.onboarding_plan_choices_v1%rowtype;
  c public.sma_kunden%rowtype;
  b sma_private.onboarding_package_bookings_v1%rowtype;
  plan_code text := p_receipt->>'plan';
  pid text := p_receipt->>'id';
  pay_status text := p_receipt->>'status';
  expected text := case plan_code when 'alpha' then '100.00' when 'beta' then '300.00' when 'delta' then '500.00' end;
  deadline timestamptz; paid_at timestamptz;
begin
  if expected is null or pid is null or pid !~ '^tr_[A-Za-z0-9]{1,64}$'
    or p_receipt->>'mode' is distinct from 'live' or p_receipt->>'sequence' is distinct from 'first'
    or p_receipt->>'currency' is distinct from 'EUR' or p_receipt->>'value' is distinct from expected
    or coalesce(p_receipt->>'customer','') !~ '^cst_[A-Za-z0-9]{1,64}$'
    or coalesce(p_receipt->>'ref','') !~ '^kunde_[0-9a-f]{32}$'
    or pay_status is null or pay_status not in ('open','pending','authorized','paid','failed','expired','canceled')
    or jsonb_typeof(p_receipt->'reversed') is distinct from 'boolean' then return 'INVALID_RECEIPT'; end if;

  select k.* into c from public.sma_kunden k join sma_private.onboarding_plan_choices_v1 x
    on (x.customer_id,x.user_id)=(k.id,k.user_id) where x.n8n_ref=p_receipt->>'ref' for no key update of k;
  if not found then return 'ACCOUNT_UNAVAILABLE'; end if;
  select * into strict r from sma_private.onboarding_plan_choices_v1 where (customer_id,user_id)=(c.id,c.user_id) for update;
  select * into b from sma_private.onboarding_package_bookings_v1 where payment_id=pid for update;
  if b.id is not null and ((b.customer_id,b.user_id,b.plan,b.merchant_customer) is distinct from
      (c.id,c.user_id,plan_code,p_receipt->>'customer')) then return 'RECEIPT_CONFLICT'; end if;

  -- A reversal is terminal for this order. Never disable a different account or plan.
  if p_receipt->'reversed'='true'::jsonb then
    if b.id is null then return 'NO_BOOKING'; end if;
    if b.state='active' then
      update public.sma_kunden set aktiv=false,zahlung_bestaetigt=false,paket=null
        where id=c.id and user_id=b.user_id and n8n_kunde_id=b.n8n_ref and paket=b.plan
          and demo_delta_aktiv is false and aktiv is true and zahlung_bestaetigt is true;
    end if;
    update sma_private.onboarding_package_bookings_v1 set state='reversed' where id=b.id;
    return 'REVERSED';
  end if;
  if b.state in ('closed','reversed','active') then return upper(b.state); end if;
  if (select count(*) from public.sma_kunden k where k.user_id=c.user_id)<>1 or not exists(select from sma_private.onboarding_n8n_accounts_v1 a
      where a.customer_id=c.id and a.user_id=c.user_id and a.n8n_row_id=r.n8n_row_id)
    or r.plan<>plan_code or (b.id is not null and
       (b.n8n_ref,b.n8n_row_id,b.email) is distinct from (r.n8n_ref,r.n8n_row_id,c.kunde_email)) then return 'ACCOUNT_UNAVAILABLE'; end if;

  if b.id is null then
    if pay_status<>'open' then return 'NO_BOOKING'; end if;
    deadline := (p_receipt->>'expires')::timestamptz;
    if deadline is null or not isfinite(deadline) or deadline<=clock_timestamp()
      or coalesce(p_receipt->>'checkout','') !~ '^https://(www|checkout)\.mollie\.com/checkout/[A-Za-z0-9/_-]+$'
      then return 'INVALID_OFFER'; end if;
    update sma_private.onboarding_package_bookings_v1 set state='closed'
      where (customer_id,user_id)=(c.id,c.user_id) and state='offered' and expires_at<=clock_timestamp();
    insert into sma_private.onboarding_package_bookings_v1
      (customer_id,user_id,n8n_ref,n8n_row_id,email,plan,payment_id,merchant_customer,checkout,expires_at,state)
      values(c.id,c.user_id,r.n8n_ref,r.n8n_row_id,c.kunde_email,r.plan,pid,p_receipt->>'customer',p_receipt->>'checkout',deadline,'offered');
    return 'OFFERED';
  end if;
  if pay_status in ('failed','expired','canceled') then
    if b.state='paid' then return 'PAID'; end if;
    update sma_private.onboarding_package_bookings_v1 set state='closed' where id=b.id;
    return 'CLOSED';
  end if;
  if pay_status<>'paid' then return upper(b.state); end if;
  paid_at := (p_receipt->>'paid_at')::timestamptz;
  if b.booked_at is null then
    update sma_private.onboarding_package_bookings_v1 set state='closed' where id=b.id;
    return 'UNMATCHED_PAYMENT';
  end if;
  if paid_at is null or not isfinite(paid_at) or paid_at < b.booked_at
    or paid_at>clock_timestamp()+interval '1 minute' then return 'UNMATCHED_PAYMENT'; end if;
  update sma_private.onboarding_package_bookings_v1 set state='paid' where id=b.id;
  -- Use the same n8n identity and access fields required by the actual dashboard.
  if p_row is null then return 'PAID'; end if;
  if p_row->'id' is distinct from to_jsonb(b.n8n_row_id) or p_row->>'kunde_id' is distinct from b.n8n_ref
    or p_row->>'kunde_email' is distinct from b.email or p_row->>'paket' is distinct from b.plan
    or p_row->>'mollie_customer_id' is distinct from b.merchant_customer
    or coalesce(p_row->>'mollie_subscription_id','') !~ '^sub_[A-Za-z0-9]{1,64}$'
    or p_row->'zahlung_bestaetigt' is distinct from 'true'::jsonb or p_row->'zugang_aktiv' is distinct from 'true'::jsonb
    or p_row->'has_access_token' is distinct from 'true'::jsonb or p_row->'demo_delta_aktiv' is distinct from 'false'::jsonb
    then return 'N8N_PENDING'; end if;
  update public.sma_kunden set aktiv=true,zahlung_bestaetigt=true,paket=b.plan where id=c.id and user_id=c.user_id;
  update sma_private.onboarding_package_bookings_v1 set state='active' where id=b.id;
  return 'ACTIVE';
exception when unique_violation then return 'OFFER_CONFLICT';
  when invalid_datetime_format or datetime_field_overflow then return 'INVALID_RECEIPT';
end $$;
revoke all on function sma_private.sync_onboarding_booking_v1(jsonb,jsonb) from public,anon,authenticated,service_role;

create function sma_private.onboarding_booking_v1(p_owner uuid,p_offer uuid,p_plan text,p_terms text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.sma_kunden%rowtype;
  b sma_private.onboarding_package_bookings_v1%rowtype;
begin
  if auth.uid() is null or p_owner is distinct from auth.uid() then return '{"ok":false,"code":"ACCOUNT_UNAVAILABLE"}'; end if;
  begin
    select k.* into strict c from public.sma_kunden k where k.user_id=p_owner for no key update;
  exception when no_data_found or too_many_rows then return '{"ok":false,"code":"ACCOUNT_UNAVAILABLE"}';
  end;
  select o.* into b from sma_private.onboarding_package_bookings_v1 o
    join sma_private.onboarding_n8n_accounts_v1 a on (a.customer_id,a.user_id,a.n8n_ref,a.n8n_row_id,a.kunde_email)
      =(o.customer_id,o.user_id,o.n8n_ref,o.n8n_row_id,o.email)
    where o.customer_id=c.id and o.user_id=p_owner and (o.state in ('booked','paid') or
     (o.state='offered' and o.expires_at>clock_timestamp())) for update of o;
  if p_offer is not null or p_plan is not null or p_terms is not null then
    if b.id is null or p_offer is distinct from b.id or p_plan is distinct from b.plan or p_terms is distinct from b.terms_version then
      return '{"ok":false,"code":"OFFER_CHANGED"}';
    end if;
    if b.state='offered' then
      update sma_private.onboarding_package_bookings_v1 set booked_at=clock_timestamp(),state='booked' where id=b.id;
      b.state:='booked';
    end if;
  end if;
  if b.id is null then return '{"ok":true,"offer":null}'; end if;
  return jsonb_build_object('ok',true,'offer',jsonb_build_object('id',b.id,'plan',b.plan,'state',b.state,'terms',b.terms_version,
    'checkout',case when b.state='booked' and b.expires_at>clock_timestamp() then b.checkout end));
end $$;
revoke all on function sma_private.onboarding_booking_v1(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function sma_private.onboarding_booking_v1(uuid,uuid,text,text) to authenticated;
create function public.sma_onboarding_booking_v1(p_owner uuid,p_offer uuid default null,p_plan text default null,p_terms text default null)
returns jsonb language sql security invoker set search_path='' as $$
  select sma_private.onboarding_booking_v1(p_owner,p_offer,p_plan,p_terms);
$$;
revoke all on function public.sma_onboarding_booking_v1(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.sma_onboarding_booking_v1(uuid,uuid,text,text) to authenticated;
