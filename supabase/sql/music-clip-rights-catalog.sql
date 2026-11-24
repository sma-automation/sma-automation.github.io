-- Source evidence stays in the operator schema. Clearing a source covers its
-- composition, recording, edits and standalone delivery for customer videos.
create table sma_private.music_sources_v1 (
 source_sha text primary key check (source_sha ~ '^[0-9a-f]{64}$'),
 title text not null check (length(trim(title)) between 1 and 180),
 rights_status text not null default 'pending' check (rights_status in ('pending','cleared','test_only')),
 evidence_ref text,
 customer_clip_and_video_rights boolean not null default false,
 cleared_at timestamptz,
 valid_until timestamptz,
 check (rights_status <> 'cleared' or
   (nullif(trim(evidence_ref),'') is not null and customer_clip_and_video_rights and cleared_at is not null)),
 check (valid_until is null or cleared_at is null or valid_until > cleared_at)
);
create table sma_private.music_clips_v1 (
 sha256 text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
 source_sha text not null references sma_private.music_sources_v1(source_sha),
 title text not null check (length(trim(title)) between 1 and 180),
 topics text[] not null check (cardinality(topics) between 1 and 12 and array_position(topics,null) is null),
 mood text not null check (length(trim(mood)) between 1 and 80),
 usage text not null check (length(trim(usage)) between 1 and 80),
 duration_ms integer not null check (duration_ms between 1 and 600000)
);
create index music_clips_source_idx on sma_private.music_clips_v1(source_sha);
alter table sma_private.music_sources_v1 enable row level security;
alter table sma_private.music_clips_v1 enable row level security;
revoke all on sma_private.music_sources_v1,sma_private.music_clips_v1 from public,anon,authenticated,service_role;

create view sma_private.music_cleared_clips_v1 with (security_invoker=true) as
 select d.*, s.title as source_title
 from sma_private.music_clips_v1 d join sma_private.music_sources_v1 s using(source_sha)
 where s.rights_status='cleared' and s.cleared_at<=now() and (s.valid_until is null or s.valid_until>now());
revoke all on sma_private.music_cleared_clips_v1 from public,anon,authenticated,service_role;
-- Keep the column contract used by existing editor and gallery consumers.
create or replace view sma_private.music_catalog_ready_v1 with (security_invoker=true) as
 select t.* from sma_private.music_catalog_v1 t join sma_private.music_cleared_clips_v1 d using(sha256)
 join storage.objects o on o.bucket_id='sma-katalog' and o.name=t.object_name
 where t.listed and o.metadata->>'size'=t.size_bytes::text and o.metadata->>'mimetype'=t.mime_type;

-- The same source-level grant is checked on direct Storage reads and unlocks.
-- The existing account advisory lock serializes concurrent requests for siblings.
create or replace function sma_private.music_track_access_v1(c public.sma_kunden,track text) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists (
  select from sma_private.music_cleared_clips_v1 d where d.sha256=track and
   (c.demo_delta_aktiv is true or lower(trim(c.paket))='delta' or exists (
    select from sma_private.music_track_unlocks_v1 u
    join sma_private.music_credit_packs_v1 p on p.id=u.pack_id
    join sma_private.music_clips_v1 sibling on sibling.sha256=u.track_sha256
    where u.customer_id=c.id and u.user_id=c.user_id and p.state='paid' and sibling.source_sha=d.source_sha
   ))
 )
$$;

create or replace function sma_private.music_credits_request_v1(p_action text,p_input jsonb) returns jsonb
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
   'available',sma_private.music_track_access_v1(c,t.sha256),
   'source_title',d.source_title,'topics',d.topics,'mood',d.mood,'usage',d.usage,'duration_ms',d.duration_ms) order by t.name,t.sha256),'[]'::jsonb) into tracks from sma_private.music_catalog_ready_v1 t
   join sma_private.music_cleared_clips_v1 d using(sha256);
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
