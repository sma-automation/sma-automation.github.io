'use strict';

// Offline inspection of an independently obtained n8n ACTIVE VERSION readback.
// It never contacts n8n, Mollie, Supabase or Google Drive, and never changes a customer.
const {isDeepStrictEqual}=require('node:util');
const {readFileSync,statSync}=require('node:fs');
const {build}=require('./build-worker.cjs');

const fixture={
  nodes:[
    {name:'SMA – Mollie – Erste Zahlung erstellen',credentials:{httpHeaderAuth:{id:'merchant-reference'}}},
    {name:'SMA – Supabase – Bestellung spiegeln',credentials:{httpHeaderAuth:{id:'database-reference'}}},
    {name:'SMA – Paketauswahl – Kunde prüfen',parameters:{dataTableId:{value:'table-reference'}}}
  ]
};
const template=build(fixture);
const templateNames=new Set(template.nodes.map(node=>node.name));
const merchantNames=['Mollie customer','Mollie first','Mollie payment',
  'Mollie subscribe','Mollie subscription','Mollie Abozahlungen lesen'];
const databaseNames=['Einmalauftrag abrufen','Folgeauftrag abrufen'];
const tableNames=['Kundenzeile account','Kundenzeile activate','Kundenzeile disable',
  'Bestehenden Zugang fortsetzen'];
// Any unreviewed entry into the known payment graph could bypass the
// ticket, operation selector, or one of the downstream activation guards.
const protectedNames=templateNames;
const publicPaths=['sma-paket-dienst-v1','sma-paket-folge-dienst-v1'];

function record(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function normalizedParameters(node){
  if(!record(node?.parameters))return null;
  const p=structuredClone(node.parameters);
  if(node.type==='n8n-nodes-base.dataTable')delete p.dataTableId;
  if(node.type==='n8n-nodes-base.switch'){
    for(const rule of p.rules?.values||[])
      for(const condition of rule.conditions?.conditions||[])delete condition.id;
  }
  return p;
}
function outgoing(graph,name){
  const c=graph.connections?.[name];
  if(!c)return [];
  if(!record(c)||!Array.isArray(c.main))return null;
  return c.main.map(port=>{
    if(!Array.isArray(port))return null;
    return port.map(edge=>record(edge)?{
      node:edge.node,type:edge.type,index:edge.index
    }:null);
  });
}
function activeGraph(readback){
  if(!record(readback)||readback.active!==true||
    typeof readback.activeVersionId!=='string'||!readback.activeVersionId)return null;
  if(record(readback.activeVersion)&&readback.activeVersion.versionId===readback.activeVersionId &&
    Array.isArray(readback.activeVersion.nodes))return readback.activeVersion;
  if(readback.versionId===readback.activeVersionId&&Array.isArray(readback.nodes))return readback;
  return null;
}
function credentialReference(node){
  const id=node?.credentials?.httpHeaderAuth?.id;
  return typeof id==='string'&&id.length>0?id:null;
}
function tableReference(node){
  const val=node?.parameters?.dataTableId;
  return record(val)&&typeof val.value==='string'&&val.value.length>0?val.value:null;
}
function auditPublishedPackageWorker(readback){
  const issues=new Set();
  const flag=(bad,code)=>{if(bad)issues.add(code);};
  const graph=activeGraph(readback);
  if(!graph){
    issues.add('published_active_graph_not_confirmed');
    return result(issues);
  }
  flag(!record(graph.connections),'connections_not_available');
  const actual=new Map();
  for(const node of graph.nodes||[]){
    if(!record(node)||typeof node.name!=='string'||!node.name){
      issues.add('invalid_node_metadata');continue;
    }
    if(actual.has(node.name))issues.add('duplicate_node_names');
    actual.set(node.name,node);
  }
  for(const expected of template.nodes){
    const node=actual.get(expected.name);
    if(!node){issues.add('required_payment_nodes_missing');continue;}
    flag(node.type!==expected.type||node.typeVersion!==expected.typeVersion,
      'payment_node_types_not_matching');
    flag(!isDeepStrictEqual(normalizedParameters(node),normalizedParameters(expected)),
      'payment_node_parameters_not_matching');
    for(const key of ['alwaysOutputData']){
      if(Object.hasOwn(expected,key))
        flag(node[key]!==expected[key],'payment_node_settings_not_matching');
    }
    flag(!isDeepStrictEqual(outgoing(graph,expected.name),outgoing(template,expected.name)),
      'payment_routes_not_matching');
  }
  // An extra direct route to the data-table update may bypass the required
  // folder check even when the checked route itself is still intact.
  for(const [source,conn] of Object.entries(graph.connections||{})){
    if(templateNames.has(source))continue;
    for(const port of conn?.main||[]){
      if(!Array.isArray(port)){issues.add('invalid_extra_route');continue;}
      if(port.some(edge=>protectedNames.has(edge?.node)))
        issues.add('unexpected_input_to_payment_guard');
    }
  }
  for(const path of publicPaths){
    const matches=(graph.nodes||[]).filter(node=>
      node?.type==='n8n-nodes-base.webhook'&&node.parameters?.path===path);
    flag(matches.length!==1,'duplicate_or_missing_payment_webhook');
    if(matches.length===1)
      flag(matches[0].parameters?.httpMethod!=='POST' ||
        matches[0].parameters?.responseMode!=='responseNode',
        'payment_webhook_contract_mismatch');
  }
  const merchant=merchantNames.map(name=>credentialReference(actual.get(name)));
  const database=databaseNames.map(name=>credentialReference(actual.get(name)));
  flag(merchant.some(id=>!id)||new Set(merchant).size!==1,'mollie_credential_reference_mismatch');
  flag(database.some(id=>!id)||new Set(database).size!==1,'database_credential_reference_mismatch');
  flag(Boolean(merchant[0]&&database[0]&&merchant[0]===database[0]),'merchant_and_database_credential_overlap');
  const tables=tableNames.map(name=>tableReference(actual.get(name)));
  flag(tables.some(id=>!id)||new Set(tables).size!==1,'n8n_customer_table_reference_mismatch');
  // Each route must terminate in the expected respond-to-webhook graph. A
  // successful call to the webhook alone is not a payment/provider receipt.
  return result(issues);
}
function result(issues){
  const problems=[...issues].sort();
  return {
    scope:'provided_published_n8n_export_only',
    ok:problems.length===0,
    status:problems.length?'PUBLISHED_PAYMENT_CONTRACT_REVIEW_REQUIRED':'ACTIVE_PAYMENT_GRAPH_STRUCTURALLY_MATCHES_NOT_E2E',
    issues:problems,
    account_assignment_verified:false,
    drive_folder_access_verified:false,
    mollie_payment_verified:false,
    real_customer_e2e_verified:false,
    allows_checkout:false,
    activates_customer:false,
    billed_n8n_executions_measured:false
  };
}
module.exports={auditPublishedPackageWorker};
if(require.main===module){
  let report;
  try{
    if(process.argv.length!==3)throw Error('INVALID_ARGUMENTS');
    const path=process.argv[2];
    if(statSync(path).size>12*1024*1024)throw Error('INVALID_EXPORT_SIZE');
    const readback=JSON.parse(readFileSync(path,'utf8'));
    report=auditPublishedPackageWorker(readback);
  }catch{
    report=result(new Set(['unreadable_or_incomplete_export']));
  }
  // Deliberately never print the source export, credential IDs or its path.
  process.stdout.write(JSON.stringify(report)+'\n');
  if(!report.ok)process.exitCode=1;
}
