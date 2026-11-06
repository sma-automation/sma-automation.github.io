'use strict';
// Offline transformations. Never publish or execute the protected originals.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const expected=require('./inventory-writers-source-fingerprints.json');
const core=fs.readFileSync(path.join(__dirname,'inventory-draft-contract.cjs'),'utf8').split('module.exports =')[0];
const writers=fs.readFileSync(path.join(__dirname,'inventory-writers-contract.cjs'),'utf8').split('module.exports=')[0];
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const E={read:'SMA – Produkt – Bearbeiten – Produkt prüfen',found:'SMA – Produkt – Bearbeiten – Produkt gefunden?',
 save:'SMA – Produkt – Bearbeiten – Speichern',webhook:'SMA – Produkt – Bearbeiten – Webhook',
 mappings:'SMA – Produkt – Bearbeiten – Shopify-Zuordnungen lesen',prepare:'SMA – Produkt – Bearbeiten – Bestand schützen',
 confirmed:'SMA – Produkt – Bearbeiten – Speicherung bestätigen'};
function checked(source,kind){
 const spec=expected[kind];
 if(source.id!==spec.workflow_id || !Array.isArray(source.nodes) || Object.keys(source.pinData||{}).length)throw Error('Unexpected source');
 const w=structuredClone(source),map=new Map(w.nodes.map(n=>[n.name,n]));
 if(map.size!==w.nodes.length)throw Error('Unique nodes required');
 for(const [name,s] of Object.entries(spec.nodes)){
  const n=map.get(name);
  if(!n||n.type!==s.type||hash(n.parameters)!==s.parameters||hash(w.connections[name]??null)!==s.connections)throw Error('Source changed: '+name);
 }
 return {w,map};
}
function safe(n){n.retryOnFail=false;n.continueOnFail=false;n.onError='stopWorkflow';}
function patchInventoryWebhook(source){
 const {w,map}=checked(source,'webhook');
 const snippet=body=>core+'\n'+writers+'\nconst one=name=>inventorySingle($(name).all());\nconst input=inventorySingle($input.all());\n'+body;
 map.get('SMA-Produkt prüfen').parameters.jsCode=snippet(`const s=one('Produktzuordnung prüfen'), claim=one('Meldung beanspruchen');
 if(claim.ok!==true||claim.action!=='process')inventoryFail('LEASE_NOT_ACQUIRED');
 writerVersion(input);
 if(input.kunde_id!==s.kunde_id||input.produkt_id!==s.produkt_id||input.sku!==s.sku)inventoryFail('PRODUCT_IDENTITY');
 const job={...s,n8n_produkt_zeile_id:input.id,n8n_produkt_updated_at:input.updatedAt,lease_id:claim.lease_id,read_started_at:claim.read_started_at};
 inventoryLease(job);return [{json:job}];`);
 map.get('Speicherwert prüfen').parameters.jsCode=snippet(`return [{json:inventoryCanonical(input,one('SMA-Produkt prüfen'))}];`);
 map.get('Gespeicherten Bestand prüfen').parameters.jsCode=snippet(`return [{json:inventoryMirror(input,one('Speicherwert prüfen'))}];`);
 const mirror=map.get('n8n-Bestand speichern');
 mirror.parameters.filters.conditions.push({keyName:'updatedAt',condition:'eq',keyValue:'={{ $json.n8n_produkt_updated_at }}'});
 mirror.alwaysOutputData=true;
 for(const name of Object.keys(expected.webhook.nodes))safe(map.get(name));
 return w;
}
function patchProductWriters(source){
 const {w,map}=checked(source,'main');
 for(const name of [E.mappings,E.prepare,E.confirmed])if(map.has(name))throw Error('Already patched');
 const position=map.get(E.save).position;
 const code=(name,body,offset)=>({id:crypto.randomUUID(),name,type:'n8n-nodes-base.code',typeVersion:2,
  position:[position[0]+offset,position[1]+260],parameters:{mode:'runOnceForAllItems',jsCode:writers+'\n'+body}});
 const query=structuredClone(map.get('SMA – Produkt – Shopify Sync – Marktzuordnung prüfen'));
 query.id=crypto.randomUUID();query.name=E.mappings;query.position=[position[0]-480,position[1]+260];
 query.parameters={operation:'get',dataTableId:query.parameters.dataTableId,matchType:'allConditions',returnAll:true,
  filters:{conditions:[{keyName:'kunde_id',keyValue:`={{ $('${E.read}').first().json.kunde_id }}`},
   {keyName:'produkt_id',keyValue:`={{ $('${E.read}').first().json.produkt_id }}`},{keyName:'markt',keyValue:'shopify'}]}};
 query.alwaysOutputData=true;
 const prepare=code(E.prepare,`const products=$('${E.read}').all();
 if(products.length!==1)throw Error('PRODUCT_EDIT_IDENTITY');
 return [{json:prepareProductEdit(products[0].json,$input.all().map(x=>x.json),$('${E.webhook}').first().json.body)}];`,-240);
 const confirm=code(E.confirmed,`return [{json:confirmProductEdit($input.all().map(x=>x.json),$('${E.prepare}').first().json)}];`,240);
 for(const n of [query,prepare,confirm]){safe(n);w.nodes.push(n);}
 const save=map.get(E.save);
 save.parameters.filters.conditions.push({keyName:'id',condition:'eq',keyValue:`={{ $('${E.prepare}').first().json.id }}`},
  {keyName:'updatedAt',condition:'eq',keyValue:`={{ $('${E.prepare}').first().json.updatedAt }}`});
 save.alwaysOutputData=true;safe(save);
 const edge=node=>({node,type:'main',index:0});
 const previous=w.connections[E.save];
 if(w.connections[E.found].main[0].length!==1||w.connections[E.found].main[0][0].node!==E.save)throw Error('Edit routing changed');
 w.connections[E.found].main[0]=[edge(E.mappings)];
 for(const [a,b]of [[E.mappings,E.prepare],[E.prepare,E.save],[E.save,E.confirmed]])w.connections[a]={main:[[edge(b)]]};
 w.connections[E.confirmed]=previous;
 for(const market of ['Shopify','Digistore24']){
  const n=map.get(`SMA – Marktkonto – Initialimport – ${market} Produkt aktualisieren`);
  // Existing products receive metadata only. Initial inserts retain their stock.
  delete n.parameters.columns.value.bestand;
  for(const col of n.parameters.columns.schema||[])if(col.id==='bestand')col.removed=true;
 }
 return w;
}
module.exports={patchInventoryWebhook,patchProductWriters,editNames:E};
if(require.main===module){
 const [kind,input,output]=process.argv.slice(2);
 if(!['main','webhook'].includes(kind)||!input||!output||fs.existsSync(output))throw Error('main|webhook SOURCE.json NEW_PRIVATE.json');
 const w=(kind==='main'?patchProductWriters:patchInventoryWebhook)(JSON.parse(fs.readFileSync(input,'utf8')));
 fs.writeFileSync(output,JSON.stringify(w,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({written:true,nodes:w.nodes.length,executed:false,published:false}));
}
