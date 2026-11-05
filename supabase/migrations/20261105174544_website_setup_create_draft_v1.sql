-- Create the private draft and setup job atomically on explicit start.
create or replace function sma_private.website_setup_request_v1(p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();c public.sma_kunden%rowtype;w sma_private.customer_websites_v1%rowtype;
 j sma_private.website_setup_jobs_v1%rowtype; ready boolean; new_id uuid; generated jsonb;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_action is null or p_action not in ('get','start','retry') or p_input is distinct from '{}'::jsonb then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 begin select * into strict c from public.sma_kunden where user_id=uid for update;
 exception when no_data_found or too_many_rows then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true)
  or (c.demo_delta_aktiv is not true and lower(btrim(coalesce(c.paket,'')))<>'delta') then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 select * into w from sma_private.customer_websites_v1 where customer_id=c.id;
 if w.site_id is not null and w.user_id is distinct from uid then return jsonb_build_object('ok',false,'code','ACCOUNT_CHANGED');end if;
 select exists(select 1 from sma_private.website_setup_config_v1 where enabled) into ready;
 select * into j from sma_private.website_setup_jobs_v1 where customer_id=c.id for update;
 if j.id is not null and (j.user_id is distinct from uid or j.site_id is distinct from w.site_id) then return jsonb_build_object('ok',false,'code','ACCOUNT_CHANGED');end if;
 if p_action in ('start','retry') then
  if not ready then return jsonb_build_object('ok',false,'code','SETUP_UNAVAILABLE');end if;
  if w.site_id is null then
   if p_action<>'start' then return jsonb_build_object('ok',false,'code','WEBSITE_DRAFT_REQUIRED');end if;
   -- The customer row is locked. Reuse the existing generator and company-profile
   -- checks; draft and setup job commit together. GET never creates anything.
   generated:=sma_private.customer_website_request_v1('generate',jsonb_build_object('expected_revision',0,'request_id',gen_random_uuid()));
   if generated->>'ok' is distinct from 'true' then return generated;end if;
   select * into strict w from sma_private.customer_websites_v1 where customer_id=c.id and user_id=uid;
  end if;
  if j.id is null then
   new_id:=gen_random_uuid();
   insert into sma_private.website_setup_jobs_v1(id,customer_id,user_id,site_id,hostname,project_name)
   values(new_id,c.id,uid,w.site_id,'seite-'||c.id||'-'||left(w.site_id::text,8)||'.sma-automation.com','sma-site-'||replace(new_id::text,'-','')) returning * into j;
  elsif p_action='retry' and j.blocked then
   -- Never retry an ownership conflict or adopt a foreign resource.
   if j.error_code in ('ACCOUNT_CHANGED','RESOURCE_CONFLICT','DNS_RECORD_CONFLICT','DNS_SUBTREE_CONFLICT','DNS_ANCESTOR_CONFLICT','DNS_WILDCARD_CONFLICT') then return jsonb_build_object('ok',false,'code','REVIEW_REQUIRED');end if;
   update sma_private.website_setup_jobs_v1 set blocked=false,error_code=null,attempts=0,next_attempt_at=now() where id=j.id returning * into j;
  end if;
  perform sma_private.website_setup_wake_v1();
 end if;
 return jsonb_build_object('ok',true,'available',ready,'draft_exists',w.site_id is not null,'job',case when j.id is null then null else jsonb_build_object(
  'id',j.id,'hostname',j.hostname,'phase',j.phase,'blocked',j.blocked,'code',j.error_code,'updated_at',j.updated_at,'completed_at',j.completed_at) end);
end $$;
revoke all on function sma_private.website_setup_request_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function sma_private.website_setup_request_v1(text,jsonb) to authenticated;
