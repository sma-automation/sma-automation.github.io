import {dashboardAction} from './dashboard-feedback.mjs?v=1';
const vienna = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export const viennaMinute = instant => vienna.format(new Date(instant)).replace(' ', 'T');

// A Vienna wall-clock minute has zero, one or two UTC equivalents across DST.
export function viennaInstants(local) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return [];
  const base = Date.parse(local + ':00Z');
  if (!Number.isFinite(base)) return [];
  return [2, 1].map(offset => new Date(base - offset * 3600000))
    .filter(date => viennaMinute(date) === local).map(date => date.toISOString());
}

const errors = {
  DAILY_PLAN_FULL: 'Für diesen Tag sind bereits drei Dateien eingeplant.',
  AUTH_REQUIRED: 'Bitte melde dich erneut im SMA-Dashboard an.',
  FILE_CHANGED: 'Die Datei hat sich geändert. Öffne die aktuelle Dateiversion.',
  ACCESS_INACTIVE: 'Dein SMA-Zugang ist derzeit inaktiv.',
  VERSION_CONFLICT: 'Der Termin wurde inzwischen geändert. Lade den gespeicherten Stand.',
  INVALID_TIME: 'Wähle einen zukünftigen Zeitpunkt in Wiener Zeit.',
};
const orderLabels = {blocked: 'Auftrag blockiert', checking: 'Auftrag wird geprüft',
  approved: 'Freigabe gespeichert', checked: 'Auftragsprüfung abgeschlossen'};

export function mountJointPlan(doc, request, portal='youtube') {
  const el = id => doc.getElementById(id);
  const panel = el('jointPlan'), field = el('jointPlanTime'), status = el('jointPlanStatus');
  const fold = el('jointPlanOccurrence'), save = el('jointPlanSave'), clear = el('jointPlanClear');
  const refresh = el('jointPlanRefresh');
  const sharedPortal = ['youtube','tiktok'].includes(portal);
  const summary = panel.querySelector('summary');
  const sharedTitle = summary.textContent;
  function displayMode(daily) {
    const manual = sharedPortal && !daily;
    summary.textContent = manual ? sharedTitle : 'Tagesplanung für diese Datei';
    el('jointPlanManual').hidden = !manual;
    save.hidden = !manual;
    el('jointPlanDaily').hidden = !daily;
  }
  let subject = null, generation = 0, record = null, busy = false;

  function controls() {
    const choices = viennaInstants(field.value);
    el('jointPlanFold').hidden = choices.length < 2;
    field.disabled = !record || busy;
    fold.disabled = !record || busy;
    save.disabled = !record || busy || !field.value;
    clear.hidden = !record?.desired_at || (record.daily_slot && !record.portal_times?.[portal]) || (!sharedPortal && !record?.daily_slot);
    clear.disabled = busy;
    refresh.disabled = busy;
  }

  function render(data) {
    record = data;
    displayMode(!!data.daily_slot);
    const at = data.portal_times?.[portal];
    el('jointPlanDaily').textContent = at ? 'Datei '+data.daily_slot+' · '+viennaMinute(at).replace('T',' · ')+' Uhr (Wien)' : '';
    const labels = (sharedPortal ? data.channels : []).filter(channel => !data.daily_slot || data.portal_times?.[channel.platform]).map(channel => {
      const name = channel.platform === 'youtube' ? 'YouTube' : 'TikTok';
      return name + ' · ' + (channel.target || 'Zielkonto offen') + ' · ' +
        (orderLabels[channel.order_state] || 'Freigabe offen');
    });
    el('jointPlanChannels').textContent = labels.join('\n');
    field.value = data.desired_at ? viennaMinute(data.desired_at) : '';
    fold.value = data.desired_at ? String(viennaInstants(field.value).indexOf(new Date(data.desired_at).toISOString())) : '';
    status.textContent = data.daily_slot && !at ? 'Die Datei ist für ein anderes Portal eingeplant.' : data.daily_slot ? 'Privater Tagesentwurf. Eine Veröffentlichung erfordert eine eigene Freigabe.' :
      !sharedPortal ? 'Für dieses Portal ist kein Tagesentwurf gespeichert.' :
      data.desired_at ? 'Gemeinsamer Terminentwurf gespeichert.' : 'Noch kein Terminentwurf gespeichert.';
  }

  async function run(action) {
    if (!subject || busy || (action !== 'get' && !record)) return;
    let instant = null;
    if (action === 'save') {
      const choices = viennaInstants(field.value);
      if (!choices.length) { status.textContent = 'Diese Uhrzeit gibt es in Wien an diesem Tag nicht. Wähle eine andere Uhrzeit.'; return; }
      if (choices.length === 2 && !['0','1'].includes(fold.value)) {
        status.textContent = 'Wähle für diese doppelte Uhrzeit Sommerzeit oder Winterzeit.'; return;
      }
      instant = choices.length === 1 ? choices[0] : choices[Number(fold.value)];
      if (Date.parse(instant) <= Date.now()) { status.textContent = errors.INVALID_TIME; return; }
    }
    const ticket = ++generation;
    busy = true;
    controls();
    status.textContent = action === 'get' ? 'Termin wird geladen …' : 'Änderung wird gespeichert …';
    try {
      const data = await request({...subject, p_action: action, p_version: record?.version ?? null,
        p_time: instant, p_local: action === 'save' ? field.value : null});
      if (ticket !== generation) return;
      if (!data?.ok) throw Object.assign(new Error(), {code: data?.code});
      render(data);
    } catch (error) {
      if (ticket !== generation) return;
      record = null;
      status.textContent = errors[error.code] || 'Der gespeicherte Stand ist unklar. Lade den Termin erneut.';
    } finally {
      if (ticket === generation) { busy = false; controls(); }
    }
  }

  panel.addEventListener('toggle', () => { if (panel.open && !record) void run('get'); });
  refresh.addEventListener('click', dashboardAction(() => run('get')));
  save.addEventListener('click', dashboardAction(() => run('save')));
  clear.addEventListener('click', dashboardAction(() => run('clear')));
  field.addEventListener('input', () => { fold.value = ''; controls(); });
  return {select(file, owner) {
    const next = owner && file?.media_kind === 'video' ? {p_owner: owner, p_asset: file.id, p_revision: file.revision} : null;
    if (next && subject && next.p_asset === subject.p_asset && next.p_owner === subject.p_owner && next.p_revision === subject.p_revision) return;
    generation++;
    subject = next; record = null; busy = false;
    displayMode(false); el('jointPlanDaily').textContent = '';
    panel.open = false; panel.hidden = !next; field.value = ''; fold.value = '';
    el('jointPlanChannels').textContent = ''; status.textContent = ''; controls();
  }};
}
