-- Optional local music recipe and owner-bound exported cover lookup. No publication.
create or replace function sma_private.publication_editor_settings_valid_v1(s jsonb,f sma_private.publication_files_v1)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare k text;v numeric;end_time numeric;m jsonb;
begin
 if jsonb_typeof(s) is distinct from 'object' or octet_length(s::text)>4000 then return false;end if;
 if (select count(*) from jsonb_object_keys(s)) not in (10,11) or not(s ?& array['format','fit','position_x','position_y','start_ms','end_ms','cover_ms','overlay_text','overlay_position','audio_volume']) or exists(select 1 from jsonb_object_keys(s) x where x not in
  ('format','fit','position_x','position_y','start_ms','end_ms','cover_ms','overlay_text','overlay_position','audio_volume','music')) then return false;end if;
 if coalesce(s->>'format','') not in ('original','9:16','1:1','16:9') or coalesce(s->>'fit','') not in ('contain','cover')
  or coalesce(s->>'overlay_position','') not in ('top','center','bottom')
  or jsonb_typeof(s->'overlay_text') is distinct from 'string' or char_length(s->>'overlay_text')>160
  or (s->>'overlay_text') ~ '[[:cntrl:]]' then return false;end if;
 foreach k in array array['position_x','position_y','start_ms','end_ms','cover_ms','audio_volume'] loop
  if k in ('end_ms','cover_ms') and s->k='null'::jsonb then continue;end if;
  if jsonb_typeof(s->k) is distinct from 'number' or (s->>k) !~ '^[0-9]{1,14}$' then return false;end if;
  v:=(s->>k)::numeric;
  if k in ('position_x','position_y','audio_volume') and v>100 then return false;end if;
 end loop;
 if f.media_kind='image' or f.duration_ms is null or f.duration_ms<=0 then
  if s->'start_ms'<>'0'::jsonb or s->'end_ms'<>'null'::jsonb or s->'cover_ms'<>'null'::jsonb then return false;end if;
 else
  end_time:=coalesce((s->>'end_ms')::numeric,f.duration_ms);
  if (s->>'start_ms')::numeric>=end_time or end_time>f.duration_ms then return false;end if;
  if s->'cover_ms'<>'null'::jsonb and ((s->>'cover_ms')::numeric<(s->>'start_ms')::numeric or (s->>'cover_ms')::numeric>=end_time) then return false;end if;
 end if;
 if f.media_kind='image' and s->'audio_volume'<>'100'::jsonb then return false;end if;
 if s?'music' then
  m:=s->'music';
  if f.media_kind<>'video' or jsonb_typeof(m) is distinct from 'object' then return false;end if;
  if (select count(*) from jsonb_object_keys(m))<>6 or not(m ?& array['name','sha256','size_bytes','mime_type','volume','start_ms'])
   or jsonb_typeof(m->'name') is distinct from 'string' or char_length(m->>'name') not between 1 and 180 or (m->>'name') ~ '[[:cntrl:]]'
   or coalesce(m->>'sha256','') !~ '^[a-f0-9]{64}$' or coalesce(m->>'mime_type','') not in ('audio/mpeg','audio/wav') then return false;end if;
  foreach k in array array['size_bytes','volume','start_ms'] loop
   if jsonb_typeof(m->k) is distinct from 'number' or (m->>k) !~ '^[0-9]{1,9}$' then return false;end if;
  end loop;
  if (m->>'size_bytes')::bigint not between 12 and 8000000 or (m->>'volume')::int>100 or (m->>'start_ms')::int>=600000 then return false;end if;
 end if;
 return true;
end $$;
revoke all on function sma_private.publication_editor_settings_valid_v1(jsonb,sma_private.publication_files_v1) from public,anon,authenticated,service_role;

create or replace function sma_private.publication_editor_request_v1(p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid();c public.sma_kunden%rowtype;f sma_private.publication_files_v1%rowtype;
 d sma_private.publication_editor_drafts_v1%rowtype;h sma_private.publication_editor_history_v1%rowtype;
 previous jsonb;s jsonb;changes jsonb;wanted integer;v_request_id uuid;was_changed boolean:=false;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_action is null or p_action not in ('get','save') or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>6000
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('asset_id','asset_revision','revision','request_id','settings'))
  or coalesce(p_input->>'asset_id','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or jsonb_typeof(p_input->'asset_revision') is distinct from 'string' or char_length(p_input->>'asset_revision') not between 1 and 250
  then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if p_action='get' and exists(select 1 from jsonb_object_keys(p_input) k where k not in ('asset_id','asset_revision')) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if (select count(*) from public.sma_kunden where user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end if;
 select * into c from public.sma_kunden where user_id=uid;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 -- Serializes concurrent saves for this file; ownership and revision are checked under the same lock.
 select * into f from sma_private.publication_files_v1 where id=(p_input->>'asset_id')::uuid and user_id=uid and customer_id=c.id and available for update;
 if not found then return jsonb_build_object('ok',false,'code','FILE_UNAVAILABLE');end if;
 if f.revision is distinct from p_input->>'asset_revision' then return jsonb_build_object('ok',false,'code','FILE_CHANGED');end if;
 select * into d from sma_private.publication_editor_drafts_v1 where asset_id=f.id and asset_revision=f.revision;
 if found and (d.user_id<>uid or d.customer_id<>c.id) then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end if;
 previous:=coalesce(d.settings,sma_private.publication_editor_defaults_v1());
 if p_action='save' then
  if jsonb_typeof(p_input->'revision') is distinct from 'number' or coalesce(p_input->>'revision','') !~ '^[0-9]{1,9}$'
   or coalesce(p_input->>'request_id','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   or not sma_private.publication_editor_settings_valid_v1(p_input->'settings',f) then return jsonb_build_object('ok',false,'code','INVALID_SETTINGS');end if;
  wanted:=(p_input->>'revision')::integer;v_request_id:=(p_input->>'request_id')::uuid;s:=p_input->'settings';
  select * into h from sma_private.publication_editor_history_v1 q where q.asset_id=f.id and q.asset_revision=f.revision and q.request_id=v_request_id;
  if found then
   if h.user_id<>uid or h.customer_id<>c.id or h.expected_revision<>wanted or h.settings<>s then return jsonb_build_object('ok',false,'code','REQUEST_CONFLICT');end if;
   if d.revision is distinct from h.revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT');end if;
  elsif wanted<>coalesce(d.revision,0) then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT');
  elsif s is distinct from previous then
   if (select count(*) from sma_private.publication_editor_history_v1 where user_id=uid and customer_id=c.id and recorded_at>now()-interval '1 hour')>=120 then return jsonb_build_object('ok',false,'code','RATE_LIMITED');end if;
   select jsonb_agg(k order by k) into changes from jsonb_object_keys(s||previous) k where s->k is distinct from previous->k;
   insert into sma_private.publication_editor_drafts_v1(asset_id,asset_revision,user_id,customer_id,revision,settings)
    values(f.id,f.revision,uid,c.id,1,s) on conflict(asset_id,asset_revision) do update set
    revision=sma_private.publication_editor_drafts_v1.revision+1,settings=excluded.settings,updated_at=now() returning * into d;
   insert into sma_private.publication_editor_history_v1(asset_id,asset_revision,user_id,customer_id,file_name,media_kind,
    revision,request_id,expected_revision,previous_settings,settings,changed_fields)
    values(f.id,f.revision,uid,c.id,f.name,f.media_kind,d.revision,v_request_id,wanted,previous,s,changes);
   was_changed:=true;
  end if;
 end if;
 return jsonb_build_object('ok',true,'version',1,'can_publish',false,'asset_id',f.id,'asset_revision',f.revision,
  'revision',coalesce(d.revision,0),'settings',coalesce(d.settings,previous),'saved_at',d.updated_at,'changed',was_changed);
end $$;
revoke all on function sma_private.publication_editor_request_v1(text,jsonb) from public,anon,service_role;
grant execute on function sma_private.publication_editor_request_v1(text,jsonb) to authenticated;
create or replace function public.sma_publication_editor_v1(p_action text,p_input jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select sma_private.publication_editor_request_v1(p_action,p_input);$$;
revoke all on function public.sma_publication_editor_v1(text,jsonb) from public,anon,service_role;
grant execute on function public.sma_publication_editor_v1(text,jsonb) to authenticated;


create or replace function sma_private.publication_editor_result_v1(p_asset_id uuid,p_revision text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();c public.sma_kunden%rowtype;f sma_private.publication_files_v1%rowtype;
 e sma_private.publication_editor_exports_v1%rowtype;co sma_private.publication_files_v1%rowtype;cover jsonb:=null;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_asset_id is null or p_revision is null or char_length(p_revision) not between 1 and 250 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if (select count(*) from public.sma_kunden where user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end if;
 select * into c from public.sma_kunden where user_id=uid;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 select * into f from sma_private.publication_files_v1 where id=p_asset_id and user_id=uid and customer_id=c.id and available;
 if not found then return jsonb_build_object('ok',false,'code','FILE_UNAVAILABLE');end if;
 if f.revision is distinct from p_revision then return jsonb_build_object('ok',false,'code','FILE_CHANGED');end if;
 select * into e from sma_private.publication_editor_exports_v1 where media_asset_id=f.id and user_id=uid and customer_id=c.id and completed_at is not null order by completed_at desc,id desc limit 1;
 if found and e.outputs->'cover'<>'null'::jsonb then
  if f.media_kind<>'video' or f.mime_type<>'video/mp4' or f.revision !~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$'
   or split_part(f.revision,':',2) is distinct from e.outputs->'media'->>'sha256' or f.size_bytes is distinct from (e.outputs->'media'->>'size_bytes')::bigint then return jsonb_build_object('ok',false,'code','COVER_UNAVAILABLE');end if;
  select * into co from sma_private.publication_files_v1 where id=e.cover_asset_id and user_id=uid and customer_id=c.id and available;
  if not found or co.mime_type<>'image/png' or co.media_kind<>'image' or co.revision !~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$'
   or split_part(co.revision,':',2) is distinct from e.outputs->'cover'->>'sha256' or co.size_bytes is distinct from (e.outputs->'cover'->>'size_bytes')::bigint then return jsonb_build_object('ok',false,'code','COVER_UNAVAILABLE');end if;
  cover:=jsonb_build_object('asset_id',co.id,'asset_revision',co.revision,'name',co.name,'position_ms',(e.settings->>'cover_ms')::bigint-(e.settings->>'start_ms')::bigint);
 end if;
 return jsonb_build_object('ok',true,'version',1,'can_publish',false,'asset_id',f.id,'asset_revision',f.revision,'cover',cover);
end $$;
revoke all on function sma_private.publication_editor_result_v1(uuid,text) from public,anon,service_role;
grant execute on function sma_private.publication_editor_result_v1(uuid,text) to authenticated;
create or replace function public.sma_publication_editor_result_v1(p_asset_id uuid,p_revision text)
returns jsonb language sql stable security invoker set search_path='' as $$select sma_private.publication_editor_result_v1(p_asset_id,p_revision);$$;
revoke all on function public.sma_publication_editor_result_v1(uuid,text) from public,anon,service_role;
grant execute on function public.sma_publication_editor_result_v1(uuid,text) to authenticated;
