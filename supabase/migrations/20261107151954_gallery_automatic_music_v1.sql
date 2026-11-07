-- Enqueue new catalogue videos only. Existing assets and publication orders are untouched.
create table sma_private.gallery_music_v1(
 id uuid primary key default gen_random_uuid(),
 customer_id bigint not null references public.sma_kunden(id),user_id uuid not null,
 source_id uuid not null references sma_private.publication_files_v1(id),source_key text not null,
 name text not null,track_sha text references sma_private.music_catalog_v1(sha256),
 state text not null default 'pending' check(state in ('pending','audio_present','unsupported','completed','check_upload')),
 lease uuid,lease_until timestamptz,next_attempt timestamptz not null default now(),created_at timestamptz not null default now(),
 failures integer not null default 0, expected_sha text check(expected_sha ~ '^[a-f0-9]{64}$'), expected_size integer check(expected_size between 12 and 24000000),
 result_id uuid references sma_private.publication_files_v1(id),unique(source_id,source_key)
);
alter table sma_private.gallery_music_v1 enable row level security;
revoke all on sma_private.gallery_music_v1 from public,anon,authenticated,service_role;
create index gallery_music_pending_owner_idx on sma_private.gallery_music_v1(customer_id,user_id,next_attempt,created_at) where state='pending';

create function sma_private.gallery_music_key_v1(rev text) returns text
language sql immutable strict set search_path='' as $$
 select case when rev ~ '^(sha256:[a-f0-9]{64}|md5:[a-f0-9]{32}):[0-9]+$' then split_part(rev,':',1)||':'||split_part(rev,':',2) else rev end
$$;
revoke all on function sma_private.gallery_music_key_v1(text) from public,anon,authenticated,service_role;
create function sma_private.gallery_music_enqueue_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare stem text;
begin
 if new.media_kind<>'video' or new.mime_type<>'video/mp4' or new.size_bytes not between 12 and 24000000 or not new.available then return null;end if;
 if tg_op='UPDATE' then
  if old.revision=new.revision or not exists(select from sma_private.gallery_music_v1 where source_id=new.id) then return null;end if;
 end if;
 -- The resumable upload is bound to its Drive id before bytes are sent / catalogued.
 if exists(select from sma_private.publication_uploads_v1 u join sma_private.gallery_music_v1 j on j.id=u.id
   where u.customer_id=new.customer_id and u.user_id=new.user_id and u.drive_file_id=new.drive_file_id) then return null;end if;
 stem:=trim(left(regexp_replace(translate(regexp_replace(new.name,'\.[^.]*$',''),'/'||chr(92),'  '),
  U&'[[:cntrl:]\202A-\202E\2066-\2069]',' ','g'),90));
 insert into sma_private.gallery_music_v1(customer_id,user_id,source_id,source_key,name)
 values(new.customer_id,new.user_id,new.id,sma_private.gallery_music_key_v1(new.revision),coalesce(nullif(stem,''),'Video')||' – mit SMA-Musik.mp4')
 on conflict(source_id,source_key) do nothing;
 return null;
end $$;
revoke all on function sma_private.gallery_music_enqueue_v1() from public,anon,authenticated,service_role;
create trigger gallery_music_on_arrival after insert or update of revision on sma_private.publication_files_v1
for each row execute function sma_private.gallery_music_enqueue_v1();

create function sma_private.gallery_music_request_v1(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.sma_kunden%rowtype;j sma_private.gallery_music_v1%rowtype;
 f sma_private.publication_files_v1%rowtype;t sma_private.music_catalog_v1%rowtype;
 u sma_private.publication_uploads_v1%rowtype; out_file sma_private.publication_files_v1%rowtype;
begin
 select * into c from sma_private.music_catalog_owner_v1();
 if not found then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>768 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform pg_advisory_xact_lock(hashtextextended('gallery-music:'||c.id::text,0));
 if p_action='claim' and p_input='{}' then
  if exists(select from sma_private.gallery_music_v1 where customer_id=c.id and user_id=c.user_id and state='pending' and lease_until>now()) then
   return jsonb_build_object('ok',true,'state','busy');end if;
  select j0.* into j from sma_private.gallery_music_v1 j0 join sma_private.publication_files_v1 f0 on f0.id=j0.source_id
   and f0.customer_id=c.id and f0.user_id=c.user_id and f0.available and f0.mime_type='video/mp4' and f0.size_bytes between 12 and 24000000 and sma_private.gallery_music_key_v1(f0.revision)=j0.source_key
   where j0.customer_id=c.id and j0.user_id=c.user_id and j0.state='pending'
   order by j0.next_attempt,j0.created_at,j0.id limit 1 for update of j0;
  if not found then return jsonb_build_object('ok',true,'state','idle');end if;
  if j.next_attempt>now() then return jsonb_build_object('ok',true,'state','waiting',
   'retry_ms',ceil(extract(epoch from j.next_attempt-now())*1000));end if;
  select * into f from sma_private.publication_files_v1 where id=j.source_id;
  -- A lost completion response or a closed browser must not produce another upload.
  select * into u from sma_private.publication_uploads_v1 where id=j.id and user_id=c.user_id and customer_id=c.id;
  if u.id is not null and j.expected_sha is not null then
   select * into out_file from sma_private.publication_files_v1 where customer_id=c.id and user_id=c.user_id and available
    and id<>j.source_id and drive_file_id=u.drive_file_id and u.name=j.name and u.size_bytes=j.expected_size and u.mime_type='video/mp4'
    and (u.status='ready' or (u.status='completed' and u.asset_id=id)) and name=j.name and mime_type='video/mp4' and size_bytes=j.expected_size
    and split_part(revision,':',1)='sha256' and split_part(revision,':',2)=j.expected_sha;
   if out_file.id is not null then
    update sma_private.gallery_music_v1 set state='completed',result_id=out_file.id,lease=null,lease_until=null where id=j.id;
    return jsonb_build_object('ok',true,'state','completed','asset_id',out_file.id);
   elsif u.status='completed' or u.expires_at<=now() then
    update sma_private.gallery_music_v1 set state='check_upload',lease=null,lease_until=null where id=j.id;
    return jsonb_build_object('ok',true,'state','check_upload');
   end if;
  end if;
  select t0.* into t from sma_private.music_catalog_ready_v1 t0 where sma_private.music_track_access_v1(c,t0.sha256)
   and (j.expected_sha is null or t0.sha256=j.track_sha)
   order by (t0.sha256=j.track_sha) desc nulls last,md5(j.source_id::text||t0.sha256),t0.sha256 limit 1;
  if not found then
   if j.expected_sha is not null then update sma_private.gallery_music_v1 set next_attempt=now()+interval '15 minutes' where id=j.id;
    return jsonb_build_object('ok',true,'state','deferred');end if;
   return jsonb_build_object('ok',true,'state','no_track');end if;
  update sma_private.gallery_music_v1 set lease=gen_random_uuid(),lease_until=now()+interval '20 minutes',track_sha=t.sha256 where id=j.id returning * into j;
  return jsonb_build_object('ok',true,'state','claimed','id',j.id,'lease',j.lease,'name',j.name,
   'file',jsonb_build_object('id',f.id,'revision',f.revision,'mime_type',f.mime_type,'size_bytes',f.size_bytes),
   'track',jsonb_build_object('name',t.name,'sha256',t.sha256,'mime_type',t.mime_type,'size_bytes',t.size_bytes,'volume',25,'start_ms',0));
 end if;
 select * into j from sma_private.gallery_music_v1 where id=(p_input->>'id')::uuid and customer_id=c.id and user_id=c.user_id for update;
 if not found or j.state<>'pending' or j.lease is null or j.lease is distinct from (p_input->>'lease')::uuid or j.lease_until<=now() then
  return jsonb_build_object('ok',false,'code','LEASE_CHANGED');end if;
 if p_action='retry' then
  update sma_private.gallery_music_v1 set lease=null,lease_until=null,failures=least(failures+1,8),
   next_attempt=now()+interval '2 minutes'*(1<<least(failures,7)) where id=j.id;
  return jsonb_build_object('ok',true);
 end if;
 select * into f from sma_private.publication_files_v1 where id=j.source_id and user_id=c.user_id and customer_id=c.id and available
  and sma_private.gallery_music_key_v1(revision)=j.source_key;
 if not found then return jsonb_build_object('ok',false,'code','SOURCE_CHANGED');end if;
 if p_action in ('audio_present','unsupported') and j.expected_sha is null then
  update sma_private.gallery_music_v1 set state=p_action,lease=null,lease_until=null where id=j.id;
 elsif p_action='reserve' then
  if coalesce(p_input->>'sha256','') !~ '^[a-f0-9]{64}$' or coalesce(p_input->>'size_bytes','') !~ '^[1-9][0-9]{0,7}$' or
   (p_input->>'size_bytes')::integer not between 12 and 24000000 then return jsonb_build_object('ok',false,'code','INVALID_OUTPUT');end if;
  if not exists(select from sma_private.music_catalog_ready_v1 k where k.sha256=j.track_sha and sma_private.music_track_access_v1(c,k.sha256))
   then return jsonb_build_object('ok',false,'code','TRACK_UNAVAILABLE');end if;
  if j.expected_sha is not null and (j.expected_sha<>p_input->>'sha256' or j.expected_size<>(p_input->>'size_bytes')::int)
   then return jsonb_build_object('ok',false,'code','OUTPUT_CHANGED');end if;
  update sma_private.gallery_music_v1 set expected_sha=p_input->>'sha256',expected_size=(p_input->>'size_bytes')::int where id=j.id;
 elsif p_action='complete' then
  select g.* into out_file from sma_private.publication_uploads_v1 u0 join sma_private.publication_files_v1 g on g.id=u0.asset_id and g.drive_file_id=u0.drive_file_id
   where u0.id=j.id and u0.status='completed' and u0.user_id=c.user_id and u0.customer_id=c.id and g.user_id=c.user_id and g.customer_id=c.id and g.available
   and g.id<>j.source_id and g.name=j.name and g.mime_type='video/mp4' and g.size_bytes=j.expected_size
   and split_part(g.revision,':',1)='sha256' and split_part(g.revision,':',2)=j.expected_sha;
  if not found then return jsonb_build_object('ok',false,'code','UPLOAD_INCOMPLETE');end if;
  update sma_private.gallery_music_v1 set state='completed',result_id=out_file.id,lease=null,lease_until=null where id=j.id;
  return jsonb_build_object('ok',true,'state','completed','asset_id',out_file.id);
 else return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 return jsonb_build_object('ok',true);
exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('ok',false,'code','INVALID_INPUT');
end $$;
create function public.sma_gallery_music_v1(p_action text,p_input jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select sma_private.gallery_music_request_v1(p_action,p_input)$$;
revoke all on function public.sma_gallery_music_v1(text,jsonb),sma_private.gallery_music_request_v1(text,jsonb) from public,anon,service_role;
grant execute on function public.sma_gallery_music_v1(text,jsonb),sma_private.gallery_music_request_v1(text,jsonb) to authenticated;
