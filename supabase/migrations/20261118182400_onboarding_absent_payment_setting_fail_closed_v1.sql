-- Fail closed when the singleton booking switch is absent, not only when explicitly OFF.
-- This is function-only; does not delete/create bookings, issue payment tickets,
-- change credentials, call n8n/Mollie, or grant new roles.
-- Preserve existing accepted_offer_id / one-booking / owner serialization logic.
create or replace function sma_private.automatic_booking_v1(p_owner uuid,p_offer uuid,p_plan text,p_terms text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  submitting boolean := p_offer is not null or p_plan is not null or p_terms is not null;
  changed constant jsonb := '{"ok":false,"code":"OFFER_CHANGED"}';
  old_offer constant uuid := '00000000-0000-4000-8000-000000000001';
  current_offer jsonb; selection jsonb; candidate record;
  b sma_private.onboarding_package_bookings_v1%rowtype;
begin
  -- Validate the owner and acquire the same customer lock used by payment receipts.
  current_offer:=sma_private.onboarding_booking_v1(p_owner,null,null,null);
  if current_offer->>'ok' is distinct from 'true' then return current_offer; end if;
  if current_offer->>'offer' is not null then
    select * into strict b from sma_private.onboarding_package_bookings_v1
      where id=(current_offer->'offer'->>'id')::uuid;
    if not b.automated then
      if submitting then return sma_private.onboarding_booking_v1(p_owner,p_offer,p_plan,p_terms); end if;
      return current_offer;
    end if;
    -- Allow the pre-migration token only for the already existing legacy order.
    if submitting and (p_offer is null or p_offer not in (b.id,coalesce(b.accepted_offer_id,old_offer))
      or (b.plan,b.terms_version) is distinct from (p_plan,p_terms)) then return changed; end if;
    return jsonb_set(current_offer,'{offer,automated}','true');
  end if;

  if (select enabled from sma_private.onboarding_payment_settings_v1 where singleton) is distinct from true then
    return case when submitting then changed else current_offer end;
  end if;
  selection:=sma_private.onboarding_plan_choice_v1(p_owner,null,null);
  -- A linked customer without a valid saved plan must never receive a payable offer.
  -- Coalesce is important: NULL NOT IN (...) would evaluate to NULL, not TRUE.
  if coalesce(selection->>'plan','') not in ('alpha','beta','delta') then
    return case when submitting then changed else current_offer end;
  end if;
  select a.*,r.next_offer_id into candidate from sma_private.onboarding_n8n_accounts_v1 a
    join sma_private.onboarding_plan_choices_v1 r using(customer_id,user_id)
    where a.user_id=p_owner and a.n8n_row_id is not null;
  if not found or selection->>'linked' is distinct from 'true' then
    return case when submitting then changed else current_offer end;
  end if;
  if exists(select from sma_private.onboarding_package_bookings_v1
    where customer_id=candidate.customer_id and user_id=p_owner
    and (state='active' or (state='reversed' and subscription_id is not null))) then
    return case when submitting then changed else current_offer end;
  end if;
  if not submitting then
    return jsonb_build_object('ok',true,'offer',jsonb_build_object('id',candidate.next_offer_id,'state','offered',
      'plan',selection->>'plan','terms','2026-11-15-v1','checkout',null,'automated',true));
  end if;
  if p_offer is distinct from candidate.next_offer_id or p_plan is distinct from selection->>'plan'
    or p_terms is distinct from '2026-11-15-v1' then return changed; end if;

  update sma_private.onboarding_package_bookings_v1 set state='closed'
    where customer_id=candidate.customer_id and user_id=p_owner and state='offered' and expires_at<=clock_timestamp();
  insert into sma_private.onboarding_package_bookings_v1
    (customer_id,user_id,n8n_ref,n8n_row_id,email,plan,state,booked_at,automated,accepted_offer_id)
    values(candidate.customer_id,p_owner,candidate.n8n_ref,candidate.n8n_row_id,candidate.kunde_email,
      p_plan,'booked',clock_timestamp(),true,p_offer) returning * into b;
  update sma_private.onboarding_plan_choices_v1 set next_offer_id=gen_random_uuid()
    where customer_id=candidate.customer_id and user_id=p_owner;
  return jsonb_build_object('ok',true,'offer',jsonb_build_object('id',b.id,'state',b.state,'plan',b.plan,
    'terms',b.terms_version,'checkout',null,'automated',true));
end $$;
