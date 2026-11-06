-- New Magic Effect attempts only. No backfill, provider call or publication permission.
-- The result cache remains unchanged; this private event journal is append-only for application roles.
-- Install only against the reviewed photo/video entry points; do not replace them.
do $$begin
 if (select count(*) from pg_proc where
  (oid='sma_private.publication_magic_request_v1(text,jsonb)'::regprocedure and md5(prosrc)='8caea19dd1a963c2033dbb771a9a894b') or
  (oid='sma_private.publication_video_magic_request_v1(text,jsonb)'::regprocedure and md5(prosrc)='e9a5f30c768f86a1f08a19fc4bd5de5d') or
  (oid='public.sma_publication_magic_finish_v1(uuid,uuid,jsonb,text,text)'::regprocedure and md5(prosrc)='82c2d838ec187a31e1321a1faf01064a') or
  (oid='public.sma_publication_video_magic_finish_v1(uuid,uuid,jsonb,text,text)'::regprocedure and md5(prosrc)='0841d17a79923a5ebd6de767a7c9f84c'))<>4
 then raise exception 'ANALYSIS_BASELINE_CHANGED';end if;
end $$;

create table sma_private.publication_analysis_history_v1 (
 id uuid primary key default gen_random_uuid(),
 attempt_id uuid not null,
 event text not null check(event in ('started','completed','failed')),
 asset_id uuid not null, asset_revision text not null, policy_version text not null,
 user_id uuid not null, customer_id bigint not null references public.sma_kunden(id),
 n8n_kunde_id text not null, kunde_email text not null,
 file_name text not null, media_kind text not null check(media_kind in ('image','video')),
 started_at timestamptz not null, lease_until timestamptz not null,
 finished_at timestamptz, recorded_at timestamptz not null default now(),
 result jsonb, content_sha256 text, error_code text,
 unique(attempt_id,event),
 check(lease_until>started_at),
 check((event='started' and finished_at is null and result is null and content_sha256 is null and error_code is null)
  or (event='completed' and finished_at>=started_at and result is not null and content_sha256 is not null and content_sha256 ~ '^[a-f0-9]{64}$' and error_code is null)
  or (event='failed' and finished_at>=started_at and result is null and content_sha256 is null and error_code is not null))
);
create unique index publication_analysis_history_v1_terminal_idx
 on sma_private.publication_analysis_history_v1(attempt_id) where event<>'started';
create index publication_analysis_history_v1_customer_started_idx
 on sma_private.publication_analysis_history_v1(customer_id,started_at desc,id desc) where event='started';
alter table sma_private.publication_analysis_history_v1 enable row level security;
revoke all on sma_private.publication_analysis_history_v1 from public,anon,authenticated,service_role;

create function sma_private.publication_analysis_record_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare f sma_private.publication_files_v1%rowtype;
begin
 if new.policy_version not in ('magic-photo-2026-11-02.1','magic-video-2026-11-03.1') then return null;end if;
 if new.status='processing' and new.lease_id is not null and new.lease_until>new.started_at then
  if tg_op='UPDATE' then
   if old.lease_id is not distinct from new.lease_id then return null;end if;
  end if;
  select * into f from sma_private.publication_files_v1 where id=new.asset_id and user_id=new.user_id and customer_id=new.customer_id and revision=new.asset_revision;
  if not found then return null;end if;
  insert into sma_private.publication_analysis_history_v1(attempt_id,event,asset_id,asset_revision,policy_version,user_id,customer_id,n8n_kunde_id,kunde_email,file_name,media_kind,started_at,lease_until)
  values(new.lease_id,'started',new.asset_id,new.asset_revision,new.policy_version,new.user_id,new.customer_id,new.n8n_kunde_id,new.kunde_email,left(f.name,500),f.media_kind,new.started_at,new.lease_until);
 elsif tg_op='UPDATE' then
  -- A terminal result must belong to the exact recorded start. Old cache entries
  -- without a start event never acquire an invented history during deployment.
  if old.status<>'processing' or old.lease_id is null or new.status not in ('completed','failed')
   or new.lease_id is not null or new.finished_at is null
   or (new.asset_id,new.asset_revision,new.policy_version,new.user_id,new.customer_id,new.n8n_kunde_id,new.kunde_email,new.started_at)
      is distinct from (old.asset_id,old.asset_revision,old.policy_version,old.user_id,old.customer_id,old.n8n_kunde_id,old.kunde_email,old.started_at)
   then return null;end if;
  insert into sma_private.publication_analysis_history_v1(attempt_id,event,asset_id,asset_revision,policy_version,user_id,customer_id,n8n_kunde_id,kunde_email,file_name,media_kind,started_at,lease_until,finished_at,result,content_sha256,error_code)
  select h.attempt_id,new.status,h.asset_id,h.asset_revision,h.policy_version,h.user_id,h.customer_id,h.n8n_kunde_id,h.kunde_email,h.file_name,h.media_kind,h.started_at,h.lease_until,new.finished_at,
   case when new.status='completed' then new.result end,
   case when new.status='completed' then new.content_sha256 end,
   case when new.status='failed' then coalesce(new.error_code,'MAGIC_UNAVAILABLE') end
  from sma_private.publication_analysis_history_v1 h
  where h.event='started' and h.attempt_id=old.lease_id
   and (h.asset_id,h.asset_revision,h.policy_version,h.user_id,h.customer_id,h.n8n_kunde_id,h.kunde_email,h.started_at,h.lease_until)
       is not distinct from (old.asset_id,old.asset_revision,old.policy_version,old.user_id,old.customer_id,old.n8n_kunde_id,old.kunde_email,old.started_at,old.lease_until)
  on conflict do nothing;
 end if;
 return null;
end $$;
revoke all on function sma_private.publication_analysis_record_v1() from public,anon,authenticated,service_role;
create trigger publication_analysis_record_v1 after insert or update on sma_private.publication_magic_results_v1
 for each row execute function sma_private.publication_analysis_record_v1();

create function sma_private.publication_analysis_history_read_v1(p_input jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();c public.sma_kunden%rowtype;
 selected_month text:=to_char(now() at time zone 'Europe/Vienna','YYYY-MM');
 month_start timestamptz;month_end timestamptz;month_date date;before_time timestamptz;before_id uuid;
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
  month_date:=(selected_month||'-01')::date;month_start:=month_date::timestamp at time zone 'Europe/Vienna';
  month_end:=(month_date+interval '1 month') at time zone 'Europe/Vienna';
 end if;
 if p_input?'before_at' then
  if not(p_input?'month') or jsonb_typeof(p_input->'before_at') is distinct from 'string'
   or coalesce(p_input->>'before_at','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})$'
   or jsonb_typeof(p_input->'before_id') is distinct from 'string'
   or coalesce(p_input->>'before_id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  begin before_time:=(p_input->>'before_at')::timestamptz;before_id:=(p_input->>'before_id')::uuid;
  exception when invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end;
  if selected_month is not null and (before_time<month_start or before_time>=month_end) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 end if;
 if (select count(*) from public.sma_kunden where user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end if;
 select * into c from public.sma_kunden where user_id=uid;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 select count(*) into total from sma_private.publication_analysis_history_v1 h
 join sma_private.publication_files_v1 f on f.id=h.asset_id and f.customer_id=h.customer_id and f.user_id=h.user_id
 where h.event='started' and h.customer_id=c.id and h.user_id=uid and h.n8n_kunde_id=c.n8n_kunde_id and h.kunde_email=c.kunde_email
  and (selected_month is null or (h.started_at>=month_start and h.started_at<month_end));
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'file_name',q.file_name,'media_kind',q.media_kind,
  'started_at',q.started_at,'finished_at',q.finished_at,'status',q.status,'error_code',q.error_code)
  order by q.started_at desc,q.id desc),'[]'::jsonb) into rows from (
  select h.id,h.file_name,h.media_kind,h.started_at,e.finished_at,
   case when e.event='completed' then 'completed' when e.event='failed' then 'failed' when h.lease_until<=now() then 'timed_out' else 'processing' end as status,
   case when e.event='failed' then case when e.error_code in ('FILE_CHANGED','ACCESS_INACTIVE','FOLDER_UNAVAILABLE','CHECKSUM_REQUIRED','MEDIA_UNSUPPORTED','VIDEO_UNSUPPORTED') then e.error_code else 'MAGIC_UNAVAILABLE' end end as error_code
  from sma_private.publication_analysis_history_v1 h
  join sma_private.publication_files_v1 f on f.id=h.asset_id and f.customer_id=h.customer_id and f.user_id=h.user_id
  left join sma_private.publication_analysis_history_v1 e on e.attempt_id=h.attempt_id and e.event<>'started'
   and (e.asset_id,e.asset_revision,e.policy_version,e.user_id,e.customer_id,e.n8n_kunde_id,e.kunde_email,e.started_at,e.lease_until)
       is not distinct from (h.asset_id,h.asset_revision,h.policy_version,h.user_id,h.customer_id,h.n8n_kunde_id,h.kunde_email,h.started_at,h.lease_until)
  where h.event='started' and h.customer_id=c.id and h.user_id=uid and h.n8n_kunde_id=c.n8n_kunde_id and h.kunde_email=c.kunde_email
   and (selected_month is null or (h.started_at>=month_start and h.started_at<month_end))
   and (before_time is null or (h.started_at,h.id)<(before_time,before_id))
  order by h.started_at desc,h.id desc limit 21
 ) q;
 more:=jsonb_array_length(rows)>20;if more then rows:=rows-20;end if;last_row:=rows->(jsonb_array_length(rows)-1);
 return jsonb_build_object('ok',true,'version',1,'month',selected_month,'timezone','Europe/Vienna','can_publish',false,
  'total',total,'entries',rows,'has_more',more,'next',case when more then jsonb_build_object('before_at',last_row->>'started_at','before_id',last_row->>'id') else null end);
end $$;
revoke all on function sma_private.publication_analysis_history_read_v1(jsonb) from public,anon,service_role;
grant execute on function sma_private.publication_analysis_history_read_v1(jsonb) to authenticated;
create function public.sma_publication_analysis_history_v1(p_input jsonb default '{}')
returns jsonb language sql stable security invoker set search_path='' as $$select sma_private.publication_analysis_history_read_v1(p_input);$$;
revoke all on function public.sma_publication_analysis_history_v1(jsonb) from public,anon,service_role;
grant execute on function public.sma_publication_analysis_history_v1(jsonb) to authenticated;
