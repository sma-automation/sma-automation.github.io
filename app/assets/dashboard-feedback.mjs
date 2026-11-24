// A document may be mounted by the dashboard shell or by its own page module.
const controllerKey = Symbol.for('sma.dashboard.action-feedback');
const wrappers = new WeakMap();
const controls = 'button,a[href],summary,input[type=button],input[type=submit],input[type=reset],input[type=file],[role=button],[role=tab],[role=menuitem],[role=option],[onclick]';

function sourceOf(event) {
  if (!event?.target) return null;
  if (event.type === 'submit') {
    return event.submitter || event.target.querySelector?.('button:not([type]),[type=submit]') || event.target;
  }
  if (event.type === 'change') return event.target;
  return event.target?.closest?.(controls) || event.currentTarget;
}

// Preserve listener identity for removeEventListener, the receiver, return value,
// user activation (e.g. file pickers) and synchronous preventDefault calls.
export function dashboardAction(handler) {
  if (wrappers.has(handler)) return wrappers.get(handler);
  function listener(event) {
    const control = sourceOf(event);
    const feedback = control?.ownerDocument?.[controllerKey];
    if (!feedback) return handler.apply(this, arguments);
    return feedback.run(event, control, () => handler.apply(this, arguments));
  }
  wrappers.set(handler, listener);
  wrappers.set(listener,listener);
  return listener;
}

export function mountDashboardFeedback(doc) {
  if (!doc?.body || doc[controllerKey]) return;
  const win = doc.defaultView;
  const sheet = doc.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = new URL('./dashboard-feedback.css?v=1', import.meta.url).href;
  doc.head.append(sheet);
  const notice = doc.createElement('div');
  notice.className = 'sma-action-feedback';
  notice.setAttribute('role','status');
  notice.setAttribute('aria-live','polite');
  notice.setAttribute('aria-atomic','true');
  doc.body.append(notice);
  const pending = new Map();
  const forms = new Map();
  const busyRegions = new Set(doc.querySelectorAll('[aria-busy="true"]'));
  let acknowledged, timer, frame;

  function identity(control) {
    return control.dataset?.smaActionKey || (control.id ? '#' + control.id : control);
  }
  function resetPulse() {
    win.clearTimeout(timer);
    acknowledged?.removeAttribute('data-sma-acknowledged');
    acknowledged = null;
    notice.removeAttribute('data-acknowledged');
  }
  function capture(event) {
    const el = sourceOf(event);
    if (!el?.matches?.(controls+',form,input,select,textarea') || event.defaultPrevented) return;
    const form = event.type === 'submit' ? event.target : el.type === 'submit' ? el.form : null;
    if ((event.type === 'click' || event.type === 'submit') &&
        (pending.has(identity(el)) || forms.has(form))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (el.matches(':disabled,[aria-disabled=true]')) return;
    // The server-rendered dashboard also uses native onsubmit/onclick handlers.
    // Keep them on the original element so default actions and bubbling are preserved.
    for (const node of event.composedPath()) {
      if (node === doc) break;
      const property = 'on' + event.type;
      if (typeof node[property] === 'function') node[property] = dashboardAction(node[property]);
    }
    resetPulse();
    acknowledged = el;
    el.setAttribute('data-sma-acknowledged','');
    notice.setAttribute('data-acknowledged','');
    timer = win.setTimeout(resetPulse,240);
  }
  function paint() {
    const busy = pending.size > 0 || [...busyRegions].some(el =>
      el.isConnected && el.getClientRects().length && !el.closest('[hidden],[aria-hidden="true"]'));
    notice.toggleAttribute('data-working',busy);
    const english = (doc.documentElement.lang || '').toLowerCase().startsWith('en');
    const label = busy ? (english ? 'Working…' : 'Wird bearbeitet …') : '';
    if (notice.textContent !== label) notice.textContent = label;
  }
  function release(key,entry) {
    if (pending.get(key) !== entry) return;
    pending.delete(key);
    if (![...pending.values()].some(other=>other.control===entry.control)) entry.control.removeAttribute('data-sma-working');
    if (entry.form && forms.get(entry.form) === entry) forms.delete(entry.form);
    paint();
  }
  function run(event,control,invoke) {
    // A new choice in a select/file field may supersede an earlier read.
    // Its lifecycle is independent of the first and the selected value must propagate.
    if (event.type==='change') return track(Symbol(),control,null,event,invoke);
    const key = identity(control);
    const form = event.type === 'submit' ? event.target : null;
    const existing = pending.get(key) || forms.get(form);
    if (existing) {
      if (existing.event === event) return invoke();
      event.preventDefault();
      return;
    }
    return track(key,control,form,event,invoke);
  }
  function track(key,control,form,event,invoke) {
    const result = invoke();
    if (!result || typeof result.then !== 'function') return result;
    const entry = {event,control,form};
    pending.set(key,entry);
    if (form) forms.set(form,entry);
    control.setAttribute('data-sma-working','');
    paint();
    return Promise.resolve(result).finally(() => release(key,entry));
  }
  function schedulePaint() {
    if (frame != null) return;
    frame = win.requestAnimationFrame(() => {frame=null;paint();});
  }
  const observer = new win.MutationObserver(records => {
    let changed=false;
    for (const r of records) {
      if (r.target===notice) continue;
      if (r.attributeName==='aria-busy') {
        if (r.target.getAttribute('aria-busy')==='true') busyRegions.add(r.target);
        else busyRegions.delete(r.target);
        changed=true;
      } else {
        for (const node of r.addedNodes || []) {
          if (node.nodeType !== 1) continue;
          if (node.matches('[aria-busy="true"]')) busyRegions.add(node);
          for (const el of node.querySelectorAll('[aria-busy="true"]')) busyRegions.add(el);
        }
        if (busyRegions.size) changed=true;
      }
    }
    if (changed) {
      for (const el of busyRegions) if (!el.isConnected) busyRegions.delete(el);
      schedulePaint();
    }
  });
  function reset() {
    resetPulse();
    for (const [key,entry] of pending) release(key,entry);
  }
  doc[controllerKey] = {run};
  observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-busy','hidden','class','aria-hidden','open','style']});
  for (const type of ['click','submit','change']) doc.addEventListener(type,capture,true);
  win.addEventListener('pagehide',event => event.persisted ? resetPulse() : reset());
  win.addEventListener('pageshow',schedulePaint);
  schedulePaint();
}
