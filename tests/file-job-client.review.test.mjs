import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
const moduleURL = process.env.SMA_FILE_JOB_CLIENT_MODULE ? pathToFileURL(process.env.SMA_FILE_JOB_CLIENT_MODULE)
  : new URL('../app/assets/file-job-client.mjs', import.meta.url);
const { createFileJobClient } = await import(moduleURL.href);
const owner = 'ab990000-0000-4000-8000-000000000001';
const anchor = { kind: 'asset', asset_id: 'ab990000-0000-4000-8000-000000000002', asset_revision: 'v1' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const cancelled = error => error?.name === 'AbortError' || error?.code === 'FILE_JOB_CANCELLED';

function fixture({ delayBody = false, sessionOverride } = {}) {
  let clock = 1795000000000, seq = 10, starts = 0, latestCommand, job;
  const calls = [], bodyStarted = deferred(), pendingBody = deferred();
  const session = sessionOverride || (async () => ({ access_token: 'synthetic-session', user: { id: owner } }));
  const client = createFileJobClient({ session, now: () => clock, wait: async () => {},
    uuid: () => 'ab990000-0000-4000-8000-' + String(++seq).padStart(12, '0'),
    fetcher: async (url, options) => {
      const input = JSON.parse(options.body); calls.push({ url, input, signal: options.signal });
      if (input.p_action === 'start') {
        starts++; job = { ok: true, job_id: 'ab990000-0000-4000-8000-' + String(100 + starts).padStart(12, '0'),
          state: 'running', deadline_at: new Date(clock + 1000).toISOString(), commands: [] };
        return Response.json(job);
      }
      if (!input.p_action) { latestCommand = input.command_id; return Response.json({ ok: true, job_id: job.job_id, command_id: latestCommand }); }
      const result = { ...job, commands: [{ command_id: latestCommand, operation: 'magic_photo', state: 'completed',
        response: { status: 200, body: { ok: true, can_publish: false } } }] };
      if (delayBody) {
        return { ok: true, status: 200, json: () => { bodyStarted.resolve(result); return pendingBody.promise; } };
      }
      return Response.json(result);
    },
  });
  const request = () => client.request({ anchor, operation: 'magic_photo', input: { asset_id: anchor.asset_id, asset_revision: anchor.asset_revision }, timeoutMs: 1000 });
  return { client, request, calls, bodyStarted, pendingBody, advance: ms => { clock += ms; }, starts: () => starts };
}

test('an expired retry retains its request identity and cannot silently create another parent', async () => {
  const f = fixture(); await f.request(); f.advance(1001);
  await assert.rejects(f.request(), error => error?.code === 'FILE_JOB_EXPIRED');
  assert.equal(f.starts(), 1);
});

test('explicit beginNewWork evicts only an expired current-owner binding without a network request', async () => {
  const f = fixture(); await f.request(); const before = f.calls.length;
  assert.equal(await f.client.beginNewWork(anchor), false); assert.equal(f.calls.length, before);
  f.advance(1001);
  assert.equal(await f.client.beginNewWork(anchor), true); assert.equal(f.calls.length, before);
  await f.request(); assert.equal(f.starts(), 2);
  const ids = f.calls.filter(c => c.input.p_action === 'start').map(c => c.input.p_input.request_id);
  assert.notEqual(ids[0], ids[1]);
});

test('clear invalidates a public result whose response body arrives later for the same owner', async () => {
  const f = fixture({ delayBody: true }), pending = f.request();
  const body = await f.bodyStarted.promise;
  f.client.clear(); f.pendingBody.resolve(body);
  await assert.rejects(pending, cancelled);
});

test('clear during an initial session read prevents a late session from starting any network work', async () => {
  const session = deferred(), started = deferred();
  const f = fixture({ sessionOverride: () => { started.resolve(); return session.promise; } });
  const pending = f.request(); await started.promise;
  f.client.clear(); session.resolve({ access_token: 'old-session', user: { id: owner } });
  await assert.rejects(pending, cancelled); assert.equal(f.calls.length, 0);
});
