-- Synthetic TikTok order only. No provider requests; all writes roll back.
begin;
do $$begin assert not exists(select 1 from public.sma_kunden where id=-909000000031);end $$;
insert into public.sma_kunden(id,user_id,n8n_kunde_id,kunde_email,aktiv,demo_delta_aktiv,shop_oeffentlich,shop_slug)
values(-909000000031,'fa670000-0000-4000-8000-000000000091','synthetic-creator-owner','creator@example.invalid',true,true,true,'synthetic-creator');
insert into sma_private.publication_files_v1(id,customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,width_px,height_px,duration_ms)
values('fa670000-0000-4000-8000-000000000001',-909000000031,'fa670000-0000-4000-8000-000000000091','synthetic_creator_video','Synthetic.mp4','video','video/mp4','version:1',now(),1000,720,1280,10000);
insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,preview)
values('fa670000-0000-4000-8000-000000000002','fa670000-0000-4000-8000-000000000091',-909000000031,
'{"platforms":["tiktok"],"media_kind":"video","language":"de"}','https://sma-automation.com/app/shop.html?shop=synthetic-creator','completed',
jsonb_build_object('can_publish',false,'drafts',jsonb_build_array(jsonb_build_object('platform','tiktok','title','Synthetischer Test','body','Das blaue Quadrat bewegt sich im Testbild.','caption',E'Das blaue Quadrat bewegt sich im Testbild.\n\n🛒 Zum Shop: https://sma-automation.com/app/shop.html?shop=synthetic-creator','hashtags','[]'::jsonb,'review_notes','[]'::jsonb))));
insert into sma_private.publication_assignments_v1(asset_id,platform,preview_id,preview_revision,asset_revision,draft)
select 'fa670000-0000-4000-8000-000000000001','tiktok',id,revision,'version:1',preview->'drafts'->0 from sma_private.publication_previews_v1 where id='fa670000-0000-4000-8000-000000000002';
select set_config('sma.creator_input','{"id":"fa670000-0000-4000-8000-000000000010","asset_id":"fa670000-0000-4000-8000-000000000001","asset_revision":"version:1","platform":"tiktok","assignment_revision":1,"preview_id":"fa670000-0000-4000-8000-000000000002","preview_revision":1,"choices":{"visibility":"SELF_ONLY","disable_comment":true,"disable_duet":true,"disable_stitch":true,"brand_content_toggle":false,"brand_organic_toggle":false}}',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','fa670000-0000-4000-8000-000000000091',true);
do $$begin
 assert not has_function_privilege('authenticated','sma_private.publication_order_media_v1(sma_private.publication_orders_v1,jsonb,jsonb)','EXECUTE');
 assert public.sma_publication_order_v1('prepare',current_setting('sma.creator_input')::jsonb)->>'state'='preparing';
end $$;
reset role;
set local role service_role;
do $$declare r jsonb;t jsonb:=jsonb_build_object('platform','tiktok','id','synthetic_creator','name','Synthetic creator','source_revision',repeat('a',64));e jsonb;begin
 assert not has_function_privilege('anon','sma_private.publication_order_media_v1(sma_private.publication_orders_v1,jsonb,jsonb)','EXECUTE');
 e:=jsonb_build_object('version',1,'platform','tiktok','target_id',t->>'id','target_revision',t->>'source_revision','display_name','Verified synthetic creator','permissions','["video.publish","user.info.basic"]'::jsonb,
 'policy','{"privacy_levels":["SELF_ONLY","PUBLIC_TO_EVERYONE"],"comment_disabled":true,"duet_disabled":true,"stitch_disabled":true,"max_duration_sec":600}'::jsonb,'checked_at',now(),'expires_at',now()+interval '5 minutes');
 perform set_config('sma.creator_target',t::text,true);perform set_config('sma.creator_evidence',e::text,true);
 r:=public.sma_publication_order_worker_v1('bind_target','fa670000-0000-4000-8000-000000000010',null,jsonb_build_object('target',t,'account_check',e));
 assert r->>'state'='prepared',r::text;
 assert r->'media_check'->'checks' @> '[{"code":"TIKTOK_CREATOR_LIMIT","status":"pass"}]';
 assert r->'media_check'->'checks' @> '[{"code":"CONTENT_REVIEW_PENDING","status":"pending"}]';
 assert r->'media_check'->>'can_publish'='false' and r->>'can_upload'='false';
 perform set_config('sma.creator_approval',jsonb_build_object('id',r->>'id','approval_token',r->>'approval_token','confirm',true,'review',jsonb_build_object('policy_version','media-consent-2026-11-03.1','content_checked',true,'media_rights',true,'music_rights',true,'tiktok_music_terms',true,'tiktok_branded_terms',false))::text,true);
end $$;
-- Freshness, target, permissions and choices must all match. Other media
-- checks stay byte-identical and the generic file precheck stays pending.
do $$declare j sma_private.publication_orders_v1%rowtype;f sma_private.publication_files_v1%rowtype;m jsonb;r jsonb;e jsonb:=current_setting('sma.creator_evidence')::jsonb;bad jsonb;ch jsonb;begin
 select * into j from sma_private.publication_orders_v1 where id='fa670000-0000-4000-8000-000000000010';
 select * into f from sma_private.publication_files_v1 where id='fa670000-0000-4000-8000-000000000001';
 m:=sma_private.publication_media_precheck_v1(f,'tiktok');
 assert m->'checks' @> '[{"code":"TIKTOK_CREATOR_LIMIT","status":"pending"}]';
 r:=sma_private.publication_order_media_v1(j,m,e);
 assert (select jsonb_agg(x order by n) from jsonb_array_elements(m->'checks') with ordinality q(x,n) where x->>'code'<>'TIKTOK_CREATOR_LIMIT')=
        (select jsonb_agg(x order by n) from jsonb_array_elements(r->'checks') with ordinality q(x,n) where x->>'code'<>'TIKTOK_CREATOR_LIMIT');
 assert r-'checks'-'status'=m-'checks'-'status';
 for bad in select value from jsonb_array_elements(jsonb_build_array(null,e-'permissions',e||'{"permissions":[]}',e||'{"target_id":"foreign"}',e||jsonb_build_object('target_revision',repeat('b',64)),e||jsonb_build_object('expires_at',now()),e||jsonb_build_object('checked_at',now()-interval '6 minutes'),e||jsonb_build_object('checked_at',now()+interval '30 seconds'),e||'{"checked_at":"invalid"}',e||'{"policy":{}}')) loop
  j.account_check:=nullif(bad,'null'::jsonb);r:=sma_private.publication_order_view_v1(j);
  assert r->'media_check'->'checks' @> '[{"code":"TIKTOK_CREATOR_LIMIT","status":"pending"}]',bad::text;
 end loop;
 j.account_check:=e;ch:=j.choices;
 for bad in select value from jsonb_array_elements(jsonb_build_array(ch||'{"visibility":"FOLLOWER_OF_CREATOR"}',ch||'{"disable_comment":false}',ch||'{"disable_duet":false}',ch||'{"disable_stitch":false}',ch||'{"brand_content_toggle":true}')) loop
  j.choices:=bad;r:=sma_private.publication_order_view_v1(j);
  assert r->'media_check'->'checks' @> '[{"code":"TIKTOK_CREATOR_LIMIT","status":"pending"}]',bad::text;
 end loop;
 j.choices:=ch;
 assert sma_private.publication_order_media_v1(j,m||'{"asset_revision":"version:2"}',e)=m||'{"asset_revision":"version:2"}'::jsonb;
 j.binding:=j.binding||'{"platform":"youtube"}';assert sma_private.publication_order_media_v1(j,m,e)=m;
end $$;
-- Exact duration boundary, missing duration and zero duration stay conservative.
do $$declare j sma_private.publication_orders_v1%rowtype;r jsonb;d bigint;begin
 select * into j from sma_private.publication_orders_v1 where id='fa670000-0000-4000-8000-000000000010';
 foreach d in array array[null,0,600000,600001]::bigint[] loop
  update sma_private.publication_files_v1 set duration_ms=d where id='fa670000-0000-4000-8000-000000000001';
  r:=sma_private.publication_order_view_v1(j);
  assert r->'media_check'->'checks' @> jsonb_build_array(jsonb_build_object('code','TIKTOK_CREATOR_LIMIT','status',case when d is null or d=0 then 'pending' when d=600000 then 'pass' else 'fail' end));
  assert r->>'can_publish'='false';
  if d=600001 then assert r->'media_check'->>'status'='needs_changes';end if;
 end loop;
 update sma_private.publication_files_v1 set duration_ms=10000 where id='fa670000-0000-4000-8000-000000000001';
end $$;
reset role;
set local role authenticated;
do $$begin assert public.sma_publication_order_v1('approve',current_setting('sma.creator_approval')::jsonb)->>'state'='approved';end $$;
reset role;
set local role service_role;
-- A worker must use its new evidence, not a previously passed preparation.
do $$declare r jsonb;l uuid;e jsonb:=current_setting('sma.creator_evidence')::jsonb;t jsonb:=current_setting('sma.creator_target')::jsonb;bad jsonb;begin
 update sma_private.publication_orders_v1 set account_check=jsonb_set(account_check,'{expires_at}',to_jsonb(now()-interval '1 second')) where id='fa670000-0000-4000-8000-000000000010';
 r:=public.sma_publication_order_worker_v1('claim','fa670000-0000-4000-8000-000000000010');l:=(r->>'lease_id')::uuid;
 r:=public.sma_publication_order_worker_v1('finish_check','fa670000-0000-4000-8000-000000000010',l,jsonb_build_object('target',t,'account_check',e,'drive_verified',true,'text_verified',true,'blockers','[]'::jsonb));
 assert r->>'state'='blocked';assert not(r->'blockers'?'TIKTOK_CREATOR_LIMIT');assert r->'blockers'?'CONTENT_REVIEW_PENDING';assert r->'blockers'?'SEMANTIC_REVIEW_PENDING';
 assert r->'media_check'->'checks' @> '[{"code":"TIKTOK_CREATOR_LIMIT","status":"pass"}]';
 assert r->'account_check'=e-'target_revision';assert r->>'can_upload'='false' and r->>'can_publish'='false';
 for bad in select value from jsonb_array_elements(jsonb_build_array(null,e||jsonb_build_object('expires_at',now()),e||'{"target_id":"foreign"}')) loop
  r:=public.sma_publication_order_worker_v1('claim','fa670000-0000-4000-8000-000000000010');l:=(r->>'lease_id')::uuid;
  r:=public.sma_publication_order_worker_v1('finish_check','fa670000-0000-4000-8000-000000000010',l,jsonb_build_object('target',t,'account_check',bad,'drive_verified',true,'text_verified',true,'blockers','[]'::jsonb));
  assert r->'blockers'?'TIKTOK_CREATOR_LIMIT';assert r->'blockers'?'TARGET_PERMISSIONS_REQUIRED';assert r->'account_check'='null'::jsonb;
  assert r->'media_check'->'checks' @> '[{"code":"TIKTOK_CREATOR_LIMIT","status":"pending"}]';
 end loop;
 update sma_private.publication_files_v1 set duration_ms=600001 where id='fa670000-0000-4000-8000-000000000001';
 r:=public.sma_publication_order_worker_v1('claim','fa670000-0000-4000-8000-000000000010');l:=(r->>'lease_id')::uuid;
 r:=public.sma_publication_order_worker_v1('finish_check','fa670000-0000-4000-8000-000000000010',l,jsonb_build_object('target',t,'account_check',e,'drive_verified',true,'text_verified',true,'blockers','["TEXT_REVIEW_REQUIRED"]'::jsonb));
 assert r->'blockers'?'TIKTOK_CREATOR_LIMIT';assert r->'blockers'?'TARGET_DURATION_EXCEEDED';assert r->'blockers'?'TEXT_REVIEW_REQUIRED';
 assert r->'media_check'->'checks' @> '[{"code":"TIKTOK_CREATOR_LIMIT","status":"fail"}]';
 update sma_private.publication_files_v1 set duration_ms=10000 where id='fa670000-0000-4000-8000-000000000001';
 r:=public.sma_publication_order_worker_v1('claim','fa670000-0000-4000-8000-000000000010');l:=(r->>'lease_id')::uuid;
 r:=public.sma_publication_order_worker_v1('finish_check','fa670000-0000-4000-8000-000000000010',l,jsonb_build_object('target',t||'{"id":"foreign"}','account_check',e,'drive_verified',true,'text_verified',true,'blockers','["TIKTOK_CREATOR_LIMIT"]'::jsonb));
 assert r->'blockers'?'TARGET_ACCOUNT_CHANGED';assert r->'blockers'?'TIKTOK_CREATOR_LIMIT';assert r->'account_check'='null'::jsonb;
 assert public.sma_publication_order_worker_v1('finish_check','fa670000-0000-4000-8000-000000000010',l,'{}')->>'code'='INVALID_LEASE';
 update sma_private.publication_files_v1 set revision='version:2' where id='fa670000-0000-4000-8000-000000000001';
 assert public.sma_publication_order_worker_v1('claim','fa670000-0000-4000-8000-000000000010')->>'code'='FILE_CHANGED';
end $$;
reset role;
rollback;
select 'Creator target/options/freshness, exact duration boundary, worker recheck, unchanged media gates and role isolation passed; fixtures rolled back' result;
