'use strict';
// Apply after patchProductWriters; private exports only, no service mutations.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const expected=require('./inventory-edit-response-source-fingerprints.json');
const {editNames:E}=require('./patch-inventory-writers.cjs');
const writers=fs.readFileSync(path.join(__dirname,'inventory-writers-contract.cjs'),'utf8').split('module.exports=')[0];
const contract=fs.readFileSync(path.join(__dirname,'inventory-edit-response-contract.cjs'),'utf8').split('module.exports=')[0];
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const runtime=n=>Object.fromEntries(['alwaysOutputData','continueOnFail','onError','retryOnFail','executeOnce'].map(k=>[k,n[k]??(k==='onError'?'stopWorkflow':false)]));
const R={prepared:'SMA – Produkt – Bearbeiten – Eingabe gültig?',
 customer:'SMA – Produkt – Bearbeiten – Supabase-Kunde lesen',customerConfirmed:'SMA – Produkt – Bearbeiten – Supabase-Kunde bestätigen',
 saved:'SMA – Produkt – Bearbeiten – Änderung gespeichert?',rejected:'SMA – Produkt – Bearbeiten – Konflikt melden',
 mirror:'SMA – Supabase – Bearbeitung spiegeln',mirrorConfirmed:'SMA – Produkt – Bearbeiten – Spiegelung bestätigen',
 incomplete:'SMA – Produkt – Bearbeiten – Speicherung unbestätigt',success:'SMA – Produkt – Bearbeiten – Erfolgreich'};

function patchInventoryEditResponses(source) {
 if(source.id!==expected.workflow_id||!Array.isArray(source.nodes)||Object.keys(source.pinData||{}).length)throw Error('Unexpected source');
 const w=structuredClone(source),map=new Map(w.nodes.map(n=>[n.name,n]));
 if(map.size!==w.nodes.length||new Set(w.nodes.map(n=>n.id)).size!==w.nodes.length)throw Error('Unique nodes required');
 for(const [name,s]of Object.entries(expected.nodes)){
  const n=map.get(name);
  if(!n||n.type!==s.type||n.typeVersion!==s.typeVersion||n.disabled||hash(runtime(n))!==s.runtime||hash(n.parameters)!==s.parameters||hash(w.connections[name]??null)!==s.connections)
   throw Error('Source changed: '+name);
 }
 const added=[R.prepared,R.customer,R.customerConfirmed,R.saved,R.rejected,R.mirrorConfirmed,R.incomplete];
 if(added.some(n=>map.has(n)))throw Error('Already patched');
 const edge=node=>({node,type:'main',index:0});
 const safe=n=>Object.assign(n,{retryOnFail:false,continueOnFail:false,onError:'stopWorkflow'});
 const code=(name,body,position)=>safe({id:crypto.randomUUID(),name,type:'n8n-nodes-base.code',typeVersion:2,position,
  parameters:{mode:'runOnceForAllItems',jsCode:contract+'\n'+body}});
 const gate=(name,position)=>safe({id:crypto.randomUUID(),name,type:'n8n-nodes-base.if',typeVersion:2.3,position,
  parameters:{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:3},conditions:[{
   id:crypto.randomUUID(),leftValue:'={{ $json._edit_ok === true }}',rightValue:'',operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}}});
 const respond=(name,body,status,position)=>safe({id:crypto.randomUUID(),name,type:'n8n-nodes-base.respondToWebhook',typeVersion:1.5,position,
  parameters:{respondWith:'json',responseBody:body,options:{responseCode:status}}});
 const prepare=map.get(E.prepare);
 prepare.parameters.jsCode=writers+'\n'+contract+`\nconst products=$('${E.read}').all();
 if(products.length!==1)throw Error('PRODUCT_EDIT_IDENTITY');
 const result=productEditAttempt(()=>prepareProductEdit(products[0].json,$input.all().map(x=>x.json),$('${E.webhook}').first().json.body));
 if(result._edit_ok)result._edit_customer_filter=productEditCustomerFilter(result);
 return [{json:result}];`;
 safe(prepare);
 const confirm=map.get(E.confirmed);
 confirm.parameters.jsCode=writers+'\n'+contract+`\nconst before=$('${E.prepare}').first().json;
 const result=productEditAttempt(()=>confirmProductEdit($input.all().map(x=>x.json),before));
 if(result._edit_ok)result._edit_mirror_body=productEditMirrorBody(result,before.stock_owner,$now.toISO());
 return [{json:result}];`;
 safe(confirm);
 const mirror=map.get(R.mirror);
 const customer=safe({id:crypto.randomUUID(),name:R.customer,type:mirror.type,typeVersion:mirror.typeVersion,
  position:[-2944,-4664],credentials:structuredClone(mirror.credentials),alwaysOutputData:true,
  parameters:{method:'GET',url:mirror.parameters.url.replace(/\/sma_produkte$/,'/sma_kunden'),
   authentication:mirror.parameters.authentication,genericAuthType:mirror.parameters.genericAuthType,
   sendQuery:true,queryParameters:{parameters:[{name:'select',value:'kunde_id,n8n_kunde_id,user_id'},
    {name:'or',value:'={{ $json._edit_customer_filter }}'},{name:'limit',value:'2'}]},options:{timeout:15000}}});
 const customerConfirmed=code(R.customerConfirmed,`return [{json:confirmProductEditCustomer($input.all().map(x=>x.json),$('${E.prepare}').first().json)}];`,[-2704,-4664]);
 mirror.parameters.specifyBody='json';mirror.parameters.jsonBody='={{ JSON.stringify($json._edit_mirror_body) }}';
 delete mirror.parameters.bodyParameters;
 mirror.parameters.options={...mirror.parameters.options,timeout:15000};
 safe(mirror);mirror.alwaysOutputData=true;mirror.onError='continueErrorOutput';
 const mirrorConfirmed=code(R.mirrorConfirmed,`return [{json:confirmProductEditMirror($input.all().map(x=>x.json),$('${E.confirmed}').first().json,$('${R.customerConfirmed}').first().json,$('${E.prepare}').first().json.stock_owner)}];`,[-2464,-5184]);
 mirrorConfirmed.onError='continueErrorOutput';
 w.nodes.push(gate(R.prepared,[-3184,-4664]),customer,customerConfirmed,gate(R.saved,[-2704,-4924]),
  respond(R.rejected,'={{ JSON.stringify($json.response.body) }}','={{ $json.response.status }}',[-2464,-4424]),mirrorConfirmed,
  respond(R.incomplete,JSON.stringify({ok:false,code:'PRODUCT_EDIT_MIRROR_NOT_CONFIRMED',
   message:'Die Bearbeitung wurde nicht vollständig bestätigt. Bitte das Produkt neu laden und den gespeicherten Stand prüfen.',reload_required:true}),502,[-2224,-4904]));
 for(const [a,b]of [[E.prepare,R.prepared],[R.customer,R.customerConfirmed],[R.customerConfirmed,E.save],[E.confirmed,R.saved]])w.connections[a]={main:[[edge(b)]]};
 w.connections[R.prepared]={main:[[edge(R.customer)],[edge(R.rejected)]]};
 w.connections[R.saved]={main:[[edge(R.mirror)],[edge(R.rejected)]]};
 w.connections[R.mirror]={main:[[edge(R.mirrorConfirmed)],[edge(R.incomplete)]]};
 w.connections[R.mirrorConfirmed]={main:[[edge(R.success)],[edge(R.incomplete)]]};
 return w;
}
module.exports={patchInventoryEditResponses,responseNames:R};
if(require.main===module){
 const [input,output]=process.argv.slice(2);
 if(!input||!output||fs.existsSync(output))throw Error('SOURCE_PRIVATE.json NEW_PRIVATE.json');
 const w=patchInventoryEditResponses(JSON.parse(fs.readFileSync(input,'utf8')));
 fs.writeFileSync(output,JSON.stringify(w,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({written:true,nodes:w.nodes.length,executed:false,published:false}));
}
