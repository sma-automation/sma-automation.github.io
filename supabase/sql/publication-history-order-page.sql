-- Locate a saved order in its Vienna creation month. Read the normal history
-- projection for a single 20-row batch in the same database snapshot.
create function sma_private.publication_history_order_page_v1(p_order_id uuid,p_page integer default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 uid uuid:=auth.uid();
 customer bigint;
 stamp timestamptz;
 month_start timestamp;
 selected_month text;
 total bigint;
 newer bigint;
 page_no bigint;
 first_index bigint;
 boundary record;
 input jsonb;
 history jsonb;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_order_id is null or p_page<1 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select c.id into customer from public.sma_kunden c
 where c.user_id=uid and c.aktiv and (c.demo_delta_aktiv or c.zahlung_bestaetigt)
 and (select count(*) from public.sma_kunden uses_account where uses_account.user_id=uid)=1;
 select j.created_at into stamp from sma_private.publication_orders_v1 j
 where j.id=p_order_id and j.user_id=uid and j.customer_id=customer;
 if stamp is null then return jsonb_build_object('ok',false,'code','ORDER_UNAVAILABLE');end if;
 month_start:=date_trunc('month',stamp at time zone 'Europe/Vienna');
 selected_month:=to_char(month_start,'YYYY-MM');
 select count(*),count(*) filter(where (j.created_at,j.id)>(stamp,p_order_id)) into total,newer
 from sma_private.publication_orders_v1 j where j.user_id=uid and j.customer_id=customer
 and j.created_at>=month_start at time zone 'Europe/Vienna'
 and j.created_at<(month_start+interval '1 month') at time zone 'Europe/Vienna';
 page_no:=least(coalesce(p_page,newer/5+1),(total-1)/5+1);
 first_index:=(page_no-1)/4*20;
 input:=jsonb_build_object('month',selected_month);
 if first_index>0 then
  select j.created_at,j.id into boundary from sma_private.publication_orders_v1 j
  where j.user_id=uid and j.customer_id=customer
  and j.created_at>=month_start at time zone 'Europe/Vienna'
  and j.created_at<(month_start+interval '1 month') at time zone 'Europe/Vienna'
  order by j.created_at desc,j.id desc offset (first_index-1) limit 1;
  input:=input||jsonb_build_object('before_at',boundary.created_at,'before_id',boundary.id);
 end if;
 history:=sma_private.publication_history_read_v3(input);
 if history->'ok' is distinct from 'true'::jsonb then return history;end if;
 return history||jsonb_build_object('order_page',page_no);
end $$;
revoke all on function sma_private.publication_history_order_page_v1(uuid,integer) from public,anon,service_role;
grant execute on function sma_private.publication_history_order_page_v1(uuid,integer) to authenticated;

create function public.sma_publication_history_order_page_v1(p_order_id uuid,p_page integer default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select sma_private.publication_history_order_page_v1(p_order_id,p_page);
$$;
revoke all on function public.sma_publication_history_order_page_v1(uuid,integer) from public,anon,service_role;
grant execute on function public.sma_publication_history_order_page_v1(uuid,integer) to authenticated;
