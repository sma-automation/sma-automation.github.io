-- SMA's catalogue is separate from customers' private music uploads.
create table sma_private.music_catalog_v1 (
 sha256 text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
 name text not null check (length(trim(name)) between 1 and 180 and name !~ '[[:cntrl:]]'),
 mime_type text not null check (mime_type in ('audio/mpeg','audio/wav')),
 size_bytes bigint not null check (size_bytes between 12 and 8000000),
 listed boolean not null default false,
 object_name text generated always as (sha256 || case mime_type when 'audio/wav' then '.wav' else '.mp3' end) stored unique
);
create table sma_private.music_credit_packs_v1 (
 id uuid primary key default gen_random_uuid(), customer_id bigint not null references public.sma_kunden(id),
 user_id uuid not null, payment_id text unique check(payment_id ~ '^tr_[A-Za-z0-9]{1,64}$'),
 state text not null default 'open' check(state in ('open','paid','closed','reversed')),
 created_at timestamptz not null default now(), paid_at timestamptz,
 unique(id,customer_id,user_id)
);
create unique index music_pack_open_owner_idx on sma_private.music_credit_packs_v1(customer_id,user_id) where state='open';
create index music_pack_owner_idx on sma_private.music_credit_packs_v1(customer_id,user_id,state);
create table sma_private.music_track_unlocks_v1 (
 customer_id bigint not null, user_id uuid not null, track_sha256 text not null references sma_private.music_catalog_v1(sha256),
 pack_id uuid not null, created_at timestamptz not null default now(), primary key(pack_id,track_sha256),
 foreign key(pack_id,customer_id,user_id) references sma_private.music_credit_packs_v1(id,customer_id,user_id)
);
create index music_unlock_owner_track_idx on sma_private.music_track_unlocks_v1(customer_id,user_id,track_sha256);
alter table sma_private.music_catalog_v1 enable row level security;
alter table sma_private.music_credit_packs_v1 enable row level security;
alter table sma_private.music_track_unlocks_v1 enable row level security;
revoke all on sma_private.music_catalog_v1,sma_private.music_credit_packs_v1,sma_private.music_track_unlocks_v1 from public,anon,authenticated,service_role;

create function sma_private.music_catalog_owner_v1() returns setof public.sma_kunden
language sql stable security invoker set search_path='' as $$
 select c.* from public.sma_kunden c where c.user_id=auth.uid() and c.aktiv is true
 and (c.demo_delta_aktiv is true or (c.zahlung_bestaetigt is true and lower(trim(c.paket)) in ('alpha','beta','delta')))
 and (select count(*) from public.sma_kunden u where u.user_id=c.user_id)=1
$$;
revoke all on function sma_private.music_catalog_owner_v1() from public,anon,authenticated,service_role;

create function sma_private.music_track_access_v1(c public.sma_kunden,track text) returns boolean
language sql stable security invoker set search_path='' as $$
 select c.demo_delta_aktiv is true or lower(trim(c.paket))='delta' or exists (
  select from sma_private.music_track_unlocks_v1 u join sma_private.music_credit_packs_v1 p on p.id=u.pack_id
  where u.customer_id=c.id and u.user_id=c.user_id and u.track_sha256=track and p.state='paid')
$$;
revoke all on function sma_private.music_track_access_v1(public.sma_kunden,text) from public,anon,authenticated,service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('sma-katalog','sma-katalog',false,8000000,array['audio/mpeg','audio/wav']);
create function sma_private.music_catalog_object_v1(path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select from sma_private.music_catalog_owner_v1() c join sma_private.music_catalog_v1 t
 on t.listed and t.object_name=path where sma_private.music_track_access_v1(c,t.sha256))
$$;
revoke all on function sma_private.music_catalog_object_v1(text) from public,anon,service_role;
grant execute on function sma_private.music_catalog_object_v1(text) to authenticated;
create policy sma_catalog_read on storage.objects for select to authenticated
 using(bucket_id='sma-katalog' and sma_private.music_catalog_object_v1(name));
create policy sma_catalog_read_guard on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'sma-katalog' or sma_private.music_catalog_object_v1(name));
create policy sma_catalog_no_anon on storage.objects as restrictive for all to anon using(bucket_id<>'sma-katalog') with check(bucket_id<>'sma-katalog');
create policy sma_catalog_no_insert on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'sma-katalog');
create policy sma_catalog_no_update on storage.objects as restrictive for update to authenticated using(bucket_id<>'sma-katalog') with check(bucket_id<>'sma-katalog');
create policy sma_catalog_no_delete on storage.objects as restrictive for delete to authenticated using(bucket_id<>'sma-katalog');

-- Only list material available at its immutable path. The client verifies the downloaded hash.
create view sma_private.music_catalog_ready_v1 with (security_invoker=true) as
 select t.* from sma_private.music_catalog_v1 t join storage.objects o on o.bucket_id='sma-katalog' and o.name=t.object_name
 where t.listed and o.metadata->>'size'=t.size_bytes::text and o.metadata->>'mimetype'=t.mime_type;
revoke all on sma_private.music_catalog_ready_v1 from public,anon,authenticated,service_role;

create function sma_private.music_credits_request_v1(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.sma_kunden%rowtype; pack sma_private.music_credit_packs_v1%rowtype;
 track sma_private.music_catalog_v1%rowtype; plan text; credits bigint; tracks jsonb;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 select * into c from sma_private.music_catalog_owner_v1();
 if not found then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 plan:=case when c.demo_delta_aktiv is true then 'delta' else lower(trim(c.paket)) end;
 if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>512 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if p_action='overview' and p_input='{}' then
  select coalesce(sum(10-(select count(*) from sma_private.music_track_unlocks_v1 u where u.pack_id=p.id)),0)
  into credits from sma_private.music_credit_packs_v1 p where p.customer_id=c.id and p.user_id=c.user_id and p.state='paid';
  select coalesce(jsonb_agg(jsonb_build_object('name',t.name,'sha256',t.sha256,'size_bytes',t.size_bytes,'mime_type',t.mime_type,
   'available',sma_private.music_track_access_v1(c,t.sha256)) order by t.name,t.sha256),'[]'::jsonb) into tracks from sma_private.music_catalog_ready_v1 t;
  return jsonb_build_object('ok',true,'plan',plan,'credits',credits,'tracks',tracks);
 end if;
 -- Serialize purchases and unlocks for this customer. Never trust a browser balance.
 perform pg_advisory_xact_lock(hashtextextended('sma-music-credit:'||c.id::text,0));
 if p_action='start' and p_input='{}' and plan in ('alpha','beta') then
  if not exists(select from sma_private.music_catalog_ready_v1) then return jsonb_build_object('ok',false,'code','CATALOG_EMPTY');end if;
  -- A checkout link is only returned after its Mollie id is bound. An abandoned,
  -- unbound reservation can expire without reissuing a link to the old payment.
  update sma_private.music_credit_packs_v1 set state='closed' where customer_id=c.id and user_id=c.user_id and state='open'
   and payment_id is null and created_at<now()-interval '15 minutes';
  select * into pack from sma_private.music_credit_packs_v1 where customer_id=c.id and user_id=c.user_id and state='open';
  if not found then insert into sma_private.music_credit_packs_v1(customer_id,user_id) values(c.id,c.user_id) returning * into pack;end if;
  return jsonb_build_object('ok',true,'id',pack.id,'payment_id',pack.payment_id,'created_at',pack.created_at);
 elsif p_action='unlock' and p_input=jsonb_build_object('sha256',p_input->>'sha256') then
  select * into track from sma_private.music_catalog_ready_v1 where sha256=p_input->>'sha256';
  if not found then return jsonb_build_object('ok',false,'code','TRACK_UNAVAILABLE');end if;
  if not sma_private.music_track_access_v1(c,track.sha256) then
   select p.* into pack from sma_private.music_credit_packs_v1 p where p.customer_id=c.id and p.user_id=c.user_id and p.state='paid'
    and (select count(*) from sma_private.music_track_unlocks_v1 u where u.pack_id=p.id)<10 order by p.paid_at,p.id limit 1;
   if not found then return jsonb_build_object('ok',false,'code','INSUFFICIENT_CREDITS');end if;
   insert into sma_private.music_track_unlocks_v1(customer_id,user_id,track_sha256,pack_id) values(c.id,c.user_id,track.sha256,pack.id);
  end if;
  return jsonb_build_object('ok',true);
 end if;
 return jsonb_build_object('ok',false,'code','INVALID_INPUT');
end $$;
create function public.sma_music_credits_v1(p_action text,p_input jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select sma_private.music_credits_request_v1(p_action,p_input)$$;
revoke all on function public.sma_music_credits_v1(text,jsonb),sma_private.music_credits_request_v1(text,jsonb) from public,anon,service_role;
grant execute on function public.sma_music_credits_v1(text,jsonb),sma_private.music_credits_request_v1(text,jsonb) to authenticated;

-- Only the server may supply a freshly retrieved Mollie receipt. No arbitrary credit grant.
create function sma_private.music_pack_receipt_v1(p_id uuid,p_receipt jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p sma_private.music_credit_packs_v1%rowtype; next_state text; key text;
begin
 select * into p from sma_private.music_credit_packs_v1 where id=p_id;
 if not found then return jsonb_build_object('ok',false,'code','UNKNOWN_PACK');end if;
 perform pg_advisory_xact_lock(hashtextextended('sma-music-credit:'||p.customer_id::text,0));
 select * into p from sma_private.music_credit_packs_v1 where id=p_id for update;
 if p_receipt->>'mode' is distinct from 'live' or p_receipt->'amount' is distinct from '{"currency":"EUR","value":"10.00"}'::jsonb
  or p_receipt->'metadata' is distinct from jsonb_build_object('product','sma-music-10-v1','order',p_id)
  or coalesce(p_receipt->>'id','') !~ '^tr_[A-Za-z0-9]{1,64}$' or (p.payment_id is not null and p.payment_id<>p_receipt->>'id')
  then return jsonb_build_object('ok',false,'code','INVALID_RECEIPT');end if;
 next_state:=case p_receipt->>'status' when 'paid' then 'paid' when 'failed' then 'closed' when 'expired' then 'closed' when 'canceled' then 'closed'
  when 'open' then 'open' when 'pending' then 'open' when 'authorized' then 'open' end;
 if next_state is null then return jsonb_build_object('ok',false,'code','INVALID_RECEIPT');end if;
 foreach key in array array['amountRefunded','amountChargedBack'] loop
  if p_receipt ? key then
   if p_receipt->key->>'currency' is distinct from 'EUR' or coalesce(p_receipt->key->>'value','') !~ '^[0-9]{1,10}\.[0-9]{2}$'
    then return jsonb_build_object('ok',false,'code','INVALID_RECEIPT');end if;
   if (p_receipt->key->>'value')::numeric>0 then next_state:='reversed';end if;
  end if;
 end loop;
 if p.state='reversed' or (p.state='paid' and next_state<>'reversed') or (p.state='closed' and next_state='open') then next_state:=p.state;end if;
 update sma_private.music_credit_packs_v1 set payment_id=p_receipt->>'id',state=next_state,
  paid_at=case when next_state='paid' then coalesce(paid_at,now()) else paid_at end where id=p_id;
 return jsonb_build_object('ok',true,'state',next_state);
exception when unique_violation then return jsonb_build_object('ok',false,'code','PAYMENT_CONFLICT');
end $$;
create function public.sma_music_pack_receipt_v1(p_id uuid,p_receipt jsonb) returns jsonb
language sql security invoker set search_path='' as $$select sma_private.music_pack_receipt_v1(p_id,p_receipt)$$;
revoke all on function public.sma_music_pack_receipt_v1(uuid,jsonb),sma_private.music_pack_receipt_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sma_music_pack_receipt_v1(uuid,jsonb),sma_private.music_pack_receipt_v1(uuid,jsonb) to service_role;
