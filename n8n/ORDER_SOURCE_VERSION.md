# Shopify order source revision

The SMA dashboard reads canonical orders from `public.sma_bestellungen`.
The existing n8n mirror node now passes the signed Shopify order's `updated_at`
as `quelle_aktualisiert_am`, after the existing HMAC check. Credentials, URL,
conflict keys, connections and other node parameters are unchanged.

The database trigger compares source revisions while PostgreSQL holds the row
lock for UPDATE / ON CONFLICT. Older and equal revisions return the entire
existing row, including its mirror timestamp. PostgREST therefore returns one
item and n8n can continue to its webhook acknowledgement. A newer revision can
change any business status, including a refund; there is no status ranking.

Missing, infinite, future (>5 minutes), or pre-creation source timestamps fail.
Order identity and owner cannot be reassigned. The function uses SECURITY
INVOKER, an empty search path and a private schema. Existing owner mapping,
unique key and RLS remain in place.

## Deployment

1. Add the nullable source column before publishing the sender change.
2. Export and preserve both the published workflow and the separate draft.
3. Apply only `order-source-timestamp.json` to the published baseline. Compare
   the exported candidate: exactly one node changes, all connections/settings
   remain identical. Publish that candidate.
4. Fetch all current Shopify orders and reconcile IDs, merchant account,
   amount, currency, payment and fulfillment status with the SMA rows.
5. In one transaction, lock the order table, ensure the rows still match the
   reconciled snapshot, backfill only the source timestamps, and install the
   migration trigger. Never infer source timestamps from the mirror time.
6. Run the SQL tests with BEGIN/ROLLBACK and check RLS and security advisors.
7. Re-run the mirror node with saved data from the existing test order. Confirm
   one canonical result, no duplicate order, no changed business data.
8. Restore the separate draft, add the same source field and save without
   publishing unrelated changes.

## Verification and limits

`tests/shop-order-source-version.sql` contains 14 assertions against a temporary
table using the real trigger. Wrap it in BEGIN/ROLLBACK. `tests/shop-order-rls.sql`
tests five actual access boundaries and rolls itself back. It expects at least
one order and a non-matching synthetic outsider UUID.

The legacy n8n data table remains an intermediate cache; it does not implement
this atomic revision guard. The canonical SMA dashboard is protected. Equal
timestamps retain the existing row, even if payloads differ. A periodic Shopify
reconciliation is still needed to handle missed webhooks and timestamp ties.
Concurrent independent sessions were not load-tested; atomicity relies on the
database's native row locking, not a prior SELECT in n8n.

References:
- https://shopify.dev/docs/apps/build/webhooks
- https://www.postgresql.org/docs/17/transaction-iso.html
- https://supabase.com/docs/guides/database/functions
