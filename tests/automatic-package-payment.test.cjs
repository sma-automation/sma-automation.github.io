const test=require('node:test'), assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {build}=require('../n8n/package-payment/build-worker.cjs');
const {verifiedFolders}=require('../n8n/publishing/file-catalog.cjs');
const reference={httpHeaderAuth:{id:'fixture'}};
const paymentWorkflow=build({nodes:[
 {name:'SMA – Mollie – Erste Zahlung erstellen',credentials:reference},
 {name:'SMA – Supabase – Bestellung spiegeln',credentials:reference},
 {name:'SMA – Paketauswahl – Kunde prüfen',parameters:{dataTableId:{value:'fixture'}}}
]});
const paymentNode=name=>paymentWorkflow.nodes.find(node=>node.name===name);
const projectAccount=new Function('$','$input',paymentNode('Antwort begrenzen').parameters.jsCode);
function accountValue(row){
 const item={json:row};
 return projectAccount(()=>({first:()=>({json:{op:'account'}})}),{first:()=>item,all:()=>[item]})[0].json.value;
}
function validateActivation(data){
 const code=paymentNode('Ordnerzuordnung vor Aktivierung prüfen').parameters.jsCode;
 return new Function('$input',code)({first:()=>({json:{op:'activate',data}})})[0].json.data;
}
function matchesActivation(row,data){
 return paymentNode('Kundenzeile activate').parameters.filters.conditions.every(filter=>{
  const value=row[filter.keyName];
  if(filter.condition==='isFalse')return value===false;
  if(filter.condition==='isEmpty')return value===null||value===undefined||value==='';
  const key=/^=\{\{ \$json\.data\.([a-z_]+) \}\}$/.exec(filter.keyValue)?.[1];
  assert.ok(key,'Known data-table equality expression');
  return value===data[key];
 });
}
const folderMapping={upload_folder_id:'fixture_upload_folder',processing_folder_id:'fixture_processing_folder'};
async function fixture({time=Date.now(),issued={},reported={},folders={},beforeBridge=()=>{}}={}){
 const {createPaymentHandler}=await import('../supabase/functions/sma-package-payment/handler.mjs');
 const id=randomUUID(),owner=randomUUID(),ref='kunde_'+'b'.repeat(32),email='first@example.invalid';
 const start=new Date(time).toISOString();let state='booked';let row={id:12,kunde_id:ref,kunde_email:email,zugang_aktiv:false,zahlung_bestaetigt:false,demo_delta_aktiv:false,has_access_token:false,zugangs_token:null,...folderMapping,...folders};
 const o={id,automated:true,plan:'beta',n8n_ref:ref,n8n_row_id:12,email,first_started:start};
 const p={id:'tr_first',mode:'live',status:'open',sequenceType:'first',customerId:'cst_one',amount:{value:'300.00',currency:'EUR'},metadata:{order:id,sma_onboarding_ref:ref,paket:'beta'},_links:{checkout:{href:'https://www.mollie.com/checkout/test'}}};
 const counts={};const fail={};const subscriptions=new Map();
 const handler=createPaymentHandler({
  schedule:{record:async()=>true},now:()=>time,newId:randomUUID,signature:async()=>'fixture-proof',callback:'https://fixture.invalid/pay',
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
   beforeBridge(op,row,data);
   if(op==='account')return accountValue(row);
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
   if(op==='activate'&&matchesActivation(row,validateActivation(data)))row={...row,mollie_customer_id:data.customer,mollie_subscription_id:data.subscription,paket:data.plan,has_access_token:true,zugangs_token:data.token,zugang_aktiv:true,zahlung_bestaetigt:true};
   if(op==='disable')row={...row,zugang_aktiv:false,zahlung_bestaetigt:false};
   return {};
  }
 });
 const go=async(auth='Bearer session')=>handler(new Request('https://fixture.invalid/pay',{method:'POST',headers:{authorization:auth},body:JSON.stringify({owner,order:id})}));
 const event=async(proof='fixture-proof',payment=p.id)=>handler(new Request('https://fixture.invalid/pay?order='+id+'&proof='+proof,{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'id='+payment}));
 const raw=async(payload,headers={})=>handler(new Request('https://fixture.invalid/pay',{
  method:'POST',headers:{authorization:'Bearer session',...headers},body:payload}));
 return {go,event,raw,p,counts,fail,o,reported,subscriptions,row:()=>row,advance:ms=>{time+=ms;}};
}
test('Ungültige oder zu große Kundenanfragen erreichen weder Zahlungsworker noch Mollie',async()=>{
 const x=await fixture();
 for(const raw of ['{','null','[]','"string"',
   JSON.stringify({owner:'invalid',order:'invalid',unexpected:'field'})]){
  const response=await x.raw(raw);
  assert.equal(response.status,400,'Malformed input must not be a temporary 503');
  assert.equal((await response.json()).code,'INVALID');
 }
 const large=await x.raw(JSON.stringify({owner:'x',order:'x',padding:'a'.repeat(2200)}));
 assert.equal(large.status,413);
 assert.equal((await large.json()).code,'INVALID');
 const announced=await x.raw('{"order":"test"}',{'content-length':'4096'});
 assert.equal(announced.status,413);
 assert.deepEqual(x.counts,{});
 assert.equal(x.o.lease,undefined);
 assert.equal(x.o.payment_id,undefined);
 assert.equal(x.row().zugang_aktiv,false);
 // Normal customer requests and external Mollie callbacks keep their contracts.
 assert.equal((await x.go()).status,200);
 assert.equal(x.counts.customer,1);assert.equal(x.counts.first,1);
 assert.equal((await x.event('wrong')).status,403);
});

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

test('Ordnerzuordnung wird privat durchgereicht und die Erstaktivierung führt zur nutzbaren Katalogzuordnung',async()=>{
 const x=await fixture();
 const projected=accountValue({...x.row(),zugangs_token:'private-fixture-token',unrelated_secret:'private'});
 assert.deepEqual([projected.upload_folder_id,projected.processing_folder_id],Object.values(folderMapping));
 assert.equal(projected.has_access_token,true);assert.equal(projected.zugangs_token,undefined);assert.equal(projected.unrelated_secret,undefined);
 await x.go();x.p.status='paid';x.p.paidAt=new Date().toISOString();
 assert.equal((await (await x.event()).json()).code,'ACTIVE');
 const row=x.row();
 assert.deepEqual(verifiedFolders([row],{ok:true,n8n_kunde_id:row.kunde_id,kunde_email:row.kunde_email}).folders,Object.values(folderMapping));
 assert.equal(x.counts.activate,1);
});

test('Fehlende oder ungültige Ordnerzuordnung verhindert neue Kunden- und Erstzahlungsanlage',async()=>{
 for(const folders of [
  {upload_folder_id:undefined,processing_folder_id:undefined},{upload_folder_id:null},
  {processing_folder_id:''},{processing_folder_id:folderMapping.upload_folder_id},
  {upload_folder_id:'short'},{processing_folder_id:'x'.repeat(201)},
  {upload_folder_id:'folder/foreign'},{processing_folder_id:['fixture_processing_folder']}
 ]){
  const x=await fixture({folders});
  assert.equal((await x.go()).status,503);
  assert.equal(x.counts.customer,undefined);assert.equal(x.counts.first,undefined);
  assert.equal(x.counts.activate,undefined);assert.equal(x.row().zugang_aktiv,false);
 }
});

test('Während der Mollie-Kundenanlage verlorene Ordnerzuordnung verhindert die anschließende Erstzahlung',async()=>{
 const x=await fixture({beforeBridge:(op,row)=>{if(op==='customer')row.processing_folder_id=null;}});
 assert.equal((await x.go()).status,503);
 assert.equal(x.counts.customer,1);assert.equal(x.counts.first,undefined);
 assert.equal(x.o.payment_id,undefined);assert.equal(x.row().zugang_aktiv,false);
 Object.assign(x.row(),folderMapping);
 assert.equal((await (await x.go()).json()).code,'BOOKED');
 assert.equal(x.counts.customer,1);assert.equal(x.counts.first,1);
 assert.equal(x.o.payment_id,x.p.id);assert.equal(x.row().zugang_aktiv,false);
});

test('Nach Erstzahlung fehlende Ordnerzuordnung erhält den Zahlungsbeleg und erzeugt kein Abo oder aktiven Zugang',async()=>{
 const x=await fixture();await x.go();
 x.row().processing_folder_id=null;x.p.status='paid';x.p.paidAt=new Date().toISOString();
 assert.equal((await x.event()).status,503);
 assert.equal(x.o.payment_id,x.p.id);assert.equal(x.counts.subscribe,undefined);
 assert.equal(x.counts.activate,undefined);assert.equal(x.row().zugang_aktiv,false);
 Object.assign(x.row(),folderMapping);
 assert.equal((await (await x.event()).json()).code,'ACTIVE');
 assert.equal(x.counts.first,1);assert.equal(x.counts.subscribe,1);assert.equal(x.counts.activate,1);
});

test('Vor Erstaktivierung wird die Ordnerzuordnung nach der Aboabfrage frisch gelesen',async()=>{
 const x=await fixture({beforeBridge:(op,row)=>{if(op==='subscription')row.processing_folder_id=null;}});
 await x.go();x.p.status='paid';x.p.paidAt=new Date().toISOString();
 assert.equal((await x.event()).status,503);
 assert.equal(x.counts.activate,undefined);assert.equal(x.row().zugang_aktiv,false);
});

test('Die tatsächlichen activate-Filter verhindern eine zwischen Lesen und Schreiben geänderte Ordnerzuordnung',async()=>{
 const expected={...folderMapping};assert.deepEqual(validateActivation(expected),expected);
 for(const data of [{},{...expected,upload_folder_id:null},{...expected,processing_folder_id:expected.upload_folder_id}])
  assert.throws(()=>validateActivation(data),/FOLDER_UNAVAILABLE/);
 const output=paymentNode('Vorgang auswählen').parameters.rules.values.findIndex(rule=>rule.outputKey==='activate');
 assert.deepEqual(paymentWorkflow.connections['Vorgang auswählen'].main[output].map(edge=>edge.node),['Ordnerzuordnung vor Aktivierung prüfen']);
 assert.deepEqual(paymentWorkflow.connections['Ordnerzuordnung vor Aktivierung prüfen'].main[0].map(edge=>edge.node),['Kundenzeile activate']);
 const x=await fixture({beforeBridge:(op,row)=>{if(op==='activate')row.processing_folder_id='changed_processing_folder';}});
 await x.go();x.p.status='paid';x.p.paidAt=new Date().toISOString();
 assert.equal((await x.event()).status,503);
 assert.equal(x.counts.activate,1);assert.equal(x.row().zugang_aktiv,false);
 const direct=paymentNode('Kundenzeile activate').parameters.filters.conditions;
 for(const name of Object.keys(folderMapping))assert.ok(direct.some(filter=>filter.keyName===name&&filter.keyValue==='={{ $json.data.'+name+' }}'));
 for(const name of ['Kundenzeile disable','Bestehenden Zugang fortsetzen'])
  assert.equal(paymentNode(name).parameters.filters.conditions.some(filter=>Object.hasOwn(folderMapping,filter.keyName)),false);
});

test('Das Rücklesen bestätigt keinen Website-Zugang bei verschwundener Ordnerzuordnung und kann ohne zweite Aktivierung fortsetzen',async()=>{
 for(const changed of [null,'changed_processing_folder']){
  let change=true;
  const x=await fixture({beforeBridge:(op,row)=>{if(change&&op==='account'&&row.zugang_aktiv)row.processing_folder_id=changed;}});
  await x.go();x.p.status='paid';x.p.paidAt=new Date().toISOString();
  assert.equal((await x.event()).status,503);assert.equal(x.counts.activate,1);
  change=false;Object.assign(x.row(),folderMapping);
  assert.equal((await (await x.event()).json()).code,'ACTIVE');assert.equal(x.counts.activate,1);
 }
});

test('Bestandszugang und Rückerstattung bleiben nach Verlust der Ordnerzuordnung prüf- und sperrbar',async()=>{
 for(const reversal of ['amountRefunded','amountChargedBack']){
  const x=await fixture();await x.go();x.p.status='paid';x.p.paidAt=new Date().toISOString();
  assert.equal((await (await x.event()).json()).code,'ACTIVE');
  delete x.row().upload_folder_id;delete x.row().processing_folder_id;
  assert.equal((await (await x.event()).json()).code,'ACTIVE');
  x.p[reversal]={currency:'EUR',value:'300.00'};
  assert.equal((await (await x.event()).json()).code,'REVERSED');
  assert.equal(x.counts.disable,1);assert.equal(x.row().zugang_aktiv,false);assert.equal(x.row().zahlung_bestaetigt,false);
 }
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
