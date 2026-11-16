// Server-only building block. No Deno.serve(), scheduler, credentials or route is
// installed by this module. `rpc` must use the private service-only worker RPC.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const EXECUTION = /^[A-Za-z0-9_-]{1,80}$/;
const TICKET = /^[a-f0-9]{64}$/;
const ORIGIN = 'https://johnmusic.app.n8n.cloud';
const fail = code => { throw Object.assign(new Error(code), { code }); };

export function checkedResumeDelivery(value, jobId, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.job_id !== jobId || !UUID.test(jobId)
    || !UUID.test(value.event_id) || !UUID.test(value.lease_id)
    || !EXECUTION.test(value.execution_id) || !TICKET.test(value.ticket)
    || !Number.isInteger(value.phase_seq) || value.phase_seq < 1 || value.phase_seq > 64
    || typeof value.resume_url !== 'string' || value.resume_url.length > 2000
    || !Number.isFinite(now)) fail('INVALID_RESUME_BINDING');
  const expires = Date.parse(value.expires_at);
  if (!Number.isFinite(expires) || expires <= now || expires > now + 60_000) fail('RESUME_LEASE_EXPIRED');
  let url;
  try { url = new URL(value.resume_url); } catch { fail('INVALID_RESUME_BINDING'); }
  if (url.origin !== ORIGIN || url.username || url.password || url.hash
    || url.pathname !== '/webhook-waiting/' + value.execution_id + '/file-command-' + value.phase_seq
    || url.searchParams.size !== 1 || !url.searchParams.has('signature')
    || !/^[A-Za-z0-9._~=-]{16,1024}$/.test(url.searchParams.get('signature'))
    // Reject canonicalization tricks instead of silently changing a signed URL.
    || url.href !== value.resume_url) fail('INVALID_RESUME_BINDING');
  return {
    ...value,
    expires,
    body: { job_id: jobId, event_id: value.event_id, phase_seq: value.phase_seq, ticket: value.ticket },
  };
}

function confirmed(receipt, delivery) {
  return receipt?.ok === true && receipt.accepted === true && receipt.state === 'accepted'
    && receipt.job_id === delivery.job_id && receipt.event_id === delivery.event_id
    && receipt.phase_seq === delivery.phase_seq && receipt.execution_id === delivery.execution_id;
}

function notAccepted(receipt, delivery) {
  return receipt?.ok === true && receipt.accepted === false && receipt.state === 'offered'
    && receipt.job_id === delivery.job_id && receipt.event_id === delivery.event_id
    && receipt.phase_seq === delivery.phase_seq && receipt.execution_id === null;
}

// The first event can arrive after URL registration but before native Wait is
// listening. Only an explicit HTTP 404 AND the matching negative receipt allow
// two short retries of that identical event/URL/ticket within the original lease.
// Unknown transport outcomes, 409s and missing receipts are never retried here.
export async function deliverFileResume({ jobId, rpc, fetcher = fetch, now = Date.now,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!UUID.test(jobId) || typeof rpc !== 'function' || typeof fetcher !== 'function') fail('INVALID_INPUT');
  const claim = await rpc('claim_delivery', { job_id: jobId });
  if (claim?.ok !== true) fail('RESUME_UNAVAILABLE');
  if (claim.delivery === null) return { ok: true, delivered: false };
  const delivery = checkedResumeDelivery(claim.delivery, jobId, now());
  const identity = { job_id: jobId, event_id: delivery.event_id };
  const accepted = () => ({ ok: true, delivered: true, ...identity });

  let notReady = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    notReady = false;
    let status = null, stored;
    if (attempt > 0) {
      const delay = attempt === 1 ? 1000 : 3000;
      if (delivery.expires - now() <= delay) break;
      await wait(delay);
      // A late acceptance during backoff wins. Never resend merely because the
      // previous receipt read preceded that commit.
      try { stored = await rpc('receipt', identity); } catch { break; }
      if (confirmed(stored, delivery)) return accepted();
      if (!notAccepted(stored, delivery)) break;
    }
    try {
      const remaining = delivery.expires - now();
      if (remaining <= 0) break;
      const response = await fetcher(delivery.resume_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'omit', redirect: 'error', cache: 'no-store',
        body: JSON.stringify(delivery.body),
        signal: AbortSignal.timeout(Math.min(10_000, Math.max(1, Math.floor(remaining)))),
      });
      status = response.status;
      // No provider data or capabilities from an HTTP body are interpreted.
      try { await response.body?.cancel(); } catch { /* The database receipt decides. */ }
    } catch { /* Never expose a signed URL from a network error or its cause. */ }
    try { stored = await rpc('receipt', identity); } catch { break; }
    if (confirmed(stored, delivery)) return accepted();
    notReady = status === 404 && notAccepted(stored, delivery);
    if (!notReady) break;
  }
  try {
    const result = await rpc('uncertain', { ...identity, lease_id: delivery.lease_id });
    // n8n may have accepted between the receipt read and this atomic update.
    if (result?.ok === true && result.accepted === true
      && confirmed(await rpc('receipt', identity), delivery)) return accepted();
  } catch { /* Preserve the original durable claim; never retry the POST here. */ }
  return { ok: false, code: notReady ? 'RESUME_NOT_READY' : 'RESUME_UNCERTAIN', ...identity, can_retry: false };
}
