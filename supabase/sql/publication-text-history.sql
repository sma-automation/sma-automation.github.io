-- Read existing saved portal-text bodies; no writes, new events or provider calls.
-- A saved revision is not proof of a changed body or a publication.
create index if not exists publication_caption_history_v1_customer_recorded_idx
 on sma_private.publication_caption_history_v1(customer_id,recorded_at desc,preview_id desc,revision desc,platform desc);

create or replace function sma_private.publication_text_history_read_v1(p_input jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); c public.sma_kunden%rowtype;
 selected_month text:=to_char(now() at time zone 'Europe/Vienna','YYYY-MM');
 month_start timestamptz;month_end timestamptz;month_date date;
 before_time timestamptz;before_id uuid;before_revision integer;before_platform text;
 rows jsonb;last_row jsonb;more boolean;total bigint;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>1000
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('month','before_at','before_id','before_revision','before_platform'))
  or (p_input?'before_at') is distinct from (p_input?'before_id')
  or (p_input?'before_at') is distinct from (p_input?'before_revision')
  or (p_input?'before_at') is distinct from (p_input?'before_platform') then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
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
   or jsonb_typeof(p_input->'before_revision') is distinct from 'number'
   or coalesce(p_input->>'before_revision','') !~ '^[1-9][0-9]{0,9}$'
   or jsonb_typeof(p_input->'before_platform') is distinct from 'string'
   or coalesce(p_input->>'before_platform','') not in ('youtube','tiktok','instagram','facebook')
   then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  begin
   before_time:=(p_input->>'before_at')::timestamptz;before_id:=(p_input->>'before_id')::uuid;
   before_revision:=(p_input->>'before_revision')::integer;before_platform:=p_input->>'before_platform';
  exception when invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end;
  if selected_month is not null and (before_time<month_start or before_time>=month_end) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 end if;
 if (select count(*) from public.sma_kunden where user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end if;
 select * into c from public.sma_kunden where user_id=uid;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;

 -- Caption records have a customer but no user_id. Verify both against the
 -- parent preview; orphaned or inconsistently assigned rows remain invisible.
 select count(*) into total from sma_private.publication_caption_history_v1 h
 join sma_private.publication_previews_v1 p on p.id=h.preview_id and p.customer_id=h.customer_id
 where h.customer_id=c.id and p.user_id=uid
  and (selected_month is null or (h.recorded_at>=month_start and h.recorded_at<month_end));
 select coalesce(jsonb_agg(jsonb_build_object('preview_id',q.preview_id,'revision',q.revision,
  'platform',q.platform,'body',q.body,'recorded_at',q.recorded_at)
  order by q.recorded_at desc,q.preview_id desc,q.revision desc,q.platform desc),'[]'::jsonb)
 into rows from (select h.* from sma_private.publication_caption_history_v1 h
  join sma_private.publication_previews_v1 p on p.id=h.preview_id and p.customer_id=h.customer_id
  where h.customer_id=c.id and p.user_id=uid
   and (selected_month is null or (h.recorded_at>=month_start and h.recorded_at<month_end))
   and (before_time is null or (h.recorded_at,h.preview_id,h.revision,h.platform)<(before_time,before_id,before_revision,before_platform))
  order by h.recorded_at desc,h.preview_id desc,h.revision desc,h.platform desc limit 21) q;
 more:=jsonb_array_length(rows)>20;if more then rows:=rows-20;end if;
 last_row:=rows->(jsonb_array_length(rows)-1);
 return jsonb_build_object('ok',true,'version',1,'month',selected_month,'timezone','Europe/Vienna',
  'total',total,'entries',rows,'has_more',more,
  'next',case when more then jsonb_build_object('before_at',last_row->>'recorded_at','before_id',last_row->>'preview_id',
   'before_revision',last_row->'revision','before_platform',last_row->>'platform') else null end);
end $$;
revoke all on function sma_private.publication_text_history_read_v1(jsonb) from public,anon,service_role;
grant execute on function sma_private.publication_text_history_read_v1(jsonb) to authenticated;

create or replace function public.sma_publication_text_history_v1(p_input jsonb default '{}')
returns jsonb language sql stable security invoker set search_path='' as $$
 select sma_private.publication_text_history_read_v1(p_input);
$$;
revoke all on function public.sma_publication_text_history_v1(jsonb) from public,anon,service_role;
grant execute on function public.sma_publication_text_history_v1(jsonb) to authenticated;
