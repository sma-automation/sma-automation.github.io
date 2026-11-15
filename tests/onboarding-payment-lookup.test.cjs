const test = require('node:test');
const assert = require('node:assert/strict');
test('Paketbuchung liest nur die passende Mollie-Erstzahlung und das aktive Monatsabo', async () => {
  const {preparePaymentSync} = await import('../n8n/sync-onboarding-payment.mjs');
  const ref='kunde_'+'a'.repeat(32), id='tr_fixture';
  const row={kunde_id:ref,paket:'beta',mollie_customer_id:'cst_example',mollie_subscription_id:'sub_example'};
  const payment={id,customerId:row.mollie_customer_id,amount:{currency:'EUR',value:'300.00'},
    sequenceType:'first',metadata:{kunde_id:ref,paket:'beta'},status:'paid',mode:'live'};
  const sub={id:row.mollie_subscription_id,status:'active',amount:payment.amount,metadata:payment.metadata,interval:'1 month'};
  const urls=[];
  const sql=await preparePaymentSync(id,row,async path=>{urls.push(path);return path.startsWith('/payments/')?payment:sub});
  assert.deepEqual(urls,['/payments/tr_fixture','/customers/cst_example/subscriptions/sub_example']);
  assert.match(sql,/^select sma_private.sync_onboarding_booking_v1/);
  for (const change of [{mode:'test'},{sequenceType:'recurring'},{id:'tr_other'},{amount:{currency:'USD',value:'300.00'}},
    {amountChargedBack:{currency:'EUR',value:'1.00'}},{amountRefunded:{currency:'USD',value:'0.00'}}]) {
    await assert.rejects(preparePaymentSync(id,row,async()=>({...payment,...change})));
  }
  for (const change of [{id:'sub_wrong'},{status:'canceled'},{interval:'1 day'},{metadata:{kunde_id:ref,paket:'delta'}}]) {
    await assert.rejects(preparePaymentSync(id,row,async p=>p.startsWith('/payments/')?payment:{...sub,...change}));
  }
});
