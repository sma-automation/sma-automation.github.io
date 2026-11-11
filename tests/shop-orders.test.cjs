const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../app/shop-manager.html'), 'utf8');
const moduleCode = html.split('<script type="module">')[1].split('</script>')[0];
const orderFilterSource = fs.readFileSync(path.join(__dirname, '../app/assets/shop-order-search.mjs'), 'utf8').replace(/^export /gm, '');
const source = orderFilterSource+'\n'+moduleCode.replace(/^import .*;$/gm, '').split('if(window.self===window.top)')[0];

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
}
function harness(){
  const nodes=new Map(),timers=new Map(),queries=[],docEvents={},winEvents={};
  let timerId=0,now=100000,respond=()=>({data:[],error:null});
  const document={hidden:false,activeElement:null,
    createElement:tag=>new Element(tag),
    getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},
    addEventListener:(event,fn)=>docEvents[event]=fn,body:new Element()};
  const supabase={from(table){
    const query={table,filters:[],operation:'select'};
    const builder={
      select(columns,options){query.columns=columns;query.options=options;return this;},
      eq(column,value){query.filters.push([column,value]);return this;},
      ilike(column,value){query.filters.push([column,'ilike',value]);return this;},
      is(column,value){query.filters.push([column,'is',value]);return this;},
      in(column,value){query.filters.push([column,value]);return this;},
      order(column,options){(query.orderBy??=[]).push([column,options]);return this;},range(from,to){query.range=[from,to];return this;},
      abortSignal(signal){query.signal=signal;return this;},
      insert(value){query.operation='insert';query.value=value;return this;},
      update(value){query.operation='update';query.value=value;return this;},
      single(){return this;},maybeSingle(){return this;},
      then(resolve,reject){queries.push(query);return Promise.resolve().then(()=>respond(query)).then(resolve,reject);}
    };return builder;
  }};
  class Clock extends Date {static now(){return now;}}
  const context=vm.createContext({document,window:{addEventListener:(e,f)=>winEvents[e]=f},
    createClient:()=>supabase,Intl,AbortController,AbortSignal,Date:Clock,console,
    setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},
    clearTimeout:id=>timers.delete(id)});
  vm.runInContext(source+`
    globalThis.api={loadOrdersPage,scheduleOrderRefresh,stopOrderRefresh,orderRefreshDelay,
      init(){currentUserId='owner';currentCustomerId='customer';},
      state(){return {page:paginationState.orders.page,total:paginationState.orders.total,
        requested:orderRequestedPage,loading:orderPageLoading,failures:orderRefreshFailures};}
    };`,context);
  return {api:context.api,document,nodes,timers,queries,docEvents,winEvents,
    respond:fn=>respond=fn,advance:ms=>now+=ms};
}
const order=(id=9,status='paid')=>({id,markt:'shopify',ist_testbestellung:false,bestellnummer:'#'+(1000+id),
  erstellt_am:'2026-11-01T12:56:39Z',zahlungsstatus:status,lieferstatus:'UNFULFILLED',gesamtbetrag:'45.89',waehrung:'EUR'});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const list=h=>h.nodes.get('bestellListe');
const status=h=>h.nodes.get('bestellStatus').textContent;
const response=(data,count=data.length)=>({data,count,error:null});
const poll=h=>h.api.loadOrdersPage(h.api.state().requested,{background:true});
const nextTimer=h=>[...h.timers.values()][0];

test('polling enriches unknown orders with verified test classification without calling them real payments',async()=>{
  const h=harness();h.api.init();
  h.respond(()=>response([{...order(10),ist_testbestellung:null}]));await h.api.loadOrdersPage();
  const badgeTexts=()=>list(h).children[0].children[0].children[2].children.map(b=>b.textContent);
  assert.ok(badgeTexts().includes('Teststatus noch nicht bestätigt'));
  h.respond(()=>response([{...order(10),ist_testbestellung:true}]));await poll(h);
  assert.deepEqual(badgeTexts(),['Testbestellung – keine echte Zahlung','Testzahlung bestätigt','Noch nicht versendet']);
  assert.ok(h.queries.every(q=>q.columns.includes('ist_testbestellung')&&q.operation==='select'));
});

test('only a boolean false confirms non-test mode; older missing flags remain unknown',async()=>{
  const h=harness();h.api.init();
  for(const flag of [undefined,null,'false',0]){
    h.respond(()=>response([{...order(),ist_testbestellung:flag}]));await h.api.loadOrdersPage();
    assert.equal(list(h).children[0].children[0].children[2].children[0].textContent,'Teststatus noch nicht bestätigt');
  }
  h.respond(()=>response([order()]));await h.api.loadOrdersPage();
  assert.deepEqual(list(h).children[0].children[0].children[2].children.map(b=>b.textContent),['Bezahlt','Noch nicht versendet']);
});

test('scheduled refresh discovers a new order in an initially empty list and updates its payment/shipping status',async()=>{
  const h=harness();h.api.init();h.respond(()=>response([]));await h.api.loadOrdersPage();
  assert.equal(h.api.state().total,0);assert.equal(nextTimer(h).delay,15000);
  h.respond(()=>response([order()]));await nextTimer(h).fn();
  assert.equal(h.api.state().total,1);assert.equal(list(h).children.length,1);
  assert.equal(list(h).children[0].children[0].children[0].textContent,'#1009');
  const updated={...order(9,'refunded'),lieferstatus:'in_progress'};
  h.respond(()=>response([updated]));await nextTimer(h).fn();
  const badges=list(h).children[0].children[0].children[2].children;
  assert.equal(badges[0].textContent,'Erstattet');assert.equal(badges[1].textContent,'In Bearbeitung');
  assert.ok(h.queries.every(q=>q.table==='sma_bestellungen'&&q.operation==='select'));
  assert.ok(h.queries.every(q=>q.filters.some(([k,v])=>k==='user_id'&&v==='owner')));
  assert.deepEqual(h.queries[0].range,[0,4]);
  assert.deepEqual(h.queries[0].orderBy.map(([key])=>key),['erstellt_am','id']);
});

test('unchanged polls retain row/pagination DOM, active focus and unsaved product inputs',async()=>{
  const h=harness();h.api.init();h.respond(()=>response([order()],20));await h.api.loadOrdersPage();
  const row=list(h).children[0],nav=h.nodes.get('bestellPagination').children[1];
  const productInput=new Element('input');productInput.value='17';h.document.activeElement=productInput;
  await poll(h);
  assert.equal(list(h).children[0],row);assert.equal(h.nodes.get('bestellPagination').children[1],nav);
  assert.equal(h.document.activeElement,productInput);assert.equal(productInput.value,'17');
});

test('page navigation aborts an older poll and stale results cannot replace the chosen page',async()=>{
  const h=harness();h.api.init();h.respond(()=>response([order()],21));await h.api.loadOrdersPage();
  const old=deferred();h.respond(()=>old.promise);const first=poll(h);await flush();
  const stale=h.queries.at(-1);await poll(h);assert.equal(h.queries.length,2);
  h.respond(()=>response([order(3)],21));await h.api.loadOrdersPage(2);
  assert.equal(stale.signal.aborted,true);assert.deepEqual(h.queries.at(-1).range,[5,9]);
  old.resolve(response([order(99)],22));await first;
  assert.equal(h.api.state().page,2);assert.equal(list(h).children[0].children[0].children[0].textContent,'#1003');
  assert.equal(h.api.state().loading,false);assert.equal(h.timers.size,1);
});

test('network failures retain orders, back off, and recover automatically',async()=>{
  const h=harness();h.api.init();h.respond(()=>response([order()]));await h.api.loadOrdersPage();
  const row=list(h).children[0];h.respond(()=>{throw new Error('offline');});
  await poll(h);assert.equal(list(h).children[0],row);assert.match(status(h),/Verbindung unterbrochen/);
  assert.equal(nextTimer(h).delay,30000);await poll(h);assert.equal(nextTimer(h).delay,60000);
  await poll(h);assert.equal(nextTimer(h).delay,60000);
  h.respond(()=>response([order()]));await nextTimer(h).fn();
  assert.match(status(h),/automatisch aktualisiert/);assert.equal(nextTimer(h).delay,15000);
  assert.equal(h.api.state().failures,0);assert.equal(h.api.state().loading,false);
});

test('failed first load retries the requested page and restores its pagination',async()=>{
  const h=harness();h.api.init();h.respond(()=>({error:{message:'offline'}}));await h.api.loadOrdersPage(2);
  assert.equal(h.api.state().requested,2);assert.match(status(h),/erneut geladen/);
  h.respond(()=>response([order(2)],15));await nextTimer(h).fn();
  assert.equal(h.api.state().page,2);assert.equal(h.api.state().total,15);
  assert.equal(h.nodes.get('bestellPagination').children[0].textContent,'6–10 von 15 Bestellungen');
});

test('visibility and pagehide cancel pending reads; returning or reconnecting resumes without a reload',async()=>{
  const h=harness();h.api.init();h.respond(()=>response([order()]));await h.api.loadOrdersPage();
  const pending=deferred();h.respond(()=>pending.promise);const active=poll(h);await flush();
  const signal=h.queries.at(-1).signal;
  h.document.hidden=true;h.docEvents.visibilitychange();assert.equal(signal.aborted,true);
  pending.resolve(response([order(99)]));await active;
  assert.equal(list(h).children[0].children[0].children[0].textContent,'#1009');
  assert.equal(h.timers.size,0);await poll(h);assert.equal(h.queries.length,2);
  h.document.hidden=false;h.docEvents.visibilitychange();assert.equal(nextTimer(h).delay,0);
  h.winEvents.pagehide();assert.equal(h.timers.size,0);h.winEvents.pageshow();assert.equal(nextTimer(h).delay,0);
  h.winEvents.online();assert.equal(h.timers.size,1);h.winEvents.focus();assert.equal(h.timers.size,1);
});

test('when the last page disappears polling selects the last remaining page',async()=>{
  const h=harness();h.api.init();h.respond(()=>response([order(1)],11));await h.api.loadOrdersPage(3);
  h.respond(q=>response(q.range[0]===10?[]:[order(2)],6));await poll(h);
  assert.equal(h.api.state().page,2);assert.equal(h.api.state().requested,2);assert.equal(h.api.state().total,6);
  assert.deepEqual(h.queries.at(-1).range,[5,9]);assert.equal(h.timers.size,1);
});

test('a timed-out read does not leave refresh blocked and keeps the last confirmed list',async()=>{
  const h=harness();h.api.init();h.respond(()=>response([order()]));await h.api.loadOrdersPage();
  const row=list(h).children[0];
  h.respond(q=>new Promise(resolve=>q.signal.addEventListener('abort',()=>resolve({error:{message:'timeout'}}))));
  const pending=poll(h);await flush();
  const timeout=[...h.timers.values()].find(t=>t.delay===10000);assert.ok(timeout);timeout.fn();await pending;
  assert.equal(list(h).children[0],row);assert.equal(h.api.state().loading,false);assert.equal(nextTimer(h).delay,30000);
});


test('shop section switches preserve loaded orders and unsaved product inputs',async()=>{
 const h=harness();h.api.init();h.respond(()=>response([order()],10));await h.api.loadOrdersPage(2);
 const row=list(h).children[0],queries=h.queries.length,input=new Element('input');input.value='4';h.document.getElementById('shop').append(input);
 h.nodes.get('showOrders').events.click();assert.equal(h.nodes.get('shop').hidden,true);assert.equal(h.nodes.get('bestellungen').hidden,false);assert.equal(h.nodes.get('showOrders')['aria-pressed'],'true');
 h.nodes.get('showProducts').events.click();assert.equal(h.nodes.get('shop').hidden,false);assert.equal(h.nodes.get('bestellungen').hidden,true);assert.equal(input.value,'4');assert.equal(list(h).children[0],row);assert.equal(h.api.state().page,2);assert.equal(h.queries.length,queries);
});
