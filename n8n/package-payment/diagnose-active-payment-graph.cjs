'use strict';

// Safe summary of an already retrieved ACTIVE n8n payment graph.
// Never return node parameters, live node names other than those compiled from
// the public SMA template, credential IDs, table IDs, execution IDs, or item data.
const {build}=require('./build-worker.cjs');
const source={nodes:[
  {name:'SMA – Mollie – Erste Zahlung erstellen',credentials:{httpHeaderAuth:{id:'static-template-merchant'}}},
  {name:'SMA – Supabase – Bestellung spiegeln',credentials:{httpHeaderAuth:{id:'static-template-database'}}},
  {name:'SMA – Paketauswahl – Kunde prüfen',parameters:{dataTableId:{value:'static-template-table'}}}
]};
const expected=Object.freeze(build(source).nodes.map(n=>n.name));
const merchant=Object.freeze(['Mollie customer','Mollie first','Mollie payment',
  'Mollie subscribe','Mollie subscription','Mollie Abozahlungen lesen']);
const database=Object.freeze(['Einmalauftrag abrufen','Folgeauftrag abrufen']);
const customerTable=Object.freeze(['Kundenzeile account','Kundenzeile activate',
  'Kundenzeile disable','Bestehenden Zugang fortsetzen']);
const paymentWebhooks=Object.freeze(['sma-paket-dienst-v1','sma-paket-folge-dienst-v1']);
const expectedSet=new Set(expected);
const refPresent=n=>typeof n?.credentials?.httpHeaderAuth?.id==='string'&&n.credentials.httpHeaderAuth.id.length>0;
const tablePresent=n=>typeof n?.parameters?.dataTableId?.value==='string'&&n.parameters.dataTableId.value.length>0;

function summarizeActivePaymentGraph(nodes){
  if(!Array.isArray(nodes)||nodes.length>5000)return {status:'UNAVAILABLE'};
  const actual=new Map();
  for(const node of nodes){
    if(node&&typeof node==='object'&&!Array.isArray(node)&&
      typeof node.name==='string'&&expectedSet.has(node.name)&&!actual.has(node.name))
      actual.set(node.name,node);
  }
  const missing=expected.filter(name=>!actual.has(name));
  const count=names=>names.filter(name=>actual.has(name)).length;
  const refs=names=>names.filter(name=>refPresent(actual.get(name))).length;
  const tableRefs=names=>names.filter(name=>tablePresent(actual.get(name))).length;
  const paths=paymentWebhooks.map(path=>nodes.filter(n=>
    n?.type==='n8n-nodes-base.webhook'&&n.parameters?.path===path).length===1);
  return {
    status:'STRUCTURE_DIAGNOSTIC_NOT_E2E',
    published_nodes_count:nodes.length,
    expected_payment_nodes_count:expected.length,
    expected_payment_nodes_present:expected.length-missing.length,
    // These are only names from our public audited generator, NEVER names
    // returned verbatim from n8n or provider-generated metadata.
    missing_expected_nodes:missing,
    existing_merchant_nodes:count(merchant),
    merchant_nodes_with_credential_reference:refs(merchant),
    existing_database_nodes:count(database),
    database_nodes_with_credential_reference:refs(database),
    existing_customer_table_nodes:count(customerTable),
    customer_table_nodes_with_reference:tableRefs(customerTable),
    first_payment_webhook_present:paths[0],
    renewal_payment_webhook_present:paths[1],
    required_payment_webhooks_present:paths.every(Boolean),
    activation_folder_guard_present:actual.has('Ordnerzuordnung vor Aktivierung prüfen'),
    activation_customer_update_present:actual.has('Kundenzeile activate'),
    credential_ids_disclosed:false,
    customer_ids_disclosed:false,
    activation_or_payment_authorized:false,
    billing_or_customer_e2e_verified:false
  };
}
module.exports={summarizeActivePaymentGraph};
