'use strict';

// These are offline checks of the fixture and its actual Code-node bodies.
// They deliberately do not pretend to emulate native Wait or establish billing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { createProbeRuntime, buildWorkflow } = require('./wait-resume-probe.cjs');

const start = 1_795_000_000_000;
const executionId = 'synthetic-execution-42';
const clone = (value) => JSON.parse(JSON.stringify(value));

function runCode(node, { id = executionId, body, saved, now = start } = {}) {
  const sandbox = {
    $execution: { id },
    $input: { first: () => ({ json: body === undefined ? {} : { body } }) },
    $: (name) => ({ first: () => ({ json: clone(saved.get(name)) }) }),
    Date: class extends Date { static now() { return now; } },
  };
  return clone(vm.runInNewContext('(function () {\n' + node.parameters.jsCode + '\n})()', sandbox, { timeout: 1000 }));
}

function advanceTo(sequence) {
  const runtime = createProbeRuntime();
  let previous = runtime.initialize(executionId, start);
  for (let index = 0; index < sequence; index++) {
    previous = runtime.advance(previous, clone(previous.next_request.body), executionId, runtime.phases[index], start + index + 1);
  }
  return { runtime, previous };
}

test('both committed fixtures are deterministic and differ only in name/timeout setting', () => {
  for (const explicitTimeout of [true, false]) {
    const file = explicitTimeout ? 'wait-resume-probe.workflow.json' : 'wait-resume-probe.inherited-timeout.workflow.json';
    const actual = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.equal(actual, JSON.stringify(buildWorkflow({ explicitTimeout }), null, 2) + '\n');
  }
  const bounded = buildWorkflow();
  const inherited = buildWorkflow({ explicitTimeout: false });
  assert.equal(bounded.settings.executionTimeout, 120);
  assert.equal(Object.hasOwn(inherited.settings, 'executionTimeout'), false);
  delete bounded.settings.executionTimeout;
  bounded.name = inherited.name;
  assert.deepEqual(bounded, inherited);
});

test('fixture is inactive, manual-only and has no credentials, caller, schedule or outbound node', () => {
  const workflow = buildWorkflow();
  assert.equal(workflow.active, false);
  assert.equal(Object.hasOwn(workflow, 'id'), false);
  assert.equal(Object.hasOwn(workflow.settings, 'errorWorkflow'), false);
  assert.equal(workflow.settings.saveManualExecutions, true);
  const allowed = new Set(['manualTrigger', 'code', 'wait', 'respondToWebhook'].map((name) => 'n8n-nodes-base.' + name));
  assert.equal(workflow.nodes.length, 14);
  assert.equal(workflow.nodes.filter((node) => node.type.endsWith('.manualTrigger')).length, 1);
  assert.equal(new Set(workflow.nodes.map((node) => node.id)).size, 14);
  for (const node of workflow.nodes) {
    assert.ok(allowed.has(node.type), node.type);
    assert.equal(Object.hasOwn(node, 'credentials'), false);
    assert.equal(Object.hasOwn(node, 'retryOnFail'), false);
    assert.equal(Object.hasOwn(node, 'continueOnFail'), false);
    assert.doesNotMatch(node.parameters.jsCode || '', /\b(?:fetch|require|eval)\s*\(|\$http|https?:\/\//);
  }
});

test('four native Wait 1.1 nodes have unique suffixes, POST, a fixed job deadline and validated responses', () => {
  const workflow = buildWorkflow();
  const waits = workflow.nodes.filter((node) => node.type.endsWith('.wait'));
  assert.equal(waits.length, 4);
  assert.equal(new Set(waits.map((node) => node.webhookId)).size, 4);
  assert.deepEqual(waits.map((node) => node.parameters.options.webhookSuffix), ['probe-1', 'probe-2', 'probe-3', 'probe-4']);
  for (const [index, node] of waits.entries()) {
    assert.equal(node.typeVersion, 1.1);
    assert.equal(node.parameters.resume, 'webhook');
    assert.equal(node.parameters.incomingAuthentication, 'none');
    assert.equal(node.parameters.httpMethod, 'POST');
    assert.equal(node.parameters.responseMode, 'responseNode');
    assert.equal(node.parameters.limitWaitTime, true);
    assert.equal(node.parameters.limitType, 'atSpecifiedTime');
    const stateNode = index === 0 ? 'Probe - initialize' : 'Probe - accept ' + index;
    assert.equal(node.parameters.maxDateAndTime, '={{ new Date($(' + JSON.stringify(stateNode) + ').first().json.state.deadline_at).toISOString() }}');
  }
  for (let index = 0; index < workflow.nodes.length - 1; index++) {
    assert.deepEqual(workflow.connections[workflow.nodes[index].name], {
      main: [[{ node: workflow.nodes[index + 1].name, type: 'main', index: 0 }]],
    });
  }
  assert.equal(Object.hasOwn(workflow.connections, workflow.nodes.at(-1).name), false);
});

test('actual generated Code bodies accept four serialized continuations under one execution ID', () => {
  const workflow = buildWorkflow();
  const saved = new Map();
  const initialize = workflow.nodes.find((node) => node.name === 'Probe - initialize');
  let previous = runCode(initialize)[0].json;
  saved.set(initialize.name, previous);
  for (let step = 1; step <= 4; step++) {
    const node = workflow.nodes.find((candidate) => candidate.name === 'Probe - accept ' + step);
    const body = clone(previous.next_request.body);
    previous = runCode(node, { body, saved, now: start + step * 1000 })[0].json;
    saved.set(node.name, clone(previous));
    assert.equal(previous.state.sequence, step);
    assert.equal(previous.state.execution_id, executionId);
    assert.equal(previous.state.deadline_at, start + 600_000);
    assert.equal(previous.receipt.same_execution, true);
    assert.equal(previous.receipt.external_effects, 0);
  }
  assert.equal(previous.next_request, null);
  assert.equal(previous.receipt.complete, true);
  assert.deepEqual(previous.receipt.accepted_phases, ['upload_complete', 'edit_saved', 'approve', 'provider_complete']);
  assert.deepEqual(previous.receipt.observed_execution_ids, Array(4).fill(executionId));
});

test('same event ID is rejected before advancing a later phase and saved state is unchanged', () => {
  const { runtime, previous } = advanceTo(1);
  const before = clone(previous);
  const replay = { ...previous.next_request.body, event_id: previous.state.accepted_event_ids[0] };
  assert.throws(() => runtime.advance(previous, replay, executionId, 'edit_saved', start + 2), /SYNTHETIC_PROBE_REPLAY/);
  assert.deepEqual(previous, before);
});

test('out-of-order, another execution, real file, revision and manifest changes cannot be accepted', () => {
  const { runtime, previous } = advanceTo(1);
  for (const patch of [
    { phase: 'approve' }, { sequence: 3 }, { event_id: 'unexpected' },
    { execution_id: 'another-execution' }, { file_id: 'a-real-file' },
    { revision: 2 }, { manifest_id: 'changed-manifest' }, { synthetic: false },
  ]) {
    assert.throws(() => runtime.advance(previous, { ...previous.next_request.body, ...patch }, executionId, 'edit_saved', start + 2), /SYNTHETIC_PROBE_REQUEST_MISMATCH/);
  }
  assert.throws(() => runtime.advance(previous, previous.next_request.body, 'another-execution', 'edit_saved', start + 2), /SYNTHETIC_PROBE_EXECUTION_CHANGED/);
  assert.throws(() => runtime.advance(previous, previous.next_request.body, executionId, 'provider_complete', start + 2), /SYNTHETIC_PROBE_WRONG_PHASE/);
});

test('approval must be an explicit true Boolean for the exact saved revision', () => {
  const { runtime, previous } = advanceTo(2);
  for (const approved of [undefined, false, 'true', 1, null]) {
    const body = { ...previous.next_request.body, approved };
    if (approved === undefined) delete body.approved;
    assert.throws(() => runtime.advance(previous, body, executionId, 'approve', start + 3), /SYNTHETIC_PROBE_REQUEST_MISMATCH/);
  }
  assert.equal(runtime.advance(previous, previous.next_request.body, executionId, 'approve', start + 3).state.sequence, 3);
});

test('no request body, an unexpected URL/credential/customer field, arrays and inherited fields fail closed', () => {
  const { runtime, previous } = advanceTo(0);
  for (const body of [undefined, null, [], 'json']) {
    assert.throws(() => runtime.advance(previous, body, executionId, 'upload_complete', start + 1), /SYNTHETIC_PROBE_MISSING_BODY/);
  }
  for (const name of ['url', 'credential', 'customer', 'binary']) {
    assert.throws(() => runtime.advance(previous, { ...previous.next_request.body, [name]: 'untrusted' }, executionId, 'upload_complete', start + 1), /SYNTHETIC_PROBE_REQUEST_MISMATCH/);
  }
  assert.throws(() => runtime.advance(previous, Object.create(previous.next_request.body), executionId, 'upload_complete', start + 1), /SYNTHETIC_PROBE_REQUEST_MISMATCH/);
});

test('native timeout input and late answers cannot turn into approval or a success receipt', () => {
  const { runtime, previous } = advanceTo(2);
  const snapshot = clone(previous);
  for (const now of [previous.state.deadline_at, previous.state.deadline_at + 1]) {
    assert.throws(() => runtime.advance(previous, previous.next_request.body, executionId, 'approve', now), /SYNTHETIC_PROBE_EXPIRED/);
    assert.throws(() => runtime.advance(previous, undefined, executionId, 'approve', now), /SYNTHETIC_PROBE_EXPIRED/);
  }
  assert.throws(() => runtime.advance(previous, undefined, executionId, 'approve', start + 10), /SYNTHETIC_PROBE_MISSING_BODY/);
  assert.deepEqual(previous, snapshot);
  assert.equal(runtime.advance(previous, previous.next_request.body, executionId, 'approve', previous.state.deadline_at - 1).state.sequence, 3);
});

test('generated node bodies independently check execution identity and deadline after rehydration', () => {
  const workflow = buildWorkflow();
  const { previous } = advanceTo(2);
  const saved = new Map([['Probe - accept 2', clone(previous)]]);
  const node = workflow.nodes.find((candidate) => candidate.name === 'Probe - accept 3');
  assert.throws(() => runCode(node, { id: 'changed-execution', body: previous.next_request.body, saved, now: start + 3 }), /SYNTHETIC_PROBE_EXECUTION_CHANGED/);
  assert.throws(() => runCode(node, { body: previous.next_request.body, saved, now: previous.state.deadline_at }), /SYNTHETIC_PROBE_EXPIRED/);
  assert.throws(() => runCode(node, { saved, now: start + 3 }), /SYNTHETIC_PROBE_MISSING_BODY/);
});

test('a terminal receipt cannot be advanced, and successful transitions do not mutate their input', () => {
  const { runtime, previous } = advanceTo(3);
  const before = clone(previous);
  const complete = runtime.advance(previous, previous.next_request.body, executionId, 'provider_complete', start + 4);
  assert.deepEqual(previous, before);
  assert.throws(() => runtime.advance(complete, previous.next_request.body, executionId, 'provider_complete', start + 5), /SYNTHETIC_PROBE_TERMINAL/);
  assert.equal(complete.state.sequence, 4);
});

test('receipts contain only synthetic outcome evidence and no resume URLs or payloads', () => {
  const { previous } = advanceTo(4);
  assert.deepEqual(Object.keys(previous.receipt).sort(), [
    'probe', 'synthetic', 'execution_id', 'accepted_count', 'accepted_phases',
    'observed_execution_ids', 'same_execution', 'complete', 'external_effects',
  ].sort());
  assert.doesNotMatch(JSON.stringify(previous), /https?:\/\/|resumeUrl|signature|access_token|authorization/);
});
