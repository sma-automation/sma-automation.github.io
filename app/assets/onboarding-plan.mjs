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
const prices = {alpha:100,beta:300,delta:500};
let offer = null;
let owner, saved = null, busy = false, leaving = false;

function leave(page) {
  leaving = true;
  form.hidden = true;
  booking.hidden = true;
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
  checkout.hidden = true;
  checkout.removeAttribute('href');
  if (!offer) return;
  if (offer.terms !== '2026-11-15-v1' || offer.plan !== saved || !['offered','booked','paid'].includes(offer.state)) throw Error('Offer changed');
  const terms = names[saved] + ' · ' + prices[saved] + ' € pro Monat. Zusätzlich 30 % Provision auf den Monatsumsatz.';
  document.querySelector('#booking-terms').textContent = terms;
  book.hidden = offer.state !== 'offered';
  if (offer.state === 'booked') {
    status.textContent = 'Deine Buchung ist gespeichert. Die Zahlungsbestätigung steht aus.';
    if (offer.checkout) {
      const url = new URL(offer.checkout);
      if (!/^https:\/\/(www|checkout)\.mollie\.com\/checkout\/[A-Za-z0-9/_-]+$/.test(url.href)) throw Error('Invalid checkout');
      checkout.href = url.href;
      checkout.hidden = false;
    }
  } else if (offer.state === 'paid') {
    status.textContent = 'Deine Zahlung ist bestätigt. Der Dashboard-Zugang wird vorbereitet.';
  }
}

async function request(plan = null, selectedOffer = null) {
  if (leaving || busy) return;
  busy = true;
  offer = null;
  fields.disabled = true;
  syncSubmit();
  retry.hidden = true;
  status.textContent = plan ? 'Deine Auswahl wird gespeichert …' : 'Dein Konto wird geprüft …';
  try {
    const {data, error} = await client.auth.getSession();
    if (error) throw error;
    const current = data.session?.user?.id;
    if (!current) return leave('index.html');
    if (owner && current !== owner) return leave('dashboard.html');
    owner = current;
    let changedOffer = false;
    if (selectedOffer) {
      const result = await client.rpc('sma_onboarding_booking_v1', {
        p_owner:owner, p_offer:selectedOffer.id, p_plan:selectedOffer.plan, p_terms:selectedOffer.terms
      });
      if (leaving) return;
      if (result.error || (!result.data?.ok && result.data?.code !== 'OFFER_CHANGED')) throw Error('Booking unavailable');
      changedOffer = result.data?.code === 'OFFER_CHANGED';
    }
    const result = await client.rpc('sma_onboarding_plan_choice_v1', {
      p_owner: owner, p_plan: plan, p_expected_plan: plan ? saved : null
    });
    if (leaving) return;
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
      const current = await client.rpc('sma_onboarding_booking_v1', {p_owner:owner});
      if (leaving) return;
      if (current.error) throw current.error;
      displayOffer(current.data);
    }
    if (changedOffer) status.textContent = 'Dein Zahlungsangebot hat sich geändert. Prüfe den aktuellen Stand.';
  } catch {
    if (leaving) return;
    form.hidden = true;
    offer = null;
    status.textContent = 'Der Stand deiner Vormerkung konnte nicht bestätigt werden. Bitte lade ihn erneut.';
    retry.hidden = false;
  } finally {
    busy = false;
    fields.disabled = false;
    syncSubmit();
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
retry.addEventListener('click', () => request());
document.querySelector('#logout').addEventListener('click', async () => {
  try {
    const {error} = await client.auth.signOut();
    if (error) throw error;
    if (!leaving) leave('index.html');
  } catch {
    status.textContent = 'Die Abmeldung ist fehlgeschlagen. Bitte versuche es erneut.';
  }
});
await request();
