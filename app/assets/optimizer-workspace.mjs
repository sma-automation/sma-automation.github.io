// Move the existing controls without recreating forms or losing their state.
export function createOptimizerWorkspace(doc, portalName, onGallery) {
  const $ = id => doc.getElementById(id);
  const main = doc.querySelector('main');
  const make = (tag, id, label) => {
    const node = doc.createElement(tag);
    if (id) node.id = id;
    if (label) node.textContent = label;
    return node;
  };
  doc.body.classList.add('wide');
  const toolbar = make('nav', 'optimizerToolbar');
  toolbar.setAttribute('aria-label', 'Optimierung');
  const files = make('section', 'workspaceFiles');
  files.setAttribute('aria-label', 'Bild- und Videogalerie');
  const media = make('section', 'workspaceMedia');
  media.setAttribute('aria-label', 'Medienprüfung');
  const source = make('div', 'workspaceSource');
  const text = make('div', 'workspaceText');
  const examples = $('exampleFiles');
  const panels = { files, folder: files, media, examples, source, text };
  // Keep moved controls connected so getElementById and their existing handlers still work.
  main.append(toolbar, files, media, examples, source, text);
  const buttons = {};
  let active = 'files';
  function tab(key, label) {
    const button = make('button', 'workspaceTab-' + key, label);
    button.type = 'button';
    button.setAttribute('aria-controls', panels[key].id);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => show(key));
    buttons[key] = button;
    return button;
  }
  toolbar.append(tab('files', 'Datei für dieses Portal'), $('deviceBrowse'), $('browseFiles'), $('refreshFiles'),
    tab('media', 'Medienprüfung'), tab('examples', 'Vorschau-Beispieldateien'), tab('source', 'Inhalt und Ziel'), tab('text', 'Text für ' + portalName));
  $('refreshFiles').classList.add('toolbar-action');
  buttons.folder = $('browseFiles');
  buttons.folder.removeAttribute('aria-haspopup');
  buttons.folder.setAttribute('aria-controls', files.id);

  // The customer folder becomes the page's gallery; the narrow dialog is unused here.
  const pickerBody = $('filePicker').querySelector('.file-picker-body');
  files.append(pickerBody);
  $('filePicker').hidden = true;
  $('filePickerHelp').hidden = true;
  $('pickerRefresh').parentElement.hidden = true;
  $('chooseGeneralTemplate').parentElement.hidden = true;
  const search = make('div', 'workspaceSearch');
  const searchControls = make('div'); searchControls.className = 'search-controls';
  const searchButton = make('button', 'workspaceSearchButton', 'Suchen');
  searchButton.type = 'button'; searchButton.className = 'secondary';
  searchButton.addEventListener('click', () => { onGallery(); $('fileSearch').focus(); });
  searchControls.append($('fileSearch'), searchButton);
  search.append(doc.querySelector('label[for="fileSearch"]'), searchControls);
  pickerBody.prepend(search, $('fileSwitchNotice'));
  const selectedPreview = make('details', 'workspaceSelectedPreview');
  selectedPreview.hidden = true;
  selectedPreview.append(make('summary', null, 'Ausgewählte Datei ansehen'), $('assetPreview'), $('fileDetails'));
  media.append(selectedPreview, $('mediaPanel'));
  const evidence = make('details', 'workspaceMagicEvidence');
  evidence.append(make('summary', null, 'Erkennung ansehen'), $('magicPanel'));
  source.append($('magicActionsSource'), evidence, $('sourcePanel'));
  $('magicActionsSource').hidden = false;
  $('magicActionsText').hidden = false;
  const empty = make('div', 'workspaceTextEmpty');
  empty.append(make('p', null, 'Noch kein Beitragstext vorbereitet.'));
  const start = make('button', null, 'Inhalt und Ziel öffnen');
  start.type = 'button'; start.className = 'secondary';
  start.addEventListener('click', () => show('source'));
  empty.append(start);
  text.append($('magicActionsText'), $('portalNote'), empty, $('result'));
  const statusRow = make('div', 'workspaceStatus');
  statusRow.append($('portalStatus'));
  const viewText = make('button', 'workspaceViewText', 'Text ansehen');
  viewText.type = 'button'; viewText.className = 'secondary';
  viewText.addEventListener('click', () => show('text'));
  viewText.hidden = true; statusRow.append(viewText);
  $('assetPanel').hidden = true;
  $('resultFileActions').hidden = true;
  main.append(toolbar, $('uploadPanel'), statusRow, $('magicReplaceNotice'), files, media, examples, source, text);

  function show(key) {
    if (!Object.hasOwn(panels, key)) return;
    const changed = active !== key;
    active = key;
    for (const panel of new Set(Object.values(panels))) panel.hidden = panel !== panels[key];
    for (const [name, button] of Object.entries(buttons)) button.setAttribute('aria-pressed', String(name === key));
    search.hidden = key !== 'folder';
    files.classList.toggle('folder-view', key === 'folder');
    if (key === 'source') $('sourcePanel').open = true;
    if (key === 'media') $('mediaPanel').open = true;
    for (const video of media.querySelectorAll('video')) if (key !== 'media') video.pause();
    empty.hidden = !$('result').hidden;
    viewText.hidden = $('result').hidden || key === 'text';
    statusRow.hidden = key === 'examples';
    if (changed && (key === 'files' || key === 'folder')) onGallery();
  }
  show('files');
  return {
    show,
    galleryVisible: () => active === 'files' || active === 'folder',
    textAvailable(value) { empty.hidden = value; viewText.hidden = !value || active === 'text'; },
    selection(file) { selectedPreview.hidden = !file; selectedPreview.open = false; },
  };
}
