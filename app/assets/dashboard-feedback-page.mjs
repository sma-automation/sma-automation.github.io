import {mountDashboardFeedback} from './dashboard-feedback.mjs?v=1';
mountDashboardFeedback(document);
const frame = document.getElementById('dashboard');
if (frame?.tagName === 'IFRAME') {
  const mountShell = () => {
    const inner = frame.contentDocument;
    if (inner?.URL === 'about:srcdoc') mountDashboardFeedback(inner);
  };
  frame.addEventListener('load', mountShell);
  mountShell();
}

// The public catalogue also opens as an embedded preview in the dashboard.
const catalogHost = document.getElementById('catalogPreview');
if (catalogHost) {
  const mountCatalog = frame => {
    if (frame?.tagName !== 'IFRAME') return;
    const inner = frame.contentDocument;
    if (inner?.URL && new URL(inner.URL).pathname === '/app/shop-catalog.html') mountDashboardFeedback(inner);
  };
  catalogHost.addEventListener('load', event => mountCatalog(event.target), true);
  for (const frame of catalogHost.querySelectorAll('iframe')) mountCatalog(frame);
}
