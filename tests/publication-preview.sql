begin;
do $$
declare
 r jsonb; lease uuid; p jsonb; saved jsonb;
 id1 uuid := 'e6a78543-9b54-4af6-802f-017d6cba0001';
 inp jsonb := '{"request_id":"e6a78543-9b54-4af6-802f-017d6cba0001","source_text":"SMA Testprodukt 2 ist ein Testartikel für den Shop-Ablauf.","audience":"SMA Testkunden","goal":"Shop-Ablauf kennenlernen","language":"de","media_kind":"video","platforms":["youtube","tiktok"]}';
begin
 assert not has_function_privilege('anon','public.sma_publication_preview_v1(text,jsonb,uuid)','execute');
 assert not has_function_privilege('authenticated','public.sma_publication_preview_finish_v1(uuid,uuid,jsonb,text)','execute');
 assert not has_table_privilege('authenticated','sma_private.publication_previews_v1','select');
 assert not has_table_privilege('authenticated','sma_private.publication_previews_v1','insert');
 perform set_config('request.jwt.claim.sub','',true);
 r:=public.sma_publication_preview_v1('latest'); assert r->>'code'='AUTH_REQUIRED';
 perform set_config('request.jwt.claim.sub','20be25c6-a763-4981-a25a-d503e32e4e25',true);
 r:=public.sma_publication_preview_v1('prepare',inp||'{"shop_url":"https://evil.com"}'); assert r->>'code'='INVALID_INPUT';
 r:=public.sma_publication_preview_v1('prepare',inp||'{"media_kind":"image"}'); assert r->>'code'='YOUTUBE_REQUIRES_VIDEO';
 r:=public.sma_publication_preview_v1('prepare',inp); assert (r->>'start_generation')::boolean; assert r->>'shop_url'='https://sma-automation.com/app/shop.html?shop=sma-testkunde'; lease:=(r->>'lease_id')::uuid;
 r:=public.sma_publication_preview_v1('prepare',inp); assert r->'start_generation'='false'; assert not r ? 'lease_id';
 r:=public.sma_publication_preview_v1('prepare',inp||'{"goal":"anderes Ziel"}'); assert r->>'code'='REQUEST_CONFLICT';
 r:=public.sma_publication_preview_v1('prepare',inp||'{"request_id":"e6a78543-9b54-4af6-802f-017d6cba0002"}'); assert r->>'code'='PREPARATION_RUNNING';
 r:=public.sma_publication_preview_v1('get','{}',id1); assert r->>'status'='processing'; assert not r ? 'lease_id';
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 r:=public.sma_publication_preview_v1('get','{}',id1); assert r->>'code'='ACCOUNT_UNAVAILABLE';
 perform set_config('request.jwt.claim.sub','20be25c6-a763-4981-a25a-d503e32e4e25',true);
 p:='{"stage":"text_preview","can_publish":false,"shop_url":"https://sma-automation.com/app/shop.html?shop=sma-testkunde","drafts":[{"platform":"youtube","title":"Testtitel","body":"Ein sachlicher Testtext.","hashtags":["Test"],"caption":"Test","review_notes":[]},{"platform":"tiktok","title":"Testtitel","body":"Ein sachlicher Testtext.","hashtags":[],"caption":"Test","review_notes":[]}]}';
 r:=public.sma_publication_preview_finish_v1(id1,gen_random_uuid(),p); assert r->>'code'='INVALID_LEASE';
 r:=public.sma_publication_preview_finish_v1(id1,lease,p); assert r->>'status'='completed';
 r:=public.sma_publication_preview_finish_v1(id1,lease,p); assert r->>'code'='INVALID_LEASE';
 saved:=jsonb_build_object('revision',1,'drafts',p->'drafts');
 r:=public.sma_publication_preview_v1('save',saved,id1); assert r->>'revision'='2'; assert r->'preview'->'drafts'->0->>'caption'=E'Ein sachlicher Testtext.\n\n#Test\n\n🛒 Zum Shop: https://sma-automation.com/app/shop.html?shop=sma-testkunde';
 assert r->'preview'->'drafts'->1->>'caption'=E'Ein sachlicher Testtext.\n\n🛒 Zum Shop: https://sma-automation.com/app/shop.html?shop=sma-testkunde';
 r:=public.sma_publication_preview_v1('save',saved,id1); assert r->>'code'='REVISION_CONFLICT';
 saved:=jsonb_set(saved,'{revision}','2');saved:=jsonb_set(saved,'{drafts,0,body}','"Bitte https://evil.com besuchen"');
 r:=public.sma_publication_preview_v1('save',saved,id1); assert r->>'code'='INVALID_EDIT';
 r:=public.sma_publication_preview_v1('prepare',inp||'{"request_id":"e6a78543-9b54-4af6-802f-017d6cba0002"}'); assert r->>'code'='RATE_LIMITED';
end $$;
rollback;
select 'publication preview: auth, ownership, idempotency, lease, revision and link tests passed' as result;
