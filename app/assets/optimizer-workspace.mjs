// Reuse the live forms and their handlers; only the workspace arrangement changes.
export function createOptimizerWorkspace(doc, portalName, onGallery) {
  const $ = id => doc.getElementById(id);
  const main = doc.querySelector('main');
  const make = (tag, id, label) => {
    const node = doc.createElement(tag);
    if (id) node.id = id;
    if (label) node.textContent = label;
    return node;
  };
  const button = (id, label, action) => {
    const node = make('button', id, label);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  doc.body.classList.add('wide');
  const toolbar = make('nav', 'optimizerToolbar');
  toolbar.setAttribute('aria-label', 'Optimierung');
  const files = make('section', 'workspaceFiles');
  files.setAttribute('aria-label', 'Bild- und Videogalerie');
  const source = make('div', 'workspaceSource');
  const text = make('div', 'workspaceText');
  const panels = { files, source };
  main.append(toolbar, files, source);
  const buttons = {};
  let active = 'files';
  for (const [key, label] of [['files', 'Datei'], ['source', 'Inhalt und Ziel']]) {
    buttons[key] = button('workspaceTab-' + key, label, () => show(key));
    buttons[key].setAttribute('aria-controls', panels[key].id);
    buttons[key].setAttribute('aria-pressed', 'false');
    toolbar.append(buttons[key]);
  }

  const galleryHeader = make('div', 'workspaceGalleryHeader');
  const galleryActions = make('div', 'workspaceGalleryActions');
  $('deviceBrowse').textContent = 'Datei hinzufügen';
  galleryActions.append($('deviceBrowse'), $('refreshFiles'));
  galleryHeader.append(make('h2', null, 'Deine Dateien'), galleryActions);
  const pickerBody = $('filePicker').querySelector('.file-picker-body');
  files.append(galleryHeader, pickerBody);
  $('filePicker').hidden = true;
  $('filePickerHelp').hidden = true;
  $('pickerRefresh').parentElement.hidden = true;
  $('chooseGeneralTemplate').parentElement.hidden = true;
  // Retain search and the legacy picker entry point without another toolbar tab.
  const search = make('details', 'workspaceSearch');
  search.append(make('summary', null, 'Datei suchen'), doc.querySelector('label[for="fileSearch"]'), $('fileSearch'));
  pickerBody.prepend(search, $('fileSwitchNotice'));
  const selectedPreview = make('details', 'workspaceSelectedPreview');
  selectedPreview.hidden = true;
  selectedPreview.append(make('summary', null, 'Ausgewählte Datei ansehen'), $('assetPreview'), $('fileDetails'), $('mediaPanel'));
  files.append(selectedPreview);
  const next = button('workspaceContinue', 'Inhalt und Ziel →', () => show('source'));
  next.disabled = true;
  files.append(next);

  const selectedRow = make('div', 'workspaceSelectedFile');
  const selectedName = make('strong', 'workspaceSelectedName', 'Noch keine Datei ausgewählt');
  const selectedKind = make('span', 'workspaceSelectedKind');
  const selectedLabel = make('div');
  selectedLabel.append(selectedName, selectedKind);
  selectedRow.append(selectedLabel, button('workspaceChangeFile', 'Datei ändern', () => show('files')));
  const editor = make('div', 'workspaceEditor');
  source.append(selectedRow, editor);
  $('magicActionsSource').hidden = true;
  $('magicActionsText').hidden = false;
  $('sourceSummary').textContent = 'Inhalt ansehen oder eigene Angaben ergänzen';
  $('sourcePanel').open = false;
  $('generate').textContent = 'Text aus eigenen Angaben erstellen';
  $('generate').classList.add('secondary');
  $('loadLatest').textContent = 'Gespeicherten Entwurf laden';
  const evidence = make('details', 'workspaceMagicEvidence');
  evidence.append(make('summary', null, 'Erkennung ansehen'), $('magicPanel'));
  $('sourcePanel').append(evidence);

  const textHeader = make('div', 'workspaceTextHeader');
  const language = $('language').parentElement;
  // The original language control remains form-associated after moving outside it.
  $('language').setAttribute('form', 'previewForm');
  textHeader.append($('resultHeading'), language);
  const empty = make('div', 'workspaceTextEmpty');
  for (const [tag, id, label, placeholder] of [
    ['input', 'workspaceEmptyTitle', 'Titel / Einstieg', 'Dein Titel wird hier vorbereitet.'],
    ['textarea', 'workspaceEmptyBody', 'Beitragstext', 'Dein Text mit passenden Hashtags und Shop-Link erscheint hier.'],
  ]) {
    const field = make('div'); field.className = 'field';
    const fieldLabel = make('label', null, label); fieldLabel.htmlFor = id;
    const control = make(tag, id); control.placeholder = placeholder; control.disabled = true;
    field.append(fieldLabel, control); empty.append(field);
  }
  empty.append(make('p', null, 'Noch kein Text vorbereitet.'));
  const resultDetails = make('details', 'workspaceResultDetails');
  resultDetails.append(make('summary', null, 'Prüfdetails und Shop-Link'));
  // Keep pending checks accessible; collapsing them never changes publish approval.
  const resultNotes = [...$('result').querySelectorAll(':scope > .checks, :scope > .note, :scope > .notice')];
  resultDetails.append($('portalNote'), ...resultNotes);
  $('result').append(resultDetails);
  $('save').textContent = 'Entwurf speichern';
  text.append(textHeader, empty, $('result'));
  editor.append($('magicActionsText'), $('sourcePanel'), text);
  $('assetPanel').hidden = true;
  $('resultFileActions').hidden = true;
  $('exampleFiles').hidden = true;
  const statusRow = make('div', 'workspaceStatus');
  statusRow.append($('portalStatus'));
  main.append(toolbar, $('uploadPanel'), statusRow, $('magicReplaceNotice'), files, source);

  function show(key) {
    if (key === 'text') key = 'source';
    if (key === 'folder') { key = 'files'; search.open = true; }
    if (!Object.hasOwn(panels, key)) return;
    const changed = active !== key;
    active = key;
    for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== key;
    for (const [name, tab] of Object.entries(buttons)) tab.setAttribute('aria-pressed', String(name === key));
    for (const video of files.querySelectorAll('video')) if (key !== 'files') video.pause();
    empty.hidden = !$('result').hidden;
    if (changed && key === 'files') onGallery();
  }
  show('files');
  return {
    show,
    galleryVisible: () => active === 'files',
    textAvailable(value) { empty.hidden = value; },
    selection(file) {
      selectedPreview.hidden = !file; selectedPreview.open = false;
      selectedName.textContent = file?.name || 'Noch keine Datei ausgewählt';
      selectedKind.textContent = file ? (file.media_kind === 'video' ? 'Video' : 'Bild') + ' · ' + portalName : '';
      next.disabled = !file;
    },
  };
}
