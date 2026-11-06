'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {buildInventoryQA}=require('./build-inventory-draft-qa.cjs');
const {patchInventoryWebhook,patchProductWriters,editNames:E}=require('./patch-inventory-writers.cjs');
const {inventoryNames:N}=require('./inventory-draft-contract.cjs');
const core=fs.readFileSync(path.join(__dirname,'inventory-writers-contract.cjs'),'utf8').split('module.exports=')[0];
function buildInventoryWritersQA(main,webhook,draft){
 const qa=buildInventoryQA(draft),m=patchProductWriters(main),w=patchInventoryWebhook(webhook);
 const from=(source,name)=>{const n=structuredClone(source.nodes.find(n=>n.name===name));if(!n)throw Error('Missing QA source');n.id=crypto.randomUUID();return n;};
 const code=(name,body)=>({id:crypto.randomUUID(),name,type:'n8n-nodes-base.code',typeVersion:2,position:[0,0],parameters:{mode:'runOnceForAllItems',jsCode:body}});
 const add=n=>{qa.nodes.push(n);return n.name;};
 const edge=node=>({node,type:'main',index:0});
 const between=(before,names,after)=>{
  [before,...names].forEach((name,i)=>qa.connections[name]={main:[[edge([...names,after][i])]]});
 };
 // Exercise the exact webhook guards with real leased data from the existing QA.
 const aliases=[
  code('Produktzuordnung prüfen',`const s=$('${N.evaluate}').first().json;return [{json:{...s,sku:$('${N.product}').first().json.sku}}];`),
  code('Meldung beanspruchen',`return [{json:$('${N.claim}').first().json}];`),
  code('QA – Webhook Produktquelle',`return [{json:$('${N.product}').first().json}];`),
  from(w,'SMA-Produkt prüfen')];
 between(N.evaluate,aliases.map(add),'QA – Nur bestätigten Testbestand übernehmen');
 const canonical=from(w,'Speicherwert prüfen');
 const raw=code('QA – Übernahmeantwort weitergeben',`return [{json:$('${N.commit}').first().json}];`);
 between(N.commit,[add(canonical),add(raw)],N.canonical);
 // Identical DataTable operation, attached to the same authenticated source row.
 const mirror=from(w,'n8n-Bestand speichern');mirror.name=N.mirror;
 qa.nodes[qa.nodes.findIndex(n=>n.name===N.mirror)]=mirror;
 const verified=from(w,'Gespeicherten Bestand prüfen');
 const row=code('QA – Spiegelantwort weitergeben',`return [{json:$('${N.mirror}').first().json}];`);
 between(N.mirror,[add(verified),add(row)],'QA – Alten Schreibversuch wiederholen');

 const read=from(m,E.read);
 read.parameters.filters={conditions:[{keyName:'id',keyValue:`={{ $('${N.product}').first().json.id }}`},
  {keyName:'kunde_id',keyValue:`={{ $('${N.product}').first().json.kunde_id }}`},
  {keyName:'produkt_id',keyValue:`={{ $('${N.product}').first().json.produkt_id }}`}]};
 const customer=code('SMA – Produkt – Bearbeiten – Kunde prüfen',`return [{json:{kunde_id:$('${N.product}').first().json.kunde_id}}];`);
 const context=code(E.webhook,`return [{json:{body:{produkt_id:$('${N.product}').first().json.produkt_id}}}];`);
 const ownership=code('QA – Shopify-Bestandsänderung abweisen',core+`\nconst p=$('${E.read}').first().json, maps=$('${E.mappings}').all().map(x=>x.json);
 if(p.bestand!==4||p.sku!=='SMA-TEST-002')throw Error('QA_SCOPE_OR_STOCK_CHANGED');
 let rejected=false;try{prepareProductEdit(p,maps,{produkt_id:p.produkt_id,bestand:3});}catch(e){if(e.message==='SHOPIFY_STOCK_USE_STOCK_ORDER')rejected=true;else throw e;}
 if(!rejected)throw Error('QA_SHOPIFY_OWNER_NOT_ENFORCED');return maps.map(json=>({json}));`);
 const stale=from(m,E.save);stale.name='QA – Alte Produktbearbeitung wiederholen';
 const conflict=code('QA – Bearbeitungskonflikt prüfen',core+`\nlet rejected=false;
 try{confirmProductEdit($input.all().map(x=>x.json),$('${E.prepare}').first().json);}catch(e){if(e.message==='PRODUCT_EDIT_CONFLICT_RELOAD_REQUIRED')rejected=true;else throw e;}
 if(!rejected)throw Error('QA_EDIT_CONFLICT_NOT_REJECTED');return [{json:$('${E.confirmed}').first().json}];`);
 const reread=structuredClone(read);reread.id=crypto.randomUUID();reread.name='QA – Bearbeitung erneut lesen';
 const unchanged=code('QA – Bearbeitung unverändert',`const row=$input.first().json, before=$('${E.confirmed}').first().json;
 for(const k of ['id','kunde_id','produkt_id','bestand','updatedAt'])if(row[k]!==before[k])throw Error('QA_EDIT_CHANGED_AFTER_REJECTION');return [{json:row}];`);
 const phase=[read,customer,context,from(m,E.mappings),ownership,from(m,E.prepare),from(m,E.save),from(m,E.confirmed),stale,conflict,reread,unchanged];
 for(const market of ['Shopify','Digistore24']){
  const imported=from(m,`SMA – Marktkonto – Initialimport – ${market} Produkt aktualisieren`);
  if(Object.hasOwn(imported.parameters.columns.value,'bestand'))throw Error('QA_IMPORT_STOCK_WRITE_FORBIDDEN');
  imported.parameters.options={...imported.parameters.options,dryRun:true};
  phase.push(code(`QA – ${market} Importdaten`, `const p=$('QA – Bearbeitung unverändert').first().json;return [{json:{produkt:{...p,bestand:0,roh_daten:{active:p.aktiv,title:p.produkt_name,description:p.beschreibung,sku:p.sku,price:p.preis,currency:p.waehrung,stock:0}}}}];`),imported,
   code(`QA – ${market} Import prüfen`,`const rows=$input.all().map(x=>x.json), p=$('QA – Bearbeitung unverändert').first().json;
 if(rows.length!==2||!rows.some(r=>r.dryRunState==='before')||!rows.some(r=>r.dryRunState==='after')||rows.some(r=>r.id!==p.id||r.bestand!==4))throw Error('QA_IMPORT_CHANGED_STOCK');return [{json:{ok:true}}];`));
 }
 const final=code('QA – Gemeinsames Ergebnis',`return [{json:{...$('QA – Ergebnis').first().json,webhook_guards_passed:true,shopify_stock_order_required:true,metadata_edit_confirmed:true,stale_edit_rejected:true,imports_preserve_stock_dry_run:true,production_published:false}}];`);
 between('QA – Ergebnis',phase.map(add),add(final));qa.connections[final.name]={main:[]};
 // Deterministic layout in actual execution order; no live webhook or registration.
 const order=[];let current='Manueller Bestandsprüflauf';
 while(current){if(order.includes(current))throw Error('QA_CYCLE');order.push(current);current=qa.connections[current]?.main?.[0]?.[0]?.node;}
 if(order.length!==qa.nodes.length)throw Error('QA_DISCONNECTED_NODE');
 order.forEach((name,i)=>{qa.nodes.find(n=>n.name===name).position=[(i%8)*270,Math.floor(i/8)*250];});
 const names=new Set(qa.nodes.map(n=>n.name));
 for(const n of qa.nodes){
  if(/webhook|scheduleTrigger|respondToWebhook/.test(n.type))throw Error('QA_EXTERNAL_TRIGGER');
  for(const match of JSON.stringify(n.parameters).matchAll(/\$\('([^']+)'\)/g))if(!names.has(match[1]))throw Error('QA_MISSING_REFERENCE: '+match[1]);
 }
 return qa;
}
module.exports={buildInventoryWritersQA};
if(require.main===module){
 const [main,webhook,draft,output]=process.argv.slice(2);
 if(!output||fs.existsSync(output))throw Error('MAIN.json WEBHOOK.json DRAFT.json NEW_PRIVATE_QA.json');
 const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),qa=buildInventoryWritersQA(read(main),read(webhook),read(draft));
 fs.writeFileSync(output,JSON.stringify(qa,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({nodes:qa.nodes.length,active:false}));
}
