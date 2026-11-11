-- SMA launch readiness / purely read-only aggregate preflight
-- Read with an authorized operator in Supabase SQL editor, never through the public dashboard.
-- No customer identifiers, captions, tokens, file paths or media bytes are returned.
-- Counts and timestamps are NOT a replacement for personal approvals or provider E2E evidence.
WITH snapshot AS (
 SELECT
  now() AS inspected_at,
  (SELECT count(*) FROM public.sma_kunden) AS customers,
  (SELECT count(*) FROM public.sma_kunden WHERE aktiv IS TRUE
    AND (zahlung_bestaetigt IS TRUE OR demo_delta_aktiv IS TRUE)) AS entitled_accounts,
  (SELECT count(*) FROM public.sma_kunden WHERE aktiv IS TRUE
    AND zahlung_bestaetigt IS TRUE) AS paid_accounts,
  (SELECT count(*) FROM public.sma_kunden WHERE aktiv IS TRUE
    AND demo_delta_aktiv IS TRUE AND zahlung_bestaetigt IS NOT TRUE) AS demo_only_accounts,
  (SELECT count(*) FROM sma_private.publication_orders_v1) AS publication_orders,
  (SELECT count(*) FROM sma_private.publication_orders_v1
    WHERE approved_at IS NOT NULL) AS approved_orders,
  (SELECT count(*) FROM sma_private.publication_orders_v1
    WHERE state='prepared') AS prepared_orders,
  (SELECT count(*) FROM sma_private.publication_orders_v1
    WHERE state='cancelled') AS cancelled_orders,
  (SELECT count(*) FROM sma_private.publication_files_v1
    WHERE available IS TRUE) AS available_files,
  (SELECT count(*) FROM sma_private.publication_files_v1
    WHERE available IS TRUE AND verified_at >= now()-interval '15 minutes') AS recently_verified_files,
  (SELECT count(*) FROM sma_private.publication_provider_permissions_v1) AS operator_permissions,
  (SELECT count(*) FROM sma_private.publication_provider_attempts_v1) AS provider_attempts,
  (SELECT count(*) FROM sma_private.publication_provider_events_v1) AS provider_events,
  (SELECT count(*) FROM sma_private.publication_gallery_technical_v1) AS gallery_technical_records,
  (SELECT count(*) FROM sma_private.gallery_music_v1) AS gallery_music_jobs,
  (SELECT count(*) FROM sma_private.customer_websites_v1
    WHERE published_at IS NOT NULL) AS published_customer_websites,
  (SELECT count(*) FROM sma_private.website_provider_connections_v1) AS website_connections,
  (SELECT count(*) FROM public.sma_bestellungen) AS shop_orders,
  (SELECT count(*) FROM public.sma_bestellungen
    WHERE ist_testbestellung IS TRUE) AS shop_test_orders,
  (SELECT count(*) FROM public.sma_bestellungen
    WHERE ist_testbestellung IS NULL) AS unknown_test_status_orders
)
SELECT jsonb_build_object(
 'version',1,
 'inspected_at',inspected_at,
 'scope','aggregate_read_only',
 'accounts',jsonb_build_object(
  'total',customers,'entitled',entitled_accounts,
  'paid',paid_accounts,'demo_only',demo_only_accounts
 ),
 'publishing',jsonb_build_object(
  'orders',publication_orders,'prepared',prepared_orders,
  'cancelled',cancelled_orders,'approved',approved_orders,
  'operator_permissions',operator_permissions,
  'provider_attempts',provider_attempts,'provider_events',provider_events,
  'state',CASE
    WHEN approved_orders=0 OR operator_permissions=0 THEN 'BLOCKED_NO_EXPLICIT_APPROVAL'
    ELSE 'MANUAL_PROVIDER_E2E_REVIEW_REQUIRED' END
 ),
 'media',jsonb_build_object(
  'files_available',available_files,'files_verified_last_15m',recently_verified_files,
  'gallery_music_jobs',gallery_music_jobs,
  'gallery_technical_records',gallery_technical_records,
  'state',CASE
    WHEN available_files=0 THEN 'NO_AVAILABLE_FILES'
    WHEN recently_verified_files=0 THEN 'FRESH_VERIFICATION_REQUIRED'
    ELSE 'CHECK_EXACT_SELECTED_FILE' END
 ),
 'websites',jsonb_build_object(
  'published',published_customer_websites,'connections',website_connections,
  'state',CASE WHEN published_customer_websites=0 THEN 'NO_PUBLISHED_CUSTOMER_SITE'
    ELSE 'MANUAL_DOMAIN_AND_PAGE_E2E_REQUIRED' END
 ),
 'shop',jsonb_build_object(
  'orders',shop_orders,'test_orders',shop_test_orders,
  'unknown_test_status_orders',unknown_test_status_orders,
  'payment_mode','VERIFY_SHOPIFY_PAYMENTS_EXTERNALLY'
 ),
 'external_e2e_status','NOT_VERIFIED_BY_THIS_QUERY',
 'requires_personal_approval',true,
 'allows_publication',false,
 'initiates_checkout',false
) AS readiness
FROM snapshot;
