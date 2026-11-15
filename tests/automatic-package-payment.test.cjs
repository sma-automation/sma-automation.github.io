const test=require('node:test'), assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
async function fixture({time=Date.now(),issued={},reported={}}={}){
 const {createPaymentHandler}=await import('../supabase/functions/sma-package-payment/handler.mjs');
 const id=randomUUID(),owner=randomUUID(),ref='kunde_'+'b'.repeat(32),email='first@example.invalid';
 const start=new Date(time).toISOString();let state='booked';let row={id:12,kunde_id:ref,kunde_email:email,zugang_aktiv:false,zahlung_bestaetigt:false,demo_delta_aktiv:false,has_access_token:false};
 const o={id,automated:true,plan:'beta',n8n_ref:ref,n8n_row_id:12,email,first_started:start};
 const p={id:'tr_first',mode:'live',status:'open',sequenceType:'first',customerId:'cst_one',amount:{value:'300.00',currency:'EUR'},metadata:{order:id,sma_onboarding_ref:ref,paket:'beta'},_links:{checkout:{href:'https://www.mollie.com/checkout/test'}}};
 const counts={};const fail={};const subscriptions=new Map();
 const handler=createPaymentHandler({
  now:()=>time,newId:randomUUID,signature:async()=>'fixture-proof',callback:'https://fixture.invalid/pay',
  authorize:async(auth,who,order)=>auth==='Bearer session'&&who===owner&&order===id,
  worker:async(order,lease,act,v)=>{
   if(act==='lock'){if(o.lease)return {error:'BUSY'};o.lease=lease;}
   else assert.equal(lease,o.lease);
   if(act==='release')o.lease=null;
   if(act==='customer')o.merchant_customer=v.id;
   if(act==='payment'){o.payment_id=v.id;o.checkout=v.checkout;o.expires=v.expires;}
   if(act==='begin_subscription')o.sub_started??=start;
   if(act==='subscription')o.subscription_id=v.id;
   if(act==='receipt'){
    if(v.receipt.reversed)state='reversed';
    else if(state==='booked'&&['failed','expired','canceled'].includes(v.receipt.status))state='closed';
    else if(state!=='reversed'&&v.receipt.status==='paid')state=v.row||state==='active'?'active':'paid';
    return {state:state.toUpperCase()};
   }
   return {...o,state};
  },
  bridge:async(op,data)=>{
   counts[op]=(counts[op]||0)+1;
   if(fail[op]){delete fail[op];throw Error('simulated interruption')}
   if(op==='account')return {...row};
   if(op==='customer')return {id:p.customerId,email,metadata:{order:id}};
   if(op==='first'){assert.equal(data.body.redirectUrl,'https://sma-automation.com/app/paketwahl.html?buchung='+id);assert.deepEqual(data.body.metadata,p.metadata);assert.equal(data.body.sequenceType,'first');assert.deepEqual(data.body.amount,p.amount);assert.equal(new URL(data.body.webhookUrl).searchParams.get('order'),id);}
   if(op==='payment')assert.equal(data.payment,p.id);
   if(op==='payment'||op==='first')return {...p};
   if(op==='subscribe'){
    assert.equal(data.customer,p.customerId);assert.equal(data.order,id);
    if(!subscriptions.has(data.order)){
     subscriptions.set(data.order,{...data.body,id:'sub_one',mode:'live',customerId:data.customer,
       nextPaymentDate:data.body.startDate,status:'active',...issued});
    }
    if(fail.afterSubscribe){delete fail.afterSubscribe;throw Error('reply lost after creation');}
    return {...subscriptions.get(data.order)};
   }
   if(op==='subscription'){
    assert.equal(data.customer,p.customerId);assert.equal(data.subscription,'sub_one');
    return {...subscriptions.get(id),...reported};
   }
   if(op==='activate')row={...row,mollie_customer_id:data.customer,mollie_subscription_id:data.subscription,paket:data.plan,has_access_token:true,zugang_aktiv:true,zahlung_bestaetigt:true};
   if(op==='disable')row={...row,zugang_aktiv:false,zahlung_bestaetigt:false};
   return {};
  }
 });
 const go=async(auth='Bearer session')=>handler(new Request('https://fixture.invalid/pay',{method:'POST',headers:{authorization:auth},body:JSON.stringify({owner,order:id})}));
 const event=async(proof='fixture-proof',payment=p.id)=>handler(new Request('https://fixture.invalid/pay?order='+id+'&proof='+proof,{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'id='+payment}));
 return {go,event,p,counts,fail,o,reported,subscriptions,row:()=>row,advance:ms=>{time+=ms;}};
}
test('Automatische Erstzahlung, erneuter Aufruf, Monatsabo, Freischaltung und Rückbuchung',async()=>{
 const x=await fixture();
 assert.equal((await x.go('Bearer wrong')).status,403);assert.equal((await x.event('wrong')).status,403);assert.deepEqual(x.counts,{});
 assert.equal((await x.go()).status,200);assert.equal((await x.go()).status,200);assert.equal(x.counts.customer,1);assert.equal(x.counts.first,1);
 assert.equal(x.row().zugang_aktiv,false);assert.equal((await x.event('fixture-proof','tr_wrong')).status,409);
 x.p.status='paid';x.p.paidAt=new Date().toISOString();x.fail.activate=true;
 assert.equal((await x.event()).status,503);assert.equal(x.row().zugang_aktiv,false);
 assert.equal((await x.event()).status,200);assert.equal((await x.event()).status,200);
 assert.equal(x.counts.subscribe,1);assert.equal(x.row().zugang_aktiv,true);
 x.p.amountRefunded={currency:'EUR',value:'25.00'};
 assert.equal((await x.event()).status,200);assert.equal(x.row().zugang_aktiv,false);
 assert.equal((await x.event()).status,200);assert.equal(x.counts.disable,1);
});
test('Testmodus, falsches Paket, unbekannter Betrag und abgelaufene Wiederholung bleiben gesperrt',async()=>{
 for(const change of [{mode:'test'},{metadata:{}},{amount:{currency:'EUR',value:'1.00'}},{sequenceType:'recurring'}]){
  const x=await fixture();Object.assign(x.p,change);assert.equal((await x.go()).status,503);
  assert.equal(x.row().zugang_aktiv,false);assert.equal(x.counts.subscribe,undefined);
 }
 const x=await fixture();x.o.first_started='2020-01-01T00:00:00Z';assert.equal((await x.go()).status,503);
 assert.equal(x.counts.first,undefined);assert.equal(x.counts.customer,undefined);
});

test('Laufende Zahlungen verlieren den Checkout-Link, endgültig geschlossene Aufträge bleiben geschlossen',async()=>{
 for(const terminal of ['failed','expired','canceled']){
  const x=await fixture();
  await x.go();assert.equal(x.o.checkout,x.p._links.checkout.href);
  for(const status of ['pending','authorized']){
   x.p.status=status;assert.equal((await (await x.event()).json()).code,'BOOKED');
   assert.equal(x.o.checkout,null);assert.equal(x.o.expires,null);
  }
  x.p.status=terminal;
  assert.equal((await (await x.event()).json()).code,'CLOSED');
  assert.equal((await (await x.event()).json()).code,'CLOSED');
  assert.equal(x.counts.first,1);assert.equal(x.counts.subscribe,undefined);assert.equal(x.row().zugang_aktiv,false);
 }
});

test('Bezahlter erster Monat mit bestätigtem Folgetermin, auch bei verloren gegangener Antwort',async()=>{
 const time=Date.parse('2028-01-31T14:00:00Z');
 const x=await fixture({time,issued:{status:'pending'}});
 await x.go();x.p.status='paid';x.p.paidAt=new Date(time).toISOString();x.fail.afterSubscribe=true;
 assert.equal((await x.event()).status,503);assert.equal(x.row().zugang_aktiv,false);
 assert.equal(x.subscriptions.size,1);assert.equal(x.o.subscription_id,undefined);
 assert.equal((await (await x.event()).json()).code,'ACTIVE');
 assert.equal(x.counts.subscribe,2);assert.equal(x.subscriptions.size,1);
 assert.equal(x.subscriptions.values().next().value.startDate,'2028-02-29');
 assert.equal(x.counts.subscription,1);assert.equal(x.counts.activate,1);
 assert.equal((await (await x.event()).json()).code,'ACTIVE');assert.equal(x.counts.activate,1);
});

test('Nach einer unterbrochenen Abfrage bleibt die Abo-ID über das Wiederholungsfenster hinaus erhalten',async()=>{
 const x=await fixture({issued:{status:'pending'},reported:{nextPaymentDate:null}});
 await x.go();x.p.status='paid';x.p.paidAt=new Date().toISOString();
 x.fail.subscription=true;
 assert.equal((await x.event()).status,503);assert.equal(x.o.subscription_id,'sub_one');
 assert.equal(x.row().zugang_aktiv,false);x.advance(65*60_000);
 assert.equal((await x.event()).status,503);assert.equal(x.row().zugang_aktiv,false);
 assert.equal((await (await x.go()).json()).code,'PAID');
 x.reported.status='active';assert.equal((await (await x.event()).json()).code,'ACTIVE');
 assert.equal(x.counts.subscribe,1);assert.equal(x.counts.activate,1);
});

test('Abweichende Abo-Daten, gesperrte Abos und ungeklärte Folgetermine halten den Zugang geschlossen',async()=>{
 const time=Date.parse('2027-01-31T08:00:00Z');
 for(const reported of [{id:'sub_other'},{customerId:'cst_other'},{mode:'test'},{metadata:{}},
  {interval:'2 months'},{amount:{currency:'EUR',value:'100.00'}},{startDate:'2027-02-01'},
  {status:'canceled'},{status:'suspended'},{status:'completed'},{status:'unknown'},
  {status:'pending',nextPaymentDate:null},{status:'pending',nextPaymentDate:'2027-03-01'}]){
  const x=await fixture({time,reported});
  await x.go();x.p.status='paid';x.p.paidAt=new Date(time).toISOString();
  assert.equal((await x.event()).status,503);assert.equal(x.row().zugang_aktiv,false);
  assert.equal(x.o.subscription_id,'sub_one');assert.equal(x.counts.subscribe,1);
 }
 const stale=await fixture({time,issued:{status:'pending'},reported:{nextPaymentDate:null}});
 await stale.go();stale.p.status='paid';stale.p.paidAt=new Date(time).toISOString();
 await stale.event();stale.advance(28*24*60*60_000);stale.reported.nextPaymentDate='2027-02-28';
 assert.equal((await stale.event()).status,503);assert.equal(stale.counts.activate,undefined);
});
