-- Non-binding preference for a newly confirmed website account, separate from billing.
create table sma_private.onboarding_plan_choices_v1 (
  customer_id bigint not null references public.sma_kunden(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('alpha','beta','delta')),
  primary key (customer_id, user_id)
);
create index onboarding_plan_choices_user_v1 on sma_private.onboarding_plan_choices_v1(user_id);
alter table sma_private.onboarding_plan_choices_v1 enable row level security;
revoke all on sma_private.onboarding_plan_choices_v1 from public, anon, authenticated, service_role;

create function sma_private.onboarding_plan_choice_v1(p_owner uuid, p_plan text, p_expected_plan text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  customer public.sma_kunden%rowtype;
  confirmed_email text;
  saved_plan text;
begin
  if owner_id is null or p_owner is distinct from owner_id then
    return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');
  end if;
  if (p_plan is not null and p_plan not in ('alpha','beta','delta'))
     or (p_expected_plan is not null and (p_plan is null or p_expected_plan not in ('alpha','beta','delta'))) then
    return jsonb_build_object('ok',false,'code','INVALID_PLAN');
  end if;
  select u.email into confirmed_email from auth.users u
    where u.id=owner_id and u.email_confirmed_at is not null;
  if nullif(btrim(confirmed_email),'') is null then
    return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');
  end if;

  -- Serialize selections with each other and with later changes to this customer's access.
  begin
    select c.* into strict customer from public.sma_kunden c
      where c.user_id=owner_id for no key update;
  exception when no_data_found or too_many_rows then
    return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');
  end;
  if lower(btrim(customer.kunde_email)) is distinct from lower(btrim(confirmed_email))
    or customer.aktiv is not false or customer.demo_delta_aktiv is not false
    or customer.zahlung_bestaetigt is not false or customer.paket is not null
    or customer.n8n_kunde_id is not null then
    return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');
  end if;

  select c.plan into saved_plan from sma_private.onboarding_plan_choices_v1 c
    where c.customer_id=customer.id and c.user_id=owner_id;
  if p_plan is not null and p_plan is distinct from saved_plan then
    if p_expected_plan is distinct from saved_plan then
      return jsonb_build_object('ok',false,'code','CONFLICT','plan',saved_plan);
    end if;
    insert into sma_private.onboarding_plan_choices_v1(customer_id,user_id,plan)
      values(customer.id,owner_id,p_plan)
      on conflict(customer_id,user_id) do update set plan=excluded.plan;
    saved_plan := p_plan;
  end if;
  return jsonb_build_object('ok',true,'plan',saved_plan);
end;
$$;
revoke all on function sma_private.onboarding_plan_choice_v1(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function sma_private.onboarding_plan_choice_v1(uuid,text,text) to authenticated;

create function public.sma_onboarding_plan_choice_v1(p_owner uuid, p_plan text default null, p_expected_plan text default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select sma_private.onboarding_plan_choice_v1(p_owner,p_plan,p_expected_plan);
$$;
revoke all on function public.sma_onboarding_plan_choice_v1(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.sma_onboarding_plan_choice_v1(uuid,text,text) to authenticated;
