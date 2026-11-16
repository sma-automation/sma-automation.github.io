'use strict';

// Synthetic fixture only. Running this module never calls n8n or any service.
// Keep this runtime self-contained: the builder embeds exactly this function in
// Code nodes, and the tests execute those same node bodies without an n8n mock.
function createProbeRuntime() {
  const probe = 'sma-native-wait-resume-v1';
  const phases = ['upload_complete', 'edit_saved', 'approve', 'provider_complete'];
  const ttlMs = 10 * 60 * 1000;

  function fail(code) {
    // Never include an incoming payload or a runtime resume URL in an error.
    throw new Error('SYNTHETIC_PROBE_' + code);
  }

  function nextRequest(state) {
    if (state.sequence === phases.length) return null;
    const sequence = state.sequence + 1;
    const body = {
      probe,
      synthetic: true,
      execution_id: state.execution_id,
      file_id: 'synthetic-file-001',
      revision: 1,
      manifest_id: 'synthetic-four-portals-v1',
      phase: phases[state.sequence],
      sequence,
      event_id: 'synthetic-event-' + sequence,
    };
    if (body.phase === 'approve') body.approved = true;
    if (body.phase === 'provider_complete') body.outcome = 'synthetic_complete';
    return { method: 'POST', suffix: 'probe-' + sequence, body };
  }

  function output(state) {
    return {
      state,
      next_request: nextRequest(state),
      receipt: {
        probe,
        synthetic: true,
        execution_id: state.execution_id,
        accepted_count: state.sequence,
        accepted_phases: state.audit.map((event) => event.phase),
        observed_execution_ids: state.audit.map((event) => event.execution_id),
        same_execution: state.audit.every((event) => event.execution_id === state.execution_id),
        complete: state.sequence === phases.length,
        external_effects: 0,
      },
    };
  }

  function initialize(executionId, now) {
    const id = String(executionId ?? '');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !Number.isFinite(now)) fail('INVALID_CONTEXT');
    return output({
      probe,
      synthetic: true,
      execution_id: id,
      started_at: now,
      deadline_at: now + ttlMs,
      sequence: 0,
      accepted_event_ids: [],
      audit: [],
    });
  }

  function advance(previous, requestBody, executionId, expectedPhase, now) {
    const state = previous?.state;
    if (state?.probe !== probe || state.synthetic !== true) fail('INVALID_STATE');
    if (String(executionId) !== state.execution_id) fail('EXECUTION_CHANGED');
    if (!Number.isFinite(now) || now < state.started_at || now >= state.deadline_at) fail('EXPIRED');
    if (!Number.isInteger(state.sequence) || state.sequence < 0 || state.sequence >= phases.length) fail('TERMINAL');
    if (phases[state.sequence] !== expectedPhase) fail('WRONG_PHASE');
    if (!Array.isArray(state.accepted_event_ids) || !Array.isArray(state.audit)
      || state.accepted_event_ids.length !== state.sequence || state.audit.length !== state.sequence) fail('INVALID_STATE');
    if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody)) fail('MISSING_BODY');
    if (state.accepted_event_ids.includes(requestBody.event_id)) fail('REPLAY');

    // Derive the allowed request from trusted saved state, never from the input
    // received by Wait. Exact keys also reject URLs, credentials and real data.
    const expected = nextRequest(state).body;
    const keys = Object.keys(expected);
    if (Object.keys(requestBody).length !== keys.length
      || keys.some((key) => !Object.hasOwn(requestBody, key) || requestBody[key] !== expected[key])) fail('REQUEST_MISMATCH');

    const event = {
      phase: expectedPhase,
      sequence: expected.sequence,
      event_id: expected.event_id,
      execution_id: String(executionId),
      accepted_at: now,
    };
    return output({
      ...state,
      sequence: expected.sequence,
      accepted_event_ids: [...state.accepted_event_ids, event.event_id],
      audit: [...state.audit, event],
    });
  }

  return { phases, ttlMs, initialize, advance };
}

function buildWorkflow({ explicitTimeout = true } = {}) {
  const { phases } = createProbeRuntime();
  const runtimeSource = 'const probe = (' + createProbeRuntime.toString() + ')();\n';
  const nodes = [];
  const connections = {};
  function add(name, type, typeVersion, parameters, extra = {}) {
    const index = nodes.length + 1;
    const node = {
      id: 'a1100000-0000-4000-8000-' + String(index).padStart(12, '0'),
      name,
      type: 'n8n-nodes-base.' + type,
      typeVersion,
      position: [(index - 1) * 230, 0],
      parameters,
      ...extra,
    };
    nodes.push(node);
    return name;
  }
  function connect(from, to) {
    connections[from] = { main: [[{ node: to, type: 'main', index: 0 }]] };
  }

  const trigger = add('Probe - manual start', 'manualTrigger', 1, {});
  let stateNode = add('Probe - initialize', 'code', 2, {
    jsCode: runtimeSource + 'return [{ json: probe.initialize($execution.id, Date.now()) }];',
  });
  connect(trigger, stateNode);
  let previous = stateNode;
  phases.forEach((phase, index) => {
    const step = index + 1;
    const wait = add('Probe - wait ' + step, 'wait', 1.1, {
      resume: 'webhook',
      incomingAuthentication: 'none',
      httpMethod: 'POST',
      responseMode: 'responseNode',
      limitWaitTime: true,
      limitType: 'atSpecifiedTime',
      maxDateAndTime: '={{ new Date($(' + JSON.stringify(stateNode) + ').first().json.state.deadline_at).toISOString() }}',
      options: { webhookSuffix: 'probe-' + step },
    }, {
      webhookId: 'a1200000-0000-4000-8000-' + String(step).padStart(12, '0'),
      notes: 'Synthetic only. Copy the current native resume URL from this waiting node. POST exactly the next_request.body of the preceding state Code node. Never publish this probe.',
    });
    connect(previous, wait);
    const validate = add('Probe - accept ' + step, 'code', 2, {
      jsCode: runtimeSource
        + 'const previous = $(' + JSON.stringify(stateNode) + ').first().json;\n'
        + 'return [{ json: probe.advance(previous, $input.first().json.body, $execution.id, '
        + JSON.stringify(phase) + ', Date.now()) }];',
    });
    connect(wait, validate);
    const respond = add('Probe - acknowledge ' + step, 'respondToWebhook', 1.5, {
      respondWith: 'json',
      responseBody: '={{ JSON.stringify($json.receipt) }}',
      options: { responseCode: 200 },
    });
    connect(validate, respond);
    stateNode = validate;
    previous = respond;
  });

  const settings = {
    executionOrder: 'v1',
    saveManualExecutions: true,
    saveDataErrorExecution: 'all',
    saveDataSuccessExecution: 'all',
  };
  if (explicitTimeout) settings.executionTimeout = 120;
  return {
    name: 'QA - native Wait Resume - synthetic' + (explicitTimeout ? ' - 120s' : ' - inherited timeout'),
    active: false,
    nodes,
    connections,
    settings,
    pinData: {},
  };
}

module.exports = { createProbeRuntime, buildWorkflow };

if (require.main === module) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write-fixtures') {
    process.stderr.write('Usage: node n8n/consolidation/wait-resume-probe.cjs --write-fixtures\n');
    process.exitCode = 2;
  } else {
    const fs = require('node:fs');
    const path = require('node:path');
    for (const explicitTimeout of [true, false]) {
      const name = explicitTimeout ? 'wait-resume-probe.workflow.json' : 'wait-resume-probe.inherited-timeout.workflow.json';
      fs.writeFileSync(path.join(__dirname, name), JSON.stringify(buildWorkflow({ explicitTimeout }), null, 2) + '\n');
      process.stdout.write(name + '\n');
    }
  }
}
