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
async function boot({storage=new Map(),slug='sma-testkunde',products=initial,blocked=false,failFetch=false}={}){
 const els=new Map();const get=id=>{if(!els.has(id))els.set(id,new Element());return els.get(id)};
 const context={URL,URLSearchParams,Intl,console,setTimeout,clearTimeout,AbortController,
  location:{search:'?shop='+slug},document:{getElementById:get,createElement:()=>new Element(),activeElement:new Element(),body:new Element(),addEventListener(){}},
  window:{scrollTo(){},confirm(){throw new Error('Checkout must stay disabled')},location:{assign(){throw new Error('No checkout redirect expected')}}},
  localStorage:{getItem(k){if(blocked)throw Error('blocked');return storage.get(k)||null},setItem(k,v){if(blocked)throw Error('blocked');storage.set(k,v)},removeItem(k){if(blocked)throw Error('blocked');storage.delete(k)}},
  async fetch(url){if(failFetch)throw new Error('offline');const q=new URL(url).searchParams;const list=q.has('suche')?products.filter(p=>p.name.includes(q.get('suche'))):products;const page=Number(q.get('seite'))||1;return {ok:true,json:async()=>({ok:true,shop:{name:slug},gesamt:list.length,seiten:Math.ceil(list.length/10),produkte:list.slice((page-1)*10,page*10)})}}
 };
 vm.runInNewContext(script,context);await settle();
 const add=index=>get('grid').children[index].children[1].children.at(-1).onclick();
 const open=()=>get('cartOpen').onclick();
 const change=(row,delta)=>get('cartLines').children[row].children[1].children[2].children[delta>0?2:0].onclick();
 const total=()=>Number(String(get('cartTotal').textContent).replace(/[^0-9,]/g,'').replace(',','.'));
 const count=()=>Number(get('cartCount').textContent);
 return {get,add,open,change,total,count,storage};
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
