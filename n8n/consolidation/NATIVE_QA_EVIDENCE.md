# Native QA evidence and limits

These are observations reported by the operator of the existing n8n QA workflow
on Cloud **2.47.7**, combined with local fixture hashes. The offline builder did
not perform the live runs. No signed resume URL, ticket, credential, customer
payload or provider data is included here.

## Thumbnail batch and strict dispatcher — successful

| Evidence | Observed value |
| --- | --- |
| Parent execution | `7112` |
| Native child executions | `7113` through `7122`, ten distinct child IDs |
| Parent duration | 4.787 seconds |
| Native scheduling | Sequential; each child received one input item |
| Results | Nine accepted synthetic results and one preserved partial denial |
| Mapping | Parent pairing 0–9, original business payload and binary preserved |
| Inherited deadline | `1794847120381`, shared across the ten child operations |
| Receipt | Sequential, mapping, payload, binary and shorter-deadline checks true |
| External service effects | Zero; no payment, real upload, provider or social action |

The exact dispatcher runtime prefix SHA-256 was
`6b69b1da0ba821478976459ac1572084c677a8402aeb5975b2a6341f39c68b74`.
The successful fixture SHA-256 was
`b5c9a1006a69b645773598fdb32bbe017fb13bf7d382d8456d0d144c7bae8447`.

An earlier attempt reached ten native children but failed its evidence Code
return because engine `metadata.subExecution` was copied into the item output.
The successful fixture and runtime use an explicit public item-field allowlist.
The offline regression injects that engine metadata so the same output-format
failure cannot pass unnoticed. This proves the native transport/dispatcher
contract with synthetic data; it does not prove real thumbnail provider access.

## File-job parent, dynamic Wait suffix — rejected

Execution `7123` consumed two synthetic inline commands, then reached the first
Wait with phase 1 and mocked RPC run index 2. Its observed signed
`/webhook-waiting/7123/file-command-1` path returned HTTP 404 stating that there
was no waiting webhook with matching path/method. The request was made minutes
after the execution was waiting, so this was not the early-listener race.

The failed parent component had 47 nodes and SHA-256
`8d8e683d0e6ab7866402238d39cf1b88e91c0309d456285d94a32e641296982d`.
The transport-free fixture had 51 nodes and SHA-256
`53983472d1d05cdef3d31133e360c9935522f51d7e1c744c39ae274aefef4a74`.
The private inputs are preserved in the staging history for execution `7123`.
This result invalidated the dynamic-suffix approach; it is not recorded as a
successful parent/resume test.

## File-job parent, fixed phase paths — successful

The corrected parent uses 64 literal phase-specific Wait paths and a numeric
phase switch within the same parent execution. Its 111-node component SHA-256
is `711d18f4584e4948b7182b38f700b54c70607e3230972ed5faaa47e9ef0385e0`.
The 115-node fixture SHA-256 is
`e87f3f1c0f65fb6ed4ac78e14d6049b802e6824b3f4bbc526b264d17c121ca7f`.
All 21 original Code validators and all 64 fixed Wait nodes are unchanged in
the fixture; only service transport, initial manual acknowledgement and native
business work are replaced with deterministic local doubles.

The operator read the final native receipt for execution **7127**, using the
existing QA workflow `9XKreTHHGR3Agtwd`. The UI showed **Succeeded**, duration
**3 minutes 13.165 seconds**, and then no active execution. This duration includes
the operator's two manual resume steps; it is not a worker-performance benchmark.

| Evidence | Observed value |
| --- | --- |
| Parent execution | `7127` across every phase |
| Initial inline commands | Two |
| First fixed-phase POST | HTTP 202, command 3 |
| Replay of phase 1 while phase 2 waited | HTTP 404; did not wake phase 2 |
| Second fixed-phase POST | HTTP 202, command 4 |
| Native child executions | `7128`, `7129`, `7130`, `7131` |
| Receipt flags | `phase_specific_wait_nodes`, `same_parent_across_phases`, `current_resume_item_verified`, `accept_error_and_success_verified`, `phase_limit_finish_verified`: all true |
| External service calls | Zero |
| Publication capability | `can_publish: false` |

The receipt identified `sma-file-job-native-v1`, `synthetic: true`, two inline
commands, two signed resumes, four native children and the exact component hash
above. It confirms both the intentionally lost acknowledgement/context-recovery
branch and the normal acknowledgement branch. No repeated QA run is necessary
for this unchanged fixture.

The mocked final phase 64 exercises the finish branch after four synthetic
commands; it does not claim 64 native commands were run. Database transitions,
the actual six command adapters and provider/file work require their separate
integration evidence. No production readiness follows merely from building the
fixture or compiling its expressions.

## QA workflow restored after the probes

The operator restored the original **17-node** QA graph and name, with
`active: false`, `activeVersionId: null`, the original 600-second overall timeout
and manual saving disabled. The private readback is
`qa-before/restored-verified.json`. The only observed settings representation
change was that the UI saved `redactCallerExecutions: true` where the original
export omitted it.

This preserves the exact n8n 2.47.7 default. The versioned
[WorkflowSettings.vue source](https://github.com/n8n-io/n8n/blob/n8n%402.47.7/packages/frontend/editor-ui/src/features/workflows/components/WorkflowSettings/WorkflowSettings.vue)
sets this default to true and fills it when the stored field is absent. The
versioned
[subworkflow runtime](https://github.com/n8n-io/n8n/blob/n8n%402.47.7/packages/cli/src/workflow-execute-additional-data.ts)
uses `workflowData.settings?.redactCallerExecutions !== false` when propagating
the child's redaction to its caller. Absence and true therefore have the same
protection; false would lower it.

The import readback verifier recognizes only this single absent/true
equivalence and records it in the result. False, null, other values and every
unrelated settings difference remain mismatches. Candidate JSONs and business
hashes were not changed to accommodate the UI representation.
