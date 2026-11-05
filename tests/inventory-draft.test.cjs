const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const {inventoryNames:N,inventorySingle,inventoryPrepare,inventoryBody,inventoryClaim,
  inventoryEvaluate,inventoryCanonical,inventoryMirror,inventoryDone} = require('../n8n/inventory-draft-contract.cjs');
const {patchInventoryDraft} = require('../n8n/patch-inventory-draft.cjs');
const graph = require('./fixtures/inventory-draft.json');
const now = Date.parse('2026-11-06T00:00:00Z');
const leaseId = '00000000-0000-4000-8000-000000000001';
const gid = (type,id=1)=>`gid://shopify/${type}/${id}`;
function fixture(){
  const product={id:1,kunde_id:'n8n-customer',produkt_id:'product'};
  const mapping={markt:'shopify',kunde_id:product.kunde_id,produkt_id:product.produkt_id,
    markt_konto_id:'account',externe_variant_id:gid('ProductVariant'),externe_produkt_id:gid('Product')};
  const account={markt:'shopify',kunde_id:product.kunde_id,markt_konto_id:'account',shop_url:'https://fixture.myshopify.com/'};
  const response={data:{productVariant:{id:gid('ProductVariant'),product:{id:gid('Product')},
    inventoryItem:{id:gid('InventoryItem'),tracked:true,inventoryLevels:{nodes:[{
      location:{id:gid('Location'),isActive:true,fulfillsOnlineOrders:true},quantities:[{name:'available',quantity:4}]
    }],pageInfo:{hasNextPage:false}}}}}};
  return {product,mapping,account,response,workflowId:'workflow',executionId:'1'};
}
const prepare=f=>inventoryPrepare(f,crypto);
const claimed=job=>inventoryClaim({ok:true,action:'process',lease_id:leaseId,read_started_at:new Date(now).toISOString()},job,now);
function accepted(job){return {ok:true,applied:true,row_id:9,kunde_id:'canonical-customer',n8n_kunde_id:job.kunde_id,
  sma_produkt_id:job.produkt_id,bestand:job.bestand,erfasst_am:job.read_started_at};}
function ready(){const f=fixture(),job=inventoryEvaluate(f.response,claimed(prepare(f)),now);return {f,job,result:accepted(job)};}

test('claim identity is stable for retries and distinct for another execution',()=>{
 const f=fixture(),a=prepare(f);assert.deepEqual(a,prepare(f));
 f.executionId='2';assert.notEqual(prepare(f).delivery_id,a.delivery_id);
 assert.equal(a.payload_hash.length,64);assert.equal(a.bestand,undefined);
 assert.equal(a.access_token,undefined);assert.equal(inventoryBody('claim',a).p_action,'claim');
});
test('exactly one source item is required',()=>{
 for(const v of [[],[{json:{}},{json:{}}],null,[{}]])assert.throws(()=>inventorySingle(v));
 assert.deepEqual(inventorySingle([{json:{a:1}}]),{a:1});
});
for(const [label,change] of Object.entries({
 'different customer':f=>f.mapping.kunde_id='other',
 'different account':f=>f.account.markt_konto_id='other',
 'wrong product':f=>f.response.data.productVariant.product.id=gid('Product',2),
 'wrong variant':f=>f.response.data.productVariant.id=gid('ProductVariant',2),
 'http endpoint':f=>f.account.shop_url='http://fixture.myshopify.com',
 'foreign endpoint':f=>f.account.shop_url='https://fixture.myshopify.com.evil.test',
 'path endpoint':f=>f.account.shop_url='https://fixture.myshopify.com/path',
 'missing execution':f=>f.executionId='',
 'GraphQL error':f=>f.response.errors=[{message:'denied'}],
 'untracked item':f=>f.response.data.productVariant.inventoryItem.tracked=false,
})){test('preparation rejects '+label,()=>{const f=fixture();change(f);assert.throws(()=>prepare(f));});}
test('busy, malformed and expired claims never allow a stock write; duplicates stop',()=>{
 const job=prepare(fixture());
 for(const response of [{ok:false,action:'busy'},{ok:true,action:'process'}, {ok:true,action:'duplicate'},
  {ok:true,action:'process',lease_id:leaseId,read_started_at:new Date(now-90000).toISOString()}])assert.throws(()=>inventoryClaim(response,job,now));
 assert.equal(inventoryClaim({ok:true,action:'duplicate',status:'done'},job,now),null);
});
test('the second read supplies stock, never the discovery response',()=>{
 const f=fixture(),job=claimed(prepare(f));f.response.data.productVariant.inventoryItem.inventoryLevels.nodes[0].quantities[0].quantity=2;
 assert.equal(inventoryEvaluate(f.response,job,now).bestand,2);
});
test('negative total is unavailable and offline locations do not add stock',()=>{
 const f=fixture(),job=claimed(prepare(f)),levels=f.response.data.productVariant.inventoryItem.inventoryLevels;
 levels.nodes[0].quantities[0].quantity=-6;
 levels.nodes.push({location:{id:gid('Location',2),isActive:false,fulfillsOnlineOrders:true},quantities:[{name:'available',quantity:100}]});
 assert.equal(inventoryEvaluate(f.response,job,now).bestand,0);
});
for(const [label,change] of Object.entries({
 'changed inventory item':x=>x.id=gid('InventoryItem',2),
 'incomplete locations':x=>x.inventoryLevels.pageInfo.hasNextPage=true,
 'duplicate locations':x=>x.inventoryLevels.nodes.push(x.inventoryLevels.nodes[0]),
 'missing available':x=>x.inventoryLevels.nodes[0].quantities=[],
 'fractional available':x=>x.inventoryLevels.nodes[0].quantities[0].quantity=1.5,
 'duplicate available':x=>x.inventoryLevels.nodes[0].quantities.push({name:'available',quantity:4}),
 'no online location':x=>x.inventoryLevels.nodes[0].location.fulfillsOnlineOrders=false,
})){test('leased read rejects '+label,()=>{const f=fixture(),job=claimed(prepare(f));change(f.response.data.productVariant.inventoryItem);assert.throws(()=>inventoryEvaluate(f.response,job,now));});}
test('expired leased read is rejected before the database commit',()=>{
 const f=fixture(),job=claimed(prepare(f));assert.throws(()=>inventoryEvaluate(f.response,job,now+90000));
});
test('rejected, stale, ambiguous or mismatched database results cannot reach the mirror',()=>{
 const {job,result}=ready();
 for(const patch of [{ok:false},{applied:false},{n8n_kunde_id:'other'},{sma_produkt_id:'other'},
  {bestand:5},{erfasst_am:new Date(now-1000).toISOString()},{row_id:0},{kunde_id:null}])assert.throws(()=>inventoryCanonical({...result,...patch},job,now));
 assert.throws(()=>inventoryCanonical([result],job,now));
});
test('mirror must match the accepted row and quantity before finishing',()=>{
 const {job,result}=ready(),canonical=inventoryCanonical(result,job,now),row={id:1,kunde_id:job.kunde_id,produkt_id:job.produkt_id,bestand:4};
 for(const patch of [{id:9},{kunde_id:'other'},{produkt_id:'other'},{bestand:5}])assert.throws(()=>inventoryMirror({...row,...patch},canonical,now));
 assert.equal(inventoryMirror(row,canonical,now).p_action,'finish');
 assert.throws(()=>inventoryMirror(row,canonical,now+110000));
});
test('success requires the RPC journal to confirm the identical canonical result',()=>{
 const {job,result}=ready(),canonical=inventoryCanonical(result,job,now);
 assert.throws(()=>inventoryDone({ok:true,status:'done'},canonical));
 assert.throws(()=>inventoryDone({ok:true,status:'done',result:{...result,bestand:5}},canonical));
 assert.deepEqual(inventoryDone({ok:true,status:'done',result},canonical),{ok:true,bestand:4,produkt_id:'product'});
});
test('patch rewires the stock branch into claim/read/commit/mirror/finish order',()=>{
 const w=patchInventoryDraft(graph),next=n=>w.connections[n].main[0][0]?.node;
 assert.equal(w.nodes.length,graph.nodes.length+9);
 const chain=[N.read,N.prepare,'SMA – Bestand – Sperrauftrag',N.claim,N.claimed,N.reread,N.evaluate,N.commit,N.canonical,N.mirror,N.finishBody,N.finish,N.done];
 for(let i=0;i<chain.length-1;i++)assert.equal(next(chain[i]),chain[i+1]);
 for(const name of [N.claim,N.commit,N.finish]){
   const node=w.nodes.find(n=>n.name===name);
   assert.equal(node.retryOnFail,false);assert.equal(node.parameters.options.timeout,15000);
   assert.match(node.parameters.url,/\/rpc\/sma_shopify_inventory_event_v1$/);
 }
 assert.equal(w.nodes.find(n=>n.name===N.reread).parameters.jsonBody,graph.nodes.find(n=>n.name===N.read).parameters.jsonBody);
});
test('patch preserves unrelated nodes, original credentials, metadata and sibling connections',()=>{
 const before=structuredClone(graph),w=patchInventoryDraft(graph);
 assert.deepEqual(graph,before);
 for(const n of graph.nodes){
  const after=w.nodes.find(x=>x.name===n.name);
  if(![N.evaluate,N.commit,N.mirror].includes(n.name))assert.deepEqual(after,n);
  assert.deepEqual(after.credentials,n.credentials);
 }
 for(const key of ['id','name','active','versionId','settings','pinData'])assert.deepEqual(w[key],graph[key]);
 const branch='SMA – Produkt – Shopify Sync – Externe Produkt-ID vorhanden?';assert.deepEqual(w.connections[branch],graph.connections[branch]);
});
test('all embedded code nodes parse and the real n8n snippets execute end to end',()=>{
 const w=patchInventoryDraft(graph),f=fixture(),refs={};
 for(const [name,value] of [[N.product,f.product],[N.mapping,f.mapping],[N.account,f.account]])refs[name]=value;
 class Clock extends Date{static now(){return now;}}
 const run=(name,input)=>{
  const node=w.nodes.find(n=>n.name===name),code='(function(){'+node.parameters.jsCode+'})()';
  const output=vm.runInNewContext(code,{require,Buffer,Date:Clock,$workflow:{id:'workflow'},$execution:{id:'1'},
    $:n=>({all:()=>[{json:refs[n]}]}),$input:{all:()=>[{json:input}]}});
  if(output.length)refs[name]=JSON.parse(JSON.stringify(output[0].json));return output;
 };
 for(const n of w.nodes.filter(n=>n.type.endsWith('.code')))new vm.Script('(function(){'+n.parameters.jsCode+'})()');
 run(N.prepare,f.response);run('SMA – Bestand – Sperrauftrag',refs[N.prepare]);
 run(N.claimed,{ok:true,action:'process',lease_id:leaseId,read_started_at:new Date(now).toISOString()});
 run(N.evaluate,f.response);const result=accepted(refs[N.evaluate]);run(N.canonical,result);
 run(N.finishBody,{id:1,kunde_id:f.product.kunde_id,produkt_id:f.product.produkt_id,bestand:4});
 const body=(name,json)=>JSON.parse(JSON.stringify(vm.runInNewContext(w.nodes.find(n=>n.name===name).parameters.jsonBody.slice(3,-2),{$json:json})));
 assert.deepEqual(body(N.claim,refs['SMA – Bestand – Sperrauftrag']),inventoryBody('claim',refs[N.prepare]));
 assert.deepEqual(body(N.commit,refs[N.evaluate]),inventoryBody('commit',refs[N.evaluate],{
  p_lease_id:leaseId,p_produkt_id:'product',p_variant_id:gid('ProductVariant'),p_bestand:4}));
 assert.equal(body(N.finish,refs[N.finishBody]).p_action,'finish');
 run(N.done,{ok:true,status:'done',result});assert.equal(refs[N.done].ok,true);
});
test('unexpected source changes, pinning and repeated patching fail closed',()=>{
 for(const change of [w=>w.id='other',w=>w.nodes.find(n=>n.name===N.read).parameters.jsonBody='changed',
  w=>w.connections[N.mirror]={main:[]},w=>w.pinData={test:[{json:{}}]},w=>w.nodes.push(w.nodes[0]),
  w=>w.nodes.find(n=>n.name===N.commit).type='n8n-nodes-base.noOp',
  w=>w.connections.bypass={main:[[{node:N.mirror,type:'main',index:0}]]}]){
  const w=structuredClone(graph);change(w);assert.throws(()=>patchInventoryDraft(w));
 }
 assert.throws(()=>patchInventoryDraft(patchInventoryDraft(graph)));
});
