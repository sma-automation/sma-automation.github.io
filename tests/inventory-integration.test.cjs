const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {prepareInventoryIntegration}=require('../n8n/prepare-inventory-integration.cjs');
const {inventoryNames:N}=require('../n8n/inventory-draft-contract.cjs');
const stockNodes=[N.read,N.evaluate,N.mirror,N.commit];
const prefix='SMA – Produkt – Shopify Sync – ';
const branch=prefix+'Externe Produkt-ID vorhanden?';
const mirror='SMA – Supabase – Produkt spiegeln';
function fixture(){
 const draft=structuredClone(require('./fixtures/inventory-draft.json'));
 draft.versionId='draft-version';
 for(const suffix of ['Credential laden','Credential entschlüsseln','Credential vorbereiten','Access Token holen'])draft.nodes.push({id:suffix,name:prefix+suffix,type:'n8n-nodes-base.noOp',parameters:{},position:[0,0]});
 const fields=[{name:'produkt_name',value:'unchanged metadata'},{name:'bestand',value:"={{ Number($('SMA – Produkt – Shopify Sync – Produkt prüfen').first().json.bestand) }}"}];
 draft.nodes.push({id:'mirror-id',name:mirror,type:'n8n-nodes-base.httpRequest',parameters:{method:'POST',bodyParameters:{parameters:fields}},credentials:{test:{id:'fake'}},position:[4,5]});
 const published=structuredClone(draft);published.versionId='published-version';
 published.nodes=published.nodes.filter(n=>!stockNodes.includes(n.name));
 for(const name of stockNodes)delete published.connections[name];
 published.connections[branch].main[0]=published.connections[branch].main[0].filter(e=>e.node!==N.read);
 draft.nodes.find(n=>n.name===mirror).parameters.bodyParameters.parameters=fields.filter(f=>f.name!=='bestand');
 draft.nodes.find(n=>n.name===prefix+'Produkt aktualisieren').parameters={unrelatedDraftChange:true};
 draft.nodes.find(n=>n.name==='Unrelated protected node').position=[99,99];
 return {published,draft};
}
test('selective integration changes one existing node and one route while adding only the stock chain',()=>{
 const {published,draft}=fixture(),before=structuredClone(published),draftBefore=structuredClone(draft);
 const {candidate,summary}=prepareInventoryIntegration(published,draft);
 assert.deepEqual(published,before);assert.deepEqual(draft,draftBefore);
 assert.equal(candidate.nodes.length,published.nodes.length+13);
 for(const n of published.nodes){
  const after=candidate.nodes.find(x=>x.name===n.name);
  if(n.name!==mirror)assert.deepEqual(after,n);
  else{const expected=structuredClone(n);expected.parameters.bodyParameters.parameters=expected.parameters.bodyParameters.parameters.filter(f=>f.name!=='bestand');assert.deepEqual(after,expected);}
 }
 for(const [name,links] of Object.entries(published.connections))if(name!==branch)assert.deepEqual(candidate.connections[name],links);
 assert.deepEqual(candidate.connections[branch].main[1],published.connections[branch].main[1]);
 assert.deepEqual(summary.modified_existing_nodes,[mirror]);assert.deepEqual(summary.modified_existing_connections,[branch]);
 assert.equal(summary.added_nodes.length,13);assert.equal(summary.published,false);assert.equal(summary.executed,false);
 assert.equal(summary.source_nodes_sha256,crypto.createHash('sha256').update(JSON.stringify(published.nodes)).digest('hex'));
 for(const key of ['id','name','settings','active','versionId','tags','meta'])assert.deepEqual(candidate[key],published[key]);
 assert.equal(JSON.stringify(candidate).includes('qa_fault'),false);
});
test('history export selects the verified active version instead of its draft metadata',()=>{
 const {published,draft}=fixture();
 const history={...structuredClone(published),versionId:'draft-version',active:true,activeVersionId:'published-version',
  activeVersion:{versionId:'published-version',workflowId:published.id,nodes:structuredClone(published.nodes),connections:structuredClone(published.connections)},
  usedCredentials:['server-owned'],scopes:['server-owned']};
 const {candidate,summary}=prepareInventoryIntegration(history,draft);
 assert.equal(candidate.versionId,'published-version');assert.equal(summary.published_version,'published-version');
 for(const key of ['activeVersion','activeVersionId','usedCredentials','scopes'])assert.equal(Object.hasOwn(candidate,key),false);
 history.activeVersion.nodes.pop();assert.throws(()=>prepareInventoryIntegration(history,draft),/not the active/);
});
test('routing, dependencies and mirror field drift cannot silently enter an integration candidate',()=>{
 const changes=[p=>p.id='different',p=>p.pinData={test:[]},p=>p.nodes.push(p.nodes[0]),
  p=>p.nodes.find(n=>n.name===N.product).parameters={changed:true},
  p=>p.connections[branch].main[0].push({node:'extra',type:'main',index:0}),
  p=>p.nodes.find(n=>n.name===mirror).parameters.bodyParameters.parameters[1].value='0',
  p=>p.nodes.find(n=>n.name===mirror).parameters.bodyParameters.parameters.push({name:'bestand',value:'duplicate'}),
  p=>p.nodes.push({id:'collision',name:N.read,type:'test',parameters:{}})];
 for(const change of changes){const {published,draft}=fixture();change(published);assert.throws(()=>prepareInventoryIntegration(published,draft));}
});
test('unexpected mirror fields in the draft are rejected and unrelated draft edits stay out',()=>{
 const {published,draft}=fixture();
 const normal=prepareInventoryIntegration(published,draft).candidate;
 assert.deepEqual(normal.nodes.find(n=>n.name===prefix+'Produkt aktualisieren'),published.nodes.find(n=>n.name===prefix+'Produkt aktualisieren'));
 assert.deepEqual(normal.nodes.find(n=>n.name==='Unrelated protected node').position,published.nodes.find(n=>n.name==='Unrelated protected node').position);
 draft.nodes.find(n=>n.name===mirror).parameters.bodyParameters.parameters.push({name:'unexpected',value:'change'});
 assert.throws(()=>prepareInventoryIntegration(published,draft),/unrelated mirror fields/);
});
