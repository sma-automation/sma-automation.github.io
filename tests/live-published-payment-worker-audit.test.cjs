'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {build}=require('../n8n/package-payment/build-worker.cjs');
const {inspectLivePaymentWorker}=require('../n8n/package-payment/audit-live-worker.cjs');
const url='https://johnmusic.app.n8n.cloud/api/v1/workflows/8v2wcz5lh0yUf3sw';

function published(){
  const source={nodes:[
    {name:'SMA – Mollie – Erste Zahlung erstellen',credentials:{httpHeaderAuth:{id:'merchant-fixture'}}},
    {name:'SMA – Supabase – Bestellung spiegeln',credentials:{httpHeaderAuth:{id:'db-fixture'}}},
    {name:'SMA – Paketauswahl – Kunde prüfen',parameters:{dataTableId:{value:'table-fixture'}}}
  ]};
  return JSON.parse(JSON.stringify({...build(source),id:'8v2wcz5lh0yUf3sw',
    active:true,versionId:'published-fixture-v1',activeVersionId:'published-fixture-v1'}));
}
const jsonResponse=(value,status=200,headers={})=>new Response(JSON.stringify(value),{
  status,headers:{'content-type':'application/json',...headers}
});

test('Live preflight reads only the exact n8n workflow through GET with no executions',async()=>{
  let calls=0;
  const fetchImpl=async (target,options)=>{
    calls++;
    assert.equal(target,url);
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'error');
    assert.equal(options.credentials,'omit');
    assert.equal(options.cache,'no-store');
    assert.equal(options.headers['X-N8N-API-KEY'],'fixture-key');
    assert.equal(options.body,undefined);
    return jsonResponse(published());
  };
  const report=await inspectLivePaymentWorker({apiKey:'fixture-key',fetchImpl});
  assert.equal(calls,1);
  assert.equal(report.ok,true);
  assert.equal(report.status,'ACTIVE_PAYMENT_GRAPH_STRUCTURALLY_MATCHES_NOT_E2E');
  assert.equal(report.scope,'n8n_public_api_live_readonly');
  assert.ok(!Number.isNaN(Date.parse(report.checked_at)));
  for(const key of ['allows_checkout','activates_customer','real_customer_e2e_verified',
    'mollie_payment_verified','account_assignment_verified','drive_folder_access_verified',
    'billed_n8n_executions_measured'])assert.equal(report[key],false);
  assert.doesNotMatch(JSON.stringify(report),/fixture-key|merchant-fixture|db-fixture|table-fixture/);
});

test('Never infer that a newer draft is the published worker',async()=>{
  const g=published();
  g.versionId='unpublished-edit';
  g.nodes.find(n=>n.name==='Ordnerzuordnung vor Aktivierung prüfen').parameters.jsCode='return $input.all();';
  const report=await inspectLivePaymentWorker({
    apiKey:'fixture-key',fetchImpl:async()=>jsonResponse(g)
  });
  assert.equal(report.ok,false);
  assert.ok(report.issues.includes('published_active_graph_not_confirmed'));
  assert.equal(report.allows_checkout,false);
});

test('A genuine activeVersion is audited rather than a drifted editor version',async()=>{
  const g=published();
  g.activeVersion={versionId:g.activeVersionId,nodes:structuredClone(g.nodes),
    connections:structuredClone(g.connections)};
  g.versionId='unpublished-edit';
  g.nodes.find(n=>n.name==='Ordnerzuordnung vor Aktivierung prüfen').parameters.jsCode='return $input.all();';
  const report=await inspectLivePaymentWorker({apiKey:'fixture-key',fetchImpl:async()=>jsonResponse(g)});
  assert.equal(report.ok,true);
  g.activeVersion.nodes.find(n=>n.name==='Ordnerzuordnung vor Aktivierung prüfen').parameters.jsCode='return $input.all();';
  const blocked=await inspectLivePaymentWorker({apiKey:'fixture-key',fetchImpl:async()=>jsonResponse(g)});
  assert.equal(blocked.ok,false);
  assert.ok(blocked.issues.includes('payment_node_parameters_not_matching'));
});

test('Unverified publication, wrong workflow id and missing credentials fail closed',async()=>{
  for(const [change,expected] of [
    [g=>{g.activeVersionId=null;},'N8N_PUBLISHED_VERSION_NOT_VERIFIED'],
    [g=>{g.id='different-workflow';},'N8N_WORKFLOW_ID_MISMATCH'],
    [g=>{g.nodes.find(n=>n.name==='Mollie first').credentials={};},
      'mollie_credential_reference_mismatch']
  ]){
    const g=published();change(g);
    const r=await inspectLivePaymentWorker({apiKey:'fixture-key',fetchImpl:async()=>jsonResponse(g)});
    assert.equal(r.ok,false);assert.ok(r.issues.includes(expected));
    assert.equal(r.activates_customer,false);
  }
});

test('Missing key does not initiate a request; rejected keys and HTTP failures stay private',async()=>{
  let calls=0;const read=async()=>{calls++;return jsonResponse(published());};
  const bad=await inspectLivePaymentWorker({apiKey:'',fetchImpl:read});
  assert.equal(bad.ok,false);assert.deepEqual(bad.issues,['N8N_READ_API_KEY_REQUIRED']);
  assert.equal(calls,0);
  for(const [status,expected] of [[401,'N8N_READ_AUTH_REQUIRED'],
    [403,'N8N_READ_AUTH_REQUIRED'],[404,'N8N_WORKFLOW_NOT_FOUND'],[429,'N8N_READ_UNAVAILABLE']]){
    const r=await inspectLivePaymentWorker({apiKey:'secret-fixture-key',
      fetchImpl:async()=>jsonResponse({private_secret:'must-not-appear'},status)});
    assert.deepEqual(r.issues,[expected]);
    assert.doesNotMatch(JSON.stringify(r),/private_secret|must-not-appear|secret-fixture-key/);
  }
});

test('Malformed, oversized or redirected responses cannot prove active publication',async()=>{
  for(const response of [
    new Response('<html>login</html>',{headers:{'content-type':'text/html'}}),
    new Response('{not-json',{headers:{'content-type':'application/json'}}),
    new Response('{}',{headers:{'content-type':'application/json','content-length':String(12*1024*1024+1)}}),
    new Response('{}',{status:302,headers:{location:'https://somewhere.invalid'}})
  ]){
    const r=await inspectLivePaymentWorker({apiKey:'fixture-key',fetchImpl:async()=>response});
    assert.equal(r.ok,false);
    assert.equal(r.activates_customer,false);
  }
});

test('One deadline covers a transport that never responds',async()=>{
  const result=await inspectLivePaymentWorker({
    apiKey:'fixture-key',timeoutMs:20,fetchImpl:()=>new Promise(()=>{})
  });
  assert.equal(result.ok,false);
  assert.deepEqual(result.issues,['N8N_READ_TIMEOUT']);
});

test('CLI with missing private API key prints only a safe refusal, with no network attempt',()=>{
  const run=spawnSync(process.execPath,['n8n/package-payment/audit-live-worker.cjs'],{
    encoding:'utf8',env:{...process.env,SMA_N8N_READ_API_KEY:''}
  });
  assert.equal(run.status,1);
  assert.equal(run.stderr,'');
  const report=JSON.parse(run.stdout);
  assert.deepEqual(report.issues,['N8N_READ_API_KEY_REQUIRED']);
  assert.equal(report.allows_checkout,false);
  assert.equal(report.activates_customer,false);
});
