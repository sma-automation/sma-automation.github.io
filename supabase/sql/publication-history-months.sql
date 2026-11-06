-- Calendar-month views of existing orders. No new activity records or provider calls.
-- v1 stays available for previously loaded dashboard pages.
create or replace function sma_private.publication_history_read_v2(p_input jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); c public.sma_kunden%rowtype;
 selected_month text:=to_char(now() at time zone 'Europe/Vienna','YYYY-MM');
 month_start timestamptz;month_end timestamptz;month_date date;
 before_time timestamptz;before_id uuid;rows jsonb;last_row jsonb;more boolean;
 totals jsonb;months jsonb;
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
  begin before_time:=(p_input->>'before_at')::timestamptz;before_id:=(p_input->>'before_id')::uuid;
  exception when invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end;
  if selected_month is not null and (before_time<month_start or before_time>=month_end) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 end if;
 if (select count(*) from public.sma_kunden where user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end if;
 select * into c from public.sma_kunden where user_id=uid;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;

 -- Totals cover the selected period, never just the loaded page. Only completed
 -- attempts need the conservative receipt/fingerprint validation from v1.
 select jsonb_build_object('orders',count(*),
  'public_confirmed',count(*) filter(where case when a.state='complete' then sma_private.publication_history_entry_v1(j)->>'status'='public_confirmed' else false end),
  'platforms',coalesce(jsonb_agg(distinct j.binding->>'platform' order by j.binding->>'platform') filter(where j.binding->>'platform' in ('youtube','tiktok','instagram','facebook')),'[]'::jsonb))
 into totals from sma_private.publication_orders_v1 j
 left join sma_private.publication_provider_attempts_v1 a on a.order_id=j.id
 where j.user_id=uid and j.customer_id=c.id and (selected_month is null or (j.created_at>=month_start and j.created_at<month_end));

 -- Twelve most recent occupied months are shortcuts. The calendar input can
 -- also select older or empty months; history is not truncated to this list.
 select coalesce(jsonb_agg(jsonb_build_object('month',m.month,'orders',m.orders) order by m.month desc),'[]'::jsonb)
 into months from (select to_char(j.created_at at time zone 'Europe/Vienna','YYYY-MM') as month,count(*) as orders
  from sma_private.publication_orders_v1 j where j.user_id=uid and j.customer_id=c.id
  group by 1 order by 1 desc limit 12) m;

 select coalesce(jsonb_agg(sma_private.publication_history_entry_v1(q) order by q.created_at desc,q.id desc),'[]'::jsonb)
 into rows from (select j.* from sma_private.publication_orders_v1 j
  where j.user_id=uid and j.customer_id=c.id
   and (selected_month is null or (j.created_at>=month_start and j.created_at<month_end))
   and (before_time is null or (j.created_at,j.id)<(before_time,before_id))
  order by j.created_at desc,j.id desc limit 21) q;
 more:=jsonb_array_length(rows)>20;if more then rows:=rows-20;end if;
 last_row:=rows->(jsonb_array_length(rows)-1);
 return jsonb_build_object('ok',true,'version',2,'month',selected_month,'timezone','Europe/Vienna',
  'summary',totals,'months',months,'entries',rows,'has_more',more,
  'next',case when more then jsonb_build_object('before_at',last_row->>'created_at','before_id',last_row->>'id') else null end);
end $$;
revoke all on function sma_private.publication_history_read_v2(jsonb) from public,anon,service_role;
grant execute on function sma_private.publication_history_read_v2(jsonb) to authenticated;

create or replace function public.sma_publication_history_v2(p_input jsonb default '{}')
returns jsonb language sql stable security invoker set search_path='' as $$
 select sma_private.publication_history_read_v2(p_input);
$$;
revoke all on function public.sma_publication_history_v2(jsonb) from public,anon,service_role;
grant execute on function public.sma_publication_history_v2(jsonb) to authenticated;
