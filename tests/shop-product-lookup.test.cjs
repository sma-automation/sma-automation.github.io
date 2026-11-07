const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {stripTypeScriptTypes}=require('node:module');
const vm=require('node:vm');

const source=readFileSync('supabase/functions/sma-shop-produkte/index.ts','utf8')
 .replace(/^import .*;$/m,'').replace('export default {','globalThis.endpoint = {');
const scope={URL,Response,console,withSupabase:(_auth,handler)=>handler};
vm.runInNewContext(stripTypeScriptTypes(source),scope);

function fixture(){
 const shops=[{user_id:'one',kunde_id:'K1',shop_slug:'shop-one',shop_oeffentlich:true,aktiv:true,zahlung_bestaetigt:true},
  {user_id:'two',kunde_id:'K2',shop_slug:'shop-two',shop_oeffentlich:true,aktiv:true,demo_delta_aktiv:true}];
 const product=(id,name='Product')=>({sma_produkt_id:id,user_id:'one',kunde_id:'K1',aktiv:true,
  produkt_name:name,preis:10,bestand:1,bild_pfade:[]});
 const products=Array.from({length:16},(_,i)=>product('p'+i));
 products.push({...product('same','Owner one'),bild_pfade:['one/same/photo.png','two/same/foreign.png']},
  {...product('same','Owner two'),user_id:'two',kunde_id:'K2'},
  {...product('mixed'),kunde_id:'K2'},{...product('wrong-owner'),user_id:'two'},{...product('inactive'),aktiv:false});
 const signed=[],tables=[];
 const db={from(name){
  tables.push(name);
  let rows=[...(name==='sma_kunden'?shops:products)];
  return {select(){return this;},eq(field,value){rows=rows.filter(row=>row[field]===value);return this;},
   ilike(field,pattern){rows=rows.filter(row=>row[field].includes(pattern.slice(1,-1)));return this;},order(){return this;},
   async maybeSingle(){return {data:rows.length===1?rows[0]:null};},
   async range(start,end){return {data:rows.slice(start,end+1),count:rows.length};}};
 },storage:{from(){return {async createSignedUrls(paths){signed.push(...paths);return {data:[]};}};}}};
 const get=(search,method='GET')=>scope.endpoint.fetch(new Request('https://example.invalid/?'+search,{method}),{supabaseAdmin:db});
 return {shops,products,signed,tables,get};
}

test('public lookup reaches a product beyond page one and exposes only its own active shop row and images',async()=>{
 const t=fixture(),list=await (await t.get('shop=shop-one&seite=1')).json();assert.equal(list.produkte.length,10);
 assert.ok(!list.produkte.some(p=>p.produkt_id==='same'));assert.equal(list.produkt_filter,undefined);
 for(const [shop,name] of [['shop-one','Owner one'],['shop-two','Owner two']]){
  const r=await t.get('shop='+shop+'&produkt=same');assert.equal(r.status,200);
  const data=await r.json();assert.equal(data.shop.slug,shop);assert.equal(data.produkt_filter,'same');
  assert.equal(data.gesamt,1);assert.deepEqual(data.produkte.map(p=>[p.produkt_id,p.name]),[['same',name]]);
  assert.ok(!('user_id' in data.produkte[0]));
 }
 assert.deepEqual(t.signed,['one/same/photo.png']);
});
test('invalid, ambiguous, unavailable and cross-shop product links expose no product',async()=>{
 const t=fixture();
 for(const q of ['shop=shop-one&produkt=','shop=shop-one&produkt=p1&produkt=p2','shop=shop-one&shop=shop-two&produkt=p1',
  'shop=shop-one&produkt=a%2Fb','shop=shop-one&produkt=p1&suche=x','shop=shop-one&produkt=p1&seite=2']){
  assert.equal((await t.get(q)).status,400);
 }
 assert.equal((await t.get('shop=shop-one&produkt=p1','POST')).status,405);assert.equal(t.tables.length,0);
 for(const id of ['missing','inactive','mixed','wrong-owner'])assert.equal((await t.get('shop=shop-one&produkt='+id)).status,404);
 t.products.push({...t.products[0]});assert.equal((await t.get('shop=shop-one&produkt=p0')).status,404);
 t.shops[0].shop_oeffentlich=false;assert.equal((await t.get('shop=shop-one&produkt=same')).status,404);
 t.shops[0].shop_oeffentlich=true;t.shops[0].zahlung_bestaetigt=false;assert.equal((await t.get('shop=shop-one&produkt=same')).status,404);
 assert.equal(t.signed.length,0);
});
