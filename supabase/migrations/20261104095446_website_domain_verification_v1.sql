-- DNS control evidence only. Never grants publishing, checkout or hosting access.
create table sma_private.website_domain_checks_v1 (
 customer_id bigint primary key references public.sma_kunden(id),
 user_id uuid not null,
 preparation_revision integer not null,
 hostname text not null check(length(hostname) between 4 and 235),
 token text not null check(token ~ '^sma-verification=[a-f0-9]{64}$'),
 verified_at timestamptz,
 last_attempt_at timestamptz,
 attempt_id uuid,
 last_result text not null default 'pending' check(last_result in ('pending','found','not_found','unavailable')),
 created_at timestamptz not null default now()
);
alter table sma_private.website_domain_checks_v1 enable row level security;
revoke all on sma_private.website_domain_checks_v1 from public,anon,authenticated,service_role;

create function sma_private.website_domain_check_request_v1(p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); c public.sma_kunden%rowtype;
 d sma_private.website_preparations_v1%rowtype;
 v sma_private.website_domain_checks_v1%rowtype; host text;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_action is null or p_action not in ('get','prepare','begin') then return jsonb_build_object('ok',false,'code','INVALID_ACTION');end if;
 begin
  select * into strict c from public.sma_kunden where user_id=uid for update;
 exception when no_data_found or too_many_rows then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 if c.demo_delta_aktiv is not true and lower(btrim(coalesce(c.paket,'')))<>'delta' then return jsonb_build_object('ok',false,'code','DELTA_REQUIRED');end if;
 select * into d from sma_private.website_preparations_v1 where customer_id=c.id for update;
 if d.customer_id is not null and d.user_id is distinct from uid then return jsonb_build_object('ok',false,'code','ACCOUNT_CHANGED');end if;
 if d.customer_id is null or d.mode<>'existing' then
  return case when p_action='get' then jsonb_build_object('ok',true,'state','website_required','revision',coalesce(d.revision,0)) else jsonb_build_object('ok',false,'code','WEBSITE_REQUIRED') end;
 end if;
 host:=substring(d.website_url from '^https://([^/?#]+)');
 if not sma_private.website_domain_valid_v1(host) or length(host)>235 then return jsonb_build_object('ok',false,'code','INVALID_DOMAIN');end if;
 select * into v from sma_private.website_domain_checks_v1 where customer_id=c.id for update;
 if v.customer_id is not null and v.user_id is distinct from uid then return jsonb_build_object('ok',false,'code','ACCOUNT_CHANGED');end if;
 if v.customer_id is null or v.preparation_revision<>d.revision or v.hostname<>host then
  if p_action='get' then return jsonb_build_object('ok',true,'state','unprepared','hostname',host,'revision',d.revision);end if;
  if p_action='begin' then return jsonb_build_object('ok',false,'code','PREPARE_REQUIRED');end if;
  insert into sma_private.website_domain_checks_v1(customer_id,user_id,preparation_revision,hostname,token)
   values(c.id,uid,d.revision,host,'sma-verification='||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''))
   on conflict(customer_id) do update set preparation_revision=excluded.preparation_revision,hostname=excluded.hostname,
    token=excluded.token,verified_at=null,attempt_id=null,last_result='pending',created_at=clock_timestamp()
   returning * into v;
 end if;
 if p_action='begin' then
  if v.last_attempt_at>clock_timestamp()-interval '60 seconds' then return jsonb_build_object('ok',false,'code','CHECK_RATE_LIMITED');end if;
  update sma_private.website_domain_checks_v1 set last_attempt_at=clock_timestamp(),attempt_id=gen_random_uuid()
   where customer_id=c.id returning * into v;
 end if;
 return jsonb_build_object('ok',true,'state',case when v.verified_at is null then 'pending' else 'verified' end,
  'revision',d.revision,'hostname',host,'record_name','_sma-verification.'||host,'record_type','TXT','record_value',v.token,
  'verified_at',v.verified_at,'last_result',v.last_result,'checked_at',v.last_attempt_at,
  'attempt_id',case when p_action='begin' then v.attempt_id else null end);
end $$;
revoke all on function sma_private.website_domain_check_request_v1(text) from public,anon,authenticated,service_role;
grant execute on function sma_private.website_domain_check_request_v1(text) to authenticated;
create function public.sma_website_domain_check_v1(p_action text)
returns jsonb language sql security invoker set search_path='' as $$select sma_private.website_domain_check_request_v1(p_action)$$;
revoke all on function public.sma_website_domain_check_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.sma_website_domain_check_v1(text) to authenticated;

-- Service-only completion: p_user_id comes from the Edge Function's validated
-- Auth user, never from the request body. Check ownership/access/revision again
-- after the external DNS lookup; an old or parallel attempt cannot win.
create function sma_private.website_domain_check_finish_v1(p_user_id uuid,p_attempt_id uuid,p_result text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.sma_kunden%rowtype; d sma_private.website_preparations_v1%rowtype; v sma_private.website_domain_checks_v1%rowtype;
begin
 if p_user_id is null or p_attempt_id is null or p_result is null or p_result not in ('found','not_found','unavailable') then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 begin select * into strict c from public.sma_kunden where user_id=p_user_id for update;
 exception when no_data_found or too_many_rows then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 if c.demo_delta_aktiv is not true and lower(btrim(coalesce(c.paket,'')))<>'delta' then return jsonb_build_object('ok',false,'code','DELTA_REQUIRED');end if;
 select * into d from sma_private.website_preparations_v1 where customer_id=c.id for update;
 select * into v from sma_private.website_domain_checks_v1 where customer_id=c.id for update;
 if d.user_id is distinct from p_user_id or v.user_id is distinct from p_user_id then return jsonb_build_object('ok',false,'code','ACCOUNT_CHANGED');end if;
 if v.attempt_id is distinct from p_attempt_id or v.last_attempt_at<clock_timestamp()-interval '2 minutes'
  or v.preparation_revision<>d.revision or d.mode<>'existing'
  or v.hostname is distinct from substring(d.website_url from '^https://([^/?#]+)') then return jsonb_build_object('ok',false,'code','CHECK_STALE');end if;
 update sma_private.website_domain_checks_v1 set last_result=p_result,attempt_id=null,
  verified_at=case when p_result='found' then clock_timestamp() when p_result='not_found' then null else verified_at end
  where customer_id=c.id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function sma_private.website_domain_check_finish_v1(uuid,uuid,text) from public,anon,authenticated,service_role;
grant usage on schema sma_private to service_role;
grant execute on function sma_private.website_domain_check_finish_v1(uuid,uuid,text) to service_role;
create function public.sma_website_domain_check_finish_v1(p_user_id uuid,p_attempt_id uuid,p_result text)
returns jsonb language sql security invoker set search_path='' as $$select sma_private.website_domain_check_finish_v1(p_user_id,p_attempt_id,p_result)$$;
revoke all on function public.sma_website_domain_check_finish_v1(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.sma_website_domain_check_finish_v1(uuid,uuid,text) to service_role;
