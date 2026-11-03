const {test}=require('node:test');const assert=require('node:assert/strict');
const id='fa660000-0000-4000-8000-000000000001';
const binding={asset_id:'asset',asset_revision:'version:1',assignment_revision:2,preview_id:'preview',preview_revision:3,platform:'youtube'};
const choices={visibility:'private',made_for_kids:false,contains_synthetic_media:false};
async function setup(handler){
 const {createOrderClient}=await import('../app/assets/publication-order.mjs');let ids=0;const requests=[];
 const client=createOrderClient({session:async()=>({access_token:'test-jwt'}),uuid:()=>id.slice(0,-1)+(++ids),fetcher:async(url,options)=>{const body=JSON.parse(options.body);requests.push({url,options,body});return handler(body,requests.length);}});
 return {client,requests};
}
const ok=(id,patch={})=>({ok:true,json:async()=>({ok:true,id,can_upload:false,can_publish:false,state:'prepared',target:{id:'target'},approval_token:'token',...patch})});
test('lost responses reuse the order ID and preserve the complete selection',async()=>{
 const {client,requests}=await setup((body,n)=>{if(n===1)throw Error('lost response');return ok(body.input.id);});
 await assert.rejects(client.prepare(binding,choices));await client.prepare(binding,choices);
 assert.deepEqual(requests[0].body,requests[1].body);assert.deepEqual(requests[1].body.input,{id,...binding,choices});
 assert.equal(requests[0].options.credentials,'omit');assert.equal(requests[0].options.cache,'no-store');
 await client.prepare({...binding,asset_revision:'version:2'},choices);assert.notEqual(requests[2].body.input.id,id);
});
test('final approval requires explicit confirmation and sends only bound token and ID',async()=>{
 const {client,requests}=await setup(body=>ok(body.input.id,{state:'blocked'}));
 const order={id,state:'prepared',target:{id:'target'},approval_token:'token'};
 for(const value of [false,undefined,'true'])assert.throws(()=>client.approve(order,value));
 assert.throws(()=>client.approve({...order,state:'approved'},true));assert.equal(requests.length,0);
 await client.approve(order,true);assert.deepEqual(requests[0].body,{action:'approve',input:{id,approval_token:'token',confirm:true}});
});
test('client rejects another order or an unexpected publish grant',async()=>{
 for(const patch of [{id:'other'},{can_publish:true},{can_upload:true},{state:'published'}]){
  const {client}=await setup(body=>ok(body.input.id,patch));await assert.rejects(client.prepare(binding,choices));
 }
});
test('duplicate response preserves existing order reference for status lookup',async()=>{
 const {client}=await setup(()=>({ok:true,json:async()=>({ok:false,code:'DUPLICATE_PUBLICATION',existing_order_id:id})}));
 await assert.rejects(client.prepare(binding,choices),error=>error.code==='DUPLICATE_PUBLICATION'&&error.existingId===id);
});
