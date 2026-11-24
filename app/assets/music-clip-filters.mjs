const labels = [
  ['topics', 'Videothema', 'Alle Themen'],
  ['mood', 'Musikcharakter', 'Alle Musikcharaktere'],
  ['usage', 'Einsatz', 'Alle Einsätze'],
];

export function createMusicClipFilters(doc, onChange) {
  const root = doc.createElement('div');
  root.className = 'sma-music-filters';
  const fields = labels.map(([key, text, placeholder]) => {
    const label = doc.createElement('label');
    label.textContent = text;
    const select = doc.createElement('select');
    select.setAttribute('aria-label', text);
    label.append(select);
    root.append(label);
    select.addEventListener('change', onChange);
    return {key, placeholder, select};
  });

  const values = (track, key) => [].concat(track[key] || []).filter(v => typeof v === 'string' && v);
  function update(tracks) {
    for (const {key, placeholder, select} of fields) {
      const current = select.value;
      const options = [...new Set(tracks.flatMap(t => values(t, key)))].sort((a,b) => a.localeCompare(b,'de'));
      select.replaceChildren();
      for (const value of ['', ...options]) {
        const option = doc.createElement('option');
        option.value = value;
        option.textContent = value || placeholder;
        option.selected = value === (options.includes(current) ? current : '');
        select.append(option);
      }
      select.disabled = !options.length;
    }
  }
  function matches(track) {
    return fields.every(({key, select}) => !select.value || values(track,key).includes(select.value));
  }
  return {root, update, matches};
}

export function musicClipDescription(t) {
  const duration = Number.isInteger(t.duration_ms) ? (t.duration_ms / 1000).toLocaleString('de-AT', {maximumFractionDigits:2}) + ' s' : '';
  return [t.source_title, t.usage, t.mood, duration].filter(Boolean).join(' · ');
}
