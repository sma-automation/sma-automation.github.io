-- One customer-owned source for public business details. Never changes login,
-- billing, n8n mapping, external website addresses or published website content.
create table if not exists sma_private.company_profiles_v1 (
 customer_id bigint primary key references public.sma_kunden(id),user_id uuid not null,
 profile jsonb not null,revision integer not null check(revision>0),last_request_id uuid not null,
 updated_at timestamptz not null default now()
);
alter table sma_private.company_profiles_v1 enable row level security;
revoke all on sma_private.company_profiles_v1 from public,anon,authenticated,service_role;

create or replace function sma_private.company_profile_valid_v1(value jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare k text;max_length integer;keys text[]:=array['company_name','legal_form','industry','representative','street','house_number','postal_code','city','country','public_email','phone','contact_person','vat_id','register_number','register_court','opening_hours'];
begin
 if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>16000
  or not(value ?& keys) or exists(select 1 from jsonb_object_keys(value) x where not(x=any(keys))) then return false;end if;
 foreach k in array keys loop
  max_length:=case k when 'company_name' then 100 when 'legal_form' then 60 when 'industry' then 100 when 'representative' then 120 when 'street' then 120 when 'house_number' then 20 when 'postal_code' then 20 when 'city' then 100 when 'country' then 80 when 'public_email' then 254 when 'phone' then 60 when 'contact_person' then 120 when 'vat_id' then 40 when 'register_number' then 80 when 'register_court' then 120 else 1000 end;
  if jsonb_typeof(value->k) is distinct from 'string' or length(value->>k)>max_length
   or (value->>k) ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' or (k<>'opening_hours' and (value->>k) ~ '[\n\r]') then return false;end if;
 end loop;
 if btrim(value->>'company_name')='' then return false;end if;
 if value->>'public_email'<>'' and (value->>'public_email') !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?([.][A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' then return false;end if;
 return true;
end $$;
revoke all on function sma_private.company_profile_valid_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function sma_private.company_profile_address_v1(value jsonb)
returns text language sql immutable security invoker set search_path='' as $$
 select concat_ws(E'\n',nullif(concat_ws(' ',nullif(btrim(value->>'street'),''),nullif(btrim(value->>'house_number'),'')),''),
 nullif(concat_ws(' ',nullif(btrim(value->>'postal_code'),''),nullif(btrim(value->>'city'),'')),''),nullif(btrim(value->>'country'),''))
$$;
revoke all on function sma_private.company_profile_address_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function sma_private.website_with_company_v1(content jsonb,profile jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
 select case when content is null or profile is null then content else content||jsonb_build_object(
  'name',profile->>'company_name','contact_email',profile->>'public_email','contact_phone',profile->>'phone',
  'contact_address',sma_private.company_profile_address_v1(profile)) end
$$;
revoke all on function sma_private.website_with_company_v1(jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function sma_private.company_profile_request_v1(p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();c public.sma_kunden%rowtype;p sma_private.company_profiles_v1%rowtype;
 expected integer;req uuid;access_ok boolean;suggested jsonb;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_action is null or p_action not in ('get','save') then return jsonb_build_object('ok',false,'code','INVALID_ACTION');end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>17000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 begin select * into strict c from public.sma_kunden where user_id=uid for update;
 exception when no_data_found or too_many_rows then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end;
 access_ok:=c.aktiv is true and (c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true);
 if p_action='save' and not access_ok then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 select * into p from sma_private.company_profiles_v1 where customer_id=c.id for update;
 if p.customer_id is not null and p.user_id is distinct from uid then return jsonb_build_object('ok',false,'code','ACCOUNT_CHANGED');end if;
 if p_action='get' then
  if p_input<>'{}'::jsonb then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 else
  if not(p_input ?& array['profile','expected_revision','request_id'])
   or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('profile','expected_revision','request_id'))
   or jsonb_typeof(p_input->'expected_revision') is distinct from 'number' or p_input->>'expected_revision' !~ '^[0-9]{1,10}$'
   or jsonb_typeof(p_input->'request_id') is distinct from 'string' or p_input->>'request_id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  if (p_input->>'expected_revision')::numeric>2147483646 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  if not sma_private.company_profile_valid_v1(p_input->'profile') then return jsonb_build_object('ok',false,'code','INVALID_PROFILE');end if;
  expected:=(p_input->>'expected_revision')::integer;req:=(p_input->>'request_id')::uuid;
  if p.last_request_id=req then
   if p.profile<>p_input->'profile' then return jsonb_build_object('ok',false,'code','REQUEST_CONFLICT');end if;
  else
   if expected<>coalesce(p.revision,0) then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT');end if;
   insert into sma_private.company_profiles_v1(customer_id,user_id,profile,revision,last_request_id)
   values(c.id,uid,p_input->'profile',1,req)
   on conflict(customer_id) do update set profile=excluded.profile,revision=company_profiles_v1.revision+1,last_request_id=excluded.last_request_id,updated_at=clock_timestamp() returning * into p;
  end if;
 end if;
 -- Only prior user-entered website data may be suggested. No auth/account email import.
 if p.customer_id is null then
  select jsonb_build_object('company_name',case when draft->>'name'='Meine Webseite' then '' else draft->>'name' end,
   'public_email',draft->>'contact_email','phone',draft->>'contact_phone','previous_address',draft->>'contact_address') into suggested
   from sma_private.customer_websites_v1 where customer_id=c.id and user_id=uid;
 end if;
 return jsonb_build_object('ok',true,'revision',coalesce(p.revision,0),'profile',p.profile,'can_edit',access_ok,'suggested',suggested);
end $$;
revoke all on function sma_private.company_profile_request_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function sma_private.company_profile_request_v1(text,jsonb) to authenticated;
create or replace function public.sma_company_profile_v1(p_action text,p_input jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select sma_private.company_profile_request_v1(p_action,p_input)$$;
revoke all on function public.sma_company_profile_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_company_profile_v1(text,jsonb) to authenticated;
