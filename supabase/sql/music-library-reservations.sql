-- Reclaim stale empty reservations only during an authenticated prepare.
-- No Storage rows/objects are changed and no scheduled job is installed.
-- Existing signatures, ACLs, ownership checks and client responses are retained.

create or replace function sma_private.music_storage_allowed_v1(p_name text,p_metadata jsonb default null)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare t sma_private.music_library_v1%rowtype;c public.sma_kunden%rowtype;uid uuid:=auth.uid();
begin
 if uid is null or (select count(*) from public.sma_kunden where user_id=uid)<>1 then return false;end if;
 select * into c from public.sma_kunden where user_id=uid;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return false;end if;
 -- Serialize the final Storage INSERT check with quota cleanup. VOLATILE
 -- gives the lookup after this lock a fresh snapshot, including a waited commit.
 if p_metadata is not null then
  perform pg_advisory_xact_lock(hashtextextended(uid::text||':music',0));
 end if;
 select * into t from sma_private.music_library_v1 where object_name=p_name and user_id=uid and customer_id=c.id;
 if not found then return false;end if;
 if p_metadata is not null then
  if t.status<>'pending' or coalesce(p_metadata->>'size',p_metadata->>'contentLength','') !~ '^[0-9]{1,9}$' then return false;end if;
  return coalesce(p_metadata->>'size',p_metadata->>'contentLength')::bigint=t.size_bytes and p_metadata->>'mimetype'=t.mime_type;
 end if;
 return true;
end $$;

create or replace function sma_private.music_library_request_v1(p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();c public.sma_kunden%rowtype;t sma_private.music_library_v1%rowtype;items jsonb;v_hash text;meta jsonb;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_action is null or p_action not in ('list','prepare','complete','get','favourite') or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>2000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if (select count(*) from public.sma_kunden where user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end if;
 select * into c from public.sma_kunden where user_id=uid;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 if p_action='list' then
  if p_input<>'{}'::jsonb then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'sha256',sha256,'size_bytes',size_bytes,'mime_type',mime_type,'favourite',favourite,'status',status,'object_name',object_name) order by created_at desc,id),'[]') into items from sma_private.music_library_v1 where user_id=uid and customer_id=c.id and status='ready';
  return jsonb_build_object('ok',true,'version',1,'tracks',items,'limit_bytes',100000000);
 end if;
 if coalesce(p_input->>'sha256','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 v_hash:=p_input->>'sha256';
 if p_action='prepare' then
  if (select count(*) from jsonb_object_keys(p_input))<>4 or not(p_input ?& array['name','sha256','size_bytes','mime_type']) or jsonb_typeof(p_input->'name') is distinct from 'string' or char_length(p_input->>'name') not between 1 and 180 or (p_input->>'name') ~ '[[:cntrl:]]' or coalesce(p_input->>'mime_type','') not in ('audio/mpeg','audio/wav') or jsonb_typeof(p_input->'size_bytes') is distinct from 'number' or coalesce(p_input->>'size_bytes','') !~ '^[0-9]{1,9}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  if (p_input->>'size_bytes')::bigint not between 12 and 8000000 then return jsonb_build_object('ok',false,'code','MUSIC_INVALID');end if;
 elsif p_action='favourite' then
  if (select count(*) from jsonb_object_keys(p_input))<>2 or jsonb_typeof(p_input->'favourite') is distinct from 'boolean' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 elsif p_input<>jsonb_build_object('sha256',v_hash) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 -- Serialize quota reservations, duplicate uploads and playlist changes per customer.
 perform pg_advisory_xact_lock(hashtextextended(uid::text||':music',0));
 -- Reclaim only old, empty reservations for this owner/customer.
 -- Keep ready tracks and EVERY Storage object, even incomplete/mismatched ones.
 if p_action='prepare' then
  delete from sma_private.music_library_v1 pending
   where pending.user_id=uid and pending.customer_id=c.id and pending.status='pending'
    and pending.created_at<now()-interval '24 hours'
    and not exists(select 1 from storage.objects o where o.bucket_id='sma-musik' and o.name=pending.object_name);
 end if;
 select * into t from sma_private.music_library_v1 where user_id=uid and customer_id=c.id and sha256=v_hash;
 if p_action='prepare' then
  if found then
   if t.size_bytes<>(p_input->>'size_bytes')::bigint or t.mime_type<>p_input->>'mime_type' then return jsonb_build_object('ok',false,'code','MUSIC_CONFLICT');end if;
  else
   if (select count(*) from sma_private.music_library_v1 where user_id=uid and customer_id=c.id)>=100 or (select coalesce(sum(size_bytes),0) from sma_private.music_library_v1 where user_id=uid and customer_id=c.id)+(p_input->>'size_bytes')::bigint>100000000 then return jsonb_build_object('ok',false,'code','MUSIC_LIMIT');end if;
   insert into sma_private.music_library_v1(user_id,customer_id,name,sha256,size_bytes,mime_type,object_name)
    values(uid,c.id,p_input->>'name',v_hash,(p_input->>'size_bytes')::bigint,p_input->>'mime_type',uid::text||'/'||v_hash||case when p_input->>'mime_type'='audio/wav' then '.wav' else '.mp3' end) returning * into t;
  end if;
 elsif not found then return jsonb_build_object('ok',false,'code','MUSIC_NOT_FOUND');
 elsif p_action='complete' then
  select metadata into meta from storage.objects where bucket_id='sma-musik' and name=t.object_name;
  if not found or coalesce(meta->>'size','') !~ '^[0-9]{1,9}$' then return jsonb_build_object('ok',false,'code','MUSIC_INCOMPLETE');end if;
  if (meta->>'size')::bigint<>t.size_bytes or meta->>'mimetype' is distinct from t.mime_type then return jsonb_build_object('ok',false,'code','MUSIC_INCOMPLETE');end if;
  update sma_private.music_library_v1 set status='ready' where id=t.id returning * into t;
 elsif t.status<>'ready' then return jsonb_build_object('ok',false,'code','MUSIC_NOT_FOUND');
 elsif p_action='favourite' then update sma_private.music_library_v1 set favourite=(p_input->>'favourite')::boolean where id=t.id returning * into t;
 end if;
 return jsonb_build_object('ok',true,'version',1,'track',jsonb_build_object('id',t.id,'name',t.name,'sha256',t.sha256,'size_bytes',t.size_bytes,'mime_type',t.mime_type,'favourite',t.favourite,'status',t.status,'object_name',t.object_name));
end $$;
