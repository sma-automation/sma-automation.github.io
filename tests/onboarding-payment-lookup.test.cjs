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

const renewalId='tr_renewal';
const binding={order:'e48ca201-15c7-46bb-af39-7c6bb6204841',kunde_id:'kunde_'+'a'.repeat(32),paket:'beta'};
const recurring={id:renewalId,mode:'live',sequenceType:'recurring',customerId:'cst_private',subscriptionId:'sub_monthly',
  status:'paid',amount:{currency:'EUR',value:'300.00'},createdAt:'2026-11-10T12:20:00Z',paidAt:'2026-11-12T13:08:00+01:00'};
const monthly={id:recurring.subscriptionId,customerId:recurring.customerId,mode:'live',interval:'1 month',metadata:binding,
  amount:recurring.amount,status:'canceled'};

test('Folgezahlungsprüfung liest genau die gemeldete Zahlung und ihr Abo, auch nach Kündigung', async () => {
  const {prepareRenewalCheck}=await import('../n8n/sync-onboarding-payment.mjs');
  const paths=[];
  const query=await prepareRenewalCheck(renewalId,async path=>{paths.push(path);return paths.length===1?recurring:monthly});
  assert.deepEqual(paths,['/payments/tr_renewal','/customers/cst_private/subscriptions/sub_monthly']);
  assert.match(query,/^with beleg as/);
  assert.doesNotMatch(query,/\b(insert|update|delete|call|grant)\b/i);
});

test('Folgezahlungsprüfung verwirft fremde Kennungen, falsche Beträge und unklare Belege',async () => {
  const {prepareRenewalCheck}=await import('../n8n/sync-onboarding-payment.mjs');
  const run=(p,s=monthly)=>prepareRenewalCheck(renewalId,async path=>path.startsWith('/payments/')?p:s);
  for (const change of [{id:'tr_other'},{sequenceType:'first'},{mode:'test'},{customerId:'invalid'},{subscriptionId:null},
    {amount:{currency:'EUR',value:'100.00'}},{amount:{currency:'USD',value:'300.00'}},{status:'unrecognized'},
    {metadata:{order:'other'}},{metadata:{kunde_id:'foreign'}},{metadata:{paket:'alpha'}},{createdAt:null},{createdAt:'2026-02-31T00:00:00Z'},
    {paidAt:undefined},{paidAt:'2025-11-10T12:20:00Z'},{amountRefunded:{currency:'GBP',value:'1.00'}},
    {amountRefunded:{currency:'EUR',value:2}},{amountChargedBack:{currency:'EUR',value:'bad'}}])
    await assert.rejects(run({...recurring,...change}));
  for (const change of [{id:'sub_else'},{customerId:'cst_else'},{mode:'test'},{interval:'1 week'},
    {amount:{currency:'EUR',value:'10.00'}},{metadata:{...binding,paket:'unknown'}},
    {metadata:{...binding,order:'bad'}},{metadata:{...binding,order:[binding.order]}},{metadata:{...binding,kunde_id:'foreign'}}])
    await assert.rejects(run(recurring,{...monthly,...change}));
  let requests=0;
  await assert.rejects(prepareRenewalCheck('../payments',()=>{requests++}));assert.equal(requests,0);
});

test('Betreiberaufruf zur Folgezahlung nutzt zwei GET-Abrufe und gibt ausschließlich den Leseabgleich aus', () => {
  const {spawnSync}=require('node:child_process');
  const urls=['https://api.mollie.com/v2/payments/tr_renewal','https://api.mollie.com/v2/customers/cst_private/subscriptions/sub_monthly'];
  const fixture=`
    import assert from 'node:assert/strict';
    const urls=${JSON.stringify(urls)}, results=${JSON.stringify([recurring,monthly])};
    globalThis.fetch=async (url,options)=>{
      assert.equal(options.method??'GET','GET');
      assert.equal(options.redirect,'error');
      assert.equal(options.headers.Authorization,'Bearer fixture');
      assert.equal(String(url),urls.shift());
      return Response.json(results.shift());
    };
    process.on('exit',()=>assert.equal(urls.length,0));`;
  const run=spawnSync(process.execPath,['--import','data:text/javascript;base64,'+Buffer.from(fixture).toString('base64'),
    'n8n/sync-onboarding-payment.mjs',renewalId,'--folgezahlung'],{encoding:'utf8',env:{...process.env,SMA_MOLLIE_READ_TOKEN:'fixture'}});
  assert.equal(run.status,0,run.stderr);
  assert.equal(run.stderr,'');assert.match(run.stdout,/^with beleg as/);
  assert.doesNotMatch(run.stdout,/Bearer|SMA_MOLLIE_READ_TOKEN/);
});
