-- Extend the owner-scoped order RPC after its customer and order locks.
-- Cancellation and approval of the same order cannot both commit.
do $migration$
declare
  reader regprocedure := 'sma_private.publication_order_request_v1(text,jsonb)'::regprocedure;
  definition text := pg_get_functiondef(reader);
  allowed constant text := 'p_action not in (''prepare'',''get'',''approve'')';
  after_lock constant text := ' if p_action=''get'' then';
  cancel_order constant text := $cancel$
 if p_action='cancel' then
  if p_input <> jsonb_build_object('id',v_id) then
   return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;
  if j.id is null then return jsonb_build_object('ok',false,'code','ORDER_UNAVAILABLE');end if;
  if j.state not in ('preparing','prepared','cancelled') or j.approved_at is not null
     or j.approval_review is not null or j.lease_id is not null
     or exists(select 1 from sma_private.publication_journal_v1 where order_id=j.id) then
   return jsonb_build_object('ok',false,'code','ORDER_NOT_CANCELLABLE');
  end if;
  if j.state<>'cancelled' then
   update sma_private.publication_orders_v1 set state='cancelled',updated_at=now()
    where id=j.id returning * into j;
  end if;
  return sma_private.publication_order_view_v1(j);
 end if;
$cancel$;
begin
  if (select md5(prosrc) from pg_proc where oid=reader)<>'45477c1c67a54d1d0db9728df6240db2'
     or array_length(string_to_array(definition,allowed),1)<>2
     or array_length(string_to_array(definition,after_lock),1)<>2 then
    raise exception 'PUBLICATION_CANCEL_PREPARATION_BASELINE_CHANGED';
  end if;
  definition:=replace(definition,allowed,'p_action not in (''prepare'',''get'',''approve'',''cancel'')');
  execute replace(definition,after_lock,cancel_order||after_lock);
end
$migration$;
