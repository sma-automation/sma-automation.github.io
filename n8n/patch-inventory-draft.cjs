'use strict';
// Offline transformation only. Never imports, executes, activates or publishes n8n.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {inventoryNames: N} = require('./inventory-draft-contract.cjs');
const core = fs.readFileSync(path.join(__dirname, 'inventory-draft-contract.cjs'), 'utf8').split('module.exports =')[0];
const clone = value => structuredClone(value);
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const incoming = (w, target) => Object.entries(w.connections).flatMap(([from, links]) =>
  Object.entries(links).flatMap(([kind, outputs]) => outputs.flatMap((edges, output) =>
    edges.filter(edge => edge.node === target).map(edge => ({from,kind,output,...edge})))));
const expected = require('./inventory-draft-source-fingerprints.json');
function patchInventoryDraft(source) {
  const w = clone(source), nodes = new Map(w.nodes?.map(n => [n.name,n]));
  if (!Array.isArray(w.nodes) || nodes.size !== w.nodes.length) throw new Error('Unique source nodes required');
  if (w.id !== expected.workflow_id) throw new Error('Wrong workflow');
  for (const [name, hash] of Object.entries(expected.parameters)) {
    if (!nodes.has(name) || digest(nodes.get(name).parameters) !== hash) throw new Error('Source changed: ' + name);
    if (nodes.get(name).type !== expected.types[name]) throw new Error('Node type changed: ' + name);
    if (digest(incoming(w,name)) !== expected.incoming[name]) throw new Error('Incoming connections changed: ' + name);
  }
  for (const [name, hash] of Object.entries(expected.connections)) {
    if (digest(w.connections[name] ?? null) !== hash) throw new Error('Connections changed: ' + name);
  }
  if (w.pinData && Object.keys(w.pinData).length) throw new Error('Unpin workflow data before preparing a candidate');
  for (const name of [N.product,N.mapping,N.account]) if (!nodes.has(name)) throw new Error('Required source missing: ' + name);
  for (const name of [N.prepare,N.claim,N.claimed,N.reread,N.canonical,N.finishBody,N.finish,N.done,'SMA – Bestand – Sperrauftrag'])
    if (nodes.has(name)) throw new Error('Unexpected or already patched graph');
  const point = nodes.get(N.read).position;
  let offset = 0;
  const identity = name => ({id: crypto.randomUUID(), name, position: [point[0] + (++offset)*240, point[1]+260]});
  const snippet = body => core + '\nconst one = name => inventorySingle($(name).all());\nconst input = inventorySingle($input.all());\nconst output = value => value === null ? [] : [{json:value,pairedItem:{item:0}}];\n' + body;
  const addCode = (name, body) => {
    const node = {...identity(name),type:'n8n-nodes-base.code',typeVersion:2,parameters:{mode:'runOnceForAllItems',jsCode:snippet(body)}};
    w.nodes.push(node);nodes.set(name,node);
  };
  const rpc = nodes.get(N.commit);
  if (!rpc.parameters.url.endsWith('/rest/v1/rpc/sma_shopify_bestand_uebernehmen_v1')) throw new Error('Unexpected RPC endpoint');
  const rpcURL = rpc.parameters.url.replace(/sma_shopify_bestand_uebernehmen_v1$/, 'sma_shopify_inventory_event_v1');
  function addHTTP(name, template, body) {
    const node = {...clone(template),...identity(name)};
    node.parameters.jsonBody = body;
    // Calls that own a lease have a shorter timeout and no blind node retries.
    node.parameters.options = {...node.parameters.options,timeout:15000};
    node.retryOnFail=false;node.onError='stopWorkflow';node.continueOnFail=false;node.alwaysOutputData=false;
    w.nodes.push(node);nodes.set(name,node);return node;
  }
  addCode(N.prepare, 'return output(inventoryPrepare({product:one(inventoryNames.product),mapping:one(inventoryNames.mapping),account:one(inventoryNames.account),response:input,workflowId:$workflow.id,executionId:$execution.id},require("crypto")));');
  addCode(N.claimed, 'return output(inventoryClaim(input,one(inventoryNames.prepare)));');
  addCode(N.canonical, 'return output(inventoryCanonical(input,one(inventoryNames.evaluate)));');
  addCode(N.finishBody, 'return output(inventoryMirror(input,one(inventoryNames.canonical)));');
  addCode(N.done, 'return output(inventoryDone(input,one(inventoryNames.canonical)));');
  addCode('SMA – Bestand – Sperrauftrag', 'return output(inventoryBody("claim",one(inventoryNames.prepare)));');
  addHTTP(N.claim,rpc,'={{ $json }}').parameters.url=rpcURL;
  addHTTP(N.reread,nodes.get(N.read),nodes.get(N.read).parameters.jsonBody);
  addHTTP(N.finish,rpc,'={{ $json }}').parameters.url=rpcURL;
  nodes.get(N.evaluate).parameters={mode:'runOnceForAllItems',jsCode:snippet('return output(inventoryEvaluate(input,one(inventoryNames.claimed)));')};
  rpc.parameters.url=rpcURL;
  rpc.parameters.jsonBody='={{ (() => { const s = $json; return {p_action:"commit",p_shop_domain:s.shop_domain,p_n8n_kunde_id:s.kunde_id,p_markt_konto_id:s.markt_konto_id,p_delivery_id:s.delivery_id,p_inventory_item_id:s.inventory_item_id,p_payload_hash:s.payload_hash,p_lease_id:s.lease_id,p_produkt_id:s.produkt_id,p_variant_id:s.variant_id,p_bestand:s.bestand}; })() }}';
  rpc.parameters.options={...rpc.parameters.options,timeout:15000};
  rpc.retryOnFail=false;rpc.onError='stopWorkflow';rpc.continueOnFail=false;rpc.alwaysOutputData=false;
  const chain=[N.read,N.prepare,'SMA – Bestand – Sperrauftrag',N.claim,N.claimed,N.reread,N.evaluate,N.commit,N.canonical,N.mirror,N.finishBody,N.finish,N.done];
  // Only the stock side-branch changes. The product update sibling stays intact.
  for (let i=0;i<chain.length;i++) w.connections[chain[i]]={main:[i+1<chain.length?[{node:chain[i+1],type:'main',index:0}]:[]]};
  const mirror=nodes.get(N.mirror);mirror.onError='stopWorkflow';mirror.continueOnFail=false;mirror.alwaysOutputData=true;mirror.retryOnFail=false;
  // This predicate belongs to the UPDATE itself, never a separate preflight read.
  // Empty output is passed to the guard so a conflict cannot look successful.
  mirror.parameters.filters.conditions.push({keyName:'updatedAt',condition:'eq',keyValue:'={{ $json.n8n_produkt_updated_at }}'});
  for(const name of [N.prepare,N.claimed,N.evaluate,N.canonical,N.finishBody,N.done,'SMA – Bestand – Sperrauftrag']){
    const n=nodes.get(name);n.onError='stopWorkflow';n.continueOnFail=false;n.alwaysOutputData=false;n.retryOnFail=false;
  }
  return w;
}
module.exports={patchInventoryDraft};
if(require.main===module){
  const [input,output]=process.argv.slice(2);
  if(!input||!output||path.resolve(input)===path.resolve(output))throw new Error('Usage: node n8n/patch-inventory-draft.cjs SOURCE.json NEW_PRIVATE_CANDIDATE.json');
  const w=patchInventoryDraft(JSON.parse(fs.readFileSync(input,'utf8')));
  fs.writeFileSync(output,JSON.stringify(w,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({candidate_written:true,node_count:w.nodes.length,published:false}));
}
