begin;
-- The fixture is rolled back and never enters a watched Drive folder.
insert into sma_private.publication_files_v1(id,customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,width_px,height_px,duration_ms)
values('fa220000-0000-4000-8000-000000000001',4,'20be25c6-a763-4981-a25a-d503e32e4e25','fixture_media_check','Medien-Prüffall.mp4','video','video/mp4','version:1',now(),1000000,1080,1920,12500);
do $$ declare f sma_private.publication_files_v1%rowtype; r jsonb; p text; begin
 select * into f from sma_private.publication_files_v1 where id='fa220000-0000-4000-8000-000000000001';
 foreach p in array array['youtube','tiktok','instagram','facebook'] loop
  r:=sma_private.publication_media_precheck_v1(f,p);assert r->'can_publish'='false';assert r->>'status'='needs_review';assert (r->'checks') @> '[{"code":"CONTENT_REVIEW_PENDING","status":"pending"}]';
 end loop;
 f.width_px:=360;f.height_px:=4096;r:=sma_private.publication_media_precheck_v1(f,'tiktok');assert (r->'checks') @> '[{"code":"TIKTOK_DIMENSIONS","status":"pass"}]';
 f.width_px:=359;r:=sma_private.publication_media_precheck_v1(f,'tiktok');assert r->>'status'='needs_changes';assert (r->'checks') @> '[{"code":"TIKTOK_DIMENSIONS","status":"fail"}]';
 f.width_px:=4097;r:=sma_private.publication_media_precheck_v1(f,'tiktok');assert (r->'checks') @> '[{"code":"TIKTOK_DIMENSIONS","status":"fail"}]';
 f.width_px:=null;f.height_px:=null;f.duration_ms:=null;r:=sma_private.publication_media_precheck_v1(f,'tiktok');assert (r->'checks') @> '[{"code":"DIMENSIONS_MISSING","status":"pending"},{"code":"DURATION_MISSING","status":"pending"}]';assert not (r->'checks') @> '[{"code":"TIKTOK_DIMENSIONS","status":"pass"}]';
 f.size_bytes:=4000000001;r:=sma_private.publication_media_precheck_v1(f,'tiktok');assert (r->'checks') @> '[{"code":"TIKTOK_SIZE","status":"fail"}]';
 f.size_bytes:=256000000001;f.duration_ms:=43200001;r:=sma_private.publication_media_precheck_v1(f,'youtube');assert (r->'checks') @> '[{"code":"YOUTUBE_SIZE","status":"fail"},{"code":"YOUTUBE_DURATION","status":"fail"}]';
 f.size_bytes:=1000000;f.width_px:=1080;f.height_px:=1920;f.duration_ms:=3000;r:=sma_private.publication_media_precheck_v1(f,'instagram');assert (r->'checks') @> '[{"code":"INSTAGRAM_DURATION","status":"pass"}]';
 f.duration_ms:=2999;r:=sma_private.publication_media_precheck_v1(f,'instagram');assert (r->'checks') @> '[{"code":"INSTAGRAM_DURATION","status":"fail"}]';
 f.duration_ms:=900001;r:=sma_private.publication_media_precheck_v1(f,'instagram');assert (r->'checks') @> '[{"code":"INSTAGRAM_DURATION","status":"fail"}]';
 f.duration_ms:=12500;f.mime_type:='video/webm';r:=sma_private.publication_media_precheck_v1(f,'instagram');assert (r->'checks') @> '[{"code":"INSTAGRAM_FORMAT","status":"fail"}]';
 f.verified_at:=now()-interval '16 minutes';r:=sma_private.publication_media_precheck_v1(f,'facebook');assert (r->'checks') @> '[{"code":"FILE_REFRESH_REQUIRED","status":"pending"}]';
 f.media_kind:='image';f.mime_type:='image/jpeg';r:=sma_private.publication_media_precheck_v1(f,'youtube');assert (r->'checks') @> '[{"code":"VIDEO_REQUIRED","status":"fail"}]';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','20be25c6-a763-4981-a25a-d503e32e4e25',true);
do $$ declare r jsonb; begin
 r:=public.sma_publication_files_v1('check','{"asset_id":"fa220000-0000-4000-8000-000000000001","asset_revision":"version:1","platform":"tiktok"}');assert r->'ok'='true',r::text;assert r->'media_check'->'facts'->>'width_px'='1080';assert r->'media_check'->'can_publish'='false';
 r:=public.sma_publication_files_v1('check','{"asset_id":"fa220000-0000-4000-8000-000000000001","asset_revision":"version:old","platform":"tiktok"}');assert r->>'code'='FILE_CHANGED';
 r:=public.sma_publication_files_v1('check','{"asset_id":"fa220000-0000-4000-8000-000000000099","asset_revision":"version:1","platform":"tiktok"}');assert r->>'code'='FILE_UNAVAILABLE';
 assert not has_function_privilege('authenticated','sma_private.publication_media_precheck_v1(sma_private.publication_files_v1,text)','EXECUTE');
 assert not has_table_privilege('authenticated','sma_private.publication_files_v1','UPDATE');
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
do $$ declare r jsonb;begin r:=public.sma_publication_files_v1('check','{"asset_id":"fa220000-0000-4000-8000-000000000001","asset_revision":"version:1","platform":"tiktok"}');assert r->'ok'='false';assert not (r ? 'media_check');end $$;
reset role;
-- Service metadata writes validate the entire batch before replacing the catalog.
update sma_private.publication_file_sync_v1 set lease_id='fa220000-0000-4000-8000-000000000088',lease_until=now()+interval '2 minutes' where customer_id=4;
set local role service_role;
do $$ declare r jsonb; files jsonb; begin
 files:='[{"drive_file_id":"fixture_media_check","name":"Medien-Prüffall.mp4","media_kind":"video","mime_type":"video/mp4","revision":"version:2","modified_at":"2026-11-01T12:00:00Z","size_bytes":"1000","width_px":1080,"height_px":1920,"duration_ms":12500}]';
 r:=public.sma_publication_files_finish_v1('20be25c6-a763-4981-a25a-d503e32e4e25','fa220000-0000-4000-8000-000000000088',jsonb_set(files,'{0,width_px}','"invalid"'));assert r->>'code'='FILE_METADATA_INVALID';
 assert (select revision from sma_private.publication_files_v1 where drive_file_id='fixture_media_check' and customer_id=4)='version:1';
 r:=public.sma_publication_files_finish_v1('20be25c6-a763-4981-a25a-d503e32e4e25','fa220000-0000-4000-8000-000000000088',files);assert r->'ok'='true',r::text;
 assert (select width_px=1080 and height_px=1920 and duration_ms=12500 and revision='version:2' from sma_private.publication_files_v1 where drive_file_id='fixture_media_check' and customer_id=4);
 r:=public.sma_publication_files_finish_v1('20be25c6-a763-4981-a25a-d503e32e4e25','fa220000-0000-4000-8000-000000000088',files);assert r->>'code'='INVALID_LEASE';
end $$;
reset role;
rollback;
select 'Media rules, incomplete metadata, file ownership/version, role permissions, atomic metadata sync and replay rejection passed; fixtures rolled back' as result;
