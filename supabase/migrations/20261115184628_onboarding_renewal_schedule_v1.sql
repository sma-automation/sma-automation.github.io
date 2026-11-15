alter table sma_private.onboarding_package_bookings_v1
  add column renewal_check_at timestamptz not null default now(),
  add column renewal_check_attempts smallint not null default 0 check (renewal_check_attempts between 0 and 2),
  add column renewal_checked_at timestamptz,
  add column renewal_check_result text;

create index onboarding_renewal_due_v1 on sma_private.onboarding_package_bookings_v1(renewal_check_at,id)
where automated and subscription_id is not null and payment_id is not null
  and merchant_customer is not null and state in ('paid','active','reversed');

-- If a webhook stops between the website and n8n updates, allow an early repair.
create function sma_private.package_renewal_wake_v1() returns trigger language plpgsql
security invoker set search_path='' as $$
begin
 new.renewal_check_at:=least(new.renewal_check_at,clock_timestamp()+interval '15 minutes');
 return new;
end $$;
revoke all on function sma_private.package_renewal_wake_v1() from public,anon,authenticated,service_role;
create trigger package_renewal_wake_v1 before update of state,renewal_suspended
on sma_private.onboarding_package_bookings_v1 for each row
when (new.automated and new.subscription_id is not null and
  (new.renewal_suspended is distinct from old.renewal_suspended or (new.state='reversed' and old.state<>'reversed')))
execute function sma_private.package_renewal_wake_v1();

-- The local cron job sends only a short-lived, single-use ticket to this project's own Edge Function.
create function sma_private.package_renewal_tick_v1() returns integer language plpgsql
security invoker set search_path='' as $$
declare candidate record; ticket uuid; sent integer:=0;
begin
 delete from sma_private.onboarding_payment_tickets_v1 where until_at<=now() and job->>'op'='scheduled_renewal';
 for candidate in select b.id,b.renewal_check_attempts from sma_private.onboarding_package_bookings_v1 b
   where b.automated and b.subscription_id is not null and b.payment_id is not null and b.merchant_customer is not null
     and b.state in ('paid','active','reversed') and b.renewal_check_at<=now()
     and (b.leased_until is null or b.leased_until<=now())
   order by b.renewal_check_at,b.id limit 10 for update skip locked
 loop
   insert into sma_private.onboarding_payment_tickets_v1(job,until_at)
   values(jsonb_build_object('op','scheduled_renewal','order',candidate.id),clock_timestamp()+interval '2 minutes')
   returning id into ticket;
   perform net.http_post(url:='https://bnvnmdxosbnuzedokqgh.supabase.co/functions/v1/sma-package-payment?scheduled=1',
     headers:='{"Content-Type":"application/json"}'::jsonb,body:=jsonb_build_object('ticket',ticket),timeout_milliseconds:=120000);
   update sma_private.onboarding_package_bookings_v1 set
     renewal_check_at=clock_timestamp()+case candidate.renewal_check_attempts when 0 then interval '15 minutes'
       when 1 then interval '1 hour' else interval '6 hours' end,
     renewal_check_attempts=least(candidate.renewal_check_attempts+1,2)
   where id=candidate.id;
   sent:=sent+1;
 end loop;
 return sent;
end $$;
revoke all on function sma_private.package_renewal_tick_v1() from public,anon,authenticated,service_role;

create function public.sma_package_schedule_claim_v1(p_ticket uuid) returns uuid language sql volatile
security definer set search_path='' as $$
 with claimed as (
   delete from sma_private.onboarding_payment_tickets_v1
   where id=p_ticket and job->>'op'='scheduled_renewal' and until_at>clock_timestamp() returning job
 )
 select b.id from claimed c join sma_private.onboarding_package_bookings_v1 b on b.id=(c.job->>'order')::uuid
 where b.automated and b.subscription_id is not null and b.payment_id is not null and b.merchant_customer is not null
   and b.state in ('paid','active','reversed');
$$;
revoke all on function public.sma_package_schedule_claim_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.sma_package_schedule_claim_v1(uuid) to service_role;

create function public.sma_package_schedule_result_v1(p_id uuid,p_lease uuid,p_result text,p_check_on date)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_result is null or p_result not in ('ACTIVE','SUSPENDED','WAIT','REVIEW','PAID','REVERSED')
   or (p_check_on is not null and not isfinite(p_check_on)) then return false; end if;
 update sma_private.onboarding_package_bookings_v1 b set
   renewal_checked_at=clock_timestamp(),renewal_check_result=p_result,renewal_check_attempts=0,
   renewal_check_at=case when p_result='REVERSED' then 'infinity'::timestamptz
     when p_check_on is null then clock_timestamp()+interval '1 day'
     else greatest(p_check_on::timestamp at time zone 'UTC',clock_timestamp()+interval '1 minute') end
 where b.id=p_id and b.automated and b.subscription_id is not null and b.lease=p_lease and b.leased_until>clock_timestamp()
   and ((p_result='REVERSED' and b.state='reversed') or (p_result<>'REVERSED' and b.state in ('paid','active')));
 return found;
end $$;
revoke all on function public.sma_package_schedule_result_v1(uuid,uuid,text,date) from public,anon,authenticated,service_role;
grant execute on function public.sma_package_schedule_result_v1(uuid,uuid,text,date) to service_role;

select cron.schedule('sma-package-renewal-due-v1','*/5 * * * *','select sma_private.package_renewal_tick_v1()');
