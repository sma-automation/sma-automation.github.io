const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {prepareProductEdit,confirmProductEdit}=require('../n8n/inventory-writers-contract.cjs');
const {patchInventoryWebhook,patchProductWriters,editNames:E}=require('../n8n/patch-inventory-writers.cjs');
const main=require('./fixtures/inventory-writers-main.json'),webhook=require('./fixtures/inventory-writers-webhook.json');
const row={id:9,kunde_id:'customer',produkt_id:'product',sku:'sku',bestand:4,updatedAt:'2026-11-06T00:00:00.000Z'};
const mapping={kunde_id:row.kunde_id,produkt_id:row.produkt_id,markt:'shopify',externe_variant_id:'gid://shopify/ProductVariant/1'};
test('Shopify metadata edits preserve stock and explicit quantity changes require a stock order',()=>{
 for(const bestand of [undefined,4,'4'])assert.equal(prepareProductEdit(row,[mapping],{produkt_id:row.produkt_id,bestand}).expected_stock,4);
 for(const bestand of [3,5,'0'])assert.throws(()=>prepareProductEdit(row,[mapping],{produkt_id:row.produkt_id,bestand}),/SHOPIFY_STOCK_USE_STOCK_ORDER/);
 assert.throws(()=>prepareProductEdit(row,[{...mapping,sync_aktiv:false}],{produkt_id:row.produkt_id,bestand:3}),/SHOPIFY_STOCK_USE_STOCK_ORDER/);
 assert.throws(()=>prepareProductEdit(row,[{...mapping,externe_variant_id:'',externe_produkt_id:'gid://shopify/Product/1'}],{produkt_id:row.produkt_id,bestand:3}),/SHOPIFY_STOCK_USE_STOCK_ORDER/);
});
test('unmapped SMA products retain valid manual quantity editing',()=>{
 for(const mappings of [[],[{}],[{...mapping,externe_variant_id:''}]])assert.equal(prepareProductEdit(row,mappings,{produkt_id:row.produkt_id,bestand:7}).expected_stock,7);
 for(const bestand of [null,'',-1,1.5,'bad',{},Infinity])assert.throws(()=>prepareProductEdit(row,[],{produkt_id:row.produkt_id,bestand}),/STOCK_INVALID/);
});
test('editing rejects foreign mappings, wrong products and missing row versions',()=>{
 for(const patch of [{kunde_id:'other'},{produkt_id:'other'},{markt:'digistore24'}])assert.throws(()=>prepareProductEdit(row,[{...mapping,...patch}],{produkt_id:row.produkt_id}),/PRODUCT_EDIT_MAPPING/);
 assert.throws(()=>prepareProductEdit(row,[],{produkt_id:'other'}),/PRODUCT_EDIT_IDENTITY/);
 assert.throws(()=>prepareProductEdit({...row,updatedAt:null},[],{produkt_id:row.produkt_id}),/VERSION_REQUIRED/);
});
test('an empty or ambiguous edit response never reaches success or Supabase mirroring',()=>{
 const prepared=prepareProductEdit(row,[mapping],{produkt_id:row.produkt_id});
 for(const result of [[],[{}],[row,row]])assert.throws(()=>confirmProductEdit(result,prepared),/CONFLICT_RELOAD_REQUIRED/);
 for(const patch of [{bestand:3},{updatedAt:row.updatedAt},{kunde_id:'other'}])assert.throws(()=>confirmProductEdit([{...row,updatedAt:'2026-11-06T00:00:01.000Z',...patch}],prepared),/NOT_CONFIRMED/);
 assert.equal(confirmProductEdit([{...row,updatedAt:'2026-11-06T00:00:01.000Z'}],prepared).bestand,4);
});
test('metadata-only reimports omit stock while initial inserts and unrelated nodes remain untouched',()=>{
 const before=structuredClone(main),w=patchProductWriters(main);
 assert.deepEqual(main,before);assert.equal(w.nodes.length,main.nodes.length+3);
 const changed=[E.save,...['Shopify','Digistore24'].map(m=>`SMA – Marktkonto – Initialimport – ${m} Produkt aktualisieren`)];
 for(const n of main.nodes)if(!changed.includes(n.name))assert.deepEqual(w.nodes.find(x=>x.name===n.name),n);
 for(const market of ['Shopify','Digistore24']){
  const name=`SMA – Marktkonto – Initialimport – ${market} Produkt aktualisieren`;
  const n=w.nodes.find(x=>x.name===name),old=main.nodes.find(x=>x.name===name);
  const expected=structuredClone(old.parameters.columns.value);delete expected.bestand;
  assert.deepEqual(n.parameters.columns.value,expected);
 }
 assert.equal(w.connections[E.found].main[0][0].node,E.mappings);
 assert.equal(w.connections[E.save].main[0][0].node,E.confirmed);
 assert.deepEqual(w.connections[E.confirmed],main.connections[E.save]);
 assert.equal(w.nodes.find(n=>n.name===E.mappings).parameters.returnAll,true);
});
test('the edit update evaluates identity and old version together against the selected product',()=>{
 const w=patchProductWriters(main),n=w.nodes.find(n=>n.name===E.save);
 const refs={[E.read]:row,[E.prepare]:row,'SMA – Produkt – Bearbeiten – Kunde prüfen':{kunde_id:row.kunde_id}};
 const resolved=n.parameters.filters.conditions.map(c=>[c.keyName,vm.runInNewContext(c.keyValue.slice(3,-2),{$:name=>({first:()=>({json:refs[name]})})})]);
 assert.deepEqual(resolved,[['produkt_id',row.produkt_id],['kunde_id',row.kunde_id],['id',row.id],['updatedAt',row.updatedAt]]);
 assert.equal(n.parameters.matchType,'allConditions');assert.equal(n.alwaysOutputData,true);assert.equal(n.retryOnFail,false);
});
test('webhook guards reject stale canonical results and unconfirmed mirrors using the actual generated code',()=>{
 const w=patchInventoryWebhook(webhook),refs={},now=Date.parse('2026-11-06T00:00:10.000Z');
 refs['Produktzuordnung prüfen']={...row,markt_konto_id:'account',shop_domain:'fixture.myshopify.com',delivery_id:'00000000-0000-4000-8000-000000000001',inventory_item_id:'gid://shopify/InventoryItem/1',payload_hash:'hash'};
 refs['Meldung beanspruchen']={ok:true,action:'process',lease_id:'00000000-0000-4000-8000-000000000002',read_started_at:new Date(now).toISOString()};
 class Clock extends Date{static now(){return now+1000;}}
 const run=(name,input)=>{const code=w.nodes.find(n=>n.name===name).parameters.jsCode;const out=vm.runInNewContext('(function(){'+code+'})()',{Date:Clock,$input:{all:()=>[{json:input}]},$:n=>({all:()=>[{json:refs[n]}]})});refs[name]=JSON.parse(JSON.stringify(out[0].json));return refs[name];};
 run('SMA-Produkt prüfen',row);
 const response={ok:true,applied:true,row_id:1,kunde_id:'canonical',n8n_kunde_id:row.kunde_id,sma_produkt_id:row.produkt_id,bestand:4,erfasst_am:new Date(now).toISOString()};
 for(const change of [{applied:false},{bestand:3},{erfasst_am:row.updatedAt}])assert.throws(()=>run('Speicherwert prüfen',{...response,...change}),/CANONICAL_WRITE_NOT_CONFIRMED/);
 run('Speicherwert prüfen',response);
 assert.throws(()=>run('Gespeicherten Bestand prüfen',{}),/MIRROR_CONFLICT_RESTART_REQUIRED/);
 assert.equal(run('Gespeicherten Bestand prüfen',{...row,updatedAt:new Date(now+500).toISOString()}).p_action,'finish');
 assert.equal(w.nodes.find(n=>n.name==='n8n-Bestand speichern').parameters.filters.conditions.at(-1).keyName,'updatedAt');
});
test('writer patches reject source drift, pinned execution data and repeated patches',()=>{
 for(const [source,patch]of [[main,patchProductWriters],[webhook,patchInventoryWebhook]]){
  for(const change of [w=>w.id='wrong',w=>w.pinData={test:[{}]},w=>w.nodes[0].parameters={changed:true},w=>w.connections[w.nodes[0].name]={main:[]},w=>w.nodes.push(w.nodes[0])]){
   const w=structuredClone(source);change(w);assert.throws(()=>patch(w));
  }
  assert.throws(()=>patch(patch(source)));
 }
});

const {buildInventoryWritersQA}=require('../n8n/build-inventory-writers-qa.cjs');
function qaDraft(){
 const w=structuredClone(require('./fixtures/inventory-draft.json'));
 for(const suffix of ['Credential laden','Credential entschlüsseln','Credential vorbereiten','Access Token holen'])w.nodes.push({id:suffix,name:'SMA – Produkt – Shopify Sync – '+suffix,type:'n8n-nodes-base.noOp',parameters:{},position:[0,0]});
 return w;
}
test('combined QA uses the actual changed guards and has one connected manual path',()=>{
 const qa=buildInventoryWritersQA(main,webhook,qaDraft()),patched=patchInventoryWebhook(webhook);
 assert.equal(qa.nodes.length,57);assert.equal(qa.active,false);
 assert.equal(qa.nodes.filter(n=>n.type.endsWith('.manualTrigger')).length,1);
 assert.equal(qa.nodes.some(n=>/webhook|scheduleTrigger|respondToWebhook/.test(n.type)),false);
 assert.equal(qa.settings.saveManualExecutions,false);assert.equal(qa.settings.executionTimeout,90);
 for(const name of ['SMA-Produkt prüfen','Speicherwert prüfen','Gespeicherten Bestand prüfen'])assert.deepEqual(qa.nodes.find(n=>n.name===name).parameters,patched.nodes.find(n=>n.name===name).parameters);
 const seen=new Set();let name='Manueller Bestandsprüflauf';
 while(name){assert.equal(seen.has(name),false);seen.add(name);name=qa.connections[name]?.main?.[0]?.[0]?.node;}
 assert.equal(seen.size,57);
 for(const n of qa.nodes)if(n.type.endsWith('.code'))new vm.Script('(function(){'+n.parameters.jsCode+'})()');
});
test('combined QA tests both actual import mappings only in dry run and preserves the edit guards',()=>{
 const qa=buildInventoryWritersQA(main,webhook,qaDraft()),patched=patchProductWriters(main);
 for(const name of [E.mappings,E.prepare,E.save,E.confirmed])assert.deepEqual(qa.nodes.find(n=>n.name===name).parameters,patched.nodes.find(n=>n.name===name).parameters);
 for(const market of ['Shopify','Digistore24']){
  const name=`SMA – Marktkonto – Initialimport – ${market} Produkt aktualisieren`;
  const actual=qa.nodes.find(n=>n.name===name).parameters,expected=structuredClone(patched.nodes.find(n=>n.name===name).parameters);
  expected.options={...expected.options,dryRun:true};assert.deepEqual(actual,expected);
  assert.equal(Object.hasOwn(actual.columns.value,'bestand'),false);
 }
});
