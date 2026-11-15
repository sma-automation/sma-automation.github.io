-- Only a suspension made by the renewal worker may later be lifted by it.
alter table sma_private.onboarding_package_bookings_v1
  add column renewal_suspended boolean not null default false;

create function public.sma_package_renewal_v1(p_id uuid,p_lease uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b sma_private.onboarding_package_bookings_v1%rowtype;
  c public.sma_kunden%rowtype; r jsonb:=p_data->'row'; ticket uuid;
begin
 select k.* into c from public.sma_kunden k join sma_private.onboarding_package_bookings_v1 o
 on (k.id,k.user_id)=(o.customer_id,o.user_id) where o.id=p_id and o.automated for no key update of k;
 select * into b from sma_private.onboarding_package_bookings_v1 where id=p_id and automated for update;
 if b.id is null or p_lease is null or b.lease is distinct from p_lease or b.leased_until is null
   or b.leased_until<=clock_timestamp() then return '{"error":"LOST_LEASE"}'; end if;
 if b.state not in ('paid','active') or b.subscription_id is null then return '{"error":"INVALID_STATE"}'; end if;
 if p_action='renewals' then
   if p_data->>'cursor' is not null and p_data->>'cursor' !~ '^tr_[A-Za-z0-9]{1,64}$' then return '{"error":"INVALID_CURSOR"}'; end if;
   insert into sma_private.onboarding_payment_tickets_v1(job,until_at)
   values(jsonb_build_object('op','renewals','data',jsonb_build_object('customer',b.merchant_customer,
     'subscription',b.subscription_id,'cursor',p_data->>'cursor')),clock_timestamp()+interval '30 seconds') returning id into ticket;
   update sma_private.onboarding_package_bookings_v1 set leased_until=clock_timestamp()+interval '2 minutes' where id=b.id;
   return jsonb_build_object('ticket',ticket);
 end if;
 if b.state<>'active' or c.n8n_kunde_id is distinct from b.n8n_ref or c.kunde_email is distinct from b.email
   or c.paket is distinct from b.plan or c.demo_delta_aktiv is distinct from false or not exists (
    select from sma_private.onboarding_plan_choices_v1 a where (a.customer_id,a.user_id,a.n8n_ref,a.n8n_row_id,a.n8n_link_email)
      =(b.customer_id,b.user_id,b.n8n_ref,b.n8n_row_id,b.email)) then return '{"state":"REVIEW"}'; end if;
 if r->'id' is distinct from to_jsonb(b.n8n_row_id) or r->>'kunde_id' is distinct from b.n8n_ref
   or r->>'kunde_email' is distinct from b.email or r->>'mollie_customer_id' is distinct from b.merchant_customer
   or r->>'mollie_subscription_id' is distinct from b.subscription_id or r->>'paket' is distinct from b.plan
   or r->'demo_delta_aktiv' is distinct from 'false'::jsonb or r->'has_access_token' is distinct from 'true'::jsonb
   or jsonb_typeof(r->'zugang_aktiv') is distinct from 'boolean'
   or r->'zahlung_bestaetigt' is distinct from r->'zugang_aktiv' then return '{"state":"REVIEW"}'; end if;
 if c.aktiv is distinct from (not b.renewal_suspended) or c.zahlung_bestaetigt is distinct from c.aktiv
   then return '{"state":"REVIEW"}'; end if;
 if not b.renewal_suspended and r->'zugang_aktiv'='false'::jsonb then return '{"state":"REVIEW"}'; end if;
 if p_action='suspend' then
   if not b.renewal_suspended then
     update public.sma_kunden set aktiv=false,zahlung_bestaetigt=false where id=c.id;
     update sma_private.onboarding_package_bookings_v1 set renewal_suspended=true where id=b.id;
   end if;
   return '{"state":"SUSPEND"}';
 elsif p_action='restore' then
   if not b.renewal_suspended then return '{"state":"ACTIVE"}'; end if;
   if r->'zugang_aktiv'='false'::jsonb then
     insert into sma_private.onboarding_payment_tickets_v1(job,until_at) values(jsonb_build_object('op','restore',
       'data',jsonb_build_object('row',b.n8n_row_id,'ref',b.n8n_ref,'email',b.email,'customer',b.merchant_customer,
        'subscription',b.subscription_id,'plan',b.plan)),clock_timestamp()+interval '30 seconds') returning id into ticket;
     return jsonb_build_object('state','RESTORE','ticket',ticket);
   end if;
   update public.sma_kunden set aktiv=true,zahlung_bestaetigt=true where id=c.id;
   update sma_private.onboarding_package_bookings_v1 set renewal_suspended=false where id=b.id;
   return '{"state":"ACTIVE"}';
 end if;
 return '{"error":"INVALID_ACTION"}';
end $$;
revoke all on function public.sma_package_renewal_v1(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_package_renewal_v1(uuid,uuid,text,jsonb) to service_role;

-- The checkout return can read only the state of the signed-in customer's own order.
create or replace function sma_private.onboarding_payment_status_v1(p_order uuid)
returns text language sql stable security definer set search_path='' as $$
  select coalesce((
    select case
      when b.state='active' and b.renewal_suspended and c.aktiv is false and c.zahlung_bestaetigt is false
        and c.demo_delta_aktiv is false and c.paket=b.plan and c.n8n_kunde_id=b.n8n_ref then 'renewal_suspended'
      when b.state='active' and (c.aktiv is not true or c.zahlung_bestaetigt is not true
        or c.demo_delta_aktiv is not false or c.paket is distinct from b.plan
        or c.n8n_kunde_id is distinct from b.n8n_ref) then 'unavailable'
      else b.state end
    from sma_private.onboarding_package_bookings_v1 b
    join public.sma_kunden c on (c.id,c.user_id)=(b.customer_id,b.user_id)
    where b.id=p_order and b.user_id=(select auth.uid()) and b.automated
  ), 'unavailable');
$$;
