const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {buildInventoryEditHttpQA}=require('../n8n/build-inventory-edit-http-qa.cjs');
const fixture=require('./fixtures/inventory-edit-response.json');
const {responseNames:R}=require('../n8n/patch-inventory-edit-responses.cjs');
const {editNames:E}=require('../n8n/patch-inventory-writers.cjs');
const qa=()=>buildInventoryEditHttpQA(fixture,{path:'sma-qa-pr81-edit-00000000-0000-4000-8000-000000000001'});
const p={id:9,kunde_id:'kunde_3182',produkt_id:'10c2f5a9-0571-4023-a1d6-df871813e1a7',sku:'SMA-TEST-002',bestand:4,
 produkt_name:'Test',beschreibung:'Test',produkt_typ:'physisch',preis:12.5,waehrung:'EUR',aktiv:true,updatedAt:'2026-11-06T00:00:00.000Z',stock_owner:'shopify',expected_stock:4};
function run(node,input,refs){return JSON.parse(JSON.stringify(vm.runInNewContext('(function(){'+node.parameters.jsCode+'})()',
 {$input:{first:()=>({json:input}),all:()=>[{json:input}]},$:name=>({first:()=>({json:refs[name]}),all:()=>[{json:refs[name]}]})})))[0].json;}
test('HTTP QA is unpublished, tightly scoped, and has only manual callers to a unique test URL',()=>{
 const {endpoint,caller,path}=qa();assert.equal(endpoint.nodes.length,21);assert.equal(caller.nodes.length,11);
 for(const w of [endpoint,caller]){assert.equal(w.active,false);assert.equal(w.settings.saveManualExecutions,false);assert.equal(w.settings.saveDataErrorExecution,'none');assert.equal(w.settings.saveDataSuccessExecution,'none');assert.equal(w.settings.executionTimeout,90);
  const names=new Set(w.nodes.map(n=>n.name));for(const [name,c]of Object.entries(w.connections)){assert(names.has(name));for(const port of c.main)for(const edge of port)assert(names.has(edge.node));}
  for(const n of w.nodes)if(n.type.endsWith('.code'))new vm.Script('(function(){'+n.parameters.jsCode+'})()');
 }
 assert.equal(endpoint.nodes.filter(n=>n.type.endsWith('.webhook')).length,1);
 assert.equal(caller.nodes.filter(n=>n.type.endsWith('.manualTrigger')).length,1);
 const http=caller.nodes.find(n=>n.name==='QA – Test-Webhook aufrufen');assert.equal(http.parameters.url,'https://johnmusic.app.n8n.cloud/webhook-test/'+path);assert.equal(http.retryOnFail,false);
 assert(endpoint.nodes.find(n=>n.name===E.read).parameters.filters.conditions.some(c=>c.keyName==='produkt_id'&&c.keyValue===p.produkt_id));
 assert(endpoint.nodes.find(n=>n.name==='SMA – Produkt – Bearbeiten – Kunde prüfen').parameters.filters.conditions.some(c=>c.keyName==='kunde_id'&&c.keyValue===p.kunde_id));
 assert.equal(endpoint.connections[R.prepared].main[0][0].node,'QA – Unveränderte Testbearbeitung');
 assert.throws(()=>buildInventoryEditHttpQA(fixture,{path:'sma-produkt-bearbeiten'}));
 assert.throws(()=>buildInventoryEditHttpQA(fixture,{testCase:'other'}));
});
test('receiver guard blocks changes to customer, product, quantity, ownership and metadata',()=>{
 const n=qa().endpoint.nodes.find(n=>n.name==='QA – Unveränderte Testbearbeitung'),refs={[E.webhook]:{body:{token:'synthetic',produkt_id:p.produkt_id}}};
 assert.equal(run(n,p,refs).bestand,4);
 for(const changed of [{kunde_id:'other'},{produkt_id:'other'},{bestand:3},{expected_stock:3},{stock_owner:'sma'}])assert.throws(()=>run(n,{...p,...changed},refs),/QA_SCOPE/);
 assert.throws(()=>run(n,p,{[E.webhook]:{body:{...refs[E.webhook].body,produkt_name:'changed'}}}),/QA_SCOPE/);
});
test('caller builds four bounded cases and refuses a mismatched starting state',()=>{
 const n=qa().caller.nodes.find(n=>n.name==='QA – Anfrage vorbereiten');
 const refs={'QA – Produkt vorher':p,'QA – Supabase vorher':{...p,kunde_id:'kunde_20be25c6',sma_produkt_id:p.produkt_id},'QA – Kundenkennung lesen':{zugangs_token:'synthetic-runtime-token'}};
 for(const kind of ['invalid','unknown','stock','success']){
  const result=run(n,{}, {...refs,'QA – Testfall':{case:kind}}).body;
  assert.equal(result.token,kind==='invalid'?'qa-intentionally-invalid':'synthetic-runtime-token');
  assert.equal(result.produkt_id,kind==='unknown'?'00000000-0000-4000-8000-000000000000':p.produkt_id);
  assert.equal(result.bestand,kind==='stock'?3:undefined);
 }
 assert.throws(()=>run(n,{}, {...refs,'QA – Testfall':{case:'success'},'QA – Produkt vorher':{...p,bestand:5}}),/QA_SCOPE/);
 assert.throws(()=>run(n,{}, {...refs,'QA – Testfall':{case:'success'},'QA – Produkt vorher':{...p,preis:13}}),/QA_METADATA/);
});
test('final proof requires unchanged content and distinguishes rejected requests from observed writes',()=>{
 const n=qa().caller.nodes.find(n=>n.name==='QA – HTTP Ergebnis');
 const s={...p,id:9,kunde_id:'kunde_20be25c6',sma_produkt_id:p.produkt_id,updated_at:p.updatedAt,shopify_bestand_erfasst_am:p.updatedAt};
 const refs={'QA – Produkt vorher':p,'QA – Produkt nachher':p,'QA – Supabase vorher':s,'QA – Supabase nachher':s,'QA – HTTP-Antwort prüfen':{case:'invalid',http_status:403,response_ok:false}};
 assert.equal(run(n,{},refs).ok,true);
 assert.throws(()=>run(n,{}, {...refs,'QA – Produkt nachher':{...p,updatedAt:'2026-11-06T00:00:01.000Z'}}),/QA_REJECTED/);
 assert.throws(()=>run(n,{}, {...refs,'QA – HTTP-Antwort prüfen':{case:'success',http_status:200,response_ok:true}}),/QA_EDIT_NOT_OBSERVED/);
 const success=run(n,{}, {...refs,'QA – HTTP-Antwort prüfen':{case:'success',http_status:200,response_ok:true},'QA – Produkt nachher':{...p,updatedAt:'2026-11-06T00:00:01.000Z'},'QA – Supabase nachher':{...s,updated_at:'2026-11-06T00:00:02.000Z'}});
 assert.equal(success.ok,true);assert.equal(Object.hasOwn(success,'token'),false);
});
