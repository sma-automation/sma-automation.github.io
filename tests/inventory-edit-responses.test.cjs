const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fixture=require('./fixtures/inventory-edit-response.json');
const {patchInventoryEditResponses,responseNames:R}=require('../n8n/patch-inventory-edit-responses.cjs');
const {editNames:E}=require('../n8n/patch-inventory-writers.cjs');
const {productEditAttempt,productEditCustomerFilter,confirmProductEditCustomer}=require('../n8n/inventory-edit-response-contract.cjs');
const prefix='SMA – Produkt – Bearbeiten – ';
const product={id:9,kunde_id:'kunde_fixture',produkt_id:'product-fixture',produkt_name:'Testprodukt',beschreibung:'Test',
 sku:'FIXTURE',produkt_typ:'physisch',preis:12.5,waehrung:'EUR',aktiv:true,bestand:4,updatedAt:'2026-11-06T00:00:00.000Z'};
const customer={kunde_id:product.kunde_id,zugangs_token:'synthetic-test-token',zugang_aktiv:true,demo_delta_aktiv:true};
const canonical={kunde_id:'kunde_canonical',n8n_kunde_id:product.kunde_id,user_id:'00000000-0000-4000-8000-000000000001'};
const mapping={kunde_id:product.kunde_id,produkt_id:product.produkt_id,markt:'shopify',externe_variant_id:'variant-fixture'};

// Exercise the generated nodes and their actual connections/expressions with
// in-memory Data Table and HTTP adapters. This is not a live n8n HTTP test.
function request(body={},options={}){
 const w=patchInventoryEditResponses(fixture),nodes=new Map(w.nodes.map(n=>[n.name,n])),refs={};
 const products=[structuredClone(product),{...product,id:10,kunde_id:'kunde_foreign',produkt_id:'foreign-product'}];
 const customers=[{...customer,...options.customer}],mappings=options.sma?[]:[mapping];
 const visited=[],posts=[];let writes=0,name=E.webhook,input=[{body:{token:customer.zugangs_token,produkt_id:product.produkt_id,...body}}];
 const expr=(value,items=input)=>typeof value==='string'&&value.startsWith('={{')?
  vm.runInNewContext(value.slice(3,-2),{$json:items[0],$:key=>({first:()=>({json:refs[key][0]}),all:()=>refs[key].map(json=>({json}))})}):value;
 while(name){
  if(visited.includes(name))throw Error('Unexpected cycle');
  visited.push(name);const n=nodes.get(name);assert.ok(n,`missing ${name}`);let output=input,port=0;
  try{
   if(n.type.endsWith('.code')){
    output=vm.runInNewContext('(function(){'+n.parameters.jsCode+'})()',{
     $input:{all:()=>input.map(json=>({json}))},$:key=>({first:()=>({json:refs[key][0]}),all:()=>refs[key].map(json=>({json}))}),
     $now:{toISO:()=> '2026-11-06T00:00:02.000Z'},
    }).map(item=>JSON.parse(JSON.stringify(item.json)));
   }else if(n.type.endsWith('.if')){
    port=expr(n.parameters.conditions.conditions[0].leftValue)===true?0:1;
   }else if(n.type.endsWith('.dataTable')){
    const id=n.parameters.dataTableId.value;
    const table=id==='oVIgtuR95fFUbMrN'?customers:id==='TM5GRZx8AfES1BFo'?products:id==='Jb6FkNxGMsZXJ1GB'?mappings:null;
    assert.ok(table,'unknown table');assert.equal(n.parameters.matchType,'allConditions');
    if(n.parameters.operation==='update'&&options.stale)products[0].updatedAt='2026-11-06T00:00:00.500Z';
    let selected=table.filter(row=>n.parameters.filters.conditions.every(c=>row[c.keyName]===expr(c.keyValue)));
    if(n.parameters.limit)selected=selected.slice(0,n.parameters.limit);
    if(n.parameters.operation==='update'){
     for(const row of selected){for(const [k,v]of Object.entries(n.parameters.columns.value))row[k]=expr(v);row.updatedAt='2026-11-06T00:00:01.000Z';writes++;}
    }else assert.equal(n.parameters.operation,'get');
    output=structuredClone(selected);
   }else if(n.type.endsWith('.httpRequest')){
    if(name===R.customer){
     assert.equal(n.parameters.method,'GET');assert.match(n.parameters.url,/\/sma_kunden$/);
     const query=Object.fromEntries(n.parameters.queryParameters.parameters.map(p=>[p.name,expr(p.value)]));
     assert.equal(query.or,`(kunde_id.eq.${product.kunde_id},n8n_kunde_id.eq.${product.kunde_id})`);
     assert.equal(query.select,'kunde_id,n8n_kunde_id,user_id');assert.equal(query.limit,'2');
     output=options.canonicalRows??[canonical];
    }else{
     assert.equal(name,R.mirror);assert.equal(n.parameters.method,'POST');
     const sent=JSON.parse(expr(n.parameters.jsonBody));posts.push(sent);
     if(options.mirrorError)throw Error('provider secret must not enter response');
     output=options.mirrorEmpty?[]:[{...sent,kunde_id:canonical.kunde_id,user_id:canonical.user_id,
      bestand:Object.hasOwn(sent,'bestand')?sent.bestand:options.canonicalStock??4,...options.mirrorPatch}];
    }
   }else if(n.type.endsWith('.respondToWebhook')){
    return {status:expr(n.parameters.options.responseCode),body:JSON.parse(expr(n.parameters.responseBody)),visited,writes,posts,products};
   }else assert.equal(n.type,'n8n-nodes-base.webhook');
   if(!output.length&&n.alwaysOutputData)output=[{}];
  }catch(error){
   if(n.onError!=='continueErrorOutput')return {status:500,error:error.message,visited,writes,posts,products};
   output=[{error:error.message}];port=1;
  }
  refs[name]=structuredClone(output);
  const next=w.connections[name]?.main?.[port]||[];assert.equal(next.length,1,`exactly one next step at ${name}, port ${port}`);
  input=output;name=next[0].node;
 }
 throw Error('No explicit response');
}

test('unauthenticated, inactive and ineligible callers get 403 without reads or writes to products',()=>{
 for(const [body,options]of [[{token:'invalid'},{}],[{token:undefined},{}],[{}, {customer:{zugang_aktiv:false}}],[{}, {customer:{demo_delta_aktiv:false,paket:'alpha',zahlung_bestaetigt:true}}]]){
  const r=request(body,options);assert.equal(r.status,403);assert.equal(r.body.ok,false);assert.equal(r.writes,0);assert.equal(r.posts.length,0);
  assert.equal(r.visited.includes(E.read),false);
 }
});
test('unknown or foreign product IDs get 404 before mappings and canonical lookups',()=>{
 for(const produkt_id of ['foreign-product','missing-product',undefined]){
  const r=request({produkt_id});assert.equal(r.status,404);assert.equal(r.writes,0);assert.equal(r.posts.length,0);
  assert.equal(r.visited.includes(E.mappings),false);
 }
});
test('Shopify quantity changes return actionable 409 before every write',()=>{
 const r=request({bestand:3});assert.equal(r.status,409);assert.equal(r.body.code,'SHOPIFY_STOCK_USE_STOCK_ORDER');
 assert.equal(r.writes,0);assert.equal(r.posts.length,0);assert.equal(r.visited.includes(R.customer),false);
});
test('invalid quantities return 400 and old versions return 409 without mirroring',()=>{
 for(const bestand of [null,'',-1,1.5,'invalid',{}]){
  const r=request({bestand});assert.equal(r.status,400);assert.equal(r.writes,0);assert.equal(r.posts.length,0);
 }
 const r=request({}, {stale:true});assert.equal(r.status,409);assert.equal(r.body.code,'PRODUCT_EDIT_CONFLICT_RELOAD_REQUIRED');
 assert.equal(r.writes,0);assert.equal(r.posts.length,0);assert.equal(r.products[0].bestand,4);
});
test('canonical customer binding is checked before the Data Table write',()=>{
 for(const canonicalRows of [[],[{}],[canonical,canonical],[{...canonical,n8n_kunde_id:'kunde_other'}]]){
  const r=request({}, {canonicalRows});assert.equal(r.status,500);assert.equal(r.error,'PRODUCT_EDIT_CUSTOMER_NOT_CONFIRMED');
  assert.equal(r.writes,0);assert.equal(r.posts.length,0);
 }
});
test('success waits for both stores and Shopify metadata never sends a stock quantity',()=>{
 const r=request({produkt_name:'Neuer Testname'},{canonicalStock:7});assert.equal(r.status,200);assert.equal(r.body.ok,true);
 assert.equal(r.writes,1);assert.equal(r.posts.length,1);assert.equal(Object.hasOwn(r.posts[0],'bestand'),false);
 assert.equal(r.posts[0].produkt_name,'Neuer Testname');assert.equal(r.products[0].bestand,4);
 assert.deepEqual(r.visited.slice(-3),[R.mirror,R.mirrorConfirmed,R.success]);
});
test('SMA quantity editing retains the quantity and requires matching canonical confirmation',()=>{
 const r=request({bestand:7},{sma:true});assert.equal(r.status,200);assert.equal(r.posts[0].bestand,7);assert.equal(r.products[0].bestand,7);
 const mismatch=request({bestand:7},{sma:true,mirrorPatch:{bestand:6}});assert.equal(mismatch.status,502);assert.equal(mismatch.body.ok,false);
});
test('provider failure, empty or mismatched representations return sanitized 502 after the first write',()=>{
 for(const options of [{mirrorError:true},{mirrorEmpty:true},...[{kunde_id:'kunde_foreign'},{user_id:'wrong'},{sma_produkt_id:'wrong'},
   {produkt_name:'stale'},{preis:11},{preis:'12.5'},{bestand:-1},{aktiv:false}].map(mirrorPatch=>({mirrorPatch}))]){
  const r=request({},options);assert.equal(r.status,502);assert.equal(r.body.ok,false);assert.equal(r.body.reload_required,true);
  assert.equal(r.writes,1);assert.equal(r.visited.includes(R.success),false);
  assert.equal(JSON.stringify(r.body).includes('secret'),false);
 }
});
test('only exact known business failures are translated; query filters reject unsafe identities',()=>{
 for(const code of ['PRODUCT_EDIT_MAPPING','unexpected','constructor','toString'])assert.throws(()=>productEditAttempt(()=>{throw Error(code)}),new RegExp(code));
 for(const kunde_id of ['',undefined,'kunde_x),n8n_kunde_id.neq.x','other'])assert.throws(()=>productEditCustomerFilter({kunde_id}),/CUSTOMER_INVALID/);
 assert.deepEqual(confirmProductEditCustomer([{...canonical,n8n_kunde_id:null}],{kunde_id:canonical.kunde_id}),
  {kunde_id:canonical.kunde_id,user_id:canonical.user_id,n8n_kunde_id:canonical.kunde_id});
});
test('patch preserves authentication, original responses, credentials and all unrelated nodes',()=>{
 const before=structuredClone(fixture),w=patchInventoryEditResponses(fixture);assert.deepEqual(fixture,before);assert.equal(w.nodes.length,fixture.nodes.length+7);
 for(const n of fixture.nodes)if(![E.prepare,E.confirmed,R.mirror].includes(n.name))assert.deepEqual(w.nodes.find(x=>x.name===n.name),n);
 for(const n of fixture.nodes)if(![E.prepare,E.confirmed,R.mirror].includes(n.name))assert.deepEqual(w.connections[n.name],fixture.connections[n.name]);
 assert.deepEqual(w.settings,fixture.settings);assert.equal(w.active,false);
 const mirror=w.nodes.find(n=>n.name===R.mirror),customerNode=w.nodes.find(n=>n.name===R.customer);
 assert.deepEqual(mirror.credentials,fixture.nodes.find(n=>n.name===R.mirror).credentials);assert.deepEqual(customerNode.credentials,mirror.credentials);
 for(const n of [mirror,customerNode]){assert.equal(n.parameters.options.timeout,15000);assert.equal(n.retryOnFail,false);assert.equal(n.alwaysOutputData,true);}
 const incoming=w.nodes.filter(n=>(w.connections[n.name]?.main||[]).flat().some(e=>e.node===R.success));assert.deepEqual(incoming.map(n=>n.name),[R.mirrorConfirmed]);
 for(const n of w.nodes)if(n.type.endsWith('.code'))new vm.Script('(function(){'+n.parameters.jsCode+'})()');
});
test('source drift, disabled authentication, unsafe flags, duplicates, pins and double application fail closed',()=>{
 for(const change of [w=>w.id='wrong',w=>w.nodes[0].parameters={bad:true},w=>w.nodes[0].disabled=true,w=>w.nodes[0].onError='continueRegularOutput',
  w=>w.nodes[0].typeVersion=99,w=>w.nodes.push(w.nodes[0]),w=>w.nodes[1].id=w.nodes[0].id,w=>w.pinData={test:[]},
  w=>w.connections[E.confirmed]={main:[]}]){
  const w=structuredClone(fixture);change(w);assert.throws(()=>patchInventoryEditResponses(w));
 }
 assert.throws(()=>patchInventoryEditResponses(patchInventoryEditResponses(fixture)));
});
