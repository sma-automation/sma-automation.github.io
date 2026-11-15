const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const mod=import('../app/assets/shop-demo-payment-notice.mjs');

test('demo shop shows a short, accurate payment-mode warning',async()=>{
 const {demoPaymentModeNotice}=await mod;
 const hint=demoPaymentModeNotice({aktiv:true,demo_delta_aktiv:true,zahlung_bestaetigt:false});
 assert.match(hint,/SMA-Demo ist aktiv/);
 assert.match(hint,/Shopify Payments/);
 assert.match(hint,/nicht automatisch prüfen/);
 assert.doesNotMatch(hint,/Testzahlung bestätigt|Testmodus ist aktiviert/);
});

test('no unwarranted payment-mode notice for non-demo accounts',async()=>{
 const {demoPaymentModeNotice}=await mod;
 for(const customer of [null,undefined,[],{}, {demo_delta_aktiv:false},{demo_delta_aktiv:'true'},{zahlung_bestaetigt:true}]){
  assert.equal(demoPaymentModeNotice(customer),'');
 }
 // Wenn Demo und ein bezahltes Paket zugleich aktiv sind, bleibt die
 // Unsicherheit über Shopifys Zahlungsmodus trotzdem relevant.
 assert.match(demoPaymentModeNotice({demo_delta_aktiv:true,zahlung_bestaetigt:true}),/nicht automatisch prüfen/);
});

test('merchant notice uses existing verified customer state without payment/checkout calls',()=>{
 const source=readFileSync('app/shop-manager.html','utf8');
 const helper=readFileSync('app/assets/shop-demo-payment-notice.mjs','utf8');
 assert.match(source,/id="smaShopDemoPaymentNote" role="note" hidden/);
 assert.match(source,/demoPaymentModeNotice\(kunde\)/);
 assert.match(source,/note\.textContent=demoNote;note\.hidden=false/);
 assert.match(source,/shop-demo-payment-notice\.mjs\?v=1/);
 assert.doesNotMatch(helper,/\bfetch\s*\(|\.rpc\s*\(|localStorage|window\.open|location\.assign/);
});
