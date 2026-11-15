const assert = require('node:assert/strict');
const {runInNewContext} = require('node:vm');
const workflow = require('../../n8n/publishing/file-catalog-workflow.json');

// Run the exported nodes and edges with in-memory Drive pages and an injected finish RPC.
async function runCatalog({mapping, lease, readPage, finish}) {
  const runs = new Map([
    ['Eigene Dateiliste reservieren', [lease]],
    ['Ordner prüfen', [mapping]],
  ]);
  const lookup = name => ({first: (output = 0, run = 0) => {
    assert.equal(output, 0);
    return {json: runs.get(name)[run]};
  }});
  const next = (name, port) => workflow.connections[name].main[port][0].node;
  let name = next('Ordnerzugriff bestätigen', 0);
  let item = mapping;
  for (let step = 0; step < 200; step++) {
    const node = workflow.nodes.find(row => row.name === name);
    let port = 0;
    const history = runs.get(name) || [];
    try {
      if (node.type.endsWith('.code')) {
        const results = runInNewContext('(function(){' + node.parameters.jsCode + '})()', {
          Buffer, $:lookup, $runIndex:history.length, $input:{first:() => ({json:item})},
        });
        item = structuredClone(results[0].json);
      } else if (node.type.endsWith('.if')) {
        const condition = node.parameters.conditions.conditions[0].leftValue;
        port = runInNewContext(condition.slice(3,-2), {$json:item}) ? 0 : 1;
      } else if (name === 'Dateimetadaten aus Drive lesen') {
        assert.equal(node.parameters.url, 'https://www.googleapis.com/drive/v3/files');
        assert.equal(node.parameters.specifyQuery, 'json');
        const expression = node.parameters.jsonQuery.slice(3, -2);
        const queryText = runInNewContext(expression, {$json: item});
        assert.equal(typeof queryText, 'string', 'HTTP Request expects JSON text');
        item = await readPage(JSON.parse(queryText));
      } else if (name === 'Dateiliste speichern' || name === 'Dateifehler speichern') {
        assert(node.parameters.url.endsWith('/rpc/sma_publication_files_finish_v1'));
        item = await finish(item);
      } else if (name === 'Dateiantwort') {
        return item;
      } else {
        throw Error('Unexpected workflow node ' + name);
      }
    } catch (error) {
      if (node.onError !== 'continueErrorOutput' || error.code === 'ERR_ASSERTION') throw error;
      item = {error:{message:error.message}};
      port = 1;
    }
    history.push(item);
    runs.set(name, history);
    name = next(name, port);
  }
  throw Error('Catalogue fixture loop did not finish');
}

module.exports = {runCatalog};
