begin;
insert into sma_private.publication_files_v1(id,customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,width_px,height_px,duration_ms)
values('fa330000-0000-4000-8000-000000000001',4,'20be25c6-a763-4981-a25a-d503e32e4e25','fixture_content_review','Prüffall.png','image','image/png','sha256:'||repeat('a',64)||':1',now(),1000,1080,1080,null);
set local role authenticated;
select set_config('request.jwt.claim.sub','20be25c6-a763-4981-a25a-d503e32e4e25',true);
do $$ declare r jsonb; i jsonb:=jsonb_build_object('asset_id','fa330000-0000-4000-8000-000000000001','asset_revision','sha256:'||repeat('a',64)||':1');begin
 r:=public.sma_publication_review_v1('get',i);assert r->'review'->>'status'='unreviewed';assert r->'review'->'can_publish'='false';
 r:=public.sma_publication_review_v1('start',i);assert r->'ok'='true',r::text;assert r->>'lease_id' is not null;assert r->'review'->>'status'='processing';
 r:=public.sma_publication_review_v1('start',i);assert r->'ok'='true';assert not (r ? 'lease_id');
 assert not has_table_privilege('authenticated','sma_private.publication_content_reviews_v1','UPDATE');
 assert not has_function_privilege('authenticated','public.sma_publication_review_finish_v1(uuid,uuid,jsonb,text,text)','EXECUTE');
 assert not has_function_privilege('anon','public.sma_publication_review_v1(text,jsonb)','EXECUTE');
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
do $$declare r jsonb;begin r:=public.sma_publication_review_v1('get',jsonb_build_object('asset_id','fa330000-0000-4000-8000-000000000001','asset_revision','sha256:'||repeat('a',64)||':1'));assert r->'ok'='false';assert not (r ? 'review');end $$;
reset role;
set local role service_role;
do $$declare r jsonb;l uuid;res jsonb:='{"policy_version":"visual-2026-11-01.1","outcome":"clear","categories":[],"frames_checked":1,"sampling_ms":0,"can_publish":false}';begin
 select lease_id into l from sma_private.publication_content_reviews_v1 where asset_id='fa330000-0000-4000-8000-000000000001';
 r:=public.sma_publication_review_finish_v1('fa330000-0000-4000-8000-000000000001',null,res,repeat('a',64));assert r->>'code'='INVALID_LEASE';
 r:=public.sma_publication_review_finish_v1('fa330000-0000-4000-8000-000000000001',l,res,repeat('b',64));assert r->>'code'='INVALID_RESULT';
 r:=public.sma_publication_review_finish_v1('fa330000-0000-4000-8000-000000000001',l,jsonb_set(res,'{can_publish}','true'),repeat('a',64));assert r->>'code'='INVALID_RESULT';
 r:=public.sma_publication_review_finish_v1('fa330000-0000-4000-8000-000000000001',l,jsonb_set(res,'{categories}','["gore"]'),repeat('a',64));assert r->>'code'='INVALID_RESULT';
 r:=public.sma_publication_review_finish_v1('fa330000-0000-4000-8000-000000000001',l,res,repeat('a',64));assert r->'ok'='true',r::text;
 r:=public.sma_publication_review_finish_v1('fa330000-0000-4000-8000-000000000001',l,res,repeat('a',64));assert r->>'code'='INVALID_LEASE';
 assert (select attempts from sma_private.publication_review_rate_v1 where user_id='20be25c6-a763-4981-a25a-d503e32e4e25')=1;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20be25c6-a763-4981-a25a-d503e32e4e25',true);
do $$declare r jsonb;i jsonb:=jsonb_build_object('asset_id','fa330000-0000-4000-8000-000000000001','asset_revision','sha256:'||repeat('a',64)||':1');begin
 r:=public.sma_publication_review_v1('start',i);assert r->'review'->>'status'='completed';assert not(r?'lease_id');
 r:=public.sma_publication_files_v1('check',i||'{"platform":"instagram"}');assert r->'media_check'->'checks' @> '[{"code":"VISUAL_REVIEW","status":"pass"}]';assert r->'media_check'->'can_publish'='false';
end $$;
reset role;
update sma_private.publication_files_v1 set revision='sha256:'||repeat('a',64)||':2' where id='fa330000-0000-4000-8000-000000000001';
set local role authenticated;
do $$declare r jsonb;i jsonb:=jsonb_build_object('asset_id','fa330000-0000-4000-8000-000000000001','asset_revision','sha256:'||repeat('a',64)||':2');begin
 r:=public.sma_publication_review_v1('get',i);assert r->'review'->>'status'='unreviewed';assert r->'review'->'result'='null';
 r:=public.sma_publication_review_v1('start',i);assert r->>'code'='REVIEW_RATE_LIMITED';
end $$;
reset role;
update sma_private.publication_review_rate_v1 set last_started=now()-interval '40 seconds' where user_id='20be25c6-a763-4981-a25a-d503e32e4e25';
set local role authenticated;
select public.sma_publication_review_v1('start',jsonb_build_object('asset_id','fa330000-0000-4000-8000-000000000001','asset_revision','sha256:'||repeat('a',64)||':2'))->>'ok' as started;
reset role;
update sma_private.publication_files_v1 set revision='sha256:'||repeat('a',64)||':3' where id='fa330000-0000-4000-8000-000000000001';
set local role service_role;
do $$declare r jsonb;l uuid;begin
 select lease_id into l from sma_private.publication_content_reviews_v1 where asset_id='fa330000-0000-4000-8000-000000000001' and status='processing';
 r:=public.sma_publication_review_finish_v1('fa330000-0000-4000-8000-000000000001',l,'{"policy_version":"visual-2026-11-01.1","outcome":"clear","categories":[],"frames_checked":1,"sampling_ms":0,"can_publish":false}',repeat('a',64));assert r->>'code'='FILE_CHANGED';
 assert (select attempts from sma_private.publication_review_rate_v1 where user_id='20be25c6-a763-4981-a25a-d503e32e4e25')=2;
end $$;
reset role;
update sma_private.publication_files_v1 set media_kind='video',mime_type='video/mp4',duration_ms=3000 where id='fa330000-0000-4000-8000-000000000001';
set local role authenticated;
do $$declare r jsonb;begin
 r:=public.sma_publication_review_v1('start',jsonb_build_object('asset_id','fa330000-0000-4000-8000-000000000001','asset_revision','sha256:'||repeat('a',64)||':3'));assert r->>'code'='VIDEO_PLAN_REQUIRED';
end $$;
reset role;
rollback;
select 'Content review ownership, exact version, cache, rate accounting, checksum, fail closed and lease replay tests passed; fixtures rolled back' result;
