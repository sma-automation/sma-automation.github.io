-- SMA: live payment RPC role and signature preflight (read-only).
-- Run privately in the existing Supabase SQL Editor with catalog-read rights.
-- Never invokes these functions, starts a payment, activates a customer,
-- changes permissions, or accesses the rows of business/customer tables.
-- A successful result is NOT a payment/merchant/Drive/customer E2E.
--
-- Expected audit_status:
-- EXPECTED_ROLE_BOUNDARIES_PRESENT_NOT_PAYMENT_E2E
-- Any other status: stop automatic checkout and investigate the mismatch.
WITH expected(name, caller, signature, defaults) AS (
  VALUES
  ('sma_package_ticket_v1','service','p_id uuid, p_job jsonb',2),
  ('sma_package_worker_v1','service','p_id uuid, p_lease uuid, p_action text, p_data jsonb',1),
  ('sma_package_renewal_v1','service','p_id uuid, p_lease uuid, p_action text, p_data jsonb',0),
  ('sma_package_schedule_claim_v1','service','p_ticket uuid',0),
  ('sma_package_schedule_result_v1','service','p_id uuid, p_lease uuid, p_result text, p_check_on date',0),
  ('sma_onboarding_booking_v1','customer','p_owner uuid, p_offer uuid, p_plan text, p_terms text',3)
), checks AS (
  SELECT e.name,
    count(p.oid) AS installed_overloads,
    coalesce(bool_and(
      pg_get_function_identity_arguments(p.oid)=e.signature
      AND p.pronargdefaults=e.defaults
      AND array_position(p.proconfig,'search_path=""') IS NOT NULL
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND (CASE WHEN e.caller='service' THEN
        p.prosecdef
        AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
        AND has_function_privilege('service_role',p.oid,'EXECUTE')
      ELSE
        NOT p.prosecdef
        AND has_function_privilege('authenticated',p.oid,'EXECUTE')
      END)
    ),false) AS acl_and_signature_match
  FROM expected e
  LEFT JOIN pg_proc p ON p.proname=e.name
  LEFT JOIN pg_namespace n ON n.oid=p.pronamespace AND n.nspname='public'
  WHERE n.nspname='public' OR p.oid IS NULL
  GROUP BY e.name
)
SELECT CASE WHEN count(*)=6
    AND count(*) FILTER (WHERE installed_overloads=1 AND acl_and_signature_match)=6
  THEN 'EXPECTED_ROLE_BOUNDARIES_PRESENT_NOT_PAYMENT_E2E'
  ELSE 'REVIEW_REQUIRED' END AS audit_status,
  count(*) AS expected_function_count,
  count(*) FILTER (WHERE installed_overloads=1 AND acl_and_signature_match) AS matching_functions,
  jsonb_agg(jsonb_build_object('name',name,'unique',installed_overloads=1,
    'contract',acl_and_signature_match) ORDER BY name) AS functions
FROM checks;
