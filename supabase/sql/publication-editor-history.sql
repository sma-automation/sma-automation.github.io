-- Versioned editing recipes only. No media render, source mutation or publication.
create table if not exists sma_private.publication_editor_drafts_v1 (
 asset_id uuid not null, asset_revision text not null, user_id uuid not null, customer_id bigint not null,
 revision integer not null check(revision>0), settings jsonb not null, updated_at timestamptz not null default now(),
 primary key(asset_id,asset_revision)
);
create table if not exists sma_private.publication_editor_history_v1 (
 id uuid primary key default gen_random_uuid(), asset_id uuid not null, asset_revision text not null,
 user_id uuid not null, customer_id bigint not null, file_name text not null, media_kind text not null,
 revision integer not null check(revision>0), request_id uuid not null, expected_revision integer not null,
 previous_settings jsonb not null, settings jsonb not null, changed_fields jsonb not null,
 recorded_at timestamptz not null default now(),
 unique(asset_id,asset_revision,revision), unique(asset_id,asset_revision,request_id)
);
create index if not exists publication_editor_history_v1_owner_recorded_idx
 on sma_private.publication_editor_history_v1(user_id,customer_id,recorded_at desc,id desc);
alter table sma_private.publication_editor_drafts_v1 enable row level security;
alter table sma_private.publication_editor_history_v1 enable row level security;
revoke all on sma_private.publication_editor_drafts_v1,sma_private.publication_editor_history_v1 from public,anon,authenticated,service_role;

create or replace function sma_private.publication_editor_defaults_v1()
returns jsonb language sql immutable security invoker set search_path='' as $$
 select '{"format":"original","fit":"contain","position_x":50,"position_y":50,"start_ms":0,"end_ms":null,"cover_ms":null,"overlay_text":"","overlay_position":"bottom","audio_volume":100}'::jsonb;
$$;
revoke all on function sma_private.publication_editor_defaults_v1() from public,anon,authenticated,service_role;

create or replace function sma_private.publication_editor_settings_valid_v1(s jsonb,f sma_private.publication_files_v1)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare k text;v numeric;end_time numeric;
begin
 if jsonb_typeof(s) is distinct from 'object' or octet_length(s::text)>4000 then return false;end if;
 if (select count(*) from jsonb_object_keys(s))<>10 or exists(select 1 from jsonb_object_keys(s) x where x not in
  ('format','fit','position_x','position_y','start_ms','end_ms','cover_ms','overlay_text','overlay_position','audio_volume')) then return false;end if;
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
   select jsonb_agg(k order by k) into changes from jsonb_object_keys(s) k where s->k is distinct from previous->k;
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

create or replace function sma_private.publication_editor_history_read_v1(p_input jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); c public.sma_kunden%rowtype;
 selected_month text:=to_char(now() at time zone 'Europe/Vienna','YYYY-MM');
 month_start timestamptz;month_end timestamptz;month_date date;
 before_time timestamptz;before_id uuid;
 rows jsonb;last_row jsonb;more boolean;total bigint;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>1000
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('month','before_at','before_id'))
  or (p_input?'before_at') is distinct from (p_input?'before_id') then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if p_input?'month' then
  if p_input->'month'='null'::jsonb then selected_month:=null;
  elsif jsonb_typeof(p_input->'month')='string' and p_input->>'month' ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then selected_month:=p_input->>'month';
  else return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 end if;
 if selected_month is not null then
  month_date:=(selected_month||'-01')::date;
  month_start:=month_date::timestamp at time zone 'Europe/Vienna';
  month_end:=(month_date+interval '1 month') at time zone 'Europe/Vienna';
 end if;
 if p_input?'before_at' then
  if not(p_input?'month') or jsonb_typeof(p_input->'before_at') is distinct from 'string'
   or coalesce(p_input->>'before_at','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})$'
   or jsonb_typeof(p_input->'before_id') is distinct from 'string'
   or coalesce(p_input->>'before_id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  begin
   before_time:=(p_input->>'before_at')::timestamptz;before_id:=(p_input->>'before_id')::uuid;
  exception when invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end;
  if selected_month is not null and (before_time<month_start or before_time>=month_end) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 end if;
 if (select count(*) from public.sma_kunden where user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end if;
 select * into c from public.sma_kunden where user_id=uid;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;

 -- Check saved ownership against the current file; reassigned/orphaned rows stay private.
 select count(*) into total from sma_private.publication_editor_history_v1 h
 join sma_private.publication_files_v1 f on f.id=h.asset_id and f.user_id=h.user_id and f.customer_id=h.customer_id
 where h.user_id=uid and h.customer_id=c.id
  and (selected_month is null or (h.recorded_at>=month_start and h.recorded_at<month_end));
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'asset_id',q.asset_id,'asset_revision',q.asset_revision,'file_name',q.file_name,'media_kind',q.media_kind,'revision',q.revision,'previous_settings',q.previous_settings,'settings',q.settings,'changed_fields',q.changed_fields,'recorded_at',q.recorded_at)
  order by q.recorded_at desc,q.id desc),'[]'::jsonb)
 into rows from (select h.* from sma_private.publication_editor_history_v1 h
 join sma_private.publication_files_v1 f on f.id=h.asset_id and f.user_id=h.user_id and f.customer_id=h.customer_id
 where h.user_id=uid and h.customer_id=c.id
  and (selected_month is null or (h.recorded_at>=month_start and h.recorded_at<month_end))
  and (before_time is null or (h.recorded_at,h.id)<(before_time,before_id))
  order by h.recorded_at desc,h.id desc limit 21) q;
 more:=jsonb_array_length(rows)>20;if more then rows:=rows-20;end if;
 last_row:=rows->(jsonb_array_length(rows)-1);
 return jsonb_build_object('ok',true,'version',1,'month',selected_month,'timezone','Europe/Vienna',
  'total',total,'entries',rows,'has_more',more,
  'next',case when more then jsonb_build_object('before_at',last_row->>'recorded_at','before_id',last_row->>'id') else null end);
end $$;
revoke all on function sma_private.publication_editor_history_read_v1(jsonb) from public,anon,service_role;
grant execute on function sma_private.publication_editor_history_read_v1(jsonb) to authenticated;

create or replace function public.sma_publication_editor_history_v1(p_input jsonb default '{}')
returns jsonb language sql stable security invoker set search_path='' as $$
 select sma_private.publication_editor_history_read_v1(p_input);
$$;
revoke all on function public.sma_publication_editor_history_v1(jsonb) from public,anon,service_role;
grant execute on function public.sma_publication_editor_history_v1(jsonb) to authenticated;
