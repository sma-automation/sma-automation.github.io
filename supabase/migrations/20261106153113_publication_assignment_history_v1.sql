-- Append-only file/portal assignment snapshots. No publishing or source updates.
-- Run atomically: the source lock closes the gap between baseline and trigger.
lock table sma_private.publication_assignments_v1 in share row exclusive mode;
create table if not exists sma_private.publication_assignment_history_v1 (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null, customer_id bigint not null,
 asset_id uuid not null, platform text not null check(platform in ('youtube','tiktok','instagram','facebook')),
 preview_id uuid not null, preview_revision integer not null, assignment_revision integer not null,
 asset_revision text not null, file_name text not null, title text not null, body text not null,
 event_kind text not null check(event_kind in ('baseline','assigned','updated')),
 recorded_at timestamptz not null default now(), source_updated_at timestamptz not null
);
create index if not exists publication_assignment_history_v1_owner_recorded_idx
 on sma_private.publication_assignment_history_v1(user_id,customer_id,recorded_at desc,id desc);
alter table sma_private.publication_assignment_history_v1 enable row level security;
revoke all on sma_private.publication_assignment_history_v1 from public,anon,authenticated,service_role;

-- Only today's saved state is known. Never manufacture earlier edit events.
insert into sma_private.publication_assignment_history_v1
 (user_id,customer_id,asset_id,platform,preview_id,preview_revision,assignment_revision,
  asset_revision,file_name,title,body,event_kind,source_updated_at)
select f.user_id,f.customer_id,a.asset_id,a.platform,a.preview_id,a.preview_revision,a.revision,
 a.asset_revision,f.name,coalesce(a.draft->>'title',''),coalesce(a.draft->>'body',''),'baseline',a.updated_at
from sma_private.publication_assignments_v1 a
join sma_private.publication_files_v1 f on f.id=a.asset_id
join sma_private.publication_previews_v1 p on p.id=a.preview_id and p.user_id=f.user_id and p.customer_id=f.customer_id
join public.sma_kunden c on c.id=f.customer_id and c.user_id=f.user_id
where not exists(select 1 from sma_private.publication_assignment_history_v1 h where h.asset_id=a.asset_id and h.platform=a.platform);

create or replace function sma_private.publication_assignment_record_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Revision/timestamp-only refreshes are not a new assignment snapshot.
 if tg_op='UPDATE' and (new.asset_id,new.platform,new.preview_id,new.preview_revision,new.asset_revision,new.draft)
  is not distinct from (old.asset_id,old.platform,old.preview_id,old.preview_revision,old.asset_revision,old.draft) then return new;end if;
 insert into sma_private.publication_assignment_history_v1
  (user_id,customer_id,asset_id,platform,preview_id,preview_revision,assignment_revision,
   asset_revision,file_name,title,body,event_kind,source_updated_at)
 select f.user_id,f.customer_id,new.asset_id,new.platform,new.preview_id,new.preview_revision,new.revision,
  new.asset_revision,f.name,coalesce(new.draft->>'title',''),coalesce(new.draft->>'body',''),
  case when tg_op='INSERT' then 'assigned' else 'updated' end,new.updated_at
 from sma_private.publication_files_v1 f
 join sma_private.publication_previews_v1 p on p.id=new.preview_id and p.user_id=f.user_id and p.customer_id=f.customer_id
 join public.sma_kunden c on c.id=f.customer_id and c.user_id=f.user_id
 where f.id=new.asset_id;
 return new;
end $$;
revoke all on function sma_private.publication_assignment_record_v1() from public,anon,authenticated,service_role;
drop trigger if exists publication_assignment_record_v1 on sma_private.publication_assignments_v1;
create trigger publication_assignment_record_v1 after insert or update on sma_private.publication_assignments_v1
 for each row execute function sma_private.publication_assignment_record_v1();

create or replace function sma_private.publication_assignment_history_read_v1(p_input jsonb default '{}')
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

 -- Check saved ownership and both current parents; reassigned/orphaned rows stay private.
 select count(*) into total from sma_private.publication_assignment_history_v1 h
 join sma_private.publication_files_v1 f on f.id=h.asset_id and f.user_id=h.user_id and f.customer_id=h.customer_id
 join sma_private.publication_previews_v1 p on p.id=h.preview_id and p.user_id=h.user_id and p.customer_id=h.customer_id
 where h.user_id=uid and h.customer_id=c.id
  and (selected_month is null or (h.recorded_at>=month_start and h.recorded_at<month_end));
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'asset_id',q.asset_id,'platform',q.platform,'preview_id',q.preview_id,'preview_revision',q.preview_revision,'assignment_revision',q.assignment_revision,'asset_revision',q.asset_revision,'file_name',q.file_name,'title',q.title,'body',q.body,'event_kind',q.event_kind,'recorded_at',q.recorded_at,'source_updated_at',q.source_updated_at)
  order by q.recorded_at desc,q.id desc),'[]'::jsonb)
 into rows from (select h.* from sma_private.publication_assignment_history_v1 h
 join sma_private.publication_files_v1 f on f.id=h.asset_id and f.user_id=h.user_id and f.customer_id=h.customer_id
 join sma_private.publication_previews_v1 p on p.id=h.preview_id and p.user_id=h.user_id and p.customer_id=h.customer_id
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
revoke all on function sma_private.publication_assignment_history_read_v1(jsonb) from public,anon,service_role;
grant execute on function sma_private.publication_assignment_history_read_v1(jsonb) to authenticated;

create or replace function public.sma_publication_assignment_history_v1(p_input jsonb default '{}')
returns jsonb language sql stable security invoker set search_path='' as $$
 select sma_private.publication_assignment_history_read_v1(p_input);
$$;
revoke all on function public.sma_publication_assignment_history_v1(jsonb) from public,anon,service_role;
grant execute on function public.sma_publication_assignment_history_v1(jsonb) to authenticated;
