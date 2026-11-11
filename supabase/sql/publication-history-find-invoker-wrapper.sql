-- SMA: keep privileged owner lookup in an unexposed private schema.
-- A SECURITY INVOKER public wrapper is the only Data API endpoint.
-- Guard the currently deployed function source before replacing anything.
do $guard$
begin
 if to_regprocedure('sma_private.publication_history_find_core_v1(text)') is not null then
  raise exception 'HISTORY_PRIVATE_LOOKUP_CORE_ALREADY_EXISTS';
 end if;
 if to_regprocedure('public.sma_publication_history_find_v1(text)') is null or
    (select md5(prosrc) from pg_proc where oid='public.sma_publication_history_find_v1(text)'::regprocedure)
     is distinct from '56589e587a276622b674913222e2af56' or
    (select prosecdef from pg_proc where oid='public.sma_publication_history_find_v1(text)'::regprocedure) is not true then
  raise exception 'HISTORY_PUBLIC_FIND_BASELINE_CHANGED';
 end if;
end
$guard$;

create function sma_private.publication_history_find_core_v1(p_query text)
returns jsonb language plpgsql stable security definer set search_path='' as $func$
declare
 uid uuid:=auth.uid();
 term text:=lower(btrim(coalesce(p_query,'')));
 hits jsonb:='[]'::jsonb;
 more boolean:=false;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_query is null or length(term)<2 or length(term)>80 or octet_length(term)>240 then
  return jsonb_build_object('ok',false,'code','INVALID_INPUT');
 end if;
 with selected as (
  select o.id,o.created_at,
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
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',id,'created_at',created_at,'title',title,
   'platform',platform,'status',state
  ) order by created_at desc,id desc) filter (where rn<=20),'[]'::jsonb),
  count(*)>20 into hits,more
 from numbered;
 return jsonb_build_object('ok',true,'version',1,'entries',hits,'has_more',more,'can_upload',false,'can_publish',false);
end
$func$;
revoke all on function sma_private.publication_history_find_core_v1(text) from public,anon,authenticated;
grant execute on function sma_private.publication_history_find_core_v1(text) to authenticated;

create or replace function public.sma_publication_history_find_v1(p_query text)
returns jsonb language sql stable security invoker set search_path='' as $wrapper$
 select sma_private.publication_history_find_core_v1(p_query);
$wrapper$;
revoke all on function public.sma_publication_history_find_v1(text) from public,anon,authenticated;
grant execute on function public.sma_publication_history_find_v1(text) to authenticated;
