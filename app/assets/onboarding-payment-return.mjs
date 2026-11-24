import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const client = createClient('https://bnvnmdxosbnuzedokqgh.supabase.co', 'sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW');
const order = new URLSearchParams(location.search).get('buchung');
const validOrder = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(order);
const status = document.querySelector('#status');
const retry = document.querySelector('#retry');
const navigation = document.querySelector('nav a');
const delays = [3000, 7000, 15000, 30000];
const checkTimeout = 15000;
let owner, timer, activeRead, attempt = 0, pending = validOrder, busy = false, leaving = false;
let pageActive = true, wasAvailable = !document.hidden && navigator.onLine, resumeAfterRead = false;

// One deadline covers both session reads and the status request. Auth reads do
// not accept an AbortSignal, so race every stage and consume late settlements.
function readWithinCheck(signal, start) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', cancel);
      callback(value);
    };
    const cancel = () => finish(reject, Error('Payment status read cancelled'));
    if (signal.aborted) return cancel();
    signal.addEventListener('abort', cancel, {once:true});
    Promise.resolve().then(() => {
      if (signal.aborted) throw Error('Payment status read cancelled');
      return start();
    }).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

function available() {
  return validOrder && !leaving && pageActive && !document.hidden && navigator.onLine;
}

function leave(path) {
  leaving = true;
  pending = false;
  resumeAfterRead = false;
  clearTimeout(timer);
  activeRead?.abort();
  status.textContent = '';
  retry.hidden = true;
  navigation.hidden = true;
  location.replace(path);
}

function waitForUpdate() {
  clearTimeout(timer);
  if (!available() || busy || !pending || attempt >= delays.length) return;
  timer = setTimeout(() => {
    attempt++;
    void check();
  }, delays[attempt]);
}

// A genuine return to an online, visible page gets one fresh bounded read cycle.
// Duplicate browser events cannot reset the budget or start overlapping reads.
function resumeUpdates() {
  const ready = available();
  const returned = ready && !wasAvailable;
  wasAvailable = ready;
  clearTimeout(timer);
  if (!ready || !pending) return;
  if (!returned) return waitForUpdate();
  attempt = 0;
  if (busy) resumeAfterRead = true;
  else void check();
}

async function check() {
  if (busy || !available()) return;
  clearTimeout(timer);
  busy = true;
  status.setAttribute?.('aria-busy','true');
  retry.disabled = true;
  const controller = new AbortController();
  activeRead = controller;
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, checkTimeout);
  const read = start => readWithinCheck(controller.signal, start);
  try {
    const session = await read(() => client.auth.getSession());
    if (session.error) throw session.error;
    const current = session.data?.session?.user?.id;
    if (leaving) return;
    if (!current) return leave('index.html?buchung=' + order);
    if (owner && owner !== current) return leave('index.html');
    owner = current;
    if (!available()) return;
    const {data, error} = await read(() => client.rpc('sma_onboarding_payment_status_v1', {p_order:order}).abortSignal(controller.signal));
    if (leaving) return;
    if (error) throw error;
    // Auth events may arrive after the RPC reply. Recheck before showing its state.
    const latest = await read(() => client.auth.getSession());
    if (leaving) return;
    if (latest.error) throw latest.error;
    const latestOwner = latest.data?.session?.user?.id;
    if (!latestOwner) return leave('index.html?buchung=' + order);
    if (latestOwner !== owner) return leave('index.html');
    if (!available()) return;
    if (data === 'active') return leave('dashboard.html');
    pending = data === 'booked' || data === 'paid' || data === 'renewal_suspended';
    retry.hidden = !pending;
    navigation.href = 'dashboard.html';
    navigation.textContent = 'Dashboard-Zugang prüfen';
    if (data === 'booked') {
      navigation.href = 'paketwahl.html';
      navigation.textContent = 'Zur offenen Buchung';
      status.textContent = 'Wir warten auf die Zahlungsbestätigung von Mollie.';
    } else if (data === 'paid') {
      navigation.href = 'paketwahl.html';
      navigation.textContent = 'Zur bezahlten Buchung';
      status.textContent = 'Deine Zahlung ist bestätigt. Dein Dashboard wird freigeschaltet.';
    } else if (data === 'closed') {
      navigation.href = 'paketwahl.html';
      navigation.textContent = 'Zur Paketwahl';
      status.textContent = 'Diese Zahlung wurde nicht abgeschlossen. Für einen neuen Versuch kannst du dein Paket erneut buchen.';
    } else if (data === 'renewal_suspended') {
      status.textContent = 'Dein Zugang pausiert. Für den aktuellen Abrechnungszeitraum fehlt eine bestätigte Folgezahlung. Sobald Mollie die Zahlung bestätigt, prüft SMA den Zugang erneut.';
    } else if (data === 'reversed') status.textContent = 'Die Zahlung wurde erstattet oder zurückgebucht. Der Zugang aus dieser Buchung ist gesperrt.';
    else status.textContent = 'Diese Buchung ist für dein Konto nicht verfügbar.';
    if (pending) status.textContent += attempt >= delays.length
      ? ' Die automatische Prüfung pausiert. Du kannst den Stand erneut prüfen.'
      : ' Der Zahlungsstand wird automatisch erneut geprüft.';
  } catch {
    if (!leaving) {
      status.textContent = timedOut
        ? 'Die Prüfung dauert zu lange. Bitte prüfe den Zahlungsstand erneut.'
        : 'Der Zahlungsstand konnte gerade nicht geladen werden. Bitte versuche es erneut.';
      if (attempt >= delays.length) status.textContent += ' Die automatische Prüfung pausiert.';
      retry.hidden = false;
      pending = true;
    }
  } finally {
    clearTimeout(deadline);
    if (activeRead === controller) activeRead = null;
    busy = false;
    status.setAttribute?.('aria-busy','false');
    retry.disabled = false;
    const resume = resumeAfterRead && available() && pending;
    resumeAfterRead = false;
    if (resume) void check();
    else waitForUpdate();
  }
}

document.title = 'Zahlungsstand · SMA';
document.querySelector('h1').textContent = 'Dein Zahlungsstand';
document.querySelector('#plan-intro').hidden = true;
retry.textContent = 'Zahlungsstand erneut prüfen';
retry.addEventListener('click', () => {
  if (busy || !available()) return;
  attempt = 0;
  void check();
});
document.addEventListener('visibilitychange', resumeUpdates);
window.addEventListener('online', resumeUpdates);
window.addEventListener('offline', resumeUpdates);
window.addEventListener('pagehide', () => { pageActive = false; resumeUpdates(); });
window.addEventListener('pageshow', event => {
  if (event.persisted) { pageActive = true; resumeUpdates(); }
});

client.auth.onAuthStateChange((event, session) => {
  if (leaving) return;
  if (event === 'SIGNED_OUT') leave(validOrder ? 'index.html?buchung=' + order : 'index.html');
  else if (owner && session?.user?.id !== owner) leave('index.html');
});
document.querySelector('#logout').addEventListener('click', async () => {
  clearTimeout(timer);
  leaving = true;
  activeRead?.abort();
  try {
    const {error} = await client.auth.signOut();
    if (error) throw error;
    location.replace('index.html');
  } catch {
    leaving = false;
    status.textContent = 'Die Abmeldung ist fehlgeschlagen. Bitte versuche es erneut.';
    waitForUpdate();
  }
});

if (validOrder) {
  if (!navigator.onLine) status.textContent = 'Keine Internetverbindung. Der Zahlungsstand wird geprüft, sobald du wieder online bist.';
  await check();
} else status.textContent = 'Dieser Zahlungslink ist ungültig.';
