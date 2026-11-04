begin;
insert into public.sma_kunden(id,user_id,paket,aktiv,demo_delta_aktiv,zahlung_bestaetigt) values
 (-909000007301,'fa730000-0000-4000-8000-000000000001','delta',true,false,true),
 (-909000007302,'fa730000-0000-4000-8000-000000000002','delta',true,false,true);
set local role authenticated;
select set_config('request.jwt.claim.sub','fa730000-0000-4000-8000-000000000001',true);
do $$declare r jsonb;s jsonb;begin
 r:=public.sma_website_preparation_v1('save',jsonb_build_object('mode','new','website_url','','desired_domain','','expected_revision',0,'request_id',gen_random_uuid()));assert r->>'ok'='true';
 assert public.sma_website_domain_check_v1('get')->>'state'='domain_required';
 assert public.sma_website_domain_check_v1('prepare')->>'code'='DOMAIN_REQUIRED';
 assert public.sma_website_domain_check_v1('begin')->>'code'='DOMAIN_REQUIRED';
 r:=public.sma_website_preparation_v1('save',jsonb_build_object('mode','new','website_url','','desired_domain','example.com','expected_revision',1,'request_id',gen_random_uuid()));assert r->>'revision'='2';
 assert r->>'website_connected'='false' and r->>'can_publish'='false' and r->>'domain_verified'='false';
 assert public.sma_website_domain_check_v1('get')->>'state'='unprepared';
 assert public.sma_website_domain_check_v1('begin')->>'code'='PREPARE_REQUIRED';
 r:=public.sma_website_domain_check_v1('prepare');s:=public.sma_website_domain_check_v1('prepare');
 assert r->>'hostname'='example.com';assert r->>'record_name'='_sma-verification.example.com';assert r->>'record_value'=s->>'record_value';
 perform set_config('test.first_token',r->>'record_value',true);
 r:=public.sma_website_domain_check_v1('begin');perform set_config('test.attempt',r->>'attempt_id',true);
 assert public.sma_website_domain_check_v1('begin')->>'code'='CHECK_RATE_LIMITED';
end $$;
set local role service_role;
do $$begin
 assert public.sma_website_domain_check_finish_v1('fa730000-0000-4000-8000-000000000002',current_setting('test.attempt')::uuid,'found')->>'ok'='false';
 assert public.sma_website_domain_check_finish_v1('fa730000-0000-4000-8000-000000000001',current_setting('test.attempt')::uuid,'found')->>'ok'='true';
end $$;
set local role authenticated;
do $$begin
 assert public.sma_website_domain_check_v1('get')->>'state'='verified';
 assert public.sma_website_preparation_v1('get')->>'website_connected'='false';
 assert public.sma_website_preparation_v1('get')->>'can_publish'='false';
end $$;
reset role;
update sma_private.website_domain_checks_v1 set last_attempt_at=now()-interval '61 seconds' where customer_id=-909000007301;
set local role authenticated;
do $$declare r jsonb;begin
 perform set_config('test.attempt',public.sma_website_domain_check_v1('begin')->>'attempt_id',true);
 r:=public.sma_website_preparation_v1('save',jsonb_build_object('mode','new','website_url','','desired_domain','example.org','expected_revision',2,'request_id',gen_random_uuid()));assert r->>'revision'='3';
end $$;
set local role service_role;
do $$begin assert public.sma_website_domain_check_finish_v1('fa730000-0000-4000-8000-000000000001',current_setting('test.attempt')::uuid,'found')->>'code'='CHECK_STALE';end $$;
set local role authenticated;
do $$declare r jsonb;begin
 assert public.sma_website_domain_check_v1('get')->>'state'='unprepared';
 r:=public.sma_website_domain_check_v1('prepare');assert r->>'record_name'='_sma-verification.example.org';assert r->>'record_value'<>current_setting('test.first_token');assert r->>'state'='pending';
 assert public.sma_website_domain_check_v1('begin')->>'code'='CHECK_RATE_LIMITED';
end $$;
reset role;
update sma_private.website_domain_checks_v1 set last_attempt_at=now()-interval '61 seconds' where customer_id=-909000007301;
set local role authenticated;
do $$begin
 perform set_config('test.attempt',public.sma_website_domain_check_v1('begin')->>'attempt_id',true);
 -- Even switching to an existing website with the same hostname invalidates the old preparation revision.
 perform public.sma_website_preparation_v1('save',jsonb_build_object('mode','existing','website_url','https://example.org/','desired_domain','unrelated.com','expected_revision',3,'request_id',gen_random_uuid()));
end $$;
set local role service_role;
do $$begin assert public.sma_website_domain_check_finish_v1('fa730000-0000-4000-8000-000000000001',current_setting('test.attempt')::uuid,'found')->>'code'='CHECK_STALE';end $$;
set local role authenticated;
do $$begin assert public.sma_website_domain_check_v1('prepare')->>'record_name'='_sma-verification.example.org';end $$;
-- Separate account, same target, independent challenge.
select set_config('request.jwt.claim.sub','fa730000-0000-4000-8000-000000000002',true);
do $$declare r jsonb;begin
 perform public.sma_website_preparation_v1('save',jsonb_build_object('mode','new','website_url','','desired_domain','example.com','expected_revision',0,'request_id',gen_random_uuid()));
 r:=public.sma_website_domain_check_v1('prepare');assert r->>'state'='pending';assert r->>'record_value'<>current_setting('test.first_token');
end $$;
reset role;
rollback;
select 'new SMA website domain SQL passed: saved target, missing domain, retry, account isolation, revision changes, mode changes, rate limit and separate hosting/publication state; fixtures rolled back' as result;
