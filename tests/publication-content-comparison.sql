-- Synthetic identities and assets only. No login/session is created; all rows roll back.
begin;
do $$begin
 assert not exists(select 1 from public.sma_kunden where id in (909000000071,909000000072) or user_id in ('fa680000-0000-4000-8000-000000000091','fa680000-0000-4000-8000-000000000092'));
end $$;
insert into public.sma_kunden(id,user_id,n8n_kunde_id,kunde_email,aktiv,demo_delta_aktiv)
values(909000000071,'fa680000-0000-4000-8000-000000000091','synthetic-video-owner','video-owner@example.invalid',true,true),
(909000000072,'fa680000-0000-4000-8000-000000000092','synthetic-other-owner','other-owner@example.invalid',true,true);
insert into sma_private.publication_files_v1(id,customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,width_px,height_px,duration_ms)
values('fa680000-0000-4000-8000-000000000001',909000000071,'fa680000-0000-4000-8000-000000000091','synthetic_video_fixture','Synthetic.mp4','video','video/mp4','sha256:'||repeat('a',64)||':1',now(),1000,720,1280,10000);
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
do $$begin assert public.sma_publication_video_magic_v1('get','{}')->>'code'='AUTH_REQUIRED';end $$;
select set_config('request.jwt.claim.sub','fa680000-0000-4000-8000-000000000092',true);
do $$declare r jsonb;begin
 r:=public.sma_publication_video_magic_v1('get',jsonb_build_object('asset_id','fa680000-0000-4000-8000-000000000001','asset_revision','sha256:'||repeat('a',64)||':1'));
 assert r->>'code'='FILE_UNAVAILABLE';assert not(r?'analysis');
end $$;
select set_config('request.jwt.claim.sub','fa680000-0000-4000-8000-000000000091',true);
do $$declare r jsonb;i jsonb:=jsonb_build_object('asset_id','fa680000-0000-4000-8000-000000000001','asset_revision','sha256:'||repeat('a',64)||':1');begin
 assert not has_function_privilege('anon','public.sma_publication_video_magic_v1(text,jsonb)','EXECUTE');
 assert not has_function_privilege('authenticated','public.sma_publication_video_magic_finish_v1(uuid,uuid,jsonb,text,text)','EXECUTE');
 assert not has_table_privilege('authenticated','sma_private.publication_magic_results_v1','SELECT,INSERT,UPDATE');
 assert public.sma_publication_video_magic_v1('get',i||'{"customer_id":909000000072}')->>'code'='INVALID_INPUT';
 r:=public.sma_publication_video_magic_v1('get',i);assert r->'analysis'->>'status'='unrecognized';
 r:=public.sma_publication_video_magic_v1('start',i);assert r->>'ok'='true',r::text;assert r->>'lease_id' is not null;
 r:=public.sma_publication_video_magic_v1('start',i);assert r->'analysis'->>'status'='processing';assert not(r?'lease_id');
end $$;
reset role;
set local role service_role;
do $$declare r jsonb;l uuid;res jsonb;f sma_private.publication_files_v1%rowtype;q jsonb;begin
 select lease_id into l from sma_private.publication_magic_results_v1 where asset_id='fa680000-0000-4000-8000-000000000001';
 res:=jsonb_build_object('policy_version','magic-video-2026-11-03.1','subject_type','other','description','Ein blaues Quadrat bewegt sich von links nach rechts.','spoken_summary','',
 'observations',jsonb_build_array('Ein blaues Quadrat'),'visible_text','[]'::jsonb,'uncertainties','[]'::jsonb,'transcript','','audio_status','no_audio_stream',
 'evidence',jsonb_build_object('source_sha256',repeat('a',64),'source_size_bytes',1000,'duration_ms',10000,'positions_ms',jsonb_build_array(0,9850),'frame_sha256',jsonb_build_array(repeat('b',64),repeat('c',64)),'sampling','representative_frames_not_full_moderation'),
 'content_comparison','model_checked_sampled_evidence','requires_confirmation',true,'can_publish',false);
 res:=jsonb_set(res,'{evidence,technical}', '{"schema":"sma-video-technical-v1","decode":"complete","video_codec":"h264","pixel_format":"yuv420p","width_px":720,"height_px":1280,"frame_rate_num":25,"frame_rate_den":1,"decoded_frames":250,"min_frame_interval_us":40000,"max_frame_interval_us":40000,"video_bit_rate_bps":100000,"audio_codec":null,"audio_sample_rate_hz":null,"audio_channels":null,"audio_bit_rate_bps":null}'::jsonb);
 perform set_config('sma.test_video_result',res::text,true);
 assert public.sma_publication_video_magic_finish_v1('fa680000-0000-4000-8000-000000000001',null,res,repeat('a',64))->>'code'='INVALID_LEASE';
 assert public.sma_publication_video_magic_finish_v1('fa680000-0000-4000-8000-000000000001',l,res,repeat('b',64))->>'code'='INVALID_RESULT';
 foreach r in array array[res#-'{evidence,technical}',jsonb_set(res,'{evidence,technical,decode}','"partial"'),jsonb_set(res,'{evidence,technical,audio_codec}','"aac"'),res||'{"source_text":"caller text"}',res||'{"can_publish":true}',res||'{"transcript":"invented speech"}',res||'{"audio_status":"transcribed"}',jsonb_set(res,'{evidence,positions_ms}','[0,0]'),jsonb_set(res,'{evidence,source_sha256}',to_jsonb(repeat('d',64))),res||'{"subject_type":"unclear"}'] loop
  assert public.sma_publication_video_magic_finish_v1('fa680000-0000-4000-8000-000000000001',l,r,repeat('a',64))->>'code'='INVALID_RESULT';
 end loop;
 r:=public.sma_publication_video_magic_finish_v1('fa680000-0000-4000-8000-000000000001',l,res,repeat('a',64));
 assert r->>'ok'='true',r::text;assert r->'analysis'->'result'->>'source_text' like '%keine Tonspur%';
 assert r->'analysis'->'result'->>'can_publish'='false';
 assert public.sma_publication_video_magic_finish_v1('fa680000-0000-4000-8000-000000000001',l,res,repeat('a',64))->>'code'='INVALID_LEASE';
 assert (select attempts from sma_private.publication_magic_rate_v1 where user_id='fa680000-0000-4000-8000-000000000091')=1;
 select * into f from sma_private.publication_files_v1 where id='fa680000-0000-4000-8000-000000000001';
 assert sma_private.publication_video_technical_v1(f)=res->'evidence'->'technical';
 q:=sma_private.publication_media_precheck_v1(f,'tiktok');
 assert q->'checks' @> '[{"code":"BINARY_INSPECTION","status":"pass"},{"code":"VIDEO_FRAMERATE","status":"pass"},{"code":"VIDEO_CODEC","status":"pass"}]';
 assert q->'checks' @> '[{"code":"CONTENT_REVIEW_PENDING","status":"pending"},{"code":"PUBLICATION_APPROVAL_PENDING","status":"pending"}]';
 assert q->'can_publish'='false' and q->>'status'='needs_review';
 update sma_private.publication_magic_results_v1 set result=jsonb_set(result,'{evidence,technical,max_frame_interval_us}','80000') where asset_id=f.id;
 q:=sma_private.publication_media_precheck_v1(f,'tiktok');
 assert q->'checks' @> '[{"code":"VIDEO_FRAMERATE","status":"fail"}]' and q->>'status'='needs_changes','Variable timing outside the allowed range cannot inherit an average-rate pass';
 update sma_private.publication_magic_results_v1 set result=jsonb_set(result,'{evidence,technical,frame_rate_den}','0') where asset_id=f.id;
 assert sma_private.publication_video_technical_v1(f) is null;
 update sma_private.publication_magic_results_v1 set result=res where asset_id=f.id;
 f.revision:='sha256:'||repeat('a',64)||':2';assert sma_private.publication_video_technical_v1(f) is null;
 f.revision:='sha256:'||repeat('a',64)||':1';f.user_id:='fa680000-0000-4000-8000-000000000092';assert sma_private.publication_video_technical_v1(f) is null;
 f.user_id:='fa680000-0000-4000-8000-000000000091';f.size_bytes:=1001;assert sma_private.publication_video_technical_v1(f) is null;
 f.size_bytes:=1000;
 update sma_private.publication_magic_results_v1 set policy_version='magic-video-2026-11-02.1' where asset_id=f.id;
 assert sma_private.publication_video_technical_v1(f) is null,'An old cached analysis is never promoted to a technical inspection';
 update sma_private.publication_magic_results_v1 set policy_version='magic-video-2026-11-03.1' where asset_id=f.id;

end $$;
reset role;
update public.sma_kunden set shop_oeffentlich=true,shop_slug='synthetic-comparison' where id=909000000071;
insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,preview)
values('fa680000-0000-4000-8000-000000000003','fa680000-0000-4000-8000-000000000091',909000000071,
'{"platforms":["youtube"],"media_kind":"video","language":"de"}','https://sma-automation.com/app/shop.html?shop=synthetic-comparison','completed',
jsonb_build_object('can_publish',false,'drafts',jsonb_build_array(jsonb_build_object('platform','youtube','title','Blaues Quadrat','body','Ein blaues Quadrat bewegt sich.','caption',E'Ein blaues Quadrat bewegt sich.\n\n🛒 Zum Shop: https://sma-automation.com/app/shop.html?shop=synthetic-comparison','hashtags','[]'::jsonb,'review_notes','[]'::jsonb))));
insert into sma_private.publication_assignments_v1(asset_id,platform,preview_id,preview_revision,asset_revision,draft)
select 'fa680000-0000-4000-8000-000000000001','youtube',id,revision,'sha256:'||repeat('a',64)||':1',preview->'drafts'->0 from sma_private.publication_previews_v1 where id='fa680000-0000-4000-8000-000000000003';
set local role service_role;
do $$declare b jsonb;r jsonb;c jsonb;l uuid;res jsonb;bad jsonb;m jsonb;j sma_private.publication_orders_v1%rowtype;f sma_private.publication_files_v1%rowtype;begin
 b:=jsonb_build_object('version',1,'customer_id',909000000071,'drive_file_id','synthetic_video_fixture','asset_id','fa680000-0000-4000-8000-000000000001','asset_revision','sha256:'||repeat('a',64)||':1','media_kind','video','platform','youtube','assignment_revision',1,'preview_id','fa680000-0000-4000-8000-000000000003','preview_revision',1,'shop_url','https://sma-automation.com/app/shop.html?shop=synthetic-comparison');
 assert not has_function_privilege('authenticated','public.sma_publication_comparison_v1(text,jsonb,uuid,jsonb)','EXECUTE');
 assert not has_function_privilege('anon','public.sma_publication_comparison_context_v1(jsonb)','EXECUTE');
 assert not has_table_privilege('authenticated','sma_private.publication_comparisons_v1','SELECT,INSERT,UPDATE');
 assert public.sma_publication_comparison_v1('get',b)->>'state'='unreviewed';
 c:=public.sma_publication_comparison_v1('start',b);assert c->>'state'='processing',c::text;l:=(c->>'lease_id')::uuid;
 assert public.sma_publication_comparison_v1('start',b)->>'code'='COMPARISON_ALREADY_ATTEMPTED';
 res:=jsonb_build_object('policy_version','portal-content-2026-11-03.1','scope','stored_video_observations_ocr_transcript','source_fingerprint',c->>'source_fingerprint','verdict','consistent_with_evidence','issues','[]'::jsonb,'can_upload',false,'can_publish',false);
 foreach bad in array array[res||'{"can_upload":true}',res||'{"scope":"full_video"}',res||'{"verdict":"needs_review"}',res||jsonb_build_object('source_fingerprint',repeat('f',64)),res||'{"extra":true}'] loop
  assert public.sma_publication_comparison_v1('finish',b,l,bad)->>'code'='INVALID_RESULT';
 end loop;
 assert public.sma_publication_comparison_v1('finish',b,null,res)->>'code'='INVALID_LEASE';
 assert public.sma_publication_comparison_v1('finish',b,l,res)->>'state'='completed';
 assert public.sma_publication_comparison_v1('start',b)->'result'=res;
 assert public.sma_publication_comparison_v1('finish',b,l,res)->>'code'='INVALID_LEASE';
 select * into f from sma_private.publication_files_v1 where id=(b->>'asset_id')::uuid;
 assert sma_private.publication_media_precheck_v1(f,'youtube')->'checks' @> '[{"code":"SEMANTIC_REVIEW_PENDING","status":"pending"},{"code":"CONTENT_REVIEW_PENDING","status":"pending"}]';
 m:=sma_private.publication_media_precheck_v1(f,'youtube');j.binding:=b;j.draft:=c->'draft';
 r:=sma_private.publication_order_media_v1(j,m,null);
 assert r->'checks' @> '[{"code":"PORTAL_TEXT_COMPARISON","status":"pass"}]';
 assert (r->'checks') @> (m->'checks') and r->'can_publish'='false';
 assert sma_private.publication_comparison_media_v1(b,'{}',m)=m,'A different draft must not inherit a cached comparison';
 assert not has_function_privilege('authenticated','sma_private.publication_comparison_media_v1(jsonb,jsonb,jsonb)','EXECUTE');
 update sma_private.publication_comparisons_v1 set result=res||'{"verdict":"needs_review","issues":[{"field":"title","quote":"Blaues Quadrat","reason":"Synthetische offene Rückfrage"}]}' where source_fingerprint=c->>'source_fingerprint';
 r:=sma_private.publication_order_media_v1(j,m,null);
 assert r->'checks' @> '[{"code":"PORTAL_TEXT_COMPARISON","status":"pending"},{"code":"SEMANTIC_REVIEW_PENDING","status":"pending"},{"code":"CONTENT_REVIEW_PENDING","status":"pending"}]';
 assert (r->'checks') @> (m->'checks') and r->'can_publish'='false';
 assert sma_private.publication_comparison_media_v1(b,c->'draft',r)=r,'Projection must not duplicate the check';
 assert public.sma_publication_comparison_v1('get',b||'{"customer_id":909000000072}')->>'ok'='false';
 assert public.sma_publication_comparison_v1('get',b||'{"preview_revision":2}')->>'code'='ASSIGNMENT_CHANGED';
 assert public.sma_publication_comparison_v1('get',b||'{"platform":"facebook"}')->>'code'='INVALID_INPUT';
 update sma_private.publication_magic_results_v1 set result=jsonb_set(result,'{description}','"Eine andere gespeicherte Beschreibung des Videos."') where asset_id=f.id;
 assert public.sma_publication_comparison_v1('get',b)->>'state'='unreviewed';
 assert sma_private.publication_order_media_v1(j,m,null)=m,'Changed evidence must not display the old result';
 update sma_private.publication_files_v1 set verified_at=now()-interval '16 minutes' where id=f.id;
 assert public.sma_publication_comparison_v1('get',b)->>'code'='FILE_CHANGED';
end $$;
reset role;
rollback;
select 'Comparison ownership, source/text revisions, lease, replay, invalid model result, private roles and preserved media gates passed; fixtures rolled back' result;
