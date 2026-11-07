const {test}=require('node:test');const assert=require('node:assert/strict');
const id='fa660000-0000-4000-8000-000000000001';
const binding={asset_id:'asset',asset_revision:'version:1',assignment_revision:2,preview_id:'preview',preview_revision:3,platform:'youtube'};
const review={content_checked:true,media_rights:true,music_rights:true};
const policy='media-consent-2026-11-03.1';
const choices={visibility:'private',made_for_kids:false,contains_synthetic_media:false};
async function setup(handler){
 const {createOrderClient}=await import('../app/assets/publication-order.mjs');let ids=0;const requests=[];
 const client=createOrderClient({session:async()=>({access_token:'test-jwt'}),uuid:()=>id.slice(0,-1)+(++ids),fetcher:async(url,options)=>{const body=JSON.parse(options.body);requests.push({url,options,body});return handler(body,requests.length);}});
 return {client,requests};
}
const ok=(id,patch={})=>({ok:true,json:async()=>({ok:true,id,can_upload:false,can_publish:false,state:'prepared',target:{id:'target'},approval_token:'token',...patch})});
test('lost responses reuse the order ID and preserve the complete selection',async()=>{
 const {client,requests}=await setup((body,n)=>{if(n===1)throw Error('lost response');return ok(body.input.id);});
 await assert.rejects(client.prepare(binding,choices),error=>error.preparationId===id);await client.prepare(binding,choices);
 assert.deepEqual(requests[0].body,requests[1].body);assert.deepEqual(requests[1].body.input,{id,...binding,choices});
 assert.equal(requests[0].options.credentials,'omit');assert.equal(requests[0].options.cache,'no-store');
 await client.prepare({...binding,asset_revision:'version:2'},choices);assert.notEqual(requests[2].body.input.id,id);
});
test('final approval requires explicit confirmation and sends only bound token and ID',async()=>{
 const {client,requests}=await setup(body=>ok(body.input.id,{state:'blocked'}));
 const order={id,state:'prepared',target:{id:'target'},approval_token:'token',binding,choices,approval_policy:policy};
 for(const value of [false,undefined,'true'])assert.throws(()=>client.approve(order,value));
 for(const state of ['approved','cancelled'])assert.throws(()=>client.approve({...order,state},true));assert.equal(requests.length,0);
 assert.throws(()=>client.approve(order,true));
 await client.approve(order,true,review);assert.deepEqual(requests[0].body,{action:'approve',input:{id,approval_token:'token',confirm:true,review:{policy_version:policy,...review,tiktok_music_terms:false,tiktok_branded_terms:false}}});
});
test('cancelled status is readable but never becomes a new approval',async()=>{
 const {client,requests}=await setup(body=>ok(body.input.id,{state:'cancelled',approval_token:null}));
 const order=await client.get(id);assert.equal(order.state,'cancelled');
 assert.deepEqual(requests[0].body,{action:'get',input:{id}});
 assert.throws(()=>client.approve(order,true));assert.equal(requests.length,1);
 for(const patch of [{id:'other'},{can_publish:true},{can_upload:true}]){
  const p=await setup(body=>ok(body.input.id,{state:'cancelled',...patch}));
  await assert.rejects(p.client.get(id));
 }
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

test('account preflight sends only the requested portal and rejects mismatched provider identity',async()=>{
 const {client,requests}=await setup(body=>ok(body.input.id,{stage:'account',target:{id:'verified',platform:body.input.platform},account_check:{target_id:'verified'}}));
 const account=await client.account('tiktok');assert.equal(account.target.id,'verified');
 assert.deepEqual(Object.keys(requests[0].body.input).sort(),['id','platform']);assert.equal(requests[0].body.action,'account');
 const bad=await setup(body=>ok(body.input.id,{stage:'account',target:{id:'verified',platform:'youtube'},account_check:{target_id:'foreign'}}));
 await assert.rejects(bad.client.account('tiktok'));
});

test('media declarations require the current policy and every explicit boolean',async()=>{
 const {reviewConfirmation}=await import('../app/assets/publication-order.mjs');
 const order={binding,choices,approval_policy:policy};
 for(const value of [undefined,{},null,{...review,content_checked:false},{...review,media_rights:'true'},{...review,music_rights:1}])assert.throws(()=>reviewConfirmation(order,value));
 for(const approval_policy of [undefined,'older-policy'])assert.throws(()=>reviewConfirmation({...order,approval_policy},review));
 for(const platform of ['youtube','instagram','facebook'])assert.deepEqual(reviewConfirmation({...order,binding:{...binding,platform}},review),{policy_version:policy,...review,tiktok_music_terms:false,tiktok_branded_terms:false});
});

test('TikTok music consent always applies; third-party advertising additionally needs branded consent',async()=>{
 const {reviewConfirmation}=await import('../app/assets/publication-order.mjs');
 for(const own of [false,true])for(const third of [false,true]){
  const order={binding:{...binding,platform:'tiktok'},choices:{brand_content_toggle:third,brand_organic_toggle:own},approval_policy:policy};
  assert.throws(()=>reviewConfirmation(order,review));
  if(third)assert.throws(()=>reviewConfirmation(order,{...review,tiktok_music_terms:true}));
  const result=reviewConfirmation(order,{...review,tiktok_music_terms:true,tiktok_branded_terms:third});
  assert.equal(result.tiktok_music_terms,true);assert.equal(result.tiktok_branded_terms,third);
 }
});

test('preflight requires a nonempty target even if both response identifiers are missing',async()=>{
 for(const targetId of [undefined,'','   ']){
  const {client}=await setup(body=>ok(body.input.id,{stage:'account',target:{id:targetId,platform:'youtube'},account_check:{target_id:targetId}}));
  await assert.rejects(client.account('youtube'));
 }
});
