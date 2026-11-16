const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {parseHTML} = require('./dom-runtime/node_modules/linkedom');

const html = fs.readFileSync('app/index.html', 'utf8');
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/import\s*\{\s*createClient\s*\}\s*from\s*'[^']+';/, '');
const email = 'entry@example.invalid';
const password = 'EntryExample2026!';
const signedIn = {data: {session: {user: {id: 'synthetic-entry-owner', email}}}, error: null};
const signedOut = {data: {session: null}, error: null};

// Observe the actual page while its first auth read is still unresolved. Unlike
// awaiting the module, this also exposes controls whose listeners were never wired.
const listeners = new WeakMap();
const {window: prototypeWindow} = parseHTML('<html></html>');
const nativeAdd = prototypeWindow.EventTarget.prototype.addEventListener;
prototypeWindow.EventTarget.prototype.addEventListener = function(type, listener, options) {
  let events = listeners.get(this);
  if (!events) listeners.set(this, events = new Map());
  if (!events.has(type)) events.set(type, new Set());
  events.get(type).add(listener);
  return nativeAdd.call(this, type, listener, options);
};

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return {promise, resolve, reject};
}

async function flush() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
}

async function fixture({url = 'https://sma.test/app/index.html', initial, linkResult, sessionResults = []} = {}) {
  const {window, document} = parseHTML(html);
  const first = initial ?? deferred();
  const timers = new Map();
  const calls = [];
  const navigations = [];
  const errors = [];
  let time = 0, nextTimer = 0, sessionReads = 0, authListener;
  const location = new URL(url);
  location.replace = target => navigations.push(new URL(target, location).href);
  window.location = location;
  window.history = {replaceState(_state, _title, target) {
    location.href = new URL(target, location).href;
  }};
  const setTimeout = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, {callback, at: time + Number(delay)});
    return id;
  };
  const clearTimeout = id => timers.delete(id);
  const auth = {
    onAuthStateChange(callback) { authListener = callback; },
    getSession() {
      calls.push('getSession');
      return ++sessionReads === 1 ? first.promise : Promise.resolve(sessionResults.length ? sessionResults.shift() : signedIn);
    },
    async signInWithPassword() { calls.push('signIn'); return {error: {message: 'Synthetic login response'}}; },
    async signUp() { calls.push('signUp'); return {data: {session: null}, error: null}; },
    async resetPasswordForEmail() { calls.push('resetPasswordForEmail'); return linkResult?.promise ?? {error: null}; },
    async resend() { calls.push('resend'); return linkResult?.promise ?? {error: null}; },
    async updateUser() { calls.push('updateUser'); return {error: null}; },
    async signOut() { calls.push('signOut'); return {error: null}; }
  };
  const module = vm.runInNewContext('(async () => {' + source + '\n})()', {
    window, document, location, URL, URLSearchParams, createClient: () => ({auth}),
    setTimeout, clearTimeout, console
  });
  module.catch(error => errors.push(error));
  await flush();
  const node = id => {
    const result = document.getElementById(id);
    assert.ok(result, 'The customer control exists: ' + id);
    return result;
  };
  const fire = async (id, type) => {
    const element = node(id);
    const handlers = [...(listeners.get(element)?.get(type) ?? [])];
    assert.ok(handlers.length, 'The page wires ' + type + ' for ' + id + ' while the first read is pending');
    const event = new window.Event(type, {cancelable: true, bubbles: true});
    Object.defineProperties(event, {target: {value: element}, currentTarget: {value: element}});
    for (const handler of handlers) await handler.call(element, event);
    await flush();
  };
  return {first, node, calls, navigations, errors, timers, location,
    click: id => fire(id, 'click'), submit: id => fire(id, 'submit'),
    async emitAuth(event) { authListener(event, signedIn.data.session); await flush(); },
    async advance(milliseconds) {
      const end = time + milliseconds;
      while (true) {
        const next = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
        await flush();
      }
      time = end;
      await flush();
      assert.deepEqual(errors, []);
    },
    async settle(value = signedOut, rejection = false) {
      if (rejection) first.reject(value); else first.resolve(value);
      await flush();
      assert.deepEqual(errors, []);
    }
  };
}

test('password help is usable before a stalled initial session lookup finishes', async () => {
  const f = await fixture();
  f.node('email').value = email;
  await f.click('forgotButton');
  assert.equal(f.node('forgotView').hidden, false);
  assert.equal(f.node('forgotEmail').value, email);
  await f.submit('forgotForm');
  assert.deepEqual(f.calls, ['getSession', 'resetPasswordForEmail']);
  assert.match(f.node('status').textContent, /Link zum Zurücksetzen/);
  const status = f.node('status').textContent;
  await f.settle(signedIn);
  assert.equal(f.node('status').textContent, status);
  assert.deepEqual(f.navigations, []);
});

for (const late of ['success', 'rejection']) {
  test('a stalled initial lookup times out and ignores its late ' + late, async () => {
    const f = await fixture();
    await f.advance(15000);
    assert.equal(f.node('authSubmit').disabled, false);
    assert.match(f.node('status').textContent, /lange|erreichbar|erneut|geprüft/i);
    f.node('email').value = email;
    f.node('password').value = password;
    await f.submit('authForm');
    assert.equal(f.node('status').textContent, 'Synthetic login response');
    assert.deepEqual(f.calls, ['getSession', 'signIn']);
    await f.settle(late === 'success' ? signedIn : new Error('Synthetic late rejection'), late === 'rejection');
    assert.equal(f.node('status').textContent, 'Synthetic login response');
    assert.equal(f.node('authSubmit').disabled, false);
    assert.deepEqual(f.navigations, []);
    assert.equal(f.timers.size, 0);
  });
}

test('initial lookup settlement cannot unlock or overwrite an in-flight help request', async () => {
  const linkResult = deferred();
  const f = await fixture({linkResult});
  await f.click('confirmationButton');
  f.node('forgotEmail').value = email;
  const request = f.submit('forgotForm');
  await flush();
  const waitingStatus = f.node('status').textContent;
  assert.equal(f.node('sendResetButton').disabled, true);
  await f.emitAuth('SIGNED_OUT');
  assert.equal(f.node('sendResetButton').disabled, true);
  assert.equal(f.node('authSubmit').disabled, true);
  assert.equal(f.node('status').textContent, waitingStatus);
  await f.advance(15000);
  await f.settle(signedIn);
  assert.equal(f.node('status').textContent, waitingStatus);
  assert.equal(f.node('sendResetButton').disabled, true);
  await f.submit('forgotForm');
  assert.deepEqual(f.calls, ['getSession', 'resend']);
  linkResult.resolve({error: null});
  await request;
  assert.equal(f.node('sendResetButton').disabled, false);
  assert.match(f.node('status').textContent, /Falls die Bestätigung/);
  assert.deepEqual(f.navigations, []);
});

test('a recovery lookup timeout preserves the recovery link and typed passwords', async () => {
  const url = 'https://sma.test/app/index.html?type=recovery#type=recovery&access_token=synthetic';
  const f = await fixture({url});
  f.node('newPassword').value = password;
  f.node('confirmPassword').value = password;
  await f.advance(15000);
  assert.equal(f.node('resetView').hidden, false);
  assert.equal(f.location.href, url);
  assert.equal(f.node('newPassword').value, password);
  assert.equal(f.node('confirmPassword').value, password);
  assert.equal(f.node('savePasswordButton').disabled, false);
  const status = f.node('status').textContent;
  assert.match(status, /lange|erneut|geprüft/i);
  await f.emitAuth('PASSWORD_RECOVERY');
  await f.settle(signedIn);
  assert.equal(f.node('status').textContent, status);
  assert.deepEqual(f.calls, ['getSession']);
  assert.deepEqual(f.navigations, []);
});

test('a timely recovery event opens its form and never redirects to the dashboard', async () => {
  const f = await fixture();
  await f.emitAuth('PASSWORD_RECOVERY');
  assert.equal(f.node('resetView').hidden, false);
  await f.settle(signedIn);
  assert.equal(f.node('resetView').hidden, false);
  assert.deepEqual(f.navigations, []);
  assert.deepEqual(f.calls, ['getSession']);
});

test('a delayed recovery event cannot replace explicitly chosen password help', async () => {
  const f = await fixture();
  await f.click('forgotButton');
  f.node('forgotEmail').value = email;
  await f.submit('forgotForm');
  const status = f.node('status').textContent;
  await f.emitAuth('PASSWORD_RECOVERY');
  await f.settle(signedIn);
  assert.equal(f.node('forgotView').hidden, false);
  assert.equal(f.node('forgotEmail').value, email);
  assert.equal(f.node('status').textContent, status);
  assert.deepEqual(f.navigations, []);
  await f.click('backToLoginButton');
  assert.equal(f.node('authSubmit').disabled, false);
  assert.equal(f.node('email').value, email);
});

test('an explicitly expired recovery link cannot be revived by a delayed auth event', async () => {
  const f = await fixture({url: 'https://sma.test/app/index.html?type=recovery&error_code=otp_expired'});
  const status = f.node('status').textContent;
  await f.emitAuth('PASSWORD_RECOVERY');
  await f.settle(signedIn);
  assert.equal(f.node('forgotView').hidden, false);
  assert.equal(f.node('resetView').hidden, true);
  assert.equal(f.node('status').textContent, status);
  assert.deepEqual(f.navigations, []);
});

test('signing out while the first read is pending prevents an obsolete redirect', async () => {
  const f = await fixture();
  await f.emitAuth('SIGNED_OUT');
  assert.equal(f.node('authSubmit').disabled, false);
  await f.settle(signedIn);
  assert.equal(f.node('authSubmit').disabled, false);
  assert.deepEqual(f.navigations, []);
  assert.equal(f.timers.size, 0);
});

test('a timed-out recovery recheck cannot later change the password or sign out', async () => {
  const laterRead = deferred();
  const f = await fixture({url: 'https://sma.test/app/index.html#type=recovery&access_token=synthetic',
    sessionResults: [laterRead.promise]});
  await f.settle(signedIn);
  f.node('newPassword').value = password;
  f.node('confirmPassword').value = password;
  const save = f.submit('resetForm');
  await flush();
  assert.equal(f.node('savePasswordButton').disabled, true);
  await f.advance(15000);
  await save;
  assert.equal(f.node('savePasswordButton').disabled, false);
  assert.equal(f.node('newPassword').value, password);
  assert.equal(f.node('confirmPassword').value, password);
  assert.deepEqual(f.calls, ['getSession', 'getSession']);
  const status = f.node('status').textContent;
  laterRead.resolve(signedIn);
  await flush();
  assert.equal(f.node('status').textContent, status);
  assert.deepEqual(f.calls, ['getSession', 'getSession']);
  assert.deepEqual(f.navigations, []);
  assert.equal(f.timers.size, 0);
});

for (const [query, destination] of [
  ['', 'dashboard.html'],
  ['?kundenmedien=pilot', 'dashboard.html?kundenmedien=pilot'],
  ['?buchung=12345678-1234-1234-1234-123456789abc', 'paketwahl.html?buchung=12345678-1234-1234-1234-123456789abc'],
  ['?buchung=invalid', 'dashboard.html']
]) {
  test('an untouched confirmed session preserves its destination ' + destination, async () => {
    const f = await fixture({url: 'https://sma.test/app/index.html' + query});
    await f.settle(signedIn);
    assert.deepEqual(f.navigations, ['https://sma.test/app/' + destination]);
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.calls, ['getSession']);
  });
}
