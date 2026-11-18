'use strict';

// Pure, bounded structural inspection of the published n8n payment routes.
// This function reads an already fetched graph; it never requests credentials,
// calls n8n, follows a webhook, executes code, or changes data.
const MAX_NODES=5000;
const MAX_EDGES=50000;
const ENTRY_PATHS=Object.freeze([
  ['first_payment','sma-paket-dienst-v1'],
  ['renewal','sma-paket-folge-dienst-v1']
]);
const KNOWN_TYPES=Object.freeze({
  'n8n-nodes-base.code':'code',
  'n8n-nodes-base.httpRequest':'http_request',
  'n8n-nodes-base.dataTable':'data_table',
  'n8n-nodes-base.respondToWebhook':'respond_to_webhook',
  'n8n-nodes-base.switch':'switch',
  'n8n-nodes-base.if':'if',
  'n8n-nodes-base.executeWorkflow':'subworkflow',
  'n8n-nodes-base.webhook':'webhook'
});
const PRIVATE_NODE_NAME='Ordnerzuordnung vor Aktivierung prüfen';
const isRecord=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
const positiveCount=n=>Number.isSafeInteger(n)&&n>=0&&n<=MAX_EDGES;
const blocked=code=>({
  status:'PAYMENT_ROUTE_STRUCTURE_UNAVAILABLE',
  issue:code,
  active_version_stability_verified:false,
  payment_or_activation_authorized:false,
  billing_or_customer_e2e_verified:false
});

function inspectPaymentWebhookPaths(graph) {
  if(!isRecord(graph)||!Array.isArray(graph.nodes)||!isRecord(graph.connections)||
    graph.nodes.length>MAX_NODES)return blocked('GRAPH_FORMAT_UNAVAILABLE');
  const nodes=new Map();
  for(const n of graph.nodes){
    if(!isRecord(n)||typeof n.name!=='string'||!n.name||
      n.name.length>1024||nodes.has(n.name))return blocked('GRAPH_NODE_IDENTITY_INVALID');
    nodes.set(n.name,n);
  }
  const edges=new Map();
  let edgeCount=0,unknownTargets=0,unknownSources=0;
  for(const [from,output] of Object.entries(graph.connections)) {
    if(!nodes.has(from)){unknownSources++;continue;}
    if(!isRecord(output))return blocked('GRAPH_CONNECTIONS_INVALID');
    const ports=output.main;
    if(ports===undefined)continue;
    if(!Array.isArray(ports))return blocked('GRAPH_CONNECTIONS_INVALID');
    const children=[];
    for(const port of ports){
      if(port===null)continue;
      if(!Array.isArray(port))return blocked('GRAPH_CONNECTIONS_INVALID');
      for(const link of port){
        if(!isRecord(link)||typeof link.node!=='string'||
          link.type!=='main'||!Number.isSafeInteger(link.index)||link.index<0)
          return blocked('GRAPH_CONNECTIONS_INVALID');
        edgeCount++;
        if(edgeCount>MAX_EDGES)return blocked('GRAPH_TOO_MANY_CONNECTIONS');
        if(nodes.has(link.node))children.push(link.node);
        else unknownTargets++;
      }
    }
    edges.set(from,children);
  }
  if(!positiveCount(edgeCount))return blocked('GRAPH_TOO_MANY_CONNECTIONS');
  const reachableFrom=start=>{
    const seen=new Set([start]),queue=[start];
    for(let i=0;i<queue.length;i++){
      for(const child of edges.get(queue[i])||[]){
        if(!seen.has(child)){seen.add(child);queue.push(child);}
      }
    }
    return seen;
  };
  const pathways={};
  let overlap=null;
  for(const [label,path] of ENTRY_PATHS){
    const entries=graph.nodes.filter(n=>
      n.type==='n8n-nodes-base.webhook'&&n.parameters?.path===path);
    if(entries.length!==1){
      pathways[label]={
        entry_count:entries.length>2?'MORE_THAN_ONE':entries.length,
        response_mode_matches:false,
        outgoing_edges:0,
        reachable_nodes:0,
        reachable_respond_to_webhook:0,
        reachable_code_nodes:0,
        reachable_http_requests:0,
        reachable_data_table_nodes:0,
        reachable_subworkflow_calls:0,
        reachable_switch_or_if_nodes:0,
        possible_http_mutations:0,
        named_folder_guard_reachable:false,
        static_terminal_nodes:0,
        path_is_proven_safe:false
      };
      overlap=null;
      continue;
    }
    const entry=entries[0];
    const seen=reachableFrom(entry.name);
    if(overlap===null&&label==='first_payment')overlap=seen;
    else if(label==='renewal'&&overlap!==null){
      overlap=new Set([...seen].filter(v=>overlap.has(v)));
    }
    const selected=[...seen].map(n=>nodes.get(n));
    const count=type=>selected.filter(n=>n.type===type).length;
    const connected=count('n8n-nodes-base.respondToWebhook');
    const http=selected.filter(n=>n.type==='n8n-nodes-base.httpRequest');
    pathways[label]={
      entry_count:1,
      response_mode_matches:entry.parameters?.httpMethod==='POST'&&
        entry.parameters?.responseMode==='responseNode',
      outgoing_edges:(edges.get(entry.name)||[]).length,
      reachable_nodes:seen.size,
      reachable_respond_to_webhook:connected,
      reachable_code_nodes:count('n8n-nodes-base.code'),
      reachable_http_requests:http.length,
      reachable_data_table_nodes:count('n8n-nodes-base.dataTable'),
      reachable_subworkflow_calls:count('n8n-nodes-base.executeWorkflow'),
      reachable_switch_or_if_nodes:count('n8n-nodes-base.switch')+count('n8n-nodes-base.if'),
      possible_http_mutations:http.filter(n=>
        ['POST','PUT','PATCH','DELETE'].includes(n.parameters?.method)).length,
      named_folder_guard_reachable:seen.has(PRIVATE_NODE_NAME),
      static_terminal_nodes:[...seen].filter(n=>(edges.get(n)||[]).length===0).length,
      // Even a reachable reply does not mean every conditional branch responds,
      // nor that a guard is effective: those require private dynamic E2E tests.
      path_is_proven_safe:false
    };
  }
  return {
    status:'PUBLISHED_PAYMENT_MAIN_GRAPH_TRACE_NOT_E2E',
    scope:'n8n_published_version_main_edges_only',
    graph_nodes:nodes.size,
    graph_main_edges:edgeCount,
    unknown_edge_targets:unknownTargets,
    unknown_connection_sources:unknownSources,
    first_payment:pathways.first_payment,
    renewal:pathways.renewal,
    shared_reachable_nodes:overlap instanceof Set?overlap.size:null,
    active_version_stability_verified:false,
    all_conditional_paths_verified:false,
    payment_or_activation_authorized:false,
    billing_or_customer_e2e_verified:false
  };
}
module.exports={inspectPaymentWebhookPaths};
