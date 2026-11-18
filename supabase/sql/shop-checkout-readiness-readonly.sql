-- SMA public Shopify checkout: operator-only, read-only metadata preflight.
-- As of 18 Nov 2026. No customer identifiers, addresses, product URLs or tokens returned.
-- This checks the current SMA database contract, not Shopify payment, checkout
-- release flags, stock availability at Shopify or a real order/fulfilment E2E.
-- Run as a single SELECT in the private Supabase SQL editor. Never expose as RPC.
WITH eligible_shops AS (
 SELECT k.id,k.user_id,k.kunde_id
 FROM public.sma_kunden k
 WHERE k.aktiv IS TRUE AND k.shop_oeffentlich IS TRUE
   AND (k.zahlung_bestaetigt IS TRUE OR k.demo_delta_aktiv IS TRUE)
), accounts AS (
 SELECT s.id AS shop_id,
  count(a.id) FILTER (WHERE a.aktiv IS TRUE) AS active_count,
  min(lower(btrim(a.shopify_domain))) FILTER (WHERE a.aktiv IS TRUE) AS domain,
  min(nullif(btrim(a.markt_konto_id),'')) FILTER (WHERE a.aktiv IS TRUE) AS account_ref
 FROM eligible_shops s
 LEFT JOIN public.sma_shopify_konten a ON a.sma_kunden_id=s.id
 GROUP BY s.id
), catalogue AS (
 SELECT s.id AS shop_id,p.sma_produkt_id,p.shopify_aktiv,p.preis,p.waehrung,
  p.bestand,p.kauf_url,a.active_count,a.domain,a.account_ref
 FROM eligible_shops s
 JOIN public.sma_produkte p ON p.user_id=s.user_id AND p.kunde_id=s.kunde_id
   AND p.aktiv IS TRUE
 JOIN accounts a ON a.shop_id=s.id
), checked AS (
 SELECT *,
  (sma_produkt_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') IS TRUE AS product_id_ok,
  (active_count=1 AND domain ~ '^[a-z0-9][a-z0-9-]*[.]myshopify[.]com$'
    AND account_ref IS NOT NULL) IS TRUE AS account_ok,
  (kauf_url IS NOT NULL AND
    lower(btrim(kauf_url)) ~ '^https://[a-z0-9][a-z0-9-]*[.]myshopify[.]com/cart/[1-9][0-9]{5,24}:[1-9][0-9]*/?$'
    AND lower(btrim(kauf_url)) LIKE 'https://' || domain || '/cart/%') IS TRUE AS variant_ok,
  (preis IS NOT NULL AND preis>=0 AND preis*100=trunc(preis*100)
    AND preis*100<=9007199254740991 AND length(preis::text)<=64
    AND waehrung ~* '^[a-z]{3}$') IS TRUE AS price_ok,
  (bestand IS NOT NULL AND bestand>0 AND bestand<=9007199254740991) IS TRUE AS stock_ok,
  substring(lower(btrim(kauf_url)) from '/cart/([1-9][0-9]{5,24}):') AS variant
 FROM catalogue
), checked_unique AS (
 SELECT checked.*,
  (variant IS NOT NULL AND count(*) FILTER (
    WHERE shopify_aktiv IS TRUE AND variant IS NOT NULL
  ) OVER (PARTITION BY shop_id,variant)=1) AS variant_unique
 FROM checked
)
SELECT jsonb_build_object(
 'version',1,'checked_at',now(),'scope','aggregate_read_only',
 'eligible_public_shops',(SELECT count(*) FROM eligible_shops),
 'shops_with_one_active_shopify_account',(SELECT count(*) FROM accounts
   WHERE active_count=1 AND domain ~ '^[a-z0-9][a-z0-9-]*[.]myshopify[.]com$'
     AND account_ref IS NOT NULL),
 'public_active_products',(SELECT count(*) FROM catalogue),
 'shopify_enabled_products',count(*) FILTER (WHERE shopify_aktiv IS TRUE),
 'products_with_valid_checkout_metadata',count(*) FILTER (
   WHERE shopify_aktiv IS TRUE AND product_id_ok AND account_ok AND variant_ok
     AND price_ok AND stock_ok AND variant_unique),
 'shopify_products_with_no_stock',count(*) FILTER (
   WHERE shopify_aktiv IS TRUE AND stock_ok IS FALSE),
 'shopify_products_with_invalid_account',count(*) FILTER (
   WHERE shopify_aktiv IS TRUE AND account_ok IS FALSE),
 'shopify_products_with_invalid_variant',count(*) FILTER (
   WHERE shopify_aktiv IS TRUE AND (
     product_id_ok IS FALSE OR variant_ok IS FALSE OR variant_unique IS FALSE)),
 'shopify_products_with_invalid_price',count(*) FILTER (
   WHERE shopify_aktiv IS TRUE AND price_ok IS FALSE),
 'status',CASE
   WHEN (SELECT count(*) FROM eligible_shops)=0 THEN 'NO_PUBLIC_ELIGIBLE_SHOP'
   WHEN count(*) FILTER (
     WHERE shopify_aktiv IS TRUE AND product_id_ok AND account_ok
       AND variant_ok AND price_ok AND stock_ok AND variant_unique)>0
     THEN 'SOME_PRODUCTS_HAVE_VALID_LOCAL_CHECKOUT_METADATA_NOT_E2E'
   ELSE 'NO_VALID_LOCAL_CHECKOUT_PRODUCT' END,
 'shopify_payment_or_stock_e2e','NOT_VERIFIED_BY_THIS_QUERY',
 'live_checkout_release','NOT_VERIFIED_BY_THIS_QUERY',
 'allows_new_checkout',false
) AS checkout_readiness
FROM checked_unique;
