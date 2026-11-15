import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const client = createClient('https://bnvnmdxosbnuzedokqgh.supabase.co', 'sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW');
const form = document.querySelector('#choice');
const fields = form.querySelector('fieldset');
const submit = form.querySelector('[type=submit]');
const status = document.querySelector('#status');
const retry = document.querySelector('#retry');
const names = {alpha: 'Alpha', beta: 'Beta', delta: 'Delta'};
let owner, saved = null, busy = false, leaving = false;

function leave(page) {
  leaving = true;
  form.hidden = true;
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
  submit.disabled = busy || !selection || selection === saved;
}

async function request(plan = null) {
  if (leaving || busy) return;
  busy = true;
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
    }
  } catch {
    if (leaving) return;
    form.hidden = true;
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
