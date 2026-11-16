'use strict';

// Embedded in new adapter Code nodes. This module does not access a service,
// store credentials, or change the original workers' media/provider checks.
function createFileCommandRuntime() {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  const execution = /^[A-Za-z0-9_-]{1,80}$/;
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const canonical = value => Array.isArray(value) ? value.map(canonical) : record(value) ?
    Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
  const fail = code => { throw Error('FILE_COMMAND_' + code); };
  function copyItem(item, json = item.json) {
    const output = {json};
    for (const key of ['binary', 'pairedItem', 'error', 'index']) if (item[key] !== undefined) output[key] = item[key];
    return output;
  }
  function ticket(input, childExecutionId, timeoutSeconds, now) {
    if (!record(input) || Object.keys(input).sort().join(',') !== 'command_id,command_ticket,job_id,parent_execution_id' ||
        !uuid.test(input.job_id || '') || !uuid.test(input.command_id || '') ||
        !/^[a-f0-9]{64}$/.test(input.command_ticket || '') || !execution.test(input.parent_execution_id || '') ||
        !execution.test(String(childExecutionId || '')) || String(childExecutionId) === input.parent_execution_id ||
        !Number.isSafeInteger(timeoutSeconds) || timeoutSeconds <= 0) fail('INVALID_TICKET');
    return {
      binding: {job_id: input.job_id, command_id: input.command_id, command_ticket: input.command_ticket,
        child_execution_id: String(childExecutionId)},
      parent_execution_id: input.parent_execution_id,
      deadlineAt: now + timeoutSeconds * 1000,
    };
  }
  function remaining(context, now) {
    if (!record(context) || !Number.isSafeInteger(context.deadlineAt) || context.deadlineAt <= now) fail('EXPIRED');
    return context.deadlineAt - now;
  }
  function claimParams(context, now) {
    remaining(context, now);
    return {p_action: 'claim', p_input: {...context.binding, parent_execution_id: context.parent_execution_id}};
  }
  function claimed(reply, context, operations, now) {
    remaining(context, now);
    const action = {upload_start: 'start', upload_finish: 'finish', order_prepare: 'prepare', order_approve: 'approve', account: 'account'}[reply?.operation] ?? null;
    if (reply?.ok !== true || !operations.includes(reply.operation) || !record(reply.input) || reply.action !== action ||
        !record(reply.request) || Object.keys(reply.request).sort().join(',') !== 'body,headers' ||
        !record(reply.request.headers) || Object.keys(reply.request.headers).length ||
        !record(reply.request.body) || typeof reply.deadline_at !== 'string') fail('CLAIM_REJECTED');
    const body = reply.operation.startsWith('upload_') ? {...reply.input, action} :
      ['account', 'order_prepare', 'order_approve'].includes(reply.operation) ? {action, input: reply.input} : reply.input;
    if (!same(body, reply.request.body)) fail('CLAIM_BINDING');
    const deadlineAt = Math.min(context.deadlineAt, Date.parse(reply.deadline_at));
    if (!Number.isSafeInteger(deadlineAt) || deadlineAt <= now) fail('EXPIRED');
    return {...context, operation: reply.operation, input: reply.input, deadlineAt,
      request: {body: reply.request.body, headers: {}, query: {}, params: {}}};
  }
  function params(action, context, extra, now) {
    remaining(context, now);
    if (!['reserve', 'result', 'completed', 'order_continue'].includes(action)) fail('INVALID_ACTION');
    if (action === 'order_continue' && context.operation !== 'order_approve') fail('INVALID_ACTION');
    const allowed = action === 'result' ? ['status', 'body'] : action === 'completed' ? ['outcome', 'error_code'] : [];
    if (!record(extra) || Object.keys(extra).some(key => !allowed.includes(key))) fail('INVALID_ARGUMENTS');
    return {p_action: action, p_input: {...context.binding, ...extra}};
  }
  function publicResponse(body, status) {
    if (!record(body) || !Number.isInteger(status) || status < 200 || status > 599) fail('INVALID_RESPONSE');
    // Match the public JSON serializer: undefined properties are absent. Do not
    // save a raw HTTP result, auth header, lease or worker context as the reply.
    const clean = JSON.parse(JSON.stringify(body));
    if (Buffer.byteLength(JSON.stringify(clean), 'utf8') > 100000) fail('INVALID_RESPONSE');
    return {status, body: clean};
  }
  function acknowledge(reply, phase) {
    if (reply?.ok !== true) fail(phase + '_REJECTED');
  }
  function outcome(response, current, kind) {
    if (kind === 'failure' || response?.body?.ok !== true ||
        (kind === 'verified' && current?.ok !== true)) return 'failed';
    return 'completed';
  }
  function completion(context, response, current, kind, now) {
    const result = outcome(response, current, kind);
    return {outcome: result, request: params('completed', context,
      {outcome: result, ...(result === 'failed' ? {error_code: 'WORKER_FAILED'} : {})}, now)};
  }
  function receipt(context, result, response, extra = {}) {
    return {ok: result === 'completed', job_id: context.binding.job_id, command_id: context.binding.command_id,
      outcome: result, ...(response ? {response} : {}), ...extra};
  }
  function timestamp(value) {
    if (value === null) return null;
    const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
    if (!Number.isSafeInteger(parsed)) fail('INVALID_PROVIDER_CONTEXT');
    return parsed;
  }
  function orderDecision(reply, context, previous, observation, comparison, now) {
    remaining(context, now);
    if (context.operation !== 'order_approve') fail('INVALID_ACTION');
    const count = (previous?.count || 0) + 1;
    const plan = (action, code, more = {}) => ({action, code, count, ...more});
    if (count > 220 || context.deadlineAt - now < 4000) return plan('failed', 'PROVIDER_WAIT_EXPIRED');
    const order = reply?.order, provider = reply?.provider;
    if (reply?.ok !== true || !record(order) || order.ok !== true || order.id !== context.input.id ||
        order.can_upload !== false || order.can_publish !== false || !record(provider)) return plan('failed', 'ORDER_UNAVAILABLE');
    if (Object.keys(provider).sort().join(',') !== 'cover_state,has_cover_plan,has_provider_id,has_session,last_operation,lease_until,permission_valid,state,updated_at' ||
        !['not_started', 'reserved', 'session_ready', 'uploading', 'processing', 'complete', 'failed', 'uncertain', 'needs_review'].includes(provider.state) ||
        ['has_cover_plan', 'has_provider_id', 'has_session', 'permission_valid'].some(key => typeof provider[key] !== 'boolean') ||
        ![null, 'bound', 'sending', 'complete', 'failed', 'uncertain'].includes(provider.cover_state) ||
        ![null, 'init', 'upload', 'probe', 'status'].includes(provider.last_operation)) fail('INVALID_PROVIDER_CONTEXT');
    const updated = timestamp(provider.updated_at), lease = timestamp(provider.lease_until);
    const signature = JSON.stringify(canonical(provider));
    const common = {order, signature, provider_state: provider.state,
      observation_sequence: observation?.sequence || 0,
      checks: previous?.checks || 0};
    const decide = (action, code, more = {}) => plan(action, code, {...common, ...more});
    if (order.check_error || order.state === 'cancelled') return decide('failed', 'ORDER_CHANGED');
    if (provider.state === 'failed' || ['failed', 'uncertain', 'sending'].includes(provider.cover_state)) return decide('failed', 'PROVIDER_FAILED');
    if (provider.state === 'complete') {
      if (!provider.has_cover_plan || provider.cover_state === 'complete') return decide('completed', 'PROVIDER_COMPLETE');
      if (provider.cover_state === 'bound') {
        if (previous?.action === 'step' && previous.signature === signature) return decide('failed', 'COVER_DID_NOT_ADVANCE');
        return decide('step', 'COVER_PENDING');
      }
      return decide('failed', 'COVER_UNCONFIRMED');
    }
    if (['uncertain', 'needs_review'].includes(provider.state)) return decide('failed', 'PROVIDER_NEEDS_REVIEW');
    if (lease !== null && lease > now) return decide('wait', 'PROVIDER_RUNNING');
    if (provider.has_provider_id && updated !== null && now < updated + 10000) return decide('wait', 'PROVIDER_POLL_WAIT');
    const newObservation = observation && observation.sequence !== (previous?.observation_sequence || 0);
    if (newObservation && observation.result?.ok !== true) return decide('failed', 'PROVIDER_STEP_BLOCKED');
    if (previous?.action === 'step' && previous.signature === signature &&
        provider.state !== 'not_started') return decide('failed', 'PROVIDER_DID_NOT_ADVANCE');
    if (comparison?.ok !== undefined && (comparison.ok !== true || comparison.state === 'needs_review')) return decide('failed', 'CONTENT_REVIEW_REQUIRED');
    const comparisonPass = order.media_check?.checks?.some(check => check.code === 'PORTAL_TEXT_COMPARISON' && check.status === 'pass');
    if (comparison?.state === 'running' && !comparisonPass) return decide('wait', 'CONTENT_COMPARISON_RUNNING');
    if (!['approved', 'blocked', 'checked'].includes(order.state)) return decide('failed', 'ORDER_NOT_APPROVED');
    if (['approved', 'blocked'].includes(order.state)) {
      if ((previous?.checks || 0) >= 1) return decide('failed', 'ORDER_REVIEW_REQUIRED');
      return decide('step', 'ORDER_CHECK_REQUIRED', {checks: 1});
    }
    if (!Array.isArray(order.blockers) || order.blockers.length) return decide('failed', 'ORDER_REVIEW_REQUIRED');
    const upload = provider.state === 'not_started' || provider.state === 'session_ready' ||
      (provider.state === 'uploading' && provider.last_operation === 'probe' && !provider.has_provider_id);
    if (upload && !provider.permission_valid) return decide('failed', 'UPLOAD_TEST_APPROVAL_REQUIRED');
    if (provider.state === 'reserved') return decide('failed', 'PROVIDER_INIT_UNCERTAIN');
    if (!upload && !provider.has_provider_id && !provider.has_session) return decide('failed', 'PROVIDER_RECONCILIATION_REQUIRED');
    return decide('step', 'PROVIDER_CONTINUE');
  }
  return {copyItem, ticket, remaining, claimParams, claimed, params, publicResponse,
    acknowledge, outcome, completion, receipt, orderDecision};
}

module.exports = {createFileCommandRuntime};
