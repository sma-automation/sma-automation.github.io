-- Reject a new preparation for a file version already approved for the displayed
-- target. The existing customer lock serializes this lookup with final approval.
do $migration$
declare
  definition text := pg_get_functiondef('sma_private.publication_order_request_v1(text,jsonb)'::regprocedure);
  declarations constant text := 'v_id uuid;';
  input_check constant text := ' if exists(select 1 from jsonb_object_keys(p_input) k';
  build_binding constant text := ' b:=jsonb_build_object(''version'',1,';
  validate_target constant text := $check$
 if p_input ? 'expected_target_id' then
  if p_action <> 'prepare' or coalesce(p_input->>'platform','') not in ('youtube','tiktok')
     or jsonb_typeof(p_input->'expected_target_id') is distinct from 'string'
     or expected_target !~ '^[A-Za-z0-9_-]{3,200}$' then
   return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;
  -- This is a lookup hint only. The worker independently binds the actual account.
  p_input := p_input - 'expected_target_id';
 end if;
$check$;
  check_journal constant text := $check$
 if expected_target is not null then
  select entry.order_id into other_id from sma_private.publication_journal_v1 entry
   where entry.customer_id=c.id and entry.asset_id=f.id and entry.asset_revision=f.revision
     and entry.platform=a.platform and entry.target_id=expected_target;
  if found then
   if exists(select 1 from sma_private.publication_orders_v1 original
      where original.id=other_id and original.customer_id=c.id and original.user_id=uid
        and original.approved_at is not null and isfinite(original.approved_at)
        and original.state in ('approved','checking','checked','blocked')
        and original.binding->>'asset_id'=f.id::text and original.binding->>'asset_revision'=f.revision
        and original.binding->>'platform'=a.platform and original.target->>'platform'=a.platform
        and original.target->>'id'=expected_target) then
    return jsonb_build_object('ok',false,'code','DUPLICATE_PUBLICATION','existing_order_id',other_id);
   end if;
   return jsonb_build_object('ok',false,'code','REQUEST_CONFLICT');
  end if;
 end if;
$check$;
begin
  if array_length(string_to_array(definition,declarations),1)<>2
     or array_length(string_to_array(definition,input_check),1)<>2
     or array_length(string_to_array(definition,build_binding),1)<>2
     or position('expected_target_id' in definition)>0 then
    raise exception 'PUBLICATION_EXISTING_APPROVAL_BASELINE_CHANGED';
  end if;
  definition:=replace(definition,declarations,declarations||' expected_target text:=p_input->>''expected_target_id'';');
  definition:=replace(definition,input_check,validate_target||input_check);
  execute replace(definition,build_binding,check_journal||build_binding);
end
$migration$;
