'use strict';

// Exact, name-independent comparison of one already retrieved PUBLISHED n8n graph
// against the reviewed standalone payment worker. No API calls, executions,
// credentials, workflow JSON, node names, or code are included in the result.
const {isDeepStrictEqual}=require('node:util');
const {build}=require('./build-worker.cjs');

const source={nodes:[
  {name:'SMA – Mollie – Erste Zahlung erstellen',credentials:{httpHeaderAuth:{id:'template-merchant'}}},
  {name:'SMA – Supabase – Bestellung spiegeln',credentials:{httpHeaderAuth:{id:'template-database'}}},
  {name:'SMA – Paketauswahl – Kunde prüfen',parameters:{dataTableId:{value:'template-customers'}}}
]};
const merchants=['Mollie customer','Mollie first','Mollie payment',
  'Mollie subscribe','Mollie subscription','Mollie Abozahlungen lesen'];
const databases=['Einmalauftrag abrufen','Folgeauftrag abrufen'];
const customers=['Kundenzeile account','Kundenzeile activate',
  'Kundenzeile disable','Bestehenden Zugang fortsetzen'];
const webhooks=[['Zahlungsdienst','sma-paket-dienst-v1'],
  ['Folgeabgleich','sma-paket-folge-dienst-v1']];
const noGrant={allows_checkout:false,activates_customer:false,
  payment_or_activation_authorized:false,real_customer_e2e_verified:false,
  billed_n8n_executions_measured:false};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);

function outcome(issues,mappedCount){
  const list=[...new Set(issues)].sort();
  return {ok:list.length===0,
    status:list.length?'PUBLISHED_PAYMENT_EQUIVALENCE_REVIEW_REQUIRED':
      'PUBLISHED_PAYMENT_EXACT_SOURCE_EQUIVALENCE_NOT_E2E',
    scope:'provided_published_graph_main_edges_and_parameters',
    matched_template_nodes:mappedCount,
    issues:list,...noGrant};
}
function outgoing(graph,name){
  const c=graph.connections[name];
  if(c===undefined)return [];
  if(!object(c)||!Array.isArray(c.main))return null;
  const result=[];
  for(const port of c.main){
    if(!Array.isArray(port))return null;
    const links=[];
    for(const e of port){
      if(!object(e)||typeof e.node!=='string'||e.type!=='main'||
        !Number.isSafeInteger(e.index)||e.index<0)return null;
      links.push({node:e.node,index:e.index});
    }
    result.push(links);
  }
  return result;
}
function canonicalValue(value,actualToExpected){
  if(typeof value==='string'){
    // n8n updates explicit $('Node name') references when a node is renamed.
    // Remap only such references; do not rewrite unrelated URLs or user data.
    return value.replace(/\$\(\s*(['"])([^'"\r\n]+)\1\s*\)/g,(whole,quote,name)=>
      actualToExpected.has(name)?'$('+quote+actualToExpected.get(name)+quote+')':whole);
  }
  if(Array.isArray(value))return value.map(x=>canonicalValue(x,actualToExpected));
  if(object(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>
    [k,canonicalValue(v,actualToExpected)]));
  return value;
}
function normalizedParameters(node,actualToExpected){
  if(!object(node?.parameters))return null;
  const p=canonicalValue(node.parameters,actualToExpected);
  if(node.type==='n8n-nodes-base.dataTable')delete p.dataTableId;
  if(node.type==='n8n-nodes-base.switch'){
    for(const rule of p.rules?.values||[]){
      for(const c of rule.conditions?.conditions||[])delete c.id;
    }
  }
  return p;
}
function sameGroupReferences(expectedNames,expectedToActual,byName,property){
  const values=[];
  for(const expectedName of expectedNames){
    const node=byName.get(expectedToActual.get(expectedName));
    const value=property==='credential'?node?.credentials?.httpHeaderAuth?.id:
      node?.parameters?.dataTableId?.value;
    if(typeof value!=='string'||!value||value.length>300)return null;
    values.push(value);
  }
  return new Set(values).size===1?values[0]:null;
}
function auditPublishedByTopology(graph,template){
  const issues=[];
  if(!object(graph)||!Array.isArray(graph.nodes)||!object(graph.connections)||
    !object(template)||!Array.isArray(template.nodes)||!object(template.connections)||
    graph.nodes.length>5000||template.nodes.length>100||
    Object.keys(graph.connections).length>5000)return outcome(['GRAPH_UNAVAILABLE'],0);
  const byName=new Map();
  for(const n of graph.nodes){
    if(!object(n)||typeof n.name!=='string'||!n.name||n.name.length>1024||byName.has(n.name))
      return outcome(['GRAPH_NODE_INVALID'],0);
    byName.set(n.name,n);
  }
  const expected=new Map(template.nodes.map(n=>[n.name,n]));
  if(expected.size!==template.nodes.length)return outcome(['TEMPLATE_INVALID'],0);
  const paired=new Map(),reverse=new Map(),queue=[];
  for(const [name,path] of webhooks){
    const entries=graph.nodes.filter(n=>n.type==='n8n-nodes-base.webhook'&&n.parameters?.path===path);
    if(entries.length!==1){issues.push('PAYMENT_WEBHOOK_NOT_UNIQUE');continue;}
    queue.push([name,entries[0].name]);
  }
  if(issues.length)return outcome(issues,0);
  let iterations=0;
  for(let i=0;i<queue.length;i++){
    if(++iterations>100)return outcome(['GRAPH_TOO_DEEP'],paired.size);
    const [left,right]=queue[i];
    if((paired.has(left)&&paired.get(left)!==right)||
      (reverse.has(right)&&reverse.get(right)!==left)){
      issues.push('PAYMENT_ROUTE_MAPPING_AMBIGUOUS');continue;
    }
    if(paired.has(left))continue;
    const e=expected.get(left),a=byName.get(right);
    if(!e||!a){issues.push('PAYMENT_ROUTE_TARGET_MISSING');continue;}
    paired.set(left,right);reverse.set(right,left);
    if(a.type!==e.type||a.typeVersion!==e.typeVersion)
      issues.push('PAYMENT_NODE_TYPE_MISMATCH');
    const eo=outgoing(template,left),ao=outgoing(graph,right);
    if(!eo||!ao||eo.length!==ao.length){
      issues.push('PAYMENT_ROUTE_CONNECTION_MISMATCH');continue;
    }
    for(let port=0;port<eo.length;port++){
      if(eo[port].length!==ao[port].length){issues.push('PAYMENT_ROUTE_CONNECTION_MISMATCH');continue;}
      for(let j=0;j<eo[port].length;j++){
        if(eo[port][j].index!==ao[port][j].index)
          issues.push('PAYMENT_ROUTE_CONNECTION_MISMATCH');
        queue.push([eo[port][j].node,ao[port][j].node]);
      }
    }
  }
  if(paired.size!==expected.size)issues.push('PAYMENT_ROUTE_COVERAGE_MISMATCH');
  if(issues.length)return outcome(issues,paired.size);
  // Disallow shortcuts into guarded worker nodes, including from other
  // subgraphs of an otherwise larger customer assistant.
  for(const [source,connections] of Object.entries(graph.connections)){
    if(!object(connections))continue;
    for(const [channel,ports] of Object.entries(connections)){
      if(reverse.has(source)&&channel!=='main')
        issues.push('PAYMENT_NONMAIN_ROUTE_UNREVIEWED');
      if(!Array.isArray(ports))continue;
      for(const port of ports){
        if(!Array.isArray(port))continue;
        for(const edge of port){
          if(reverse.has(edge?.node)&&!reverse.has(source))
            issues.push('UNEXPECTED_PAYMENT_NODE_INGRESS');
          if(reverse.has(edge?.node)&&channel!=='main')
            issues.push('PAYMENT_NONMAIN_ROUTE_UNREVIEWED');
        }
      }
    }
  }
  for(const [name,actualName] of paired){
    const e=expected.get(name),a=byName.get(actualName);
    if(!isDeepStrictEqual(normalizedParameters(a,reverse),
       normalizedParameters(e,new Map())))issues.push('PAYMENT_NODE_LOGIC_MISMATCH');
    // Runtime node switches can bypass correct-looking Code and payment
    // parameters. Defaults are allowed, but permissive error routing,
    // disabled nodes, extra retries and dropping items are not equivalent.
    if(['disabled','continueOnFail','executeOnce','retryOnFail']
      .some(key=>a[key]===true&&e[key]!==true)||
      (a.onError??'stopWorkflow')!==(e.onError??'stopWorkflow')||
      (a.alwaysOutputData===true)!==(e.alwaysOutputData===true))
      issues.push('PAYMENT_NODE_RUNTIME_SETTINGS_MISMATCH');
  }
  const merchant=sameGroupReferences(merchants,paired,byName,'credential');
  const database=sameGroupReferences(databases,paired,byName,'credential');
  const table=sameGroupReferences(customers,paired,byName,'table');
  if(!merchant||!database||merchant===database)issues.push('PAYMENT_CREDENTIAL_REFERENCE_MISMATCH');
  if(!table)issues.push('PAYMENT_CUSTOMER_TABLE_REFERENCE_MISMATCH');
  return outcome(issues,paired.size);
}
function auditRenamedPublishedPaymentWorker(graph){
  try{return auditPublishedByTopology(graph,build(source));}
  catch{return outcome(['PAYMENT_GRAPH_UNREADABLE'],0);}
}
module.exports={auditRenamedPublishedPaymentWorker,auditPublishedByTopology};
