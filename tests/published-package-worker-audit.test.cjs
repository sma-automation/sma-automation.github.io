'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {mkdtempSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {build}=require('../n8n/package-payment/build-worker.cjs');
const {auditPublishedPackageWorker}=require('../n8n/package-payment/audit-published-worker.cjs');

function published(){
  const source={nodes:[
    {name:'SMA – Mollie – Erste Zahlung erstellen',credentials:{httpHeaderAuth:{id:'fixture-merchant'}}},
    {name:'SMA – Supabase – Bestellung spiegeln',credentials:{httpHeaderAuth:{id:'fixture-service'}}},
    {name:'SMA – Paketauswahl – Kunde prüfen',parameters:{dataTableId:{value:'fixture-customer-table'}}}
  ]};
  // Mimic a real n8n JSON readback: independent node credential objects.
  // The generator intentionally reuses credential object references in memory.
  return JSON.parse(JSON.stringify({...build(source),id:'active-payment-worker-fixture',active:true,
    versionId:'published-version-v1',activeVersionId:'published-version-v1'}));
}
function node(graph,name){
  const hit=graph.nodes.find(x=>x.name===name);
  assert.ok(hit,'test fixture node missing: '+name);
  return hit;
}
function blocked(change,reason){
  const exportJson=published();
  change(exportJson);
  const report=auditPublishedPackageWorker(exportJson);
  assert.equal(report.ok,false);
  assert.ok(report.issues.includes(reason),JSON.stringify(report.issues));
  assert.equal(report.allows_checkout,false);
  assert.equal(report.activates_customer,false);
  assert.equal(report.real_customer_e2e_verified,false);
}
test('an exact independently supplied active graph matches without granting launch or billing',()=>{
  const report=auditPublishedPackageWorker(published());
  assert.equal(report.ok,true);
  assert.equal(report.status,'ACTIVE_PAYMENT_GRAPH_STRUCTURALLY_MATCHES_NOT_E2E');
  assert.deepEqual(report.issues,[]);
  for(const key of ['account_assignment_verified','drive_folder_access_verified',
    'mollie_payment_verified','real_customer_e2e_verified','allows_checkout',
    'activates_customer','billed_n8n_executions_measured'])assert.equal(report[key],false);
});
test('an editable draft is not evidence of the published graph',()=>{
  blocked(g=>{g.active=false;},'published_active_graph_not_confirmed');
  blocked(g=>{delete g.activeVersionId;},'published_active_graph_not_confirmed');
  blocked(g=>{g.versionId='newer-edit';},'published_active_graph_not_confirmed');
});
test('explicit activeVersion is checked rather than the more recent mutable editor graph',()=>{
  const g=published();
  g.activeVersion={versionId:g.activeVersionId,nodes:structuredClone(g.nodes),
    connections:structuredClone(g.connections)};
  g.versionId='unpublished-draft';
  node(g,'Ordnerzuordnung vor Aktivierung prüfen').parameters.jsCode='return $input.all();';
  assert.equal(auditPublishedPackageWorker(g).ok,true);
  node(g.activeVersion,'Ordnerzuordnung vor Aktivierung prüfen').parameters.jsCode='return $input.all();';
  assert.ok(auditPublishedPackageWorker(g).issues.includes('payment_node_parameters_not_matching'));
});
test('an unchanged update node cannot be reached by bypassing the folder gate',()=>{
  blocked(g=>{
    const values=node(g,'Vorgang auswählen').parameters.rules.values;
    const i=values.findIndex(x=>x.outputKey==='activate');
    g.connections['Vorgang auswählen'].main[i]=[{node:'Kundenzeile activate',type:'main',index:0}];
  },'payment_routes_not_matching');
  blocked(g=>{
    g.nodes.push({name:'Unsafe replacement path',type:'n8n-nodes-base.code',typeVersion:2,
      parameters:{jsCode:'return $input.all();'}});
    g.connections['Unsafe replacement path']={main:[[{node:'Kundenzeile activate',type:'main',index:0}]]};
  },'unexpected_input_to_payment_guard');
  blocked(g=>{
    g.nodes.push({name:'Untrusted skip-ticket entry',type:'n8n-nodes-base.webhook',typeVersion:2.1,
      parameters:{path:'unreviewed-alternative',httpMethod:'POST',responseMode:'responseNode'}});
    g.connections['Untrusted skip-ticket entry']={main:[[{node:'Vorgang auswählen',type:'main',index:0}]]};
  },'unexpected_input_to_payment_guard');
});
test('removing or weakening folder checks cannot appear to pass',()=>{
  blocked(g=>{node(g,'Ordnerzuordnung vor Aktivierung prüfen').parameters.jsCode='return $input.all();';},
    'payment_node_parameters_not_matching');
  blocked(g=>{
    const filters=node(g,'Kundenzeile activate').parameters.filters.conditions;
    const i=filters.findIndex(x=>x.keyName==='processing_folder_id');
    filters.splice(i,1);
  },'payment_node_parameters_not_matching');
  blocked(g=>{node(g,'Antwort begrenzen').parameters.jsCode='return [{json:{ok:true,value:{}}}];';},
    'payment_node_parameters_not_matching');
});
test('all relevant data-table nodes must reference exactly the same customer table',()=>{
  blocked(g=>{node(g,'Kundenzeile activate').parameters.dataTableId={value:'wrong-table'};},
    'n8n_customer_table_reference_mismatch');
  blocked(g=>{delete node(g,'Kundenzeile account').parameters.dataTableId;},
    'n8n_customer_table_reference_mismatch');
});
test('private merchant and database credentials remain separate and consistent',()=>{
  blocked(g=>{node(g,'Mollie first').credentials.httpHeaderAuth.id='unreviewed-merchant';},
    'mollie_credential_reference_mismatch');
  blocked(g=>{node(g,'Folgeauftrag abrufen').credentials.httpHeaderAuth.id='unreviewed-service';},
    'database_credential_reference_mismatch');
  blocked(g=>{
    for(const name of ['Einmalauftrag abrufen','Folgeauftrag abrufen'])
      node(g,name).credentials.httpHeaderAuth.id='fixture-merchant';
  },'merchant_and_database_credential_overlap');
});
test('wrong webhooks and payment endpoints cannot look like a published matching service',()=>{
  blocked(g=>{node(g,'Zahlungsdienst').parameters.path='wrong-payment-path';},
    'payment_node_parameters_not_matching');
  blocked(g=>{node(g,'Mollie first').parameters.url='={{ "https://unreviewed.example.invalid" }}';},
    'payment_node_parameters_not_matching');
  blocked(g=>{
    g.nodes.push({name:'Extra external payment trigger',type:'n8n-nodes-base.webhook',
      typeVersion:2.1,parameters:{path:'sma-paket-dienst-v1',httpMethod:'POST',responseMode:'responseNode'}});
  },'duplicate_or_missing_payment_webhook');
});
test('incomplete or malformed exports fail closed and do not print personal data',()=>{
  assert.ok(!auditPublishedPackageWorker({active:true,versionId:'draft'}).ok);
  const d=mkdtempSync(join(tmpdir(),'sma-active-audit-'));
  try{
    const path=join(d,'private-customer-export.json');
    const g=published();
    g.secret_fixture='private-token-must-not-appear';
    node(g,'Mollie first').credentials.httpHeaderAuth.id='merchant-secret-must-not-appear';
    writeFileSync(path,JSON.stringify(g),{mode:0o600});
    const run=spawnSync(process.execPath,['n8n/package-payment/audit-published-worker.cjs',path],
      {encoding:'utf8'});
    assert.equal(run.status,1);
    assert.equal(run.stderr,'');
    const printed=JSON.parse(run.stdout);
    assert.equal(printed.ok,false);
    assert.equal(printed.activates_customer,false);
    assert.doesNotMatch(run.stdout,/private-token|merchant-secret|private-customer-export/);
    writeFileSync(path,'{ "private_secret":not-json', {mode:0o600});
    const broken=spawnSync(process.execPath,['n8n/package-payment/audit-published-worker.cjs',path],
      {encoding:'utf8'});
    assert.equal(broken.status,1);
    assert.deepEqual(JSON.parse(broken.stdout).issues,['unreadable_or_incomplete_export']);
    assert.equal(broken.stderr,'');
  }finally{rmSync(d,{recursive:true,force:true});}
});
