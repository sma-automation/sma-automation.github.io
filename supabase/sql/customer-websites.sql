-- SMA-hosted customer pages. Existing external website preparations are untouched.
create schema if not exists sma_private;
create table if not exists sma_private.customer_websites_v1 (
 customer_id bigint primary key references public.sma_kunden(id),
 user_id uuid not null,
 site_id uuid not null unique default gen_random_uuid(),
 draft jsonb not null,
 published jsonb,
 revision integer not null check(revision>0),
 published_at timestamptz,
 last_request_id uuid not null,
 last_action text not null,
 last_input jsonb not null,
 updated_at timestamptz not null default now()
);
alter table sma_private.customer_websites_v1 enable row level security;
revoke all on sma_private.customer_websites_v1 from public,anon,authenticated,service_role;

create or replace function sma_private.customer_website_content_valid_v1(value jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare k text; max_length integer;
begin
 if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>45000
  or not(value ?& array['name','headline','intro','about','contact_email','legal_notice','privacy_notice','contact_phone','contact_address','service_1_title','service_1_text','service_2_title','service_2_text','service_3_title','service_3_text'])
  or exists(select 1 from jsonb_object_keys(value) x where x not in ('name','headline','intro','about','contact_email','legal_notice','privacy_notice','contact_phone','contact_address','service_1_title','service_1_text','service_2_title','service_2_text','service_3_title','service_3_text')) then return false;end if;
 foreach k in array array['name','headline','intro','about','contact_email','legal_notice','privacy_notice','contact_phone','contact_address','service_1_title','service_1_text','service_2_title','service_2_text','service_3_title','service_3_text'] loop
  max_length:=case k when 'name' then 100 when 'headline' then 160 when 'intro' then 600 when 'about' then 4000 when 'contact_email' then 254 when 'contact_phone' then 60 when 'contact_address' then 400 when 'service_1_title' then 80 when 'service_2_title' then 80 when 'service_3_title' then 80 when 'service_1_text' then 400 when 'service_2_text' then 400 when 'service_3_text' then 400 else 6000 end;
  if jsonb_typeof(value->k) is distinct from 'string' or length(value->>k)>max_length
   or (value->>k) ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then return false;end if;
 end loop;
 if length(btrim(value->>'name'))=0 or length(btrim(value->>'headline'))=0 then return false;end if;
 if value->>'contact_email'<>'' and (value->>'contact_email') !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?([.][A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' then return false;end if;
 return true;
end $$;
revoke all on function sma_private.customer_website_content_valid_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function sma_private.customer_website_request_v1(p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();c public.sma_kunden%rowtype;w sma_private.customer_websites_v1%rowtype;
 expected integer;req uuid;content jsonb;intent jsonb;shop text;access_ok boolean;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_action is null or p_action not in ('get','generate','save','publish','unpublish') then return jsonb_build_object('ok',false,'code','INVALID_ACTION');end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>46000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 begin select * into strict c from public.sma_kunden where user_id=uid for update;
 exception when no_data_found or too_many_rows then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end;
 access_ok:=c.aktiv is true and (c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true)
  and (c.demo_delta_aktiv is true or lower(btrim(coalesce(c.paket,'')))='delta');
 -- Owners can still inspect their saved work and take a page offline after access expires.
 if not access_ok and p_action not in ('get','unpublish') then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 select * into w from sma_private.customer_websites_v1 where customer_id=c.id for update;
 if w.customer_id is not null and w.user_id is distinct from uid then return jsonb_build_object('ok',false,'code','ACCOUNT_CHANGED');end if;
 if p_action='get' then
  if p_input<>'{}'::jsonb then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 else
  if not(p_input ?& array['expected_revision','request_id'])
   or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('expected_revision','request_id','content'))
   or (p_action='save') is distinct from (p_input ? 'content')
   or jsonb_typeof(p_input->'expected_revision') is distinct from 'number'
   or (p_input->>'expected_revision') !~ '^[0-9]{1,10}$'
   or jsonb_typeof(p_input->'request_id') is distinct from 'string'
   or (p_input->>'request_id') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  if (p_input->>'expected_revision')::numeric>2147483646 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  expected:=(p_input->>'expected_revision')::integer;req:=(p_input->>'request_id')::uuid;intent:=p_input-'expected_revision'-'request_id';
  if p_action='save' and not sma_private.customer_website_content_valid_v1(p_input->'content') then return jsonb_build_object('ok',false,'code','INVALID_CONTENT');end if;
  if w.last_request_id=req then
   if w.last_action<>p_action or w.last_input<>intent then return jsonb_build_object('ok',false,'code','REQUEST_CONFLICT');end if;
  else
   if expected<>coalesce(w.revision,0) then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT');end if;
   if p_action='generate' then
    if w.customer_id is not null then return jsonb_build_object('ok',false,'code','ALREADY_CREATED');end if;
    content:=jsonb_build_object('name','Meine Webseite','headline','Willkommen bei uns','intro','Entdecke unser Angebot.','about','','contact_email','','legal_notice','','privacy_notice','','contact_phone','','contact_address','','service_1_title','','service_1_text','','service_2_title','','service_2_text','','service_3_title','','service_3_text','');
    insert into sma_private.customer_websites_v1(customer_id,user_id,draft,revision,last_request_id,last_action,last_input)
    values(c.id,uid,content,1,req,p_action,intent) returning * into w;
   else
    if w.customer_id is null then return jsonb_build_object('ok',false,'code','WEBSITE_REQUIRED');end if;
    update sma_private.customer_websites_v1 set
     draft=case when p_action='save' then p_input->'content' else draft end,
     published=case when p_action='publish' then draft when p_action='unpublish' then null else published end,
     published_at=case when p_action='publish' then clock_timestamp() when p_action='unpublish' then null else published_at end,
     revision=revision+1,last_request_id=req,last_action=p_action,last_input=intent,updated_at=clock_timestamp()
     where customer_id=c.id returning * into w;
   end if;
  end if;
 end if;
 if c.shop_oeffentlich is true and length(c.shop_slug) between 1 and 63 and c.shop_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
  shop:='https://sma-automation.com/app/shop.html?shop='||c.shop_slug;
 end if;
 return jsonb_build_object('ok',true,'site_id',w.site_id,'revision',coalesce(w.revision,0),'content',w.draft,
  'published',w.published is not null,'publicly_available',w.published is not null and access_ok,
  'has_changes',w.published is distinct from w.draft,'can_edit',access_ok,'shop_url',shop,
  'website_url',case when w.site_id is not null then 'https://sma-automation.com/app/website.html?site='||w.site_id::text end);
end $$;
revoke all on function sma_private.customer_website_request_v1(text,jsonb) from public,anon,authenticated,service_role;
grant usage on schema sma_private to authenticated;
grant execute on function sma_private.customer_website_request_v1(text,jsonb) to authenticated;
create or replace function public.sma_customer_website_v1(p_action text,p_input jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select sma_private.customer_website_request_v1(p_action,p_input)$$;
revoke all on function public.sma_customer_website_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_customer_website_v1(text,jsonb) to authenticated;

-- A narrow public projection; draft text, account IDs and private email are never returned.
create or replace function sma_private.customer_website_public_v1(p_site_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w sma_private.customer_websites_v1%rowtype;c public.sma_kunden%rowtype;shop text;
begin
 select * into w from sma_private.customer_websites_v1 where site_id=p_site_id;
 if w.published is null then return jsonb_build_object('ok',false,'code','NOT_AVAILABLE');end if;
 select * into c from public.sma_kunden where id=w.customer_id and user_id=w.user_id;
 if c.id is null or c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true)
  or (c.demo_delta_aktiv is not true and lower(btrim(coalesce(c.paket,'')))<>'delta') then return jsonb_build_object('ok',false,'code','NOT_AVAILABLE');end if;
 if c.shop_oeffentlich is true and length(c.shop_slug) between 1 and 63 and c.shop_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
  shop:='https://sma-automation.com/app/shop.html?shop='||c.shop_slug;
 end if;
 return jsonb_build_object('ok',true,'site_id',w.site_id,'content',w.published,'shop_url',shop);
end $$;
revoke all on function sma_private.customer_website_public_v1(uuid) from public,anon,authenticated,service_role;
grant usage on schema sma_private to anon,authenticated;
grant execute on function sma_private.customer_website_public_v1(uuid) to anon,authenticated;
create or replace function public.sma_customer_website_public_v1(p_site_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$select sma_private.customer_website_public_v1(p_site_id)$$;
revoke all on function public.sma_customer_website_public_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.sma_customer_website_public_v1(uuid) to anon,authenticated;
