begin;
insert into public.sma_kunden values(-909000006003,'fa660000-0000-4000-8000-000000000063','delta',true,false,true,null,false);
set local role authenticated;
select set_config('request.jwt.claim.sub','fa660000-0000-4000-8000-000000000063',true);
do $$declare r jsonb;c jsonb;params jsonb;id uuid;k text;v jsonb;begin
 r:=public.sma_customer_website_v1('generate',jsonb_build_object('expected_revision',0,'request_id',gen_random_uuid()));
 assert r->>'ok'='true';c:=r->'content';id:=(r->>'site_id')::uuid;
 -- Existing shapes remain valid. Only fixed string choices can be added.
 foreach k in array array['accent','hero'] loop
  for v in select value from jsonb_array_elements('[null,false,1,{},[],"","url(https://example.com)","<img src=x>"]'::jsonb) loop
   params:=jsonb_build_object('expected_revision',1,'request_id',gen_random_uuid(),'content',c||jsonb_build_object(k,v));
   assert public.sma_customer_website_v1('save',params)->>'code'='INVALID_CONTENT';
  end loop;
 end loop;
 c:=c||'{"accent":"green","hero":"abstract"}';
 params:=jsonb_build_object('expected_revision',1,'request_id',gen_random_uuid(),'content',c);
 r:=public.sma_customer_website_v1('save',params);
 assert r->>'revision'='2' and r->'content'=c;
 assert public.sma_customer_website_v1('save',params)=r;
 assert public.sma_customer_website_public_v1(id)->>'code'='NOT_AVAILABLE';
 assert public.sma_customer_website_v1('get')->'content'=c;
 -- A previous editor version omitting the optional fields must retain saved design.
 params:=jsonb_build_object('expected_revision',2,'request_id',gen_random_uuid(),'content',(c-'accent'-'hero')||'{"about":"Updated text"}');
 r:=public.sma_customer_website_v1('save',params);
 assert r->'content'->>'accent'='green' and r->'content'->>'hero'='abstract';
 assert r->'content'->>'about'='Updated text';
 r:=public.sma_customer_website_v1('publish',jsonb_build_object('expected_revision',3,'request_id',gen_random_uuid()));
 assert r->>'publicly_available'='true';
 assert public.sma_customer_website_public_v1(id)->'content'->>'accent'='green';
 c:=r->'content'||'{"accent":"terracotta","hero":"none"}';
 params:=jsonb_build_object('expected_revision',4,'request_id',gen_random_uuid(),'content',c);
 r:=public.sma_customer_website_v1('save',params);
 assert r->>'has_changes'='true' and r->'content'->>'hero'='none';
 assert public.sma_customer_website_public_v1(id)->'content'->>'accent'='green';
 assert public.sma_customer_website_public_v1(id)->'content'->>'hero'='abstract';
 assert public.sma_customer_website_v1('save',params||jsonb_build_object('request_id',gen_random_uuid()))->>'code'='REVISION_CONFLICT';
 -- The existing explicit publication command alone advances the public design.
 r:=public.sma_customer_website_v1('publish',jsonb_build_object('expected_revision',5,'request_id',gen_random_uuid()));
 assert r->>'has_changes'='false';
 assert public.sma_customer_website_public_v1(id)->'content'->>'hero'='none';
 r:=public.sma_customer_website_v1('unpublish',jsonb_build_object('expected_revision',6,'request_id',gen_random_uuid()));
 assert public.sma_customer_website_public_v1(id)->>'code'='NOT_AVAILABLE';
 assert r->'content'=c;
end $$;
reset role;
rollback;
select 'Website design SQL checks passed: validation, persistence, legacy writes, retry, conflict, private/public snapshots; fixtures rolled back' as result;
