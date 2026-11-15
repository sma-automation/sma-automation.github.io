const test=require('node:test'), assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
async function fixture(){
 const {createPaymentHandler}=await import('../supabase/functions/sma-package-payment/handler.mjs');
 const id=randomUUID(),owner=randomUUID(),ref='kunde_'+'b'.repeat(32),email='first@example.invalid';
 const start=new Date().toISOString();let state='booked';let row={id:12,kunde_id:ref,kunde_email:email,zugang_aktiv:false,zahlung_bestaetigt:false,demo_delta_aktiv:false,has_access_token:false};
 const o={id,automated:true,plan:'beta',n8n_ref:ref,n8n_row_id:12,email,first_started:start};
 const p={id:'tr_first',mode:'live',status:'open',sequenceType:'first',customerId:'cst_one',amount:{value:'300.00',currency:'EUR'},metadata:{order:id,sma_onboarding_ref:ref,paket:'beta'},_links:{checkout:{href:'https://www.mollie.com/checkout/test'}}};
 const counts={};const fail={};let sub;
 const handler=createPaymentHandler({
  newId:randomUUID,signature:async()=>'fixture-proof',callback:'https://fixture.invalid/pay',
  authorize:async(auth,who,order)=>auth==='Bearer session'&&who===owner&&order===id,
  worker:async(order,lease,act,v)=>{
   if(act==='lock'){if(o.lease)return {error:'BUSY'};o.lease=lease;}
   else assert.equal(lease,o.lease);
   if(act==='release')o.lease=null;
   if(act==='customer')o.merchant_customer=v.id;
   if(act==='payment')o.payment_id=v.id;
   if(act==='begin_subscription')o.sub_started??=start;
   if(act==='subscription')o.subscription_id=v.id;
   if(act==='receipt'){
    if(v.receipt.reversed)state='reversed';
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
   if(op==='subscribe'){assert.equal(data.customer,p.customerId);sub={...data.body,id:'sub_one',status:'active'};}
   if(op==='subscribe'||op==='subscription')return {...sub};
   if(op==='activate')row={...row,mollie_customer_id:data.customer,mollie_subscription_id:data.subscription,paket:data.plan,has_access_token:true,zugang_aktiv:true,zahlung_bestaetigt:true};
   if(op==='disable')row={...row,zugang_aktiv:false,zahlung_bestaetigt:false};
   return {};
  }
 });
 const go=async(auth='Bearer session')=>handler(new Request('https://fixture.invalid/pay',{method:'POST',headers:{authorization:auth},body:JSON.stringify({owner,order:id})}));
 const event=async(proof='fixture-proof',payment=p.id)=>handler(new Request('https://fixture.invalid/pay?order='+id+'&proof='+proof,{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'id='+payment}));
 return {go,event,p,counts,fail,o,row:()=>row};
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
