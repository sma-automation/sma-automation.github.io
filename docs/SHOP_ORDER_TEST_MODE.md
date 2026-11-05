# Shopify test-order classification

Status: backend deployed and verified; dashboard release tracked in PR #80
(2026-11-05, UTC).

Shopify's authoritative `Order.test` flag is preserved from the signed order
webhook and periodic recovery through the canonical order table. The dashboard
change identifies simulated payments explicitly, including test order #1010.

## Behaviour

- `ist_testbestellung=true`: “Testbestellung – keine echte Zahlung”; a paid
  status is displayed as “Testzahlung bestätigt”.
- `false`: regular payment and fulfillment labels. This is Shopify's non-test
  classification, not independent proof of a captured payment.
- NULL, absent or malformed data: “Teststatus noch nicht bestätigt”. Legacy
  senders cannot erase a previously verified boolean value.
- The authenticated dashboard reads the flag through the existing owner filter
  and RLS. No client writes or additional privileges are introduced.

The test flag is immutable in Shopify. An equal source revision can fill an
unknown flag but cannot overwrite any other business field. Stale revisions
cannot classify an order; a newer revision cannot flip an established flag.
Repeated deliveries preserve the canonical row and mirror timestamp.

## Validation

- `node --test tests/shop-orders.test.cjs tests/order-reconciliation.test.cjs`
- `node tests/run-order-test-mode-sql.mjs`: synthetic PostgreSQL/WASM database,
  14 existing source-order checks, 25 recovery checks and 10 test-mode checks.
- Shopify Admin GraphQL 2026-07 schema validation passes for
  `n8n/order-reconciliation.graphql`.
- Read-only Shopify inspection returned ten orders: six test orders and four
  non-test orders. #1010 is a test order. No orders, payments or inventory were
  changed for this inspection.

The SQL suites ran in an isolated synthetic database. Production verification
then confirmed the following deployment results:

- Migration `track_shopify_order_test_mode` applied both SQL files atomically.
- Recovery workflow `wudynmKEwHU8QPQ4` published with the updated query and
  validator only. Export comparison confirmed all other nodes, connections and
  settings were unchanged.
- Signed webhook workflow `GHBsYQcyt0JLFvRP` published version
  `68d295c6-c07f-4fdc-8395-528d4a92b3d6` with 511 nodes. The only change from
  the former published version is the additional JSON body field in
  **SMA – Supabase – Bestellung spiegeln**. HMAC verification is unchanged.
- The separate 515-node inventory draft was backed up and restored. Draft
  version `5927ba8a-b235-42cc-b13f-abf800a3e146` matches the original draft
  exactly except for the same test-status field. It remains unpublished.
- Recovery completed at 22:52:03 UTC: ten rows classified, six test and four
  non-test, no inserts and no timestamp conflicts. Hashes excluding only the
  new flag and mirror timestamp confirmed all business values unchanged.
- Repeat recovery completed at 23:02:08 UTC: ten checked, ten unchanged, zero
  inserts, zero updates and zero conflicts. #1010 remains 85.79 EUR and test.
- Supabase security-advisor findings are unchanged from the pre-migration
  baseline; no grants, policies or new public functions were added.

No new purchase was used for this verification. The webhook deployment was
verified by exact export comparison; recovery was exercised end to end.

## Deployment sequence

1. Export the active workflow and separately saved draft before editing.
2. Apply `supabase/sql/order-test-mode.sql` followed by
   `supabase/sql/order-reconciliation.sql` in one migration. The column is
   nullable with no default; existing senders remain compatible.
3. In **SMA – Shopify Bestellabgleich V1** (`wudynmKEwHU8QPQ4`), update only
   the GraphQL query in **Shopify Seiten lesen** and JavaScript in
   **Bestellungen validieren** from the checked-in workflow template.
4. Add the single JSON body parameter from `n8n/order-test-mode.json` to
   **SMA – Supabase – Bestellung spiegeln**, after the existing HMAC check.
   Apply it to the published baseline and separate draft while preserving
   their differences. Never publish unrelated draft changes. Keep URL,
   credentials, headers, conflict key and all existing mappings unchanged.
5. Run the scoped recovery, verify ten classifications, six tests, zero
   timestamp conflicts and unchanged business values. Repeat to verify zero
   changes. Do not force a stale Shopify snapshot over newer webhook data.
6. Deploy the dashboard only after the column and ingestion paths are ready.
   Confirm #1010 shows the test badge and the expected 85.79 EUR amount.

Keep Shopify payment test mode enabled. Do not place another order or change
fulfillment, stock, refunds or checkout settings for this change.

Rollback: revert the dashboard and n8n additions first; the nullable column and
compatible ingestion functions may safely remain. Do not drop customer data.
