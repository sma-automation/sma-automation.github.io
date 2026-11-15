-- STAGED / NOT DEPLOYED: require an explicit AIGC declaration for NEW TikTok preparations.
-- This updates only the existing order validation function. No tables, grants,
-- customer orders, approvals, provider permissions or upload workflows are changed.
-- Source guard is the read-only production prosrc MD5 verified 2026-11-10.
do $aigc$
declare
  definition text := pg_get_functiondef('sma_private.publication_order_request_v1(text,jsonb)'::regprocedure);
  original_md5 text := (select md5(prosrc) from pg_proc where oid='sma_private.publication_order_request_v1(text,jsonb)'::regprocedure);
  old_allowed constant text := $old$or exists(select 1 from jsonb_object_keys(ch) k where k not in ('visibility','made_for_kids','contains_synthetic_media','disable_comment','disable_duet','disable_stitch','brand_content_toggle','brand_organic_toggle'))$old$;
  new_allowed constant text := $new$or exists(select 1 from jsonb_object_keys(ch) k where k not in ('visibility','made_for_kids','contains_synthetic_media','disable_comment','disable_duet','disable_stitch','brand_content_toggle','brand_organic_toggle','is_aigc'))$new$;
  old_required constant text := $old$not(ch ?& array['disable_comment','disable_duet','disable_stitch','brand_content_toggle','brand_organic_toggle'])$old$;
  new_required constant text := $new$not(ch ?& array['disable_comment','disable_duet','disable_stitch','brand_content_toggle','brand_organic_toggle','is_aigc'])$new$;
  old_portal constant text := $old$if (p_input->>'platform'='youtube'$old$;
  new_portal constant text := $new$if (p_input->>'platform'<>'tiktok' and ch ? 'is_aigc')
 or (p_input->>'platform'='youtube'$new$;
begin
  if original_md5 is distinct from 'ce9dc4edbe66a00ce89924c1a91b49d1'
     or position(old_allowed in definition)=0 or position(old_required in definition)=0
     or position(old_portal in definition)=0 or position('is_aigc' in definition)<>0
     then raise exception 'TIKTOK_AIGC_ORDER_BASELINE_CHANGED';end if;
  -- An older unfinished TikTok order lacks the new bound declaration.
  -- Refuse a partial rollout rather than reviving it with a guessed value.
  if exists(
    select 1 from sma_private.publication_orders_v1 j
    where j.binding->>'platform'='tiktok'
      and j.state<>'cancelled'
      and jsonb_typeof(j.choices->'is_aigc') is distinct from 'boolean'
  ) then raise exception 'TIKTOK_AIGC_LEGACY_ACTIVE_ORDER';end if;
  definition:=replace(definition,old_allowed,new_allowed);
  definition:=replace(definition,old_required,new_required);
  execute replace(definition,old_portal,new_portal);
end
$aigc$;
