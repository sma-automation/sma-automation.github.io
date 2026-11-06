'use strict';
// Private, unpublished test-webhook receiver and manual caller. Tokens stay in
// n8n at runtime; generated exports contain credential references, never values.
const fs=require('node:fs'),crypto=require('node:crypto');
const {patchInventoryEditResponses,responseNames:R}=require('./patch-inventory-edit-responses.cjs');
const {editNames:E}=require('./patch-inventory-writers.cjs');
const scope={customer:'kunde_3182',canonical:'kunde_20be25c6',product:'10c2f5a9-0571-4023-a1d6-df871813e1a7',sku:'SMA-TEST-002',stock:4};
const cases={invalid:{status:403},unknown:{status:404},stock:{status:409,code:'SHOPIFY_STOCK_USE_STOCK_ORDER'},success:{status:200}};
const settings={executionOrder:'v1',executionTimeout:90,saveDataSuccessExecution:'none',saveDataErrorExecution:'none',saveManualExecutions:false,availableInMCP:false};
const edge=node=>({node,type:'main',index:0});
const code=(name,jsCode)=>({id:crypto.randomUUID(),name,type:'n8n-nodes-base.code',typeVersion:2,parameters:{mode:'runOnceForAllItems',jsCode},position:[0,0],retryOnFail:false,continueOnFail:false,onError:'stopWorkflow'});
function buildInventoryEditHttpQA(source,{path=`sma-qa-pr81-edit-${crypto.randomUUID()}`,testCase='invalid'}={}){
 if(!/^sma-qa-pr81-edit-[0-9a-f-]{36}$/.test(path))throw Error('QA_TEST_PATH_REQUIRED');
 if(!Object.hasOwn(cases,testCase))throw Error('QA_CASE');
 const candidate=patchInventoryEditResponses(source),map=new Map(candidate.nodes.map(n=>[n.name,n]));
 const endpoint={name:'QA – Produktbearbeitung HTTP – PR81',active:false,pinData:{},settings:structuredClone(settings),tags:[],
  nodes:candidate.nodes.filter(n=>n.name.startsWith('SMA – Produkt – Bearbeiten – ')||n.name===R.mirror),connections:{}};
 const names=new Set(endpoint.nodes.map(n=>n.name));
 for(const name of names){if(candidate.connections[name])endpoint.connections[name]=structuredClone(candidate.connections[name]);
  for(const out of candidate.connections[name]?.main||[])for(const e of out)if(!names.has(e.node))throw Error('QA_ROUTE_ESCAPES');}
 const node=name=>endpoint.nodes.find(n=>n.name===name);
 node(E.webhook).parameters.path=path;node(E.webhook).webhookId=crypto.randomUUID();
 node('SMA – Produkt – Bearbeiten – Kunde prüfen').parameters.filters.conditions.push({keyName:'kunde_id',keyValue:scope.customer});
 node(E.read).parameters.filters.conditions.push({keyName:'produkt_id',keyValue:scope.product},{keyName:'sku',keyValue:scope.sku});
 const guard=code('QA – Unveränderte Testbearbeitung',`const p=$input.first().json,b=$('${E.webhook}').first().json.body;
 if(p.kunde_id!==${JSON.stringify(scope.customer)}||p.produkt_id!==${JSON.stringify(scope.product)}||p.sku!==${JSON.stringify(scope.sku)}||p.bestand!==4||p.expected_stock!==4||p.stock_owner!=='shopify'||
 Object.keys(b).some(k=>!['token','produkt_id','bestand'].includes(k)))throw Error('QA_SCOPE_OR_METADATA_CHANGE');
 return [{json:p}];`);
 endpoint.nodes.push(guard);endpoint.connections[R.prepared].main[0]=[edge(guard.name)];endpoint.connections[guard.name]={main:[[edge(R.customer)]]};
 const caller={name:'QA – Produktbearbeitung HTTP Aufrufer – PR81',active:false,pinData:{},settings:structuredClone(settings),tags:[],nodes:[],connections:{}};
 const trigger={id:crypto.randomUUID(),name:'Manueller HTTP-Prüflauf',type:'n8n-nodes-base.manualTrigger',typeVersion:1,parameters:{},position:[0,0]};
 caller.nodes.push(trigger);caller.connections[trigger.name]={main:[[edge('QA – Testfall')]]};
 const context=code('QA – Testfall',`return [{json:{case:${JSON.stringify(testCase)}}}];`);
 const customer=structuredClone(map.get('SMA – Produkt – Bearbeiten – Kunde prüfen'));customer.id=crypto.randomUUID();customer.name='QA – Kundenkennung lesen';
 customer.parameters.filters.conditions=[{keyName:'kunde_id',keyValue:scope.customer},{keyName:'zugang_aktiv',keyValue:true}];customer.parameters.limit=2;
 const product=structuredClone(map.get(E.read));product.id=crypto.randomUUID();product.name='QA – Produkt vorher';
 product.parameters.filters.conditions=[{keyName:'kunde_id',keyValue:scope.customer},{keyName:'produkt_id',keyValue:scope.product}];product.parameters.limit=2;
 const canonical=structuredClone(map.get(R.customer));canonical.id=crypto.randomUUID();canonical.name='QA – Supabase vorher';
 canonical.parameters.url=map.get(R.mirror).parameters.url;
 canonical.parameters.queryParameters.parameters=[{name:'select',value:'id,kunde_id,sma_produkt_id,produkt_name,beschreibung,sku,produkt_typ,preis,waehrung,aktiv,bestand,updated_at,shopify_bestand_erfasst_am'},
  {name:'kunde_id',value:'eq.'+scope.canonical},{name:'sma_produkt_id',value:'eq.'+scope.product},{name:'limit',value:'2'}];
 const prepare=code('QA – Anfrage vorbereiten',`const one=n=>{const a=$(n).all();if(a.length!==1)throw Error('QA_ROW_COUNT');return a[0].json;};
 const p=one('${product.name}'),s=one('${canonical.name}'),c=one('${customer.name}'),k=one('${context.name}').case;
 if(p.kunde_id!==${JSON.stringify(scope.customer)}||p.produkt_id!==${JSON.stringify(scope.product)}||p.sku!==${JSON.stringify(scope.sku)}||p.bestand!==4||s.kunde_id!==${JSON.stringify(scope.canonical)}||s.sma_produkt_id!==p.produkt_id||s.bestand!==4||typeof c.zugangs_token!=='string'||!c.zugangs_token)throw Error('QA_SCOPE');
 for(const f of ['produkt_name','beschreibung','sku','produkt_typ','preis','waehrung','aktiv'])if(p[f]!==s[f])throw Error('QA_METADATA_NOT_ALIGNED');
 const body={token:k==='invalid'?'qa-intentionally-invalid':c.zugangs_token,produkt_id:k==='unknown'?'00000000-0000-4000-8000-000000000000':p.produkt_id};
 if(k==='stock')body.bestand=3;return [{json:{body}}];`);
 const http={id:crypto.randomUUID(),name:'QA – Test-Webhook aufrufen',type:'n8n-nodes-base.httpRequest',typeVersion:4.5,position:[0,0],retryOnFail:false,continueOnFail:false,onError:'stopWorkflow',
  parameters:{method:'POST',url:'https://johnmusic.app.n8n.cloud/webhook-test/'+path,sendBody:true,specifyBody:'json',jsonBody:'={{ JSON.stringify($json.body) }}',
   options:{timeout:45000,response:{response:{fullResponse:true,neverError:true,responseFormat:'json'}}}}};
 const verify=code('QA – HTTP-Antwort prüfen',`const r=$input.first().json,k=$('${context.name}').first().json.case,e=${JSON.stringify(cases)}[k];
 if(r.statusCode!==e.status||r.body?.ok!==(k==='success')||(e.code&&r.body.code!==e.code))throw Error('QA_HTTP_RESPONSE_NOT_EXPECTED');
 return [{json:{case:k,http_status:r.statusCode,response_ok:r.body.ok,response_code:r.body.code??null}}];`);
 const productAfter=structuredClone(product);productAfter.id=crypto.randomUUID();productAfter.name='QA – Produkt nachher';
 const canonicalAfter=structuredClone(canonical);canonicalAfter.id=crypto.randomUUID();canonicalAfter.name='QA – Supabase nachher';
 const result=code('QA – HTTP Ergebnis',`const one=n=>{const a=$(n).all();if(a.length!==1)throw Error('QA_ROW_COUNT');return a[0].json;};
 const r=one('${verify.name}'),p=one('${product.name}'),q=one('${productAfter.name}'),s=one('${canonical.name}'),t=one('${canonicalAfter.name}');
 for(const f of ['id','kunde_id','produkt_id','produkt_name','beschreibung','sku','produkt_typ','preis','waehrung','aktiv','bestand'])if(p[f]!==q[f])throw Error('QA_PRODUCT_CHANGED');
 for(const f of ['id','kunde_id','sma_produkt_id','produkt_name','beschreibung','sku','produkt_typ','preis','waehrung','aktiv','bestand','shopify_bestand_erfasst_am'])if(s[f]!==t[f])throw Error('QA_CANONICAL_CHANGED');
 if(r.case==='success'){if(Date.parse(q.updatedAt)<=Date.parse(p.updatedAt)||Date.parse(t.updated_at)<=Date.parse(s.updated_at))throw Error('QA_EDIT_NOT_OBSERVED');}
 else if(q.updatedAt!==p.updatedAt||t.updated_at!==s.updated_at)throw Error('QA_REJECTED_REQUEST_WROTE');
 return [{json:{ok:true,...r,sku:${JSON.stringify(scope.sku)},bestand:4,product_unchanged:true,canonical_unchanged:true,published:false,shopify_write:false}}];`);
 const chain=[context,customer,product,canonical,prepare,http,verify,productAfter,canonicalAfter,result];caller.nodes.push(...chain);
 chain.forEach((n,i)=>{caller.connections[n.name]={main:[i+1<chain.length?[edge(chain[i+1].name)]:[]]};});
 for(const w of [endpoint,caller])w.nodes.forEach((n,i)=>{n.position=[(i%6)*300,Math.floor(i/6)*280];});
 return {endpoint,caller,path};
}
module.exports={buildInventoryEditHttpQA};
if(require.main===module){
 const [sourcePath,endpointPath,callerPath]=process.argv.slice(2);if(!callerPath)throw Error('WRITERS_PRIVATE.json NEW_ENDPOINT_PRIVATE.json NEW_CALLER_PRIVATE.json');
 for(const p of [endpointPath,callerPath])if(fs.existsSync(p))throw Error('Output exists');
 const {endpoint,caller,path}=buildInventoryEditHttpQA(JSON.parse(fs.readFileSync(sourcePath,'utf8')));
 for(const [p,w]of [[endpointPath,endpoint],[callerPath,caller]])fs.writeFileSync(p,JSON.stringify(w,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({endpoint_nodes:endpoint.nodes.length,caller_nodes:caller.nodes.length,path,active:false}));
}
