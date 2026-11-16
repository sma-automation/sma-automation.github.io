# Reversible publication sequence: 26 existing sources to five targets

This is a preparation runbook, not a record of a completed production switch.
All 26 source workflows were published in the captured inventory. The final
state is the five existing target IDs published and the other 21 unpublished.
Original source versions remain rollback material; do not delete them. The QA
workflow remains outside the five and must be unpublished after testing.

## Required evidence before the window

- Complete fresh source/active-version pins, unchanged original exports and the
  five reviewed candidate hashes. Current private build: `integrated-v2`.
- Native fixed-phase parent probe **7127** succeeded, including current
  resume-item binding, error/success acknowledgement paths and replay rejection.
  It and successful thumbnail probe **7112** are recorded in
  `NATIVE_QA_EVIDENCE.md`; the exact unchanged fixture need not be rerun.
- Real local SQL contract checks and offline adapter/Edge/client tests pass. The
  existing CI job `Publication history checks / test` contains
  `Test file job transport, mailbox and native workflow contracts`; its first
  local equivalent passed 105 Node tests, two expected private-export skips and
  29 Python tests. Skips are not evidence for the omitted private source checks.
- Supabase worker/public RPC and Edge prerequisites are available before a new
  parent/command route can be used. Publish the new frontend only after all five
  backends and their settings have been read back successfully.
- Immediately before changing ownership, verify no active, waiting or queued
  executions, including OAuth, legacy publishing, upload/audio and provider
  work. A previous empty-list observation is not a lock against a new request.
  Check pending business/provider work as well; a sleeping remote provider is
  not necessarily an active n8n execution.

There is no verified maintenance switch in the inspected files. Publication
across multiple IDs is not atomic. Use a controlled quiet/maintenance window
with ingress constrained by an existing verified mechanism, if available. Do
not claim zero downtime or assume every external callback retries. Without a
verified ingress boundary, a quiet-window handoff has a real availability gap;
check any outstanding payment/audio/provider work before transferring those
paths. This is a technical constraint, not an additional permission request.

Draft imports may be prepared ahead only while active-version readback proves
the published graph is unchanged. The 2.47.7 UI does not apply candidate settings
on import; settings may affect the currently published workflow. Apply reviewed
settings during the controlled switch, not casually while preparing drafts.

## Concrete order

Native dependencies determine the order. The new provider target calls account;
the new order target calls account/provider and itself; the new media parent
calls order and media. Commerce is independent. No retained HTTP Request node
in the 26 source exports makes a static call back to an n8n webhook.

First unpublish the old callers in this order:

1. `RdtCqCWRi7P4W7B0` — order API; temporarily off, restored as target below.
2. `JaidX5YeKl6ZTqjQ` — current provider; temporarily off, restored below.
3. `JPtiMBrudXLxxSrz` — legacy provider, retained inside the new provider target.
4. `zLlhr1I1vKm2AiiU` — execution-check caller.
5. `ZFO9NSh5nHSn3ues` — content-comparison delivery caller.
6. `JZwPbzCpgIByxk94` — publisher preparation caller.

This releases the old native leaves before those leaves are unpublished. Do not
disconnect a leaf while an old caller can still execute it. The temporary count
is now 20 published workflows, subject to fresh UI confirmation.

Then perform the following five groups. In every group, remove the old owners
listed in the middle column before publishing the complete target candidate.
Read back the target before proceeding to a group that depends on it.

| Step / target | Old source IDs to unpublish immediately before this target | Target action and expected published count |
| --- | --- | --- |
| 1. Account `GHBsYQcyt0JLFvRP` | `LR2Qng41OIYuVHAR`, `JHkHPTTL2ttfCMMg`, `vL1YJJF2jnqvkZxQ` | Replace its existing published version with the account candidate; **17** remain. |
| 2. Commerce `8v2wcz5lh0yUf3sw` | `LeeH7IigyGRRUuxS`, `JlHOooUl0ySzAV8j`, `wudynmKEwHU8QPQ4` | Replace the existing payment target in place; **14** remain. Its primary payment path stays on the same ID; do not deliberately unpublish this target early. |
| 3. Provider `JaidX5YeKl6ZTqjQ` | None additionally; old `JPtiMBrudXLxxSrz` was stopped above. | Publish the provider candidate after account is verified; **15** remain. |
| 4. Order `RdtCqCWRi7P4W7B0` | `1qMj37a5gXlrbCWd`, `LxayneKkUusok0Q8`, `9dNstQ4E2uXpZ18Z`, `dheEkIi8KUNqHpmq`, `a1F5Ps0B3sXMh70S`, `mWoUMjzxAsfggRHU` | Publish after account/provider are verified; **10** remain. The other three old order callers were stopped above. |
| 5. Media `aEm2khRhdM6EUdoq` | `Tta5irg2Z3DiCGy4`, `c6ncyk7ZTlQzX7z3`, `KQpy1Y5M7Br60nJt`, `lo3Wt6jem0CxCrJF`, `By3G8ESyl7yqViqa` | Replace the existing pilot-thumbnail target in place, after order is verified; **5** remain. Stop the audio source last in this group, after checking it is idle, to keep its transfer window short. |

The table plus the six preliminary entries accounts for all 26 original IDs.
The counts describe expected states, not a substitute for inventory readback.
The old main graph has routes moving to commerce, provider and media; those
routes have a bounded transfer gap between account replacement and the later
group. Their callback requirements belong in the maintenance-window decision.
No target is published alongside another published owner of the same method/path.

## Readback and reopening

Use `verify_import.py` against fresh exports. It ignores only regenerated node
UUIDs/positions. Require exact paths, callback IDs, parameters, credentials,
connections, execution/error flags and settings. `--published` requires active
version evidence; an editor-only match is insufficient. The hourly Schedule
needs full metadata proving its reviewed state under the final node name.

Confirm the account/commerce/media/provider targets have no own overall timeout,
the order target has 600 seconds, and all five use the reviewed NoSave/sameOwner/
MCP-disabled/Europe-Vienna profile. The 33 per-operation entry markers preserve
shorter original budgets; do not add 180 seconds to the whole media parent.
The commerce Schedule stays hourly, not the obsolete 15-minute schedule. Avoid
a scheduler restart near the hour boundary; check that only one hourly trigger
is published. Do not manually execute it to test publication.

Verify the five published IDs, the other 21 unpublished, the QA workflow
unpublished, and no unexpected startup/retry executions. Only then release the
new frontend/Edge entry use. Use authorized negative/read-only checks; this
cutover does not authorize real payment, upload or social-publication probes.

## Rollback

Keep the currently working public frontend until the five-way readback passes.
If a candidate fails before reopening, hold ingress and restore the captured
versions/settings; do not improvise a hybrid graph. Stop new media callers
first, then order, then provider. Verify active/waiting/queued work again before
restoring an ID. Never restart a waiting file job as a replacement parent.

If new file parents already exist, a blind rollback is unsafe: they contain
native dispatcher calls to the new target graphs. Drain/resolve those jobs with
their existing execution binding before removing their callees. Reverting a
webpage does not stop already open browser tabs. Keep additive SQL records and
receipts; do not drop tables, clear leases or replay an uncertain command.

For an idle rollback, unpublish the five new target graphs before enabling
conflicting original routes. Restore the five original graphs, names, settings
and callback IDs from their pinned exports; the other 21 originals were never
edited. Restore the original Schedule static state from full active metadata.
Publish original native leaves first (`LR2Qng41OIYuVHAR`, `LxayneKkUusok0Q8`,
`1qMj37a5gXlrbCWd`), then `JZwPbzCpgIByxk94`, then
`zLlhr1I1vKm2AiiU` and `ZFO9NSh5nHSn3ues`, then the two providers, and finally
`RdtCqCWRi7P4W7B0`. Restore the independent original account, commerce and media
public workflows without overlapping a still-published consolidated route.
Read back all 26 published source versions and settings before reopening the
old frontend. This restores the old count deliberately as rollback, not as the
successful five-workflow outcome.
