begin;
insert into sma_private.publication_files_v1(id,customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes) values
('fa110000-0000-4000-8000-000000000001',4,'20be25c6-a763-4981-a25a-d503e32e4e25','fixture_drive_file_a','Testdatei A.mp4','video','video/mp4','version:1',now(),100),
('fa110000-0000-4000-8000-000000000002',4,'20be25c6-a763-4981-a25a-d503e32e4e25','fixture_drive_file_b','Testdatei B.mp4','video','video/mp4','version:1',now(),200),
('fa110000-0000-4000-8000-000000000003',4,'00000000-0000-4000-8000-000000000099','fixture_drive_foreign','Fremde Datei.mp4','video','video/mp4','version:1',now(),200);
insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,preview)
select ('ab110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'20be25c6-a763-4981-a25a-d503e32e4e25',4,
 '{"platforms":["youtube"],"media_kind":"video","language":"de"}', 'https://sma-automation.com/app/shop.html?shop=sma-testkunde','completed',
 jsonb_build_object('can_publish',false,'media_kind','video','language','de','shop_url','https://sma-automation.com/app/shop.html?shop=sma-testkunde','drafts',jsonb_build_array(jsonb_build_object('platform','youtube','title','Text '||n,'body','Sachlicher Inhalt zur Testdatei '||n||'.','hashtags',jsonb_build_array('SMATest'),'review_notes','[]'::jsonb,'caption','Sachlicher Testtext.'))) from generate_series(1,2) n;
set local role authenticated;
select set_config('request.jwt.claim.sub','20be25c6-a763-4981-a25a-d503e32e4e25',true);
do $$ declare r jsonb; begin
 r:=public.sma_publication_files_v1('list'); assert not (r->'files') @> '[{"id":"fa110000-0000-4000-8000-000000000003"}]'::jsonb;
 r:=public.sma_publication_files_v1('get','{"asset_id":"fa110000-0000-4000-8000-000000000003","platform":"youtube"}');assert r->>'code'='FILE_UNAVAILABLE';
 r:=public.sma_publication_files_v1('assign','{"asset_id":"fa110000-0000-4000-8000-000000000001","asset_revision":"version:1","platform":"youtube","assignment_revision":0,"preview_id":"ab110000-0000-4000-8000-000000000001","preview_revision":1}');assert r->'ok'='true'::jsonb,r::text;
 r:=public.sma_publication_files_v1('assign','{"asset_id":"fa110000-0000-4000-8000-000000000002","asset_revision":"version:1","platform":"youtube","assignment_revision":0,"preview_id":"ab110000-0000-4000-8000-000000000001","preview_revision":1}');assert r->>'code'='TEXT_ALREADY_ASSIGNED',r::text;
 r:=public.sma_publication_files_v1('assign','{"asset_id":"fa110000-0000-4000-8000-000000000002","asset_revision":"version:1","platform":"youtube","assignment_revision":0,"preview_id":"ab110000-0000-4000-8000-000000000002","preview_revision":1}');assert r->'ok'='true'::jsonb,r::text;
 r:=public.sma_publication_files_v1('get','{"asset_id":"fa110000-0000-4000-8000-000000000001","platform":"youtube"}');assert r->'preview'->'drafts'->0->>'title'='Text 1';
 r:=public.sma_publication_preview_v1('latest','{"platform":"youtube"}');assert coalesce(r->>'id','') not in ('ab110000-0000-4000-8000-000000000001','ab110000-0000-4000-8000-000000000002');
 r:=public.sma_publication_files_v1('get','{"asset_id":"fa110000-0000-4000-8000-000000000001","platform":"instagram"}');assert r->>'status'='empty';
 r:=public.sma_publication_files_v1('save','{"asset_id":"fa110000-0000-4000-8000-000000000001","asset_revision":"version:1","platform":"youtube","assignment_revision":1,"title":"Korrigierter Titel A","body":"Korrigierter sachlicher Inhalt für Testdatei A."}');assert r->'ok'='true'::jsonb,r::text;assert r->>'assignment_revision'='2';assert r->'preview'->'drafts'->0->>'caption' like '%https://sma-automation.com/app/shop.html?shop=sma-testkunde';
 r:=public.sma_publication_files_v1('save','{"asset_id":"fa110000-0000-4000-8000-000000000001","asset_revision":"version:1","platform":"youtube","assignment_revision":1,"title":"Veralteter Titel","body":"Dieser Stand darf nicht gespeichert werden."}');assert r->>'code'='ASSIGNMENT_CONFLICT';
 r:=public.sma_publication_files_v1('get','{"asset_id":"fa110000-0000-4000-8000-000000000002","platform":"youtube"}');assert r->'preview'->'drafts'->0->>'title'='Text 2';
 assert not has_function_privilege('authenticated','public.sma_publication_files_finish_v1(uuid,uuid,jsonb,text)','EXECUTE');
 assert not has_function_privilege('authenticated','public.sma_publication_assignment_v1(bigint,text,text,text)','EXECUTE');
 assert not has_table_privilege('authenticated','sma_private.publication_files_v1','SELECT');
end $$;
reset role;
set local role service_role;
do $$ declare r jsonb; begin
 r:=public.sma_publication_assignment_v1(4,'fixture_drive_file_a','version:1','youtube');assert r->'ok'='true'::jsonb,r::text;assert r->'can_publish'='false'::jsonb;assert r->'text'->>'title'='Korrigierter Titel A';
 r:=public.sma_publication_assignment_v1(4,'fixture_drive_file_a','version:2','youtube');assert r->>'code'='FILE_CHANGED';
 r:=public.sma_publication_files_finish_v1('20be25c6-a763-4981-a25a-d503e32e4e25',null,'[]');assert r->>'code'='INVALID_LEASE';
end $$;
reset role;
-- An inaccessible folder must not turn a previously verified catalog into an empty success.
update sma_private.publication_file_sync_v1 set lease_id='fa110000-0000-4000-8000-000000000009',lease_until=now()+interval '2 minutes',finished_at='2026-01-01T00:00:00Z' where user_id='20be25c6-a763-4981-a25a-d503e32e4e25';
set local role service_role;
do $$ declare r jsonb; begin
 r:=public.sma_publication_files_finish_v1('20be25c6-a763-4981-a25a-d503e32e4e25','fa110000-0000-4000-8000-000000000009','[]','FOLDER_UNAVAILABLE');
 assert r->>'code'='FOLDER_UNAVAILABLE',r::text;
 assert exists(select 1 from sma_private.publication_files_v1 where id='fa110000-0000-4000-8000-000000000001' and available and revision='version:1');
 assert exists(select 1 from sma_private.publication_file_sync_v1 where user_id='20be25c6-a763-4981-a25a-d503e32e4e25' and lease_id is null and lease_until is null and finished_at='2026-01-01T00:00:00Z');
end $$;
reset role;
update sma_private.publication_files_v1 set revision='version:2' where id='fa110000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare r jsonb; begin
 r:=public.sma_publication_files_v1('get','{"asset_id":"fa110000-0000-4000-8000-000000000001","platform":"youtube"}');assert r->>'code'='FILE_CHANGED';
 r:=public.sma_publication_files_v1('save','{"asset_id":"fa110000-0000-4000-8000-000000000001","asset_revision":"version:1","platform":"youtube","assignment_revision":2,"title":"Alt","body":"Eine alte Dateiversion darf nicht gespeichert werden."}');assert r->>'code'='FILE_CHANGED';
end $$;
reset role;
do $$ begin assert not has_function_privilege('anon','public.sma_publication_files_v1(text,jsonb)','EXECUTE');end $$;
rollback;
select 'File/portal isolation, edits, version conflicts, publisher contract and role permissions passed; fixtures rolled back' as result;
