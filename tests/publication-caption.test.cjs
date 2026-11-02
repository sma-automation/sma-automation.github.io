const {test} = require('node:test');
const assert = require('node:assert/strict');
const {normalizedBody, planCaption, prepareCaption, reserveCaption} = require('../n8n/publishing/publication-caption.cjs');
const copy = v => JSON.parse(JSON.stringify(v));
const ctx = (id = 'post-1', platform = 'instagram') => ({
  ok: true, status: 'processing', shop_url: 'https://sma-automation.com/app/shop.html?shop=testkunde',
  input: {request_id: '12345678-1234-4123-8123-123456789abc', source_text: 'Die blaue Keramiktasse hat einen Henkel und fasst 300 ml. Das Video zeigt die Tasse auf einem Tisch.', audience: 'Menschen mit Interesse an Keramik', goal: 'Das Produkt sachlich vorstellen', language: 'de', media_kind: 'video', platforms: [platform]},
  publication: {publication_id: id, customer_id: 'customer-1', account_id: 'account-1', asset_id: 'asset-1', asset_revision: 'sha256:' + 'a'.repeat(64) + ':1', platform, format: platform === 'instagram' ? 'reel' : 'video', content_sha256: 'a'.repeat(64), evidence_sha256: 'b'.repeat(64), product_snapshot_sha256: 'c'.repeat(64)}
});
const empty = () => ({customer_id: 'customer-1', complete: true, revision: 0, entries: []});
const body1 = 'Die blaue Keramiktasse mit Henkel fasst 300 ml und steht im Video auf einem Tisch.';
const body2 = '300 ml Fassungsvermögen: Hier stellen wir unsere Tasse aus blauer Keramik vor.';
const body3 = 'Im Mittelpunkt dieser Aufnahme steht ein Gefäß mit Henkel. Sein Material ist Keramik, seine Farbe Blau.';
const response = (body = body1, platform = 'instagram', patch = {}) => ({status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify({drafts: [{platform, title: 'Blaue Keramiktasse', body, hashtags: ['Keramik'], review_notes: [], ...patch}]})}]}]});
function historyWith(candidate) { return {...empty(), revision: 1, entries: [candidate]}; }
// Test fixture only: does not claim a durable production database exists.
function memoryStore(history = empty()) {
  let value = copy(history), pending = Promise.resolve();
  return {
    get value() { return copy(value); },
    transaction(customer, fn) {
      const result = pending.then(async () => {
        assert.equal(customer, value.customer_id);
        let next = copy(value);
        const output = await fn({read: async () => copy(next), write: async v => { next = copy(v); }});
        value = next;
        return output;
      });
      pending = result.catch(() => {});
      return result;
    }
  };
}
test('new publication uses history-aware generation; all output remains pending', () => {
  const context = ctx(), history = empty(), plan = planCaption(context, history);
  assert.equal(plan.action, 'generate');
  assert.deepEqual(JSON.parse(plan.request.input).previous_bodies, []);
  assert.match(plan.request.instructions, /Geänderte Captions machen ein Video nicht neu/);
  assert.ok(!plan.request.input.includes('customer-1'));
  const candidate = prepareCaption(response(), context, history);
  assert.equal(candidate.can_publish, false);
  assert.equal(candidate.checks.semantic_alignment, 'pending');
  assert.equal(candidate.checks.shop_placement, 'pending');
  assert.equal(candidate.draft.caption.split(context.shop_url).length - 1, 1);
});
test('new post on same bytes needs a different body and separately flags media reuse', () => {
  const first = prepareCaption(response(), ctx(), empty()), history = historyWith(first);
  const second = prepareCaption(response(body2), ctx('post-2'), history);
  assert.equal(second.checks.media_reuse, 'same_bytes_previously_reserved');
  assert.equal(second.checks.originality, 'pending');
  assert.equal(second.can_publish, false);
  assert.deepEqual(JSON.parse(planCaption(ctx('post-2'), history).request.input).previous_bodies, [body1]);
  assert.equal(first.draft.body, body1);
});
test('title, hashtag, emoji, punctuation, case and invisible-character changes do not count', () => {
  const history = historyWith(prepareCaption(response(), ctx(), empty()));
  for (const body of [body1, body1.toUpperCase(), body1.replaceAll(' ', '  '), body1 + ' 🛒!!!', body1.replace('Tasse', 'Ta\u200bsse'), body1.replace('Keramiktasse', 'Keramik-tasse')]) {
    assert.throws(() => prepareCaption(response(body, 'instagram', {title: 'Anderer Titel', hashtags: ['Blau']}), ctx('post-2'), history), /CAPTION_ALREADY_USED|CAPTION_TOO_SIMILAR/);
  }
  assert.equal(normalizedBody('Straße １２ 😊'), normalizedBody('STRASSE 12'));
});
test('one-word additions and reordered near-identical wording are blocked', () => {
  const history = historyWith(prepareCaption(response(), ctx(), empty()));
  for (const body of [body1 + ' Entdecken.', 'Im Video steht die blaue Keramiktasse mit Henkel auf einem Tisch und fasst 300 ml.']) {
    assert.throws(() => prepareCaption(response(body), ctx('post-2'), history), /CAPTION_TOO_SIMILAR/);
  }
});
test('history covers other portals, accounts and renamed copies within the customer', () => {
  const history = historyWith(prepareCaption(response(), ctx(), empty()));
  const second = ctx('post-2', 'tiktok'); second.publication.account_id = 'account-2'; second.publication.asset_id = 'renamed-copy';
  assert.throws(() => prepareCaption(response(body1, 'tiktok'), second, history), /CAPTION_ALREADY_USED/);
  assert.equal(prepareCaption(response(body2, 'tiktok'), second, history).checks.media_reuse, 'same_bytes_previously_reserved');
});
test('missing, partial, oversized or foreign-customer history fails closed', () => {
  for (const history of [null, {...empty(), complete: false}, {...empty(), customer_id: 'foreign'}, {...empty(), revision: -1}, {...empty(), entries: new Array(10001).fill(null)}]) {
    assert.throws(() => planCaption(ctx(), history), /CAPTION_HISTORY/);
  }
  const foreign = historyWith(prepareCaption(response(), ctx(), empty()));
  foreign.entries[0].binding.customer_id = 'foreign';
  assert.throws(() => planCaption(ctx('post-2'), foreign), /CAPTION_HISTORY_INVALID/);
});
test('same publication retries reuse the exact stored caption; changed source invalidates it', async () => {
  const context = ctx(), candidate = prepareCaption(response(), context, empty()), store = memoryStore();
  assert.equal((await reserveCaption(store, candidate, context)).action, 'reserved');
  const retried = ctx(); retried.input.request_id = '87654321-1234-4123-8123-123456789abc';
  assert.deepEqual(planCaption(retried, store.value).candidate, candidate);
  assert.equal((await reserveCaption(store, candidate, retried)).action, 'reuse');
  assert.equal(store.value.entries.length, 1);
  assert.throws(() => prepareCaption(response(body2), context, store.value), /CAPTION_REUSE_REQUIRED/);
  for (const field of ['account_id','asset_id','asset_revision','content_sha256','evidence_sha256','product_snapshot_sha256']) {
    const changed = copy(context); changed.publication[field] += 'x';
    assert.throws(() => planCaption(changed, store.value), /CAPTION_PUBLICATION_CHANGED|CAPTION_CONTEXT_INVALID/);
  }
  const changed = copy(context); changed.input.source_text += ' Neue Aussage.';
  assert.throws(() => planCaption(changed, store.value), /CAPTION_PUBLICATION_CHANGED/);
});
test('generation and reservations reject invalid target, unsupported format and changed evidence', async () => {
  for (const patch of [{platform: 'unknown'}, {format: 'story'}, {content_sha256: 'd'.repeat(64)}, {account_id: ''}]) {
    const context = ctx(); Object.assign(context.publication, patch);
    assert.throws(() => planCaption(context, empty()), /CAPTION_CONTEXT_INVALID/);
  }
  const candidate = prepareCaption(response(), ctx(), empty()), changed = ctx(); changed.publication.evidence_sha256 = 'd'.repeat(64);
  await assert.rejects(reserveCaption(memoryStore(), candidate, changed), /CAPTION_PUBLICATION_CHANGED/);
  await assert.rejects(reserveCaption(null, candidate, ctx()), /CAPTION_STORE_REQUIRED/);
});
test('parallel reservations against one revision cannot both commit', async () => {
  const store = memoryStore(), one = prepareCaption(response(), ctx(), empty());
  const two = prepareCaption(response(body2), ctx('post-2'), empty());
  const results = await Promise.allSettled([reserveCaption(store, one, ctx()), reserveCaption(store, two, ctx('post-2'))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /CAPTION_HISTORY_CHANGED/);
  assert.equal(store.value.entries.length, 1);
  const fresh = prepareCaption(response(body2), ctx('post-2'), store.value);
  await reserveCaption(store, fresh, ctx('post-2'));
  assert.equal(store.value.entries.length, 2);
});
test('conflicting candidates for one publication cannot overwrite the saved text', async () => {
  const one = prepareCaption(response(), ctx(), empty()), two = prepareCaption(response(body2), ctx(), empty()), store = memoryStore();
  await reserveCaption(store, one, ctx());
  await assert.rejects(reserveCaption(store, two, ctx()), /CAPTION_RESERVATION_CONFLICT/);
  assert.equal(store.value.entries[0].draft.body, body1);
});
test('a failed write returns no reservation; mutated candidates and history are rejected', async () => {
  const candidate = prepareCaption(response(), ctx(), empty());
  const failing = {transaction: async (_, fn) => fn({read: async () => empty(), write: async () => { throw Error('DB_UNAVAILABLE'); }})};
  await assert.rejects(reserveCaption(failing, candidate, ctx()), /DB_UNAVAILABLE/);
  candidate.draft.body = body2;
  await assert.rejects(reserveCaption(memoryStore(), candidate, ctx()), /CAPTION_HISTORY_INVALID/);
  assert.throws(() => planCaption(ctx('post-2'), historyWith(candidate)), /CAPTION_HISTORY_INVALID/);
});
test('comparison covers older entries beyond the 20 examples supplied to the model', () => {
  let history = empty();
  for (let n = 0; n < 21; n++) {
    // Distinct source text is immaterial here: this test exercises history length, not factual approval.
    const body = String.fromCodePoint(0x4e00 + n).repeat(30);
    const record = prepareCaption(response(body), ctx('old-' + n), history);
    history = {...history, revision: history.revision + 1, entries: [...history.entries, record]};
  }
  assert.equal(JSON.parse(planCaption(ctx('new'), history).request.input).previous_bodies.length, 20);
  assert.throws(() => prepareCaption(response(history.entries[0].draft.body), ctx('new'), history), /CAPTION_ALREADY_USED/);
});
test('edited wording uses the same validator and does not grant content or portal approval', () => {
  const history = historyWith(prepareCaption(response(), ctx(), empty()));
  const candidate = prepareCaption(response(body3), ctx('post-2'), history);
  assert.equal(candidate.can_publish, false);
  for (const key of ['semantic_alignment','originality','shop_placement','disclosures','approval']) assert.equal(candidate.checks[key], 'pending');
});
