// The folder timestamp advances only after a complete Drive scan has committed.
export function watchPortalCatalog({readFolder, available, refresh}) {
  let applied, running = false, timer;
  async function check() {
    if (running || document.hidden || !available()) return;
    const frame = window.frameElement;
    if (frame && !frame.getClientRects().length) return;
    running = true;
    try {
      const folder = await readFolder();
      if (!folder?.verified_at || !available()) return;
      const version = folder.folder + '/' + folder.verified_at;
      if (version === applied) return;
      if (await refresh() !== false) applied = version;
    } catch {
      // A failed read cannot establish deletion. Retry the last unapplied version.
    } finally {
      running = false;
    }
  }
  function resume() {
    clearInterval(timer);
    if (!document.hidden) {
      void check();
      timer = setInterval(check, 30000);
    }
  }
  window.addEventListener('focus', check);
  window.addEventListener('pageshow', resume);
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pagehide', () => clearInterval(timer));
  resume();
}
