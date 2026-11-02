-- Transaction-only fixtures; no real customer session, no external upload.
-- Run as the migration role. All data changes are rolled back.
begin;
insert into public.sma_kunden(id,user_id,aktiv,demo_delta_aktiv,n8n_kunde_id,kunde_email) overriding system value values
 (-900001,'f7b00000-0000-4000-8000-000000000001',true,true,'upload_fixture','upload-fixture@example.invalid'),
 (-900002,'f7b00000-0000-4000-8000-000000000002',true,true,'other_fixture','other-fixture@example.invalid');
do $$
declare r jsonb; req jsonb:='{"upload_id":"f7b00000-0000-4000-8000-000000000011","name":"probe.png","mime_type":"image/png","size_bytes":42}'; lease uuid; f jsonb; aid uuid;
begin
 if has_table_privilege('authenticated','sma_private.publication_uploads_v1','select') or has_function_privilege('authenticated','public.sma_publication_upload_bind_v1(uuid,uuid,text,text,text)','execute') or has_function_privilege('anon','public.sma_publication_upload_v1(text,jsonb)','execute') then raise exception 'bad grants';end if;
 perform set_config('request.jwt.claim.sub','f7b00000-0000-4000-8000-000000000001',true);
 r:=public.sma_publication_upload_v1('start',req); if r->>'status'<>'initializing' then raise exception 'reservation %',r;end if;lease:=(r->>'lease_id')::uuid;
 r:=public.sma_publication_upload_v1('start',req);if r->>'code'<>'UPLOAD_INITIALIZING' then raise exception 'duplicate init %',r;end if;
 r:=public.sma_publication_upload_v1('start',jsonb_set(req,'{name}','"changed.png"'));if r->>'code'<>'UPLOAD_CONFLICT' then raise exception 'changed request %',r;end if;
 perform set_config('request.jwt.claim.sub','f7b00000-0000-4000-8000-000000000002',true);
 r:=public.sma_publication_upload_v1('finish',req);if r->>'code'<>'UPLOAD_UNAVAILABLE' then raise exception 'foreign reservation %',r;end if;
 r:=public.sma_publication_upload_bind_v1((req->>'upload_id')::uuid,lease,'test_drive_file_001','test_folder_001','https://evil.invalid/upload');if r->>'ok'<>'false' then raise exception 'bad url %',r;end if;
 r:=public.sma_publication_upload_bind_v1((req->>'upload_id')::uuid,lease,'test_drive_file_001','test_folder_001','https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=fixture');if r->>'status'<>'ready' then raise exception 'bind %',r;end if;
 perform set_config('request.jwt.claim.sub','f7b00000-0000-4000-8000-000000000001',true);
 r:=public.sma_publication_upload_v1('start',req);if r->>'status'<>'ready' then raise exception 'resume %',r;end if;
 f:=jsonb_build_object('drive_file_id','test_drive_file_001','name','probe.png','mime_type','image/png','size_bytes','42','folder_id','test_folder_001','upload_id',req->>'upload_id','revision','sha256:'||repeat('a',64)||':1','media_kind','image','modified_at','2026-11-02T10:00:00Z');
 r:=public.sma_publication_upload_finish_v1((req->>'upload_id')::uuid,jsonb_set(f,'{size_bytes}','"43"'));if r->>'ok'<>'false' then raise exception 'wrong size %',r;end if;
 r:=public.sma_publication_upload_finish_v1((req->>'upload_id')::uuid,jsonb_set(f,'{folder_id}','"foreign_folder"'));if r->>'ok'<>'false' then raise exception 'wrong folder %',r;end if;
 r:=public.sma_publication_upload_finish_v1((req->>'upload_id')::uuid,f);if r->>'status'<>'completed' or r->>'can_publish'<>'false' then raise exception 'finish %',r;end if;aid:=(r->>'asset_id')::uuid;
 r:=public.sma_publication_upload_finish_v1((req->>'upload_id')::uuid,f);if (r->>'asset_id')::uuid<>aid then raise exception 'duplicate asset %',r;end if;
 if not exists(select 1 from sma_private.publication_files_v1 where id=aid and customer_id=-900001 and user_id='f7b00000-0000-4000-8000-000000000001') then raise exception 'owner mapping';end if;
 if exists(select 1 from sma_private.publication_uploads_v1 where id=(req->>'upload_id')::uuid and upload_url is not null) then raise exception 'retained upload capability';end if;
 insert into sma_private.publication_file_sync_v1(user_id,customer_id,n8n_kunde_id,kunde_email,lease_id,lease_until,started_at) values('f7b00000-0000-4000-8000-000000000001',-900001,'upload_fixture','upload-fixture@example.invalid',lease,now()+interval '1 minute',now()-interval '10 seconds');
 r:=public.sma_publication_files_finish_v1('f7b00000-0000-4000-8000-000000000001',lease,'[]');
 if r->>'ok'<>'true' or not exists(select 1 from sma_private.publication_files_v1 where id=aid and available) then raise exception 'old catalogue scan hid new upload';end if;
 update public.sma_kunden set aktiv=false where id=-900001;
 r:=public.sma_publication_upload_v1('finish',req);if r->>'code'<>'ACCESS_INACTIVE' then raise exception 'inactive account %',r;end if;
end $$;
rollback;
select 'device_upload_rollback_tests_passed' as result;
