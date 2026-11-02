-- Synthetic identities and assets only. No login/session is created; all rows roll back.
begin;
do $$begin
 assert not exists(select 1 from public.sma_kunden where id in (-909000000001,-909000000002) or user_id in ('fa550000-0000-4000-8000-000000000091','fa550000-0000-4000-8000-000000000092'));
end $$;
insert into public.sma_kunden(id,user_id,n8n_kunde_id,kunde_email,aktiv,demo_delta_aktiv)
values(-909000000001,'fa550000-0000-4000-8000-000000000091','synthetic-video-owner','video-owner@example.invalid',true,true),
(-909000000002,'fa550000-0000-4000-8000-000000000092','synthetic-other-owner','other-owner@example.invalid',true,true);
insert into sma_private.publication_files_v1(id,customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,width_px,height_px,duration_ms)
values('fa550000-0000-4000-8000-000000000001',-909000000001,'fa550000-0000-4000-8000-000000000091','synthetic_video_fixture','Synthetic.mp4','video','video/mp4','sha256:'||repeat('a',64)||':1',now(),1000,720,1280,10000);
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
do $$begin assert public.sma_publication_video_magic_v1('get','{}')->>'code'='AUTH_REQUIRED';end $$;
select set_config('request.jwt.claim.sub','fa550000-0000-4000-8000-000000000092',true);
do $$declare r jsonb;begin
 r:=public.sma_publication_video_magic_v1('get',jsonb_build_object('asset_id','fa550000-0000-4000-8000-000000000001','asset_revision','sha256:'||repeat('a',64)||':1'));
 assert r->>'code'='FILE_UNAVAILABLE';assert not(r?'analysis');
end $$;
select set_config('request.jwt.claim.sub','fa550000-0000-4000-8000-000000000091',true);
do $$declare r jsonb;i jsonb:=jsonb_build_object('asset_id','fa550000-0000-4000-8000-000000000001','asset_revision','sha256:'||repeat('a',64)||':1');begin
 assert not has_function_privilege('anon','public.sma_publication_video_magic_v1(text,jsonb)','EXECUTE');
 assert not has_function_privilege('authenticated','public.sma_publication_video_magic_finish_v1(uuid,uuid,jsonb,text,text)','EXECUTE');
 assert not has_table_privilege('authenticated','sma_private.publication_magic_results_v1','SELECT,INSERT,UPDATE');
 assert public.sma_publication_video_magic_v1('get',i||'{"customer_id":-909000000002}')->>'code'='INVALID_INPUT';
 r:=public.sma_publication_video_magic_v1('get',i);assert r->'analysis'->>'status'='unrecognized';
 r:=public.sma_publication_video_magic_v1('start',i);assert r->>'ok'='true',r::text;assert r->>'lease_id' is not null;
 r:=public.sma_publication_video_magic_v1('start',i);assert r->'analysis'->>'status'='processing';assert not(r?'lease_id');
end $$;
reset role;
set local role service_role;
do $$declare r jsonb;l uuid;res jsonb;begin
 select lease_id into l from sma_private.publication_magic_results_v1 where asset_id='fa550000-0000-4000-8000-000000000001';
 res:=jsonb_build_object('policy_version','magic-video-2026-11-02.1','subject_type','other','description','Ein blaues Quadrat bewegt sich von links nach rechts.','spoken_summary','',
 'observations',jsonb_build_array('Ein blaues Quadrat'),'visible_text','[]'::jsonb,'uncertainties','[]'::jsonb,'transcript','','audio_status','no_audio_stream',
 'evidence',jsonb_build_object('source_sha256',repeat('a',64),'source_size_bytes',1000,'duration_ms',10000,'positions_ms',jsonb_build_array(0,9850),'frame_sha256',jsonb_build_array(repeat('b',64),repeat('c',64)),'sampling','representative_frames_not_full_moderation'),
 'content_comparison','model_checked_sampled_evidence','requires_confirmation',true,'can_publish',false);
 perform set_config('sma.test_video_result',res::text,true);
 assert public.sma_publication_video_magic_finish_v1('fa550000-0000-4000-8000-000000000001',null,res,repeat('a',64))->>'code'='INVALID_LEASE';
 assert public.sma_publication_video_magic_finish_v1('fa550000-0000-4000-8000-000000000001',l,res,repeat('b',64))->>'code'='INVALID_RESULT';
 foreach r in array array[res||'{"source_text":"caller text"}',res||'{"can_publish":true}',res||'{"transcript":"invented speech"}',res||'{"audio_status":"transcribed"}',jsonb_set(res,'{evidence,positions_ms}','[0,0]'),jsonb_set(res,'{evidence,source_sha256}',to_jsonb(repeat('d',64))),res||'{"subject_type":"unclear"}'] loop
  assert public.sma_publication_video_magic_finish_v1('fa550000-0000-4000-8000-000000000001',l,r,repeat('a',64))->>'code'='INVALID_RESULT';
 end loop;
 r:=public.sma_publication_video_magic_finish_v1('fa550000-0000-4000-8000-000000000001',l,res,repeat('a',64));
 assert r->>'ok'='true',r::text;assert r->'analysis'->'result'->>'source_text' like '%keine Tonspur%';
 assert r->'analysis'->'result'->>'can_publish'='false';
 assert public.sma_publication_video_magic_finish_v1('fa550000-0000-4000-8000-000000000001',l,res,repeat('a',64))->>'code'='INVALID_LEASE';
 assert (select attempts from sma_private.publication_magic_rate_v1 where user_id='fa550000-0000-4000-8000-000000000091')=1;
end $$;
reset role;
set local role authenticated;
do $$declare r jsonb;begin
 r:=public.sma_publication_video_magic_v1('start',jsonb_build_object('asset_id','fa550000-0000-4000-8000-000000000001','asset_revision','sha256:'||repeat('a',64)||':1'));
 assert r->'analysis'->>'status'='completed';assert not(r?'lease_id');
end $$;
reset role;
update sma_private.publication_files_v1 set revision='sha256:'||repeat('a',64)||':2' where id='fa550000-0000-4000-8000-000000000001';
set local role authenticated;
do $$declare r jsonb;i jsonb:=jsonb_build_object('asset_id','fa550000-0000-4000-8000-000000000001','asset_revision','sha256:'||repeat('a',64)||':2');begin
 r:=public.sma_publication_video_magic_v1('get',i);assert r->'analysis'->>'status'='unrecognized';assert r->'analysis'->'result'='null';
 assert public.sma_publication_video_magic_v1('start',i)->>'code'='MAGIC_RATE_LIMITED';
end $$;
reset role;
update sma_private.publication_magic_rate_v1 set last_started=now()-interval '40 seconds' where user_id='fa550000-0000-4000-8000-000000000091';
set local role authenticated;
do $$begin assert public.sma_publication_video_magic_v1('start',jsonb_build_object('asset_id','fa550000-0000-4000-8000-000000000001','asset_revision','sha256:'||repeat('a',64)||':2'))->>'ok'='true';end $$;
reset role;
update sma_private.publication_files_v1 set revision='sha256:'||repeat('a',64)||':3' where id='fa550000-0000-4000-8000-000000000001';
set local role service_role;
do $$declare l uuid;r jsonb;begin
 select lease_id into l from sma_private.publication_magic_results_v1 where asset_id='fa550000-0000-4000-8000-000000000001' and status='processing';
 r:=public.sma_publication_video_magic_finish_v1('fa550000-0000-4000-8000-000000000001',l,current_setting('sma.test_video_result')::jsonb,repeat('a',64));assert r->>'code'='FILE_CHANGED';
end $$;
reset role;
rollback;
select 'Video Magic: synthetic ownership, grants, revisions, cache, limits, derived source, audio consistency and replay checks passed; all fixtures rolled back' as result;
