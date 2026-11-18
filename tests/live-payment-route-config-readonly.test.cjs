'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {inspectRouteConfigMarkers,classifyTarget}=
  require('../n8n/package-payment/inspect-payment-route-config.cjs');
const node=(type,parameters={},credentials)=>({
  type:'n8n-nodes-base.'+type,parameters,...(credentials?{credentials}:{})
});
const idFilter=['id','kunde_id','kunde_email','upload_folder_id','processing_folder_id']
  .map(keyName=>({keyName,condition:'equals',keyValue:'PRIVATE_VALUE'}));

test('Only exact static trusted HTTPS hosts count as configured Mollie/SMA RPC targets',()=>{
  assert.equal(classifyTarget('https://api.mollie.com/v2/payments'),'mollie');
  assert.equal(classifyTarget('https://bnvnmdxosbnuzedokqgh.supabase.co/rest/v1/rpc/sma_package_ticket_v1'),'sma_rpc');
  for(const bad of [
    'https://api.mollie.com.attacker.invalid/v2/payments',
    'https://api.mollie.com@attacker.invalid/v2/payments',
    'http://api.mollie.com/v2/payments',
    'https://api.mollie.com/v1/payments',
    'https://bnvnmdxosbnuzedokqgh.supabase.co/rest/v1/sma_customers',
    'https://bnvnmdxosbnuzedokqgh.supabase.co/rest/v1/rpc/unsafe/extra',
    'https://api.mollie.com/v2/payments#fragment'
  ])assert.equal(classifyTarget(bad),'other');
  for(const dynamic of [
    null,undefined,42,'', '={{ $json.paymentUrl }}',
    'https://api.mollie.com/v2/payments/{{ $json.id }}'
  ])assert.equal(classifyTarget(dynamic),'nonliteral');
});

test('Aggregate configured routes without revealing secrets or declaring safety',()=>{
  const selected=[
    node('httpRequest',{url:'https://api.mollie.com/v2/payments',method:'POST',
      headerParameters:{parameters:[{name:'Idempotency-Key',value:'SENSITIVE_KEY_VALUE'}]}},
      {httpHeaderAuth:{id:'PRIVATE_MOLLIE_CREDENTIAL'}}),
    node('httpRequest',{url:'https://bnvnmdxosbnuzedokqgh.supabase.co/rest/v1/rpc/sma_package_ticket_v1',
      method:'POST'},{httpHeaderAuth:{id:'PRIVATE_SUPABASE_CREDENTIAL'}}),
    node('httpRequest',{url:'={{ $json.privateUrl }}',method:'GET'}),
    node('httpRequest',{url:'https://attacker.example.invalid/PRIVATE_PATH',method:'DELETE'}),
    node('dataTable',{operation:'update',dataTableId:{value:'PRIVATE_TABLE_ID'},
      matchType:'allConditions',filters:{conditions:idFilter}}),
    node('dataTable',{operation:'get',dataTableId:{value:'PRIVATE_TABLE_ID'}}),
    node('code',{jsCode:'const ticket=$json.ticket; const upload_folder_id=1; const processing_folder_id=2; const payment_id=3, customerId=4; return []; // PRIVATE_SENSITIVE_CODE'})
  ];
  const r=inspectRouteConfigMarkers(selected);
  assert.equal(r.status,'CONFIG_MARKERS_PRESENT_NOT_VALIDATED');
  assert.equal(r.http_literal_mollie_v2,1);
  assert.equal(r.http_literal_sma_supabase_rpc,1);
  assert.equal(r.http_dynamic_or_missing_target,1);
  assert.equal(r.http_other_literal_target,1);
  assert.equal(r.http_configured_mutating_method,3);
  assert.equal(r.http_with_header_auth_reference,2);
  assert.equal(r.http_with_idempotency_key_header,1);
  assert.equal(r.data_table_write_operations,1);
  assert.equal(r.data_table_get_operations,1);
  assert.equal(r.data_table_writes_with_identity_filter_markers,1);
  assert.equal(r.data_table_writes_with_both_folder_filter_markers,1);
  assert.equal(r.code_nodes_with_ticket_marker,1);
  assert.equal(r.code_nodes_with_both_folder_markers,1);
  assert.equal(r.code_nodes_with_payment_receipt_markers,1);
  assert.equal(r.ticket_validation_proven,false);
  assert.equal(r.folder_ownership_and_write_proven,false);
  assert.equal(r.mollie_receipt_validation_proven,false);
  assert.equal(r.customer_activation_authorized,false);
  const output=JSON.stringify(r);
  assert.doesNotMatch(output,/PRIVATE|SENSITIVE|attacker|example\.invalid|MOLLIE_CREDENTIAL|customerId/i,
    'The intentionally allowed fixed field names must not be confused with raw payloads');
});

test('Redacted counters cannot be converted into verified security by pasted marker words',()=>{
  const r=inspectRouteConfigMarkers([node('code',{jsCode:
    '// ticket upload_folder_id processing_folder_id payment_id customerId in a comment only'})]);
  assert.equal(r.code_nodes_with_ticket_marker,1);
  assert.equal(r.code_nodes_with_both_folder_markers,1);
  assert.equal(r.code_nodes_with_payment_receipt_markers,1);
  assert.equal(r.ticket_validation_proven,false);
  assert.equal(r.folder_ownership_and_write_proven,false);
  assert.equal(r.mollie_receipt_validation_proven,false);
});

test('Malformed HTTP and data table parameters never crash the redacted reader',()=>{
  const r=inspectRouteConfigMarkers([
    node('httpRequest',{url:17,method:null,headerParameters:{parameters:[{},null,12]}}),
    node('httpRequest',{url:'https://api.mollie.com/v2/payments',method:17,
      headerParameters:{parameters:[{name:4}]}}),
    node('dataTable',{operation:'update',matchType:'allConditions',filters:{conditions:[{},null,42]}}),
    node('code',{jsCode:77}),
    node('code',{jsCode:'X'.repeat(128*1024+1)})
  ]);
  assert.equal(r.http_dynamic_or_missing_target,1);
  assert.equal(r.http_literal_mollie_v2,1);
  assert.equal(r.http_with_idempotency_key_header,0);
  assert.equal(r.data_table_write_operations,1);
  assert.equal(r.data_table_writes_with_identity_filter_markers,0);
  assert.equal(r.code_nodes_skipped_oversize,2);
  assert.equal(r.all_payment_paths_verified,false);
});

test('Out-of-bound collections and unknown payloads return fixed unavailable state',()=>{
  assert.deepEqual(inspectRouteConfigMarkers(null),{status:'UNAVAILABLE'});
  assert.deepEqual(inspectRouteConfigMarkers([null]),{status:'UNAVAILABLE'});
  assert.deepEqual(inspectRouteConfigMarkers(Array(5001).fill({})),{status:'UNAVAILABLE'});
});
