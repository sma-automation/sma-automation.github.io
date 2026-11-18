'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('../n8n/package-payment/build-worker.cjs');
const {summarizeActivePaymentGraph}=require('../n8n/package-payment/diagnose-active-payment-graph.cjs');

const source={nodes:[
 {name:'SMA – Mollie – Erste Zahlung erstellen',credentials:{httpHeaderAuth:{id:'SECRET_MERCHANT_ID'}}},
 {name:'SMA – Supabase – Bestellung spiegeln',credentials:{httpHeaderAuth:{id:'SECRET_DATABASE_ID'}}},
 {name:'SMA – Paketauswahl – Kunde prüfen',parameters:{dataTableId:{value:'SECRET_TABLE_ID'}}}
]};
const buildFixture=()=>JSON.parse(JSON.stringify(build(source)));

test('A structurally complete candidate lists only counts and no private reference',()=>{
 const nodes=buildFixture().nodes;
 const r=summarizeActivePaymentGraph(nodes);
 assert.equal(r.status,'STRUCTURE_DIAGNOSTIC_NOT_E2E');
 assert.equal(r.published_nodes_count,nodes.length);
 assert.equal(r.expected_payment_nodes_count,nodes.length);
 assert.equal(r.expected_payment_nodes_present,nodes.length);
 assert.deepEqual(r.missing_expected_nodes,[]);
 assert.equal(r.existing_merchant_nodes,6);
 assert.equal(r.merchant_nodes_with_credential_reference,6);
 assert.equal(r.existing_database_nodes,2);
 assert.equal(r.database_nodes_with_credential_reference,2);
 assert.equal(r.existing_customer_table_nodes,4);
 assert.equal(r.customer_table_nodes_with_reference,4);
 assert.equal(r.required_payment_webhooks_present,true);
 assert.equal(r.activation_or_payment_authorized,false);
 assert.equal(r.billing_or_customer_e2e_verified,false);
 assert.doesNotMatch(JSON.stringify(r),/SECRET|table-reference|merchant-reference|database-reference/);
});

test('Missing expected nodes are named only from the audited template; arbitrary live names stay private',()=>{
 const nodes=buildFixture().nodes.filter(n=>!['Ordnerzuordnung vor Aktivierung prüfen','Mollie customer'].includes(n.name));
 nodes.push({name:'PRIVATE CUSTOMER: SECRET_EMAIL@example.invalid',parameters:{x:'SECRET_PAYLOAD'}});
 const r=summarizeActivePaymentGraph(nodes);
 assert.ok(r.missing_expected_nodes.includes('Ordnerzuordnung vor Aktivierung prüfen'));
 assert.ok(r.missing_expected_nodes.includes('Mollie customer'));
 assert.equal(r.existing_merchant_nodes,5);
 assert.equal(r.merchant_nodes_with_credential_reference,5);
 assert.equal(r.expected_payment_nodes_present,r.expected_payment_nodes_count-2);
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE|SECRET|example\.invalid/);
});

test('API credential redaction is separate from structurally absent nodes',()=>{
 const nodes=buildFixture().nodes;
 for(const node of nodes){delete node.credentials;if(node.type==='n8n-nodes-base.dataTable')delete node.parameters.dataTableId;}
 const r=summarizeActivePaymentGraph(nodes);
 assert.equal(r.expected_payment_nodes_present,r.expected_payment_nodes_count);
 assert.deepEqual(r.missing_expected_nodes,[]);
 assert.equal(r.existing_database_nodes,2);
 assert.equal(r.database_nodes_with_credential_reference,0);
 assert.equal(r.existing_merchant_nodes,6);
 assert.equal(r.merchant_nodes_with_credential_reference,0);
 assert.equal(r.existing_customer_table_nodes,4);
 assert.equal(r.customer_table_nodes_with_reference,0);
 assert.equal(r.required_payment_webhooks_present,true);
});

test('Unknown webhook routes, malformed structures and overflow cannot claim payment safety',()=>{
 const nodes=buildFixture().nodes;
 const primary=nodes.find(n=>n.name==='Zahlungsdienst');
 primary.parameters.path='UNTRUSTED_PATH_SECRET';
 const r=summarizeActivePaymentGraph(nodes);
 assert.equal(r.required_payment_webhooks_present,false);
 assert.doesNotMatch(JSON.stringify(r),/UNTRUSTED_PATH_SECRET/);
 assert.deepEqual(summarizeActivePaymentGraph(null),{status:'UNAVAILABLE'});
 assert.deepEqual(summarizeActivePaymentGraph(Array.from({length:5001},()=>null)),{status:'UNAVAILABLE'});
});
