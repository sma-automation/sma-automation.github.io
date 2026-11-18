# SMA – n8n active payment graph: restricted diagnostic (18.11.2026)

## Observed live facts (first operator GET-only GitHub Action)

The manual Actions run `44370988923` completed with a **nonzero** outcome.
The **n8n Public API connection worked**: the saved-execution metadata
was returned with `SAVED_HISTORY_NOT_BILLING`. That is neither the
n8n billing meter nor proof of an end-to-end customer publication.

The separately retrieved **active version** of the n8n payment workflow
`8v2wcz5lh0yUf3sw` did not match the repository's strict
standalone payment contract. The auditor returned only these fixed codes:

- `required_payment_nodes_missing`
- `database_credential_reference_mismatch`
- `mollie_credential_reference_mismatch`
- `n8n_customer_table_reference_mismatch`

This is a mismatch of the **published** graph, not necessarily a
broken product: the installed workflow may be a legacy or deliberately
consolidated graph, or the API may omit credential/table references.

## Additional static diagnosis

The audited helper `n8n/package-payment/diagnose-active-payment-graph.cjs`
can summarize an already fetched published-version graph in memory.
Only the following are ever returned: the number of published nodes,
the number of template nodes present, a bounded list of missing
**public template** node names, boolean status for two known webhook
paths, and counts of template nodes that include credential or table
references. It NEVER emits arbitrary n8n node names, node parameters,
customer fields, credentials, table IDs, execution records or source
workflow JSON.

The helper is attached to `audit-live-worker.cjs` **only when the
strict published contract fails**. A mismatch is never converted to a
pass, activation permission, payment approval, or a billing/E2E claim.
The optional summary has
`published_version_stability_rechecked:false` because the existing
fail-fast auditor stops on the mismatching active graph; it does not
treat a mismatch as stable publication evidence.

Interpretation:

- Missing expected template nodes: structural difference, regardless
  of whether credential references were masked.
- All expected nodes present, but credential references absent: may
  mean API filtering; investigate privately instead of inventing
  credential assignments.
- Correct template shape but differing parameters or routing: maintain
  the fail-closed block and compare the version privately.
- Stored execution metadata: do not interpret as actual Cloud-billed starts.

No payment calls, n8n workflow executions, credential changes, edits,
publishing, customer activation, or access to customer media are
authorized by this diagnostic.

## Next step

After tests and merge, repoint the independent **manual-only**
`.github/workflows/sma-n8n-readonly-check.yml` in the default
branch to the reviewed source commit and print only the safe summary.
The user starts the action explicitly. The authenticated key remains
in GitHub Actions Secrets and must never be copied into chat or code.
After the diagnosis, verify the correct n8n active version against the
intended standalone/consolidated payment service **before a real first
customer booking**.
