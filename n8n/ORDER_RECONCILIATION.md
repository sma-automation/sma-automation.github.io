# Shopify order reconciliation

Recovers missed Shopify order webhooks into the existing Supabase dashboard mirror.
The dedicated n8n workflow is `SMA – Shopify Bestellabgleich V1`
(`wudynmKEwHU8QPQ4`), published as "Bestellabgleich V1 – 15 Minuten". It does not modify the main customer assistant workflow.

## Operation

- Schedule: every 15 minutes, Europe/Vienna. A manual trigger uses the same path.
- Only explicitly enabled rows in `sma_private.order_reconciliation_v1` participate.
  The initial deployment opts in the existing SMA test merchant only.
- The service-only RPC derives tenant, owner, account and exact Shopify hostname
  from the existing database mapping. Customer entitlement must remain valid.
  Checkout release (`sma_shopify_konten.aktiv`) remains a separate gate.
- Claims are serialized per account with `FOR UPDATE SKIP LOCKED`, a random lease,
  and a 10-minute expiry. The workflow timeout is 8 minutes. The next due time
  uses the claim start plus 14 minutes, avoiding a skipped 15-minute tick caused
  by normal execution duration or scheduler jitter.
- Every claim retrieves fresh Shopify credentials through the existing encrypted
  n8n credential table. Account, customer, credential reference, sync opt-in,
  connection status and exact HTTPS hostname must match. Redirects are disabled.
- Read-only Admin GraphQL API `2026-07`, `read_orders`, 50 orders per page,
  maximum 200 pages, 750 ms between requests. A fixed two-minute-old upper bound
  is used for the run. The pagination cursor preserves the original request's
  variables; it must not use n8n item linking inside pagination expressions.
- All pages are collected and validated before one atomic database transaction.
  Partial GraphQL errors, missing pages, duplicates, invalid source timestamps,
  invalid amounts/statuses, and a reached page cap with more results fail closed.
- Missing rows are inserted with the existing owner trigger. Newer Shopify
  revisions update the mirror. Newer mirror revisions are preserved. Identical
  rows do not change the mirror timestamp. Financial amounts remain decimal
  strings until PostgreSQL converts them to numeric.
- Equal source timestamps with different business values are recorded as
  `review_required`. They do not overwrite the existing row. Differences solely
  in status capitalization or `partial`/`partially_fulfilled` are equivalent.
- Completion checks the current account mapping, entitlement and lease again.
  No stock, payment, fulfillment, refund, cancellation or notification operation
  is performed. Orders absent from a response are never deleted.

## Monitoring and recovery

Read `account_id,status,started_at,finished_at,last_success_at,next_run_at,result`
from `sma_private.order_reconciliation_v1`. The result contains counts and at
most 100 conflict order IDs, never tokens, addresses or customer emails.

`failed` is eligible after five minutes and retried on the next scheduler tick.
A crashed execution leaves a lease that expires before the next normal tick.
`review_required` needs investigation of the listed timestamp conflicts.
The n8n execution itself may succeed after a handled failure; the database audit
status is authoritative. No email or messaging alert is configured.

In the published configuration, execution payload persistence is disabled for success, errors and manual runs
because intermediate nodes handle access credentials. Do not pin credential
outputs or enable full execution logging. The audit survives independently. n8n file import does not apply workflow settings;
set and verify these options in the workflow settings dialog before publishing.
Early unpublished setup runs used the instance defaults; normal n8n retention
applies to their execution records.

To pause one account, set its private configuration's `enabled=false`.
To stop all runs, unpublish this dedicated workflow. Existing webhook ingestion
and the order timestamp guard continue to operate.

## Scope and limits

Shopify normally exposes the last 60 days of orders to `read_orders`.
Reconciliation covers the orders the installed app can read; older orders need
`read_all_orders` approval before broader historical coverage can be claimed.
This release does not request or expand access scopes.

The full accessible window is rescanned on each successful run, avoiding a
watermark that might silently skip delayed search-index entries. It is not a
point-in-time Shopify snapshot. A change during pagination is caught by a later
run; newer webhook data is protected by row locks and the source timestamp guard.
Stores exceeding 10,000 accessible orders require a bulk or windowed strategy.
Equal-timestamp conflicts are deliberately not automatically resolved.

## Validation

- 20 transactional SQL assertions, including missing creation, newer refund,
  stale snapshot, duplicate claim, foreign account, invalid lease, incomplete
  input, duplicate IDs, invalid money, error retry, and client-access denial.
  Fixtures and DDL preflight are rolled back.
- 25 JavaScript response/workflow tests; all 83 application tests pass.
- Live two-page test (page size 5): all 9 existing orders unchanged, no conflicts.
- Final page size 50 also validated through the real n8n/Shopify/Supabase path.
- No live order is deleted or altered to simulate a missing webhook. Recovery
  mutations are tested with disposable database fixtures inside a rollback.
- Multi-session lock contention and Shopify throttle/outage simulation were not
  load tested; existing HTTP retry and failed-run paths are exercised separately.

Apply `supabase/sql/order-reconciliation.sql` with the authenticated Supabase
migration API. Initial history entry: `add_shopify_order_reconciliation`; timing
adjustment: `align_order_reconciliation_schedule`. Reapply is idempotent and does
not enable additional accounts. Run the SQL test file only inside `BEGIN` and
`ROLLBACK`; it deliberately changes fixture/config rows within that transaction.

References:
- https://shopify.dev/docs/apps/build/webhooks
- https://shopify.dev/docs/api/admin-graphql/2026-07/queries/orders
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/
- https://supabase.com/docs/guides/database/postgres/roles
