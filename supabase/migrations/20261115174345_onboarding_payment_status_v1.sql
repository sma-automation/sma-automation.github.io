-- The checkout return can read only the state of the signed-in customer's own order.
create function sma_private.onboarding_payment_status_v1(p_order uuid)
returns text language sql stable security definer set search_path='' as $$
  select coalesce((
    select case
      when b.state='active' and (c.aktiv is not true or c.zahlung_bestaetigt is not true
        or c.demo_delta_aktiv is not false or c.paket is distinct from b.plan
        or c.n8n_kunde_id is distinct from b.n8n_ref) then 'unavailable'
      else b.state end
    from sma_private.onboarding_package_bookings_v1 b
    join public.sma_kunden c on (c.id,c.user_id)=(b.customer_id,b.user_id)
    where b.id=p_order and b.user_id=(select auth.uid()) and b.automated
  ), 'unavailable');
$$;
revoke all on function sma_private.onboarding_payment_status_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function sma_private.onboarding_payment_status_v1(uuid) to authenticated;

create function public.sma_onboarding_payment_status_v1(p_order uuid)
returns text language sql stable security invoker set search_path='' as $$
  select sma_private.onboarding_payment_status_v1(p_order);
$$;
revoke all on function public.sma_onboarding_payment_status_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.sma_onboarding_payment_status_v1(uuid) to authenticated;
