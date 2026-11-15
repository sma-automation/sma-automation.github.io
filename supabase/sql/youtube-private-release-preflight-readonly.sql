-- SMA: private YouTube release preparation, internal read-only evidence snapshot.
-- No identities, file identifiers, captions, target accounts or private media.
-- An observed catalog revision or pass count is NOT a provider/account/rights approval.
-- Do not expose this operator query as a public RPC or client API.
WITH prepared AS (
  SELECT
    o.id, o.user_id, o.customer_id, o.binding, o.choices, o.approved_at,
    sma_private.publication_approval_window_v1(o) AS approval_window
  FROM sma_private.publication_orders_v1 o
  WHERE o.state = 'prepared' AND o.binding->>'platform' = 'youtube'
),
inspected AS (
  SELECT
    p.id,
    p.choices->>'visibility' = 'private' AS private_selected,
    p.approved_at IS NOT NULL AS customer_approval_recorded,
    p.approval_window->>'status' = 'active' AS approval_window_active,
    f.id IS NOT NULL AND f.available IS TRUE AS catalog_file_available,
    f.id IS NOT NULL AND f.revision = p.binding->>'asset_revision'
      AS catalog_revision_matches,
    f.id IS NOT NULL AND f.verified_at >= now() - interval '15 minutes'
      AS catalog_verified_last_15m,
    EXISTS (
      SELECT 1 FROM sma_private.publication_provider_permissions_v1 permission
      WHERE permission.order_id = p.id
    ) AS permission_row_exists,
    EXISTS (
      SELECT 1 FROM sma_private.publication_provider_attempts_v1 attempt
      WHERE attempt.order_id = p.id
    ) AS provider_attempt_row_exists,
    CASE WHEN f.id IS NOT NULL AND f.available IS TRUE
      THEN sma_private.publication_media_precheck_v1(f, 'youtube')
      ELSE NULL::jsonb END AS media_check
  FROM prepared p
  LEFT JOIN sma_private.publication_files_v1 f
    ON f.id = CASE
      WHEN coalesce(p.binding->>'asset_id', '') ~*
        '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      THEN (p.binding->>'asset_id')::uuid ELSE NULL::uuid END
    AND f.customer_id = p.customer_id AND f.user_id = p.user_id
),
media_codes AS (
  SELECT e->>'code' AS code, e->>'status' AS status
  FROM inspected i
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(i.media_check->'checks') = 'array'
      THEN i.media_check->'checks' ELSE '[]'::jsonb END
  ) e
),
aggregates AS (
  SELECT
    count(*) AS prepared_youtube,
    count(*) FILTER (WHERE private_selected IS TRUE) AS private_selected,
    count(*) FILTER (WHERE customer_approval_recorded IS TRUE) AS customer_approvals,
    count(*) FILTER (WHERE approval_window_active IS TRUE) AS active_approval_windows,
    count(*) FILTER (WHERE catalog_file_available IS TRUE) AS catalog_files_available,
    count(*) FILTER (WHERE catalog_revision_matches IS TRUE) AS matching_catalog_revisions,
    count(*) FILTER (WHERE catalog_verified_last_15m IS TRUE) AS recently_verified_catalog_files,
    count(*) FILTER (WHERE permission_row_exists IS TRUE) AS orders_with_permission_records,
    count(*) FILTER (WHERE provider_attempt_row_exists IS TRUE) AS orders_with_attempt_records,
    count(*) FILTER (WHERE media_check->>'status'='needs_review') AS media_needs_review
  FROM inspected
),
media_rollup AS (
  SELECT
    count(*) FILTER (WHERE status='pass') AS passed_checks,
    count(*) FILTER (WHERE status='pending') AS pending_checks,
    count(*) FILTER (WHERE status='fail') AS failed_checks,
    coalesce(jsonb_agg(DISTINCT code ORDER BY code)
      FILTER (WHERE status='pending' AND code IS NOT NULL),'[]'::jsonb)
      AS pending_codes
  FROM media_codes
),
checked_private AS (
  SELECT
    count(*) AS orders,
    count(*) FILTER (WHERE o.approved_at IS NOT NULL) AS customer_approvals,
    count(*) FILTER (WHERE sma_private.publication_account_valid_v1(
      o.account_check, o.target, o.choices)) AS current_stored_account_checks,
    count(*) FILTER (WHERE p.fingerprint = sma_private.publication_provider_fingerprint_v1(o)
      AND p.expires_at > now()) AS current_bound_permissions,
    count(*) FILTER (WHERE p.fingerprint = sma_private.publication_provider_fingerprint_v1(o)
      AND p.expires_at <= now()) AS expired_bound_permissions,
    count(a.order_id) AS orders_with_attempt_records,
    count(*) FILTER (WHERE a.order_id IS NULL) AS orders_without_attempt_records,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM sma_private.publication_provider_events_v1 e WHERE e.order_id = o.id
    )) AS orders_with_event_records,
    count(*) FILTER (WHERE sma_private.publication_history_entry_v1(o)->>'status'
      = 'private_complete') AS portal_confirmed_private
  FROM sma_private.publication_orders_v1 o
  LEFT JOIN sma_private.publication_provider_permissions_v1 p ON p.order_id = o.id
  LEFT JOIN sma_private.publication_provider_attempts_v1 a ON a.order_id = o.id
  WHERE o.state = 'checked' AND o.binding->>'platform' = 'youtube'
    AND o.choices->>'visibility' = 'private'
)
SELECT jsonb_build_object(
  'version', 2,
  'checked_at', now(),
  'scope', 'internal_operator_aggregate_read_only',
  'selection', 'prepared_youtube_orders_and_checked_private_youtube_orders',
  'order_counts', jsonb_build_object(
    'prepared_youtube', a.prepared_youtube,
    'private_visibility_selected', a.private_selected,
    'customer_approvals', a.customer_approvals,
    'approval_windows_active', a.active_approval_windows,
    'catalog_files_available', a.catalog_files_available,
    'matching_catalog_revisions', a.matching_catalog_revisions,
    'catalog_files_verified_last_15m', a.recently_verified_catalog_files,
    'orders_with_permission_records', a.orders_with_permission_records,
    'orders_with_provider_attempt_records', a.orders_with_attempt_records
  ),
  'media_check', jsonb_build_object(
    'orders_needing_review', a.media_needs_review,
    'passed_check_count', r.passed_checks,
    'pending_check_count', r.pending_checks,
    'failed_check_count', r.failed_checks,
    'pending_codes', r.pending_codes
  ),
  'checked_private_youtube', to_jsonb(c),
  'limits', jsonb_build_object(
    'stored_catalog_match_is_not_fresh_drive_proof', true,
    'current_youtube_oauth_not_verified', true,
    'customer_rights_review_not_verified', true,
    'permission_record_does_not_grant_new_approval', true,
    'provider_e2e', 'NOT_VERIFIED_BY_THIS_QUERY'
  ),
  'allows_upload', false,
  'allows_publication', false,
  'initiates_checkout', false
) AS readiness
FROM aggregates a CROSS JOIN media_rollup r CROSS JOIN checked_private c;
