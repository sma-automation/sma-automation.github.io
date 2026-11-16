import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
const moduleURL = process.env.SMA_FILE_JOB_RESUME_MODULE
  ? pathToFileURL(process.env.SMA_FILE_JOB_RESUME_MODULE)
  : new URL('../supabase/functions/sma-file-job/resume.mjs', import.meta.url);
const { checkedResumeDelivery, deliverFileResume } = await import(moduleURL.href);

const stamp = 1_795_000_000_000;
const uuid = n => 'ab770000-0000-4000-8000-' + String(n).padStart(12, '0');
const jobId = uuid(1);
const delivery = () => ({
  job_id: jobId, event_id: uuid(2), lease_id: uuid(3), phase_seq: 1,
  execution_id: '7098', expires_at: new Date(stamp + 60_000).toISOString(),
  resume_url: 'https://johnmusic.app.n8n.cloud/webhook-waiting/7098/file-command-1?signature=synthetic_signature_value',
  ticket: 'a'.repeat(64),
});
const receipt = (d, patch = {}) => ({ ok: true, job_id: d.job_id, event_id: d.event_id,
  accepted: true, state: 'accepted', phase_seq: d.phase_seq, execution_id: d.execution_id, ...patch });

test('one private claim, one POST and the durable receipt confirm delivery', async () => {
  const d = delivery(), calls = [], requests = [];
  const result = await deliverFileResume({ jobId, now: () => stamp,
    rpc: async (action, input) => { calls.push([action, input]); return action === 'claim_delivery' ? { ok: true, delivery: d } : receipt(d); },
    fetcher: async (url, options) => { requests.push([url, options]); return new Response('{}'); },
  });
  assert.deepEqual(result, { ok: true, delivered: true, job_id: jobId, event_id: d.event_id });
  assert.deepEqual(calls.map(c => c[0]), ['claim_delivery', 'receipt']);
  assert.equal(requests.length, 1);
  const [, options] = requests[0];
  assert.equal(options.redirect, 'error');
  assert.equal(options.credentials, 'omit');
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(options.body), { job_id: jobId, event_id: d.event_id, phase_seq: 1, ticket: d.ticket });
  assert.doesNotMatch(JSON.stringify(result), /signature|resume_url|ticket|lease_id|execution_id/);
});

test('lost HTTP response still succeeds when the same execution already recorded acceptance', async () => {
  const d = delivery(); let posts = 0, receipts = 0;
  const result = await deliverFileResume({ jobId, now: () => stamp,
    rpc: async action => action === 'claim_delivery' ? { ok: true, delivery: d } : (receipts++, receipt(d)),
    fetcher: async () => { posts++; throw new Error('network lost, private URL must not escape'); },
  });
  assert.equal(result.delivered, true); assert.equal(posts, 1); assert.equal(receipts, 1);
});

test('HTTP 200 alone is uncertain and never causes a second POST or replacement run', async () => {
  const d = delivery(), actions = []; let posts = 0;
  const result = await deliverFileResume({ jobId, now: () => stamp,
    rpc: async action => { actions.push(action); return action === 'claim_delivery' ? { ok: true, delivery: d } : action === 'receipt' ? receipt(d, { accepted: false, state: 'offered' }) : { ok: true, accepted: false }; },
    fetcher: async () => { posts++; return new Response('{"accepted":true}'); },
  });
  assert.equal(result.code, 'RESUME_UNCERTAIN'); assert.equal(result.can_retry, false); assert.equal(posts, 1);
  assert.deepEqual(actions, ['claim_delivery', 'receipt', 'uncertain']);
});

test('acceptance racing with the uncertainty update is reconciled without another transport', async () => {
  const d = delivery(); let reads = 0, posts = 0;
  const result = await deliverFileResume({ jobId, now: () => stamp,
    rpc: async action => action === 'claim_delivery' ? { ok: true, delivery: d }
      : action === 'receipt' ? receipt(d, ++reads === 1 ? { accepted: false, state: 'offered' } : {})
      : { ok: true, accepted: true },
    fetcher: async () => { posts++; throw Error('timeout'); },
  });
  assert.equal(result.delivered, true); assert.equal(reads, 2); assert.equal(posts, 1);
});

test('unavailable receipt or uncertainty RPC leaves the claim unconfirmed', async () => {
  const d = delivery(); let posts = 0;
  const result = await deliverFileResume({ jobId, now: () => stamp,
    rpc: async action => { if (action === 'claim_delivery') return { ok: true, delivery: d }; throw Error('private SQL error'); },
    fetcher: async () => { posts++; throw Error(d.resume_url); },
  });
  assert.equal(posts, 1); assert.equal(result.code, 'RESUME_UNCERTAIN');
  assert.doesNotMatch(JSON.stringify(result), /signature|private SQL|https:/);
});

test('a missing delivery performs no HTTP request', async () => {
  const result = await deliverFileResume({ jobId, rpc: async () => ({ ok: true, delivery: null }),
    fetcher: async () => assert.fail('unexpected HTTP') });
  assert.deepEqual(result, { ok: true, delivered: false });
});

test('foreign, unsigned, stale-phase, credentialed and redirected-looking URLs are rejected before transport', () => {
  const d = delivery();
  for (const url of [
    d.resume_url.replace('johnmusic.app.n8n.cloud', 'attacker.invalid'),
    d.resume_url.replace('https:', 'http:'), d.resume_url.split('?')[0],
    d.resume_url.replace('/7098/', '/7099/'), d.resume_url.replace('/file-command-1', '/file-command-2'),
    d.resume_url + '#secret', d.resume_url + '&next=https://attacker.invalid',
    d.resume_url.replace('https://', 'https://user:password@'),
    d.resume_url.replace('/webhook-waiting/', '/webhook/'),
    d.resume_url.replace('synthetic_signature_value', 'synthetic%0asignature_value'),
    d.resume_url.replace('/file-command-1?', '/other/../file-command-1?'),
  ]) assert.throws(() => checkedResumeDelivery({ ...d, resume_url: url }, jobId, stamp), /INVALID_RESUME_BINDING/);
});

test('delivery is bound to one file job, event, phase and current lease', () => {
  for (const patch of [{ job_id: uuid(4) }, { event_id: 'bad' }, { lease_id: null },
    { execution_id: '../other' }, { phase_seq: 0 }, { phase_seq: 65 }, { phase_seq: '1' }, { ticket: 'bad' }]) {
    assert.throws(() => checkedResumeDelivery({ ...delivery(), ...patch }, jobId, stamp), /INVALID_RESUME_BINDING/);
  }
  for (const expires_at of [new Date(stamp).toISOString(), new Date(stamp - 1).toISOString(), new Date(stamp + 60_001).toISOString(), 'invalid']) {
    assert.throws(() => checkedResumeDelivery({ ...delivery(), expires_at }, jobId, stamp), /RESUME_LEASE_EXPIRED/);
  }
});

test('a different execution/event/phase receipt never confirms this delivery', async () => {
  const d = delivery();
  for (const patch of [{ execution_id: '7099' }, { event_id: uuid(9) }, { job_id: uuid(10) }, { phase_seq: 2 }, { state: 'offered' }]) {
    let posts = 0;
    const result = await deliverFileResume({ jobId, now: () => stamp,
      rpc: async action => action === 'claim_delivery' ? { ok: true, delivery: d }
        : action === 'receipt' ? receipt(d, patch) : { ok: true, accepted: false },
      fetcher: async () => { posts++; return new Response('{}'); },
    });
    assert.equal(result.code, 'RESUME_UNCERTAIN'); assert.equal(posts, 1);
  }
});

test('a lease that expires between validation and dispatch makes no HTTP request', async () => {
  const d = delivery(); let reads = 0, posts = 0;
  const result = await deliverFileResume({ jobId, now: () => reads++ ? stamp + 60_000 : stamp,
    rpc: async action => action === 'claim_delivery' ? { ok: true, delivery: d }
      : action === 'receipt' ? receipt(d, { accepted: false }) : { ok: true, accepted: false },
    fetcher: async () => { posts++; },
  });
  assert.equal(posts, 0); assert.equal(result.code, 'RESUME_UNCERTAIN');
});

test('an early event before native Wait is ready retries only the identical rejected 404 request', async () => {
  const d = delivery(), requests = [], delays = []; let accepted = false;
  const result = await deliverFileResume({ jobId, now: () => stamp,
    rpc: async action => action === 'claim_delivery' ? { ok: true, delivery: d }
      : receipt(d, accepted ? {} : { accepted: false, state: 'offered', execution_id: null }),
    wait: async ms => { delays.push(ms); },
    fetcher: async (url, options) => {
      requests.push([url, options.body]);
      if (requests.length === 1) return new Response('{}', { status: 404 });
      accepted = true; return new Response('{}');
    },
  });
  assert.equal(result.delivered, true);
  assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
  assert.deepEqual(delays, [1000]);
});

test('404 without a valid negative receipt and every other response remain single-attempt', async () => {
  const d = delivery();
  for (const status of [404, 409, 429, 500, 200]) {
    let posts = 0;
    const result = await deliverFileResume({ jobId, now: () => stamp,
      rpc: async action => action === 'claim_delivery' ? { ok: true, delivery: d }
        : action === 'receipt' ? receipt(d, { accepted: false, state: status === 404 ? 'uncertain' : 'offered', execution_id: null })
        : { ok: true, accepted: false },
      wait: async () => assert.fail('must not retry'),
      fetcher: async () => { posts++; return new Response('{}', { status }); },
    });
    assert.equal(posts, 1); assert.equal(result.code, 'RESUME_UNCERTAIN');
  }
});

test('persistent native 404 is bounded to three attempts and the original lease', async () => {
  const d = delivery(), delays = []; let posts = 0;
  const result = await deliverFileResume({ jobId, now: () => stamp,
    rpc: async action => action === 'claim_delivery' ? { ok: true, delivery: d }
      : action === 'receipt' ? receipt(d, { accepted: false, state: 'offered', execution_id: null })
      : { ok: true, accepted: false },
    wait: async ms => { delays.push(ms); },
    fetcher: async () => { posts++; return new Response('{}', { status: 404 }); },
  });
  assert.equal(posts, 3); assert.deepEqual(delays, [1000, 3000]);
  assert.equal(result.code, 'RESUME_NOT_READY'); assert.equal(result.can_retry, false);
});

test('a receipt accepted during 404 backoff prevents the next HTTP call', async () => {
  const d = delivery(); let reads = 0, posts = 0;
  const result = await deliverFileResume({ jobId, now: () => stamp,
    rpc: async action => action === 'claim_delivery' ? { ok: true, delivery: d }
      : receipt(d, ++reads === 1 ? { accepted: false, state: 'offered', execution_id: null } : {}),
    wait: async () => {},
    fetcher: async () => { posts++; return new Response('{}', { status: 404 }); },
  });
  assert.equal(result.delivered, true); assert.equal(posts, 1); assert.equal(reads, 2);
});

test('the last allowed native command phase remains valid', () => {
  const d = delivery(); d.phase_seq = 64; d.resume_url = d.resume_url.replace('file-command-1?', 'file-command-64?');
  assert.equal(checkedResumeDelivery(d, jobId, stamp).phase_seq, 64);
});
