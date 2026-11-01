const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(process.env.CART_HTML||path.join(__dirname,'../app/shop.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const key='sma:cart:v1:sma-testkunde';
const fixture=(id,price=39.9)=>({produkt_id:id,name:'Produkt '+id,preis:price,waehrung:'EUR',bestand:10,shopify_aktiv:true,bilder:[]});
const initial=[fixture('p2'),fixture('p1',34.9)];
class Element{
 constructor(){this.children=[];this.textContent='';this.style={};this.dataset={};this.events={};this.classList={add(){},remove(){},contains(){return false}}}
 append(...children){this.children.push(...children)}
 replaceChildren(...children){this.children=children}
 setAttribute(){}
 addEventListener(type,cb){this.events[type]=cb}
 querySelector(){return new Element()}
 focus(){}
 scrollIntoView(){}
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function boot({storage=new Map(),slug='sma-testkunde',products=initial,blocked=false,failFetch=false,enabled=false,checkoutFetch,confirm=true}={}){
 const redirects=[],requests=[];
 const els=new Map();const get=id=>{if(!els.has(id))els.set(id,new Element());return els.get(id)};
 const context={URL,URLSearchParams,Intl,console,setTimeout,clearTimeout,AbortController,
  location:{search:'?shop='+slug},document:{getElementById:get,createElement:()=>new Element(),activeElement:new Element(),body:new Element(),addEventListener(){}},
  window:{scrollTo(){},confirm(){assert.equal(enabled,true);return confirm},location:{assign(url){redirects.push(url)}}},
  localStorage:{getItem(k){if(blocked)throw Error('blocked');return storage.get(k)||null},setItem(k,v){if(blocked)throw Error('blocked');storage.set(k,v)},removeItem(k){if(blocked)throw Error('blocked');storage.delete(k)}},
  async fetch(url,options){if(options?.method==='POST'){requests.push(JSON.parse(options.body));return checkoutFetch(url,options)}if(failFetch)throw new Error('offline');const q=new URL(url).searchParams;const list=q.has('suche')?products.filter(p=>p.name.includes(q.get('suche'))):products;const page=Number(q.get('seite'))||1;return {ok:true,json:async()=>({ok:true,shop:{name:slug},gesamt:list.length,seiten:Math.ceil(list.length/10),produkte:list.slice((page-1)*10,page*10)})}}
 };
 vm.runInNewContext(enabled?script.replace('const CHECKOUT_PUBLIC_ENABLED = false;','const CHECKOUT_PUBLIC_ENABLED = true;'):script,context);await settle();
 const add=index=>get('grid').children[index].children[1].children.at(-1).onclick();
 const open=()=>get('cartOpen').onclick();
 const change=(row,delta)=>get('cartLines').children[row].children[1].children[2].children[delta>0?2:0].onclick();
 const total=()=>Number(String(get('cartTotal').textContent).replace(/[^0-9,]/g,'').replace(',','.'));
 const count=()=>Number(get('cartCount').textContent);
 return {get,add,open,change,total,count,storage,redirects,requests,checkout:()=>get('checkoutButton').events.click()};
}
test('cart survives reload after add, increase and decrease, then clears when emptied',async()=>{
 const a=await boot();a.add(0);a.add(1);a.open();assert.equal(a.total(),74.8);
 a.change(0,1);assert.equal(a.total(),114.7);a.change(0,-1);assert.equal(a.total(),74.8);
 const b=await boot({storage:a.storage});b.open();assert.equal(b.count(),2);assert.equal(b.total(),74.8);
 assert.equal(b.get('checkoutButton').disabled,true);
 b.change(0,-1);b.change(0,-1);assert.equal(b.count(),0);
 const c=await boot({storage:a.storage});assert.equal(c.count(),0);assert.equal(a.storage.has(key),false);
});
test('cart is isolated by merchant slug',async()=>{
 const a=await boot();a.add(0);
 const b=await boot({storage:a.storage,slug:'other-shop'});assert.equal(b.count(),0);
 const c=await boot({storage:a.storage});assert.equal(c.count(),1);
});
test('malformed and expired data do not break catalogue or restore items',async()=>{
 for(const raw of ['{broken',JSON.stringify({version:1,savedAt:0,items:[]}), 'x'.repeat(100001)]){
  const storage=new Map([[key,raw]]);const a=await boot({storage});assert.equal(a.count(),0);a.add(0);assert.equal(a.count(),1);
 }
});
test('blocked local storage leaves cart controls usable',async()=>{
 const a=await boot({blocked:true});a.add(0);a.add(1);a.open();assert.equal(a.total(),74.8);a.change(0,1);assert.equal(a.total(),114.7);
});
test('fresh catalogue prices and stock replace cached values',async()=>{
 const a=await boot();a.add(0);a.add(0);a.add(1);
 const products=[{...fixture('p2',45),bestand:1},{...fixture('p1',34.9),shopify_aktiv:false}];
 const b=await boot({storage:a.storage,products});b.open();assert.equal(b.count(),1);assert.equal(b.total(),45);
});
test('removed products disappear after a complete catalogue refresh',async()=>{
 const a=await boot();a.add(0);a.add(1);
 const b=await boot({storage:a.storage,products:[fixture('p1',34.9)]});b.open();assert.equal(b.count(),1);assert.equal(b.total(),34.9);
});
test('later-page cart items survive reload and search on another page',async()=>{
 const products=Array.from({length:11},(_,i)=>fixture('p'+i,10));
 const a=await boot({products});a.get('pager').children.find(p=>p.textContent==='2').onclick();await settle();a.add(0);
 const b=await boot({storage:a.storage,products});b.open();assert.equal(b.count(),1);assert.equal(b.total(),10);
 b.get('queryDesktop').events.input({target:{value:'Produkt p0'}});await new Promise(resolve=>setTimeout(resolve,400));
 b.open();assert.equal(b.count(),1);assert.equal(b.total(),10);
});
test('invalid entries, duplicates and quantities cannot bypass cart bounds',async()=>{
 const product={id:'p2',title:'Cached',price:39.9,currency:'EUR',stock:100,shopifyReady:true,images:['javascript:bad']};
 const items=[{product,qty:999},{product,qty:2},{product:{...product,id:'p3'},qty:999},{product:{...product,id:'p4'},qty:999},
  {product:{...product,id:'p5'},qty:1.5},{product:{...product,id:'p6'},qty:-1}];
 const storage=new Map([[key,JSON.stringify({version:1,savedAt:Date.now(),items})]]);
 const a=await boot({storage,products:Array.from({length:11},(_,i)=>({...fixture('p'+i),bestand:100}))});a.open();assert.equal(a.count(),40);
 for(const row of a.get('cartLines').children)assert.ok(Number(row.children[1].children[2].children[1].textContent)<=20);
 assert.equal(a.get('checkoutButton').disabled,true);
});
test('only public product data and quantities are stored',async()=>{
 const a=await boot();a.add(0);const saved=JSON.parse(a.storage.get(key));
 assert.deepEqual(Object.keys(saved).sort(),['items','savedAt','version']);
 assert.deepEqual(Object.keys(saved.items[0].product).sort(),['currency','id','images','price','shopifyReady','stock','title']);
});

const checkoutReply=(patch={})=>({ok:true,shop:'sma-testkunde',modus:'shopify_live',shopify_domain:'test-store.myshopify.com',
 checkout_url:'https://test-store.myshopify.com/cart/58648962433355:1',positionen:1,gesamtmenge:1,
 warenkorb:[{produkt_id:'p2',variante:'58648962433355',menge:1,bestand:10,einzelpreis:39.9,summe:39.9}],gesamtbetrag:39.9,waehrung:'EUR',...patch});
const response=(data,status=200)=>({ok:status===200,status,json:async()=>data});
test('public release stays disabled even if a caller manually triggers checkout',async()=>{
 const a=await boot();a.add(0);await a.checkout();assert.equal(a.requests.length,0);assert.equal(a.redirects.length,0);
});
test('enabled checkout submits only IDs and quantities and redirects to the verified cart',async()=>{
 const a=await boot({enabled:true,checkoutFetch:async()=>response(checkoutReply())});a.add(0);await a.checkout();
 assert.equal(a.redirects[0],checkoutReply().checkout_url);
 assert.deepEqual(a.requests,[{shop:'sma-testkunde',items:[{produkt_id:'p2',menge:1}]}]);
});
test('price change updates the preview and requires another confirmation before redirecting',async()=>{
 const data=checkoutReply({gesamtbetrag:42,warenkorb:[{...checkoutReply().warenkorb[0],einzelpreis:42,summe:42}]});
 const a=await boot({enabled:true,checkoutFetch:async()=>response(data)});a.add(0);await a.checkout();
 assert.equal(a.redirects.length,0);assert.equal(a.total(),42);assert.match(a.get('checkoutStatus').textContent,/Preise wurden aktualisiert/);
 await a.checkout();assert.equal(a.redirects.length,1);assert.equal(a.requests.length,2);
});
test('network errors and stock conflicts recover quantity buttons without losing the cart',async()=>{
 for(const checkoutFetch of [async()=>{throw Error('offline')},async()=>response({ok:false,message:'Gewünschte Menge nicht verfügbar'},409)]){
  const a=await boot({enabled:true,checkoutFetch});a.add(0);await a.checkout();
  assert.equal(a.redirects.length,0);assert.equal(a.count(),1);
  assert.equal(a.get('cartLines').children[0].children[1].children[2].children[2].disabled,false);
  a.change(0,1);assert.equal(a.count(),2);assert.equal(a.get('checkoutButton').disabled,false);
 }
});
test('wrong shop, modified quantities, variants, totals and destinations never redirect',async()=>{
 const invalid=[{shop:'other'},{checkout_url:'https://evil.myshopify.com/cart/58648962433355:1'},
  {checkout_url:checkoutReply().checkout_url+'?x=1'},{checkout_url:'https://test-store.myshopify.com/cart/58648962433355:2'},
  {gesamtbetrag:0},{warenkorb:[]},{warenkorb:[{...checkoutReply().warenkorb[0],menge:2}]},
  {warenkorb:[{...checkoutReply().warenkorb[0],bestand:0}]}];
 for(const patch of invalid){const a=await boot({enabled:true,checkoutFetch:async()=>response(checkoutReply(patch))});a.add(0);await a.checkout();assert.equal(a.redirects.length,0);assert.equal(a.get('checkoutStatus').dataset.tone,'error');}
});
test('cancel and repeated clicks cannot create multiple checkout requests',async()=>{
 const cancelled=await boot({enabled:true,confirm:false});cancelled.add(0);await cancelled.checkout();assert.equal(cancelled.requests.length,0);
 let release;
 const a=await boot({enabled:true,checkoutFetch:()=>new Promise(resolve=>release=resolve)});a.add(0);
 const first=a.checkout();await a.checkout();a.add(1);assert.equal(a.requests.length,1);assert.equal(a.count(),1);
 release(response(checkoutReply()));await first;assert.equal(a.redirects.length,1);
});
test('mixed currencies cannot be summed or submitted; a single non-EUR currency is labelled correctly',async()=>{
 const a=await boot({enabled:true,products:[fixture('p2'),{...fixture('p1'),waehrung:'USD'}]});a.add(0);a.add(1);a.open();
 assert.equal(a.get('checkoutButton').disabled,true);assert.match(a.get('cartTotal').textContent,/Unterschiedliche/);await a.checkout();assert.equal(a.requests.length,0);
 a.change(0,-1);assert.match(a.get('cartTotal').textContent,/\$/);assert.equal(a.get('checkoutButton').disabled,false);
});
test('frontend and actual public handler agree on two products and independent quantities',async()=>{
 const {createHandler}=require('../supabase/functions/sma-shop-checkout/handler.ts');
 const id='10c2f5a9-0571-4023-a1d6-df871813e1a7',id2='5f58fb20-945b-4006-bffe-b199c15c3ffe';
 const products=[fixture(id),fixture(id2,34.9)];
 const tables={sma_kunden:[{id:4,user_id:'owner',kunde_id:'customer',shop_slug:'sma-testkunde',aktiv:true,shop_oeffentlich:true,demo_delta_aktiv:true}],
  sma_shopify_konten:[{sma_kunden_id:4,markt_konto_id:'account',shopify_domain:'test-store.myshopify.com',aktiv:true}],
  sma_produkte:products.map((p,i)=>({...p,sma_produkt_id:p.produkt_id,produkt_name:p.name,user_id:'owner',kunde_id:'customer',aktiv:true,kauf_url:'https://test-store.myshopify.com/cart/'+(i?'58641727521099':'58648962433355')+':1'}))};
 const db={from(table){let data=tables[table],single=false;const q={select(){return q},eq(k,v){data=data.filter(p=>p[k]===v);return q},in(k,v){data=data.filter(p=>v.includes(p[k]));return q},limit(n){data=data.slice(0,n);return q},maybeSingle(){single=true;return q},then(resolve){resolve({data:single?data[0]:data,error:null})}};return q}};
 const handler=createHandler(()=>true);
 const a=await boot({enabled:true,products,checkoutFetch:async(url,options)=>handler(new Request(url,options),{supabaseAdmin:db})});
 a.add(0);a.add(0);a.add(1);a.open();assert.equal(a.total(),114.7);await a.checkout();
 assert.equal(a.redirects[0],'https://test-store.myshopify.com/cart/58648962433355:2,58641727521099:1');
});

