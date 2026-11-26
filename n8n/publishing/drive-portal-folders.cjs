// Track complete, paginated Drive membership. A failed scan never commits partial lists.
function beginScan(config) {
  const folders = Object.keys(config.folders);
  if (folders.length !== 4 || !config.ticket) throw Error('FOLDERS_NOT_CONFIGURED');
  return {
    queue: [{id: config.root, pool: null}], visited: [], found: [], tokens: [],
    rows: Object.fromEntries(folders.map(folder => [folder, []]))
  };
}
function collectPage(state, page) {
  const {query, ...next} = state;
  const {id, pool} = next.queue[0];
  if (page.incompleteSearch || !Array.isArray(page.files)) throw Error('INCOMPLETE_LISTING');
  const seen = new Set([...next.visited, ...next.queue.map(entry => entry.id)]);
  const hashes = new Set(pool ? next.rows[pool] : []);
  for (const file of page.files) {
    if (file.trashed !== false || !file.parents?.includes(id) || !/^[A-Za-z0-9_-]{10,200}$/.test(file.id)) throw Error('SOURCE_CHANGED');
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      if (!pool && !Object.hasOwn(next.rows, file.id)) continue;
      if (!pool && !next.found.includes(file.id)) next.found.push(file.id);
      if (!seen.has(file.id)) {
        seen.add(file.id);
        next.queue.push({id: file.id, pool: pool || file.id});
      }
    } else if (pool && file.mimeType?.startsWith('video/') && /^[1-9][0-9]*$/.test(file.size)) {
      if (!/^[a-f0-9]{64}$/.test(file.sha256Checksum)) throw Error('MISSING_VIDEO_DIGEST');
      hashes.add(file.sha256Checksum);
    }
  }
  if (pool) next.rows[pool] = [...hashes];
  if (page.nextPageToken) {
    if (next.tokens.includes(page.nextPageToken)) throw Error('REPEATED_PAGE');
    next.tokens.push(page.nextPageToken);
  } else {
    next.visited.push(next.queue.shift().id);
    next.tokens = [];
  }
  if (!next.queue.length && next.found.length !== Object.keys(next.rows).length) throw Error('PORTAL_FOLDER_MISSING');
  return next;
}
module.exports = {beginScan, collectPage};
