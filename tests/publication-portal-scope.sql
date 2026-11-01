begin;
insert into sma_private.publication_previews_v1(id,user_id,customer_id,created_at,input,shop_url,status,preview) values
('0a15b670-9f01-40ec-88cd-8d8c5d100001','20be25c6-a763-4981-a25a-d503e32e4e25',4,now()+interval '10 seconds','{"platforms":["youtube"]}','https://sma-automation.com/app/shop.html?shop=sma-testkunde','completed','{}'),
('0a15b670-9f01-40ec-88cd-8d8c5d100002','20be25c6-a763-4981-a25a-d503e32e4e25',4,now()+interval '20 seconds','{"platforms":["tiktok"]}','https://sma-automation.com/app/shop.html?shop=sma-testkunde','completed','{}'),
('0a15b670-9f01-40ec-88cd-8d8c5d100003','00000000-0000-4000-8000-000000000002',4,now()+interval '30 seconds','{"platforms":["youtube"]}','https://sma-automation.com/app/shop.html?shop=foreign','completed','{}');
set local role authenticated;
select set_config('request.jwt.claim.sub','20be25c6-a763-4981-a25a-d503e32e4e25',true);
do $$ declare r jsonb; begin
 r:=public.sma_publication_preview_v1('latest','{"platform":"youtube"}');assert r->>'id'='0a15b670-9f01-40ec-88cd-8d8c5d100001';
 r:=public.sma_publication_preview_v1('latest','{"platform":"tiktok"}');assert r->>'id'='0a15b670-9f01-40ec-88cd-8d8c5d100002';
 r:=public.sma_publication_preview_v1('latest','{}');assert r->>'id'='0a15b670-9f01-40ec-88cd-8d8c5d100002';
 r:=public.sma_publication_preview_v1('latest','{"platform":"other"}');assert r->>'code'='INVALID_PLATFORMS';
 r:=public.sma_publication_preview_v1('latest','{"platform":null}');assert r->>'code'='INVALID_PLATFORMS';
end $$;
rollback;
select 'Portal-specific latest previews, legacy access and tenant isolation passed' as result;
