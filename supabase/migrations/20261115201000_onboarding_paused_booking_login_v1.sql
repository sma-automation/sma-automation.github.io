-- Resolve a paused renewal only for the authenticated customer owning the booking.
-- Returning an ID is navigation metadata, never payment or access authorization.
create function public.sma_onboarding_paused_booking_v1()
returns uuid language sql stable security definer set search_path='' as $$
  select b.id
  from sma_private.onboarding_package_bookings_v1 b
  join public.sma_kunden c on (c.id,c.user_id)=(b.customer_id,b.user_id)
  join sma_private.onboarding_plan_choices_v1 p
    on (p.customer_id,p.user_id,p.n8n_ref,p.n8n_row_id,p.n8n_link_email)
     =(b.customer_id,b.user_id,b.n8n_ref,b.n8n_row_id,b.email)
  where b.user_id=(select auth.uid())
    and b.automated is true and b.state='active' and b.renewal_suspended is true
    and c.aktiv is false and c.zahlung_bestaetigt is false
    and c.demo_delta_aktiv is false and c.paket=b.plan and c.n8n_kunde_id=b.n8n_ref
  limit 1;
$$;
revoke all on function public.sma_onboarding_paused_booking_v1() from public,anon,authenticated,service_role;
grant execute on function public.sma_onboarding_paused_booking_v1() to authenticated;
