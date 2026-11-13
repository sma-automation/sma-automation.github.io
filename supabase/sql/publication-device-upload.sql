-- Device uploads are private preparation assets, never publication authorization.
create table if not exists sma_private.publication_uploads_v1 (
 id uuid primary key, user_id uuid not null, customer_id bigint not null references public.sma_kunden(id),
 n8n_kunde_id text not null, kunde_email text not null, name text not null, mime_type text not null,
 size_bytes bigint not null check(size_bytes between 1 and 4000000000),
 status text not null default 'initializing' check(status in ('initializing','ready','completed')),
 lease_id uuid not null default gen_random_uuid(), lease_until timestamptz not null default now()+interval '2 minutes',
 drive_file_id text unique, folder_id text, upload_url text, asset_id uuid references sma_private.publication_files_v1(id),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '1 day', completed_at timestamptz
);
create index if not exists publication_uploads_v1_owner_created on sma_private.publication_uploads_v1(user_id,created_at desc);
alter table sma_private.publication_uploads_v1 enable row level security;
revoke all on sma_private.publication_uploads_v1 from public,anon,authenticated;
grant select,insert,update on sma_private.publication_uploads_v1 to service_role;

create or replace function sma_private.publication_upload_request_v1(p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); c public.sma_kunden%rowtype; u sma_private.publication_uploads_v1%rowtype; requested uuid; initialize boolean:=false;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED'); end if;
 if p_action is null or p_action not in ('start','finish') or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>3000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
 if (select count(*) from public.sma_kunden where user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE'); end if;
 -- Serialize reservations per customer, including hourly/daily quotas.
 select * into c from public.sma_kunden where user_id=uid for update;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) or c.n8n_kunde_id is null or c.kunde_email is null then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE'); end if;
 if coalesce(p_input->>'upload_id','')!~* '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
 requested:=(p_input->>'upload_id')::uuid;
 select * into u from sma_private.publication_uploads_v1 where id=requested for update;
 if found then
  if u.user_id<>uid or u.customer_id<>c.id or u.n8n_kunde_id is distinct from c.n8n_kunde_id or u.kunde_email is distinct from c.kunde_email then return jsonb_build_object('ok',false,'code','UPLOAD_UNAVAILABLE'); end if;
  if p_action='start' and (p_input->>'name' is distinct from u.name or p_input->>'mime_type' is distinct from u.mime_type or p_input->>'size_bytes' is distinct from u.size_bytes::text) then return jsonb_build_object('ok',false,'code','UPLOAD_CONFLICT'); end if;
  if u.status='completed' then return jsonb_build_object('ok',true,'status','completed','upload_id',u.id,'asset_id',u.asset_id,'can_publish',false); end if;
  if u.expires_at<now() then return jsonb_build_object('ok',false,'code','UPLOAD_EXPIRED'); end if;
  if u.status='initializing' then
   if p_action<>'start' or u.lease_until>now() then return jsonb_build_object('ok',false,'code','UPLOAD_INITIALIZING'); end if;
   update sma_private.publication_uploads_v1 set lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes' where id=u.id returning * into u;
   initialize:=true;
  end if;
 else
  if p_action<>'start' then return jsonb_build_object('ok',false,'code','UPLOAD_UNAVAILABLE'); end if;
  if jsonb_typeof(p_input->'name') is distinct from 'string' or char_length(btrim(p_input->>'name')) not between 1 and 250 or (p_input->>'name')~'[[:cntrl:]/\\]' or exists(select 1 from regexp_split_to_table(p_input->>'name','') ch where ascii(ch) between 8234 and 8238 or ascii(ch) between 8294 and 8297) then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
  if coalesce(p_input->>'mime_type','') not in ('image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','image/avif','image/tiff','image/bmp','video/mp4','video/quicktime','video/webm','video/x-msvideo','video/mpeg','video/x-matroska','video/3gpp') then return jsonb_build_object('ok',false,'code','UPLOAD_FORMAT'); end if;
  if coalesce(p_input->>'size_bytes','')!~'^[1-9][0-9]{0,9}$' then return jsonb_build_object('ok',false,'code','UPLOAD_SIZE'); end if;
  if (p_input->>'size_bytes')::bigint>4000000000 then return jsonb_build_object('ok',false,'code','UPLOAD_SIZE'); end if;
  if (select count(*) from sma_private.publication_uploads_v1 where user_id=uid and created_at>now()-interval '1 hour')>=30 or (select coalesce(sum(size_bytes),0) from sma_private.publication_uploads_v1 where user_id=uid and created_at>now()-interval '1 day')+(p_input->>'size_bytes')::bigint>20000000000 then return jsonb_build_object('ok',false,'code','UPLOAD_RATE_LIMITED'); end if;
  insert into sma_private.publication_uploads_v1(id,user_id,customer_id,n8n_kunde_id,kunde_email,name,mime_type,size_bytes) values(requested,uid,c.id,c.n8n_kunde_id,c.kunde_email,p_input->>'name',p_input->>'mime_type',(p_input->>'size_bytes')::bigint) returning * into u;
  initialize:=true;
 end if;
 return jsonb_build_object('ok',true,'status',u.status,'initialize',initialize,'upload_id',u.id,'user_id',u.user_id,'customer_id',u.customer_id,'n8n_kunde_id',u.n8n_kunde_id,'kunde_email',u.kunde_email,'name',u.name,'mime_type',u.mime_type,'size_bytes',u.size_bytes,'lease_id',u.lease_id,'drive_file_id',u.drive_file_id,'folder_id',u.folder_id,'upload_url',u.upload_url,'can_publish',false);
end $$;
revoke all on function sma_private.publication_upload_request_v1(text,jsonb) from public,anon,authenticated;
grant execute on function sma_private.publication_upload_request_v1(text,jsonb) to authenticated;
create or replace function public.sma_publication_upload_v1(p_action text,p_input jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select sma_private.publication_upload_request_v1(p_action,p_input);$$;
revoke all on function public.sma_publication_upload_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.sma_publication_upload_v1(text,jsonb) to authenticated;

create or replace function public.sma_publication_upload_bind_v1(p_id uuid,p_lease_id uuid,p_drive_file_id text,p_folder_id text,p_upload_url text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare u sma_private.publication_uploads_v1%rowtype;
begin
 select * into u from sma_private.publication_uploads_v1 where id=p_id for update;
 if not found or u.status<>'initializing' or p_lease_id is distinct from u.lease_id or u.lease_until<now() then return jsonb_build_object('ok',false,'code','UPLOAD_UNAVAILABLE'); end if;
 if p_drive_file_id is null or p_drive_file_id!~'^[A-Za-z0-9_-]{10,200}$' or p_folder_id is null or p_folder_id!~'^[A-Za-z0-9_-]{10,200}$' or p_upload_url is null or length(p_upload_url)>4000 or p_upload_url!~'^https://www\.googleapis\.com/upload/drive/v3/files\?(uploadType=resumable|supportsAllDrives=true|upload_id=[A-Za-z0-9_.%~=-]+|session_crd=[A-Za-z0-9_.%~=-]+)(&(uploadType=resumable|supportsAllDrives=true|upload_id=[A-Za-z0-9_.%~=-]+|session_crd=[A-Za-z0-9_.%~=-]+))*$' or p_upload_url!~'[?&]uploadType=resumable(&|$)' or p_upload_url!~'[?&]upload_id=[A-Za-z0-9_.%~=-]+(&|$)' then return jsonb_build_object('ok',false,'code','UPLOAD_UNAVAILABLE'); end if;
 if not exists(select 1 from public.sma_kunden c where c.id=u.customer_id and c.user_id=u.user_id and c.aktiv and (c.demo_delta_aktiv or c.zahlung_bestaetigt) and c.n8n_kunde_id=u.n8n_kunde_id and c.kunde_email=u.kunde_email) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE'); end if;
 update sma_private.publication_uploads_v1 set drive_file_id=p_drive_file_id,folder_id=p_folder_id,upload_url=p_upload_url,status='ready' where id=u.id;
 return jsonb_build_object('ok',true,'status','ready','upload_id',u.id,'upload_url',p_upload_url,'can_publish',false);
end $$;
revoke all on function public.sma_publication_upload_bind_v1(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.sma_publication_upload_bind_v1(uuid,uuid,text,text,text) to service_role;

create or replace function public.sma_publication_upload_finish_v1(p_id uuid,p_file jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare u sma_private.publication_uploads_v1%rowtype; asset uuid;
begin
 select * into u from sma_private.publication_uploads_v1 where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'code','UPLOAD_UNAVAILABLE'); end if;
 if not exists(select 1 from public.sma_kunden c where c.id=u.customer_id and c.user_id=u.user_id and c.aktiv and (c.demo_delta_aktiv or c.zahlung_bestaetigt) and c.n8n_kunde_id=u.n8n_kunde_id and c.kunde_email=u.kunde_email) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE'); end if;
 if u.status='completed' then return jsonb_build_object('ok',true,'status','completed','upload_id',u.id,'asset_id',u.asset_id,'can_publish',false); end if;
 if u.status<>'ready' or u.expires_at<now() then return jsonb_build_object('ok',false,'code','UPLOAD_EXPIRED'); end if;
 if jsonb_typeof(p_file) is distinct from 'object' or p_file->>'drive_file_id' is distinct from u.drive_file_id or p_file->>'name' is distinct from u.name or p_file->>'mime_type' is distinct from u.mime_type or p_file->>'size_bytes' is distinct from u.size_bytes::text or p_file->>'folder_id' is distinct from u.folder_id or p_file->>'upload_id' is distinct from u.id::text or coalesce(p_file->>'revision','')!~'^(sha256:[a-f0-9]{64}|md5:[a-f0-9]{32}):[0-9]{1,30}$' or p_file->>'media_kind' is distinct from split_part(u.mime_type,'/',1) or coalesce(p_file->>'modified_at','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' then return jsonb_build_object('ok',false,'code','UPLOAD_INCOMPLETE'); end if;
 insert into sma_private.publication_files_v1 as catalog(customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,width_px,height_px,duration_ms)
 values(u.customer_id,u.user_id,u.drive_file_id,u.name,split_part(u.mime_type,'/',1),u.mime_type,p_file->>'revision',(p_file->>'modified_at')::timestamptz,u.size_bytes,(p_file->>'width_px')::integer,(p_file->>'height_px')::integer,(p_file->>'duration_ms')::bigint)
 on conflict(customer_id,drive_file_id) do update set name=excluded.name,mime_type=excluded.mime_type,media_kind=excluded.media_kind,revision=excluded.revision,modified_at=excluded.modified_at,size_bytes=excluded.size_bytes,(width_px,height_px,duration_ms) = (
    select coalesce(excluded.width_px, case when same_source then catalog.width_px end),
           coalesce(excluded.height_px, case when same_source then catalog.height_px end),
           coalesce(excluded.duration_ms, case when same_source then catalog.duration_ms end)
    from (select catalog.user_id = excluded.user_id
      and catalog.revision = excluded.revision
      and catalog.revision ~ '^sha256:[0-9a-f]{64}:[0-9]{1,30}$'
      and catalog.size_bytes = excluded.size_bytes
      and catalog.mime_type = excluded.mime_type
      and catalog.media_kind = excluded.media_kind
      and (catalog.width_px is null or excluded.width_px is null or catalog.width_px = excluded.width_px)
      and (catalog.height_px is null or excluded.height_px is null or catalog.height_px = excluded.height_px)
      and (catalog.duration_ms is null or excluded.duration_ms is null or catalog.duration_ms = excluded.duration_ms)
     as same_source) as identity_check
   ),available=true,verified_at=now() returning id into asset;
 update sma_private.publication_uploads_v1 set status='completed',asset_id=asset,upload_url=null,completed_at=now() where id=u.id;
 return jsonb_build_object('ok',true,'status','completed','upload_id',u.id,'asset_id',asset,'can_publish',false);
end $$;
revoke all on function public.sma_publication_upload_finish_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sma_publication_upload_finish_v1(uuid,jsonb) to service_role;

-- A catalogue scan started before an upload must not hide that new file.
create or replace function public.sma_publication_files_finish_v1(p_user_id uuid,p_lease_id uuid,p_files jsonb default null,p_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s sma_private.publication_file_sync_v1%rowtype; c public.sma_kunden%rowtype; x jsonb;
begin
 select * into s from sma_private.publication_file_sync_v1 where user_id=p_user_id for update;
 if not found or p_lease_id is null or s.lease_until is null or s.lease_id is distinct from p_lease_id or s.lease_until<now() then return jsonb_build_object('ok',false,'code','INVALID_LEASE'); end if;
 select * into c from public.sma_kunden where id=s.customer_id and user_id=s.user_id;
 if not found or c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) or c.n8n_kunde_id is distinct from s.n8n_kunde_id or c.kunde_email is distinct from s.kunde_email then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE'); end if;
 if p_error is not null then
  update sma_private.publication_file_sync_v1 set lease_until=null,lease_id=null where user_id=s.user_id;
  return jsonb_build_object('ok',false,'code',case when p_error in ('FOLDER_UNAVAILABLE','FILE_CATALOG_TOO_LARGE','FILE_METADATA_INVALID') then p_error else 'FILE_SYNC_UNAVAILABLE' end);
 end if;
 if jsonb_typeof(p_files) is distinct from 'array' or octet_length(p_files::text)>2000000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
 if jsonb_array_length(p_files)>1000 or (select count(distinct v->>'drive_file_id') from jsonb_array_elements(p_files) v)<>jsonb_array_length(p_files) then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
 for x in select value from jsonb_array_elements(p_files) loop
  if jsonb_typeof(x) is distinct from 'object' or coalesce(x->>'drive_file_id','')!~'^[A-Za-z0-9_-]{10,200}$' or char_length(coalesce(x->>'name','')) not between 1 and 500 or coalesce(x->>'media_kind','') not in ('image','video') or char_length(coalesce(x->>'revision','')) not between 1 and 250 or coalesce(x->>'mime_type','')!~'^(image|video)/[a-zA-Z0-9.+-]+$' or coalesce(x->>'size_bytes','')!~'^[0-9]{1,18}$' or coalesce(x->>'modified_at','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' then return jsonb_build_object('ok',false,'code','FILE_METADATA_INVALID'); end if;
  if (x->'width_px' is not null and x->'width_px'<>'null'::jsonb and (jsonb_typeof(x->'width_px')<>'number' or (x->>'width_px')!~'^[1-9][0-9]{0,6}$'))
   or (x->'height_px' is not null and x->'height_px'<>'null'::jsonb and (jsonb_typeof(x->'height_px')<>'number' or (x->>'height_px')!~'^[1-9][0-9]{0,6}$'))
   or (x->'duration_ms' is not null and x->'duration_ms'<>'null'::jsonb and (jsonb_typeof(x->'duration_ms')<>'number' or (x->>'duration_ms')!~'^[0-9]{1,13}$')) then return jsonb_build_object('ok',false,'code','FILE_METADATA_INVALID'); end if;
  if (x->>'width_px')::integer>1000000 or (x->>'height_px')::integer>1000000 or (x->>'duration_ms')::bigint>9999999999999 then return jsonb_build_object('ok',false,'code','FILE_METADATA_INVALID'); end if;
 end loop;
 update sma_private.publication_files_v1 set available=false where customer_id=c.id and user_id=c.user_id and verified_at<=s.started_at;
 for x in select value from jsonb_array_elements(p_files) loop
  insert into sma_private.publication_files_v1 as catalog(customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,available,verified_at,width_px,height_px,duration_ms)
  values(c.id,c.user_id,x->>'drive_file_id',x->>'name',x->>'media_kind',x->>'mime_type',x->>'revision',(x->>'modified_at')::timestamptz,(x->>'size_bytes')::bigint,true,now(),(x->>'width_px')::integer,(x->>'height_px')::integer,(x->>'duration_ms')::bigint)
  on conflict(customer_id,drive_file_id) do update set name=excluded.name,media_kind=excluded.media_kind,mime_type=excluded.mime_type,revision=excluded.revision,modified_at=excluded.modified_at,size_bytes=excluded.size_bytes,available=true,verified_at=now(),(width_px,height_px,duration_ms) = (
    select coalesce(excluded.width_px, case when same_source then catalog.width_px end),
           coalesce(excluded.height_px, case when same_source then catalog.height_px end),
           coalesce(excluded.duration_ms, case when same_source then catalog.duration_ms end)
    from (select catalog.user_id = excluded.user_id
      and catalog.revision = excluded.revision
      and catalog.revision ~ '^sha256:[0-9a-f]{64}:[0-9]{1,30}$'
      and catalog.size_bytes = excluded.size_bytes
      and catalog.mime_type = excluded.mime_type
      and catalog.media_kind = excluded.media_kind
      and (catalog.width_px is null or excluded.width_px is null or catalog.width_px = excluded.width_px)
      and (catalog.height_px is null or excluded.height_px is null or catalog.height_px = excluded.height_px)
      and (catalog.duration_ms is null or excluded.duration_ms is null or catalog.duration_ms = excluded.duration_ms)
     as same_source) as identity_check
   );
 end loop;
 update sma_private.publication_file_sync_v1 set lease_until=null,lease_id=null,finished_at=now() where user_id=c.user_id;
 return jsonb_build_object('ok',true,'count',jsonb_array_length(p_files));
end $$;
revoke all on function public.sma_publication_files_finish_v1(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.sma_publication_files_finish_v1(uuid,uuid,jsonb,text) to service_role;
