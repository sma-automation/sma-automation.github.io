# Five existing business workflows: private candidate builder

This directory contains the routing manifest, a read-only inventory checker, a
deterministic private candidate builder, the strict native-call dispatcher, and
synthetic native probes. These tools do not import, activate, publish or execute
workflows, contact providers, or change the original exports. Full exports,
credential references and generated import candidates remain outside the repo.

The builder produces exactly five inactive candidates using existing IDs. A
successful build is structural evidence, not a deployment approval or proof of
production behavior. The native parent and command adapters need their own
runtime and integration checks before cutover.

## Existing destinations

| Existing ID | Responsibility |
| --- | --- |
| `GHBsYQcyt0JLFvRP` | Customer account, OAuth, market-account connections, website session, legal responses and publication-account checks |
| `8v2wcz5lh0yUf3sw` | Shop products, inventory, orders, recovery and package payments |
| `aEm2khRhdM6EUdoq` | File catalogue, thumbnails, original files, device uploads, soundtrack processing and the separate file-job parent graph |
| `RdtCqCWRi7P4W7B0` | Drafts, content analysis/comparison, saved-text handoff and publication readiness |
| `JaidX5YeKl6ZTqjQ` | Provider execution, cover handling and returned publication status |

`five-workflows.plan.json` maps all 26 published source IDs. The large customer
workflow is split by its actual entry graphs, not moved wholesale into one group.
Shopify OAuth and market-account connection/import stay with account management;
product operations, order events and legacy Mollie endpoints move with commerce.
The existing registration/login forms and Meta selection/resume remain in their
original workflow ID. Disabled polling entry points are marked for the inactive
rollback copy, not reactivation.

## Run the checker

```sh
python n8n/consolidation/audit.py --exports /private/fresh-n8n-exports --summary
```

While collecting exports, add `--allow-incomplete`. Omit `--summary` to inspect
entry paths, form/wait webhook IDs, credentials by reference, graph components,
literal cross-graph references and source fingerprints. Output goes to stdout.
Missing exports fail the default command; ambiguous graph assignments, missing
targets and duplicate active webhook routes fail even with `--allow-incomplete`.
An inventory-complete report is not a deployment approval or a runtime test.

## Build private candidates

`build.py` requires all 26 fresh, published source exports and a separate reviewed
manifest. Source IDs, version IDs and canonical hashes are pinned. Optional
overlay manifests also pin the original and transformed file bytes, operation
and native entry. An overlay cannot change the existing public Webhook, Form or
Wait entry contract. Missing inputs, stale hashes, unreviewed settings or dynamic
references fail before writing a candidate.

A component manifest can add a separately namespaced graph to an existing
target. The file-job parent uses this mechanism instead of inheriting the old
thumbnail operation's timeout. It is not a sixth workflow. A component cannot
provide a workflow ID, activation state, static data, its own overall timeout,
an additional native trigger, or a conflicting public/callback path.

```sh
python n8n/consolidation/build.py \
  --exports /workspace/shared/sma-five-workflows-20261116/before \
  --review /private/reviewed-five-workflows.json \
  --overlay-manifest /private/thumbnail-overlays/thumbnail-batch-overlays.json \
  --overlay-manifest /private/command-overlays/file-command-overlays.json \
  --component-manifest /private/file-job-parent/components.manifest.json \
  --metadata-exports /private/active-full-metadata \
  --output /workspace/shared/sma-five-workflows-20261116/candidates/reviewed-build
```

`--review-template` emits unresolved settings and input pins without creating
candidates. It never supplies an approval automatically. The output directory is
restricted to the private staging tree above; existing different candidates are
not overwritten. A provenance file records retained/excluded nodes, original and
new internal targets, operation markers, guard placement, static-data migration,
settings changes and candidate hashes.

## Internal calls and external entry paths

Every internal Execute Sub-workflow call must retain its execution mode,
wait-for-completion setting, error behavior, binary items, item pairing and return
shape. The manifest provides an explicit destination ID and operation. Each
target has one native trigger, a validator and an operation router. The exact
envelope is `{operation, payload, context: {deadlineAt}}`; extra keys, unknown or
mixed operations, invalid deadlines and mixed item deadlines are rejected.
Original business JSON is restored before the retained graph. Binary data and
item pairing are preserved separately; outputs are not wrapped. Engine-only
`metadata.subExecution` is not emitted as a Code output field in n8n 2.47.7.

Passthrough inputs and the observed empty resource mapper retain their effective
values. A nonempty mapper or non-waiting child call fails until a dedicated
materializer/return adapter has been reviewed. Native same-target calls always
carry a specific internal operation. A public path cannot enter the dispatcher.
Shared response graphs are accepted only when an exact own-native-entry
`isExecuted` IF gate proves that the internal branch cannot reach the public
response. A body field is not accepted as proof of execution origin.

Preserve every public method/path and its authentication, raw-body and response
semantics. In particular, regular media paths and the three existing pilot paths
are different public contracts. They can share implementation only after node
references have been normalized behind those entry points. All credential IDs
remain the existing references; no credentials are copied into code or documents.

The legacy `JPtiMBrudXLxxSrz` operation remains in the provider target even though
the observed current caller uses `JaidX5YeKl6ZTqjQ`. No unobserved legacy caller
is disconnected merely because it was not present in the sample. Disabled old
publisher and polling graphs remain in the original rollback exports.

## Long-lived file parent

`file-job-parent.cjs` generates a private standalone graph for the media target.
The existing Supabase binding fixes the owner, parent execution and 24-hour job
deadline. Commands queued while the parent is working are consumed inline.
Otherwise it waits and accepts a ticket for the current phase. All nine command
routes call the fixed existing source operation; the candidate builder rewrites
them to the five targets and passes only the four-field ticket payload.

The parent uses 64 fixed Wait paths (`file-command-1` through `file-command-64`)
inside the same parent execution. In the native 2.47.7 probe, a data expression in
`webhookSuffix` produced a matching-path 404. Literal phase-specific paths avoid
that unsupported behavior and prevent an old signed phase URL from waking a
later phase. The phase switch never creates a new workflow or parent execution.
Terminal running jobs are finished only after the authoritative state confirms
there are no pending commands; uncertain/expired states are not reported as a
successful publication.

`file-job-native-probe.cjs` derives a transport-free probe from the pinned parent
component. Original validators and fixed Wait nodes stay unchanged; RPCs and
child business operations become deterministic local doubles. It exercises two
inline commands, two signed resumes, four native children, both accept-response
branches, current `.item` lineage and the terminal finish branch. This probe does
not prove actual database, file or provider behavior. Use the existing QA ID;
the generator does not create or start a workflow.

## Settings and cutover constraints

Workflow settings apply to the whole destination. The reviewed profile uses
NoSave for success/error/manual execution payloads and progress, same-owner native
callers, MCP disabled, Europe/Vienna, execution order v1 and separate binary data.
The order target retains its 600-second overall limit. The other targets omit an
own limit and inherit the Cloud/instance limit; omission does not mean unlimited.

Each originally bounded 60–600-second entry establishes its absolute operation
deadline once. Children inherit the shorter parent deadline. Guards stop further
work/responses after expiry; HTTP timeouts also use the remaining budget while
retaining a stricter preexisting request limit. Loop edges cannot reenter an
entry marker, and immutable markers are read from run zero. A reviewed fixed
node/field can additionally shorten a call deadline: the thumbnail batch's 35
seconds and the file parent's saved job deadline are forwarded this way.

These are cooperative operation guards, not independent task-runner cancellation
timers. An already running Code job or non-abortable DataTable/ExtractFromFile
builtin can run until its task/global limit. The old global timeout could cancel
a Code task; it never guaranteed rollback of an already started database write.
This remaining distinction is explicit in the review. Unbounded form, OAuth
Wait and original audio paths do not acquire an arbitrary short branch deadline.
Provider, payment and consent deadlines in the retained code/SQL remain in force.

Node names and literal expressions are rewritten consistently across graphs.
Both quote styles are supported. Unknown dynamic node/workflow references fail;
the few reviewed finite literal selectors are rewritten explicitly. The checker
flags references across assigned destinations, form/Wait identifiers,
execution-based identities and dynamic-reference limits.

n8n 2.47.7 permits only one ManualTrigger per workflow. The commerce sources had
three; a real UI import removed two surplus triggers. The builder now retains
their entry names and business branches as guarded Code bridges behind one
ManualTrigger and an Edit Fields selector. `manual_operation` defaults to an
empty string, which stops without running any administrative branch. Only an
exact operation listed in the selector note routes to one original branch;
there is no fan-out. Clear the selection after an intentional manual run. The
single existing audio test trigger is unchanged, and every target has exactly
one native subworkflow trigger.
The stock draft's `$workflow.id` and `$execution.id` participate in its idempotency
key; moving it requires preserving the one-operation-per-execution behavior.
Static-data field absence is not evidence of emptiness. Stateful triggers need
full active metadata. Only the explicitly reviewed hourly Schedule bookkeeping
is migrated byte-for-byte to its final namespaced key; its obsolete 15-minute
key remains in rollback. Any other nonempty state fails closed.

An already waiting OAuth or publishing execution must finish or retain a valid
resume path through cutover. Recheck active/waiting/queued executions immediately
before the switch. Original exports remain unchanged rollback material.

Do not unpublish a source until its external path and all live internal callers
have moved. Method/path ownership must transfer without a collision between two
published copies. Archive/inactivate old versions only after structural parity,
safe negative checks and appropriate end-to-end verification.

The 2.47.7 UI import regenerates node UUIDs and does not apply workflow settings.
`verify_import.py` therefore ignores only node ID/position, while comparing node
names, types, parameters, callback IDs, credentials, error flags, connections and
settings strictly. It prints differing paths without private values. The default
mode verifies only the editor graph. `--published` requires active-version
metadata so an unpublished draft cannot pass as the active graph. The hourly
static-data value requires full metadata after import.
Observed UI serialization also omits Code v2's default
`mode: runOnceForAllItems` and empty terminal/trailing connection lanes. The
verifier normalizes exactly these equivalents; it never removes an actual edge,
reindexes an interior empty lane, accepts per-item execution as all-items, or
ignores a missing node. The n8n 2.47.7 absent/true `redactCallerExecutions`
default equivalence is recorded separately, with false still treated as a change.

```sh
python n8n/consolidation/verify_import.py \
  --candidate /private/candidate.json \
  --readback /private/active-metadata.json --published
python -B -m unittest discover -s n8n/consolidation -p 'test_*.py' -q
node --test n8n/consolidation/dispatcher-runtime.test.cjs \
  n8n/consolidation/file-job-parent.test.cjs \
  n8n/consolidation/file-job-native-probe.test.cjs
```

## Bounded dashboard checks after OAuth

The existing account workflow renders the dashboard's connection controls.
Previously an unfinished OAuth attempt kept its pending platform indefinitely:
every later window-focus or visibility return could request another full
dashboard through the existing n8n session endpoint. The old retry counter did
not bound those passive return events.

`dashboard-oauth-refresh.cjs` supplies the replacement browser block;
`patch-dashboard-oauth-refresh.cjs` applies it only to the reviewed renderer
with its exact original definition hash. The private full workflow export stays
outside this repository. The patch changes no trigger, route, credential,
connection graph or workflow setting and creates no workflow.

A deliberate connection-link click grants one passive status check on return.
Focus and visibility events consume that allowance together, before scheduling
the check. An unfinished connection or failed read leaves a visible
“Verbindungsstatus prüfen” action in Publishing → Portals. This action reads the
current status without restarting OAuth. Later passive returns do not retry it.
The native connection link and its `noopener` behavior remain unchanged.
The status region stays outside the replaceable platform list. Its own display
state overrides the existing chapter rule that hides other social-page children,
so it also works in an already loaded dashboard with that stylesheet.

Allowed fresh success notifications remain hints for a server check, never
proof of a connection. Duplicate notifications do not reset the passive
allowance. Request generations protect newer connection attempts from old
responses; a new connection attempt or success notification during a running
check is combined into at most one pending follow-up. Removing the dashboard
ends its scheduled checks. Restoring it from the browser's back/forward cache
retains the manual controls, discards old scheduled checks and snapshots, and
does not start another read automatically. Customer identity is checked before applying a
returned dashboard, and access decisions are not cached for the day.

The isolated `oauth-return-refresh` tests count actual mocked dashboard
requests and exercise cancellation, delayed completion, duplicate notifications,
customer changes and the visible manual action in the existing portal layout.
Browser cases run in the existing CI jobs, without real OAuth or provider calls.
This bounds the specific OAuth-return path; normal page reloads and deliberate
later status checks remain real dashboard requests in the usage calculation.

## Execution budget

Five active workflows are an organizational target, not a cost calculation.
Retaining six external calls inside one workflow still creates six starts.
Existing Execute Sub-workflow invocations do not add billed executions, so
removing those helpers alone does not save the 10,000-execution allowance.
Actual reductions require fewer external requests, bounded recovery schedules,
cache/deduplication, batching or dispatch only when work is due. Calculate the
budget for the stated 20 customers and three files per customer per day from
those real entry events, including navigation, provider callbacks and retries.

An offline, *non-activating* capacity model is available without cloud API calls:

```sh
node n8n/consolidation/execution-budget.cjs --customers 20 --files-per-day 3 --days 30 --executions-per-file 26
node --test tests/n8n-execution-budget.test.cjs
```

The `--executions-per-file` value is a **scenario input, not a measured result**.
The model uses the communicated 10,000 monthly starts with an optional reserve
(default 2,000), includes daily and customer-specific overhead, and never caps
customer count at 20. A mathematically affordable scenario is not a tested
live workflow. See [capacity and measurement guide](../../docs/SMA_N8N_EXECUTION_CAPACITY.md).
