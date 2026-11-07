-- Service-only, one-use dispatch for ready catalogue jobs. No browser session is stored.
alter table sma_private.gallery_music_v1
 add column background_audio text, add column background_token uuid,
 add column background_attempts smallint not null default 0,
 add column background_skip boolean not null default false;
update storage.buckets set allowed_mime_types=array_append(allowed_mime_types,'audio/aac')
 where id='sma-katalog' and not ('audio/aac'=any(allowed_mime_types));

-- Both renderers use the existing per-account lock. Once the n8n result is
-- reserved it must be retried by the same renderer, which produces identical bytes.
do $patch$
declare orig text;
begin
 if (select md5(prosrc) from pg_proc where oid='sma_private.gallery_music_request_v1(text,jsonb)'::regprocedure)
  <> '462804f110590e9f1140793b16ff2e01' then raise exception 'Unexpected gallery music RPC';end if;
 select pg_get_functiondef('sma_private.gallery_music_request_v1(text,jsonb)'::regprocedure) into orig;
 orig:=replace(orig,'set lease=gen_random_uuid(),lease_until','set background_audio=null,background_token=null,lease=gen_random_uuid(),lease_until');
 execute replace(orig,'and j0.state=''pending''','and j0.state=''pending'' and (j0.expected_sha is null or j0.background_audio is null)');
end $patch$;

create function sma_private.gallery_background_pick_v1() returns jsonb
language plpgsql security definer set search_path='' as $$
declare job record; picked sma_private.gallery_music_v1%rowtype;
begin
 -- Serialize dispatcher ticks. Browser and background claim mutations also share
 -- the account lock; recheck the source, licence and lease after acquiring it.
 perform pg_advisory_xact_lock(hashtextextended('gallery-background-dispatch',0));
 update sma_private.gallery_music_v1 set state=case when expected_sha is null then 'pending' else 'check_upload' end,
  background_skip=true,background_token=null,lease=null,lease_until=null
 where state='pending' and background_attempts>=5 and not background_skip and lease_until<=now();
 for job in
  select j.id,c.id as customer,t.sha256,a.name from sma_private.gallery_music_v1 j
  join public.sma_kunden c on c.id=j.customer_id and c.user_id=j.user_id and c.aktiv and
   (c.demo_delta_aktiv or (c.zahlung_bestaetigt and lower(trim(c.paket)) in ('alpha','beta','delta')))
  join sma_private.publication_files_v1 f on f.id=j.source_id and f.customer_id=c.id and f.user_id=c.user_id and f.available
   and f.size_bytes between 12 and 24000000 and f.mime_type='video/mp4' and sma_private.gallery_music_key_v1(f.revision)=j.source_key
  join sma_private.music_catalog_ready_v1 t on sma_private.music_track_access_v1(c,t.sha256)
  join storage.objects a on a.bucket_id='sma-katalog' and a.name like 'render/'||t.sha256||'/%'
   and a.name ~ '^render/[a-f0-9]{64}/[a-f0-9]{64}\.aac$' and a.metadata->>'mimetype'='audio/aac'
   and (case when a.metadata->>'size' ~ '^[0-9]{1,7}$' then (a.metadata->>'size')::int else 0 end) between 12 and 1500000
  where j.state='pending' and not j.background_skip and j.next_attempt<=now() and j.background_attempts<5
   and (j.lease_until is null or j.lease_until<=now())
   and (j.expected_sha is null or (j.track_sha=t.sha256 and j.background_audio=a.name))
   and c.n8n_kunde_id is not null and c.kunde_email is not null
   and (select count(*) from public.sma_kunden other where other.user_id=c.user_id)=1
   and not exists(select from sma_private.gallery_music_v1 active where active.customer_id=c.id and active.state='pending' and active.lease_until>now())
  order by j.next_attempt,j.created_at,j.id,(j.track_sha=t.sha256) desc nulls last,md5(j.source_id::text||t.sha256),a.name limit 1
 loop
  perform pg_advisory_xact_lock(hashtextextended('gallery-music:'||job.customer::text,0));
  if exists(select from sma_private.gallery_music_v1 active where active.customer_id=job.customer and active.state='pending' and active.lease_until>now()) then return null;end if;
  update sma_private.gallery_music_v1 set lease=gen_random_uuid(),lease_until=now()+interval '20 minutes',
   track_sha=job.sha256,background_audio=job.name,background_token=gen_random_uuid(),background_attempts=background_attempts+1
  where id=job.id and state='pending' and (lease_until is null or lease_until<=now())
   and (expected_sha is null or (track_sha=job.sha256 and background_audio=job.name)) returning * into picked;
  if found then return jsonb_build_object('id',picked.id,'ticket',picked.background_token);end if;
 end loop;
 return null;
end $$;
revoke all on function sma_private.gallery_background_pick_v1() from public,anon,authenticated,service_role;

-- Optional operator smoke test: one expiring ticket, fixed local synthetic media.
-- Only the migration role can initiate it. No customer/track/Drive IDs are accepted.
create table sma_private.gallery_background_probe_v1(
 singleton boolean primary key default true check(singleton),id uuid not null unique default gen_random_uuid(),
 ticket uuid default gen_random_uuid(),receipt uuid,expires_at timestamptz not null default now()+interval '4 minutes',
 completed_at timestamptz
);
alter table sma_private.gallery_background_probe_v1 enable row level security;
revoke all on sma_private.gallery_background_probe_v1 from public,anon,authenticated,service_role;

create function sma_private.gallery_background_action_v1(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j sma_private.gallery_music_v1%rowtype;c public.sma_kunden%rowtype; f sma_private.publication_files_v1%rowtype;
 r jsonb;u jsonb;bound jsonb;old_sub text:=current_setting('request.jwt.claim.sub',true);
begin
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>1024 then return '{"ok":false,"code":"INVALID_INPUT"}';end if;
 if p_action='take' then
  update sma_private.gallery_background_probe_v1 set ticket=null,receipt=gen_random_uuid()
   where id=(p_input->>'id')::uuid and ticket=(p_input->>'ticket')::uuid and expires_at>now()
   returning jsonb_build_object('ok',true,'probe',true,'can_publish',false,'id',id,'receipt',receipt) into r;
  if found then return r;end if;
 elsif p_action='probe_receipt' then
  update sma_private.gallery_background_probe_v1 set completed_at=now(),receipt=null where id=(p_input->>'id')::uuid
   and receipt=(p_input->>'receipt')::uuid and expires_at>now() and completed_at is null
   and p_input->>'sha256'='ed15dcb0070207c4888e3a31481225ee944cefe4cc9bf47f62df9e2e73f6b524';
  return jsonb_build_object('ok',found);
 end if;
 select * into j from sma_private.gallery_music_v1 where id=(p_input->>'id')::uuid;
 if not found then return '{"ok":false,"code":"NOT_AVAILABLE"}';end if;
 perform pg_advisory_xact_lock(hashtextextended('gallery-music:'||j.customer_id::text,0));
 select * into j from sma_private.gallery_music_v1 where id=j.id for update;
 if j.state<>'pending' or j.lease_until is null or j.lease_until<=now() or j.background_audio is null then return '{"ok":false,"code":"NOT_AVAILABLE"}';end if;
 if p_action='take' then
  if j.background_token is null or j.background_token is distinct from (p_input->>'ticket')::uuid then return '{"ok":false,"code":"NOT_AVAILABLE"}';end if;
  update sma_private.gallery_music_v1 set background_token=null where id=j.id;
 elsif j.background_token is not null or j.lease is null or j.lease is distinct from (p_input->>'lease')::uuid then
  return '{"ok":false,"code":"NOT_AVAILABLE"}';
 end if;
 -- Reuse the production owner, licence, quota and upload gates. The customer
 -- subject is derived only from the locked job. Restore it before returning.
 perform set_config('request.jwt.claim.sub',j.user_id::text,true);
 select * into c from sma_private.music_catalog_owner_v1();
 select * into f from sma_private.publication_files_v1 where id=j.source_id and customer_id=j.customer_id and user_id=j.user_id
  and available and mime_type='video/mp4' and size_bytes between 12 and 24000000 and sma_private.gallery_music_key_v1(revision)=j.source_key;
 bound:=jsonb_build_object('id',j.id,'lease',j.lease);
 if c.id is distinct from j.customer_id or f.id is null or not exists(select from sma_private.music_catalog_ready_v1 t
   where t.sha256=j.track_sha and sma_private.music_track_access_v1(c,t.sha256)) then
  r:='{"ok":false,"code":"NOT_AVAILABLE"}';
 elsif p_action in ('take','check') then
  r:=sma_private.publication_asset_preview_v1(f.id,f.revision)||bound||
   jsonb_build_object('audio_path',j.background_audio,'result_name',j.name);
 elsif p_action='reserve' then
  r:=sma_private.gallery_music_request_v1('reserve',bound||jsonb_build_object('sha256',p_input->>'sha256','size_bytes',p_input->'size_bytes'));
  if r->>'ok'='true' then
   u:=sma_private.publication_upload_request_v1('start',jsonb_build_object('upload_id',j.id,'name',j.name,'mime_type','video/mp4','size_bytes',p_input->'size_bytes'));
   r:=u;
  end if;
 elsif p_action='fallback' and j.expected_sha is null then
  update sma_private.gallery_music_v1 set background_skip=true,background_audio=null,background_token=null,lease=null,lease_until=null where id=j.id;
  r:='{"ok":true}';
 elsif p_action='audio_present' then
  r:=sma_private.gallery_music_request_v1('audio_present',bound);
 else r:='{"ok":false,"code":"INVALID_INPUT"}';end if;
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 return r;
exception when invalid_text_representation then return '{"ok":false,"code":"INVALID_INPUT"}';
end $$;
create function public.sma_gallery_background_v1(p_action text,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select sma_private.gallery_background_action_v1(p_action,p_input)$$;
revoke all on function sma_private.gallery_background_action_v1(text,jsonb),public.sma_gallery_background_v1(text,jsonb) from public,anon,authenticated;
grant execute on function sma_private.gallery_background_action_v1(text,jsonb),public.sma_gallery_background_v1(text,jsonb) to service_role;

-- A tick without an eligible job makes no outbound request and consumes no n8n execution.
create function sma_private.gallery_background_tick_v1() returns bigint
language plpgsql security definer set search_path='' as $$
declare ticket jsonb;
begin
 ticket:=sma_private.gallery_background_pick_v1();
 if ticket is null then return null;end if;
 return net.http_post(url:='https://johnmusic.app.n8n.cloud/webhook/sma-gallery-soundtrack-v1',
  body:=ticket,headers:='{"Content-Type":"application/json"}'::jsonb,timeout_milliseconds:=15000);
end $$;
revoke all on function sma_private.gallery_background_tick_v1() from public,anon,authenticated,service_role;
select cron.schedule('sma-gallery-soundtrack-v1','* * * * *','select sma_private.gallery_background_tick_v1()');
