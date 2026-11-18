const test=require('node:test');
const assert=require('node:assert/strict');
const order={id:'sma-order',merchant_customer:'cst_live',subscription_id:'sub_live',plan:'alpha',n8n_ref:'kunde_test',payment_id:'tr_first'};
const amount={currency:'EUR',value:'100.00'};
const sub={startDate:'2028-01-31',amount,status:'active'};
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

test('Ohne Rückruf decken Erstmonat und spätere bezahlte Wiederholung bis zum jeweiligen Endtag',async()=>{
  const {assessRenewal}=await import('../supabase/functions/sma-package-payment/renewal.mjs');
  const run=(today,payments,status='canceled')=>assessRenewal({order,sub:{...sub,status},today,event:null,
    readPage:async()=>({payments,next:null})});
  assert.deepEqual(await run('2028-01-30',[]),{decision:'WAIT',checkOn:'2028-01-31'});
  assert.deepEqual(await run('2028-01-31',[]),{decision:'SUSPEND',checkOn:'2028-02-29'});
  const retry=bill('tr_paidretry','2028-02-03');
  assert.deepEqual(await run('2028-02-29',[retry]),{decision:'ACTIVE',checkOn:'2028-03-03'});
  assert.deepEqual(await run('2028-03-03',[retry],'completed'),{decision:'SUSPEND',checkOn:'2028-04-03'});
});
test('Fehlende Meldung allein sperrt weder aktive Abos noch offene oder strittige Zahlungen',async()=>{
  const {assessRenewal}=await import('../supabase/functions/sma-package-payment/renewal.mjs');
  const run=(status,payments)=>assessRenewal({order,sub:{...sub,status},today:'2028-02-01',event:null,
    readPage:async()=>({payments,next:null})});
  assert.deepEqual(await run('active',[]),{decision:'WAIT',checkOn:null});
  assert.deepEqual(await run('suspended',[]),{decision:'SUSPEND',checkOn:null});
  assert.deepEqual(await run('canceled',[bill('tr_open','2028-01-31','open')]),{decision:'SUSPEND',checkOn:'2028-02-29'});
  const partial={...bill('tr_partial','2028-01-31'),amountRefunded:{currency:'EUR',value:'1.00'}};
  assert.deepEqual(await run('completed',[partial]),{decision:'REVIEW',checkOn:null});
});

test('Unbekannter Mollie-Abostatus darf weder ACTIVE noch WAIT erzeugen',async()=>{
  const {assessRenewal}=await import('../supabase/functions/sma-package-payment/renewal.mjs');
  const paid=bill('tr_valid','2028-01-31');
  for(const status of [undefined,null,'','unknown','expired','cancelled','suspended-other',123]){
    let pages=0;
    for(const payments of [[],[paid]]){
      await assert.rejects(
        assessRenewal({order,sub:{...sub,status},today:'2028-02-01',event:null,
          readPage:async()=>{pages++;return {payments,next:null};}}),
        /INVALID_RENEWAL/
      );
    }
    assert.equal(pages,0,'Unrecognized subscription status must fail before provider page fetch');
  }
});

test('Alle fünf dokumentierten Mollie-Abostatus bleiben bei bestätigter Deckung prüfbar',async()=>{
  const {assessRenewal}=await import('../supabase/functions/sma-package-payment/renewal.mjs');
  const paid=bill('tr_valid','2028-01-31');
  for(const status of ['pending','active','canceled','suspended','completed']){
    const r=await assessRenewal({order,sub:{...sub,status},today:'2028-02-01',event:paid.id,
      readPage:async()=>({payments:[paid],next:null})});
    assert.deepEqual(r,{decision:'ACTIVE',checkOn:'2028-02-29'});
  }
});

test('Stopped subscriptions never keep unpaid access through open, pending or authorized attempts',async()=>{
  const {assessRenewal}=await import('../supabase/functions/sma-package-payment/renewal.mjs');
  for(const status of ['canceled','suspended','completed']){
    for(const paymentStatus of ['open','pending','authorized']){
      const payment=bill('tr_waiting','2028-02-29',paymentStatus);
      const result=await assessRenewal({order,sub:{...sub,status},today:'2028-03-03',
        event:payment.id,readPage:async()=>({payments:[payment],next:null})});
      assert.equal(result.decision,'SUSPEND',status+':'+paymentStatus);
      assert.equal(result.checkOn,status==='suspended'?null:'2028-04-03');
    }
  }
});
test('A verified paid period still covers stopped subscriptions, then expires without paid renewal',async()=>{
  const {assessRenewal}=await import('../supabase/functions/sma-package-payment/renewal.mjs');
  const paid=bill('tr_paid','2028-02-29','paid');
  const open=bill('tr_open','2028-03-31','open');
  for(const status of ['canceled','completed','suspended']){
    const run=today=>assessRenewal({order,sub:{...sub,status},today,event:null,
      readPage:async()=>({payments:[paid,...(today>='2028-03-31'?[open]:[])],next:null})});
    assert.deepEqual(await run('2028-03-30'),{decision:'ACTIVE',checkOn:'2028-03-31'});
    const after=await run('2028-03-31');
    assert.equal(after.decision,'SUSPEND');
    assert.equal(after.checkOn,status==='suspended'?null:'2028-04-30');
  }
});
test('Active subscriptions still wait on genuinely pending or unconfirmed renewal attempts',async()=>{
  const {assessRenewal}=await import('../supabase/functions/sma-package-payment/renewal.mjs');
  for(const status of ['open','pending','authorized']){
    const due=bill('tr_pending','2028-02-29',status);
    assert.deepEqual(await assessRenewal({order,sub:{...sub,status:'active'},today:'2028-03-03',
      event:due.id,readPage:async()=>({payments:[due],next:null})}),
      {decision:'WAIT',checkOn:null});
  }
});
