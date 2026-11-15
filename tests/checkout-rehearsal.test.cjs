const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHandler}=require('../supabase/functions/sma-shop-checkout-test/handler.ts');
const id='10c2f5a9-0571-4023-a1d6-df871813e1a7', id2='5f58fb20-945b-4006-bffe-b199c15c3ffe';
const product={sma_produkt_id:id,produkt_name:'Testprodukt',user_id:'owner',kunde_id:'customer',aktiv:true,shopify_aktiv:true,bestand:6,preis:39.9,waehrung:'EUR',kauf_url:'https://test-store.myshopify.com/cart/58648962433355:1'};
const body=(items=[{produkt_id:id,menge:1}])=>({shop:'sma-testkunde',items});
function app({user='owner',customer={},account={},products=[product],dbError=false}={}){
 const tables={sma_kunden:[{id:4,user_id:'owner',kunde_id:'customer',shop_slug:'sma-testkunde',aktiv:true,shop_oeffentlich:true,demo_delta_aktiv:true,...customer}],sma_shopify_konten:[{sma_kunden_id:4,markt_konto_id:'account',shopify_domain:'test-store.myshopify.com',aktiv:false,...account}],sma_produkte:products};
 const db={from(table){let data=tables[table];let single=false;const q={select(){return q},eq(k,v){data=data.filter(x=>x[k]===v);return q},in(k,v){data=data.filter(x=>v.includes(x[k]));return q},limit(n){data=data.slice(0,n);return q},maybeSingle(){single=true;return q},then(resolve){resolve({data:single?data[0]||null:data,error:dbError?Error('db'):null})}};return q}};
 return createHandler(async()=>({data:user?{userClaims:{id:user},supabaseAdmin:db}:null,error:user?null:Error('auth')}));
}
async function request(handler,input=body(),extra={}){const r=await handler(new Request('https://test.invalid',{method:'POST',headers:{Origin:'https://sma-automation.com'},body:JSON.stringify(input),...extra}));return {status:r.status,headers:r.headers,data:r.status===204?null:await r.json()};}
test('owner gets a fresh server-priced rehearsal with no URL or mutation',async()=>{
 const r=await request(app(),{...body([{produkt_id:id,menge:2}]),preis:0,user_id:'attacker',domain:'evil.invalid'});
 assert.equal(r.status,200);assert.equal(r.data.gesamtbetrag,79.8);assert.equal(r.data.gesamtmenge,2);
 assert.equal(r.data.checkout_url,null);assert.equal(r.data.zahlung_ausgeloest,false);assert.equal(r.data.haendler_freigegeben,false);
 assert.equal(r.headers.get('Cache-Control'),'no-store');
});
test('two products use independent quantities and accurate decimal totals',async()=>{
 const r=await request(app({products:[product,{...product,sma_produkt_id:id2,preis:34.9,kauf_url:'https://test-store.myshopify.com/cart/58641727521099:1'}]}),body([{produkt_id:id,menge:1},{produkt_id:id2,menge:1}]));assert.equal(r.status,200);assert.equal(r.data.gesamtbetrag,74.8);assert.equal(r.data.positionen,2);
});
test('unauthenticated calls fail; another valid user cannot test the owner shop',async()=>{
 assert.equal((await request(app({user:null}))).status,401);assert.equal((await request(app({user:'other'}))).status,404);
});
test('product ownership and both customer entitlements are enforced',async()=>{
 for(const config of [{products:[{...product,user_id:'other'}]},{products:[{...product,kunde_id:'other'}]},{customer:{aktiv:false}},{customer:{shop_oeffentlich:false}},{customer:{demo_delta_aktiv:false,zahlung_bestaetigt:false}}])assert.notEqual((await request(app(config))).status,200);
});
test('malformed carts, limits and case-variant duplicates are rejected',async()=>{
 const bad=[null,[],{},body([]),body([{produkt_id:id,menge:'1'}]),body([{produkt_id:id,menge:0}]),body([{produkt_id:id,menge:1.5}]),body([{produkt_id:id,menge:21}]),body([{produkt_id:id,menge:1},{produkt_id:id.toUpperCase(),menge:1}]),{...body(),shop:'other'}];
 for(const b of bad)assert.ok((await request(app(),b)).status>=400);
 const items=Array.from({length:21},(_,i)=>({produkt_id:`00000000-0000-0000-0000-${String(i).padStart(12,'0')}`,menge:1}));assert.equal((await request(app(),body(items))).status,400);
 assert.equal((await request(app(),body(items.slice(0,3).map(i=>({...i,menge:20}))))).status,400);
});
test('current stock, null stock and product activation are checked',async()=>{
 assert.equal((await request(app(),body([{produkt_id:id,menge:7}]))).status,409);
 for(const patch of [{bestand:null},{bestand:0},{aktiv:false},{shopify_aktiv:false}])assert.equal((await request(app({products:[{...product,...patch}]}))).status,409);
});
test('foreign targets, URL credentials, suffixes and variant aliases are rejected',async()=>{
 for(const url of ['https://evil.myshopify.com/cart/58648962433355:1','http://test-store.myshopify.com/cart/58648962433355:1','https://test-store.myshopify.com.evil.invalid/cart/58648962433355:1','https://user@test-store.myshopify.com/cart/58648962433355:1','https://test-store.myshopify.com/cart/58648962433355:1?x=1','https://test-store.myshopify.com/cart/58648962433355:1#x','https://test-store.myshopify.com/products/x'])assert.equal((await request(app({products:[{...product,kauf_url:url}]}))).status,409);
 assert.equal((await request(app({products:[product,{...product,sma_produkt_id:id2}]}),body([{produkt_id:id,menge:1},{produkt_id:id2,menge:1}]))).status,409);
});
test('invalid prices and mixed currencies cannot produce a successful total',async()=>{
 for(const patch of [{preis:null},{preis:-1},{preis:'bad'},{waehrung:''}])assert.equal((await request(app({products:[{...product,...patch}]}))).status,409);
 const r=await request(app({products:[product,{...product,sma_produkt_id:id2,waehrung:'USD',kauf_url:'https://test-store.myshopify.com/cart/58641727521099:1'}]}),body([{produkt_id:id,menge:1},{produkt_id:id2,menge:1}]));assert.equal(r.status,409);
});
test('CORS preflight, foreign origin, unsupported method and bad JSON',async()=>{
 assert.equal((await request(app({user:null}),null,{method:'OPTIONS',body:undefined})).status,204);
 assert.equal((await request(app(),body(),{headers:{Origin:'https://evil.invalid'}})).status,403);
 assert.equal((await request(app(),null,{method:'GET',body:undefined})).status,405);
 assert.equal((await request(app(),null,{body:'{broken'})).status,400);
 assert.equal((await request(app(),null,{body:'x'.repeat(8193)})).status,413);
});


test('dry-run rejects fractional cents rather than reporting a false successful checkout',async()=>{
 for(const price of [0.001,1.234,39.999,'10.005','0.001','12.3001','39.900001','1e2','39.90 ','12.','.5',true,[],{},'NaN',Infinity,1e20]){
  const r=await request(app({products:[{...product,preis:price}]}));
  assert.equal(r.status,409,'reject fractional or invalid price '+String(price));
  assert.equal(r.data.checkout_url,null);
  assert.equal(r.data.zahlung_ausgeloest,false);
 }
});

test('dry-run accepts only exact cents and aggregates in integer cents like production',async()=>{
 for(const [price,total] of [['0.01',0.03],['12.30',36.9],['12.3000',36.9],['0.0000',0],[39.9,119.7],[0.1,0.3],[0.29,0.87]]){
  const r=await request(app({products:[{...product,preis:price}]}),body([{produkt_id:id,menge:3}]));
  assert.equal(r.status,200,'valid exact-cent amount '+String(price));
  assert.equal(r.data.gesamtbetrag,total);
  assert.equal(r.data.checkout_url,null);
  assert.equal(r.data.zahlung_ausgeloest,false);
 }
 const mixed=await request(app({products:[
  {...product,preis:'19.99'},
  {...product,sma_produkt_id:id2,preis:'0.01',kauf_url:'https://test-store.myshopify.com/cart/58641727521099:1'},
 ]}),body([{produkt_id:id,menge:2},{produkt_id:id2,menge:1}]));
 assert.equal(mixed.status,200);
 assert.equal(mixed.data.gesamtbetrag,39.99);
 assert.equal(mixed.data.positionen,2);
});

test('dry-run validates positive Shopify variant IDs and stored cart quantities like public checkout',async()=>{
 for(const url of [
  'https://test-store.myshopify.com/cart/00000000000000:1',
  'https://test-store.myshopify.com/cart/58648962433355:0',
  'https://test-store.myshopify.com/cart/58648962433355:01',
  'https://test-store.myshopify.com/cart/58648962433355:1?utm_source=bad'
 ]){
  const r=await request(app({products:[{...product,kauf_url:url}]}));
  assert.equal(r.status,409,'reject invalid checkout target '+url);
  assert.equal(r.data.checkout_url,null);
 }
});

test('disabled merchant can inspect preparation but is never announced as publicly enabled',async()=>{
 const inactive=await request(app());
 assert.equal(inactive.status,200);
 assert.equal(inactive.data.haendler_freigegeben,false);
 assert.match(inactive.data.message,/Händlerfreigabe.*fehlt/);
 assert.doesNotMatch(inactive.data.message,/Test bestanden/);
 const active=await request(app({account:{aktiv:true}}));
 assert.equal(active.status,200);
 assert.equal(active.data.haendler_freigegeben,true);
 assert.match(active.data.message,/Test bestanden/);
 assert.equal(active.data.checkout_url,null);
});
