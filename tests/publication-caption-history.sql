begin;
do $$
declare
  uid uuid := '20be25c6-a763-4981-a25a-d503e32e4e25';
  cid bigint; shop text; p jsonb; r jsonb; lease uuid; n integer;
  id1 uuid := 'e6a78543-9b54-4af6-802f-017d6cba1101';
  id2 uuid := 'e6a78543-9b54-4af6-802f-017d6cba1102';
  id3 uuid := 'e6a78543-9b54-4af6-802f-017d6cba1103';
  body1 text := 'Die indigoblaue Keramikschale steht auf dem Eichentisch neben dem Fenster.';
  body2 text := 'Warme Sonnenstrahlen fallen auf einen von Hand geflochtenen Weidenkorb.';
  inp jsonb := '{"source_text":"Eine neutrale Funktionsprobe für den gespeicherten Textverlauf.","audience":"SMA Testkunden","goal":"Textverlauf prüfen","language":"de","media_kind":"video","platforms":["youtube"]}';
begin
  select id,'https://sma-automation.com/app/shop.html?shop='||shop_slug into strict cid,shop from public.sma_kunden where user_id=uid;
  assert not has_table_privilege('authenticated','sma_private.publication_caption_history_v1','select');
  assert not has_table_privilege('anon','sma_private.publication_caption_history_v1','insert');
  assert not has_table_privilege('service_role','sma_private.publication_caption_history_v1','update');
  assert not has_function_privilege('authenticated','sma_private.publication_caption_guard_v1()','execute');
  assert sma_private.publication_caption_normalize_v1(U&'ＡＢＣ Str\00ADaße 😀!')='abc strasse';
  assert sma_private.publication_caption_similar_v1(body1,upper(body1)||' 😀!');
  assert sma_private.publication_caption_similar_v1(body1,replace(body1,'Keramikschale','Keramikschale heute'));
  assert not sma_private.publication_caption_similar_v1(body1,body2);
  p:=jsonb_build_object('stage','text_preview','can_publish',false,'shop_url',shop,'drafts',jsonb_build_array(jsonb_build_object('platform','youtube','title','Testtitel','body',body1,'hashtags','[]'::jsonb,'caption',body1,'review_notes','[]'::jsonb)));
  insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,preview)
  values(id1,uid,cid,inp||jsonb_build_object('request_id',id1),shop,'completed',p);
  assert (select count(*)=1 from sma_private.publication_caption_history_v1 where preview_id=id1);
  insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url)
  values(id2,uid,cid,inp||jsonb_build_object('request_id',id2),shop) returning lease_id into lease;
  r:=public.sma_publication_preview_finish_v1(id2,lease,p);
  assert r->>'code'='CAPTION_TOO_SIMILAR', r::text;
  assert (select status='failed' and error_code='CAPTION_TOO_SIMILAR' from sma_private.publication_previews_v1 where id=id2);
  assert not exists(select 1 from sma_private.publication_caption_history_v1 where preview_id=id2);
  p:=jsonb_set(p,'{drafts,0,body}',to_jsonb(body2));
  insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,preview)
  values(id3,uid,cid,inp||jsonb_build_object('request_id',id3),shop,'completed',p);
  perform set_config('request.jwt.claim.sub',uid::text,true);
  r:=public.sma_publication_preview_v1('save',jsonb_build_object('revision',1,'drafts',jsonb_set(p->'drafts','{0,body}',to_jsonb(body1))),id3);
  assert r->>'code'='CAPTION_TOO_SIMILAR',r::text;
  assert (select revision=1 and preview->'drafts'->0->>'body'=body2 from sma_private.publication_previews_v1 where id=id3);
  r:=public.sma_publication_preview_v1('save',jsonb_build_object('revision',1,'drafts',p->'drafts'),id3);
  assert r->>'revision'='2',r::text;
  assert (select count(*)=2 from sma_private.publication_caption_history_v1 where preview_id=id3);
  -- Existing request identity returns its saved text; does not reserve another history item.
  r:=public.sma_publication_preview_v1('prepare',inp||jsonb_build_object('request_id',id1));
  assert r->'start_generation'='false'::jsonb and r->>'id'=id1::text,r::text;
  assert not r ? 'caption_history';
  -- New request gets only its own recent history. Browser cannot supply history.
  r:=public.sma_publication_preview_v1('prepare',inp||jsonb_build_object('request_id','e6a78543-9b54-4af6-802f-017d6cba1104','caption_history','[]'::jsonb));
  assert r->>'code'='INVALID_INPUT';
  r:=public.sma_publication_preview_v1('prepare',inp||jsonb_build_object('request_id','e6a78543-9b54-4af6-802f-017d6cba1104'));
  assert r->'start_generation'='true'::jsonb,r::text;
  assert r->'caption_history'->>'scope'='saved_previews';
  assert jsonb_array_length(r->'caption_history'->'previous_bodies')<=20;
  assert exists(select 1 from jsonb_array_elements(r->'caption_history'->'previous_bodies') h where h->>'body'=body1);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
  r:=public.sma_publication_preview_v1('get','{}',id1);
  assert r->>'code'='ACCOUNT_UNAVAILABLE' and not r ? 'caption_history';
end $$;
rollback;
select 'caption history: normalization, similarity, atomic rejection, editing, history persistence, retry and ownership passed' as result;
