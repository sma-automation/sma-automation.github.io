const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const {parseHTML} = require('./dom-runtime/node_modules/linkedom');

const source = readFileSync('app/assets/onboarding-plan.mjs', 'utf8').replace(/^import[^\n]*\n/, '');
const html = readFileSync('app/paketwahl.html', 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const copy = value => JSON.parse(JSON.stringify(value));

function setup({stalls = []} = {}) {
  const {window, document} = parseHTML(html);
  const handlers = new Map(), timers = new Map(), holds = new Set(stalls), held = new Map();
  const calls = [], redirects = [], errors = [], counts = new Map();
  let account = 'first', authHandler, now = 0, timerId = 0, bootSettled = false;
  const server = {plan: 'alpha', linked: true, paymentCode: 'BOOKED',
    offer: {id: 'synthetic-offer', plan: 'alpha', terms: '2026-11-15-v1',
      state: 'offered', automated: true, checkout: null}};
  const node = id => {
    const result = document.getElementById(id);
    assert.ok(result, 'Existing package page control: ' + id);
    return result;
  };
  for (const element of document.querySelectorAll('*')) {
    element.addEventListener = (event, handler) => handlers.set(element, {
      ...handlers.get(element), [event]: handler
    });
  }
  const radios = [...node('choice').querySelectorAll('input[name=plan]')];
  // Linkedom does not implement HTMLFormControlsCollection/RadioNodeList.
  // The inputs and every customer-visible control still come from paketwahl.html.
  Object.defineProperty(radios, 'value', {get: () => radios.find(input => input.checked)?.value || ''});
  Object.defineProperty(node('choice'), 'elements', {value: {plan: radios}});
  const next = name => {
    const number = (counts.get(name) || 0) + 1;
    counts.set(name, number);
    return name + number;
  };
  function response(key, value) {
    const snapshot = copy(value);
    if (!holds.delete(key)) return Promise.resolve(snapshot);
    // Deliberately ignore AbortSignal, as transports may already have sent the
    // request. The page must stop the old continuation independently of transport.
    return new Promise((resolve, reject) => held.set(key, {
      resolve: () => resolve(snapshot), reject
    }));
  }
  const client = {
    auth: {
      onAuthStateChange: handler => { authHandler = handler; },
      getSession() {
        const key = next('auth');
        calls.push({key, name: 'getSession'});
        return response(key, {data: {session: account ? {user: {id: account}} : null}, error: null});
      },
      signOut() {
        const key = next('signout');
        calls.push({key, name: 'signOut'});
        return response(key, {error: null});
      }
    },
    rpc(name, args) {
      let signal;
      return {
        abortSignal(value) { signal = value; return this; },
        then(resolve, reject) {
          let key, result;
          if (name === 'sma_onboarding_plan_choice_v1') {
            key = next('plan');
            if (args.p_plan) {
              server.plan = args.p_plan;
              server.offer = {...server.offer, id: 'offer-' + server.plan,
                plan: server.plan, state: 'offered', checkout: null};
            }
            result = {data: {ok: true, plan: server.plan, linked: server.linked}, error: null};
          } else {
            assert.equal(name, 'sma_onboarding_booking_v1');
            if (args.p_offer) {
              key = next('booking');
              server.offer = {...server.offer, id: 'synthetic-booking', state: 'booked'};
            } else key = next('offer');
            result = {data: {ok: true, offer: server.offer}, error: null};
          }
          calls.push({key, name, args: copy(args), signal});
          return response(key, result).then(resolve, reject);
        }
      };
    },
    functions: {invoke(name, options) {
      assert.equal(name, 'sma-package-payment');
      const key = next('payment');
      calls.push({key, name, args: copy(options.body), signal: options.signal});
      server.offer = {...server.offer, checkout: 'https://www.mollie.com/checkout/fixture'};
      return response(key, {data: {code: server.paymentCode}, error: null});
    }}
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const location = {search: '', replace: path => redirects.push(path)};
  window.location = location;
  const boot = vm.runInNewContext('(async () => {' + source + '\n})()', {
    document, window, location, URL, URLSearchParams, AbortController, AbortSignal, DOMException,
    Date: ClockDate, performance: {now: () => now}, createClient: () => client,
    setTimeout: (fn, delay) => {
      const id = ++timerId;
      timers.set(id, {fn, at: now + delay});
      return id;
    },
    clearTimeout: id => timers.delete(id), console
  });
  boot.then(() => { bootSettled = true; }, error => { bootSettled = true; errors.push(error); });
  const check = async () => {
    await flush();
    if (errors.length) throw errors[0];
  };
  const fire = async (element, event) => {
    const listener = handlers.get(element)?.[event];
    assert.equal(typeof listener, 'function', 'The actual page wires ' + event + ' for ' + element.id);
    try {
      const result = listener.call(element, {preventDefault() {}, target: element, currentTarget: element});
      if (result?.then) result.catch(error => errors.push(error));
    } catch (error) { errors.push(error); }
    await check();
  };
  return {node, calls, redirects, server, timers, radios, check,
    bootSettled: () => bootSettled,
    count: prefix => calls.filter(call => call.key.startsWith(prefix)).length,
    writes: () => calls.filter(call => call.args?.p_plan || call.args?.p_offer),
    hold: key => holds.add(key),
    async select(value) {
      for (const input of radios) input.checked = input.value === value;
      await fire(node('choice'), 'change');
    },
    submit: () => fire(node('choice'), 'submit'),
    book: () => fire(node('book'), 'click'),
    retry: () => fire(node('retry'), 'click'),
    logout: () => fire(node('logout'), 'click'),
    async auth(event, owner) {
      account = owner;
      authHandler(event, owner ? {user: {id: owner}} : null);
      await check();
    },
    async release(key, reject = false) {
      const pending = held.get(key);
      assert.ok(pending, 'Expected held response: ' + key);
      held.delete(key);
      if (reject) pending.reject(Error('Synthetic late service rejection'));
      else pending.resolve();
      await check();
    },
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const first = [...timers].filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!first) break;
        const [id, timer] = first;
        timers.delete(id);
        now = timer.at;
        timer.fn();
        await check();
      }
      now = until;
      await check();
    }
  };
}

function retryAvailable(f) {
  assert.equal(f.node('retry').hidden, false, 'A timed-out request must offer an explicit retry');
  assert.equal(f.node('retry').disabled, false);
  assert.ok(f.node('status').textContent.trim());
  assert.equal(f.node('booking').hidden, true);
  assert.deepEqual(f.redirects, []);
}

function abortedRPC(f, key) {
  const request = f.calls.find(call => call.key === key);
  assert.ok(request?.signal instanceof AbortSignal, key + ' must receive an AbortSignal');
  assert.equal(request.signal.aborted, true);
}

function stableSnapshot(f) {
  return {calls: f.calls.length, status: f.node('status').textContent,
    selection: f.radios.value, bookingHidden: f.node('booking').hidden,
    checkout: f.node('checkout').getAttribute('href'), redirects: [...f.redirects]};
}

for (const stall of ['auth1', 'plan1', 'offer1']) {
  test('initial package choice recovers from a stalled ' + stall + ' at 45 seconds', async () => {
    const f = setup({stalls: [stall]});
    await f.check();
    await f.advance(44999);
    assert.equal(f.node('retry').hidden, true);
    await f.advance(1);
    retryAvailable(f);
    assert.equal(f.bootSettled(), true);
    if (stall !== 'auth1') abortedRPC(f, stall);
    f.server.plan = 'beta';
    f.server.offer = {...f.server.offer, plan: 'beta'};
    await f.retry();
    assert.equal(f.radios.value, 'beta');
    assert.equal(f.writes().length, 0);
    assert.equal(f.count('payment'), 0);
    const fresh = stableSnapshot(f);
    await f.release(stall);
    assert.deepEqual(stableSnapshot(f), fresh);
    assert.equal(f.timers.size, 0);
  });
}

test('session, preference and offer reads share one 45-second budget', async () => {
  const f = setup({stalls: ['auth1', 'plan1', 'offer1']});
  await f.check();
  await f.advance(20000);
  await f.release('auth1');
  await f.advance(20000);
  await f.release('plan1');
  assert.equal(f.count('offer'), 1);
  await f.advance(4999);
  assert.equal(f.node('retry').hidden, true);
  await f.advance(1);
  retryAvailable(f);
  abortedRPC(f, 'offer1');
  assert.equal(f.timers.size, 0);
  const expired = stableSnapshot(f);
  await f.release('offer1');
  assert.deepEqual(stableSnapshot(f), expired);
});

test('a saved preference with a lost reply is recovered by reading, without a second write', async () => {
  const f = setup();
  await f.check();
  f.hold('plan2');
  await f.select('beta');
  await f.submit();
  assert.equal(f.server.plan, 'beta');
  assert.equal(f.writes().length, 1);
  await f.advance(45000);
  retryAvailable(f);
  abortedRPC(f, 'plan2');
  await f.retry();
  assert.equal(f.radios.value, 'beta');
  assert.equal(f.writes().length, 1);
  assert.equal(f.calls.find(call => call.key === 'plan3').args.p_plan, null);
  const fresh = stableSnapshot(f);
  await f.release('plan2');
  assert.deepEqual(stableSnapshot(f), fresh);
});

test('a booking saved before its lost confirmation is read back and its late reply starts no payment call', async () => {
  const f = setup();
  await f.check();
  f.hold('booking1');
  await f.book();
  assert.equal(f.server.offer.state, 'booked');
  assert.equal(f.count('booking'), 1);
  await f.advance(45000);
  retryAvailable(f);
  abortedRPC(f, 'booking1');
  await f.retry();
  assert.equal(f.node('booking').hidden, false);
  assert.equal(f.node('book').hidden, true);
  assert.equal(f.node('refresh-payment').hidden, false);
  assert.equal(f.count('booking'), 1);
  assert.equal(f.count('payment'), 0);
  const fresh = stableSnapshot(f);
  await f.release('booking1');
  assert.deepEqual(stableSnapshot(f), fresh);
  assert.equal(f.count('payment'), 0);
});

test('a confirmed booking with a stalled payment call gets a read-only retry and ignores late ACTIVE', async () => {
  const f = setup();
  await f.check();
  f.hold('payment1');
  f.server.paymentCode = 'ACTIVE';
  await f.book();
  assert.equal(f.count('booking'), 1);
  assert.equal(f.count('payment'), 1);
  await f.advance(45000);
  retryAvailable(f);
  await f.retry();
  assert.equal(f.node('booking').hidden, false);
  assert.equal(f.node('book').hidden, true);
  assert.equal(f.count('booking'), 1);
  assert.equal(f.count('payment'), 1);
  const fresh = stableSnapshot(f);
  await f.release('payment1');
  assert.deepEqual(stableSnapshot(f), fresh);
  assert.deepEqual(f.redirects, []);
  assert.equal(f.timers.size, 0);
});

test('late rejected auth and payment promises are consumed without changing the newer read', async () => {
  for (const stall of ['auth1', 'payment1']) {
    const f = setup({stalls: [stall]});
    await f.check();
    if (stall === 'payment1') await f.book();
    await f.advance(45000);
    retryAvailable(f);
    await f.retry();
    const fresh = stableSnapshot(f);
    await f.release(stall, true);
    assert.deepEqual(stableSnapshot(f), fresh);
  }
});

test('signout and account changes stop an old session lookup before it can save a preference', async () => {
  for (const [event, owner, destination] of [['SIGNED_OUT', null, 'index.html'], ['SIGNED_IN', 'second', 'dashboard.html']]) {
    const f = setup();
    await f.check();
    f.hold('auth2');
    await f.select('beta');
    await f.submit();
    const rpcCount = f.calls.filter(call => call.args?.p_owner).length;
    await f.auth(event, owner);
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.redirects, [destination]);
    assert.equal(f.node('choice').hidden, true);
    await f.release('auth2');
    assert.equal(f.calls.filter(call => call.args?.p_owner).length, rpcCount);
    assert.equal(f.writes().length, 0);
    await f.advance(45000);
    assert.deepEqual(f.redirects, [destination]);
  }
});
