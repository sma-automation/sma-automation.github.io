const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {parseHTML} = require('./dom-runtime/node_modules/linkedom');

const html = fs.readFileSync('app/index.html', 'utf8');
const moduleSource = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/import\s*\{\s*createClient\s*\}\s*from\s*'[^']+';/, '');
const password = 'NeuesBeispiel2026!';
const email = 'recovery@example.invalid';
const session = {data: {session: {user: {id: 'synthetic-recovery-account', email}}}, error: null};
const noSession = {data: {session: null}, error: null};
const temporary = {message: 'Synthetic temporary failure', status: 503, code: 'temporarily_unavailable'};

// Linkedom's dispatchEvent does not await async handlers. Capture the real
// listeners so an unhandled rejection fails its own test, rather than escaping.
const handlers = new WeakMap();
const {window: eventWindow} = parseHTML('<html></html>');
const nativeAdd = eventWindow.EventTarget.prototype.addEventListener;
const nativeRemove = eventWindow.EventTarget.prototype.removeEventListener;
eventWindow.EventTarget.prototype.addEventListener = function(type, listener, options) {
  let events = handlers.get(this);
  if (!events) handlers.set(this, events = new Map());
  let listeners = events.get(type);
  if (!listeners) events.set(type, listeners = new Set());
  listeners.add(listener);
  return nativeAdd.call(this, type, listener, options);
};
eventWindow.EventTarget.prototype.removeEventListener = function(type, listener, options) {
  handlers.get(this)?.get(type)?.delete(listener);
  return nativeRemove.call(this, type, listener, options);
};

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

async function fixture({url = 'https://sma.test/app/index.html#type=recovery&access_token=synthetic',
  sessions = [], updates = [], signouts = []} = {}) {
  const {window, document} = parseHTML(html);
  const calls = [];
  const navigations = [];
  const location = new URL(url);
  location.replace = destination => navigations.push(new URL(destination, location.href).href);
  window.location = location;
  window.history = {replaceState(_state, _title, destination) {
    location.href = new URL(destination, location.href).href;
  }};
  let authListener;
  const answer = async (name, queue, fallback, args) => {
    calls.push({name, args: args === undefined ? undefined : JSON.parse(JSON.stringify(args))});
    const result = queue.length ? queue.shift() : fallback;
    if (result instanceof Error) throw result;
    return typeof result === 'function' ? result(args) : result;
  };
  const auth = {
    onAuthStateChange(listener) { authListener = listener; },
    getSession: () => answer('getSession', sessions, session),
    updateUser: args => answer('updateUser', updates, {data: {user: session.data.session.user}, error: null}, args),
    signOut: () => answer('signOut', signouts, {error: null}),
    resetPasswordForEmail: (address, options) => answer('resetPasswordForEmail', [], {error: null}, {address, options}),
    signInWithPassword: args => answer('signInWithPassword', [], {error: {message: 'Synthetic login response'}}, args)
  };
  await vm.runInNewContext('(async () => {' + moduleSource + '\n})()', {
    window, document, location, URL, URLSearchParams, createClient: () => ({auth}),
    setTimeout, clearTimeout, console
  });
  const node = id => {
    const found = document.getElementById(id);
    assert.ok(found, 'Expected existing customer control: ' + id);
    return found;
  };
  const visible = element => {
    for (let current = element; current; current = current.parentElement) {
      if (current.hidden || current.getAttribute?.('aria-hidden') === 'true') return false;
    }
    return true;
  };
  const fire = async (element, type) => {
    const event = new window.Event(type, {cancelable: true, bubbles: true});
    Object.defineProperties(event, {target: {value: element}, currentTarget: {value: element}});
    const listeners = [...(handlers.get(element)?.get(type) ?? [])];
    assert.ok(listeners.length, 'The actual page must wire ' + type + ' for ' + element.id);
    for (const listener of listeners) {
      await (typeof listener === 'function' ? listener.call(element, event) : listener.handleEvent(event));
    }
  };
  return {window, document, location, calls, navigations, node, visible,
    count: name => calls.filter(call => call.name === name).length,
    submit: id => fire(node(id), 'submit'),
    click: element => fire(element, 'click'),
    emitAuth: event => authListener(event, session.data.session),
    fill(first = password, second = first) {
      node('newPassword').value = first;
      node('confirmPassword').value = second;
    },
    button(label) {
      const found = [...document.querySelectorAll('button')].find(button =>
        visible(button) && button.textContent.trim().replace(/\s+/g, ' ') === label);
      assert.ok(found, 'Expected visible action: ' + label);
      return found;
    }
  };
}

function assertRetryable(f) {
  assert.equal(f.visible(f.node('resetForm')), true);
  assert.equal(f.node('savePasswordButton').disabled, false);
  assert.equal(f.node('newPassword').value, password);
  assert.equal(f.node('confirmPassword').value, password);
  assert.ok(f.node('status').textContent.trim());
  assert.equal(f.node('status').classList.contains('success'), false);
  assert.equal(f.count('signOut'), 0);
  assert.deepEqual(f.navigations, []);
}

async function requestAnotherLink(f) {
  assert.equal(f.visible(f.node('forgotForm')), true);
  assert.equal(f.visible(f.node('resetForm')), false);
  f.node('forgotEmail').value = email;
  await f.submit('forgotForm');
  const requests = f.calls.filter(call => call.name === 'resetPasswordForEmail');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].args.address, email);
  assert.equal(f.node('sendResetButton').disabled, false);
}

test('a failed initial session lookup leaves the existing login form usable', async () => {
  const f = await fixture({url: 'https://sma.test/app/index.html', sessions: [new Error('Synthetic lookup failure')]});
  assert.equal(f.visible(f.node('authForm')), true);
  assert.equal(f.node('authSubmit').disabled, false);
  f.node('email').value = email;
  f.node('password').value = password;
  await f.submit('authForm');
  assert.equal(f.count('signInWithPassword'), 1);
  assert.equal(f.node('authSubmit').disabled, false);
  assert.deepEqual(f.navigations, []);
});

test('a recovery session that expires before saving offers a new link without updating the password', async () => {
  const f = await fixture({sessions: [session, noSession]});
  f.fill();
  await f.submit('resetForm');
  assert.equal(f.count('updateUser'), 0);
  await requestAnotherLink(f);
  assert.equal(f.count('updateUser'), 0);
});

for (const [label, response] of [
  ['throw', new Error('Synthetic lookup interruption')],
  ['temporary error', {data: {session: null}, error: temporary}]
]) {
  test('a recovery session lookup ' + label + ' preserves the entered password and permits a retry', async () => {
    const f = await fixture({sessions: [session, response]});
    f.fill();
    await f.submit('resetForm');
    assertRetryable(f);
    assert.equal(f.count('updateUser'), 0);
    await f.submit('resetForm');
    assert.equal(f.count('updateUser'), 1);
    assert.equal(f.visible(f.node('authForm')), true);
  });
}

for (const [label, response] of [
  ['throw', new Error('Synthetic update interruption')],
  ['temporary error', {error: temporary}],
  ['returned network error', {error: {name: 'AuthRetryableFetchError', status: 0,
    message: 'Synthetic lost update response'}}]
]) {
  test('a password update ' + label + ' keeps the customer input and does not claim success', async () => {
    const f = await fixture({updates: [response]});
    f.fill();
    await f.submit('resetForm');
    assertRetryable(f);
    assert.match(f.node('status').textContent, /nicht bestätigt/i,
      'A missing update confirmation must not claim that the password definitely stayed unchanged');
    assert.equal(f.count('updateUser'), 1);
    await f.submit('resetForm');
    assert.equal(f.count('updateUser'), 2);
    assert.equal(f.visible(f.node('authForm')), true);
  });
}

test('duplicate submit events during a delayed password update create exactly one update', async () => {
  const entered = deferred();
  const release = deferred();
  const f = await fixture({updates: [() => { entered.resolve(); return release.promise; }]});
  f.fill();
  const first = f.submit('resetForm');
  await entered.promise;
  const second = f.submit('resetForm');
  try {
    await second;
    assert.equal(f.count('updateUser'), 1);
    assert.equal(f.node('savePasswordButton').disabled, true);
  } finally {
    release.resolve({error: null});
    await Promise.all([first, second]);
  }
  assert.equal(f.count('updateUser'), 1);
  assert.equal(f.count('signOut'), 1);
});

for (const [label, response] of [
  ['throws', new Error('Synthetic signout interruption')],
  ['returns an error', {error: temporary}]
]) {
  test('a confirmed password update survives signout that ' + label + ' and retries only signout', async () => {
    const f = await fixture({signouts: [response]});
    f.fill();
    await f.submit('resetForm');
    assert.equal(f.count('updateUser'), 1);
    assert.equal(f.count('signOut'), 1);
    assert.equal(f.visible(f.node('authForm')), false);
    assert.match(f.node('status').textContent, /Passwort/i);
    assert.match(f.node('status').textContent, /geändert|gespeichert|aktualisiert/i);
    for (const id of ['newPassword', 'confirmPassword', 'password']) assert.equal(f.node(id).value, '');
    assert.ok(f.location.hash.includes('type=recovery'));
    const confirmedStatus = f.node('status').textContent;
    await f.emitAuth('PASSWORD_RECOVERY');
    assert.equal(f.node('status').textContent, confirmedStatus);
    const retry = f.button('Abmeldung erneut versuchen');
    assert.equal(retry.disabled, false);
    const requiredEmpty = [...f.document.querySelectorAll('input[required]')]
      .filter(input => f.visible(input) && !input.disabled && !input.value);
    assert.equal(requiredEmpty.length, 0, 'Cleared password fields must not block the signout retry');
    const sessionReads = f.count('getSession');
    if (retry.type === 'submit' || retry.getAttribute('type') === 'submit') await f.submit('resetForm');
    else await f.click(retry);
    assert.equal(f.count('signOut'), 2);
    assert.equal(f.count('getSession'), sessionReads);
    assert.equal(f.count('updateUser'), 1);
    assert.equal(f.visible(f.node('authForm')), true);
    assert.equal(f.location.hash, '');
    assert.notEqual(f.location.searchParams.get('type'), 'recovery');
    assert.deepEqual(f.navigations, []);
  });
}

for (const code of ['session_expired', 'session_not_found']) {
  test('a password update with ' + code + ' returns to the existing new-link form', async () => {
    const f = await fixture({updates: [{error: {code, message: 'Synthetic expired session'}}]});
    f.fill();
    await f.submit('resetForm');
    assert.equal(f.count('updateUser'), 1);
    assert.equal(f.count('signOut'), 0);
    await requestAnotherLink(f);
    assert.equal(f.count('updateUser'), 1);
  });
}

test('invalid or rejected passwords remain editable and cannot trigger signout', async () => {
  const f = await fixture({updates: [{error: {code: 'same_password',
    message: 'Synthetic identical password rejection'}}]});
  for (const [first, second] of [['kurz', 'kurz'], [password, password + 'anders']]) {
    f.fill(first, second);
    await f.submit('resetForm');
    assert.equal(f.count('updateUser'), 0);
    assert.equal(f.count('signOut'), 0);
    assert.equal(f.node('savePasswordButton').disabled, false);
    assert.ok(f.node('status').textContent.trim());
  }
  f.fill();
  await f.submit('resetForm');
  assert.equal(f.count('updateUser'), 1);
  assertRetryable(f);
  await f.submit('resetForm');
  assert.equal(f.count('updateUser'), 2);
  assert.equal(f.count('signOut'), 1);
  assert.equal(f.visible(f.node('authForm')), true);
});
