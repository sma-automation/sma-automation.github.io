const {resolve} = require('node:path');

// Serve the dashboard's shared UI locally in browser tests with strict service allowlists.
module.exports = function dashboardFeedbackAsset(request, url, origin) {
  if (request.method() !== 'GET' || url.origin !== origin ||
      !/^\/app\/assets\/dashboard-feedback(?:\.css|(?:-page)?\.mjs)$/.test(url.pathname)) return null;
  return {
    path: resolve(__dirname, '../..', '.' + url.pathname),
    contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript'
  };
};
