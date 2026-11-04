-- Run through run-website-domain-sql.mjs in the isolated local fixture database.
begin;
insert into public.sma_kunden(id,user_id,paket,aktiv,demo_delta_aktiv,zahlung_bestaetigt,shop_slug,shop_oeffentlich) values
 (-909000001001,'fa660000-0000-4000-8000-000000000091','delta',true,false,true,'fixture-shop',true),
 (-909000001002,'fa660000-0000-4000-8000-000000000092','alpha',true,false,true,null,false),
 (-909000001003,'fa660000-0000-4000-8000-000000000093',null,true,true,false,null,false),
 (-909000001004,'fa660000-0000-4000-8000-000000000094','delta',false,false,true,null,false);
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
do $$begin
 assert public.sma_website_preparation_v1('get')->>'code'='AUTH_REQUIRED';
 assert not has_function_privilege('anon','public.sma_website_preparation_v1(text,jsonb)','EXECUTE');
 assert not has_function_privilege('service_role','public.sma_website_preparation_v1(text,jsonb)','EXECUTE');
 assert not has_table_privilege('authenticated','sma_private.website_preparations_v1','SELECT,INSERT,UPDATE,DELETE');
 assert not has_function_privilege('authenticated','sma_private.website_domain_valid_v1(text)','EXECUTE');
end $$;
select set_config('request.jwt.claim.sub','fa660000-0000-4000-8000-000000000091',true);
do $$declare r jsonb;p jsonb;bad text;begin
 r:=public.sma_website_preparation_v1('get');
 assert r->>'revision'='0' and r->'draft'='null'::jsonb and r->>'can_publish'='false';
 assert r->>'shop_url'='https://sma-automation.com/app/shop.html?shop=fixture-shop';
 assert public.sma_website_preparation_v1('get','{"customer_id":-909000001003}')->>'code'='INVALID_INPUT';
 p:='{"mode":"existing","website_url":"https://example.com/","desired_domain":"firma.at","expected_revision":0,"request_id":"a1000000-0000-4000-8000-000000000001"}';
 r:=public.sma_website_preparation_v1('save',p);assert r->>'revision'='1';
 assert r->>'domain_verified'='false' and r->>'website_connected'='false';
 assert public.sma_website_preparation_v1('save',p)->>'revision'='1';
 assert public.sma_website_preparation_v1('save',p||'{"website_url":"https://example.org/"}')->>'code'='REQUEST_CONFLICT';
 assert public.sma_website_preparation_v1('save',p||'{"request_id":"a1000000-0000-4000-8000-000000000002"}')->>'code'='REVISION_CONFLICT';
 assert public.sma_website_preparation_v1('save',p||'{"user_id":"fa660000-0000-4000-8000-000000000093"}')->>'code'='INVALID_INPUT';
 foreach bad in array array['javascript:alert(1)','http://example.com/','https://user:secret@example.com/','https://127.0.0.1/','https://localhost/','https://host.local/','https://example.com:443/','https://example.com/?token=x','https://example.com/#x'] loop
  assert public.sma_website_preparation_v1('save',p||jsonb_build_object('website_url',bad))->>'code'='INVALID_WEBSITE';
 end loop;
 assert public.sma_website_preparation_v1('save',p||'{"desired_domain":"x.invalid"}')->>'code'='INVALID_DOMAIN';
 assert public.sma_website_preparation_v1('save',p||'{"expected_revision":2147483647}')->>'code'='INVALID_INPUT';
 assert public.sma_website_preparation_v1('save',p||'{"expected_revision":"not-a-number"}')->>'code'='INVALID_INPUT';
 p:=p||'{"mode":"new","website_url":"","desired_domain":"","expected_revision":1,"request_id":"a1000000-0000-4000-8000-000000000002"}';
 r:=public.sma_website_preparation_v1('save',p);assert r->>'revision'='2' and r->'draft'->>'mode'='new';
end $$;
select set_config('request.jwt.claim.sub','fa660000-0000-4000-8000-000000000092',true);
do $$begin assert public.sma_website_preparation_v1('get')->>'code'='DELTA_REQUIRED';end $$;
select set_config('request.jwt.claim.sub','fa660000-0000-4000-8000-000000000093',true);
do $$declare r jsonb;begin
 r:=public.sma_website_preparation_v1('get');assert r->>'ok'='true' and r->>'revision'='0' and r->'shop_url'='null'::jsonb;
 assert public.sma_website_preparation_v1('save','{"mode":"new","website_url":"","desired_domain":"","expected_revision":0,"request_id":"a1000000-0000-4000-8000-000000000003"}')->>'revision'='1';
end $$;
select set_config('request.jwt.claim.sub','fa660000-0000-4000-8000-000000000094',true);
do $$begin assert public.sma_website_preparation_v1('get')->>'code'='ACCESS_INACTIVE';end $$;
reset role;
-- Fresh access and ownership are checked again, including reassigned accounts.
update public.sma_kunden set shop_oeffentlich=false where id=-909000001001;
set local role authenticated;
select set_config('request.jwt.claim.sub','fa660000-0000-4000-8000-000000000091',true);
do $$begin assert public.sma_website_preparation_v1('get')->'shop_url'='null'::jsonb;end $$;
reset role;
update public.sma_kunden set user_id='fa660000-0000-4000-8000-000000000095' where id=-909000001001;
set local role authenticated;
select set_config('request.jwt.claim.sub','fa660000-0000-4000-8000-000000000091',true);
do $$begin assert public.sma_website_preparation_v1('get')->>'code'='ACCOUNT_UNAVAILABLE';end $$;
select set_config('request.jwt.claim.sub','fa660000-0000-4000-8000-000000000095',true);
do $$begin assert public.sma_website_preparation_v1('get')->>'code'='ACCOUNT_CHANGED';end $$;
reset role;
insert into public.sma_kunden(id,user_id,paket,aktiv,demo_delta_aktiv) values
 (-909000001005,'fa660000-0000-4000-8000-000000000093','delta',true,true);
set local role authenticated;
select set_config('request.jwt.claim.sub','fa660000-0000-4000-8000-000000000093',true);
do $$begin assert public.sma_website_preparation_v1('get')->>'code'='ACCOUNT_UNAVAILABLE';end $$;
reset role;
rollback;
select 'website/domain SQL cases passed' as result;
