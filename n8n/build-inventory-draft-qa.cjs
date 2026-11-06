'use strict';
// A private, manual-only rehearsal. No webhook, schedule, product mutation or publication.
const fs=require('node:fs');
const crypto=require('node:crypto');
const {patchInventoryDraft}=require('./patch-inventory-draft.cjs');
const {inventoryNames:N}=require('./inventory-draft-contract.cjs');
function buildInventoryQA(source,{caseId=null,fault='none'}={}){
 if(caseId!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(caseId))throw new Error('QA_CASE_ID_INVALID');
 if(!['none','after_commit','timeout_read'].includes(fault)||fault!=='none'&&!caseId)throw new Error('QA_FAULT_INVALID');
 const candidate=patchInventoryDraft(source),byName=new Map(candidate.nodes.map(n=>[n.name,n]));
 const prefix='SMA – Produkt – Shopify Sync – ';
 const code=(name,jsCode)=>({id:crypto.randomUUID(),name,type:'n8n-nodes-base.code',typeVersion:2,parameters:{mode:'runOnceForAllItems',jsCode},position:[0,0]});
 const context=code(prefix+'Webhook',`return [{json:{body:${JSON.stringify({produkt_id:'10c2f5a9-0571-4023-a1d6-df871813e1a7',qa_case_id:caseId,qa_fault:fault})}}}];`);
 const customer=code(N.product.replace('Produkt prüfen','Kunde prüfen'),`return [{json:{kunde_id:'kunde_3182'}}];`);
 const guard=code('QA – Nur bestätigten Testbestand übernehmen',`const s=$input.first().json;
 const p=$('${N.product}').first().json;
 if(s.kunde_id!=='kunde_3182'||s.produkt_id!=='10c2f5a9-0571-4023-a1d6-df871813e1a7'||s.markt_konto_id!=='d7d70abf-9180-48ad-897a-f074149326cc'||s.variant_id!=='gid://shopify/ProductVariant/58648962433355'||s.shop_domain!=='6r0d8z-cd.myshopify.com'||s.bestand!==4||p.bestand!==4||p.sku!=='SMA-TEST-002')throw new Error('QA_SCOPE_OR_STOCK_CHANGED');
 return [{json:s}];`);
 const trigger={id:crypto.randomUUID(),name:'Manueller Bestandsprüflauf',type:'n8n-nodes-base.manualTrigger',typeVersion:1,parameters:{},position:[0,0]};
 const existing=[N.product,N.mapping,N.account,prefix+'Credential laden',prefix+'Credential entschlüsseln',prefix+'Credential vorbereiten',prefix+'Access Token holen',
  N.read,N.prepare,'SMA – Bestand – Sperrauftrag',N.claim,N.claimed,N.reread,N.evaluate,N.commit,N.canonical,N.mirror,N.finishBody,N.finish,N.done];
 const nodes=[trigger,context,customer,...existing.map(name=>{
  if(!byName.has(name))throw new Error('Source node missing');return structuredClone(byName.get(name));
 }),guard];
 // QA-only stable identity allows replay from the beginning after lease expiry.
 // It never resumes at an old mirror write; both Shopify reads run again.
 const qaNode=name=>nodes.find(n=>n.name===name);
 qaNode(N.prepare).parameters.jsCode=qaNode(N.prepare).parameters.jsCode.replace('executionId:$execution.id',`executionId:one('${context.name}').body.qa_case_id||$execution.id`);
 qaNode(N.canonical).parameters.jsCode=qaNode(N.canonical).parameters.jsCode.replace(
  'return output(inventoryCanonical(input,one(inventoryNames.evaluate)));',
  `const confirmed=inventoryCanonical(input,one(inventoryNames.evaluate));\nif(one('${context.name}').body.qa_fault==='after_commit')throw new Error('QA_EXPECTED_AFTER_COMMIT');\nreturn output(confirmed);`);
 const repeat=structuredClone(byName.get(N.claim));repeat.id=crypto.randomUUID();repeat.name='QA – Gleiche Meldung wiederholen';
 repeat.parameters.jsonBody=`={{ $('SMA – Bestand – Sperrauftrag').first().json }}`;
 const verify=code('QA – Ergebnis',`const r=$input.first().json;
 if(r.ok!==true||r.action!=='duplicate'||r.status!=='done')throw new Error('QA_DUPLICATE_NOT_CONFIRMED');
 return [{json:{ok:true,sku:'SMA-TEST-002',bestand:4,canonical_first:true,mirror_confirmed:true,journal_done:true,duplicate_ignored:true,shopify_write:false,published:false}}];`);
 nodes.push(repeat,verify);
 const chain=[trigger.name,context.name,customer.name,...existing.slice(0,existing.indexOf(N.commit)),guard.name,...existing.slice(existing.indexOf(N.commit)),repeat.name,verify.name];
 const connections={};
 chain.forEach((name,i)=>{
  const node=nodes.find(n=>n.name===name);node.position=[(i%7)*260,Math.floor(i/7)*240];
  connections[name]={main:[i+1<chain.length?[{node:chain[i+1],type:'main',index:0}]:[]]};
 });
 const names=new Set(nodes.map(n=>n.name));
 for(const node of nodes){
  for(const match of JSON.stringify(node.parameters).matchAll(/\$\('([^']+)'\)/g))if(!names.has(match[1]))throw new Error('Out-of-scope reference: '+match[1]);
  if(node.type==='n8n-nodes-base.httpRequest'){
   const params=node.parameters;
   if(params.jsonBody&&/\bmutation\b/.test(params.jsonBody))throw new Error('Shopify writes forbidden in QA');
   params.options={...params.options,timeout:fault==='timeout_read'&&node.name===N.reread?1:15000};
  }
 }
 // n8n's UI import may ignore settings. Verify them in Workflow Settings BEFORE execution.
 return {name:'QA – Shopify Bestandsentwurf – PR81',nodes,connections,active:false,pinData:{},
  settings:{executionOrder:'v1',executionTimeout:90,saveDataSuccessExecution:'none',saveDataErrorExecution:'none',saveManualExecutions:false},tags:[]};
}
module.exports={buildInventoryQA};
if(require.main===module){
 const [input,output,caseId=null,fault='none']=process.argv.slice(2);if(!input||!output)throw new Error('SOURCE.json NEW_PRIVATE_QA.json [CASE_UUID FAULT] required');
 const qa=buildInventoryQA(JSON.parse(fs.readFileSync(input,'utf8')),{caseId,fault});
 fs.writeFileSync(output,JSON.stringify(qa,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({nodes:qa.nodes.length,active:false,manual_only:true,shopify_mutations:0}));
}
