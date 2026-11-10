-- Purely synthetic fixture; no HTTP and no real consent. Entire script rolls back.
begin;
do $$begin assert not exists(select 1 from public.sma_kunden where id=909000000081);end $$;
insert into public.sma_kunden(id,user_id,n8n_kunde_id,kunde_email,aktiv,demo_delta_aktiv)
 values(909000000081,'fa690000-0000-4000-8000-000000000091','synthetic-provider','provider@example.invalid',true,true);
insert into sma_private.publication_files_v1(id,customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes)
 values('fa690000-0000-4000-8000-000000000001',909000000081,'fa690000-0000-4000-8000-000000000091','synthetic_provider','Synthetic.mp4','video','video/mp4','sha256:'||repeat('a',64)||':1',now(),1000);
insert into sma_private.publication_orders_v1(id,user_id,customer_id,binding,draft,choices,target,state)
 values('fa690000-0000-4000-8000-000000000010','fa690000-0000-4000-8000-000000000091',909000000081,
 jsonb_build_object('platform','youtube','media_kind','video','asset_id','fa690000-0000-4000-8000-000000000001','asset_revision','sha256:'||repeat('a',64)||':1'),
 '{"title":"Synthetic","caption":"Synthetic"}','{"visibility":"private","made_for_kids":false,"contains_synthetic_media":false}',
 jsonb_build_object('platform','youtube','id','synthetic_channel','name','Synthetic','source_revision',repeat('b',64)),'prepared');
do $$begin
 assert (select count(*) from sma_private.publication_comparison_queue_v1 where order_id='fa690000-0000-4000-8000-000000000010')=1,'Queue is part of the order transaction';
 assert not has_function_privilege('authenticated','public.sma_publication_provider_v1(text,uuid,uuid,jsonb)','EXECUTE');
 assert not has_table_privilege('authenticated','sma_private.publication_provider_attempts_v1','SELECT,INSERT,UPDATE');
 assert not has_table_privilege('service_role','sma_private.publication_provider_permissions_v1','INSERT,UPDATE,DELETE');
 assert not has_function_privilege('authenticated','public.sma_publication_comparison_delivery_v1(text,uuid,uuid)','EXECUTE');
 assert sma_private.publication_provider_session_valid_v1('youtube','https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=synthetic');
 assert sma_private.publication_provider_session_valid_v1('tiktok','https://open-upload.tiktokapis.com/video/?upload_id=1&upload_token=synthetic');
 assert sma_private.publication_provider_session_valid_v1('tiktok','https://upload.us.tiktokapis.com/video/?upload_id=1&upload_token=synthetic');
 assert not sma_private.publication_provider_session_valid_v1('youtube','https://www.googleapis.com.attacker.invalid/upload/youtube/v3/videos?uploadType=resumable&upload_id=synthetic');
end $$;
set local role service_role;
do $$declare r jsonb;e jsonb;t jsonb;begin
 select target into t from sma_private.publication_orders_v1 where id='fa690000-0000-4000-8000-000000000010';
 e:=jsonb_build_object('version',1,'platform','youtube','target_id',t->>'id','target_revision',t->>'source_revision','display_name','Synthetic','permissions','["youtube.upload"]'::jsonb,'policy','{}'::jsonb,'checked_at',now(),'expires_at',now()+interval '5 minutes');
 perform set_config('sma.provider_input',jsonb_build_object('target',t,'account_check',e,'drive_verified',true,'text_verified',true,'size_bytes',1000)::text,true);
 r:=public.sma_publication_provider_v1('begin','fa690000-0000-4000-8000-000000000010',null,current_setting('sma.provider_input')::jsonb);
 assert r->>'code'='FINAL_APPROVAL_REQUIRED',r::text;
 update sma_private.publication_orders_v1 set approved_at=now(),approval_review='{"policy_version":"media-consent-2026-11-03.1","content_checked":true,"media_rights":true,"music_rights":true,"tiktok_music_terms":false,"tiktok_branded_terms":false}',state='checked' where id='fa690000-0000-4000-8000-000000000010';
 r:=public.sma_publication_provider_v1('begin','fa690000-0000-4000-8000-000000000010',null,current_setting('sma.provider_input')::jsonb);
 assert r->>'code'='PUBLICATION_RESERVATION_REQUIRED';
 insert into sma_private.publication_journal_v1(customer_id,asset_id,asset_revision,platform,target_id,order_id)
 values(909000000081,'fa690000-0000-4000-8000-000000000001','sha256:'||repeat('a',64)||':1','youtube','synthetic_channel','fa690000-0000-4000-8000-000000000010');
 assert public.sma_publication_provider_v1('begin','fa690000-0000-4000-8000-000000000010',null,current_setting('sma.provider_input')::jsonb)->>'code'='UPLOAD_TEST_APPROVAL_REQUIRED';
 assert not exists(select 1 from sma_private.publication_provider_attempts_v1);
end $$;
reset role;
-- State machine isolation: replace only two media/context functions inside this
-- transaction with a synthetic-id assertion. Never install this test as migration.
create or replace function sma_private.publication_order_current_v1(j sma_private.publication_orders_v1)
returns jsonb language plpgsql stable set search_path='' as $$begin
 assert j.customer_id=909000000081;
 return '{"ok":true,"media_check":{"checks":[{"code":"CONTENT_REVIEW_PENDING","status":"pending"}]}}'::jsonb;
end $$;
insert into sma_private.publication_provider_permissions_v1(order_id,fingerprint,expires_at)
select id,sma_private.publication_provider_fingerprint_v1(j),now()+interval '15 minutes' from sma_private.publication_orders_v1 j where id='fa690000-0000-4000-8000-000000000010';
set local role service_role;
do $$begin
 assert public.sma_publication_provider_v1('begin','fa690000-0000-4000-8000-000000000010',null,current_setting('sma.provider_input')::jsonb)->>'code'='MEDIA_REVIEW_REQUIRED';
 assert not exists(select 1 from sma_private.publication_provider_attempts_v1);
end $$;
reset role;
create or replace function sma_private.publication_order_media_v1(j sma_private.publication_orders_v1,media jsonb,evidence jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$begin
 assert j.customer_id=909000000081;
 return '{"checks":[{"code":"PORTAL_TEXT_COMPARISON","status":"pass"}]}'::jsonb;
end $$;
set local role service_role;
do $$declare r jsonb;l uuid;old_l uuid;o constant uuid:='fa690000-0000-4000-8000-000000000010';d jsonb:=current_setting('sma.provider_input')::jsonb;obs jsonb;begin
 assert public.sma_publication_provider_v1('begin',o,null,d||'{"size_bytes":1001}')->>'code'='FILE_CHANGED';
 r:=public.sma_publication_provider_v1('begin',o,null,d);assert r->>'operation'='init',r::text;l:=(r->>'lease_id')::uuid;
 assert public.sma_publication_provider_v1('begin',o,null,d)->>'code'='PROVIDER_RUNNING';
 assert public.sma_publication_provider_v1('finish',o,gen_random_uuid(),'{"state":"uncertain"}')->>'code'='INVALID_LEASE';
 assert public.sma_publication_provider_v1('finish',o,l,'{"state":"complete"}')->>'code'='INVALID_RESULT';
 r:=public.sma_publication_provider_v1('finish',o,l,jsonb_build_object('state','session_ready','session_url','https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=synthetic','session_expires_at',to_char(now()+interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
 assert r->>'state'='session_ready',r::text;
 assert public.sma_publication_provider_v1('finish',o,l,'{"state":"uncertain"}')->>'code'='INVALID_LEASE';
 r:=public.sma_publication_provider_v1('begin',o,null,d);assert r->>'operation'='upload';old_l:=(r->>'lease_id')::uuid;
 -- Crash after send: expired lease MUST select probe, never upload or init.
 update sma_private.publication_provider_attempts_v1 set lease_until=now()-interval '1 second' where order_id=o;
 r:=public.sma_publication_provider_v1('begin',o,null,d);assert r->>'operation'='probe',r::text;l:=(r->>'lease_id')::uuid;
 assert public.sma_publication_provider_v1('finish',o,old_l,'{"state":"processing","provider_id":"synthetic_1"}')->>'code'='INVALID_LEASE';
 assert public.sma_publication_provider_v1('finish',o,l,'{"state":"uploading","received_bytes":600}')->>'state'='uploading';
 r:=public.sma_publication_provider_v1('begin',o,null,d);assert r->>'operation'='upload' and r->>'received_bytes'='600';l:=(r->>'lease_id')::uuid;
 assert public.sma_publication_provider_v1('finish',o,l,'{"state":"processing","provider_id":"synthetic_1"}')->>'state'='processing';
 assert public.sma_publication_provider_v1('begin',o,null,d)->>'code'='PROVIDER_POLL_WAIT';
 update sma_private.publication_provider_attempts_v1 set updated_at=now()-interval '11 seconds' where order_id=o;
 r:=public.sma_publication_provider_v1('begin',o,null,d);assert r->>'operation'='status';l:=(r->>'lease_id')::uuid;
 obs:='{"platform":"youtube","target_id":"synthetic_channel","provider_id":"synthetic_1","route":"youtube_video","expected_visibility":"private","state":"complete","visibility":"private","publicly_available":false,"url":"https://www.youtube.com/watch?v=synthetic_1","upload_retry_allowed":false,"can_upload":false,"can_publish":false}';
 assert public.sma_publication_provider_v1('finish',o,l,jsonb_build_object('state','complete','observation',obs||'{"target_id":"other"}'))->>'code'='INVALID_RESULT';
 assert public.sma_publication_provider_v1('finish',o,l,jsonb_build_object('state','complete','observation',obs))->>'state'='complete';
 assert (select count(*) from sma_private.publication_provider_attempts_v1 where order_id=o)=1;
 assert (select count(*) from sma_private.publication_provider_events_v1 where order_id=o and operation='init')=1;
 assert not exists(select 1 from sma_private.publication_provider_events_v1 where outcome::text like '%upload_id%');
 -- Changed immutable selection may not inherit a previous attempt.
 update sma_private.publication_orders_v1 set draft=draft||'{"title":"changed"}' where id=o;
 assert public.sma_publication_provider_v1('context',o)->>'code'='ORDER_CHANGED';
end $$;
reset role;
-- TikTok: lost initialization never creates another request, while a late
-- response may still bind the same intent. Status-only recovery preserves int64 IDs.
insert into sma_private.publication_orders_v1(id,user_id,customer_id,binding,draft,choices,target,state,approved_at,approval_review)
select 'fa690000-0000-4000-8000-000000000020',user_id,customer_id,binding||'{"platform":"tiktok"}',draft,
'{"visibility":"PUBLIC_TO_EVERYONE","disable_comment":true,"disable_duet":true,"disable_stitch":true,"brand_content_toggle":false,"brand_organic_toggle":false}',
target||'{"platform":"tiktok","id":"synthetic_creator"}','checked',now(),approval_review||'{"tiktok_music_terms":true}'
from sma_private.publication_orders_v1 where id='fa690000-0000-4000-8000-000000000010';
insert into sma_private.publication_journal_v1(customer_id,asset_id,asset_revision,platform,target_id,order_id)
values(909000000081,'fa690000-0000-4000-8000-000000000001','sha256:'||repeat('a',64)||':1','tiktok','synthetic_creator','fa690000-0000-4000-8000-000000000020');
insert into sma_private.publication_provider_permissions_v1(order_id,fingerprint,expires_at)
select id,sma_private.publication_provider_fingerprint_v1(j),now()+interval '15 minutes' from sma_private.publication_orders_v1 j where id='fa690000-0000-4000-8000-000000000020';
set local role service_role;
do $$declare o constant uuid:='fa690000-0000-4000-8000-000000000020';r jsonb;t jsonb;e jsonb;d jsonb;l uuid;obs jsonb;begin
 select target into t from sma_private.publication_orders_v1 where id=o;
 e:=jsonb_build_object('version',1,'platform','tiktok','target_id',t->>'id','target_revision',t->>'source_revision','display_name','Synthetic','permissions','["video.publish","user.info.basic"]'::jsonb,
 'policy','{"privacy_levels":["SELF_ONLY","PUBLIC_TO_EVERYONE"],"comment_disabled":true,"duet_disabled":true,"stitch_disabled":true,"max_duration_sec":600}'::jsonb,'checked_at',now(),'expires_at',now()+interval '5 minutes');
 d:=jsonb_build_object('target',t,'account_check',e,'drive_verified',true,'text_verified',true,'size_bytes',1000);
 r:=public.sma_publication_provider_v1('begin',o,null,d);assert r->>'operation'='init';l:=(r->>'lease_id')::uuid;
 update sma_private.publication_provider_attempts_v1 set lease_until=now()-interval '1 second' where order_id=o;
 assert public.sma_publication_provider_v1('begin',o,null,d)->>'code'='PROVIDER_INIT_UNCERTAIN';
 assert (select count(*) from sma_private.publication_provider_events_v1 where order_id=o)=1;
 r:=public.sma_publication_provider_v1('finish',o,l,jsonb_build_object('state','session_ready','provider_id','v_pub_file~synthetic','session_url','https://open-upload.tiktokapis.com/video/?upload_id=1&upload_token=synthetic','session_expires_at',to_char(now()+interval '55 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
 assert r->>'state'='session_ready',r::text;
 r:=public.sma_publication_provider_v1('begin',o,null,d);assert r->>'operation'='upload';
 update sma_private.publication_provider_attempts_v1 set lease_until=now()-interval '1 second',updated_at=now()-interval '11 seconds' where order_id=o;
 r:=public.sma_publication_provider_v1('begin',o,null,d);assert r->>'operation'='status';l:=(r->>'lease_id')::uuid;
 obs:='{"platform":"tiktok","target_id":"synthetic_creator","provider_id":"v_pub_file~synthetic","route":"direct_post","expected_visibility":"PUBLIC_TO_EVERYONE","state":"complete","publicly_available":null,"public_post_ids":[],"upload_retry_allowed":false,"can_upload":false,"can_publish":false}';
 assert public.sma_publication_provider_v1('finish',o,l,jsonb_build_object('state','complete','observation',obs))->>'state'='complete';
 update sma_private.publication_provider_attempts_v1 set updated_at=now()-interval '11 seconds' where order_id=o;
 r:=public.sma_publication_provider_v1('begin',o,null,d);l:=(r->>'lease_id')::uuid;assert r->>'operation'='status';
 r:=public.sma_publication_provider_v1('finish',o,l,jsonb_build_object('state','complete','observation',obs||'{"public_post_ids":["9223372036854775807"],"publicly_available":true}'));
 assert r#>>'{result,public_post_ids,0}'='9223372036854775807';
 update sma_private.publication_provider_attempts_v1 set updated_at=now()-interval '11 seconds' where order_id=o;
 r:=public.sma_publication_provider_v1('begin',o,null,d);l:=(r->>'lease_id')::uuid;
 r:=public.sma_publication_provider_v1('finish',o,l,jsonb_build_object('state','complete','observation',obs));
 assert r#>>'{result,public_post_ids,0}'='9223372036854775807' and r#>>'{result,publicly_available}'='true';
 assert (select count(*) from sma_private.publication_provider_events_v1 where order_id=o and operation='init')=1;
 assert (select count(*) from sma_private.publication_provider_events_v1 where order_id=o and operation='upload')=1;
end $$;
reset role;
rollback;
select 'Provider consent/media/role gates, atomic intent, lost responses, fenced leases, probe-before-resume, exact remainder, private result and no second init passed; fixtures rolled back' result;
