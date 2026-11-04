begin;
insert into public.sma_kunden(id,user_id,paket,aktiv,demo_delta_aktiv,zahlung_bestaetigt) values
 (-909000003001,'fa660000-0000-4000-8000-000000000101','delta',true,false,true),
 (-909000003002,'fa660000-0000-4000-8000-000000000102','alpha',true,false,true),
 (-909000003003,'fa660000-0000-4000-8000-000000000103',null,true,true,false);
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
do $$begin
 assert public.sma_website_connection_request_v1('get')->>'code'='AUTH_REQUIRED';
 assert not has_function_privilege('anon','public.sma_website_connection_request_v1(text,jsonb)','execute');
 assert not has_function_privilege('authenticated','public.sma_website_connection_context_v1(uuid,uuid)','execute');
 assert not has_function_privilege('anon','public.sma_website_connection_context_v1(uuid,uuid)','execute');
 assert has_function_privilege('service_role','public.sma_website_connection_context_v1(uuid,uuid)','execute');
 assert not has_table_privilege('authenticated','sma_private.website_connection_requests_v1','select,insert,update,delete');
 assert not has_table_privilege('service_role','sma_private.website_connection_requests_v1','select,insert,update,delete');
 assert (select relrowsecurity from pg_class where oid='sma_private.website_connection_requests_v1'::regclass);
 assert not (select prosecdef from pg_proc where oid='public.sma_website_connection_request_v1(text,jsonb)'::regprocedure);
 assert not (select prosecdef from pg_proc where oid='public.sma_website_connection_context_v1(uuid,uuid)'::regprocedure);
end $$;
select set_config('request.jwt.claim.sub','fa660000-0000-4000-8000-000000000101',true);
do $$declare r jsonb;s jsonb;inp jsonb:='{"provider":"wordpress","expected_revision":0,"request_id":"a1000000-0000-4000-8000-000000000101"}';begin
 assert public.sma_website_connection_request_v1('get')->>'state'='not_requested';
 assert public.sma_website_connection_request_v1('prepare',inp)->>'code'='WEBSITE_REQUIRED';
 assert public.sma_website_connection_request_v1('connect',inp)->>'code'='INVALID_ACTION';
 assert public.sma_website_connection_request_v1('get','{"user_id":"other"}')->>'code'='INVALID_INPUT';
 assert public.sma_website_connection_request_v1('prepare',inp||'{"website_url":"https://other.com"}')->>'code'='INVALID_INPUT';
 assert public.sma_website_connection_request_v1('prepare',inp||'{"provider":"ionos"}')->>'code'='INVALID_INPUT';
 assert public.sma_website_connection_request_v1('prepare',inp-'provider')->>'code'='INVALID_INPUT';
 assert public.sma_website_connection_request_v1('prepare',inp||'{"expected_revision":2147483647}')->>'code'='INVALID_INPUT';
 assert public.sma_website_connection_request_v1('revoke',inp-'provider')->>'code'='REQUEST_REQUIRED';
 perform public.sma_website_preparation_v1('save','{"mode":"existing","website_url":"https://example.com/","desired_domain":"","expected_revision":0,"request_id":"b1000000-0000-4000-8000-000000000101"}');
 r:=public.sma_website_connection_request_v1('prepare',inp);s:=public.sma_website_connection_request_v1('prepare',inp);
 assert r=s,'lost response replay must retain exact attempt and expiry';
 assert r->>'state'='pending' and r->>'revision'='1';
 assert r->>'website_url'='https://example.com/' and r->>'preparation_revision'='1';
 assert r->>'website_connected'='false' and r->>'can_publish'='false' and r->>'can_synchronize'='false';
 assert (r->>'expires_at')::timestamptz between clock_timestamp()+interval '9 minutes' and clock_timestamp()+interval '11 minutes';
 perform set_config('test.connection_attempt',r->>'attempt_id',true);
 assert public.sma_website_connection_request_v1('prepare',inp||'{"provider":"hostinger"}')->>'code'='REQUEST_CONFLICT';
 assert public.sma_website_connection_request_v1('prepare',inp||'{"request_id":"a1000000-0000-4000-8000-000000000104"}')->>'code'='REVISION_CONFLICT';
 assert public.sma_website_connection_request_v1('prepare',inp||'{"expected_revision":1,"request_id":"a1000000-0000-4000-8000-000000000104"}')->>'code'='REQUEST_RATE_LIMITED';
end $$;
reset role;
set local role service_role;
do $$declare r jsonb;begin
 r:=public.sma_website_connection_context_v1('fa660000-0000-4000-8000-000000000101',current_setting('test.connection_attempt')::uuid);
 assert r->>'ok'='true' and r->>'provider'='wordpress' and r->>'website_url'='https://example.com/';
 assert public.sma_website_connection_context_v1('fa660000-0000-4000-8000-000000000103',current_setting('test.connection_attempt')::uuid)->>'ok'='false';
 assert public.sma_website_connection_context_v1('fa660000-0000-4000-8000-000000000101','a1000000-0000-4000-8000-000000000109')->>'code'='REQUEST_STALE';
end $$;
reset role;
-- Clock changes are restricted to fixtures; no wait and no external request.
update sma_private.website_connection_requests_v1 set requested_at=clock_timestamp()-interval '11 minutes',expires_at=clock_timestamp()-interval '1 minute' where customer_id=-909000003001;
set local role service_role;
do $$begin
 assert public.sma_website_connection_context_v1('fa660000-0000-4000-8000-000000000101',current_setting('test.connection_attempt')::uuid)->>'code'='REQUEST_STALE';
end $$;
reset role;
set local role authenticated;
do $$declare r jsonb;begin
 r:=public.sma_website_connection_request_v1('get');assert r->>'state'='expired' and r->'attempt_id'='null'::jsonb;
 r:=public.sma_website_connection_request_v1('prepare','{"provider":"wordpress","expected_revision":0,"request_id":"a1000000-0000-4000-8000-000000000101"}');
 assert r->>'state'='expired','old request replay must not renew expiry';
 r:=public.sma_website_connection_request_v1('prepare','{"provider":"hostinger","expected_revision":1,"request_id":"a1000000-0000-4000-8000-000000000105"}');
 assert r->>'state'='pending' and r->>'revision'='2';
 assert r->>'attempt_id'<>current_setting('test.connection_attempt');
 perform set_config('test.connection_old',current_setting('test.connection_attempt'),true);
 perform set_config('test.connection_attempt',r->>'attempt_id',true);
end $$;
reset role;
set local role service_role;
do $$begin
 assert public.sma_website_connection_context_v1('fa660000-0000-4000-8000-000000000101',current_setting('test.connection_old')::uuid)->>'code'='REQUEST_STALE';
end $$;
reset role;
-- A changed preparation invalidates the attempt even on the same hostname.
update sma_private.website_preparations_v1 set revision=revision+1,website_url='https://example.com/changed/' where customer_id=-909000003001;
set local role authenticated;
do $$declare r jsonb;begin
 r:=public.sma_website_connection_request_v1('get');assert r->>'state'='stale' and r->'attempt_id'='null'::jsonb;
end $$;
reset role;
set local role service_role;
do $$begin
 assert public.sma_website_connection_context_v1('fa660000-0000-4000-8000-000000000101',current_setting('test.connection_attempt')::uuid)->>'code'='REQUEST_STALE';
end $$;
reset role;
-- Revocation is available after package/access loss, including lost responses.
update public.sma_kunden set aktiv=false,paket='alpha' where id=-909000003001;
set local role authenticated;
do $$declare inp jsonb:='{"expected_revision":2,"request_id":"a1000000-0000-4000-8000-000000000106"}';r jsonb;begin
 assert public.sma_website_connection_request_v1('get')->>'code'='ACCESS_INACTIVE';
 r:=public.sma_website_connection_request_v1('revoke',inp);
 assert r->>'state'='revoked' and r->>'revision'='3' and r->'attempt_id'='null'::jsonb;
 assert public.sma_website_connection_request_v1('revoke',inp)=r;
end $$;
reset role;
update public.sma_kunden set aktiv=true,paket='delta' where id=-909000003001;
set local role service_role;
do $$begin
 assert public.sma_website_connection_context_v1('fa660000-0000-4000-8000-000000000101',current_setting('test.connection_attempt')::uuid)->>'code'='REQUEST_STALE';
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','fa660000-0000-4000-8000-000000000102',true);
do $$begin assert public.sma_website_connection_request_v1('get')->>'code'='ACCESS_INACTIVE';end $$;
select set_config('request.jwt.claim.sub','fa660000-0000-4000-8000-000000000103',true);
do $$begin assert public.sma_website_connection_request_v1('get')->>'state'='not_requested';end $$;
reset role;
update public.sma_kunden set user_id='fa660000-0000-4000-8000-000000000104' where id=-909000003001;
set local role authenticated;
select set_config('request.jwt.claim.sub','fa660000-0000-4000-8000-000000000104',true);
do $$begin assert public.sma_website_connection_request_v1('get')->>'code'='ACCOUNT_CHANGED';end $$;
reset role;
rollback;
select 'website connection request SQL cases passed' as result;
