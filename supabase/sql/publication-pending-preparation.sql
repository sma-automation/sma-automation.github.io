-- Expose the remaining preparation time without making an unbound order approvable.
-- Both existing owner-scoped projections already have the order row under alias j.
do $migration$
declare
  reader regprocedure;
  definition text;
  marker constant text := '''approval_window'',';
  field constant text := $field$'preparation_window',case
    when j.state='preparing' and j.approved_at is null and j.target is null
      and j.account_check is null and isfinite(j.created_at) then
      jsonb_build_object('expires_at',j.created_at+interval '30 minutes','status',
        case when now()<j.created_at+interval '30 minutes' then 'active' else 'expired' end)
    end,$field$;
begin
  foreach reader in array array[
    'sma_private.publication_order_view_v1(sma_private.publication_orders_v1)'::regprocedure,
    'sma_private.publication_history_read_v3(jsonb)'::regprocedure
  ] loop
    definition:=pg_get_functiondef(reader);
    if array_length(string_to_array(definition,marker),1)<>2
       or position('''preparation_window''' in definition)>0 then
      raise exception 'PUBLICATION_PREPARATION_WINDOW_BASELINE_CHANGED';
    end if;
    execute replace(definition,marker,field||marker);
  end loop;
end
$migration$;
