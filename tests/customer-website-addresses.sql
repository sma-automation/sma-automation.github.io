begin;
insert into public.sma_kunden values
 (-909000009001,'fa990000-0000-4000-8000-000000000091','delta',true,false,true,null,false),
 (-909000009002,'fa990000-0000-4000-8000-000000000092','delta',true,false,true,null,false);
set local role authenticated;
select set_config('request.jwt.claim.sub','fa990000-0000-4000-8000-000000000091',true);
do $$declare r jsonb;begin
 r:=public.sma_customer_website_v1('generate','{"expected_revision":0,"request_id":"ab990000-0000-4000-8000-000000000091"}');assert r->>'ok'='true';assert r->'custom_domain'='null'::jsonb;perform set_config('test.address_site',r->>'site_id',true);
 assert not has_table_privilege('authenticated','sma_private.customer_website_addresses_v1','SELECT,INSERT,UPDATE,DELETE');
 assert not has_table_privilege('service_role','sma_private.customer_website_addresses_v1','SELECT,INSERT,UPDATE,DELETE');
 assert not has_table_privilege('anon','sma_private.customer_website_addresses_v1','SELECT,INSERT,UPDATE,DELETE');
 assert not has_function_privilege('anon','sma_private.customer_website_address_v1(uuid)','EXECUTE');
 assert not has_function_privilege('service_role','sma_private.customer_website_address_v1(uuid)','EXECUTE');
end $$;
reset role;
insert into sma_private.customer_website_addresses_v1(customer_id,user_id,site_id,hostname,evidence)
 values(-909000009001,'fa990000-0000-4000-8000-000000000091',current_setting('test.address_site')::uuid,'customer.example.com','Internal evidence stays private');
do $$begin
 begin update sma_private.customer_website_addresses_v1 set hostname='https://evil.com' where customer_id=-909000009001;raise exception 'invalid host accepted';exception when check_violation then null;end;
end $$;
set local role authenticated;
do $$declare r jsonb;begin
 r:=public.sma_customer_website_v1('get');assert r->'custom_domain'->>'hostname'='customer.example.com';assert r->>'revision'='1';assert r->>'published'='false';assert r->>'publicly_available'='false';
 assert not(r->'custom_domain' ?| array['customer_id','user_id','evidence']);
 assert public.sma_customer_website_public_v1(current_setting('test.address_site')::uuid)->>'code'='NOT_AVAILABLE';
 r:=public.sma_customer_website_v1('publish','{"expected_revision":1,"request_id":"ab990000-0000-4000-8000-000000000093"}');assert r->>'publicly_available'='true';assert r->'custom_domain'->>'hostname'='customer.example.com';
 r:=public.sma_customer_website_v1('unpublish','{"expected_revision":2,"request_id":"ab990000-0000-4000-8000-000000000094"}');assert r->>'published'='false';assert r->'custom_domain'->>'hostname'='customer.example.com';
end $$;
select set_config('request.jwt.claim.sub','fa990000-0000-4000-8000-000000000092',true);
do $$declare r jsonb;begin
 assert sma_private.customer_website_address_v1(current_setting('test.address_site')::uuid) is null;
 r:=public.sma_customer_website_v1('generate','{"expected_revision":0,"request_id":"ab990000-0000-4000-8000-000000000092"}');assert r->'custom_domain'='null'::jsonb;perform set_config('test.other_address_site',r->>'site_id',true);
end $$;
reset role;
do $$begin
 begin insert into sma_private.customer_website_addresses_v1(customer_id,user_id,site_id,hostname,evidence) values(-909000009002,'fa990000-0000-4000-8000-000000000092',current_setting('test.other_address_site')::uuid,'customer.example.com','duplicate');raise exception 'duplicate accepted';exception when unique_violation then null;end;
end $$;
update sma_private.customer_website_addresses_v1 set revoked_at=now() where customer_id=-909000009001;
set local role authenticated;
select set_config('request.jwt.claim.sub','fa990000-0000-4000-8000-000000000091',true);
do $$begin assert public.sma_customer_website_v1('get')->'custom_domain'='null'::jsonb;end $$;
reset role;
update sma_private.customer_website_addresses_v1 set revoked_at=null,verified_at=now()+interval '1 day' where customer_id=-909000009001;
set local role authenticated;
do $$begin assert sma_private.customer_website_address_v1(current_setting('test.address_site')::uuid) is null;end $$;
reset role;
update sma_private.customer_website_addresses_v1 set verified_at=now() where customer_id=-909000009001;
update public.sma_kunden set aktiv=false where id=-909000009001;
set local role authenticated;
do $$begin assert public.sma_customer_website_v1('get')->'custom_domain'='null'::jsonb;end $$;
reset role;
update public.sma_kunden set aktiv=true,user_id='fa990000-0000-4000-8000-000000000093' where id=-909000009001;
set local role authenticated;
do $$begin assert sma_private.customer_website_address_v1(current_setting('test.address_site')::uuid) is null;end $$;
select set_config('request.jwt.claim.sub','fa990000-0000-4000-8000-000000000093',true);
do $$begin assert sma_private.customer_website_address_v1(current_setting('test.address_site')::uuid) is null;assert public.sma_customer_website_v1('get')->>'code'='ACCOUNT_CHANGED';end $$;
reset role;
rollback;
select 'confirmed website address SQL cases passed; fixtures rolled back' as result;
