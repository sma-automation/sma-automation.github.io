-- Synthetic credentials only. Local runner uses the documented Vault double.
begin;
insert into public.sma_kunden(id,user_id,paket,aktiv,demo_delta_aktiv,zahlung_bestaetigt) values
 (-909000004001,'fb770000-0000-4000-8000-000000000001','delta',true,false,true),
 (-909000004002,'fb770000-0000-4000-8000-000000000002','delta',true,false,true),
 (-909000004003,'fb770000-0000-4000-8000-000000000003','delta',true,false,true);
select set_config('test.unrelated_secret',vault.create_secret('SYNTHETIC_UNRELATED_SECRET')::text,true);
do $$declare f text;r text;begin
 assert (select relrowsecurity from pg_class where oid='sma_private.website_provider_connections_v1'::regclass);
 foreach r in array array['anon','authenticated','service_role'] loop
  assert not has_table_privilege(r,'sma_private.website_provider_connections_v1','select,insert,update,delete');
  assert not has_function_privilege(r,'sma_private.website_provider_binding_v1(uuid)','execute');
  assert not has_function_privilege(r,'sma_private.website_provider_invalidate_v1()','execute');
 end loop;
 foreach f in array array['sma_website_provider_begin_v1(uuid,uuid)','sma_website_provider_finish_v1(uuid,uuid,uuid,jsonb,jsonb)',
  'sma_website_provider_credential_v1(uuid,uuid,text)','sma_website_provider_context_v1(uuid)'] loop
  assert not has_function_privilege('anon','public.'||f,'execute');
  assert not has_function_privilege('authenticated','public.'||f,'execute');
  assert has_function_privilege('service_role','public.'||f,'execute');
  assert not (select prosecdef from pg_proc where oid=('public.'||f)::regprocedure);
 end loop;
 assert not has_function_privilege('anon','public.sma_website_provider_status_v1()','execute');
 assert has_function_privilege('authenticated','public.sma_website_provider_status_v1()','execute');
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
do $$begin
 assert public.sma_website_provider_status_v1()->>'code'='AUTH_REQUIRED';
 begin
  perform public.sma_website_provider_finish_v1(null,null,null,'{}','{}');
  raise exception 'Authenticated user reached credential writer';
 exception when insufficient_privilege then null;end;
 begin
  perform secret_id from sma_private.website_provider_connections_v1;
  raise exception 'Authenticated user read credential table';
 exception when insufficient_privilege then null;end;
end $$;
do $$declare i integer;u uuid;r jsonb;begin
 for i in 1..3 loop
  u:=('fb770000-0000-4000-8000-00000000000'||i)::uuid;
  perform set_config('request.jwt.claim.sub',u::text,true);
  r:=public.sma_website_preparation_v1('save',jsonb_build_object('mode','existing','website_url','https://example.com/site'||i||'/',
   'desired_domain','','expected_revision',0,'request_id',gen_random_uuid()));
  assert r->>'ok'='true','fixture preparation';
  r:=public.sma_website_connection_request_v1('prepare',jsonb_build_object('provider',case when i=2 then 'hostinger' else 'wordpress' end,
   'expected_revision',0,'request_id',gen_random_uuid()));
  assert r->>'state'='pending','fixture request';
  perform set_config('test.attempt'||i,r->>'attempt_id',true);
  assert public.sma_website_provider_status_v1()->>'state'='not_connected';
 end loop;
end $$;
reset role;
set local role service_role;
do $$declare u uuid:='fb770000-0000-4000-8000-000000000001';a uuid:=current_setting('test.attempt1')::uuid;
 v uuid;r jsonb;p jsonb:='{"website_url":"https://example.com/site1/","provider_site_id":"wp-site-1","can_read":true}';
 c jsonb:='{"username":"sma-test","password":"SYNTHETIC_PASSWORD_1234"}';begin
 assert public.sma_website_provider_begin_v1(null,a)->>'code'='AUTH_REQUIRED';
 assert public.sma_website_provider_begin_v1('fb770000-0000-4000-8000-000000000002',a)->>'code'='REQUEST_STALE';
 r:=public.sma_website_provider_begin_v1(u,a);assert r->>'ok'='true';
 v:=(r->>'verification_id')::uuid;perform set_config('test.verify1',v::text,true);
 assert public.sma_website_provider_begin_v1(u,a)->>'code'='VERIFICATION_BUSY';
 assert public.sma_website_provider_finish_v1(u,a,v,'null',c)->>'code'='INVALID_PROOF';
 assert public.sma_website_provider_finish_v1(u,a,v,'[]',c)->>'code'='INVALID_PROOF';
 assert public.sma_website_provider_finish_v1(u,a,v,p,'[]')->>'code'='INVALID_CREDENTIALS';
 assert public.sma_website_provider_finish_v1(u,a,v,p||'{"can_read":false}',c)->>'code'='INVALID_PROOF';
 assert public.sma_website_provider_finish_v1(u,a,v,p||'{"can_read":"true"}',c)->>'code'='INVALID_PROOF';
 assert public.sma_website_provider_finish_v1(u,a,v,p||'{"secret":"unexpected"}',c)->>'code'='INVALID_PROOF';
 assert public.sma_website_provider_finish_v1(u,a,v,p||'{"website_url":"https://other.example/"}',c)->>'code'='REQUEST_STALE';
 assert public.sma_website_provider_finish_v1(u,a,v,p,c||'{"username":"bad:user"}')->>'code'='INVALID_CREDENTIALS';
 assert public.sma_website_provider_finish_v1(u,a,v,p,c||jsonb_build_object('username',E'bad\nuser'))->>'code'='INVALID_CREDENTIALS';
 assert public.sma_website_provider_finish_v1(u,a,v,p,c||'{"password":"short"}')->>'code'='INVALID_CREDENTIALS';
 assert public.sma_website_provider_finish_v1(u,a,v,p,c||'{"access_token":"SYNTHETIC_TOKEN_1234"}')->>'code'='INVALID_CREDENTIALS';
 assert public.sma_website_provider_finish_v1(u,a,gen_random_uuid(),p,c)->>'code'='VERIFICATION_STALE';
end $$;
reset role;
do $$begin assert (select count(*) from vault.secrets)=1,'rejected proofs must not store any credential';end $$;
-- Expired verification can be replaced; its late completion must fail.
update sma_private.website_connection_requests_v1 set verification_started_at=clock_timestamp()-interval '3 minutes' where customer_id=-909000004001;
set local role service_role;
do $$declare u uuid:='fb770000-0000-4000-8000-000000000001';a uuid:=current_setting('test.attempt1')::uuid;v uuid;r jsonb;s jsonb;
 p jsonb:='{"website_url":"https://example.com/site1/","provider_site_id":"wp-site-1","can_read":true}';
 c jsonb:='{"username":"sma-test","password":"SYNTHETIC_PASSWORD_1234"}';begin
 assert public.sma_website_provider_finish_v1(u,a,current_setting('test.verify1')::uuid,p,c)->>'code'='VERIFICATION_STALE';
 r:=public.sma_website_provider_begin_v1(u,a);v:=(r->>'verification_id')::uuid;
 assert r->>'ok'='true' and v<>current_setting('test.verify1')::uuid;
 assert public.sma_website_provider_finish_v1(u,a,current_setting('test.verify1')::uuid,p,c)->>'code'='VERIFICATION_STALE';
 perform set_config('test.verify1',v::text,true);
 r:=public.sma_website_provider_finish_v1(u,a,v,p,c);assert r->>'state'='verified';
 s:=public.sma_website_provider_finish_v1(u,a,v,p,c);assert r=s,'lost response must replay the same completion';
 assert not(r ?| array['credentials','password','secret_id','credential_hash','proof']);
 assert public.sma_website_provider_finish_v1(u,a,v,p,c||'{"password":"SYNTHETIC_DIFFERENT_1234"}')->>'code'='VERIFICATION_CONFLICT';
 assert public.sma_website_provider_finish_v1(u,a,v,p||'{"provider_site_id":"other-site"}',c)->>'code'='VERIFICATION_CONFLICT';
 assert public.sma_website_provider_begin_v1(u,a)->>'code'='ALREADY_VERIFIED';
 assert public.sma_website_provider_credential_v1(u,a,'get')->'credentials'=c;
 assert public.sma_website_provider_credential_v1(u,a,'delete')->>'code'='INVALID_ACTION';
 assert public.sma_website_provider_credential_v1('fb770000-0000-4000-8000-000000000002',a,'get')->>'code'='REQUEST_STALE';
end $$;
reset role;
do $$begin
 assert (select count(*) from vault.secrets)=2,'completion replay must not duplicate Vault entries';
 assert (select verification_id is null and verification_started_at is null from sma_private.website_connection_requests_v1 where customer_id=-909000004001);
end $$;
-- A completed connection remains recoverable after the login window expires.
update sma_private.website_connection_requests_v1 set requested_at=clock_timestamp()-interval '11 minutes',expires_at=clock_timestamp()-interval '1 minute' where customer_id=-909000004001;
set local role authenticated;
select set_config('request.jwt.claim.sub','fb770000-0000-4000-8000-000000000001',true);
do $$declare r jsonb;begin
 assert public.sma_website_connection_request_v1('get')->>'state'='expired';
 r:=public.sma_website_provider_status_v1();assert r->>'state'='verified' and r->>'website_connected'='true';
 assert r->>'attempt_id'=current_setting('test.attempt1');
 assert r->>'can_synchronize'='false' and r->>'can_publish'='false';
 assert not(r ?| array['credentials','password','secret_id','credential_hash','proof','user_id','customer_id']);
end $$;
reset role;
set local role service_role;
do $$declare u uuid:='fb770000-0000-4000-8000-000000000001';r jsonb;a uuid;begin
 r:=public.sma_website_provider_context_v1(u);a:=(r->>'attempt_id')::uuid;
 assert r->>'state'='verified';
 assert public.sma_website_provider_credential_v1(u,a,'get')->>'ok'='true';
 assert public.sma_website_provider_finish_v1(u,a,current_setting('test.verify1')::uuid,
  '{"website_url":"https://example.com/site1/","provider_site_id":"wp-site-1","can_read":true}',
  '{"username":"sma-test","password":"SYNTHETIC_PASSWORD_1234"}')->>'state'='verified';
end $$;
reset role;
-- Hostinger token shape is distinct; no provider HTTP call is made here.
set local role service_role;
do $$declare u uuid:='fb770000-0000-4000-8000-000000000002';a uuid:=current_setting('test.attempt2')::uuid;v uuid;
 p jsonb:='{"website_url":"https://example.com/site2/","provider_site_id":"hostinger-site-2","can_read":true}';begin
 v:=(public.sma_website_provider_begin_v1(u,a)->>'verification_id')::uuid;
 assert public.sma_website_provider_finish_v1(u,a,v,p,'{"access_token":"SYNTHETIC TOKEN 1234"}')->>'code'='INVALID_CREDENTIALS';
 assert public.sma_website_provider_finish_v1(u,a,v,p,'{"username":"user","password":"SYNTHETIC_PASSWORD_1234"}')->>'code'='INVALID_CREDENTIALS';
 assert public.sma_website_provider_finish_v1(u,a,v,p,'{"access_token":"SYNTHETIC_TOKEN_123456"}')->>'state'='verified';
end $$;
reset role;
-- Changing even the path deletes only that customer's credential.
set local role authenticated;
select set_config('request.jwt.claim.sub','fb770000-0000-4000-8000-000000000001',true);
do $$declare r jsonb;begin
 r:=public.sma_website_preparation_v1('save',jsonb_build_object('mode','existing','website_url','https://example.com/changed/',
  'desired_domain','','expected_revision',1,'request_id',gen_random_uuid()));
 assert r->>'ok'='true';
 assert public.sma_website_provider_status_v1()->>'code'='REQUEST_STALE';
end $$;
reset role;
do $$begin
 assert not exists(select 1 from sma_private.website_provider_connections_v1 where customer_id=-909000004001);
 assert (select count(*) from vault.secrets)=2;
 assert exists(select 1 from vault.secrets where id=current_setting('test.unrelated_secret')::uuid);
end $$;
-- An inactive customer may still withdraw and erase local credentials.
update public.sma_kunden set aktiv=false where id=-909000004002;
set local role service_role;
do $$begin
 assert public.sma_website_provider_credential_v1('fb770000-0000-4000-8000-000000000002',current_setting('test.attempt2')::uuid,'get')->>'code'='ACCESS_INACTIVE';
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','fb770000-0000-4000-8000-000000000002',true);
do $$begin
 assert public.sma_website_connection_request_v1('revoke',jsonb_build_object('expected_revision',1,'request_id',gen_random_uuid()))->>'state'='revoked';
end $$;
reset role;
do $$begin assert (select count(*) from vault.secrets)=1,'revocation must remove the second customer secret';end $$;
-- A new attempt clears an old verification lease, without waiting two minutes.
set local role service_role;
select set_config('test.verify3',(public.sma_website_provider_begin_v1('fb770000-0000-4000-8000-000000000003',current_setting('test.attempt3')::uuid)->>'verification_id'),true);
reset role;
update sma_private.website_connection_requests_v1 set requested_at=clock_timestamp()-interval '61 seconds' where customer_id=-909000004003;
set local role authenticated;
select set_config('request.jwt.claim.sub','fb770000-0000-4000-8000-000000000003',true);
select set_config('test.attempt3new',(public.sma_website_connection_request_v1('prepare',jsonb_build_object('provider','wordpress','expected_revision',1,'request_id',gen_random_uuid()))->>'attempt_id'),true);
reset role;
set local role service_role;
do $$declare u uuid:='fb770000-0000-4000-8000-000000000003';a uuid:=current_setting('test.attempt3new')::uuid;v uuid;r jsonb;
 p jsonb:='{"website_url":"https://example.com/site3/","provider_site_id":"wp-site-3","can_read":true}';
 c jsonb:='{"username":"sma-test","password":"SYNTHETIC_PASSWORD_3333"}';begin
 r:=public.sma_website_provider_begin_v1(u,a);assert r->>'ok'='true','new attempt must not inherit a busy verification';v:=(r->>'verification_id')::uuid;
 assert public.sma_website_provider_finish_v1(u,current_setting('test.attempt3')::uuid,current_setting('test.verify3')::uuid,p,c)->>'code'='REQUEST_STALE';
 assert public.sma_website_provider_finish_v1(u,a,v,p,c)->>'state'='verified';
 assert public.sma_website_provider_credential_v1(u,current_setting('test.attempt3')::uuid,'forget')->>'code'='REQUEST_STALE';
 assert public.sma_website_provider_credential_v1(u,a,'get')->>'ok'='true','late rejection must not forget a newer connection';
 r:=public.sma_website_provider_credential_v1(u,a,'forget');assert r->>'state'='disconnected' and not(r ? 'credentials');
 assert public.sma_website_provider_credential_v1(u,a,'get')->>'code'='NOT_CONNECTED';
 -- Re-verify for owner-change deletion below.
 v:=(public.sma_website_provider_begin_v1(u,a)->>'verification_id')::uuid;
 assert public.sma_website_provider_finish_v1(u,a,v,p,c)->>'state'='verified';
end $$;
reset role;
update public.sma_kunden set user_id='fb770000-0000-4000-8000-000000000004' where id=-909000004003;
do $$begin
 assert not exists(select 1 from sma_private.website_provider_connections_v1);
 assert (select count(*) from vault.secrets)=1;
 assert exists(select 1 from vault.secrets where id=current_setting('test.unrelated_secret')::uuid);
end $$;
set local role service_role;
do $$begin
 assert public.sma_website_provider_credential_v1('fb770000-0000-4000-8000-000000000003',current_setting('test.attempt3new')::uuid,'get')->>'code'='ACCOUNT_UNAVAILABLE';
 assert public.sma_website_provider_context_v1('fb770000-0000-4000-8000-000000000004')->>'code'='ACCOUNT_CHANGED';
end $$;
reset role;
-- Failures after Vault insertion must roll back the secret in the same statement.
-- Fixture customer 1 has a changed target and an old expired request.
set local role authenticated;
select set_config('request.jwt.claim.sub','fb770000-0000-4000-8000-000000000001',true);
select set_config('test.attempt1new',(public.sma_website_connection_request_v1('prepare',jsonb_build_object('provider','wordpress','expected_revision',1,'request_id',gen_random_uuid()))->>'attempt_id'),true);
reset role;
create function pg_temp.fail_provider_insert() returns trigger language plpgsql as $$begin raise exception using errcode='P7501',message='Synthetic storage failure';end $$;
create trigger test_provider_storage_failure before insert on sma_private.website_provider_connections_v1 for each row execute function pg_temp.fail_provider_insert();
set local role service_role;
do $$declare u uuid:='fb770000-0000-4000-8000-000000000001';a uuid:=current_setting('test.attempt1new')::uuid;v uuid;begin
 v:=(public.sma_website_provider_begin_v1(u,a)->>'verification_id')::uuid;
 perform set_config('test.verify1new',v::text,true);
 begin
  perform public.sma_website_provider_finish_v1(u,a,v,
   '{"website_url":"https://example.com/changed/","provider_site_id":"wp-changed","can_read":true}',
   '{"username":"sma-test","password":"SYNTHETIC_PASSWORD_1234"}');
  raise exception 'Storage failure fixture did not run';
 exception when sqlstate 'P7501' then null;end;
end $$;
reset role;
do $$begin assert (select count(*) from vault.secrets)=1,'failed connection insert must not orphan a Vault entry';end $$;
drop trigger test_provider_storage_failure on sma_private.website_provider_connections_v1;
-- Access can be withdrawn between begin and finish.
update public.sma_kunden set aktiv=false where id=-909000004001;
set local role service_role;
do $$begin
 assert public.sma_website_provider_finish_v1('fb770000-0000-4000-8000-000000000001',current_setting('test.attempt1new')::uuid,current_setting('test.verify1new')::uuid,
  '{"website_url":"https://example.com/changed/","provider_site_id":"wp-changed","can_read":true}',
  '{"username":"sma-test","password":"SYNTHETIC_PASSWORD_1234"}')->>'code'='ACCESS_INACTIVE';
end $$;
reset role;
update public.sma_kunden set aktiv=true where id=-909000004001;
set local role service_role;
do $$begin
 assert public.sma_website_provider_finish_v1('fb770000-0000-4000-8000-000000000001',current_setting('test.attempt1new')::uuid,current_setting('test.verify1new')::uuid,
  '{"website_url":"https://example.com/changed/","provider_site_id":"wp-changed","can_read":true}',
  '{"username":"sma-test","password":"SYNTHETIC_PASSWORD_1234"}')->>'state'='verified','storage retry must succeed exactly once';
end $$;
reset role;
-- Missing Vault data must never report a working connection, including replay.
delete from vault.secrets where id=(select secret_id from sma_private.website_provider_connections_v1 where customer_id=-909000004001);
set local role service_role;
do $$declare u uuid:='fb770000-0000-4000-8000-000000000001';a uuid:=current_setting('test.attempt1new')::uuid;begin
 assert public.sma_website_provider_context_v1(u)->>'state'='not_connected';
 assert public.sma_website_provider_credential_v1(u,a,'get')->>'code'='CREDENTIAL_UNAVAILABLE';
 assert public.sma_website_provider_finish_v1(u,a,current_setting('test.verify1new')::uuid,
  '{"website_url":"https://example.com/changed/","provider_site_id":"wp-changed","can_read":true}',
  '{"username":"sma-test","password":"SYNTHETIC_PASSWORD_1234"}')->>'code'='CREDENTIAL_UNAVAILABLE';
 assert public.sma_website_provider_credential_v1(u,a,'forget')->>'state'='disconnected';
 perform set_config('test.verify1new',public.sma_website_provider_begin_v1(u,a)->>'verification_id',true);
end $$;
reset role;
-- The request may expire during a still-valid verification lease.
update sma_private.website_connection_requests_v1 set requested_at=clock_timestamp()-interval '11 minutes',expires_at=clock_timestamp()-interval '1 minute' where customer_id=-909000004001;
set local role service_role;
do $$begin
 assert public.sma_website_provider_finish_v1('fb770000-0000-4000-8000-000000000001',current_setting('test.attempt1new')::uuid,current_setting('test.verify1new')::uuid,
  '{"website_url":"https://example.com/changed/","provider_site_id":"wp-changed","can_read":true}',
  '{"username":"sma-test","password":"SYNTHETIC_PASSWORD_1234"}')->>'code'='VERIFICATION_STALE';
end $$;
reset role;
-- A changed target and a subsequent withdrawal both reject a late proof.
update sma_private.website_connection_requests_v1 set expires_at=clock_timestamp()+interval '5 minutes' where customer_id=-909000004001;
update sma_private.website_preparations_v1 set website_url='https://example.com/changed-again/',revision=revision+1 where customer_id=-909000004001;
set local role service_role;
do $$begin
 assert public.sma_website_provider_finish_v1('fb770000-0000-4000-8000-000000000001',current_setting('test.attempt1new')::uuid,current_setting('test.verify1new')::uuid,
  '{"website_url":"https://example.com/changed/","provider_site_id":"wp-changed","can_read":true}',
  '{"username":"sma-test","password":"SYNTHETIC_PASSWORD_1234"}')->>'code'='REQUEST_STALE';
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','fb770000-0000-4000-8000-000000000001',true);
do $$begin assert public.sma_website_connection_request_v1('revoke',jsonb_build_object('expected_revision',2,'request_id',gen_random_uuid()))->>'state'='revoked';end $$;
reset role;
set local role service_role;
do $$begin
 assert public.sma_website_provider_finish_v1('fb770000-0000-4000-8000-000000000001',current_setting('test.attempt1new')::uuid,current_setting('test.verify1new')::uuid,
  '{"website_url":"https://example.com/changed/","provider_site_id":"wp-changed","can_read":true}',
  '{"username":"sma-test","password":"SYNTHETIC_PASSWORD_1234"}')->>'code'='REQUEST_STALE';
end $$;
reset role;
do $$begin
 assert not exists(select 1 from sma_private.website_provider_connections_v1);
 assert (select count(*) from vault.secrets)=1 and exists(select 1 from vault.secrets where id=current_setting('test.unrelated_secret')::uuid);
end $$;
rollback;
select 'website provider credential SQL cases passed (Vault contract double; fixtures rolled back)' as result;
