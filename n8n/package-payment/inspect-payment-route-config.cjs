'use strict';

// A provider-free, in-memory classification of selected published n8n nodes.
// Never returns node names, URLs, IDs, JS source, credentials, customer fields,
// errors, or raw provider results. These are configuration clues, NOT proof of
// payment safety, identity verification, permissions or executed operations.
const MAX_NODES=5000;
const MAX_CODE_BYTES=128*1024;
const MAX_URL=4096;
const MOLLIE='api.mollie.com';
const SUPABASE='bnvnmdxosbnuzedokqgh.supabase.co';
const writeMethods=new Set(['POST','PUT','PATCH','DELETE']);
const writeOps=new Set(['insert','update','upsert','delete','create','remove']);

function classifyTarget(raw){
  if(typeof raw!=='string'||raw.length>MAX_URL||!raw||raw.includes('{{')||
    raw.includes('}}')||raw.includes('$')||/[\r\n]/.test(raw))return 'nonliteral';
  try {
    const u=new URL(raw);
    if(u.protocol!=='https:'||u.username||u.password||u.hash)return 'other';
    if(u.hostname===MOLLIE&&u.port===''&&u.pathname.startsWith('/v2/'))
      return 'mollie';
    if(u.hostname===SUPABASE&&u.port===''&&
      /^\/rest\/v1\/rpc\/[a-z_][a-z0-9_]{0,99}$/.test(u.pathname))
      return 'sma_rpc';
    return 'other';
  }catch{return 'nonliteral';}
}
function hasCredRef(node){
  const c=node?.credentials?.httpHeaderAuth?.id;
  return typeof c==='string'&&c.length>0;
}
function isIdempotentHeader(node){
  const parameters=node?.parameters?.headerParameters?.parameters;
  return Array.isArray(parameters)&&parameters.some(p=>p?.name?.toLowerCase?.()==='idempotency-key');
}
function filterFields(node){
  const f=node?.parameters?.filters?.conditions;
  if(!Array.isArray(f)||f.length>80)return [];
  return f.filter(x=>typeof x?.keyName==='string').map(x=>x.keyName);
}
function inspectRouteConfigMarkers(selected){
  if(!Array.isArray(selected)||selected.length>MAX_NODES||
    selected.some(n=>!n||typeof n!=='object'||Array.isArray(n)))
    return {status:'UNAVAILABLE'};
  const result={
    status:'CONFIG_MARKERS_PRESENT_NOT_VALIDATED',
    // Each count describes static published configuration only.
    http_literal_mollie_v2:0,
    http_literal_sma_supabase_rpc:0,
    http_dynamic_or_missing_target:0,
    http_other_literal_target:0,
    http_configured_mutating_method:0,
    http_with_header_auth_reference:0,
    http_with_idempotency_key_header:0,
    data_table_get_operations:0,
    data_table_write_operations:0,
    data_table_writes_with_identity_filter_markers:0,
    data_table_writes_with_both_folder_filter_markers:0,
    code_nodes_with_ticket_marker:0,
    code_nodes_with_both_folder_markers:0,
    code_nodes_with_payment_receipt_markers:0,
    code_nodes_skipped_oversize:0,
    // Neither references nor static text establish operation semantics.
    ticket_validation_proven:false,
    folder_ownership_and_write_proven:false,
    mollie_receipt_validation_proven:false,
    all_payment_paths_verified:false,
    customer_activation_authorized:false
  };
  for(const n of selected){
    if(n.type==='n8n-nodes-base.httpRequest'){
      const target=classifyTarget(n.parameters?.url);
      if(target==='mollie')result.http_literal_mollie_v2++;
      else if(target==='sma_rpc')result.http_literal_sma_supabase_rpc++;
      else if(target==='nonliteral')result.http_dynamic_or_missing_target++;
      else result.http_other_literal_target++;
      if(writeMethods.has((n.parameters?.method||'GET').toUpperCase?.()))
        result.http_configured_mutating_method++;
      if(hasCredRef(n))result.http_with_header_auth_reference++;
      if(isIdempotentHeader(n))result.http_with_idempotency_key_header++;
    }
    if(n.type==='n8n-nodes-base.dataTable'){
      const op=n.parameters?.operation;
      if(op==='get'||op==='getAll')result.data_table_get_operations++;
      if(writeOps.has(op)){
        result.data_table_write_operations++;
        const keys=new Set(filterFields(n));
        if(n.parameters?.matchType==='allConditions'&&
          keys.has('id')&&keys.has('kunde_id')&&keys.has('kunde_email'))
          result.data_table_writes_with_identity_filter_markers++;
        if(n.parameters?.matchType==='allConditions'&&
          keys.has('upload_folder_id')&&keys.has('processing_folder_id'))
          result.data_table_writes_with_both_folder_filter_markers++;
      }
    }
    if(n.type==='n8n-nodes-base.code'){
      const code=n.parameters?.jsCode;
      if(typeof code!=='string'||Buffer.byteLength(code,'utf8')>MAX_CODE_BYTES){
        result.code_nodes_skipped_oversize++;
        continue;
      }
      if(/\bticket\b/i.test(code))result.code_nodes_with_ticket_marker++;
      if(/\bupload_folder_id\b/.test(code)&&/\bprocessing_folder_id\b/.test(code))
        result.code_nodes_with_both_folder_markers++;
      if(/\b(payment_id|sequenceType|paidAt)\b/.test(code)&&
        /\b(customerId|kunde_id|merchant_customer)\b/.test(code))
        result.code_nodes_with_payment_receipt_markers++;
    }
  }
  return result;
}
module.exports={inspectRouteConfigMarkers,classifyTarget};
