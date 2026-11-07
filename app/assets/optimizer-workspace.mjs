import {draftDestination} from './publication-destination.mjs?v=1';
// Reuse the live forms and their handlers; only the workspace arrangement changes.
export function createOptimizerWorkspace(doc, portalName, onGallery, options = {}) {
  const $ = id => doc.getElementById(id);
  const describe = options.describeFile || (file => ({title:file.name,version:file.media_kind==='video'?'Video':'Bild'}));
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
  toolbar.classList.add('sma-chapters');toolbar.setAttribute('role','tablist');
  const files = make('section', 'workspaceFiles');
  files.setAttribute('aria-label', 'Bild- und Videogalerie');
  const source = make('div', 'workspaceSource');
  const text = make('div', 'workspaceText');
  const preview = make('section', 'workspacePreview');
  preview.setAttribute('aria-label', 'Datei- und Beitragsvorschau');
  const panels = { files, source, preview };
  main.append(toolbar, files, source);
  const buttons = {};
  let active = 'files';
  let selectedFile = null;
  for (const [key, label] of [['files', 'Datei'], ['source', 'Inhalt und Ziel']]) {
    buttons[key] = button('workspaceTab-' + key, label, () => show(key));
    buttons[key].setAttribute('aria-controls', panels[key].id);
    buttons[key].setAttribute('aria-pressed', 'false');
    buttons[key].setAttribute('role','tab');
    panels[key].setAttribute('role','tabpanel');panels[key].setAttribute('aria-labelledby',buttons[key].id);
    toolbar.append(buttons[key]);
  }
  toolbar.addEventListener('keydown', event => {
    const keys=Object.keys(buttons),index=keys.findIndex(key=>buttons[key]===event.target);if(index<0)return;
    let next;if(event.key==='ArrowRight')next=(index+1)%keys.length;else if(event.key==='ArrowLeft')next=(index+keys.length-1)%keys.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=keys.length-1;else return;
    event.preventDefault();show(keys[next]);buttons[keys[next]].focus();
  });

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
  const viewFile = button('workspaceViewFile', 'Ausgewählte Datei ansehen', () => show('preview'));
  viewFile.setAttribute('aria-controls', preview.id);
  viewFile.disabled = true;
  galleryActions.append(viewFile);

  const previewBack = button('workspacePreviewBack', '← Datei', () => {
    show('files'); viewFile.focus();
  });
  const previewNav = make('nav', 'workspacePreviewNav');
  previewNav.setAttribute('aria-label', 'Vorschaunavigation');
  previewNav.append(previewBack);
  const dashboardBack = $('back');
  const pageHeader = dashboardBack?.parentElement;
  const previewHeading = make('h1', 'workspacePreviewHeading', 'Vorschau für ' + portalName);
  const previewName = make('p', 'workspacePreviewName');
  const previewTabs = make('nav', 'workspacePreviewTabs');
  previewTabs.setAttribute('aria-label', 'Dateivorschau');
  const postView = make('div', 'workspacePostView');
  const detailView = make('div', 'workspaceDetailView');
  const postTab = button('workspacePostTab', 'Beitragsvorschau', () => previewTab('post'));
  const detailTab = button('workspaceDetailTab', 'Dateidetails', () => previewTab('details'));
  postTab.setAttribute('aria-controls', postView.id); detailTab.setAttribute('aria-controls', detailView.id);
  previewTabs.append(postTab, detailTab);
  const headingRow = make('div', 'workspacePreviewHeader');
  const headingText = make('div');
  headingText.append(previewHeading, previewName);
  headingRow.append(headingText);
  preview.append(previewNav, headingRow, previewTabs, postView, detailView);
  const post = make('article', 'workspacePost');
  post.setAttribute('aria-label', 'Darstellung des Beitrags');
  post.dataset.portal = portalName.toLowerCase();
  const profile = make('div', 'workspacePostProfile');
  profile.append(make('span', 'workspacePostAvatar', '◎'), make('strong', null, portalName === 'YouTube' ? 'Dein Kanal' : 'Dein Profil'), make('span', null, portalName));
  const postBody = make('div', 'workspacePostBody');
  const postTitle = make('h2', 'workspacePostTitle');
  const postCaption = make('p', 'workspacePostCaption');
  const postTags = make('p', 'workspacePostTags');
  const postShop = make('a', 'workspacePostShop');
  postShop.target = '_blank'; postShop.rel = 'noopener noreferrer';
  postBody.append(postTitle, postCaption, postTags, postShop);
  post.append(profile, $('assetPreview'), postBody);
  postView.append(post, make('p', 'workspacePreviewNotice', 'Gestaltungsvorschau · Die endgültige Darstellung kann je nach Portal und Gerät abweichen.'));
  const facts = make('dl', 'workspacePreviewFacts');
  const sourceDescription = make('p', 'workspacePreviewSource');
  const reviewNotes = make('ul', 'workspacePreviewNotes');
  detailView.append($('fileDetails'), facts, make('h2', null, 'Inhalt der Datei'), sourceDescription, reviewNotes, $('mediaPanel'));

  function previewTab(key) {
    postView.hidden = key !== 'post'; detailView.hidden = key !== 'details';
    postTab.setAttribute('aria-pressed', String(key === 'post')); detailTab.setAttribute('aria-pressed', String(key === 'details'));
    if (key !== 'post') for (const video of preview.querySelectorAll('video')) video.pause();
  }
  function refreshPreview() {
    const data = options.getPreview?.() || {};
    const draft = data.draft || {};
    const file = selectedFile || {};
    const info = data.facts || {};
    post.dataset.mediaKind = file.media_kind || '';
    const width = file.width_px || info.width_px;
    const height = file.height_px || info.height_px;
    post.dataset.orientation = width > 0 && height > width ? 'portrait' : '';
    if (width > 0 && height > 0) post.style.setProperty('--media-aspect', width + ' / ' + height);
    else post.style.removeProperty('--media-aspect');
    const description = selectedFile ? describe(file) : null;
    previewName.textContent = description ? [description.title, description.version].join(' · ') : '';
    postTitle.textContent = draft.title || 'Noch kein Titel vorbereitet';
    postCaption.textContent = draft.body || 'Noch kein Beitragstext vorbereitet.';
    postTags.textContent = (draft.hashtags || []).map(tag => '#' + tag).join(' ');
    postTags.hidden = !postTags.textContent;
    const target = draftDestination(draft.shop_url, draft, data.language);
    const shop = target?.url;
    postShop.hidden = !target;
    postShop.textContent = target ? target.label + ': ' + shop : '';
    if (target) postShop.href = shop; else postShop.removeAttribute('href');
    sourceDescription.textContent = data.source || 'Noch keine Inhaltsbeschreibung vorhanden.';
    facts.replaceChildren();
    const number = value => Number.isFinite(value) && value >= 0;
    const values = [
      ['Dateiart', info.mime_type || file.mime_type || (file.media_kind === 'video' ? 'Video' : 'Bild')],
      ['Dateigröße', number(info.size_bytes) ? (info.size_bytes / 1000000).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' MB' : 'Noch nicht ermittelt'],
      ['Abmessungen', info.width_px && info.height_px ? info.width_px + ' × ' + info.height_px + ' Pixel' : 'Noch nicht ermittelt'],
      ['Dauer', file.media_kind !== 'video' ? 'Nicht zutreffend' : number(info.duration_ms) ? (info.duration_ms / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' Sekunden' : 'Noch nicht ermittelt'],
      ['Portal', portalName], ['Sprache', data.language === 'en' ? 'Englisch' : 'Deutsch'],
      ['Entwurf', data.draftStatus || 'Noch kein Beitragstext vorbereitet'],
      [draft.product_id ? 'Produktlink' : 'Shop-Link', shop || 'Noch kein Shop-Link zugeordnet'],
    ];
    for (const [label, value] of values) facts.append(make('dt', null, label), make('dd', null, value));
    reviewNotes.replaceChildren();
    for (const note of draft.review_notes || []) reviewNotes.append(make('li', null, note));
    reviewNotes.hidden = !reviewNotes.children.length;
    $('fileDetails').open = true;
  }

  const selectedRow = make('div', 'workspaceSelectedFile');
  const selectedName = make('strong', 'workspaceSelectedName', 'Noch keine Datei ausgewählt');
  const selectedKind = make('span', 'workspaceSelectedKind');
  const selectedLabel = make('div');
  selectedLabel.append(selectedName, selectedKind);
  selectedRow.append(selectedLabel);
  const editor = make('div', 'workspaceEditor');
  source.append(selectedRow);
  if($('videoMetadataPanel'))source.append($('videoMetadataPanel'));
  if($('exportCoverPanel'))source.append($('exportCoverPanel'));
  source.append(editor);
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
  editor.append($('magicActionsText'), $('catalogLookup'), $('sourcePanel'), text);
  $('assetPanel').hidden = true;
  $('resultFileActions').hidden = true;
  $('exampleFiles').hidden = true;
  const statusRow = make('div', 'workspaceStatus');
  statusRow.append($('portalStatus'));
  main.append(toolbar, $('uploadPanel'), statusRow, $('magicReplaceNotice'), files, source, preview);

  function show(key) {
    if (key === 'text') key = 'source';
    if (key === 'folder') { key = 'files'; search.open = true; }
    if (!Object.hasOwn(panels, key)) return;
    if (key === 'preview' && !selectedFile) return;
    const changed = active !== key;
    active = key;
    doc.body.classList.toggle('post-preview-open', key === 'preview');
    if (pageHeader && !doc.body.classList.contains('embedded')) {
      if (key === 'preview') previewNav.prepend(dashboardBack);
      else if (dashboardBack.parentElement === previewNav) pageHeader.prepend(dashboardBack);
    }
    for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== key;
    for (const [name, tab] of Object.entries(buttons)) {tab.setAttribute('aria-pressed', String(name === key));tab.setAttribute('aria-selected',String(name===key));tab.tabIndex=name===key?0:-1;}
    for (const video of main.querySelectorAll('video')) video.pause();
    toolbar.hidden = key === 'preview';
    statusRow.hidden = key === 'preview';
    empty.hidden = !$('result').hidden;
    if (key === 'preview') { refreshPreview(); previewTab('post'); previewBack.focus(); }
    if (changed && key === 'files') onGallery();
    if (changed) options.onView?.(key);
  }
  show('files');
  return {
    show,
    galleryVisible: () => active === 'files',
    refreshPreview() { if (active === 'preview') refreshPreview(); },
    textAvailable(value) { empty.hidden = value; if (!value) clearPreview(); else if (active === 'preview') refreshPreview(); },
    selection(file) {
      selectedFile = file; clearPreview();
      const description = file ? describe(file) : null;
      selectedName.textContent = description?.title || 'Noch keine Datei ausgewählt';
      selectedKind.textContent = description ? description.version + ' · ' + portalName : '';
      viewFile.disabled = !file;
      if (active === 'preview') {
        if (file) refreshPreview();
        else show('files');
      }
    },
  };

  function clearPreview() {
    for (const node of [postTitle, postCaption, postTags, postShop, sourceDescription, previewName]) node.textContent = '';
    postShop.removeAttribute('href'); facts.replaceChildren(); reviewNotes.replaceChildren();
  }
}
