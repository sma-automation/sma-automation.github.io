-- Preserve known media dimensions and duration only for the exact SHA-256 revision.
-- Each replacement retains the installed access, lease, and validation rules.
CREATE OR REPLACE FUNCTION public.sma_publication_files_finish_v1(p_user_id uuid, p_lease_id uuid, p_files jsonb DEFAULT NULL::jsonb, p_error text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.sma_publication_upload_finish_v1(p_id uuid, p_file jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$;

revoke all on function public.sma_publication_files_finish_v1(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.sma_publication_files_finish_v1(uuid,uuid,jsonb,text) to service_role;
revoke all on function public.sma_publication_upload_finish_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sma_publication_upload_finish_v1(uuid,jsonb) to service_role;
