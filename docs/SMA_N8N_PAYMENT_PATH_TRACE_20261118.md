# SMA – Read-only trace of published n8n payment webhook paths (18 Nov 2026)

## Confirmed live baseline

The manual GitHub Actions n8n API run **#2** (ID `44376710959`) was authenticated and read the **published version** of workflow `8v2wcz5lh0yUf3sw`. The independent strict diagnostic reported:

- 391 published nodes.
- 0 of 26 nodes named like the independently generated *standalone* SMA payment service.
- Exactly one expected first-payment webhook and one renewal webhook were found.
- The expected standalone activation folder-guard and customer-update node names were not found.
- The static auditor exited nonzero. A missing exact *name* is not evidence that a differently named or consolidated route is nonfunctional.

**This is a structural mismatch, not a passed customer-payment E2E.** No n8n execution, Mollie charge, approval, post, credential alteration, or customer activation was performed by the diagnostic.

## What the new graph tracer does

`n8n/package-payment/inspect-payment-webhook-paths.cjs` accepts only an already fetched published graph and reads its `nodes` and `connections` locally. For the two fixed webhook **paths**, it follows directed `main` connections, with finite graph and edge limits. It reports only bounded structural numbers and flags:

- Whether each payment webhook is unique and configured for `POST` with `responseNode`.
- Each entry's number of outgoing edges, reachable nodes, reachable `respondToWebhook` nodes and terminal nodes.
- Counts of reachable code, HTTP, data-table, conditional and subworkflow nodes.
- The number of reachable HTTP nodes **configured** with mutating HTTP methods (not evidence they ran).
- Reachability of the **specific standalone** activation folder-guard node name, if present.
- Number of nodes reachable from both webhooks, unknown graph connection targets/sources, and a fixed failure code on malformed data.

It **never prints arbitrary names, provider URLs, API keys, tables, credentials, customer data, node code, route parameters, workflow JSON, execution IDs or external requests**. The graph is inspected in memory only.

The true safety properties of a payment branch cannot be determined from reachability alone. A path to `respondToWebhook` does not prove every conditional branch responds; a reachable guard does not prove that the guard is effective. The output always states that customer activation, billing and E2E remain unverified.

## Extra published-version protection

Previously the strict live auditor returned immediately on contract mismatch, before performing its third metadata GET. The patched auditor now **always** re-reads the workflow's `activeVersionId` after inspecting the published graph, even when the contract fails. If publication changed during inspection, it discards the prior route diagnostic and emits `N8N_PUBLISHED_VERSION_CHANGED_DURING_AUDIT`. A successful recheck attests only to an unchanged active version ID across those reads; it does not grant payment authority.

## Actual live route trace – manual read-only run #3

On 18 November 2026, GitHub Actions run [#3](https://github.com/sma-automation/sma-automation.github.io/actions/runs/44382696735) completed with conclusion `failure` **because the strict standalone contract still mismatches**, not because the n8n Public API login failed. The graph remained bound to an unchanged published `activeVersionId` across the audit. The trace itself succeeded.

| Evidence | Published result |
|---|---:|
| Published workflow nodes | 391 |
| Total `main` connections | 410 |
| Unknown `main` connection targets | 0 |
| Expected standalone payment nodes matching by exact name | 0 of 26 |
| First-payment webhook, single POST/responseNode entry | Yes |
| First-payment outgoing `main` edges | 1 |
| First-payment reachable nodes | 17 |
| First-payment reachable response nodes | 1 |
| First-payment reachable Code / HTTP / Data Table nodes | 5 / 6 / 3 |
| First-payment reachable subworkflows | 0 |
| Renewal webhook, single POST/responseNode entry | Yes |
| Renewal outgoing `main` edges | 1 |
| Renewal reachable nodes | 9 |
| Renewal reachable response nodes | 1 |
| Renewal reachable Code / HTTP / Data Table nodes | 3 / 2 / 1 |
| Renewal reachable subworkflows | 0 |

The separately expected node name `Ordnerzuordnung vor Aktivierung prüfen` was **not** reachable on either path. That means only that this exact standalone name was absent; a differently named or embedded check is neither proven nor ruled out. Likewise `0/26` name matches makes the credential/table-reference mismatch codes **non-diagnostic about actual credential correctness**.

The same run read **49 saved executions** within the tool's selected UTC calendar-month window, of which **27** had webhook/trigger mode. These are preserved-history metadata counts, **not** n8n Cloud billable execution totals, costs per file, or proof of any customer end-to-end processing.

The next blocker is therefore not discovering whether the webhook routes exist (they do), but verifying the *contents and behavior* of the published first-payment and renewal routes: signed one-time ticket validation, strict customer/merchant binding, Mollie idempotency and receipt checks, same-row Drive folder mapping and access, conditional activation, post-write confirmation, suspension and recovery. A reachable response alone does not attest these conditions. The real Drive service identity, permitted customer-level E2E and actual billed usage measurement remain open.

This run did not start any n8n execution, Mollie payment, Drive write, social post or customer activation. **Do not substitute a synthetic graph or rename nodes to make the static checker green.**

## To finish the first customer blocker

After regression tests/merge, the separate **manual-only** GitHub Actions workflow can be pinned to this audited commit and enhanced to print only selected graph counters. One deliberate operator-run `payment` audit will then reveal whether each payment webhook actually reaches a response and whether the route has HTTP/Code/Data Table stages.

If either route is disconnected or lacks a response, examine the active n8n editor version privately. **Do not alter the published payment graph until the linked order, one-time ticket, Mollie idempotency, customer-row matching, folder checks, and pause/recovery paths have been compared.** The exact customer-level Drive permissions and the full paid-customer E2E remain separate blockers.

No changes to live Supabase, n8n, Mollie or the customer dashboard are made by this trace.
