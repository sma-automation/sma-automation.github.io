# Shopify test-order classification

Status: prepared, not deployed (2026-11-05).

The dashboard currently displays test order #1010 as paid without identifying
the simulated payment. Shopify's authoritative `Order.test` flag now has a
complete proposed path from the signed order webhook and periodic recovery to
the canonical order table and dashboard.

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

The initial live rollback-preflight confirmation expired without execution.
The SQL suites were instead executed in an isolated synthetic database.
Read-only verification confirmed ten production orders and no new column.

## Deployment sequence

1. Restore the n8n authenticated session; it currently shows the sign-in page.
   Export the active workflow and separately saved draft before editing.
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
