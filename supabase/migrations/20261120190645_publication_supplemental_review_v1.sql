-- A customer's later media assessment is independent of the original publishing consent.
alter table sma_private.publication_orders_v1
  add column supplemental_review jsonb,
  add column supplemental_review_at timestamptz,
  add constraint publication_supplemental_review_valid check (
    (supplemental_review is null and supplemental_review_at is null) or
    (supplemental_review_at is not null and approved_at is not null and
     sma_private.publication_human_review_valid_v1(supplemental_review))
  );

create function sma_private.publication_supplemental_review_option_v1(j sma_private.publication_orders_v1, media jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare checks jsonb;
begin
 if j.state <> 'blocked' or j.approved_at is null or j.supplemental_review is not null
    or j.approval_review ? 'human_review' or j.lease_id is not null
    or not sma_private.publication_order_review_valid_v1(j.approval_review,j.binding->>'platform',j.choices)
    or jsonb_typeof(j.blockers) is distinct from 'array' or j.blockers = '[]'::jsonb or not (j.blockers <@ '["CONTENT_REVIEW_PENDING","SEMANTIC_REVIEW_PENDING"]'::jsonb)
    or j.target->>'id' is null or j.account_check->>'target_id' is distinct from j.target->>'id'
    or j.target->>'source_revision' is null or j.account_check->>'target_revision' is distinct from j.target->>'source_revision'
    or not exists (select 1 from sma_private.publication_journal_v1 p where p.order_id=j.id and p.customer_id=j.customer_id
      and p.asset_id::text=j.binding->>'asset_id' and p.asset_revision=j.binding->>'asset_revision'
      and p.platform=j.binding->>'platform' and p.target_id=j.target->>'id')
    or exists (select 1 from sma_private.publication_provider_attempts_v1 where order_id=j.id)
    or jsonb_typeof(media->'checks') is distinct from 'array' then return null; end if;

 -- Account evidence may expire while the customer watches. Only the form's eligibility
 -- ignores that pending lookup. The worker always evaluates the unmodified live checks.
 if j.binding->>'platform'='tiktok' and (j.account_check->>'expires_at')::timestamptz<=now()
    and (j.account_check->>'checked_at')::timestamptz <= (j.account_check->>'expires_at')::timestamptz
    and (j.account_check#>>'{policy,max_duration_sec}')::bigint * 1000 >= (media#>>'{facts,duration_ms}')::bigint then
  select jsonb_agg(item order by pos) into checks from jsonb_array_elements(media->'checks') with ordinality as entries(item,pos)
    where not (item @> '{"code":"TIKTOK_CREATOR_LIMIT","status":"pending"}'::jsonb);
  media:=jsonb_set(media,'{checks}',coalesce(checks,'[]'::jsonb));
 end if;
 if sma_private.publication_human_review_available_v1(j,media) is true then
  return jsonb_build_object('policy_version','human-video-2026-11-06.1','source_fingerprint',sma_private.publication_human_review_scope_v1(j));
 end if;
 return null;
exception when data_exception then return null;
end $$;
revoke all on function sma_private.publication_supplemental_review_option_v1(sma_private.publication_orders_v1,jsonb) from public,anon,authenticated;
grant execute on function sma_private.publication_supplemental_review_option_v1(sma_private.publication_orders_v1,jsonb) to service_role;

do $migration$
declare
 reader regprocedure:='sma_private.publication_order_request_v1(text,jsonb)'::regprocedure;
 viewer regprocedure:='sma_private.publication_order_view_v1(sma_private.publication_orders_v1)'::regprocedure;
 evaluator regprocedure:='sma_private.publication_human_review_media_v1(sma_private.publication_orders_v1,jsonb)'::regprocedure;
 request_def text:=pg_get_functiondef(reader);
 view_def text:=pg_get_functiondef(viewer);
 media_def text:=pg_get_functiondef(evaluator);
 allowed text:='p_action not in (''prepare'',''get'',''approve'',''cancel'')';
 has_review text:='p_action<>''approve'' and p_input?''review''';
 after_lock text:=' if p_action=''get'' then';
 view_anchor text:='''approval_policy'',''media-consent-2026-11-03.1''';
 media_anchor text:=' if j.approved_at is null';
 save_action text:=$save$
 if p_action='supplement' then
  if j.id is null then return jsonb_build_object('ok',false,'code','ORDER_UNAVAILABLE'); end if;
  if p_input is distinct from jsonb_build_object('id',v_id,'confirm',true,'review',p_input->'review')
     or not sma_private.publication_human_review_valid_v1(p_input->'review')
     or p_input#>>'{review,source_fingerprint}' is distinct from sma_private.publication_human_review_scope_v1(j) then
   return jsonb_build_object('ok',false,'code','HUMAN_REVIEW_UNAVAILABLE');
  end if;
  if j.supplemental_review is not null then
   if j.supplemental_review=p_input->'review' then return sma_private.publication_order_view_v1(j); end if;
   return jsonb_build_object('ok',false,'code','HUMAN_REVIEW_UNAVAILABLE');
  end if;
  r:=sma_private.publication_order_current_v1(j);
  if r->'ok' is distinct from 'true'::jsonb then return r; end if;
  if sma_private.publication_supplemental_review_option_v1(j,sma_private.publication_order_media_v1(j,r->'media_check',j.account_check)) is null then
   return jsonb_build_object('ok',false,'code','HUMAN_REVIEW_UNAVAILABLE');
  end if;
  update sma_private.publication_orders_v1 set supplemental_review=p_input->'review', supplemental_review_at=now(),updated_at=now()
    where id=j.id returning * into j;
  return sma_private.publication_order_view_v1(j);
 end if;
$save$;
begin
 if position(allowed in request_def)=0 or position(has_review in request_def)=0 or position(after_lock in request_def)=0
    or position(view_anchor in view_def)=0 or position(media_anchor in media_def)=0 then
  raise exception 'PUBLICATION_SUPPLEMENTAL_REVIEW_BASELINE_CHANGED';
 end if;
 request_def:=replace(request_def,allowed,'p_action not in (''prepare'',''get'',''approve'',''cancel'',''supplement'')');
 request_def:=replace(request_def,has_review,'p_action not in (''approve'',''supplement'') and p_input?''review''');
 execute replace(request_def,after_lock,save_action||after_lock);
 execute replace(view_def,view_anchor,'''supplemental_review_option'',sma_private.publication_supplemental_review_option_v1(j,media),
   ''supplemental_review_at'',j.supplemental_review_at,''supplemental_review'',j.supplemental_review,'||view_anchor);
 -- Only adapt the local row used for evaluating media, retaining immutable original consent.
 execute replace(media_def,media_anchor,$evidence$
 if j.supplemental_review_at is not null and j.approved_at is not null
   and not (j.approval_review ? 'human_review') then
  j.approval_review:=j.approval_review||jsonb_build_object('human_review',j.supplemental_review);
  j.approved_at:=j.supplemental_review_at;
 end if;
$evidence$||media_anchor);
end $migration$;
