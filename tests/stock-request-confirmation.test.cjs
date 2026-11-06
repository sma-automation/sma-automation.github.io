const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {stockRequestConfirmation:confirm}=require('../n8n/stock-request-confirmation.cjs');
const {patchStockRequestConfirmation:patch,names}=require('../n8n/patch-stock-request-confirmation.cjs');
const source=require('./fixtures/stock-request-worker.json');
const now=Date.parse('2026-11-06T10:55:20Z');
function input(quantity=4){
 const claim={quantity,variant_id:'gid://shopify/ProductVariant/1',sku:'TEST'};
 const prepared={quantity,from_quantity:quantity,variant_id:claim.variant_id,inventory_item_id:'gid://shopify/InventoryItem/2',location_id:'gid://shopify/Location/3',read_at:'2026-11-06T10:55:18Z'};
 const mapping={product_gid:'gid://shopify/Product/4'};
 const mutation={data:{inventorySetQuantities:{inventoryAdjustmentGroup:null,userErrors:[]}}};
 const readback={data:{productVariant:{id:claim.variant_id,sku:claim.sku,product:{id:mapping.product_gid},inventoryItem:{id:prepared.inventory_item_id,sku:claim.sku,tracked:true,variants:{nodes:[{id:claim.variant_id}],pageInfo:{hasNextPage:false}},inventoryLevels:{nodes:[{location:{id:prepared.location_id,isActive:true,fulfillsOnlineOrders:true},quantities:[{name:'available',quantity}]}],pageInfo:{hasNextPage:false}}}}}};
 return {claim,prepared,mapping,mutation,readback};
}
function run(x,at=now){return confirm(x.mutation,x.readback,x.prepared,x.claim,x.mapping,at);}
test('unchanged quantities, including zero, require and accept a matching readback',()=>{
 for(const quantity of [0,4]){const result=run(input(quantity));assert.equal(result.status,'applied');assert.equal(result.code,'SHOPIFY_UNCHANGED_CONFIRMED');assert.equal(result.quantity,quantity);assert.equal(result.unchanged,true);}
});
test('a confirmed adjustment retains the existing result even if the added read fails',()=>{
 const x=input();x.mutation.data.inventorySetQuantities.inventoryAdjustmentGroup={createdAt:'2026-11-06T10:55:19Z'};x.readback={error:{message:'offline'}};
 assert.deepEqual(run(x),{status:'applied',code:'SHOPIFY_CONFIRMED',quantity:4});
});
test('rejected mutations are never rescued by a matching readback',()=>{
 const x=input();x.mutation.data.inventorySetQuantities.userErrors=[{code:'CHANGE_FROM_QUANTITY_STALE',message:'Stale'}];
 assert.equal(run(x).status,'failed');
});
test('missing, malformed or transport-error mutation results remain uncertain',()=>{
 for(const mutation of [null,{}, {error:{}},{errors:[{}]},{errors:{}},{data:{inventorySetQuantities:{}}},{data:{inventorySetQuantities:{userErrors:[]}}},{data:{inventorySetQuantities:{userErrors:[],inventoryAdjustmentGroup:{}}}}]){
  const x=input();x.mutation=mutation;assert.equal(run(x).status,'unknown');
 }
});
test('changed requested quantities cannot use the null-group exception',()=>{
 const x=input();x.prepared.from_quantity=3;assert.equal(run(x).status,'unknown');
 x.prepared.from_quantity=4;x.prepared.quantity=5;assert.equal(run(x).status,'unknown');
});
test('stale, future and invalid snapshots remain uncertain',()=>{
 for(const time of [now+90001,now-3000])assert.equal(run(input(),time).status,'unknown');
 const x=input();x.prepared.read_at='bad';assert.equal(run(x).status,'unknown');
});
test('failed or missing readbacks do not complete an unchanged request',()=>{
 for(const readback of [null,{}, {error:{}},{errors:[{}]},{errors:{}}]){const x=input();x.readback=readback;assert.equal(run(x).status,'unknown');}
});
test('wrong variant, product, SKU, item, tracking or location cannot confirm',()=>{
 for(const mutate of [v=>v.id='wrong',v=>v.product.id='wrong',v=>v.sku='wrong',v=>v.inventoryItem.id='wrong',v=>v.inventoryItem.sku='wrong',v=>v.inventoryItem.tracked=false,v=>v.inventoryItem.inventoryLevels.nodes[0].location.id='wrong',v=>v.inventoryItem.inventoryLevels.nodes[0].location.isActive=false]){
  const x=input();mutate(x.readback.data.productVariant);assert.equal(run(x).status,'unknown');
 }
});
test('incomplete, shared or ambiguous inventory cannot confirm',()=>{
 for(const mutate of [i=>i.variants.pageInfo.hasNextPage=true,i=>i.variants.nodes.push({id:'other'}),i=>i.inventoryLevels.pageInfo.hasNextPage=true,i=>i.inventoryLevels.nodes.push(structuredClone(i.inventoryLevels.nodes[0]))]){
  const x=input();mutate(x.readback.data.productVariant.inventoryItem);assert.equal(run(x).status,'unknown');
 }
});
test('mismatched, missing, fractional or duplicate available quantities cannot confirm',()=>{
 for(const values of [[],[{name:'available',quantity:3}],[{name:'available',quantity:'4'}],[{name:'available',quantity:4.5}],[{name:'available',quantity:4},{name:'available',quantity:4}]]){
  const x=input();x.readback.data.productVariant.inventoryItem.inventoryLevels.nodes[0].quantities=values;assert.equal(run(x).status,'unknown');
 }
});
test('patch adds one read only and preserves mutation, other nodes, IDs and settings',()=>{
 const w=patch(source);assert.equal(w.nodes.length,31);assert.deepEqual(w.settings,source.settings);
 for(const old of source.nodes){const n=w.nodes.find(n=>n.name===old.name);assert.equal(n.id,old.id);if(old.name!==names.result)assert.deepEqual(n,old);}
 assert.deepEqual(w.connections[names.write].main[0],[{node:names.readback,type:'main',index:0}]);
 assert.deepEqual(w.connections[names.readback].main[0],[{node:names.result,type:'main',index:0}]);
 assert.deepEqual(w.connections[names.result],source.connections[names.result]);
 const read=w.nodes.find(n=>n.name===names.readback);assert.equal(read.retryOnFail,false);assert.equal(read.alwaysOutputData,true);assert.equal(read.parameters.options.timeout,12000);
});
test('generated n8n code uses original mutation and the new readback',()=>{
 const w=patch(source),x=input(),nodes={[names.write]:x.mutation,'Änderung vorbereiten':x.prepared,'Auftrag beanspruchen':x.claim,'Zuordnung prüfen':x.mapping};
 class Clock extends Date{static now(){return now;}}
 const result=vm.runInNewContext('(function(){'+w.nodes.find(n=>n.name===names.result).parameters.jsCode+'})()',{$json:x.readback,$:name=>({first:()=>({json:nodes[name]})}),Date:Clock});
 assert.equal(result[0].json.code,'SHOPIFY_UNCHANGED_CONFIRMED');
});
test('changed source, pinned data and repeated patch are refused',()=>{
 const x=structuredClone(source);x.nodes.find(n=>n.name===names.write).parameters.options.timeout=1;assert.throws(()=>patch(x),/Source changed/);
 assert.throws(()=>patch({...source,pinData:{unexpected:[{}]}}));assert.throws(()=>patch(patch(source)));
});
