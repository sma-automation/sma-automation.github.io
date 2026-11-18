'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('../n8n/package-payment/build-worker.cjs');
const {auditRenamedPublishedPaymentWorker:audit}=
  require('../n8n/package-payment/audit-renamed-payment-worker.cjs');
const source={nodes:[
  {name:'SMA – Mollie – Erste Zahlung erstellen',credentials:{httpHeaderAuth:{id:'merchant'}}},
  {name:'SMA – Supabase – Bestellung spiegeln',credentials:{httpHeaderAuth:{id:'database'}}},
  {name:'SMA – Paketauswahl – Kunde prüfen',parameters:{dataTableId:{value:'customer-table'}}}
]};
function renamed(){
  const graph=JSON.parse(JSON.stringify(build(source))),names=new Map(graph.nodes.map((n,i)=>[n.name,'Einbindung '+(i+1)]));
  const change=v=>{
    if(typeof v==='string'){
      for(const [from,to] of names)v=v.replaceAll("$('"+from+"')","$('"+to+"')");
      return v;
    }
    if(Array.isArray(v))return v.map(change);
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,change(x)]));
    return v;
  };
  const nodes=graph.nodes.map(n=>({...n,name:names.get(n.name),parameters:change(n.parameters)}));
  const connections=Object.fromEntries(Object.entries(graph.connections).map(([k,v])=>
    [names.get(k),{main:v.main.map(port=>port.map(link=>({...link,node:names.get(link.node)})))}]));
  return {nodes,connections,names};
}
function exposed(g){return {nodes:g.nodes,connections:g.connections};}
function node(g,n){return g.nodes.find(x=>x.name===g.names.get(n));}

test('a renamed but identical 26-node payment contract never grants customer E2E',()=>{
  const g=renamed(),r=audit(exposed(g));
  assert.deepEqual(r.issues,[]);
  assert.equal(r.ok,true);
  assert.equal(r.status,'PUBLISHED_PAYMENT_EXACT_SOURCE_EQUIVALENCE_NOT_E2E');
  assert.equal(r.matched_template_nodes,26);
  for(const k of ['activates_customer','allows_checkout','real_customer_e2e_verified',
    'payment_or_activation_authorized','billed_n8n_executions_measured'])
    assert.equal(r[k],false);
});
test('unrelated nodes in a larger customer assistant are permitted, without payment bypasses',()=>{
  const g=renamed();
  g.nodes.push({name:'Unrelated dashboard',type:'n8n-nodes-base.code',
    parameters:{jsCode:'no payment'}});
  assert.equal(audit(exposed(g)).ok,true);
});
test('changing ticket logic or named Code-node references requires review',()=>{
  const g=renamed();
  node(g,'Auftragsschlüssel prüfen').parameters.jsCode='return [{json:{trusted:true}}];';
  assert(audit(exposed(g)).issues.includes('PAYMENT_NODE_LOGIC_MISMATCH'));
  const h=renamed();
  node(h,'Antwort begrenzen').parameters.jsCode='return [{json:{ok:true}}];';
  assert(audit(exposed(h)).issues.includes('PAYMENT_NODE_LOGIC_MISMATCH'));
});
test('changing Mollie URL, idempotency key or account filters requires review',()=>{
  const g=renamed();
  node(g,'Mollie first').parameters.headerParameters={parameters:[]};
  assert(audit(exposed(g)).issues.includes('PAYMENT_NODE_LOGIC_MISMATCH'));
  const h=renamed();
  node(h,'Mollie first').parameters.url='https://unreviewed.invalid';
  assert(audit(exposed(h)).issues.includes('PAYMENT_NODE_LOGIC_MISMATCH'));
  const x=renamed();
  node(x,'Kundenzeile activate').parameters.filters.conditions=[];
  assert(audit(exposed(x)).issues.includes('PAYMENT_NODE_LOGIC_MISMATCH'));
});
test('different customer tables and merchant or database references fail closed',()=>{
  const g=renamed();
  node(g,'Kundenzeile activate').parameters.dataTableId.value='other-table';
  assert(audit(exposed(g)).issues.includes('PAYMENT_CUSTOMER_TABLE_REFERENCE_MISMATCH'));
  const h=renamed();
  node(h,'Mollie first').credentials.httpHeaderAuth.id='other-merchant';
  assert(audit(exposed(h)).issues.includes('PAYMENT_CREDENTIAL_REFERENCE_MISMATCH'));
  const x=renamed();
  node(x,'Folgeauftrag abrufen').credentials.httpHeaderAuth.id=
    node(x,'Mollie first').credentials.httpHeaderAuth.id;
  assert(audit(exposed(x)).issues.includes('PAYMENT_CREDENTIAL_REFERENCE_MISMATCH'));
});
test('unexpected external input to an activation or ticket step fails closed',()=>{
  const g=renamed();
  g.nodes.push({name:'Bypass',type:'n8n-nodes-base.code',parameters:{jsCode:'no'}});
  g.connections.Bypass={main:[[{node:g.names.get('Kundenzeile activate'),type:'main',index:0}]]};
  assert(audit(exposed(g)).issues.includes('UNEXPECTED_PAYMENT_NODE_INGRESS'));
});
test('broken branch, duplicate webhook or missing response cannot pass',()=>{
  const g=renamed();
  g.connections[g.names.get('Vorgang auswählen')].main[1]=[];
  assert(audit(exposed(g)).issues.includes('PAYMENT_ROUTE_CONNECTION_MISMATCH'));
  const h=renamed();
  h.nodes.push({...node(h,'Zahlungsdienst'),name:'Duplikat'});
  assert(audit(exposed(h)).issues.includes('PAYMENT_WEBHOOK_NOT_UNIQUE'));
  const x=renamed();
  x.nodes=x.nodes.filter(n=>n.name!==x.names.get('Folgeabgleich antworten'));
  assert.equal(audit(exposed(x)).ok,false);
});
test('failure diagnostics never include private n8n names, credential references or code',()=>{
  const g=renamed();
  node(g,'Mollie first').credentials.httpHeaderAuth.id='private-reference-xyz';
  const report=JSON.stringify(audit(exposed(g)));
  assert(!report.includes('private-reference-xyz'));
  assert(!report.includes('Einbindung'));
  assert(!report.includes('jsCode'));
});
test('malformed input cannot be interpreted as a successful audit',()=>{
  for(const graph of [null,[],{}, {nodes:[],connections:{}},
    {nodes:[{name:'x'},{name:'x'}],connections:{}}])
    assert.equal(audit(graph).ok,false);
});

test('disabled or softened error handling is not equivalent to the reviewed payment service',()=>{
  const g=renamed();node(g,'Ordnerzuordnung vor Aktivierung prüfen').disabled=true;
  assert(audit(exposed(g)).issues.includes('PAYMENT_NODE_RUNTIME_SETTINGS_MISMATCH'));
  const h=renamed();node(h,'Kundenzeile activate').continueOnFail=true;
  assert(audit(exposed(h)).issues.includes('PAYMENT_NODE_RUNTIME_SETTINGS_MISMATCH'));
  const x=renamed();node(x,'Mollie first').onError='continueRegularOutput';
  assert(audit(exposed(x)).issues.includes('PAYMENT_NODE_RUNTIME_SETTINGS_MISMATCH'));
  const y=renamed();node(y,'Mollie first').retryOnFail=true;
  assert(audit(exposed(y)).issues.includes('PAYMENT_NODE_RUNTIME_SETTINGS_MISMATCH'));
  const z=renamed();node(z,'Kundenzeile account').alwaysOutputData=false;
  assert(audit(exposed(z)).issues.includes('PAYMENT_NODE_RUNTIME_SETTINGS_MISMATCH'));
});
test('non-MAIN inbound or outbound payment connections require review',()=>{
  const g=renamed();
  g.connections[g.names.get('Mollie first')].error=[
    [{node:g.names.get('Antwort'),type:'error',index:0}]];
  assert(audit(exposed(g)).issues.includes('PAYMENT_NONMAIN_ROUTE_UNREVIEWED'));
  const h=renamed();h.nodes.push({name:'Outside',type:'n8n-nodes-base.code'});
  h.connections.Outside={error:[[{node:h.names.get('Kundenzeile activate'),type:'error',index:0}]]};
  assert(audit(exposed(h)).issues.includes('UNEXPECTED_PAYMENT_NODE_INGRESS'));
});
