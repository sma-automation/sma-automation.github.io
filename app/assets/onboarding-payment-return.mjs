import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const client = createClient('https://bnvnmdxosbnuzedokqgh.supabase.co', 'sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW');
const order = new URLSearchParams(location.search).get('buchung');
const validOrder = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(order);
const status = document.querySelector('#status');
const retry = document.querySelector('#retry');
const navigation = document.querySelector('nav a');
const delays = [3000, 7000, 15000, 30000];
let owner, timer, attempt = 0, pending = false, busy = false, leaving = false;

function leave(path) {
  leaving = true;
  clearTimeout(timer);
  location.replace(path);
}

function waitForUpdate() {
  clearTimeout(timer);
  if (leaving || busy || !pending || document.hidden || !navigator.onLine || attempt >= delays.length) return;
  timer = setTimeout(() => {
    attempt++;
    void check();
  }, delays[attempt]);
}

async function check() {
  if (busy || leaving) return;
  clearTimeout(timer);
  busy = true;
  retry.disabled = true;
  try {
    const session = await client.auth.getSession();
    if (session.error) throw session.error;
    const current = session.data?.session?.user?.id;
    if (leaving) return;
    if (!current) return leave('index.html?buchung=' + order);
    if (owner && owner !== current) return leave('index.html');
    owner = current;
    const {data, error} = await client.rpc('sma_onboarding_payment_status_v1', {p_order:order});
    if (leaving) return;
    if (error) throw error;
    if (data === 'active') return leave('dashboard.html');
    pending = data === 'booked' || data === 'paid';
    retry.hidden = !pending;
    navigation.href = 'dashboard.html';
    navigation.textContent = 'Dashboard-Zugang prüfen';
    if (data === 'booked') {
      navigation.href = 'paketwahl.html';
      navigation.textContent = 'Zur offenen Buchung';
      status.textContent = 'Wir warten auf die Zahlungsbestätigung von Mollie.';
    } else if (data === 'paid') status.textContent = 'Deine Zahlung ist bestätigt. Dein Dashboard wird freigeschaltet.';
    else if (data === 'closed') {
      navigation.href = 'paketwahl.html';
      navigation.textContent = 'Zur Paketwahl';
      status.textContent = 'Diese Zahlung wurde nicht abgeschlossen. Für einen neuen Versuch kannst du dein Paket erneut buchen.';
    } else if (data === 'reversed') status.textContent = 'Die Zahlung wurde erstattet oder zurückgebucht. Der Zugang aus dieser Buchung ist gesperrt.';
    else status.textContent = 'Diese Buchung ist für dein Konto nicht verfügbar.';
    if (pending && attempt >= delays.length) status.textContent += ' Du kannst den Stand erneut prüfen.';
  } catch {
    if (!leaving) {
      status.textContent = 'Der Zahlungsstand konnte gerade nicht geladen werden. Bitte versuche es erneut.';
      retry.hidden = false;
      pending = true;
    }
  } finally {
    busy = false;
    retry.disabled = false;
    waitForUpdate();
  }
}

document.title = 'Zahlungsstand · SMA';
document.querySelector('h1').textContent = 'Dein Zahlungsstand';
document.querySelector('#plan-intro').hidden = true;
retry.textContent = 'Zahlungsstand erneut prüfen';
retry.addEventListener('click', () => { attempt = 0; void check(); });
document.addEventListener('visibilitychange', waitForUpdate);
window.addEventListener('online', waitForUpdate);
window.addEventListener('offline', () => clearTimeout(timer));
window.addEventListener('pagehide', () => clearTimeout(timer));
window.addEventListener('pageshow', event => { if (event.persisted) waitForUpdate(); });

client.auth.onAuthStateChange((event, session) => {
  if (leaving) return;
  if (event === 'SIGNED_OUT') leave(validOrder ? 'index.html?buchung=' + order : 'index.html');
  else if (owner && session?.user?.id !== owner) leave('index.html');
});
document.querySelector('#logout').addEventListener('click', async () => {
  clearTimeout(timer);
  leaving = true;
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

if (validOrder) await check();
else status.textContent = 'Dieser Zahlungslink ist ungültig.';
