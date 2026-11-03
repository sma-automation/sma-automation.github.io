-- Synthetic identities only; all fixtures roll back. No provider request.
begin;
do $$begin assert not exists(select 1 from public.sma_kunden where id in (-909000000011,-909000000012));end $$;
insert into public.sma_kunden(id,user_id,n8n_kunde_id,kunde_email,aktiv,demo_delta_aktiv,shop_oeffentlich,shop_slug)
values(-909000000011,'fa660000-0000-4000-8000-000000000091','synthetic-order-owner','order@example.invalid',true,true,true,'synthetic-order'),
(-909000000012,'fa660000-0000-4000-8000-000000000092','synthetic-other','other@example.invalid',true,true,true,'synthetic-other');
insert into sma_private.publication_files_v1(id,customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,width_px,height_px,duration_ms)
values('fa660000-0000-4000-8000-000000000001',-909000000011,'fa660000-0000-4000-8000-000000000091','synthetic_order_video','Synthetic.mp4','video','video/mp4','version:1',now(),1000,720,1280,10000);
insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,preview)
values('fa660000-0000-4000-8000-000000000002','fa660000-0000-4000-8000-000000000091',-909000000011,
'{"platforms":["youtube"],"media_kind":"video","language":"de"}','https://sma-automation.com/app/shop.html?shop=synthetic-order','completed',
jsonb_build_object('can_publish',false,'drafts',jsonb_build_array(jsonb_build_object('platform','youtube','title','Synthetischer Test','body','Das blaue Quadrat bewegt sich im Testbild.','caption',E'Das blaue Quadrat bewegt sich im Testbild.\n\n🛒 Zum Shop: https://sma-automation.com/app/shop.html?shop=synthetic-order','hashtags','[]'::jsonb,'review_notes','[]'::jsonb))));
insert into sma_private.publication_assignments_v1(asset_id,platform,preview_id,preview_revision,asset_revision,draft)
select 'fa660000-0000-4000-8000-000000000001','youtube',id,revision,'version:1',preview->'drafts'->0 from sma_private.publication_previews_v1 where id='fa660000-0000-4000-8000-000000000002';
select set_config('sma.order_input','{"id":"fa660000-0000-4000-8000-000000000010","asset_id":"fa660000-0000-4000-8000-000000000001","asset_revision":"version:1","platform":"youtube","assignment_revision":1,"preview_id":"fa660000-0000-4000-8000-000000000002","preview_revision":1,"choices":{"visibility":"private","made_for_kids":false,"contains_synthetic_media":false}}',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
do $$begin assert public.sma_publication_order_v1('prepare',current_setting('sma.order_input')::jsonb)->>'code'='AUTH_REQUIRED';end $$;
select set_config('request.jwt.claim.sub','fa660000-0000-4000-8000-000000000092',true);
do $$begin assert public.sma_publication_order_v1('prepare',current_setting('sma.order_input')::jsonb)->>'code'='FILE_UNAVAILABLE';end $$;
select set_config('request.jwt.claim.sub','fa660000-0000-4000-8000-000000000091',true);
do $$declare i jsonb:=current_setting('sma.order_input')::jsonb;r jsonb;begin
 assert not has_function_privilege('anon','public.sma_publication_order_v1(text,jsonb)','EXECUTE');
 assert not has_function_privilege('authenticated','public.sma_publication_order_worker_v1(text,uuid,uuid,jsonb)','EXECUTE');
 assert not has_table_privilege('authenticated','sma_private.publication_orders_v1','SELECT,INSERT,UPDATE');
 assert public.sma_publication_order_v1('prepare',i||'{"customer_id":1}')->>'code'='INVALID_INPUT';
 assert public.sma_publication_order_v1('prepare',i||'{"assignment_revision":2}')->>'code'='ORDER_CHANGED';
 r:=public.sma_publication_order_v1('prepare',i);assert r->>'state'='preparing',r::text;
 assert not(r->'binding'?'customer_id');assert not(r->'binding'?'drive_file_id');assert r->>'can_publish'='false';
 assert public.sma_publication_order_v1('prepare',i)->>'id'=i->>'id';
 assert public.sma_publication_order_v1('prepare',jsonb_set(i,'{choices,visibility}','"public"'))->>'code'='REQUEST_CONFLICT';
 assert public.sma_publication_order_v1('approve',jsonb_build_object('id',i->>'id','confirm',true))->>'code'='FINAL_APPROVAL_REQUIRED';
end $$;
reset role;
set local role service_role;
do $$declare r jsonb;t jsonb:=jsonb_build_object('platform','youtube','id','synthetic_channel','name','Synthetic channel','source_revision',repeat('a',64));begin
 r:=public.sma_publication_order_worker_v1('claim','fa660000-0000-4000-8000-000000000010');assert r->>'code'='FINAL_APPROVAL_REQUIRED';
 r:=public.sma_publication_order_worker_v1('bind_target','fa660000-0000-4000-8000-000000000010',null,jsonb_build_object('target',t));assert r->>'state'='prepared',r::text;
 perform set_config('sma.order_approval',jsonb_build_object('id',r->>'id','approval_token',r->>'approval_token','confirm',true)::text,true);
 perform set_config('sma.order_target',t::text,true);
end $$;
reset role;
set local role authenticated;
do $$declare r jsonb;begin
 r:=public.sma_publication_order_v1('approve',current_setting('sma.order_approval')::jsonb||'{"confirm":"true"}');assert r->>'code'='FINAL_APPROVAL_REQUIRED';
 r:=public.sma_publication_order_v1('approve',current_setting('sma.order_approval')::jsonb);assert r->>'state'='approved',r::text;assert r->>'can_upload'='false';
 assert public.sma_publication_order_v1('approve',current_setting('sma.order_approval')::jsonb)->>'state'='approved';
 r:=public.sma_publication_order_v1('prepare',current_setting('sma.order_input')::jsonb||'{"id":"fa660000-0000-4000-8000-000000000011"}');assert r->>'state'='preparing';
end $$;
reset role;
set local role service_role;
do $$declare r jsonb;l uuid;begin
 r:=public.sma_publication_order_worker_v1('bind_target','fa660000-0000-4000-8000-000000000011',null,jsonb_build_object('target',current_setting('sma.order_target')::jsonb));
 perform set_config('sma.order_duplicate',jsonb_build_object('id',r->>'id','approval_token',r->>'approval_token','confirm',true)::text,true);
 r:=public.sma_publication_order_worker_v1('claim','fa660000-0000-4000-8000-000000000010');assert r->>'ok'='true',r::text;l:=(r->>'lease_id')::uuid;
 assert public.sma_publication_order_worker_v1('claim','fa660000-0000-4000-8000-000000000010')->>'code'='ORDER_RUNNING';
 assert public.sma_publication_order_worker_v1('finish_check','fa660000-0000-4000-8000-000000000010',gen_random_uuid(),'{}')->>'code'='INVALID_LEASE';
 r:=public.sma_publication_order_worker_v1('finish_check','fa660000-0000-4000-8000-000000000010',l,jsonb_build_object('target',current_setting('sma.order_target')::jsonb,'drive_verified',true,'text_verified',true,'blockers','[]'::jsonb));
 assert r->>'state'='blocked',r::text;assert r->'blockers'?'BINARY_INSPECTION_PENDING';assert r->'blockers'?'TARGET_PERMISSIONS_REQUIRED';assert r->>'can_upload'='false';
 assert public.sma_publication_order_worker_v1('finish_check','fa660000-0000-4000-8000-000000000010',l,'{}')->>'code'='INVALID_LEASE';
end $$;
reset role;
set local role authenticated;
do $$declare r jsonb;begin
 r:=public.sma_publication_order_v1('approve',current_setting('sma.order_duplicate')::jsonb);assert r->>'code'='DUPLICATE_PUBLICATION',r::text;
 assert r->>'existing_order_id'='fa660000-0000-4000-8000-000000000010';
end $$;
select set_config('request.jwt.claim.sub','fa660000-0000-4000-8000-000000000092',true);
do $$begin assert public.sma_publication_order_v1('get','{"id":"fa660000-0000-4000-8000-000000000010"}')->>'code'='ORDER_UNAVAILABLE';end $$;
reset role;
update sma_private.publication_files_v1 set revision='version:2' where id='fa660000-0000-4000-8000-000000000001';
set local role service_role;
do $$begin assert public.sma_publication_order_worker_v1('claim','fa660000-0000-4000-8000-000000000010')->>'code'='FILE_CHANGED';end $$;
reset role;
rollback;
select 'Order ownership, immutable versions, explicit consent, duplicate UUIDs, lease replay and blocked media checks passed; fixtures rolled back' result;
