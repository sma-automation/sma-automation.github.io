begin;
insert into public.sma_kunden values
 (-909000006091,'fa990000-0000-4000-8000-000000000091','delta',true,false,true,null,false),
 (-909000006092,'fa990000-0000-4000-8000-000000000092','delta',true,false,true,null,false);
set local role authenticated;
select set_config('request.jwt.claim.sub','fa990000-0000-4000-8000-000000000091',true);
do $$declare r jsonb;begin
 assert not has_function_privilege('authenticated','public.sma_website_image_service_v1(uuid,text,jsonb)','EXECUTE');
 assert not has_function_privilege('anon','public.sma_website_image_service_v1(uuid,text,jsonb)','EXECUTE');
 assert not has_table_privilege('service_role','sma_private.website_images_v1','SELECT,INSERT,UPDATE,DELETE');
 r:=public.sma_customer_website_v1('generate',jsonb_build_object('expected_revision',0,'request_id',gen_random_uuid()));assert r->>'ok'='true';
 perform set_config('test.image_site',r->>'site_id',true);
 r:=public.sma_customer_website_v1('publish',jsonb_build_object('expected_revision',1,'request_id',gen_random_uuid()));assert r->>'revision'='2';
end $$;
select set_config('request.jwt.claim.sub','fa990000-0000-4000-8000-000000000092',true);
select public.sma_customer_website_v1('generate',jsonb_build_object('expected_revision',0,'request_id',gen_random_uuid()));
set local role service_role;
do $$declare uid uuid:='fa990000-0000-4000-8000-000000000091';id uuid;r jsonb;input jsonb;n integer;begin
 assert public.sma_website_image_service_v1(null,'reserve','{}')->>'code'='INVALID_INPUT';
 for n in 1..4 loop
  id:=('ab990000-0000-4000-8000-00000000009'||n)::uuid;
  input:=jsonb_build_object('id',id,'mime','image/png','size',1200,'width',320,'height',160,'sha256',repeat('a',64));
  r:=public.sma_website_image_service_v1(uid,'reserve',input);assert r->>'state'='reserved';
  assert public.sma_website_image_service_v1(uid,'reserve',input)=r;
  assert public.sma_website_image_service_v1(uid,'reserve',input||jsonb_build_object('sha256',repeat('b',64)))->>'code'='IMAGE_CONFLICT';
  assert public.sma_website_image_service_v1(uid,'read',jsonb_build_object('id',id))->>'code'='IMAGE_UNAVAILABLE';
  if n<4 then
   r:=public.sma_website_image_service_v1(uid,'complete',jsonb_build_object('id',id,'sha256',repeat('a',64)));assert r->>'state'='ready';
   assert public.sma_website_image_service_v1(uid,'complete',jsonb_build_object('id',id,'sha256',repeat('a',64)))=r;
  end if;
 end loop;
 assert public.sma_website_image_service_v1('fa990000-0000-4000-8000-000000000092','read','{"id":"ab990000-0000-4000-8000-000000000091"}')->>'code'='IMAGE_UNAVAILABLE';
 -- A legacy published page without hero/ID fields must not authorize an arbitrary image (NULL booleans).
 assert public.sma_website_image_service_v1(null,'read_public',jsonb_build_object('id','ab990000-0000-4000-8000-000000000091','site_id',current_setting('test.image_site')))->>'code'='IMAGE_UNAVAILABLE';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','fa990000-0000-4000-8000-000000000091',true);
do $$declare c jsonb;r jsonb;begin
 c:=public.sma_customer_website_v1('get')->'content';
 assert public.sma_customer_website_v1('save',jsonb_build_object('expected_revision',2,'request_id',gen_random_uuid(),'content',c||'{"hero":"image"}'))->>'code'='INVALID_CONTENT';
 assert public.sma_customer_website_v1('save',jsonb_build_object('expected_revision',2,'request_id',gen_random_uuid(),'content',c||'{"hero_image_id":"https://evil.example/image.png"}'))->>'code'='INVALID_CONTENT';
 assert public.sma_customer_website_v1('save',jsonb_build_object('expected_revision',2,'request_id',gen_random_uuid(),'content',c||'{"logo_image_id":"ab990000-0000-4000-8000-000000000094"}'))->>'code'='IMAGE_UNAVAILABLE';
 c:=c||'{"logo_image_id":"ab990000-0000-4000-8000-000000000091","hero_image_id":"ab990000-0000-4000-8000-000000000091","hero":"image","hero_image_alt":"<img src=x> Testbild"}';
 r:=public.sma_customer_website_v1('save',jsonb_build_object('expected_revision',2,'request_id',gen_random_uuid(),'content',c));assert r->>'revision'='3';
 r:=public.sma_customer_website_v1('publish',jsonb_build_object('expected_revision',3,'request_id',gen_random_uuid()));assert r->>'revision'='4';
 c:=c||'{"logo_image_id":"","hero_image_id":"ab990000-0000-4000-8000-000000000092","hero":"shk"}';
 r:=public.sma_customer_website_v1('save',jsonb_build_object('expected_revision',4,'request_id',gen_random_uuid(),'content',c));assert r->>'revision'='5';
 -- Older writes omit image fields but do not erase the saved references.
 r:=public.sma_customer_website_v1('save',jsonb_build_object('expected_revision',5,'request_id',gen_random_uuid(),'content',c-'logo_image_id'-'hero_image_id'-'hero_image_alt'));assert r->>'revision'='6';assert r->'content'->>'hero_image_id'='ab990000-0000-4000-8000-000000000092';
end $$;
set local role service_role;
do $$begin
 assert public.sma_website_image_service_v1(null,'read_public',jsonb_build_object('id','ab990000-0000-4000-8000-000000000091','site_id',current_setting('test.image_site')))->>'ok'='true';
 assert public.sma_website_image_service_v1(null,'read_public',jsonb_build_object('id','ab990000-0000-4000-8000-000000000092','site_id',current_setting('test.image_site')))->>'code'='IMAGE_UNAVAILABLE';
end $$;
reset role;
update sma_private.website_images_v1 set created_at=now()-interval '25 hours' where customer_id=-909000006091;
set local role service_role;
do $$declare r jsonb;begin
 r:=public.sma_website_image_service_v1('fa990000-0000-4000-8000-000000000091','reap','{}');assert jsonb_array_length(r->'images')=2;
 assert not exists(select 1 from jsonb_array_elements(r->'images') x where x->>'id' in ('ab990000-0000-4000-8000-000000000091','ab990000-0000-4000-8000-000000000092'));
 assert public.sma_website_image_service_v1('fa990000-0000-4000-8000-000000000091','read','{"id":"ab990000-0000-4000-8000-000000000093"}')->>'code'='IMAGE_UNAVAILABLE';
 assert public.sma_website_image_service_v1('fa990000-0000-4000-8000-000000000091','discard','{"id":"ab990000-0000-4000-8000-000000000093"}')->>'ok'='true';
end $$;
set local role authenticated;
do $$declare c jsonb;begin
 c:=public.sma_customer_website_v1('get')->'content';
 assert public.sma_customer_website_v1('save',jsonb_build_object('expected_revision',6,'request_id',gen_random_uuid(),'content',c||'{"logo_image_id":"ab990000-0000-4000-8000-000000000093"}'))->>'code'='IMAGE_UNAVAILABLE';
end $$;
reset role;
update public.sma_kunden set aktiv=false where id=-909000006091;
set local role service_role;
do $$begin
 assert public.sma_website_image_service_v1(null,'read_public',jsonb_build_object('id','ab990000-0000-4000-8000-000000000091','site_id',current_setting('test.image_site')))->>'code'='IMAGE_UNAVAILABLE';
 assert public.sma_website_image_service_v1('fa990000-0000-4000-8000-000000000091','read','{"id":"ab990000-0000-4000-8000-000000000091"}')->>'ok'='true';
 assert public.sma_website_image_service_v1('fa990000-0000-4000-8000-000000000091','reap','{}')->>'code'='ACCESS_INACTIVE';
end $$;
set local role authenticated;
select public.sma_customer_website_v1('unpublish',jsonb_build_object('expected_revision',6,'request_id',gen_random_uuid()));
reset role;
update public.sma_kunden set aktiv=true,user_id='fa990000-0000-4000-8000-000000000093' where id=-909000006091;
set local role service_role;
do $$begin
 assert public.sma_website_image_service_v1('fa990000-0000-4000-8000-000000000093','read','{"id":"ab990000-0000-4000-8000-000000000091"}')->>'code'='ACCOUNT_CHANGED';
 assert public.sma_website_image_service_v1('fa990000-0000-4000-8000-000000000091','read','{"id":"ab990000-0000-4000-8000-000000000091"}')->>'code'='ACCOUNT_UNAVAILABLE';
end $$;
reset role;
-- Upload quotas count reservations as well as complete objects.
set local role service_role;
do $$declare uid uuid:='fa990000-0000-4000-8000-000000000092';n integer;r jsonb;begin
 for n in 1..13 loop
  r:=public.sma_website_image_service_v1(uid,'reserve',jsonb_build_object('id',gen_random_uuid(),'mime','image/png','size',1200,'width',320,'height',160,'sha256',repeat('a',64)));
  if n<=12 then assert r->>'ok'='true';else assert r->>'code'='IMAGE_LIMIT';end if;
 end loop;
end $$;
reset role;
update sma_private.website_images_v1 set created_at=now()-interval '2 hours' where customer_id=-909000006092;
set local role service_role;
do $$declare uid uuid:='fa990000-0000-4000-8000-000000000092';n integer;r jsonb;begin
 for n in 1..12 loop
  r:=public.sma_website_image_service_v1(uid,'reserve',jsonb_build_object('id',gen_random_uuid(),'mime','image/png','size',1200,'width',320,'height',160,'sha256',repeat('a',64)));assert r->>'ok'='true';
 end loop;
end $$;
reset role;
update sma_private.website_images_v1 set created_at=now()-interval '2 hours' where customer_id=-909000006092;
set local role service_role;
do $$begin
 assert public.sma_website_image_service_v1('fa990000-0000-4000-8000-000000000092','reserve',jsonb_build_object('id',gen_random_uuid(),'mime','image/png','size',1200,'width',320,'height',160,'sha256',repeat('a',64)))->>'code'='IMAGE_LIMIT';
end $$;
reset role;
-- Even a future broad Storage policy must not expose this private bucket.
grant usage on schema storage to anon,authenticated;
grant select on storage.objects to anon,authenticated;
create policy fixture_broad_storage_read on storage.objects for select to anon,authenticated using(true);
insert into storage.objects values(gen_random_uuid(),'sma-webseitenbilder','private.png'),(gen_random_uuid(),'sma-produktbilder','other.png');
set local role anon;
do $$begin assert (select count(*) from storage.objects where bucket_id='sma-webseitenbilder')=0;assert (select count(*) from storage.objects where bucket_id='sma-produktbilder')=1;end $$;
reset role;
rollback;
select 'Website images SQL passed: service-only access, immutable reservations, ownership, snapshots, expiry, safe cleanup, legacy writes and restrictive Storage policy; fixtures rolled back' as result;
