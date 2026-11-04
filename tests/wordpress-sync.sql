begin;
insert into public.sma_kunden(id,user_id,paket,aktiv,zahlung_bestaetigt,shop_slug,shop_oeffentlich) values
 (-909000008001,'fc990000-0000-4000-8000-000000000001','delta',true,true,'sma-synthetic',true),
 (-909000008002,'fc990000-0000-4000-8000-000000000002','delta',true,true,'other-synthetic',true);
do $$begin
 assert not has_function_privilege('anon','public.sma_wordpress_sync_job_v1(uuid,uuid,text,jsonb)','execute');
 assert not has_function_privilege('authenticated','public.sma_wordpress_sync_job_v1(uuid,uuid,text,jsonb)','execute');
 assert has_function_privilege('service_role','public.sma_wordpress_sync_job_v1(uuid,uuid,text,jsonb)','execute');
 assert not has_table_privilege('authenticated','sma_private.wordpress_sync_jobs_v1','select,insert,update,delete');
 assert not has_table_privilege('service_role','sma_private.wordpress_sync_jobs_v1','select,insert,update,delete');
 assert (select relrowsecurity from pg_class where oid='sma_private.wordpress_sync_jobs_v1'::regclass);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','fc990000-0000-4000-8000-000000000001',true);
select public.sma_website_preparation_v1('save',jsonb_build_object('mode','existing','website_url','https://example.com/','desired_domain','','expected_revision',0,'request_id',gen_random_uuid()));
select set_config('test.sync_attempt',public.sma_website_connection_request_v1('prepare',jsonb_build_object('provider','wordpress','expected_revision',0,'request_id',gen_random_uuid()))->>'attempt_id',true);
reset role;
set local role service_role;
do $$declare u uuid:='fc990000-0000-4000-8000-000000000001';a uuid:=current_setting('test.sync_attempt')::uuid;v uuid;r jsonb;lease uuid;k text:=E'-----BEGIN PRIVATE KEY-----\n'||repeat('A',2000)||E'\n-----END PRIVATE KEY-----\n';begin
 assert public.sma_wordpress_sync_job_v1(null,a,'status')->>'code'='AUTH_REQUIRED';
 assert public.sma_wordpress_sync_job_v1(u,a,'claim')->>'code'='NOT_CONNECTED';
 v:=(public.sma_website_provider_begin_v1(u,a)->>'verification_id')::uuid;
 assert public.sma_website_provider_finish_v1(u,a,v,jsonb_build_object('website_url','https://example.com/','provider_site_id','wordpress-bridge:'||a::text,'can_read',true),jsonb_build_object('bridge_private_key',k))->>'ok'='true';
 r:=public.sma_wordpress_sync_job_v1(u,a,'status');assert r->>'state'='idle' and r->>'can_publish'='false';
 assert public.sma_wordpress_sync_job_v1(u,gen_random_uuid(),'claim')->>'code'='REQUEST_STALE';
 assert public.sma_wordpress_sync_job_v1('fc990000-0000-4000-8000-000000000002',a,'claim')->>'ok'='false';
 assert public.sma_wordpress_sync_job_v1(u,a,'claim','{"website_url":"https://evil.example/"}')->>'code'='INVALID_INPUT';
 r:=public.sma_wordpress_sync_job_v1(u,a,'claim');assert r->>'state'='running' and r->'expected_revision'='null'::jsonb;lease:=(r->>'lease_id')::uuid;
 perform set_config('test.sync_request',r->>'request_id',true);perform set_config('test.sync_lease',lease::text,true);
 assert public.sma_wordpress_sync_job_v1(u,a,'claim')->>'code'='SYNC_BUSY';
 assert public.sma_wordpress_sync_job_v1(u,a,'status')->'lease_id'='null'::jsonb;
 assert public.sma_wordpress_sync_job_v1(u,a,'complete',jsonb_build_object('lease_id',lease,'proof',jsonb_build_object('revision',1,'post_id',42)))->>'code'='RESULT_CONFLICT';
 assert public.sma_wordpress_sync_job_v1(u,a,'dispatch',jsonb_build_object('lease_id',lease,'proof',null))->>'code'='BASELINE_REQUIRED';
 assert public.sma_wordpress_sync_job_v1(u,a,'dispatch',jsonb_build_object('lease_id',gen_random_uuid(),'proof',jsonb_build_object('revision',0,'post_id',null)))->>'code'='LEASE_STALE';
 assert public.sma_wordpress_sync_job_v1(u,a,'dispatch',jsonb_build_object('lease_id',lease,'proof',jsonb_build_object('revision',0,'post_id',42)))->>'code'='INVALID_PROOF';
 assert public.sma_wordpress_sync_job_v1(u,a,'dispatch',jsonb_build_object('lease_id',lease,'proof',jsonb_build_object('revision',0,'post_id',null)))->>'expected_revision'='0';
 assert public.sma_wordpress_sync_job_v1(u,a,'dispatch',jsonb_build_object('lease_id',lease,'proof',jsonb_build_object('revision',1,'post_id',42)))->>'code'='RESULT_CONFLICT';
 assert public.sma_wordpress_sync_job_v1(u,a,'retry',jsonb_build_object('lease_id',lease,'code','arbitrary provider secret'))->>'code'='INVALID_INPUT';
 assert public.sma_wordpress_sync_job_v1(u,a,'retry',jsonb_build_object('lease_id',lease,'code','PROVIDER_UNAVAILABLE'))->>'state'='retry';
 assert public.sma_wordpress_sync_job_v1(u,a,'claim')->>'code'='SYNC_BUSY';
end $$;
reset role;
update sma_private.wordpress_sync_jobs_v1 set next_retry_at=clock_timestamp()-interval '1 second';
set local role service_role;
do $$declare u uuid:='fc990000-0000-4000-8000-000000000001';a uuid:=current_setting('test.sync_attempt')::uuid;r jsonb;l uuid;begin
 r:=public.sma_wordpress_sync_job_v1(u,a,'claim');l:=(r->>'lease_id')::uuid;
 assert r->>'request_id'=current_setting('test.sync_request') and r->>'expected_revision'='0','lost result must retain command identity and baseline';
 assert public.sma_wordpress_sync_job_v1(u,a,'complete',jsonb_build_object('lease_id',current_setting('test.sync_lease'),'proof',jsonb_build_object('revision',1,'post_id',42)))->>'code'='LEASE_STALE';
 assert public.sma_wordpress_sync_job_v1(u,a,'dispatch',jsonb_build_object('lease_id',l,'proof',null))->>'expected_revision'='0';
 assert public.sma_wordpress_sync_job_v1(u,a,'complete',jsonb_build_object('lease_id',l,'proof',jsonb_build_object('revision',2,'post_id',42)))->>'code'='RESULT_CONFLICT';
 r:=public.sma_wordpress_sync_job_v1(u,a,'complete',jsonb_build_object('lease_id',l,'proof',jsonb_build_object('revision',1,'post_id',42)));
 assert r->>'state'='draft' and r->>'post_id'='42' and r->>'can_publish'='false';
 assert public.sma_wordpress_sync_job_v1(u,a,'complete',jsonb_build_object('lease_id',l,'proof',jsonb_build_object('revision',1,'post_id',42)))->>'state'='draft';
 assert public.sma_wordpress_sync_job_v1(u,a,'complete',jsonb_build_object('lease_id',l,'proof',jsonb_build_object('revision',1,'post_id',43)))->>'code'='RESULT_CONFLICT';
 assert public.sma_wordpress_sync_job_v1(u,a,'claim')->>'state'='draft';
 assert public.sma_wordpress_sync_job_v1(u,a,'retry',jsonb_build_object('lease_id',l,'code','PROVIDER_UNAVAILABLE'))->>'code'='LEASE_STALE','late failure cannot undo a recorded success';
end $$;
reset role;
-- Simulate a worker crash after dispatch: lease recovery keeps the original command.
update sma_private.wordpress_sync_jobs_v1 set state='running',post_id=null,result_revision=null,completed_at=null,lease_until=clock_timestamp()-interval '1 second';
set local role service_role;
do $$declare u uuid:='fc990000-0000-4000-8000-000000000001';a uuid:=current_setting('test.sync_attempt')::uuid;r jsonb;begin
 assert public.sma_wordpress_sync_job_v1(u,a,'status')->>'state'='retry';
 r:=public.sma_wordpress_sync_job_v1(u,a,'claim');assert r->>'request_id'=current_setting('test.sync_request');
 assert public.sma_wordpress_sync_job_v1(u,a,'block',jsonb_build_object('lease_id',r->>'lease_id','code','PAGE_CHANGED'))->>'state'='blocked';
 r:=public.sma_wordpress_sync_job_v1(u,a,'claim');assert r->>'state'='blocked' and r->>'last_error'='PAGE_CHANGED';
end $$;
reset role;
update public.sma_kunden set aktiv=false where id=-909000008001;
set local role service_role;
do $$begin assert public.sma_wordpress_sync_job_v1('fc990000-0000-4000-8000-000000000001',current_setting('test.sync_attempt')::uuid,'claim')->>'code'='ACCESS_INACTIVE';end $$;
reset role;
update public.sma_kunden set aktiv=true,shop_slug='changed-shop' where id=-909000008001;
set local role service_role;
do $$begin assert public.sma_wordpress_sync_job_v1('fc990000-0000-4000-8000-000000000001',current_setting('test.sync_attempt')::uuid,'claim')->>'code'='NOT_CONNECTED';end $$;
reset role;
do $$begin assert (select count(*) from sma_private.wordpress_sync_jobs_v1)=1,'obsolete job is retained, not reused';end $$;
rollback;
select 'WordPress sync SQL passed: access, binding, durable UUID, leases, retry, immutable baseline, completion, block and invalidation; fixtures rolled back' as result;
