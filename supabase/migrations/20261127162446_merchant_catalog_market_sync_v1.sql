-- Enrollment is explicit per merchant. Connections cannot be reassigned by a customer.
create table sma_private.catalog_merchants_v1(
 customer_id bigint primary key references public.sma_kunden(id), expected_shop text not null, shopify_delegate boolean not null default false
);
create table sma_private.catalog_channels_v1(
 customer_id bigint references sma_private.catalog_merchants_v1, market text check(market in ('shopify','digistore24')),
 identity text not null, secret_id uuid not null, category integer, primary key(customer_id,market)
);
create table sma_private.catalog_work_v1(
 product_id bigint references public.sma_produkte(id) on delete cascade, customer_id bigint not null references sma_private.catalog_merchants_v1,
 market text not null check(market in ('shopify','digistore24')), revision bigint not null default 1, sent_revision bigint not null default 0,
 state text not null default 'queued' check(state in ('queued','running','synced','attention')), code text,
 remote_id text, variant_id text, plan_id text, ticket uuid unique, claimed boolean not null default false,
 expires_at timestamptz, next_at timestamptz not null default now(), attempts int not null default 0,
 write_stage text, primary key(product_id,market)
);
create unique index catalog_one_remote_v1 on sma_private.catalog_work_v1(customer_id,market,remote_id) where remote_id is not null;
alter table sma_private.catalog_merchants_v1 enable row level security;
alter table sma_private.catalog_channels_v1 enable row level security;
alter table sma_private.catalog_work_v1 enable row level security;
revoke all on sma_private.catalog_merchants_v1,sma_private.catalog_channels_v1,sma_private.catalog_work_v1 from public,anon,authenticated,service_role;

create function sma_private.catalog_enqueue_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare cid bigint;
begin
 select k.id into cid from public.sma_kunden k join sma_private.catalog_merchants_v1 m on m.customer_id=k.id
 where (k.user_id,k.kunde_id)=(new.user_id,new.kunde_id) and k.aktiv and (k.zahlung_bestaetigt or k.demo_delta_aktiv);
 if cid is null or new.sma_produkt_id is null then return new; end if;
 if tg_op='UPDATE' and (new.produkt_name,new.beschreibung,new.sku,new.preis,new.waehrung,new.produkt_typ) is not distinct from
 (old.produkt_name,old.beschreibung,old.sku,old.preis,old.waehrung,old.produkt_typ) then return new;end if;
 insert into sma_private.catalog_work_v1 as w(product_id,customer_id,market)
 select new.id,cid,platform from unnest(array['shopify','digistore24']) platform
 on conflict(product_id,market) do update set revision=w.revision+1,
 state=case when w.state='running' or w.write_stage is not null then w.state else 'queued' end,next_at=now(),attempts=0;
 return new;
end $$;
create trigger sma_catalog_product_change_v1 after insert or update of produkt_name,beschreibung,sku,preis,waehrung,produkt_typ on public.sma_produkte
for each row execute function sma_private.catalog_enqueue_v1();

create function public.sma_market_catalog_v1(action text default 'get',fields jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare k public.sma_kunden%rowtype; shop text; p public.sma_produkte%rowtype; pid uuid; title text; sku_in text; amount numeric; descr text;
begin
 if auth.uid() is null then return '{"ok":false,"code":"AUTH_REQUIRED"}';end if;
 select * into strict k from public.sma_kunden where user_id=auth.uid() and aktiv and (zahlung_bestaetigt or demo_delta_aktiv);
 select expected_shop into shop from sma_private.catalog_merchants_v1 where customer_id=k.id;
 if shop is null then return '{"ok":true,"enabled":false}';end if;
 if action='get' then
  return jsonb_build_object('ok',true,'enabled',true,'shop',shop,
   'accounts',(select case when m.shopify_delegate then jsonb_build_object('shopify',m.expected_shop) else '{}'::jsonb end from sma_private.catalog_merchants_v1 m where m.customer_id=k.id)||coalesce((select jsonb_object_agg(market,identity) from sma_private.catalog_channels_v1 where customer_id=k.id),'{}'::jsonb),
   'rows',coalesce((select jsonb_agg(to_jsonb(v)) from (select product.sma_produkt_id as id,w.market,
    case when w.state='attention' then 'attention' when w.sent_revision=w.revision then 'synced' when c.identity is null and not (w.market='shopify' and exists(select from sma_private.catalog_merchants_v1 m where m.customer_id=k.id and m.shopify_delegate)) then 'connection' else w.state end as state,
    w.code,w.remote_id from sma_private.catalog_work_v1 w join public.sma_produkte product on product.id=w.product_id
    left join sma_private.catalog_channels_v1 c on (c.customer_id,c.market)=(w.customer_id,w.market)
    where w.customer_id=k.id and (product.user_id,product.kunde_id)=(k.user_id,k.kunde_id) and (not(fields?'ids') or fields->'ids' ? product.sma_produkt_id)
    order by w.product_id desc,w.market limit 200) v),'[]'::jsonb));
 end if;
 if action<>'save' or jsonb_typeof(fields) is distinct from 'object' or octet_length(fields::text)>30000 then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
 pid:=(fields->>'id')::uuid; title:=btrim(fields->>'title'); sku_in:=btrim(fields->>'sku'); descr:=coalesce(fields->>'description','');
 amount:=(fields->>'price')::numeric;
 if pid is null or title is null or length(title) not between 1 and 240 or sku_in is null or sku_in !~ '^[A-Za-z0-9_.-]{1,80}$'
  or length(descr)>5000 or amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<=0 or amount>9999999 or round(amount,2)<>amount then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
 perform pg_advisory_xact_lock(k.id);
 select * into p from public.sma_produkte where user_id=k.user_id and kunde_id=k.kunde_id and sma_produkt_id=pid::text for update;
 if exists(select from public.sma_produkte where user_id=k.user_id and kunde_id=k.kunde_id and lower(sku)=lower(sku_in) and id is distinct from p.id) then return '{"ok":false,"code":"SKU_EXISTS"}';end if;
 if p.id is null then
  insert into public.sma_produkte(user_id,kunde_id,sma_produkt_id,produkt_name,sku,beschreibung,preis,waehrung,produkt_typ,aktiv)
  values(k.user_id,k.kunde_id,pid::text,title,sku_in,descr,amount,'EUR','Digital',false);
 else
  if (p.sku is distinct from sku_in) then return '{"ok":false,"code":"SKU_CHANGED"}';end if;
  if fields->>'version' is null and (p.produkt_name,p.beschreibung,p.preis) is distinct from (title,descr,amount) then return '{"ok":false,"code":"PLAN_CHANGED"}';end if;
  if fields->>'version' is not null and (fields->>'version')::timestamptz is distinct from p.updated_at then return '{"ok":false,"code":"PLAN_CHANGED"}';end if;
  update public.sma_produkte set produkt_name=title,beschreibung=descr,preis=amount,updated_at=now() where id=p.id;
 end if;
 return jsonb_build_object('ok',true,'id',pid);
exception when no_data_found or too_many_rows then return '{"ok":false,"code":"ACCOUNT_UNAVAILABLE"}';
 when invalid_text_representation or numeric_value_out_of_range then return '{"ok":false,"code":"INVALID_INPUT"}';
end $$;
revoke all on function public.sma_market_catalog_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_market_catalog_v1(text,jsonb) to authenticated;

-- Only the Edge worker stores a credential after verifying its merchant identity at the provider.
create function public.sma_catalog_connect_worker_v1(owner_in uuid,market_in text,identity_in text,credential_in text,category_in integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare cid bigint; expected text; old sma_private.catalog_channels_v1%rowtype; sid uuid;
begin
 select m.customer_id,m.expected_shop into strict cid,expected from sma_private.catalog_merchants_v1 m join public.sma_kunden k on k.id=m.customer_id
 where k.user_id=owner_in and k.aktiv and (k.zahlung_bestaetigt or k.demo_delta_aktiv) for update of m;
 if market_in not in ('shopify','digistore24') or nullif(identity_in,'') is null or nullif(credential_in,'') is null or length(credential_in)>8000 or
 (market_in='shopify' and identity_in<>expected) or (market_in='digistore24' and coalesce(category_in,0)<1) then return false;end if;
 select * into old from sma_private.catalog_channels_v1 where (customer_id,market)=(cid,market_in);
 if found then
  if old.identity<>identity_in then return false;end if;
  perform vault.update_secret(old.secret_id,credential_in);update sma_private.catalog_channels_v1 set category=category_in where (customer_id,market)=(cid,market_in);
 else
  select vault.create_secret(credential_in) into sid;
  insert into sma_private.catalog_channels_v1 values(cid,market_in,identity_in,sid,category_in);
 end if;
 update sma_private.catalog_work_v1 set next_at=now(),state='queued',attempts=0 where customer_id=cid and market=market_in and code='RECONNECT' and write_stage is null;
 return true;
end $$;
revoke all on function public.sma_catalog_connect_worker_v1(uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.sma_catalog_connect_worker_v1(uuid,text,text,text,integer) to service_role;

create function public.sma_catalog_job_worker_v1(t uuid,op text,arg jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare w sma_private.catalog_work_v1%rowtype; prod public.sma_produkte%rowtype; ch sma_private.catalog_channels_v1%rowtype; secret_text text; outcome text:=arg->>'code';
begin
 select * into w from sma_private.catalog_work_v1 where ticket=t and state='running' and expires_at>now() for update;
 if not found then return '{"ok":false}';end if;
 select p.* into strict prod from public.sma_produkte p join public.sma_kunden k on (k.user_id,k.kunde_id)=(p.user_id,p.kunde_id)
 where p.id=w.product_id and k.id=w.customer_id and k.aktiv and (k.zahlung_bestaetigt or k.demo_delta_aktiv);
 if op='claim' and not w.claimed then
  select * into strict ch from sma_private.catalog_channels_v1 where (customer_id,market)=(w.customer_id,w.market);
  update sma_private.catalog_work_v1 set claimed=true where ticket=t;
  select decrypted_secret into strict secret_text from vault.decrypted_secrets where id=ch.secret_id;
  return jsonb_build_object('ok',true,'market',w.market,'revision',w.revision,'identity',ch.identity,'credentials',secret_text::jsonb,
   'category',ch.category,'source_id',prod.sma_produkt_id,'sku',prod.sku,'title',prod.produkt_name,'description',coalesce(prod.beschreibung,''),'price',prod.preis,'currency',prod.waehrung,
   'remote_id',w.remote_id,'variant_id',w.variant_id,'plan_id',w.plan_id,'prior_stage',w.write_stage);
 end if;
 if not w.claimed then return '{"ok":false}';end if;
 if op='before_create' and arg->>'stage' in ('product','price') and w.write_stage is null and w.revision=(arg->>'revision')::bigint then
  update sma_private.catalog_work_v1 set write_stage=arg->>'stage' where ticket=t;
 elsif op='bind' and nullif(arg->>'remote_id','') is not null and (w.remote_id is null or w.remote_id=arg->>'remote_id')
 and (w.variant_id is null or w.variant_id=arg->>'variant_id') and (w.plan_id is null or w.plan_id=arg->>'plan_id') then
  update sma_private.catalog_work_v1 set remote_id=arg->>'remote_id',variant_id=coalesce(arg->>'variant_id',variant_id),plan_id=coalesce(arg->>'plan_id',plan_id),write_stage=null where ticket=t;
 elsif op='finish' and w.remote_id is not null and w.write_stage is null then
  update sma_private.catalog_work_v1 set sent_revision=(arg->>'revision')::bigint,state=case when revision=(arg->>'revision')::bigint then 'synced' else 'queued' end,
   ticket=null,claimed=false,expires_at=null,code=null,next_at=now(),attempts=0 where ticket=t;
 elsif op='error' then
  update sma_private.catalog_work_v1 set state=case when outcome in ('TEMPORARY','BUSY') and attempts<7 then 'queued' else 'attention' end,
   code=case when outcome in ('TEMPORARY','BUSY','RECONNECT','CONFLICT','CHECK_RESULT','PRODUCT_INPUT','CATEGORY','UNSUPPORTED','REJECTED') then outcome else 'CHECK_RESULT' end,
   ticket=null,claimed=false,expires_at=null,next_at=now()+make_interval(mins=>least(60,(power(2,least(6,attempts)))::int)) where ticket=t;
 else return '{"ok":false}';end if;
 return '{"ok":true}';
exception when no_data_found or too_many_rows then return '{"ok":false}';
end $$;
revoke all on function public.sma_catalog_job_worker_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sma_catalog_job_worker_v1(uuid,text,jsonb) to service_role;

create function sma_private.catalog_shopify_take_v1(domain_in text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w sma_private.catalog_work_v1%rowtype; p public.sma_produkte%rowtype; token uuid:=gen_random_uuid();
begin
 select j.* into w from sma_private.catalog_work_v1 j join sma_private.catalog_merchants_v1 m on (m.customer_id,m.expected_shop)=(j.customer_id,domain_in)
 join public.sma_kunden k on k.id=m.customer_id and k.aktiv and (k.zahlung_bestaetigt or k.demo_delta_aktiv)
 join public.sma_produkte prod on (prod.id,prod.user_id,prod.kunde_id)=(j.product_id,k.user_id,k.kunde_id)
 where m.shopify_delegate and j.market='shopify' and j.state='queued' and j.next_at<=now()
 and not exists(select from sma_private.catalog_channels_v1 c where (c.customer_id,c.market)=(j.customer_id,'shopify'))
 order by j.next_at,j.product_id limit 1 for update of j skip locked;
 if not found then return '{"available":false}';end if;
 select * into strict p from public.sma_produkte where id=w.product_id;
 update sma_private.catalog_work_v1 set ticket=token,claimed=true,state='running',expires_at=now()+interval '15 minutes',attempts=attempts+1 where (product_id,market)=(w.product_id,w.market);
 return jsonb_build_object('available',true,'ticket',token,'revision',w.revision,'market','shopify','identity',domain_in,'remote_id',w.remote_id,'variant_id',w.variant_id,
  'prior_stage',w.write_stage,'source_id',p.sma_produkt_id,'title',p.produkt_name,'description',coalesce(p.beschreibung,''),'sku',p.sku,'price',p.preis,'currency',p.waehrung);
end $$;
revoke all on function sma_private.catalog_shopify_take_v1(text) from public,anon,authenticated,service_role;

create function sma_private.catalog_tick_v1() returns void language plpgsql security definer set search_path='' as $$
declare w record; t uuid;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('sma-catalog-markets',0)) then return;end if;
 update sma_private.catalog_work_v1 set state='queued',ticket=null,claimed=false,expires_at=null,next_at=now()+interval '1 minute'
 where state='running' and expires_at<=now();
 for w in select w0.product_id,w0.market from sma_private.catalog_work_v1 w0 join sma_private.catalog_channels_v1 c using(customer_id,market)
  join public.sma_kunden k on k.id=w0.customer_id and k.aktiv and (k.zahlung_bestaetigt or k.demo_delta_aktiv)
  where w0.state='queued' and w0.next_at<=now() order by w0.next_at,w0.product_id limit 4 for update of w0 skip locked loop
  t:=gen_random_uuid();
  update sma_private.catalog_work_v1 set state='running',ticket=t,claimed=false,expires_at=now()+interval '5 minutes',attempts=attempts+1 where (product_id,market)=(w.product_id,w.market);
  perform net.http_post(url:='https://bnvnmdxosbnuzedokqgh.supabase.co/functions/v1/sma-market-catalog',body:=jsonb_build_object('ticket',t),timeout_milliseconds:=90000);
 end loop;
end $$;
revoke all on function sma_private.catalog_tick_v1(),sma_private.catalog_enqueue_v1() from public,anon,authenticated,service_role;
select cron.schedule('sma-produkte-marktabgleich-v1','* * * * *','select sma_private.catalog_tick_v1()');
notify pgrst,'reload schema';
