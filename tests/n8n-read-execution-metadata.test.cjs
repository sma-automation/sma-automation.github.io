'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {inspectSavedExecutionMetadata,firstOfUtcMonth}=
  require('../n8n/consolidation/read-execution-metadata.cjs');
const endpoint='https://johnmusic.app.n8n.cloud/api/v1/executions';
const since='2026-11-01T00:00:00.000Z';
const until='2026-12-01T00:00:00.000Z';
const row=(id,mode='webhook',status='success',startedAt='2026-11-18T11:20:00Z')=>
  ({id,workflowId:'8v2wcz5lh0yUf3sw',mode,status,startedAt,privateData:{secret:'NO_OUTPUT'}});
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{
  status,headers:{'content-type':'application/json',...headers}
});
const run=(fetchImpl,options={})=>inspectSavedExecutionMetadata({
  apiKey:'read-only-fixture-key',fetchImpl,sinceUtc:since,untilUtc:until,...options
});

test('No API key or invalid window: zero network calls and no false billing claim',async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;throw Error('must not fetch');};
  const missing=await inspectSavedExecutionMetadata({apiKey:'',fetchImpl});
  assert.deepEqual(missing.issue,'N8N_READ_API_KEY_REQUIRED');
  assert.equal(calls,0);
  const invalid=await run(fetchImpl,{sinceUtc:'2026-11-32T00:00:00Z'});
  assert.equal(invalid.issue,'N8N_READ_WINDOW_INVALID');
  assert.equal(calls,0);
  assert.equal(firstOfUtcMonth(new Date('2026-11-18T12:00:00Z')),since);
});

test('Two metadata-only GETs count saved modes/statuses but never claim billable executions',async()=>{
  const requests=[];
  const fetchImpl=async(url,options)=>{
    requests.push({url,options});
    const u=new URL(url);
    assert.equal(u.origin,'https://johnmusic.app.n8n.cloud');
    assert.equal(u.pathname,'/api/v1/executions');
    assert.equal(u.searchParams.get('includeData'),'false');
    assert.equal(u.searchParams.get('limit'),'100');
    assert.equal(options.method,'GET');
    assert.equal(options.body,undefined);
    assert.equal(options.redirect,'error');
    assert.equal(options.credentials,'omit');
    assert.equal(options.cache,'no-store');
    assert.equal(options.headers['X-N8N-API-KEY'],'read-only-fixture-key');
    if(requests.length===1){
      assert.equal(u.searchParams.has('cursor'),false);
      return json({data:[row('1'),row('2','manual','error'),row('3','trigger','success',
          '2026-10-31T23:59:59Z')],nextCursor:'CURSOR_1'});
    }
    assert.equal(u.searchParams.get('cursor'),'CURSOR_1');
    return json({data:[row('4','trigger','waiting'),row('5','webhook','success',
      '2026-11-20T00:00:00Z')],nextCursor:null});
  };
  const report=await run(fetchImpl);
  assert.equal(report.ok,true);
  assert.equal(report.status,'SAVED_EXECUTION_SNAPSHOT_NOT_BILLING');
  assert.equal(report.pages_read,2);
  assert.equal(report.records_seen,5);
  assert.equal(report.records_in_window,4);
  assert.equal(report.production_mode_candidates,3);
  assert.deepEqual(report.by_mode,{manual:1,trigger:1,webhook:2});
  assert.deepEqual(report.by_status,{error:1,success:2,waiting:1});
  assert.deepEqual(report.by_workflow,{'8v2wcz5lh0yUf3sw':4});
  assert.equal(report.more_saved_pages_available,false);
  for(const flag of ['billed_n8n_executions_measured','per_file_cost_measured',
    'real_customer_e2e_verified','allows_execution','allows_checkout','allows_publication'])
    assert.equal(report[flag],false);
  assert.doesNotMatch(JSON.stringify(report),/NO_OUTPUT|read-only-fixture-key|privateData|CURSOR_1/);
});

test('Page cap is an explicitly incomplete saved-history sample',async()=>{
  let requests=0;
  const report=await run(async()=>{
    requests++;
    return json({data:[row('10')],nextCursor:'MORE'});
  },{maxPages:1});
  assert.equal(report.ok,true);
  assert.equal(report.status,'SAVED_EXECUTION_PARTIAL_SNAPSHOT_NOT_BILLING');
  assert.equal(report.more_saved_pages_available,true);
  assert.equal(report.pages_read,1);
  assert.equal(requests,1);
  assert.equal(report.billed_n8n_executions_measured,false);
});

test('Duplicate execution IDs and repeated cursors cannot produce a passing count',async()=>{
  const duplicated=await run(async url=>
    json({data:[row('20')],nextCursor:new URL(url).searchParams.has('cursor')?null:'NEXT'}));
  assert.equal(duplicated.ok,false);
  assert.equal(duplicated.issue,'N8N_READ_INCONSISTENT_PAGES');
  let sequence=30;
  const cursorLoop=await run(async()=>json({data:[row(String(sequence++))],
    nextCursor:'REPEAT'}));
  assert.equal(cursorLoop.ok,false);
  assert.equal(cursorLoop.issue,'N8N_READ_INCONSISTENT_PAGES');
});

test('Rejected, malformed and oversized provider responses are private fixed failures',async()=>{
  for(const response of [
    json({secret:'NEVER_PRINT'},401),
    json({secret:'NEVER_PRINT'},403),
    json({secret:'NEVER_PRINT'},503),
    new Response('not json',{headers:{'content-type':'application/json'}}),
    json({data:[]},200,{'content-length':'9999999'}),
    new Response('<html>wrong</html>',{headers:{'content-type':'text/html'}})
  ]){
    const r=await run(async()=>response);
    assert.equal(r.ok,false);
    assert.equal(r.billed_n8n_executions_measured,false);
    assert.doesNotMatch(JSON.stringify(r),/NEVER_PRINT|not json|wrong/);
    assert.match(r.issue,/^N8N_READ_/);
  }
});

test('Execution record IDs, modes and timestamps cannot inject data into summary',async()=>{
  for(const entry of [
    row('NOT_A_VALID_ID'),row('30','webhook','success','not-a-time'),
    {id:'30',workflowId:'<secret>',mode:'untrusted_token',status:'untrusted_status',
      startedAt:'2026-11-18T11:20:00Z'}
  ]){
    const r=await run(async()=>json({data:[entry],nextCursor:null}));
    if(entry.id==='NOT_A_VALID_ID'||entry.startedAt==='not-a-time'){
      assert.equal(r.ok,false);
      assert.equal(r.issue,'N8N_READ_UNEXPECTED_RESPONSE');
    }else{
      assert.equal(r.ok,true);
      assert.deepEqual(r.by_mode,{other:1});
      assert.deepEqual(r.by_status,{other:1});
      assert.deepEqual(r.by_workflow,{unidentified:1});
      assert.doesNotMatch(JSON.stringify(r),/secret|untrusted_token|untrusted_status/);
    }
  }
});

test('Shared timeout bounds a transport that ignores AbortSignal',async()=>{
  const r=await run(()=>new Promise(()=>{}),{timeoutMs:15});
  assert.equal(r.ok,false);
  assert.equal(r.issue,'N8N_READ_TIMEOUT');
});

test('CLI without a private key exits without attempting live API usage',()=>{
  const file=require('node:path').resolve(__dirname,'../n8n/consolidation/read-execution-metadata.cjs');
  const p=spawnSync(process.execPath,[file],{
    env:{...process.env,SMA_N8N_READ_API_KEY:''},encoding:'utf8',timeout:4000
  });
  assert.equal(p.status,1);
  const r=JSON.parse(p.stdout);
  assert.equal(r.issue,'N8N_READ_API_KEY_REQUIRED');
  assert.equal(r.allows_execution,false);
  assert.equal(p.stderr,'');
});
