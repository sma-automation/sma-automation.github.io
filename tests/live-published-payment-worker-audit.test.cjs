'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {build}=require('../n8n/package-payment/build-worker.cjs');
const {inspectLivePaymentWorker}=require('../n8n/package-payment/audit-live-worker.cjs');
const url='https://johnmusic.app.n8n.cloud/api/v1/workflows/8v2wcz5lh0yUf3sw';
const workflowId='8v2wcz5lh0yUf3sw';
const versionId='published-fixture-v1';
const versionUrl=url+'/versions/'+versionId;

function fixture(){
  const source={nodes:[
    {name:'SMA – Mollie – Erste Zahlung erstellen',credentials:{httpHeaderAuth:{id:'merchant-fixture'}}},
    {name:'SMA – Supabase – Bestellung spiegeln',credentials:{httpHeaderAuth:{id:'db-fixture'}}},
    {name:'SMA – Paketauswahl – Kunde prüfen',parameters:{dataTableId:{value:'table-fixture'}}}
  ]};
  const built=JSON.parse(JSON.stringify(build(source)));
  return {
    meta:{id:workflowId,active:true,versionId:'newer-unpublished-draft',
      activeVersionId:versionId,isArchived:false,
      nodes:[{name:'Draft can differ',parameters:{jsCode:'NOT THE LIVE PAYMENT GRAPH'}}]},
    version:{workflowId,versionId,nodes:built.nodes,connections:built.connections}
  };
}
const jsonResponse=(value,status=200,headers={})=>new Response(JSON.stringify(value),{
  status,headers:{'content-type':'application/json',...headers}
});
function fakeApi({meta,version,metaAfter}={}){
  const setup=fixture(),calls=[];
  const first=meta??setup.meta,published=version??setup.version,last=metaAfter??first;
  const fetchImpl=async (target,options)=>{
    calls.push({url:target,method:options.method});
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'error');
    assert.equal(options.credentials,'omit');
    assert.equal(options.cache,'no-store');
    assert.equal(options.body,undefined);
    assert.equal(options.headers['X-N8N-API-KEY'],'fixture-key');
    if(target===versionUrl)return jsonResponse(published);
    assert.equal(target,url);
    return jsonResponse(calls.filter(c=>c.url===url).length===1?first:last);
  };
  return {calls,fetchImpl,first,published,last};
}
async function run(fake){return inspectLivePaymentWorker({apiKey:'fixture-key',fetchImpl:fake.fetchImpl});}

test('Published graph is fetched from the exact version endpoint, independent of newer draft',async()=>{
  const fake=fakeApi();const report=await run(fake);
  assert.deepEqual(fake.calls.map(c=>c.url),[url,versionUrl,url]);
  assert.equal(report.ok,true);
  assert.equal(report.status,'ACTIVE_PAYMENT_GRAPH_STRUCTURALLY_MATCHES_NOT_E2E');
  assert.equal(report.scope,'n8n_public_api_live_readonly');
  assert.ok(!Number.isNaN(Date.parse(report.checked_at)));
  for(const key of ['allows_checkout','activates_customer','real_customer_e2e_verified',
    'mollie_payment_verified','account_assignment_verified','drive_folder_access_verified',
    'billed_n8n_executions_measured'])assert.equal(report[key],false);
  assert.doesNotMatch(JSON.stringify(report),/fixture-key|merchant-fixture|db-fixture|table-fixture/);
});

test('An unchanged draft that looks correct cannot excuse an unsafe published activation graph',async()=>{
  const data=fixture();data.meta.nodes=structuredClone(data.version.nodes);
  data.version.nodes.find(n=>n.name==='Ordnerzuordnung vor Aktivierung prüfen')
    .parameters.jsCode='return $input.all();';
  const fake=fakeApi(data),report=await run(fake);
  assert.equal(report.ok,false);
  assert.ok(report.issues.includes('payment_node_parameters_not_matching'));
  assert.deepEqual(fake.calls.map(c=>c.url),[url,versionUrl,url]);
  assert.equal(report.activates_customer,false);
  assert.equal(report.published_version_stability_rechecked,true);
  assert.equal(report.path_trace?.active_version_stability_verified,true);
  assert.equal(report.path_trace?.first_payment.entry_count,1);
  assert.equal(report.path_trace?.renewal.entry_count,1);
  assert.equal(report.path_trace?.first_payment.path_is_proven_safe,false);
  assert.equal(report.path_trace?.payment_or_activation_authorized,false);
  assert.equal(report.diagnostic?.missing_expected_nodes.length,0);
  assert.equal(report.diagnostic?.expected_payment_nodes_present,report.diagnostic?.expected_payment_nodes_count);
  assert.equal(report.diagnostic?.activation_or_payment_authorized,false);
  assert.doesNotMatch(JSON.stringify(report),/merchant-fixture|db-fixture|table-fixture|fixture-key/);
});

test('A changed published version during a mismatching graph never yields stale route evidence',async()=>{
  const data=fixture();
  data.version.nodes.find(n=>n.name==='Ordnerzuordnung vor Aktivierung prüfen')
    .parameters.jsCode='return $input.all();';
  const after={...data.meta,activeVersionId:'different-published-version'};
  const fake=fakeApi({...data,metaAfter:after}),report=await run(fake);
  assert.equal(report.ok,false);
  assert.deepEqual(report.issues,['N8N_PUBLISHED_VERSION_CHANGED_DURING_AUDIT']);
  assert.equal(report.path_trace,undefined);
  assert.equal(report.diagnostic,undefined);
  assert.deepEqual(fake.calls.map(c=>c.url),[url,versionUrl,url]);
});

test('Unpublished, wrong-ID, archived or missing version state cannot lead to an active verdict',async()=>{
  for(const [change,expected] of [
    [g=>{g.meta.activeVersionId=null;},'N8N_PUBLISHED_VERSION_NOT_VERIFIED'],
    [g=>{g.meta.activeVersionId='invalid/slash';},'N8N_PUBLISHED_VERSION_NOT_VERIFIED'],
    [g=>{g.meta.id='unrelated';},'N8N_WORKFLOW_ID_MISMATCH'],
    [g=>{g.meta.isArchived=true;},'N8N_WORKFLOW_ARCHIVED']
  ]){
    const f=fixture();change(f);
    const fake=fakeApi(f),r=await run(fake);
    assert.equal(r.ok,false);
    assert.deepEqual(r.issues,[expected]);
    assert.equal(fake.calls.length,1);
  }
});

test('Version ID, workflow owner, nodes and connections must match the published version metadata',async()=>{
  for(const change of [
    g=>{g.version.workflowId='foreign-workflow';},
    g=>{g.version.versionId='other-version';},
    g=>{delete g.version.nodes;},
    g=>{g.version.connections=null;}
  ]){
    const f=fixture();change(f);
    const fake=fakeApi(f),r=await run(fake);
    assert.equal(r.ok,false);
    assert.deepEqual(r.issues,['N8N_ACTIVE_VERSION_MISMATCH']);
    assert.deepEqual(fake.calls.map(c=>c.url),[url,versionUrl]);
  }
});

test('Publication changes during inspection are refused, even after a matching version',async()=>{
  for(const change of [
    m=>{m.activeVersionId='published-fixture-v2';},
    m=>{m.isArchived=true;},
    m=>{m.id='foreign';}
  ]){
    const f=fixture(),after=structuredClone(f.meta);
    change(after);
    const fake=fakeApi({...f,metaAfter:after}),r=await run(fake);
    assert.equal(r.ok,false);
    assert.deepEqual(r.issues,['N8N_PUBLISHED_VERSION_CHANGED_DURING_AUDIT']);
    assert.equal(fake.calls.length,3);
  }
});

test('Missing or rejected API access fails without triggering any n8n execution',async()=>{
  let called=0;
  const noKey=await inspectLivePaymentWorker({
    apiKey:'',fetchImpl:async()=>{called++;throw Error('unexpected network');}
  });
  assert.deepEqual(noKey.issues,['N8N_READ_API_KEY_REQUIRED']);
  assert.equal(called,0);
  for(const [target,status,expected] of [
    [url,401,'N8N_READ_AUTH_REQUIRED'],
    [versionUrl,403,'N8N_READ_AUTH_REQUIRED'],
    [url,404,'N8N_WORKFLOW_NOT_FOUND'],
    [versionUrl,404,'N8N_ACTIVE_VERSION_UNAVAILABLE'],
    [versionUrl,429,'N8N_READ_UNAVAILABLE']
  ]){
    const fake=fakeApi();
    const r=await inspectLivePaymentWorker({apiKey:'fixture-key',fetchImpl:async(u,options)=>{
      if(u===target)return jsonResponse({private_secret:'never-print-me'},status);
      return fake.fetchImpl(u,options);
    }});
    assert.equal(r.ok,false);
    assert.deepEqual(r.issues,[expected]);
    assert.doesNotMatch(JSON.stringify(r),/private_secret|never-print-me|fixture-key/);
  }
});

test('Misleading size header, malformed JSON, redirects and unexpected body type fail closed',async()=>{
  const cases=[
    new Response('<html>login</html>',{headers:{'content-type':'text/html'}}),
    new Response('{not-json',{headers:{'content-type':'application/json'}}),
    new Response('{}',{headers:{'content-type':'application/json','content-length':String(12*1024*1024+1)}}),
    new Response('{}',{headers:{'content-type':'application/json','content-length':'999'}}),
    new Response('{}',{status:302,headers:{location:'https://foreign.invalid'}})
  ];
  for(const response of cases){
    const r=await inspectLivePaymentWorker({apiKey:'fixture-key',
      fetchImpl:async u=>u===url?jsonResponse(fixture().meta):response});
    assert.equal(r.ok,false);
    assert.equal(r.activates_customer,false);
  }
});

test('One bounded deadline also covers the version endpoint that hangs after metadata',async()=>{
  const r=await inspectLivePaymentWorker({apiKey:'fixture-key',timeoutMs:40,
    fetchImpl:async u=>u===url?jsonResponse(fixture().meta):new Promise(()=>{})});
  assert.equal(r.ok,false);
  assert.deepEqual(r.issues,['N8N_READ_TIMEOUT']);
});

test('Private CLI without key refuses locally without any network access',()=>{
  const processResult=spawnSync(process.execPath,['n8n/package-payment/audit-live-worker.cjs'],{
    encoding:'utf8',env:{...process.env,SMA_N8N_READ_API_KEY:''}
  });
  assert.equal(processResult.status,1);
  assert.equal(processResult.stderr,'');
  const report=JSON.parse(processResult.stdout);
  assert.deepEqual(report.issues,['N8N_READ_API_KEY_REQUIRED']);
  assert.equal(report.allows_checkout,false);
  assert.equal(report.activates_customer,false);
});
