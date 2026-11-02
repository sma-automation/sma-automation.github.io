begin;
insert into public.sma_kunden(id,user_id,aktiv,demo_delta_aktiv,n8n_kunde_id,kunde_email) overriding system value values
 (-900011,'f7b00000-0000-4000-8000-000000000101',true,true,'preview_fixture','preview-fixture@example.invalid'),
 (-900012,'f7b00000-0000-4000-8000-000000000102',true,true,'other_preview','other-preview@example.invalid');
insert into sma_private.publication_files_v1(id,customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,size_bytes,available,verified_at,modified_at) values
 ('f7b00000-0000-4000-8000-000000000111',-900011,'f7b00000-0000-4000-8000-000000000101','preview_fixture_file','preview.png','image','image/png','version:1',42,true,now(),now());
do $$
declare r jsonb; aid uuid:='f7b00000-0000-4000-8000-000000000111';
begin
 if has_function_privilege('anon','public.sma_publication_asset_preview_v1(uuid,text)','execute') or has_function_privilege('anon','sma_private.publication_asset_preview_v1(uuid,text)','execute') then raise exception 'anonymous preview grant';end if;
 r:=public.sma_publication_asset_preview_v1(aid,'version:1');if r->>'code' is distinct from 'AUTH_REQUIRED' then raise exception 'missing auth %',r;end if;
 perform set_config('request.jwt.claim.sub','f7b00000-0000-4000-8000-000000000101',true);
 r:=public.sma_publication_asset_preview_v1(aid,'version:1');if r->>'ok' is distinct from 'true' or r->>'can_publish' is distinct from 'false' then raise exception 'own asset %',r;end if;
 r:=public.sma_publication_asset_preview_v1(aid,'version:2');if r->>'code' is distinct from 'FILE_CHANGED' then raise exception 'revision %',r;end if;
 perform set_config('request.jwt.claim.sub','f7b00000-0000-4000-8000-000000000102',true);
 r:=public.sma_publication_asset_preview_v1(aid,'version:1');if r->>'code' is distinct from 'FILE_UNAVAILABLE' then raise exception 'foreign asset %',r;end if;
 perform set_config('request.jwt.claim.sub','f7b00000-0000-4000-8000-000000000101',true);
 update public.sma_kunden set aktiv=false where id=-900011;
 r:=public.sma_publication_asset_preview_v1(aid,'version:1');if r->>'code' is distinct from 'ACCESS_INACTIVE' then raise exception 'inactive %',r;end if;
 update public.sma_kunden set aktiv=true where id=-900011;
 update sma_private.publication_files_v1 set available=false where id=aid;
 r:=public.sma_publication_asset_preview_v1(aid,'version:1');if r->>'code' is distinct from 'FILE_UNAVAILABLE' then raise exception 'unavailable %',r;end if;
end $$;
rollback;
select 'asset_preview_rollback_tests_passed' as result;
