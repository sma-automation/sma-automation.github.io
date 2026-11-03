-- Synthetic account context, lease and evidence cases. No provider requests.
begin;
insert into public.sma_kunden(id,user_id,n8n_kunde_id,kunde_email,aktiv,demo_delta_aktiv)
values(-909000000021,'fa660000-0000-4000-8000-000000000081','account-fixture','account@example.invalid',true,true);
set local role authenticated;
select set_config('request.jwt.claim.sub','fa660000-0000-4000-8000-000000000081',true);
do $$declare r jsonb;begin
 assert not has_function_privilege('anon','public.sma_publication_account_context_v1(text)','EXECUTE');
 assert not has_function_privilege('authenticated','public.sma_publication_account_worker_v1(text,bigint,text,uuid,text)','EXECUTE');
 assert not has_table_privilege('authenticated','sma_private.publication_account_locks_v1','SELECT,INSERT,UPDATE');
 r:=public.sma_publication_account_context_v1('youtube');assert r->>'ok'='true';assert r->'binding'->>'customer_id'='-909000000021';
 assert public.sma_publication_account_context_v1('other')->>'code'='INVALID_INPUT';
end $$;
select set_config('request.jwt.claim.sub','fa660000-0000-4000-8000-000000000080',true);
do $$begin assert public.sma_publication_account_context_v1('youtube')->>'code'='ACCOUNT_UNAVAILABLE';end $$;
reset role;
set local role service_role;
do $$declare r jsonb;l uuid;cid bigint:=-909000000021;begin
 r:=public.sma_publication_account_worker_v1('claim',cid,'tiktok',null,repeat('a',64));assert r->>'ok'='true';l:=(r->>'lease_id')::uuid;
 assert public.sma_publication_account_worker_v1('claim',cid,'tiktok',null,repeat('a',64))->>'code'='TARGET_CHECK_RUNNING';
 assert public.sma_publication_account_worker_v1('refresh',cid,'tiktok',gen_random_uuid())->>'ok'='false';
 assert public.sma_publication_account_worker_v1('refresh',cid,'tiktok',l)->>'ok'='true';
 assert public.sma_publication_account_worker_v1('release',cid,'tiktok',l)->>'ok'='false';
 update sma_private.publication_account_locks_v1 set lease_until=now()-interval '1 second' where customer_id=cid;
 assert public.sma_publication_account_worker_v1('claim',cid,'tiktok',null,repeat('a',64))->>'code'='TARGET_REFRESH_UNCERTAIN';
 -- Persisted token change or reconnection can recover, but only after expiry.
 r:=public.sma_publication_account_worker_v1('claim',cid,'tiktok',null,repeat('b',64));assert r->>'ok'='true';
 assert public.sma_publication_account_worker_v1('saved',cid,'tiktok',l)->>'ok'='false';l:=(r->>'lease_id')::uuid;
 assert public.sma_publication_account_worker_v1('refresh',cid,'tiktok',l)->>'ok'='true';
 assert public.sma_publication_account_worker_v1('saved',cid,'tiktok',l)->>'ok'='true';
 assert public.sma_publication_account_worker_v1('release',cid,'tiktok',l)->>'ok'='true';
 assert public.sma_publication_account_worker_v1('saved',cid,'tiktok',l)->>'ok'='false';
 update sma_private.publication_account_locks_v1 set attempts=12 where customer_id=cid;
 assert public.sma_publication_account_worker_v1('claim',cid,'tiktok',null,repeat('b',64))->>'code'='TARGET_RATE_LIMITED';
end $$;
do $$declare t jsonb:='{"platform":"youtube","id":"UC_fixture","source_revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}';e jsonb;bad jsonb;begin
 e:=jsonb_build_object('version',1,'platform','youtube','target_id','UC_fixture','target_revision',repeat('a',64),'display_name','Verified fixture','permissions','["youtube.upload"]'::jsonb,'policy','{}'::jsonb,'checked_at',now(),'expires_at',now()+interval '5 minutes');
 assert sma_private.publication_account_valid_v1(e,t);
 foreach bad in array array[e-'permissions',e-'policy',e-'checked_at',e-'expires_at',e||'{"access_token":"DO_NOT_LEAK"}',e||'{"target_id":"foreign"}',e||'{"checked_at":"invalid"}',e||jsonb_build_object('checked_at',now()-interval '6 minutes'),e||jsonb_build_object('expires_at',now()-interval '1 second'),e||jsonb_build_object('expires_at',now()+interval '6 minutes')] loop
  assert sma_private.publication_account_valid_v1(bad,t) is false,bad::text;
 end loop;
 assert sma_private.publication_account_valid_v1(null,t) is false;
 t:=t||'{"platform":"tiktok","id":"tt_fixture"}';e:=e||'{"platform":"tiktok","target_id":"tt_fixture","permissions":["video.publish","user.info.basic"],"policy":{"privacy_levels":["SELF_ONLY","PUBLIC_TO_EVERYONE"],"comment_disabled":true,"duet_disabled":false,"stitch_disabled":true,"max_duration_sec":600}}';
 assert sma_private.publication_account_valid_v1(e,t,'{"visibility":"SELF_ONLY","disable_comment":true,"disable_stitch":true}');
 foreach bad in array array['{"visibility":"FOLLOWER_OF_CREATOR","disable_comment":true,"disable_stitch":true}'::jsonb,'{"visibility":"SELF_ONLY","disable_comment":false,"disable_stitch":true}','{"visibility":"SELF_ONLY","disable_comment":true,"disable_stitch":true,"brand_content_toggle":true}'] loop assert sma_private.publication_account_valid_v1(e,t,bad) is false;end loop;
 assert sma_private.publication_account_valid_v1(jsonb_set(e,'{policy,comment_disabled}','"false"'),t) is false;
end $$;
reset role;
rollback;
select 'Account owner isolation, token leases, uncertain refresh recovery, rate limit and evidence expiry/options passed; fixtures rolled back' result;
