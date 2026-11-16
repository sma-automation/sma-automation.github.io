'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {SOURCES, transformFileCommandSource} = require('./build-file-command.cjs');
const {createFileCommandRuntime} = require('./command-runtime.cjs');
const runtime = createFileCommandRuntime();
const clone = value => JSON.parse(JSON.stringify(value));
const equal = (a, b) => assert.deepEqual(clone(a), clone(b));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = 1800000000000;
const id = index => 'a0000000-0000-4000-8000-' + String(index).padStart(12, '0');
const revision = 'md5:' + 'a'.repeat(32) + ':1';
const ticket = {job_id: id(90), command_id: id(91), command_ticket: 'c'.repeat(64), parent_execution_id: 'parent-qa'};
const binary = {fixture: {data: Buffer.from('synthetic command transport').toString('base64'), mimeType: 'text/plain'}};
const inputs = {
  upload_start: {upload_id: id(1), name: 'synthetic.mp4', mime_type: 'video/mp4', size_bytes: '100'},
  upload_finish: {upload_id: id(1)},
  magic_photo: {asset_id: id(1), asset_revision: revision},
  magic_video: {asset_id: id(1), asset_revision: revision},
  review: {asset_id: id(1), asset_revision: revision},
  preview_prepare: {request_id: id(2), source_text: 'Ein vollständig synthetischer Text ohne echte Kundeninformationen.', audience: 'Erwachsene', goal: 'Information', language: 'de', media_kind: 'video', platforms: ['youtube']},
  account: {id: id(3), platform: 'youtube'},
  order_prepare: {id: id(3), assignment_id: id(4)},
  order_approve: {id: id(3), approval_token: id(5), review: {}},
};
function requestFor(operation, input = inputs[operation]) {
  const action = {upload_start: 'start', upload_finish: 'finish', account: 'account', order_prepare: 'prepare', order_approve: 'approve'}[operation] ?? null;
  const body = operation.startsWith('upload_') ? {...input, action} :
    ['account', 'order_prepare', 'order_approve'].includes(operation) ? {action, input} : input;
  return {operation, input, action, request: {body, headers: {}}};
}
function source(idValue) {
  const filename = process.env.SMA_COMMAND_SOURCE_DIR ? path.join(process.env.SMA_COMMAND_SOURCE_DIR, idValue + '.json') : path.join(__dirname, '../publishing', SOURCES[idValue].fixture);
  const parsed = JSON.parse(fs.readFileSync(filename, 'utf8')), result = Array.isArray(parsed) ? parsed[0] : parsed;
  return {...result, id: idValue};
}
function order() {
  return {ok: true, id: id(3), state: 'checked', can_upload: false, can_publish: false, blockers: [], check_error: null,
    media_check: {checks: [{code: 'PORTAL_TEXT_COMPARISON', status: 'pass'}]}};
}
function provider(state = 'not_started', extra = {}) {
  return {state, updated_at: null, lease_until: null, last_operation: null, has_provider_id: false, has_session: false,
    cover_state: null, has_cover_plan: false, permission_valid: true, ...extra};
}

// Narrow offline graph interpreter: actual Code/IF/response expressions run;
// HTTP/DataTable/native children are explicit local doubles. No service access.
function engine(workflow, {operation = SOURCES[workflow.id].commands[0], reservation = {ok: false, code: 'ACCESS_INACTIVE'}, freshLease = false,
  claimChange = reply => reply, rpcHandler, serviceHandler, childHandler, itemCount = 1, deadline = now + workflow.settings.executionTimeout * 1000} = {}) {
  let clock = now, stepCount = 0, result = null, completed = null;
  const saved = new Map(), calls = [], responses = [], visits = [];
  const byName = new Map(workflow.nodes.map(node => [node.name, node]));
  async function run(input, internal = false) {
    let data = Array.from({length: itemCount}, (_, index) => ({json: clone(input), binary: clone(binary), pairedItem: {item: index}, metadata: {subExecution: {engineOnly: true}}}));
    let name = workflow.nodes.find(node => node.type === 'n8n-nodes-base.' + (internal ? 'executeWorkflowTrigger' : 'webhook')).name;
    const lookup = (name, runIndex = -1) => {
      const list = saved.get(name); if (!list) throw Error('Node has not executed: ' + name);
      return list[runIndex < 0 ? list.length - 1 : runIndex];
    };
    const env = () => ({Buffer, Date: class extends Date {static now() {return clock;}}, require: module => {assert.equal(module, 'crypto'); return crypto;},
      $input: {first: () => data[0], all: () => data}, $json: data[0]?.json, $execution: {id: 'child-qa'},
      $: node => ({isExecuted: saved.has(node), first: (_branch = 0, runIndex = -1) => lookup(node, runIndex)[0], all: (_branch = 0, runIndex = -1) => lookup(node, runIndex)}),
      setTimeout: (callback, milliseconds) => {clock += milliseconds; queueMicrotask(callback); return 0;},
      context: {helpers: {getBinaryDataBuffer: async (index, key) => Buffer.from(data[index].binary[key].data, 'base64')}}});
    const evaluate = value => typeof value === 'string' && value.startsWith('={{') ? vm.runInNewContext('(' + value.slice(3, -2) + ')', env(), {timeout: 2000}) : value;
    while (name) {
      assert.ok(++stepCount < 5000, 'bounded command graph'); const node = byName.get(name); assert.ok(node, name);
      visits.push(name); let port = 0;
      try {
        if (node.type.endsWith('.code')) {
          assert.doesNotMatch(node.parameters.jsCode, /\bfetch\s*\(/);
          data = await vm.runInNewContext('(async function(){\n' + node.parameters.jsCode + '\n}).call(context)', env(), {timeout: 2000});
          assert.ok(Array.isArray(data));
          for (const item of data) assert.ok(Object.keys(item).every(key => ['json', 'binary', 'pairedItem', 'error', 'index'].includes(key)), 'engine metadata cannot leak through Code output');
        } else if (node.type.endsWith('.if')) {
          const conditions = node.parameters.conditions.conditions;
          port = conditions.every(condition => {
            const left = evaluate(condition.leftValue), right = evaluate(condition.rightValue), operator = condition.operator;
            if (operator.type === 'boolean' && operator.operation === 'true') return left === true;
            if (operator.operation === 'equals') return left === right;
            if (operator.operation === 'notEquals') return left !== right;
            assert.fail('Unexpected IF operator ' + JSON.stringify(operator));
          }) ? 0 : 1;
        } else if (node.type.endsWith('.httpRequest')) {
          const body = evaluate(node.parameters.jsonBody), rpc = node.parameters.url?.split('/rest/v1/rpc/')[1];
          calls.push({name, rpc, body: clone(body ?? {}), now: clock});
          let reply;
          if (rpc === 'sma_file_job_worker_v1') {
            const action = body.p_action, binding = body.p_input;
            equal({job_id: binding.job_id, command_id: binding.command_id, command_ticket: binding.command_ticket, child_execution_id: binding.child_execution_id}, {...ticket, child_execution_id: 'child-qa', parent_execution_id: undefined});
            if (action === 'claim') {assert.equal(binding.parent_execution_id, ticket.parent_execution_id); reply = claimChange({ok: true, ...requestFor(operation), deadline_at: new Date(deadline).toISOString()});}
            else if (action === 'reserve') {assert.deepEqual(Object.keys(binding).sort(), ['child_execution_id', 'command_id', 'command_ticket', 'job_id']); reply = reservation;}
            else if (action === 'result') {
              const next = {status: binding.status, body: binding.body}; if (result) equal(next, result); result = clone(next); reply = {ok: true};
            } else if (action === 'completed') {completed = binding.outcome; reply = {ok: true};}
            else {assert.ok(rpcHandler, 'unexpected worker action: ' + action); reply = await rpcHandler({action, body: binding, clock, calls});}
          } else if (SOURCES[workflow.id].auth.includes(name)) reply = reservation;
          else {assert.ok(serviceHandler, 'unexpected external request: ' + name); reply = await serviceHandler({name, rpc, body, clock});}
          data = [{json: clone(reply)}];
        } else if (node.type.endsWith('.dataTable')) {
          calls.push({name, type: 'dataTable', now: clock});
          if (freshLease) data = [{json: {}}];
          else {assert.ok(serviceHandler, 'unexpected table read: ' + name); data = [{json: clone(await serviceHandler({name, clock}))}];}
        } else if (node.type.endsWith('.executeWorkflow')) {
          assert.ok(childHandler, 'unexpected native child: ' + name); calls.push({name, type: 'native', body: clone(data[0].json), now: clock});
          const reply = await childHandler({name, input: clone(data[0].json), clock});
          data = [{json: clone(reply), pairedItem: {item: 0}, metadata: {subExecution: {executionId: 'synthetic-provider-child'}}}];
        } else if (node.type.endsWith('.respondToWebhook')) {
          assert.equal(internal, false, 'native command must not respond to a public webhook');
          responses.push(clone({status: evaluate(node.parameters.options.responseCode), body: evaluate(node.parameters.responseBody)}));
        } else assert.ok(node.type.endsWith('.webhook') || node.type.endsWith('.executeWorkflowTrigger'));
      } catch (error) {
        if (node.onError === 'continueRegularOutput') data = [{json: {error: error.message}}];
        else if (node.onError === 'continueErrorOutput') {data = [{json: {error: error.message}}]; port = node.type.endsWith('.if') ? 2 : 1;}
        else throw error;
      }
      const runs = saved.get(name) || []; runs.push(clone(data)); saved.set(name, runs);
      const links = workflow.connections[name]?.main?.[port] || []; assert.ok(links.length <= 1, 'workers have a single active path'); name = links[0]?.node;
    }
    return clone(data);
  }
  return {run, calls, responses, visits, saved, get result() {return result;}, get completed() {return completed;}, get clock() {return clock;}};
}

for (const sourceId of Object.keys(SOURCES)) test('public path and service credentials remain unchanged: ' + sourceId, async () => {
  const original = source(sourceId), before = hash(original), {workflow, metadata} = transformFileCommandSource(original);
  assert.equal(hash(original), before); assert.equal(workflow.id, original.id); assert.equal(workflow.versionId, original.versionId); equal(workflow.settings, original.settings);
  assert.equal(workflow.nodes.filter(node => node.type.endsWith('.executeWorkflowTrigger')).length, 1); assert.equal(metadata.operation, SOURCES[sourceId].operation);
  for (const node of original.nodes) {
    const current = workflow.nodes.find(item => item.id === node.id); assert.ok(current); assert.equal(hash(current.credentials || {}), hash(node.credentials || {}));
    if (node.type.endsWith('.webhook') || node.type.endsWith('.respondToWebhook')) equal(current, node);
  }
  const operation = SOURCES[sourceId].commands[0], request = requestFor(operation).request;
  for (const input of [{...request, headers: {authorization: 'Bearer synthetic-token-without-permissions'}}, request, {...request, body: {...request.body, _file_command_internal: true}}]) {
    const old = engine(original, {operation}), updated = engine(workflow, {operation});
    await old.run(input); await updated.run(input); equal(updated.responses, old.responses);
    equal(updated.calls, old.calls); assert.ok(updated.calls.every(call => call.rpc !== 'sma_file_job_worker_v1'));
  }
});

test('native claim cannot accept caller-auth, a foreign operation, changed body or an expired claim', async () => {
  const {workflow} = transformFileCommandSource(source('dheEkIi8KUNqHpmq'));
  const forged = engine(workflow); await assert.rejects(forged.run({...ticket, authorization: 'Bearer not-stored'}, true), /INVALID_TICKET/); assert.equal(forged.calls.length, 0);
  const multiple = engine(workflow, {itemCount: 2}); await assert.rejects(multiple.run(ticket, true), /SINGLE_REQUIRED/); assert.equal(multiple.calls.length, 0);
  for (const claimChange of [reply => ({...reply, operation: 'order_approve'}), reply => ({...reply, request: {...reply.request, headers: {authorization: 'Bearer invalid'}}}), reply => ({...reply, request: {...reply.request, body: {...reply.input, asset_id: id(999)}}}), reply => ({...reply, deadline_at: new Date(now - 1).toISOString()})]) {
    const mock = engine(workflow, {claimChange}); await assert.rejects(mock.run(ticket, true), /FILE_COMMAND_/);
    assert.equal(mock.calls.length, 1); assert.equal(mock.calls[0].body.p_action, 'claim'); assert.equal(mock.completed, null);
  }
});

test('all nine fixed operations pass their original body parser and reach only the bound reservation RPC', async () => {
  for (const [sourceId, config] of Object.entries(SOURCES)) for (const operation of config.commands) {
    const {workflow} = transformFileCommandSource(source(sourceId)), mock = engine(workflow, {operation});
    await mock.run(ticket, true);
    assert.equal(mock.calls.filter(call => call.body?.p_action === 'claim').length, 1, operation);
    assert.equal(mock.calls.filter(call => call.body?.p_action === 'reserve').length, 1, operation);
    assert.equal(mock.calls.filter(call => call.body?.p_action === 'result').length, 1, operation);
    assert.equal(mock.completed, 'failed'); assert.equal(mock.result.body.ok, false); assert.equal(mock.responses.length, 0);
  }
});

test('successful public order still performs its original two child calls and never enters the private continuation loop', async () => {
  const original = source('RdtCqCWRi7P4W7B0'), updated = transformFileCommandSource(original).workflow;
  const options = {operation: 'order_approve', reservation: order(), childHandler: ({name}) => ({ok: true, state: name === 'Inhaltsabgleich im Hintergrund' ? 'completed' : 'session_ready', can_upload: false, can_publish: false})};
  const input = {...requestFor('order_approve').request, headers: {authorization: 'Bearer synthetic-token-without-permissions'}};
  const old = engine(original, options), changed = engine(updated, options); await old.run(input); await changed.run(input);
  equal(changed.responses, old.responses); equal(changed.calls, old.calls); assert.equal(changed.calls.filter(call => call.type === 'native').length, 2);
  assert.ok(changed.calls.every(call => call.rpc !== 'sma_file_job_worker_v1'));
});

test('native cached success records the original response, preserves binary and uses no browser JWT', async () => {
  const {workflow, metadata} = transformFileCommandSource(source('dheEkIi8KUNqHpmq'));
  const reservation = {ok: true, analysis: {status: 'completed', id: id(8)}};
  const mock = engine(workflow, {reservation}); const rows = await mock.run(ticket, true);
  equal(mock.result, {status: 200, body: {ok: true, analysis: reservation.analysis}}); assert.equal(mock.completed, 'completed');
  assert.equal(mock.responses.length, 0); assert.equal(rows[0].json.outcome, 'completed');
  equal(mock.saved.get(metadata.publicEntry)[0][0].binary, binary); assert.deepEqual(mock.calls.map(call => call.body.p_action), ['claim', 'reserve', 'result', 'completed']);
  const nativeTransport = JSON.stringify(mock.calls); assert.doesNotMatch(nativeTransport, /authorization|Bearer|user_id|service_role|p_rpc|p_function/);
  assert.doesNotMatch(JSON.stringify(rows), /command_ticket|parent_execution_id|child_execution_id/);
});

for (const sourceId of ['dheEkIi8KUNqHpmq', 'a1F5Ps0B3sXMh70S', 'mWoUMjzxAsfggRHU']) test('early 200 is saved before actual work; a later failure remains failed: ' + sourceId, async () => {
  const {workflow} = transformFileCommandSource(source(sourceId)), review = sourceId === 'mWoUMjzxAsfggRHU';
  const reservation = {ok: true, [review ? 'review' : 'analysis']: {status: 'processing'}, lease_id: id(7), id: id(8),
    asset_id: id(1), asset_revision: revision, n8n_kunde_id: 'synthetic-customer', kunde_email: 'synthetic@example.invalid'};
  const mock = engine(workflow, {reservation, freshLease: true, serviceHandler: ({rpc}) => {assert.match(rpc, /_finish_v1$/); return {ok: true};}});
  const result = await mock.run(ticket, true); assert.equal(mock.result.status, 200); assert.equal(mock.result.body.ok, true);
  assert.equal(mock.completed, 'failed'); assert.equal(result[0].json.ok, false); assert.equal(mock.responses.length, 0);
  const responseIndex = mock.calls.findIndex(call => call.body?.p_action === 'result'), workIndex = mock.calls.findIndex(call => call.type === 'dataTable');
  const finishIndex = mock.calls.findIndex(call => /_finish_v1$/.test(call.rpc || '')), completeIndex = mock.calls.findIndex(call => call.body?.p_action === 'completed');
  assert.ok(responseIndex >= 0 && responseIndex < workIndex && workIndex < finishIndex && finishIndex < completeIndex);
});

test('one native order command advances three provider phases, observes the existing 10-second poll gate and records only one public result', async () => {
  const {workflow} = transformFileCommandSource(source('RdtCqCWRi7P4W7B0'));
  let state = provider(), providerCalls = 0; const times = [];
  const mock = engine(workflow, {operation: 'order_approve', reservation: order(),
    rpcHandler: ({action}) => {assert.equal(action, 'order_continue'); return {ok: true, order: order(), provider: state};},
    childHandler: ({name, input, clock}) => {
      assert.equal(input.id, id(3));
      if (name === 'Inhaltsabgleich im Hintergrund') return {ok: true, state: 'completed', can_upload: false, can_publish: false};
      assert.equal(name, 'Providerweg im Hintergrund'); providerCalls++; times.push(clock);
      const phase = ['session_ready', 'processing', 'complete'][providerCalls - 1]; assert.ok(phase);
      state = provider(phase, {has_session: true, has_provider_id: providerCalls > 1, last_operation: ['init', 'upload', 'status'][providerCalls - 1], updated_at: new Date(clock).toISOString()});
      return {ok: true, state: phase, can_upload: false, can_publish: false};
    }});
  const result = await mock.run(ticket, true); assert.equal(providerCalls, 3); assert.ok(times[2] - times[1] >= 10000);
  assert.equal(mock.calls.filter(call => call.body?.p_action === 'result').length, 1); assert.equal(mock.calls.filter(call => call.body?.p_action === 'reserve').length, 1);
  assert.equal(mock.completed, 'completed'); assert.equal(result[0].json.detail, 'PROVIDER_COMPLETE'); assert.equal(mock.responses.length, 0);
  assert.ok(mock.clock < now + 600000); assert.ok(mock.calls.filter(call => call.rpc === 'sma_file_job_worker_v1').every(call => call.body.p_input.child_execution_id === 'child-qa'));
});

test('native order wait ends under its original deadline and never labels pending provider work completed', async () => {
  const {workflow} = transformFileCommandSource(source('RdtCqCWRi7P4W7B0'));
  let calls = 0, state = provider('processing', {has_provider_id: true, last_operation: 'status', updated_at: new Date(now).toISOString()});
  const mock = engine(workflow, {operation: 'order_approve', reservation: order(), deadline: now + 10000,
    rpcHandler: () => ({ok: true, order: order(), provider: state}), childHandler: ({name}) => {
      if (name === 'Inhaltsabgleich im Hintergrund') return {ok: true, state: 'completed'};
      calls++; return {ok: false, state: 'blocked', can_upload: false, can_publish: false};
    }});
  const result = await mock.run(ticket, true); assert.equal(calls, 1); assert.equal(mock.completed, 'failed');
  assert.equal(result[0].json.detail, 'PROVIDER_WAIT_EXPIRED'); assert.ok(mock.clock < now + 10000);
});

test('native comparison failure stops before a provider attempt despite the earlier successful public response', async () => {
  const {workflow} = transformFileCommandSource(source('RdtCqCWRi7P4W7B0'));
  const mock = engine(workflow, {operation: 'order_approve', reservation: order(), childHandler: ({name}) => {
    assert.equal(name, 'Inhaltsabgleich im Hintergrund'); return {ok: true, state: 'needs_review', can_upload: false, can_publish: false};
  }});
  await mock.run(ticket, true); assert.equal(mock.result.body.ok, true); assert.equal(mock.completed, 'failed');
  assert.equal(mock.calls.filter(call => call.type === 'native').length, 1);
});

test('fixed continuation will not create permissions, retry an uncertain init, or use a foreign order', () => {
  const context = runtime.claimed({ok: true, ...requestFor('order_approve'), deadline_at: new Date(now + 600000).toISOString()}, runtime.ticket(ticket, 'child-qa', 600, now), ['order_approve'], now);
  const decide = value => runtime.orderDecision(value, context, null, null, null, now);
  assert.equal(decide({ok: true, order: order(), provider: provider('not_started', {permission_valid: false})}).code, 'UPLOAD_TEST_APPROVAL_REQUIRED');
  assert.equal(decide({ok: true, order: order(), provider: provider('reserved', {last_operation: 'init'})}).code, 'PROVIDER_INIT_UNCERTAIN');
  assert.equal(decide({ok: true, order: {...order(), id: id(999)}, provider: provider()}).action, 'failed');
  assert.equal(decide({ok: true, order: order(), provider: provider('uncertain', {has_session: true})}).action, 'failed');
  assert.throws(() => runtime.params('order_continue', {...context, operation: 'order_prepare'}, {}, now), /INVALID_ACTION/);
});
