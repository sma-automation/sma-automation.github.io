'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {inspectPaymentWebhookPaths}=require('../n8n/package-payment/inspect-payment-webhook-paths.cjs');

const node=(name,type,parameters={})=>({name,type:'n8n-nodes-base.'+type,parameters});
const edge=target=>({node:target,type:'main',index:0});
function fixture(){
  return {
    nodes:[
      node('First','webhook',{httpMethod:'POST',path:'sma-paket-dienst-v1',responseMode:'responseNode'}),
      node('Sensitive - customer@example.invalid','code',{jsCode:'SENSITIVE_API_TOKEN'}),
      node('First reply','respondToWebhook'),
      node('Recurring','webhook',{httpMethod:'POST',path:'sma-paket-folge-dienst-v1',responseMode:'responseNode'}),
      node('Provider','httpRequest',{method:'POST',url:'https://SECRET_PROVIDER.invalid/'}),
      node('Customer state','dataTable',{operation:'update',dataTableId:{value:'SECRET_TABLE'}}),
      node('Renewal reply','respondToWebhook')
    ],
    connections:{
      First:{main:[[edge('Sensitive - customer@example.invalid')]]},
      'Sensitive - customer@example.invalid':{main:[[edge('First reply')]]},
      Recurring:{main:[[edge('Provider')]]},
      Provider:{main:[[edge('Customer state')]]},
      'Customer state':{main:[[edge('Renewal reply')]]}
    }
  };
}
test('Pure, bounded trace follows separate webhook MAIN edges but claims no safety',()=>{
  const r=inspectPaymentWebhookPaths(fixture());
  assert.equal(r.status,'PUBLISHED_PAYMENT_MAIN_GRAPH_TRACE_NOT_E2E');
  assert.equal(r.scope,'n8n_published_version_main_edges_only');
  assert.equal(r.graph_nodes,7);
  assert.equal(r.graph_main_edges,5);
  assert.equal(r.first_payment.entry_count,1);
  assert.equal(r.first_payment.response_mode_matches,true);
  assert.equal(r.first_payment.outgoing_edges,1);
  assert.equal(r.first_payment.reachable_nodes,3);
  assert.equal(r.first_payment.reachable_code_nodes,1);
  assert.equal(r.first_payment.reachable_respond_to_webhook,1);
  assert.equal(r.first_payment.reachable_http_requests,0);
  assert.equal(r.renewal.reachable_nodes,4);
  assert.equal(r.renewal.reachable_http_requests,1);
  assert.equal(r.renewal.reachable_data_table_nodes,1);
  assert.equal(r.renewal.possible_http_mutations,1);
  assert.equal(r.first_payment.static_response_terminal_nodes,1);
  assert.equal(r.first_payment.static_nonresponse_terminal_nodes,0);
  assert.equal(r.first_payment.explicit_empty_decision_output_ports,0);
  assert.equal(r.first_payment.missing_if_output_ports,0);
  assert.equal(r.renewal.static_response_terminal_nodes,1);
  assert.equal(r.renewal.static_nonresponse_terminal_nodes,0);
  assert.equal(r.first_payment.config_markers.status,'CONFIG_MARKERS_PRESENT_NOT_VALIDATED');
  assert.equal(r.first_payment.config_markers.http_literal_mollie_v2,0);
  assert.equal(r.renewal.config_markers.http_other_literal_target,1);
  assert.equal(r.renewal.config_markers.data_table_write_operations,1);
  assert.equal(r.renewal.config_markers.ticket_validation_proven,false);
  assert.equal(r.renewal.config_markers.customer_activation_authorized,false);
  assert.equal(r.renewal.reachable_respond_to_webhook,1);
  assert.equal(r.shared_reachable_nodes,0);
  assert.equal(r.active_version_stability_verified,false);
  assert.equal(r.all_conditional_paths_verified,false);
  assert.equal(r.payment_or_activation_authorized,false);
  assert.equal(r.billing_or_customer_e2e_verified,false);
  assert.doesNotMatch(JSON.stringify(r),/Sensitive|SECRET|Provider|customer@example.invalid|dataTableId/);
});
test('Disconnected start or path with no reachable response remains unverified',()=>{
  const g=fixture();g.connections.First={main:[[]]};
  const r=inspectPaymentWebhookPaths(g);
  assert.equal(r.first_payment.outgoing_edges,0);
  assert.equal(r.first_payment.reachable_nodes,1);
  assert.equal(r.first_payment.reachable_respond_to_webhook,0);
  assert.equal(r.renewal.reachable_respond_to_webhook,1);
  assert.equal(r.first_payment.path_is_proven_safe,false);
  assert.equal(r.renewal.path_is_proven_safe,false);
});
test('Duplicate webhook paths do not count as one known production entry',()=>{
  const g=fixture();
  g.nodes.push(node('private-synthetic-duplicate','webhook',{httpMethod:'POST',path:'sma-paket-dienst-v1',responseMode:'responseNode'}));
  const r=inspectPaymentWebhookPaths(g);
  assert.equal(r.first_payment.entry_count,2);
  assert.equal(r.first_payment.reachable_nodes,0);
  assert.equal(r.first_payment.response_mode_matches,false);
  assert.deepEqual(r.first_payment.config_markers,{status:'UNAVAILABLE'});
  assert.equal(r.shared_reachable_nodes,null);
  assert.doesNotMatch(JSON.stringify(r),/private-synthetic-duplicate/);
});
test('Cycles are finite, and MAIN edges only are followed',()=>{
  const g=fixture();
  g.connections['First reply']={main:[[edge('First')]],ai_tool:[[edge('Provider')]]};
  const r=inspectPaymentWebhookPaths(g);
  assert.equal(r.first_payment.reachable_nodes,3);
  assert.equal(r.first_payment.reachable_http_requests,0);
  assert.equal(r.first_payment.reachable_respond_to_webhook,1);
  assert.equal(r.graph_main_edges,6);
});
test('Unknown edge targets and sources remain aggregate diagnostics only',()=>{
  const g=fixture();
  g.connections.First.main[0].push(edge('private_missing_customer_123'));
  g.connections['private_nonexistent_source']={main:[[edge('First')]]};
  const r=inspectPaymentWebhookPaths(g);
  assert.equal(r.unknown_edge_targets,1);
  assert.equal(r.unknown_connection_sources,1);
  assert.equal(r.first_payment.reachable_nodes,3);
  assert.doesNotMatch(JSON.stringify(r),/private_missing|nonexistent/);
});
test('An untrusted graph cannot cause unbounded traversal or disclose names',()=>{
  const invalid=[
    null,[],{nodes:[],connections:null},
    {nodes:[{name:'Same'},{name:'Same'}],connections:{}},
    {nodes:[{name:'SECRET'},{name:'valid'}],connections:{SECRET:{main:[[null]]}}},
    {nodes:[{name:'SECRET'}],connections:{SECRET:{main:[[{type:'main',node:'valid',index:-1}]]}}},
    {nodes:new Array(5001).fill(null),connections:{}}
  ];
  for(const g of invalid){
    const r=inspectPaymentWebhookPaths(g);
    assert.match(r.status,/UNAVAILABLE/);
    assert.equal(r.payment_or_activation_authorized,false);
    assert.doesNotMatch(JSON.stringify(r),/SECRET|Same|valid/);
  }
});
test('A reachable response does not hide a second nonresponse terminal',()=>{
  const g=fixture();
  g.nodes.push(node('Private decision','if'),node('Private dead end','code'));
  g.connections.First={main:[[edge('Private decision')]]};
  g.connections['Private decision']={main:[
    [edge('First reply')],[edge('Private dead end')]
  ]};
  const r=inspectPaymentWebhookPaths(g);
  assert.equal(r.first_payment.reachable_respond_to_webhook,1);
  assert.equal(r.first_payment.static_terminal_nodes,2);
  assert.equal(r.first_payment.static_response_terminal_nodes,1);
  assert.equal(r.first_payment.static_nonresponse_terminal_nodes,1);
  assert.equal(r.first_payment.explicit_empty_decision_output_ports,0);
  assert.equal(r.first_payment.path_is_proven_safe,false);
  assert.doesNotMatch(JSON.stringify(r),/Private decision|Private dead end/);
});

test('Explicit empty IF output is reported, not treated as a successful response',()=>{
  const g=fixture();
  g.nodes.push(node('Private condition','if'));
  g.connections.First={main:[[edge('Private condition')]]};
  g.connections['Private condition']={main:[[edge('First reply')],[]]};
  const r=inspectPaymentWebhookPaths(g);
  assert.equal(r.first_payment.reachable_respond_to_webhook,1);
  assert.equal(r.first_payment.static_terminal_nodes,1);
  assert.equal(r.first_payment.static_nonresponse_terminal_nodes,0);
  assert.equal(r.first_payment.explicit_empty_decision_output_ports,1);
  assert.equal(r.first_payment.path_is_proven_safe,false);
});


test('Missing IF false output is reported even when only the true output exists',()=>{
  const g=fixture();
  g.nodes.push(node('Private missing IF false','if'));
  g.connections.First={main:[[edge('Private missing IF false')]]};
  g.connections['Private missing IF false']={main:[[edge('First reply')]]};
  const r=inspectPaymentWebhookPaths(g);
  assert.equal(r.first_payment.reachable_respond_to_webhook,1);
  assert.equal(r.first_payment.static_nonresponse_terminal_nodes,0);
  assert.equal(r.first_payment.explicit_empty_decision_output_ports,0);
  assert.equal(r.first_payment.missing_if_output_ports,1);
  assert.equal(r.first_payment.path_is_proven_safe,false);
  assert.doesNotMatch(JSON.stringify(r),/Private missing IF false/);
});

test('Null decision output and completely missing IF connections are distinguished',()=>{
  const g=fixture();
  g.nodes.push(node('Private nullable IF','if'));
  g.connections.First={main:[[edge('Private nullable IF')]]};
  g.connections['Private nullable IF']={main:[[edge('First reply')],null]};
  let r=inspectPaymentWebhookPaths(g);
  assert.equal(r.first_payment.explicit_empty_decision_output_ports,1);
  assert.equal(r.first_payment.missing_if_output_ports,0);
  delete g.connections['Private nullable IF'];
  r=inspectPaymentWebhookPaths(g);
  assert.equal(r.first_payment.reachable_respond_to_webhook,0);
  assert.equal(r.first_payment.explicit_empty_decision_output_ports,0);
  assert.equal(r.first_payment.missing_if_output_ports,2);
  assert.equal(r.first_payment.static_nonresponse_terminal_nodes,1);
  assert.doesNotMatch(JSON.stringify(r),/Private nullable IF/);
});

test('Switch output count is not invented from variable rule configuration',()=>{
  const g=fixture();
  g.nodes.push(node('Private switch','switch',{rules:{values:[{},{}]}}));
  g.connections.First={main:[[edge('Private switch')]]};
  g.connections['Private switch']={main:[[edge('First reply')]]};
  const r=inspectPaymentWebhookPaths(g);
  assert.equal(r.first_payment.missing_if_output_ports,0);
  assert.equal(r.first_payment.explicit_empty_decision_output_ports,0);
  assert.equal(r.first_payment.path_is_proven_safe,false);
});

test('A reachable response in a cycle is not a terminal response',()=>{
  const g=fixture();
  g.connections['First reply']={main:[[edge('First')]]};
  const r=inspectPaymentWebhookPaths(g);
  assert.equal(r.first_payment.reachable_respond_to_webhook,1);
  assert.equal(r.first_payment.static_terminal_nodes,0);
  assert.equal(r.first_payment.static_response_terminal_nodes,0);
  assert.equal(r.first_payment.path_is_proven_safe,false);
});

test('No assumptions about side effects from correctly linked reply nodes',()=>{
  const r=inspectPaymentWebhookPaths(fixture());
  assert.equal(r.first_payment.static_terminal_nodes,1);
  assert.equal(r.renewal.static_terminal_nodes,1);
  assert.equal(r.first_payment.path_is_proven_safe,false);
  assert.equal(r.renewal.path_is_proven_safe,false);
});
