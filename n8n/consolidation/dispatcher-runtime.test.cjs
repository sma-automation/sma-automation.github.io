'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  consolidationWrap, consolidationValidate, consolidationUnwrap,
  consolidationBeginExternal, consolidationBeginInternal, consolidationRestore,
  consolidationReadDeadline, consolidationAssertDeadline,
  consolidationPassThrough, consolidationCodeOutput,
} = require('./dispatcher-runtime.cjs');

test('native effective child payload, binary and item indices survive the strict envelope', () => {
  const input = [
    {json: {body: {asset: 'fixture-a'}, headers: {fixture: 'only'}}, binary: {data: {id: 'fixture-bin-a'}}, pairedItem: {item: 9}},
    {json: {body: {asset: 'fixture-b'}}, binary: {data: {id: 'fixture-bin-b'}}, pairedItem: [{item: 4}, {item: 7}]},
  ];
  const snapshot = structuredClone(input);
  const wrapped = consolidationWrap(input, 'fixture.single');
  // n8n 2.47.7 getWorkflowInputValues normalizes index/pairedItem on entry.
  const nativeEffective = input.map(({json, binary}, index) => ({json, binary, index, pairedItem: {item: index}}));
  const effectiveEnvelope = wrapped.map(({json, binary}, index) => ({json, binary, index, pairedItem: {item: index}}));
  assert.deepEqual(consolidationValidate(effectiveEnvelope, ['fixture.single']), effectiveEnvelope);
  const restored = consolidationUnwrap(effectiveEnvelope, 'fixture.single');
  assert.deepEqual(restored, nativeEffective);
  assert.deepEqual(input, snapshot);
  assert.equal(restored[0].binary, input[0].binary);
  assert.equal(restored[0].json, input[0].json);
});

test('engine metadata is not emitted as an invalid Code output key', () => {
  const item = {json: {ok: true}, binary: {file: {id: 'fixture'}}, pairedItem: {item: 4}, index: 4,
    metadata: {subExecution: {executionId: 'fixture-child'}}};
  const wrapped = consolidationWrap([item], 'one');
  assert.equal(wrapped[0].metadata, undefined);
  assert.equal(consolidationUnwrap(wrapped, 'one')[0].metadata, undefined);
  assert.equal(consolidationPassThrough([item])[0].metadata, undefined);
  assert.deepEqual(consolidationCodeOutput([item]), [{json: item.json, binary: item.binary, pairedItem: item.pairedItem, index: 4}]);
  const invalidBusinessItem = {json: {}, unrelated: 'keep native validation failure'};
  assert.equal(consolidationCodeOutput(invalidBusinessItem), invalidBusinessItem);
  for (const output of wrapped) {
    assert.ok(Object.keys(output).every(key => ['json', 'binary', 'pairedItem', 'error', 'index'].includes(key)));
  }
});

test('unknown operations and extra envelope fields are rejected before any business graph', () => {
  for (const json of [
    {operation: 'unknown', payload: {}},
    {operation: 'allowed', payload: {}, destination: 'not-allowed'},
    {operation: 'allowed', payload: []},
    {operation: 'allowed', payload: null},
    {body: {operation: 'allowed', payload: {}}},
    {operation: 'allowed', payload: {}, context: {deadlineAt: null, extra: true}},
    {operation: 'allowed', payload: {}, context: {deadlineAt: Infinity}},
    {operation: 'allowed', payload: {}, context: {deadlineAt: 'tomorrow'}},
  ]) {
    assert.throws(() => consolidationValidate([{json}], ['allowed']), /CONSOLIDATION_ENVELOPE_INVALID/);
  }
});

test('mixed operations cannot filter or reorder the native child item indices', () => {
  const items = [{json: {operation: 'one', payload: {}, context: {deadlineAt: null}}},
    {json: {operation: 'two', payload: {}, context: {deadlineAt: null}}}];
  assert.throws(() => consolidationValidate(items, ['one', 'two']), /CONSOLIDATION_MIXED_OPERATIONS/);
  assert.throws(() => consolidationUnwrap([items[1]], 'one'), /CONSOLIDATION_ENVELOPE_INVALID/);
});

test('private entry marker preserves original business JSON and the shorter parent deadline', () => {
  const now = Date.now();
  const input = [{json: {body: {asset: 'fixture'}}, binary: {image: {id: 'fake'}}}];
  const marker = consolidationBeginExternal(input, 60, now);
  assert.equal(marker[0].json.deadlineAt, now + 60000);
  assert.deepEqual(consolidationRestore(marker)[0].json, input[0].json);
  assert.deepEqual(consolidationRestore(marker)[0].binary, input[0].binary);
  const wrapped = consolidationWrap(input, 'child', now + 5000);
  const childMarker = consolidationBeginInternal(wrapped, 'child', 210, now + 1000);
  assert.equal(childMarker[0].json.deadlineAt, now + 5000);
  assert.deepEqual(consolidationRestore(childMarker)[0].json, input[0].json);
  assert.equal(consolidationReadDeadline([childMarker[0].json]), now + 5000);
});

test('expired operation refuses further work and a child never refreshes an inherited budget', () => {
  const now = Date.now();
  const envelope = [{json: {operation: 'child', payload: {}, context: {deadlineAt: now + 100}}}];
  assert.throws(() => consolidationBeginInternal(envelope, 'child', 600, now + 101), /CONSOLIDATION_OPERATION_TIMEOUT/);
  assert.throws(() => consolidationAssertDeadline(now, now), /CONSOLIDATION_OPERATION_TIMEOUT/);
  assert.throws(() => consolidationWrap([{json:{}}], 'child', now - 1), /CONSOLIDATION_OPERATION_TIMEOUT/);
  assert.throws(() => consolidationReadDeadline([]), /CONSOLIDATION_MARKER_MISSING_OR_INVALID/);
  assert.equal(consolidationReadDeadline([{deadlineAt: null}, {deadlineAt: now + 200}]), now + 200);
});

test('mixed inherited budgets are rejected before routing a batch', () => {
  const items = [
    {json: {operation: 'one', payload: {}, context: {deadlineAt: 1000}}},
    {json: {operation: 'one', payload: {}, context: {deadlineAt: 2000}}},
  ];
  assert.throws(() => consolidationValidate(items, ['one']), /CONSOLIDATION_MIXED_DEADLINES/);
});

test('effective passthrough JSON may contain envelope-shaped business fields', () => {
  const item = {json: {operation: 'customer-field', payload: {nested: true}}};
  assert.deepEqual(consolidationUnwrap(consolidationWrap([item], 'internal'), 'internal')[0].json, item.json);
});
