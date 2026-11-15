-- Include the effective preparation window for matched orders visible in detail History.
do $guard$
begin
 if (select md5(prosrc) from pg_proc
     where oid='sma_private.publication_history_find_core_v1(text)'::regprocedure)
     is distinct from '80ac5229e7608d14fcd0d4c7f325455a' then
  raise exception 'HISTORY_FIND_CORE_BASELINE_CHANGED';
 end if;
end $guard$;

create or replace function sma_private.publication_history_find_core_v1(p_query text)
returns jsonb language plpgsql stable security definer set search_path='' as $func$
declare
 uid uuid:=auth.uid();
 term text:=lower(btrim(coalesce(p_query,'')));
 hits jsonb:='[]'::jsonb;
 more boolean:=false;
 single_customer boolean;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_query is null or length(term)<2 or length(term)>80 or octet_length(term)>240 then
  return jsonb_build_object('ok',false,'code','INVALID_INPUT');
 end if;
 -- Detail reads require one customer per login. Keep existing search metadata
 -- for ambiguous legacy logins without surfacing additional provider information.
 select count(*)=1 into single_customer from public.sma_kunden where user_id=uid;
 with selected as (
  select o as order_row,o.id,o.created_at,
   left(coalesce(nullif(o.draft->>'title',''),'Gespeicherter Beitrag'),180) as title,
   case when o.binding->>'platform' in ('youtube','tiktok','instagram','facebook')
    then o.binding->>'platform' else 'unknown' end as platform,
   o.state
  from sma_private.publication_orders_v1 o
  where o.user_id=uid
    and exists (
      select 1 from public.sma_kunden c
      where c.id=o.customer_id and c.user_id=uid
       and c.aktiv is true
       and (c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true)
    )
    and (
      position(term in lower(coalesce(o.draft->>'title','')))>0 or
      position(term in lower(o.id::text))>0 or
      position(term in lower(coalesce(o.binding->>'platform','')))>0 or
      position(term in lower(coalesce(o.account_check->>'display_name','')))>0
    )
  order by o.created_at desc,o.id desc
  limit 21
 ), numbered as (
  select selected.*,row_number() over(order by created_at desc,id desc) as rn from selected
 ), displayed as materialized (
  select numbered.*,case when single_customer
    then sma_private.publication_history_entry_v1(order_row)->>'status'
    else state end as display_status
  from numbered
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',id,'created_at',created_at,'title',title,'platform',platform,'status',display_status
  ) || jsonb_strip_nulls(jsonb_build_object('window',case
    when single_customer and isfinite(created_at) and display_status='prepared'
      then sma_private.publication_approval_window_v1(order_row)
    when single_customer and isfinite(created_at) and display_status='preparing'
      and (order_row).approved_at is null and (order_row).target is null and (order_row).account_check is null
      then jsonb_build_object('expires_at',created_at+interval '30 minutes','status',
        case when now()<created_at+interval '30 minutes' then 'active' else 'expired' end)
  end)) order by created_at desc,id desc) filter (where rn<=20),'[]'::jsonb),
  count(*)>20 into hits,more
 from displayed;
 return jsonb_build_object('ok',true,'version',1,'entries',hits,'has_more',more,'can_upload',false,'can_publish',false);
end
$func$;
