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
const prices = {alpha:100,beta:300,delta:500};
const requestTimeout = 45000;
let offer = null;
let owner, activeRequest, saved = null, busy = false, leaving = false;

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

function leave(page) {
  leaving = true;
  activeRequest?.abort();
  form.hidden = true;
  booking.hidden = true;
  retry.hidden = true;
  status.textContent = '';
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
  fields.disabled = busy || !!locked;
  submit.disabled = fields.disabled || !selection || selection === saved;
  booking.hidden = leaving || !offer || selection !== saved || offer.plan !== saved;
  book.disabled = busy || booking.hidden || offer?.state !== 'offered';
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
    status.textContent = 'Deine Buchung ist gespeichert. Die Zahlungsbestätigung steht aus.';
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
  if (leaving || busy) return;
  busy = true;
  const controller = new AbortController();
  activeRequest = controller;
  let timedOut = false, bookingConfirmed = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeout);
  const run = start => withinRequest(controller.signal, start);
  const currentRequest = () => !leaving && activeRequest === controller && !controller.signal.aborted;
  offer = null;
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
      if (!currentRequest()) return;
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
      if (!currentRequest()) return;
      if (payment.data?.code === 'ACTIVE') return leave('dashboard.html');
      paymentWaiting = !!payment.error;
      paymentClosed = payment.data?.code === 'CLOSED';
    }
    const result = await run(() => client.rpc('sma_onboarding_plan_choice_v1', {
      p_owner: owner, p_plan: plan, p_expected_plan: plan ? saved : null
    }).abortSignal(controller.signal));
    if (!currentRequest()) return;
    if (result.error) throw result.error;
    const value = result.data;
    if (value?.code === 'ACCOUNT_UNAVAILABLE') {
      form.hidden = true;
      status.textContent = 'Die Paketvormerkung ist für dieses Konto nicht verfügbar. Prüfe deinen Dashboard-Zugang.';
      return;
    }
    if ((!value?.ok && value?.code !== 'CONFLICT') ||
        (value.plan !== null && !Object.hasOwn(names, value.plan))) throw Error('Invalid response');

    saved = value.plan;
    for (const input of form.elements.plan) input.checked = input.value === saved;
    form.hidden = false;
    if (value.code === 'CONFLICT') {
      status.textContent = 'Deine Vormerkung wurde zwischenzeitlich geändert. Die aktuelle Auswahl wird angezeigt.';
    } else {
      status.textContent = saved ? names[saved] + ' ist für dein Konto vorgemerkt.' : 'Du hast noch kein Paket vorgemerkt.';
      if (value.linked === true) status.textContent += ' Dein SMA-Kundenkonto ist zugeordnet.';
    }
    if (value.linked === true) {
      const current = await run(() => client.rpc('sma_onboarding_booking_v1', {p_owner:owner}).abortSignal(controller.signal));
      if (!currentRequest()) return;
      if (current.error) throw current.error;
      displayOffer(current.data);
    }
    if (paymentWaiting && offer?.automated && offer.state === 'booked') status.textContent = 'Deine Buchung ist gespeichert. Der Zahlungsstand wird geprüft. Du kannst ihn erneut abrufen.';
    if (paymentClosed && offer?.state === 'offered') status.textContent = 'Die vorherige Zahlung wurde nicht abgeschlossen. Für einen neuen Versuch kannst du das Paket erneut buchen.';
    if (changedOffer) status.textContent = 'Dein Zahlungsangebot hat sich geändert. Prüfe den aktuellen Stand.';
  } catch {
    if (leaving || activeRequest !== controller) return;
    form.hidden = true;
    offer = null;
    status.textContent = bookingConfirmed
      ? 'Deine Buchung ist gespeichert. Der aktuelle Zahlungsstand konnte nicht bestätigt werden. Bitte lade ihn erneut.'
      : timedOut
        ? 'Die Prüfung dauert zu lange. Bitte lade deinen Paket- und Zahlungsstand erneut.'
        : 'Der Stand deiner Vormerkung konnte nicht bestätigt werden. Bitte lade ihn erneut.';
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
document.querySelector('#logout').addEventListener('click', async () => {
  try {
    const {error} = await client.auth.signOut();
    if (error) throw error;
    if (!leaving) leave('index.html');
  } catch {
    if (!leaving) status.textContent = 'Die Abmeldung ist fehlgeschlagen. Bitte versuche es erneut.';
  }
});
await request();
