'use strict';

function consolidationRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function consolidationCopyItem(item, json = item.json, pairedItem = item.pairedItem) {
  const output = {json};
  if (item.binary !== undefined) output.binary = item.binary;
  if (pairedItem !== undefined) output.pairedItem = pairedItem;
  if (item.index !== undefined) output.index = item.index;
  if (item.error !== undefined) output.error = item.error;
  // n8n 2.47.7 Code output permits only these five keys. In particular,
  // metadata.subExecution belongs to the engine, not a new Code item.
  return output;
}

function consolidationPassThrough(items) {
  return items.map((item, index) => consolidationCopyItem(item, item.json, {item: index}));
}

function consolidationCodeOutput(result) {
  // Keep native Code normalization/error behavior for business return values.
  // Remove only engine metadata from already shaped n8n items; do not silently
  // accept unrelated invalid business output keys.
  const clean = item => {
    if (!consolidationRecord(item) || !Object.prototype.hasOwnProperty.call(item, 'json') ||
        !Object.prototype.hasOwnProperty.call(item, 'metadata')) return item;
    const {metadata, ...output} = item;
    return output;
  };
  return Array.isArray(result) ? result.map(clean) : clean(result);
}

function consolidationDeadlineValid(value) {
  return value === null || (Number.isSafeInteger(value) && value > 0);
}

function consolidationAssertDeadline(deadlineAt, now = Date.now()) {
  if (!consolidationDeadlineValid(deadlineAt)) throw Error('CONSOLIDATION_DEADLINE_INVALID');
  if (deadlineAt !== null && now >= deadlineAt) throw Error('CONSOLIDATION_OPERATION_TIMEOUT');
  return deadlineAt;
}

function consolidationMinimumDeadline(values) {
  if (!Array.isArray(values) || values.some(value => !consolidationDeadlineValid(value))) {
    throw Error('CONSOLIDATION_DEADLINE_INVALID');
  }
  const bounded = values.filter(value => value !== null);
  return bounded.length ? Math.min(...bounded) : null;
}

function consolidationWrap(items, operation, parentDeadlineAt = null) {
  if (!Array.isArray(items) || typeof operation !== 'string' || !operation) {
    throw Error('CONSOLIDATION_INPUT_INVALID');
  }
  consolidationAssertDeadline(parentDeadlineAt);
  return items.map((item, index) => {
    if (!consolidationRecord(item?.json)) throw Error('CONSOLIDATION_PAYLOAD_INVALID');
    // A new one-to-one node links each output to its own input. Execute Workflow
    // also normalizes the effective child input to this index, retaining binary.
    return consolidationCopyItem(item, {operation, payload: item.json, context: {deadlineAt: parentDeadlineAt}}, {item: index});
  });
}

function consolidationValidate(items, allowedOperations) {
  if (!Array.isArray(items) || !Array.isArray(allowedOperations)) {
    throw Error('CONSOLIDATION_INPUT_INVALID');
  }
  let operation;
  let deadlineAt;
  for (const item of items) {
    const envelope = item?.json;
    if (!consolidationRecord(envelope) ||
        Object.keys(envelope).sort().join(',') !== 'context,operation,payload' ||
        typeof envelope.operation !== 'string' ||
        !allowedOperations.includes(envelope.operation) ||
        !consolidationRecord(envelope.payload) ||
        !consolidationRecord(envelope.context) ||
        Object.keys(envelope.context).join(',') !== 'deadlineAt' ||
        !consolidationDeadlineValid(envelope.context.deadlineAt)) {
      throw Error('CONSOLIDATION_ENVELOPE_INVALID');
    }
    if (operation !== undefined && operation !== envelope.operation) {
      throw Error('CONSOLIDATION_MIXED_OPERATIONS');
    }
    if (deadlineAt !== undefined && deadlineAt !== envelope.context.deadlineAt) {
      throw Error('CONSOLIDATION_MIXED_DEADLINES');
    }
    operation = envelope.operation;
    deadlineAt = envelope.context.deadlineAt;
  }
  return items.map(item => consolidationCopyItem(item));
}

function consolidationUnwrap(items, operation) {
  consolidationValidate(items, [operation]);
  if (items.length) consolidationAssertDeadline(items[0].json.context.deadlineAt);
  // The single-operation router does not filter/reorder items. Restore exactly
  // the effective former child JSON; binary/index/pairedItem stay as received.
  return items.map(item => consolidationCopyItem(item, item.json.payload));
}

function consolidationBegin(items, ownTimeoutSeconds, parentDeadlineAt, now) {
  if (!Array.isArray(items) || (ownTimeoutSeconds !== null &&
      (!Number.isSafeInteger(ownTimeoutSeconds) || ownTimeoutSeconds <= 0))) {
    throw Error('CONSOLIDATION_BUDGET_INVALID');
  }
  const ownDeadlineAt = ownTimeoutSeconds === null ? null : now + ownTimeoutSeconds * 1000;
  const deadlineAt = consolidationMinimumDeadline([ownDeadlineAt, parentDeadlineAt]);
  consolidationAssertDeadline(deadlineAt, now);
  return items.map((item, index) => {
    if (!consolidationRecord(item?.json)) throw Error('CONSOLIDATION_PAYLOAD_INVALID');
    return consolidationCopyItem(item, {payload: item.json, deadlineAt}, {item: index});
  });
}

function consolidationBeginExternal(items, ownTimeoutSeconds, now = Date.now()) {
  return consolidationBegin(items, ownTimeoutSeconds, null, now);
}

function consolidationBeginInternal(items, operation, ownTimeoutSeconds, now = Date.now()) {
  consolidationValidate(items, [operation]);
  const parentDeadlineAt = items.length ? items[0].json.context.deadlineAt : null;
  const originalItems = items.map(item => consolidationCopyItem(item, item.json.payload));
  return consolidationBegin(originalItems, ownTimeoutSeconds, parentDeadlineAt, now);
}

function consolidationReadDeadline(markers) {
  if (!Array.isArray(markers) || !markers.length || markers.some(marker =>
      !consolidationRecord(marker) || !consolidationDeadlineValid(marker.deadlineAt))) {
    throw Error('CONSOLIDATION_MARKER_MISSING_OR_INVALID');
  }
  return consolidationMinimumDeadline(markers.map(marker => marker.deadlineAt));
}

function consolidationRestore(items) {
  if (!Array.isArray(items)) throw Error('CONSOLIDATION_INPUT_INVALID');
  return items.map((item, index) => {
    const marker = item?.json;
    if (!consolidationRecord(marker) || Object.keys(marker).sort().join(',') !== 'deadlineAt,payload' ||
        !consolidationRecord(marker.payload)) throw Error('CONSOLIDATION_MARKER_INVALID');
    consolidationAssertDeadline(marker.deadlineAt);
    return consolidationCopyItem(item, marker.payload, {item: index});
  });
}

// @exports
module.exports = {
  consolidationWrap, consolidationValidate, consolidationUnwrap,
  consolidationBeginExternal, consolidationBeginInternal, consolidationRestore,
  consolidationReadDeadline, consolidationAssertDeadline, consolidationMinimumDeadline,
  consolidationCopyItem, consolidationPassThrough, consolidationCodeOutput,
};
