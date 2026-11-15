const base = 'https://johnmusic.app.n8n.cloud/webhook/';
const routes = {
  catalog: ['sma-publication-files-v1', 'sma-kundenmedien-katalog-pilot-v1'],
  thumbnail: ['sma-publication-asset-preview-v1', 'sma-kundenmedien-vorschaubild-pilot-v1'],
  original: ['sma-publication-editor-source-v1', 'sma-kundenmedien-original-pilot-v1'],
};

// Nested previews share the dashboard's verified selection for this tab only.
export function customerMediaEndpoint(route) {
  let pilot = false;
  try {
    pilot = globalThis.window?.top.document.documentElement.dataset.smaCustomerMedia === 'pilot';
  } catch { /* A separately embedded view uses the standard routes. */ }
  return base + routes[route][pilot ? 1 : 0];
}
