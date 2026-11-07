const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../app/shop-manager.html'), 'utf8');
const moduleCode = html.split('<script type="module">')[1].split('</script>')[0];
const source = moduleCode.replace(/^import .*;$/gm, '').split('if(window.self===window.top)')[0];

class Element {
  constructor(tag='div') {
    this.tagName=tag;this.children=[];this.events={};this.value='';this.textContent='';
    this.className='';this.dataset={};this.style={};this.disabled=false;this.isConnected=true;
    this.classList={add(){},remove(){},toggle(){},contains(){return true;}};
  }
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,fn){this.events[name]=fn;}
  querySelector(){return null;}
  focus(){this.focused=true;}
  select(){this.selected=true;}
}
function harness(extraGlobals={}){
  const nodes=new Map(),timers=new Map(),queries=[],docEvents={},winEvents={};
  let timerId=0,now=100000,respond=()=>({data:[],error:null});
  const document={hidden:false,activeElement:null,
    createElement:tag=>new Element(tag),
    getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},
    addEventListener:(event,fn)=>docEvents[event]=fn,body:new Element()};
  const supabase={from(table){
    const query={table,filters:[],operation:'select'};
    const builder={
      select(columns){query.columns=columns;return this;},
      eq(column,value){query.filters.push([column,value]);return this;},
      in(column,value){query.filters.push([column,value]);return this;},
      order(){return this;},range(){return this;},
      abortSignal(signal){query.signal=signal;return this;},
      insert(value){query.operation='insert';query.value=value;return this;},
      update(value){query.operation='update';query.value=value;return this;},
      single(){return this;},maybeSingle(){return this;},
      then(resolve,reject){queries.push(query);return Promise.resolve().then(()=>respond(query)).then(resolve,reject);}
    };return builder;
  }};
  class Clock extends Date {static now(){return now;}}
  const context=vm.createContext({...extraGlobals,document,window:{addEventListener:(e,f)=>winEvents[e]=f},
    createClient:()=>supabase,Intl,AbortController,AbortSignal,Date:Clock,console,
    setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},
    clearTimeout:id=>timers.delete(id)});
  vm.runInContext(source+`
    globalThis.api={makeStockEditor,makeProductCard,renderProductList,refreshStock,stockRefreshDelay,scheduleStockRefresh,
      acceptStockRequests,readStockRequests,editors:stockEditors,requests:()=>stockRequestsState,
      init(products){currentUserId='owner';currentCustomerId='customer';productsState=products;},
      publicShop(slug){publicShopSlug=slug;},
      setProducts(products){productsState=products;paginationState.products.request++;},
      fast(){stockFastUntil=Date.now()+120000;},
      state(){return {products:productsState,error:stockRequestsError,running:stockRefreshRunning,page:paginationState.products.page};}
    };`,context);
  return {api:context.api,document,nodes,timers,queries,docEvents,winEvents,
    respond:fn=>respond=fn,advance:ms=>now+=ms};
}
const product=(id='product-1')=>({sma_produkt_id:id,produkt_name:'Test',shopify_aktiv:true,bestand:6,sku:'TEST'});
const request=(status,quantity=5)=>({id:'request-1',sma_produkt_id:'product-1',status,gewuenscht_verfuegbar:quantity,created_at:'2026-11-01T11:00:00Z'});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const submit=form=>form.events.submit({preventDefault(){}});

test('refresh changes confirmed stock without replacing cards, focus or an unsaved draft',async()=>{
  const h=harness(),p=product();h.api.init([p]);h.api.renderProductList();
  const card=h.nodes.get('produktListe').children[0],editor=h.api.editors.get('product-1');
  editor.input.value='17';editor.input.events.input();h.document.activeElement=editor.input;
  h.respond(q=>({data:q.table==='sma_produkte'?[{sma_produkt_id:p.sma_produkt_id,bestand:4}]:[],error:null}));
  await h.api.refreshStock();
  assert.equal(p.bestand,4);assert.equal(editor.input.value,'17');
  assert.equal(h.document.activeElement,editor.input);assert.equal(h.nodes.get('produktListe').children[0],card);
  assert.match(card.children[1].children[1].textContent,/Bestand: 4/);
  assert.equal(h.api.state().page,1);
});

test('submit keeps actual quantity until confirmation, follows applied request, then uses idle interval',async()=>{
  const h=harness(),p=product();h.api.init([p]);const form=h.api.makeStockEditor(p),e=h.api.editors.get('product-1');
  e.input.value='5';e.input.events.input();
  h.respond(q=>({data:q.operation==='insert'?request('queued'):[],error:null}));
  await submit(form);
  assert.equal(p.bestand,6);assert.equal(e.input.value,'5');assert.match(e.feedback.textContent,/vorgemerkt/);
  assert.equal(h.api.stockRefreshDelay(),2000);
  h.respond(q=>({data:q.table==='sma_produkte'?[{sma_produkt_id:p.sma_produkt_id,bestand:5}]:
    q.filters.some(([key])=>key==='id')?[request('applied')]:[],error:null}));
  await h.api.refreshStock();
  assert.equal(p.bestand,5);assert.match(e.feedback.textContent,/bestätigt: 5/);assert.equal(e.save.disabled,false);
  assert.equal(h.api.stockRefreshDelay(),30000);
  const reads=h.queries.filter(q=>q.table==='sma_bestandsauftraege'&&q.operation==='select');
  assert.ok(reads.every(q=>q.filters.some(([key,v])=>key==='kunde_id'&&v==='customer')));
  assert.ok(reads.every(q=>!q.columns.includes('result')&&!q.columns.includes('token')));
});

test('processing prevents duplicate writes and failed/cancelled outcomes unlock the form',async()=>{
  const h=harness(),p=product();h.api.init([p]);h.api.acceptStockRequests(new Map([['product-1',request('processing')]]));
  const form=h.api.makeStockEditor(p),e=h.api.editors.get('product-1');
  assert.equal(e.input.disabled,true);await submit(form);assert.equal(h.queries.length,0);
  h.respond(q=>({data:q.table==='sma_produkte'?[p]:q.filters.some(([key])=>key==='id')?[request('failed')]:[],error:null}));
  await h.api.refreshStock();assert.equal(e.save.disabled,false);assert.match(e.feedback.textContent,/fehlgeschlagen/);
  h.api.acceptStockRequests(new Map([['product-1',request('cancelled')]]));e.update();
  assert.equal(e.input.disabled,false);assert.match(e.feedback.textContent,/abgebrochen/);
});

test('a stale poll cannot overwrite a newer submitted request',async()=>{
  const h=harness(),p=product(),oldRead=deferred();h.api.init([p]);const form=h.api.makeStockEditor(p),e=h.api.editors.get('product-1');
  h.respond(q=>q.table==='sma_produkte'?oldRead.promise:{data:q.operation==='insert'?request('queued'):[],error:null});
  const poll=h.api.refreshStock();await flush();
  e.input.value='5';e.input.events.input();await submit(form);
  oldRead.resolve({data:[{sma_produkt_id:p.sma_produkt_id,bestand:99}],error:null});await poll;
  assert.equal(p.bestand,6);assert.equal(h.api.requests().get('product-1').id,'request-1');assert.equal(e.input.value,'5');
});

test('a stale poll cannot update another product page or cause overlapping reads',async()=>{
  const h=harness(),p=product(),oldRead=deferred();h.api.init([p]);h.api.makeStockEditor(p);
  h.respond(q=>q.table==='sma_produkte'?oldRead.promise:{data:[],error:null});
  const poll=h.api.refreshStock();await flush();await h.api.refreshStock();
  assert.equal(h.queries.filter(q=>q.table==='sma_produkte').length,1);
  const second=product('product-2');h.api.setProducts([second]);
  oldRead.resolve({data:[{sma_produkt_id:'product-2',bestand:99}],error:null});await poll;
  assert.equal(second.bestand,6);
});

test('read failure preserves confirmed quantity and draft, backs off, then recovers',async()=>{
  const h=harness(),p=product();h.api.init([p]);h.api.makeStockEditor(p);const e=h.api.editors.get('product-1');
  e.input.value='9';e.input.events.input();h.respond(()=>({error:{message:'offline'}}));
  await h.api.refreshStock();assert.equal(p.bestand,6);assert.equal(e.input.value,'9');assert.equal(e.save.disabled,true);
  assert.equal(h.api.stockRefreshDelay(),4000);assert.match(e.feedback.textContent,/erneut geprüft/);
  h.respond(q=>({data:q.table==='sma_produkte'?[p]:[],error:null}));await h.api.refreshStock();
  assert.equal(e.save.disabled,false);assert.equal(e.input.value,'9');assert.equal(h.api.stockRefreshDelay(),30000);
});

test('background/pagehide pause polling; visibility and pageshow resume immediately',async()=>{
  const h=harness();h.api.init([product()]);h.api.scheduleStockRefresh();assert.equal(h.timers.size,1);
  h.document.hidden=true;h.docEvents.visibilitychange();assert.equal(h.timers.size,0);
  await h.api.refreshStock();assert.equal(h.queries.length,0);
  h.document.hidden=false;h.docEvents.visibilitychange();assert.equal([...h.timers.values()][0].delay,0);
  h.winEvents.pagehide();assert.equal(h.timers.size,0);
  h.winEvents.pageshow();assert.equal([...h.timers.values()][0].delay,0);
});

test('empty/fractional quantities do not submit and concurrent clicks create only one request',async()=>{
  const h=harness(),p=product(),write=deferred();h.api.init([p]);const form=h.api.makeStockEditor(p),e=h.api.editors.get('product-1');
  for(const value of ['', '1.5', '-1', '1000001']){e.input.value=value;await submit(form);}
  assert.equal(h.queries.length,0);
  e.input.value='5';e.input.events.input();h.respond(()=>write.promise);
  const first=submit(form);await flush();await submit(form);
  assert.equal(h.queries.length,1);assert.equal(e.input.disabled,true);
  write.resolve({data:request('queued'),error:null});await first;assert.equal(e.input.disabled,false);
});

test('editing a queued request uses the current request id and guards its queue status',async()=>{
  const h=harness(),p=product();h.api.init([p]);h.api.acceptStockRequests(new Map([['product-1',request('queued')]]));
  const form=h.api.makeStockEditor(p),e=h.api.editors.get('product-1');e.input.value='8';e.input.events.input();
  h.respond(()=>({data:request('queued',8),error:null}));await submit(form);
  assert.equal(h.queries[0].operation,'update');assert.deepEqual(h.queries[0].filters,[['id','request-1'],['status','queued']]);
  assert.equal(e.input.value,'8');assert.equal(p.bestand,6);
});

test('an uncertain save automatically recovers when the open request is found',async()=>{
  const h=harness(),p=product();h.api.init([p]);const form=h.api.makeStockEditor(p),e=h.api.editors.get('product-1');
  e.input.value='5';e.input.events.input();h.respond(()=>({error:{code:'23505'}}));await submit(form);
  assert.match(e.feedback.textContent,/bereits offen/);
  h.respond(q=>({data:q.table==='sma_produkte'?[p]:[request('processing')],error:null}));await h.api.refreshStock();
  assert.match(e.feedback.textContent,/verarbeitet/);assert.equal(e.save.disabled,true);
});

test('only active products in the current public shop expose a copyable link with a manual fallback',async()=>{
 const {publicProductUrl}=await import('../app/assets/shop-catalog-model.mjs');
 let copied,denied=false;
 const h=harness({publicProductUrl,navigator:{clipboard:{async writeText(url){if(denied)throw Error();copied=url;}}}});
 h.api.init([]);const p={...product(),kunde_id:'customer',aktiv:true};
 const actions=value=>h.api.makeProductCard(value,'owner').children.at(-1).children;
 assert.ok(!actions(p).some(b=>b.textContent==='Produktlink kopieren'));
 h.api.publicShop('mein-shop');
 for(const mismatch of [{...p,aktiv:false},{...p,kunde_id:'foreign'}])assert.ok(!actions(mismatch).some(b=>b.textContent==='Produktlink kopieren'));
 const buttons=actions(p),copy=buttons.find(b=>b.textContent==='Produktlink kopieren'),field=buttons.at(-1);
 const open=buttons.find(b=>b.textContent==='Produktseite öffnen');assert.equal(open.hidden,true);
 await copy.events.click();assert.equal(open.hidden,false);assert.equal(open.href,copied);assert.equal(copied,'https://sma-automation.com/app/shop.html?shop=mein-shop&produkt=product-1');
 denied=true;await copy.events.click();assert.equal(field.hidden,false);assert.equal(field.selected,true);assert.equal(field.value,copied);
});
