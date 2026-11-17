import {mountMediaEditor} from './media-editor-view.mjs?v=18';
import {getOwnerId,watchOwner,editorPilotAccess,editorRequest,editorMusicLibrary,editorFiles,editorRefreshFiles,editorThumbnail,exportRequest,editorSource,uploadExport} from './media-editor-api.mjs?v=13';

const query = new URLSearchParams(location.search);
const fileLink = new URLSearchParams(location.hash.slice(1));
const pilot = query.get('kundenmedien') === 'pilot';
const status = document.getElementById('status');
const login = document.getElementById('login');
let view, subscription, closed = false;

function clearPilot() {
  delete document.documentElement.dataset.smaCustomerMedia;
}
window.addEventListener('pagehide', () => {
  closed = true;
  clearPilot();
  view?.destroy();
  subscription?.unsubscribe();
});
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });

async function openEditor() {
  const owner = await getOwnerId();
  if (closed) return;
  if (pilot) login.href = './index.html?kundenmedien=pilot&v=291';
  if (!owner) {
    status.textContent = 'Bitte melde dich bei SMA an.';
    login.hidden = false;
    return;
  }
  if (pilot) {
    let access;
    try {
      access = await editorPilotAccess(owner);
    } catch {
      if (closed) return;
      status.textContent = 'Der Pilotzugang konnte gerade nicht geprüft werden.';
      const retry = document.getElementById('retry');
      retry.hidden = false;
      retry.addEventListener('click', () => location.reload(), {once:true});
      return;
    }
    const currentOwner = await getOwnerId();
    if (closed) return;
    if (access?.ok !== true || currentOwner !== owner) {
      status.textContent = 'Der private Kundenmedientest ist für diese Anmeldung nicht verfügbar.';
      return;
    }
    document.documentElement.dataset.smaCustomerMedia = 'pilot';
    document.getElementById('backDashboard').href = './dashboard.html?kundenmedien=pilot';
  }
  const source=(file,signal)=>editorSource(file,signal,owner);
  view = mountMediaEditor({
    doc:document, expectedOwnerId:owner, getOwnerId, musicLibrary:editorMusicLibrary(owner),
    request:(action,input,signal)=>editorRequest(action,input,owner,signal), listFiles:()=>editorFiles(owner),
    refreshMetadata:signal=>editorRefreshFiles(owner,signal), thumbnail:(file,signal)=>editorThumbnail(file,signal,owner),
    source,uuid:()=>crypto.randomUUID(),
    exportDependencies:{
      request:(action,input)=>exportRequest(action,input,owner),
      source,
      upload:(blob,artifact,signal,onProgress)=>uploadExport(blob,artifact,signal,owner,onProgress)
    },
    initialAssetId:fileLink.get('asset') ?? query.get('asset'),
    initialAssetRevision:fileLink.get('revision'),
    initialAssetPortal:fileLink.get('portal')
  });
  function checkOwner(id) {
    if (id !== owner) clearPilot();
    if (!closed) view.invalidateOwner(id);
  }
  subscription = await watchOwner(checkOwner);
  if (closed) subscription.unsubscribe();
  else checkOwner(await getOwnerId());
}
await openEditor();
