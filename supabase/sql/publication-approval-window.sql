-- Read the effective deadline of a prepared order without changing its state or extending it.
create function sma_private.publication_approval_window_v1(j sma_private.publication_orders_v1)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  deadline timestamptz:=j.created_at+interval '30 minutes';
  account_deadline timestamptz;
  account_required boolean:=j.binding->>'platform' in ('youtube','tiktok');
  status text;
begin
  if j.state<>'prepared' or j.approved_at is not null then return null; end if;
  if account_required then
    if pg_catalog.pg_input_is_valid(j.account_check->>'expires_at','timestamptz') then
      account_deadline:=(j.account_check->>'expires_at')::timestamptz;
      deadline:=least(deadline,account_deadline);
    end if;
  end if;
  status:=case when deadline<=now() then 'expired'
    when account_required and sma_private.publication_account_valid_v1(j.account_check,j.target,j.choices) is not true
      then 'recheck' else 'active' end;
  return jsonb_build_object('status',status,'expires_at',case when isfinite(deadline) then deadline end);
end $$;
revoke all on function sma_private.publication_approval_window_v1(sma_private.publication_orders_v1) from public,anon,authenticated;
grant execute on function sma_private.publication_approval_window_v1(sma_private.publication_orders_v1) to service_role;

do $$
declare
  definition text:=pg_get_functiondef('sma_private.publication_order_view_v1(sma_private.publication_orders_v1)'::regprocedure);
  history text:=pg_get_functiondef('sma_private.publication_history_read_v3(jsonb)'::regprocedure);
  token_field text:=$old$'approval_token',case when j.state='prepared' then j.approval_token$old$;
  option_field text:=$old$'human_review_option',case when j.state='prepared' and$old$;
  cover_field text:=$old$'cover',sma_private.publication_history_cover_v1(j)$old$;
begin
  if position('declare current_result jsonb;media jsonb;' in definition)=0
    or position(token_field in definition)=0 or position(option_field in definition)=0 or position(cover_field in history)=0
    then raise exception 'PUBLICATION_APPROVAL_WINDOW_BASELINE_CHANGED'; end if;
  definition:=replace(definition,'declare current_result jsonb;media jsonb;',
    'declare current_result jsonb;media jsonb;approval_window jsonb:=sma_private.publication_approval_window_v1(j);');
  definition:=replace(definition,token_field,$new$'approval_window',approval_window,'approval_token',case when approval_window->>'status'='active' then j.approval_token$new$);
  execute replace(definition,option_field,$new$'human_review_option',case when approval_window->>'status'='active' and$new$);
  execute replace(history,cover_field,cover_field||$new$,'approval_window',sma_private.publication_approval_window_v1(j)$new$);
end $$;
