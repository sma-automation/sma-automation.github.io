import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const client = createClient('https://bnvnmdxosbnuzedokqgh.supabase.co', 'sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW');
const form = document.querySelector('#choice');
const fields = form.querySelector('fieldset');
const submit = form.querySelector('[type=submit]');
const status = document.querySelector('#status');
const retry = document.querySelector('#retry');
const names = {alpha: 'Alpha', beta: 'Beta', delta: 'Delta'};
const booking = document.querySelector('#booking');
const book = document.querySelector('#book');
const checkout = document.querySelector('#checkout');
const refreshPayment = document.querySelector('#refresh-payment');
const logout = document.querySelector('#logout');
const prices = {alpha:100,beta:300,delta:500};
const missingCheckoutNotice = 'Deine Buchung ist gespeichert. Ein offener Zahlungslink ist derzeit nicht verfügbar.';
const requestTimeout = 45000;
let offer = null;
let owner, activeRequest, activeLogout, saved = null, busy = false, leaving = false, signingOut = false;

// Bound the whole attempt, including APIs that cannot cancel their transport.
// Cancelling a wait does not undo a server write; retries only read its state.
function withinRequest(signal, start) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', cancel);
      callback(value);
    };
    const cancel = () => finish(reject, Error('Package request cancelled'));
    if (signal.aborted) return cancel();
    signal.addEventListener('abort', cancel, {once:true});
    Promise.resolve().then(() => {
      if (signal.aborted) throw Error('Package request cancelled');
      return start();
    }).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

function clearOffer() {
  offer = null;
  booking.hidden = true;
  checkout.hidden = true;
  checkout.removeAttribute('href');
  refreshPayment.hidden = true;
  document.querySelector('#booking-terms').textContent = '';
}

function leave(page) {
  leaving = true;
  activeRequest?.abort();
  activeLogout?.abort();
  form.hidden = true;
  clearOffer();
  retry.hidden = true;
  status.textContent = '';
  syncSubmit();
  location.replace(page);
}

client.auth.onAuthStateChange((event, session) => {
  if (leaving) return;
  if (event === 'SIGNED_OUT') leave('index.html');
  else if (owner && session?.user?.id !== owner) leave('dashboard.html');
});

function syncSubmit() {
  const selection = form.elements.plan.value;
  const locked = offer && offer.state !== 'offered';
  fields.disabled = busy || signingOut || leaving || !!locked;
  submit.disabled = fields.disabled || !selection || selection === saved;
  booking.hidden = leaving || !offer || selection !== saved || offer.plan !== saved;
  book.disabled = busy || signingOut || booking.hidden || offer?.state !== 'offered';
  refreshPayment.disabled = busy || signingOut || leaving;
  retry.disabled = busy || signingOut || leaving;
  logout.disabled = signingOut || leaving;
}

function displayOffer(value) {
  if (!value?.ok) throw Error('Booking unavailable');
  offer = value.offer;
  refreshPayment.hidden = true;
  checkout.hidden = true;
  checkout.removeAttribute('href');
  if (!offer) return;
  if (offer.terms !== '2026-11-15-v1' || offer.plan !== saved || !['offered','booked','paid'].includes(offer.state)) throw Error('Offer changed');
  const terms = names[saved] + ' · ' + prices[saved] + ' € pro Monat. Zusätzlich 30 % Provision auf den Monatsumsatz.';
  document.querySelector('#booking-terms').textContent = terms;
  book.hidden = offer.state !== 'offered';
  if (offer.state === 'booked') {
    refreshPayment.hidden = offer.automated !== true;
    status.textContent = offer.checkout
      ? 'Deine Buchung ist gespeichert. Die Zahlungsbestätigung steht aus.'
      : missingCheckoutNotice + (offer.automated === true
        ? ' Du kannst den Zahlungsstand erneut abrufen.'
        : ' SMA prüft die Bereitstellung.');
    if (offer.checkout) {
      const url = new URL(offer.checkout);
      if (!/^https:\/\/(www|checkout)\.mollie\.com\/checkout\/[A-Za-z0-9/_-]+$/.test(url.href)) throw Error('Invalid checkout');
      checkout.href = url.href;
      checkout.hidden = false;
    }
  } else if (offer.state === 'paid') {
    refreshPayment.hidden = offer.automated !== true;
    status.textContent = 'Deine Zahlung ist bestätigt. Der Dashboard-Zugang wird vorbereitet.';
  }
}

async function request(plan = null, selectedOffer = null, paymentOrder = null) {
  if (leaving || signingOut || busy) return;
  busy = true;
  const controller = new AbortController();
  activeRequest = controller;
  let timedOut = false, bookingConfirmed = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeout);
  const run = start => withinRequest(controller.signal, start);
  const currentRequest = () => !leaving && !signingOut && activeRequest === controller && !controller.signal.aborted;
  // Auth events can arrive after an RPC or payment reply. Recheck the owner
  // before consuming that reply or continuing, within the same deadline.
  const sameOwner = async () => {
    if (!currentRequest()) return false;
    const latest = await run(() => client.auth.getSession());
    if (!currentRequest()) return false;
    if (latest.error) throw latest.error;
    const current = latest.data?.session?.user?.id;
    if (!current) { leave('index.html'); return false; }
    if (current !== owner) { leave('dashboard.html'); return false; }
    return true;
  };
  clearOffer();
  form.hidden = true;
  fields.disabled = true;
  syncSubmit();
  retry.hidden = true;
  status.textContent = plan ? 'Deine Auswahl wird gespeichert …' : 'Dein Konto wird geprüft …';
  try {
    const {data, error} = await run(() => client.auth.getSession());
    if (!currentRequest()) return;
    if (error) throw error;
    const current = data.session?.user?.id;
    if (!current) return leave('index.html');
    if (owner && current !== owner) return leave('dashboard.html');
    owner = current;
    let changedOffer = false, paymentWaiting = false, paymentClosed = false;
    if (selectedOffer) {
      const result = await run(() => client.rpc('sma_onboarding_booking_v1', {
        p_owner:owner, p_offer:selectedOffer.id, p_plan:selectedOffer.plan, p_terms:selectedOffer.terms
      }).abortSignal(controller.signal));
      if (!await sameOwner()) return;
      if (result.error || (!result.data?.ok && result.data?.code !== 'OFFER_CHANGED')) throw Error('Booking unavailable');
      changedOffer = result.data?.code === 'OFFER_CHANGED';
      const confirmed = result.data?.offer;
      bookingConfirmed = !changedOffer && confirmed?.state === 'booked';
      if (bookingConfirmed) status.textContent = 'Deine Buchung ist gespeichert. Der Zahlungsstand wird geprüft …';
      if (!changedOffer && confirmed?.automated === true && confirmed.state === 'booked') paymentOrder = confirmed.id;
    }
    if (paymentOrder) {
      // functions-js 2.4.6 has no invoke AbortSignal option. Ignore late results
      // after the shared deadline without repeating its possible server action.
      const payment = await run(() => client.functions.invoke('sma-package-payment',{body:{order:paymentOrder,owner}}));
      if (!await sameOwner()) return;
      if (payment.data?.code === 'ACTIVE') return leave('dashboard.html');
      paymentWaiting = !!payment.error;
      paymentClosed = payment.data?.code === 'CLOSED';
    }
    const result = await run(() => client.rpc('sma_onboarding_plan_choice_v1', {
      p_owner: owner, p_plan: plan, p_expected_plan: plan ? saved : null
    }).abortSignal(controller.signal));
    if (!await sameOwner()) return;
    if (result.error) throw result.error;
    let value = result.data;
    if (value?.code === 'CONFLICT') {
      // A compare-and-set conflict returns only the newer plan, without the
      // already verified n8n-link flag. One owner-checked read restores the
      // authoritative link state; never repeat the plan write or book/pay.
      const current = await run(() => client.rpc('sma_onboarding_plan_choice_v1', {
        p_owner:owner
      }).abortSignal(controller.signal));
      if (!await sameOwner()) return;
      if (current.error || current.data?.ok !== true) throw Error('Plan unavailable');
      value = {...current.data,code:'CONFLICT'};
    }
    if (value?.code === 'ACCOUNT_UNAVAILABLE') {
      form.hidden = true;
      status.textContent = 'Die Paketvormerkung ist für dieses Konto nicht verfügbar. Prüfe deinen Dashboard-Zugang.';
      return;
    }
    if ((!value?.ok && value?.code !== 'CONFLICT') ||
        (value.plan !== null && !Object.hasOwn(names, value.plan))) throw Error('Invalid response');

    let bookingData = null;
    if (value.linked === true) {
      const current = await run(() => client.rpc('sma_onboarding_booking_v1', {p_owner:owner}).abortSignal(controller.signal));
      if (!await sameOwner()) return;
      if (current.error) throw current.error;
      bookingData = current.data;
    }
    // Commit the verified plan and offer together, without another async gap.
    saved = value.plan;
    for (const input of form.elements.plan) input.checked = input.value === saved;
    form.hidden = false;
    if (value.code === 'CONFLICT') {
      status.textContent = 'Deine Vormerkung wurde zwischenzeitlich geändert. Die aktuelle Auswahl wird angezeigt.';
    } else {
      status.textContent = saved ? names[saved] + ' ist für dein Konto vorgemerkt.' : 'Du hast noch kein Paket vorgemerkt.';
      if (value.linked === true) status.textContent += ' Dein SMA-Kundenkonto ist zugeordnet.';
    }
    if (value.linked === true) displayOffer(bookingData);
    // A reserved plan does not mean the n8n customer account is provisioned.
    // Offer only an explicit, read-only status check: never poll or create a booking.
    if (saved && value.linked !== true) {
      status.textContent += ' Dein SMA-Kundenkonto wird eingerichtet. Du musst noch nichts bezahlen.';
      retry.textContent = 'Kontozuordnung prüfen';
      retry.hidden = false;
    } else retry.textContent = 'Erneut laden';
    if (paymentWaiting && offer?.automated && offer.state === 'booked') status.textContent = offer.checkout
      ? 'Deine Buchung ist gespeichert. Der Zahlungsstand wird geprüft. Du kannst ihn erneut abrufen.'
      : missingCheckoutNotice + ' Die Zahlungsprüfung konnte noch nicht abgeschlossen werden. Bitte rufe den Stand erneut ab.';
    if (paymentClosed && offer?.state === 'offered') status.textContent = 'Die vorherige Zahlung wurde nicht abgeschlossen. Für einen neuen Versuch kannst du das Paket erneut buchen.';
    if (changedOffer) status.textContent = 'Dein Zahlungsangebot hat sich geändert. Prüfe den aktuellen Stand.';
  } catch {
    if (leaving || signingOut || activeRequest !== controller) return;
    form.hidden = true;
    clearOffer();
    status.textContent = bookingConfirmed
      ? 'Deine Buchung ist gespeichert. Der aktuelle Zahlungsstand konnte nicht bestätigt werden. Bitte lade ihn erneut.'
      : timedOut
        ? 'Die Prüfung dauert zu lange. Bitte lade deinen Paket- und Zahlungsstand erneut.'
        : 'Der Stand deiner Vormerkung konnte nicht bestätigt werden. Bitte lade ihn erneut.';
    retry.textContent = 'Erneut laden';
    retry.hidden = false;
  } finally {
    clearTimeout(deadline);
    if (activeRequest === controller) {
      activeRequest = null;
      busy = false;
      fields.disabled = false;
      syncSubmit();
    }
  }
}

form.addEventListener('change', syncSubmit);
form.addEventListener('submit', event => {
  event.preventDefault();
  if (!form.hidden && !submit.disabled) void request(form.elements.plan.value);
});
book.addEventListener('click', () => {
  if (!booking.hidden && !book.disabled && offer?.state === 'offered') void request(null, offer);
});
refreshPayment.addEventListener('click', () => {
  if (!busy && !booking.hidden && offer?.automated && !refreshPayment.hidden) void request(null, null, offer.id);
});
retry.addEventListener('click', () => request());
logout.addEventListener('click', async () => {
  if (leaving || signingOut) return;
  signingOut = true;
  // Stop the old continuation immediately; an accepted server write may still
  // finish, but it must not start a payment call after the customer leaves.
  activeRequest?.abort();
  clearOffer();
  form.hidden = true;
  retry.hidden = true;
  status.textContent = 'Die Abmeldung wird abgeschlossen …';
  syncSubmit();
  const controller = new AbortController();
  activeLogout = controller;
  const deadline = setTimeout(() => controller.abort(), 15000);
  try {
    const {error} = await withinRequest(controller.signal, () => client.auth.signOut());
    if (error) throw error;
    if (!leaving) leave('index.html');
  } catch {
    if (!leaving) {
      status.textContent = 'Die Abmeldung konnte nicht bestätigt werden. Du kannst sie erneut versuchen oder deinen Kontostand neu laden.';
      retry.textContent = 'Erneut laden';
      retry.hidden = false;
    }
  } finally {
    clearTimeout(deadline);
    if (activeLogout === controller) activeLogout = null;
    signingOut = false;
    syncSubmit();
  }
});
await request();
