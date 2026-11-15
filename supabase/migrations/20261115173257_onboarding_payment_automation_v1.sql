-- A first checkout can now follow an accepted booking for a linked, inactive account.
alter table sma_private.onboarding_package_bookings_v1
  alter column payment_id drop not null, alter column merchant_customer drop not null,
  alter column checkout drop not null, alter column expires_at drop not null,
  add column automated boolean not null default false,
  add column first_started timestamptz, add column subscription_id text unique, add column sub_started timestamptz,
  add column lease uuid, add column leased_until timestamptz,
  add constraint onboarding_payment_pilot_fields check (automated or
    (payment_id is not null and merchant_customer is not null and checkout is not null and expires_at is not null));
create table sma_private.onboarding_payment_settings_v1 (
  singleton boolean primary key check(singleton), enabled boolean not null
);
insert into sma_private.onboarding_payment_settings_v1 values(true,false);
alter table sma_private.onboarding_payment_settings_v1 enable row level security;
revoke all on sma_private.onboarding_payment_settings_v1 from public,anon,authenticated,service_role;

create function sma_private.automatic_booking_v1(p_owner uuid,p_offer uuid,p_plan text,p_terms text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  automatic_offer constant uuid := '00000000-0000-4000-8000-000000000001';
  selection jsonb; current_offer jsonb; a sma_private.onboarding_n8n_accounts_v1%rowtype;
  b sma_private.onboarding_package_bookings_v1%rowtype;
begin
  if auth.uid() is null or p_owner is distinct from auth.uid() then return '{"ok":false,"code":"ACCOUNT_UNAVAILABLE"}'; end if;
  if p_offer is distinct from automatic_offer and (p_offer is not null or p_plan is not null or p_terms is not null) then
    return sma_private.onboarding_booking_v1(p_owner,p_offer,p_plan,p_terms);
  end if;
  current_offer:=sma_private.onboarding_booking_v1(p_owner,null,null,null);
  if current_offer->>'ok' is distinct from 'true' then return current_offer; end if;
  if current_offer->>'offer' is not null then
    select * into b from sma_private.onboarding_package_bookings_v1 where id=(current_offer->'offer'->>'id')::uuid;
    if p_offer=automatic_offer and (not b.automated or (b.plan,b.terms_version) is distinct from (p_plan,p_terms))
      then return '{"ok":false,"code":"OFFER_CHANGED"}'; end if;
    if b.automated then current_offer:=jsonb_set(current_offer,'{offer,automated}','true'); end if;
    return current_offer;
  end if;
  if not (select enabled from sma_private.onboarding_payment_settings_v1 where singleton) then
    if p_offer is null then return current_offer; end if;
    return '{"ok":false,"code":"OFFER_CHANGED"}';
  end if;
  selection:=sma_private.onboarding_plan_choice_v1(p_owner,null,null);
  select * into a from sma_private.onboarding_n8n_accounts_v1 where user_id=p_owner and n8n_row_id is not null;
  if not found or selection->>'linked' is distinct from 'true' then return current_offer; end if;
  if exists(select from sma_private.onboarding_package_bookings_v1 where customer_id=a.customer_id and user_id=a.user_id
    and state='offered' and expires_at<=clock_timestamp()) and p_offer=automatic_offer then
    update sma_private.onboarding_package_bookings_v1 set state='closed' where customer_id=a.customer_id and user_id=a.user_id
      and state='offered' and expires_at<=clock_timestamp();
  end if;
  if exists(select from sma_private.onboarding_package_bookings_v1 where customer_id=a.customer_id and user_id=a.user_id
    and (state='active' or (state='reversed' and subscription_id is not null))) then return current_offer; end if;
  if p_offer is null then
    return jsonb_build_object('ok',true,'offer',jsonb_build_object('id',automatic_offer,'state','offered','plan',selection->>'plan','terms','2026-11-15-v1','checkout',null,'automated',true));
  end if;
  if p_plan is distinct from selection->>'plan' or p_terms is distinct from '2026-11-15-v1' then return '{"ok":false,"code":"OFFER_CHANGED"}'; end if;
  insert into sma_private.onboarding_package_bookings_v1(customer_id,user_id,n8n_ref,n8n_row_id,email,plan,state,booked_at,automated)
    values(a.customer_id,p_owner,a.n8n_ref,a.n8n_row_id,a.kunde_email,p_plan,'booked',clock_timestamp(),true) returning * into b;
  return jsonb_build_object('ok',true,'offer',jsonb_build_object('id',b.id,'state',b.state,'plan',b.plan,'terms',b.terms_version,'checkout',null,'automated',true));
end $$;
revoke all on function sma_private.automatic_booking_v1(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function sma_private.automatic_booking_v1(uuid,uuid,text,text) to authenticated;
create or replace function public.sma_onboarding_booking_v1(p_owner uuid,p_offer uuid default null,p_plan text default null,p_terms text default null)
returns jsonb language sql security invoker set search_path='' as $$
 select sma_private.automatic_booking_v1(p_owner,p_offer,p_plan,p_terms);
$$;

-- Edge and n8n exchange single-use, short-lived operations through their existing server credentials.
create table sma_private.onboarding_payment_tickets_v1(id uuid primary key default gen_random_uuid(), job jsonb not null, until_at timestamptz not null);
create index onboarding_ticket_expiry_v1 on sma_private.onboarding_payment_tickets_v1(until_at);
alter table sma_private.onboarding_payment_tickets_v1 enable row level security;
revoke all on sma_private.onboarding_payment_tickets_v1 from public,anon,authenticated,service_role;
create function public.sma_package_ticket_v1(p_id uuid default null,p_job jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare out_id uuid; job_data jsonb;
begin
 if p_id is not null and p_job is null then
   delete from sma_private.onboarding_payment_tickets_v1 where id=p_id and until_at>clock_timestamp() returning job into job_data;
   return coalesce(job_data,'{}');
 end if;
 if p_id is null and p_job->>'op' in ('lookup','customer','first','payment','subscribe','subscription','account','activate','disable') then
   delete from sma_private.onboarding_payment_tickets_v1 where until_at<=clock_timestamp();
   insert into sma_private.onboarding_payment_tickets_v1(job,until_at) values(p_job,clock_timestamp()+interval '30 seconds') returning id into out_id;
   return to_jsonb(out_id);
 end if;
 return '{}';
end $$;
revoke all on function public.sma_package_ticket_v1(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_package_ticket_v1(uuid,jsonb) to service_role;

create function public.sma_package_worker_v1(p_id uuid,p_lease uuid,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare b sma_private.onboarding_package_bookings_v1%rowtype; result text;
begin
 if p_lease is null then return '{"error":"INVALID"}'; end if;
 -- Same lock order as reservation and receipt functions.
 perform c.id from public.sma_kunden c join sma_private.onboarding_package_bookings_v1 o
    on (c.id,c.user_id)=(o.customer_id,o.user_id) where o.id=p_id and o.automated for no key update of c;
 select * into b from sma_private.onboarding_package_bookings_v1 where id=p_id and automated for update;
 if not found then return '{"error":"UNKNOWN"}'; end if;
 if p_action='lock' then
   if b.leased_until>clock_timestamp() then return '{"error":"BUSY"}'; end if;
   if b.state not in ('active','reversed','closed') and not exists(select from sma_private.onboarding_n8n_accounts_v1 a
     where (a.customer_id,a.user_id,a.n8n_ref,a.n8n_row_id,a.kunde_email)=(b.customer_id,b.user_id,b.n8n_ref,b.n8n_row_id,b.email)) then return '{"error":"ACCOUNT_UNAVAILABLE"}'; end if;
   update sma_private.onboarding_package_bookings_v1 set first_started=coalesce(first_started,clock_timestamp()),lease=p_lease,leased_until=clock_timestamp()+interval '2 minutes' where id=b.id;
 elsif b.lease is distinct from p_lease or b.leased_until is null or b.leased_until<=clock_timestamp() then return '{"error":"LOST_LEASE"}';
 elsif p_action='release' then
   update sma_private.onboarding_package_bookings_v1 set lease=null,leased_until=null where id=b.id; return '{"ok":true}';
 elsif p_action='customer' and b.state='booked' and coalesce(p_data->>'id','') ~ '^cst_[A-Za-z0-9]+$' and (b.merchant_customer is null or b.merchant_customer=p_data->>'id') then
   update sma_private.onboarding_package_bookings_v1 set merchant_customer=p_data->>'id' where id=b.id;
 elsif p_action='payment' and b.state='booked' and coalesce(p_data->>'id','') ~ '^tr_[A-Za-z0-9]+$'
   and b.merchant_customer is not null and (b.payment_id is null or b.payment_id=p_data->>'id') then
   if p_data->>'checkout' is not null and p_data->>'checkout' !~ '^https://(www|checkout)\.mollie\.com/checkout/[A-Za-z0-9/_-]+$' then return '{"error":"INVALID_LINK"}'; end if;
   update sma_private.onboarding_package_bookings_v1 set payment_id=p_data->>'id',checkout=p_data->>'checkout',
     expires_at=(p_data->>'expires')::timestamptz where id=b.id;
 elsif p_action='begin_subscription' and b.state='paid' then
   update sma_private.onboarding_package_bookings_v1 set sub_started=coalesce(sub_started,clock_timestamp()) where id=b.id;
 elsif p_action='subscription' and b.state='paid' and coalesce(p_data->>'id','') ~ '^sub_[A-Za-z0-9]+$' and (b.subscription_id is null or b.subscription_id=p_data->>'id') then
   update sma_private.onboarding_package_bookings_v1 set subscription_id=p_data->>'id' where id=b.id;
 elsif p_action='receipt' and b.payment_id is not null and b.payment_id=p_data->'receipt'->>'id' and b.n8n_ref=p_data->'receipt'->>'ref' then
   if p_data->>'row' is not null and (b.subscription_id is null or b.subscription_id is distinct from p_data->'row'->>'mollie_subscription_id') then return '{"error":"SUBSCRIPTION_CONFLICT"}'; end if;
   result:=sma_private.sync_onboarding_booking_v1(p_data->'receipt',nullif(p_data->'row','null'));
   return jsonb_build_object('state',result);
 else return '{"error":"INVALID_TRANSITION"}';
 end if;
 select * into strict b from sma_private.onboarding_package_bookings_v1 where id=p_id;
 update sma_private.onboarding_package_bookings_v1 set leased_until=clock_timestamp()+interval '2 minutes' where id=p_id;
 return to_jsonb(b)-array['customer_id','user_id','lease','leased_until','checkout'];
end $$;
revoke all on function public.sma_package_worker_v1(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_package_worker_v1(uuid,uuid,text,jsonb) to service_role;
