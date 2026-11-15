-- Each reservation keeps its reference across retries and changes of preference.
alter table sma_private.onboarding_plan_choices_v1
  add column n8n_ref text not null default ('kunde_' || replace(gen_random_uuid()::text, '-', '')) unique,
  add column n8n_row_id bigint unique check (n8n_row_id > 0),
  add column n8n_link_email text,
  add constraint onboarding_n8n_receipt_v1 check ((n8n_row_id is null) = (n8n_link_email is null));

-- Operators read pending reservations and verify a row in the existing n8n table.
create view sma_private.onboarding_n8n_accounts_v1 with (security_invoker=true) as
select r.n8n_ref, c.kunde_email, r.n8n_row_id, c.id as customer_id, c.user_id
from sma_private.onboarding_plan_choices_v1 r
join public.sma_kunden c on c.id=r.customer_id and c.user_id=r.user_id
join auth.users u on u.id=c.user_id
where u.email_confirmed_at is not null and nullif(btrim(u.email),'') is not null
  and lower(btrim(c.kunde_email))=lower(btrim(u.email))
  and c.aktiv is false and c.zahlung_bestaetigt is false and c.demo_delta_aktiv is false and c.paket is null
  and ((r.n8n_row_id is null and c.n8n_kunde_id is null)
    or (r.n8n_row_id is not null and c.n8n_kunde_id=r.n8n_ref and r.n8n_link_email=c.kunde_email))
  and not exists (select from public.sma_kunden other where other.id<>c.id
    and (lower(btrim(other.kunde_email))=lower(btrim(c.kunde_email)) or other.n8n_kunde_id=r.n8n_ref));
revoke all on sma_private.onboarding_n8n_accounts_v1 from public,anon,authenticated,service_role;

-- Trusted operator supplies only the seven non-secret fields of all matching n8n rows.
create function sma_private.confirm_onboarding_n8n_v1(p_reference text, p_matches jsonb)
returns text language plpgsql security invoker set search_path='' as $$
declare
  evidence jsonb;
  row_id bigint;
  candidate sma_private.onboarding_n8n_accounts_v1%rowtype;
begin
  if jsonb_typeof(p_matches) is distinct from 'array' then return 'INVALID_EVIDENCE'; end if;
  if jsonb_array_length(p_matches)<>1 then return 'MATCH_NOT_UNIQUE'; end if;
  evidence := p_matches->0;
  if jsonb_typeof(evidence) is distinct from 'object' then return 'INVALID_EVIDENCE'; end if;
  if not (evidence ?& array['id','kunde_id','kunde_email','paket','zugang_aktiv','zahlung_bestaetigt','demo_delta_aktiv'])
     or (evidence - array['id','kunde_id','kunde_email','paket','zugang_aktiv','zahlung_bestaetigt','demo_delta_aktiv']) <> '{}'::jsonb
     or jsonb_typeof(evidence->'id') is distinct from 'number'
     or (evidence->>'id') !~ '^[1-9][0-9]{0,17}$'
     or evidence->'kunde_id' is distinct from to_jsonb(p_reference)
     or jsonb_typeof(evidence->'kunde_email') is distinct from 'string'
     or evidence->'paket' is distinct from 'null'::jsonb
     or evidence->'zugang_aktiv' is distinct from 'false'::jsonb
     or evidence->'zahlung_bestaetigt' is distinct from 'false'::jsonb
     or evidence->'demo_delta_aktiv' is distinct from 'false'::jsonb then
    return 'INVALID_EVIDENCE';
  end if;
  row_id := (evidence->>'id')::bigint;

  -- Serialize with customer changes and keep the confirmed identity stable through the write.
  perform c.id from public.sma_kunden c
    join sma_private.onboarding_plan_choices_v1 r on (r.customer_id,r.user_id)=(c.id,c.user_id)
    join auth.users u on u.id=c.user_id where r.n8n_ref=p_reference
    for no key update of c,r for share of u;
  select * into candidate from sma_private.onboarding_n8n_accounts_v1 a
    where a.n8n_ref=p_reference and a.kunde_email=evidence->>'kunde_email';
  if not found then return 'ACCOUNT_UNAVAILABLE'; end if;
  if candidate.n8n_row_id is not null then
    if candidate.n8n_row_id=row_id then return 'ALREADY_LINKED'; end if;
    return 'LINK_CONFLICT';
  end if;
  update sma_private.onboarding_plan_choices_v1 set n8n_row_id=row_id, n8n_link_email=candidate.kunde_email where n8n_ref=p_reference;
  update public.sma_kunden set n8n_kunde_id=p_reference where id=candidate.customer_id and user_id=candidate.user_id;
  return 'LINKED';
exception when unique_violation then
  return 'LINK_CONFLICT';
end;
$$;
revoke all on function sma_private.confirm_onboarding_n8n_v1(text,jsonb) from public,anon,authenticated,service_role;

create or replace function sma_private.onboarding_plan_choice_v1(p_owner uuid, p_plan text, p_expected_plan text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  customer public.sma_kunden%rowtype;
  confirmed_email text;
  saved_plan text;
  linked boolean := false;
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
  select r.plan, r.n8n_row_id is not null and r.n8n_ref=customer.n8n_kunde_id and r.n8n_link_email=customer.kunde_email into saved_plan,linked
    from sma_private.onboarding_plan_choices_v1 r where r.customer_id=customer.id and r.user_id=owner_id;
  if lower(btrim(customer.kunde_email)) is distinct from lower(btrim(confirmed_email))
    or customer.aktiv is not false or customer.demo_delta_aktiv is not false
    or customer.zahlung_bestaetigt is not false or customer.paket is not null
    or (customer.n8n_kunde_id is not null and linked is not true) then
    return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');
  end if;

  if p_plan is not null and p_plan is distinct from saved_plan then
    if p_expected_plan is distinct from saved_plan then
      return jsonb_build_object('ok',false,'code','CONFLICT','plan',saved_plan);
    end if;
    insert into sma_private.onboarding_plan_choices_v1(customer_id,user_id,plan)
      values(customer.id,owner_id,p_plan)
      on conflict(customer_id,user_id) do update set plan=excluded.plan;
    saved_plan := p_plan;
  end if;
  return jsonb_build_object('ok',true,'plan',saved_plan)
    || case when linked is true then '{"linked":true}'::jsonb else '{}'::jsonb end;
end;
$$;
