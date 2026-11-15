const test=require('node:test');
const assert=require('node:assert/strict');
const order={id:'sma-order',merchant_customer:'cst_live',subscription_id:'sub_live',plan:'alpha',n8n_ref:'kunde_test',payment_id:'tr_first'};
const amount={currency:'EUR',value:'100.00'};
const sub={startDate:'2028-01-31',amount};
function bill(id,day,status='paid'){
  const stamp=day+'T12:00:00Z';
  return {id,amount,customerId:order.merchant_customer,subscriptionId:order.subscription_id,sequenceType:'recurring',
    mode:'live',createdAt:stamp,status,...(status==='paid'?{paidAt:stamp}:{})};
}
async function decide(today,payments,event=payments[0]?.id){
  const {renewalDecision}=await import('../supabase/functions/sma-package-payment/renewal.mjs');
  return renewalDecision({order,sub,today,event,readPage:async()=>({payments,next:null})});
}
test('Monatsende, Schaltjahr, spätere Wiederholung und alte Fehlschläge',async()=>{
  const fee=bill('tr_feb','2028-02-29'), failure=bill('tr_failed','2028-02-29','failed');
  assert.equal(await decide('2028-03-30',[fee,failure],failure.id),'ACTIVE');
  assert.equal(await decide('2028-03-31',[fee,failure],failure.id),'WAIT');
  const retry=bill('tr_retry','2028-03-03');
  assert.equal(await decide('2028-04-02',[retry,bill('tr_later','2028-03-31','failed')]),'ACTIVE');
  assert.equal(await decide('2028-04-03',[retry,bill('tr_later','2028-03-31','failed')]),'SUSPEND');
  assert.equal(await decide('2028-01-25',[bill('tr_early','2028-01-25','failed')]),'WAIT');
});
test('Offene Versuche, strittige Beträge und vollständig zurückgezahlte Abbuchungen',async()=>{
  const fee=bill('tr_month','2028-01-31');
  assert.equal(await decide('2028-02-02',[{...fee,amountRefunded:amount}]),'SUSPEND');
  assert.equal(await decide('2028-02-02',[{...fee,amountRefunded:{currency:'EUR',value:'1.00'}}]),'REVIEW');
  assert.equal(await decide('2028-02-02',[{...fee,amountChargedBack:amount},bill('tr_wait','2028-02-01','pending')]),'WAIT');
  assert.equal(await decide('2028-02-02',[{...fee,amountChargedBack:amount},bill('tr_again','2028-02-01')]),'ACTIVE');
});
test('Fehlende oder widersprüchliche Providerseiten ergeben keine Zugangsentscheidung',async()=>{
  const fee=bill('tr_month','2028-01-31');
  for(const change of [{customerId:'cst_other'},{subscriptionId:'sub_other'},{amount:{currency:'USD',value:'100.00'}},
    {mode:'test'},{id:order.payment_id},{metadata:{order:'foreign'}},{status:'unknown'},{paidAt:null}]){
    await assert.rejects(decide('2028-02-01',[{...fee,...change}]));
  }
  await assert.rejects(decide('2028-02-01',[fee],'tr_foreign'));
  await assert.rejects(decide('2028-02-01',[fee,fee]));
  const {renewalDecision}=await import('../supabase/functions/sma-package-payment/renewal.mjs');
  for(const readPage of [async()=>({payments:[fee]}),async cursor=>{if(cursor)throw Error('offline');return {payments:[fee],next:'tr_more'}},
    async()=>({payments:[],next:'tr_loop'})]){
    await assert.rejects(renewalDecision({order,sub,today:'2028-02-01',event:fee.id,readPage}));
  }
});
