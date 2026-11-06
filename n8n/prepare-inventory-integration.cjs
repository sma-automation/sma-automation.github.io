'use strict';
// Offline only: build a narrowly scoped candidate from a fresh published export.
// Never import, execute, activate, or publish a workflow here.
const fs=require('node:fs');
const crypto=require('node:crypto');
const {isDeepStrictEqual:equal}=require('node:util');
const {patchInventoryDraft}=require('./patch-inventory-draft.cjs');
const {inventoryNames:N}=require('./inventory-draft-contract.cjs');
const prefix='SMA – Produkt – Shopify Sync – ';
const branch=prefix+'Externe Produkt-ID vorhanden?';
const mirror='SMA – Supabase – Produkt spiegeln';
const stockValue="={{ Number($('SMA – Produkt – Shopify Sync – Produkt prüfen').first().json.bestand) }}";
const chain=[N.read,N.prepare,'SMA – Bestand – Sperrauftrag',N.claim,N.claimed,N.reread,N.evaluate,N.commit,N.canonical,N.mirror,N.finishBody,N.finish,N.done];
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function publishedExport(source){
 // n8n history downloads carry the current draft's top-level versionId even
 // when their nodes belong to the selected published version. Verify the
 // active snapshot and omit server-owned account/history metadata from imports.
 if(!source.activeVersion)return source;
 const active=source.activeVersion;
 if(source.active!==true||source.activeVersionId!==active.versionId||active.workflowId!==source.id||
    !equal(source.nodes,active.nodes)||!equal(source.connections,active.connections))throw new Error('Export is not the active published snapshot');
 const normalized={};
 for(const key of ['name','nodes','pinData','connections','active','settings','meta','nodeGroups','id','tags'])
  if(Object.hasOwn(source,key))normalized[key]=structuredClone(source[key]);
 normalized.versionId=active.versionId;
 return normalized;
}
function index(w){
 if(!Array.isArray(w?.nodes)||!w.connections||Object.keys(w.pinData||{}).length)throw new Error('Unpinned workflow export required');
 const map=new Map(w.nodes.map(n=>[n.name,n]));
 if(map.size!==w.nodes.length||new Set(w.nodes.map(n=>n.id)).size!==w.nodes.length)throw new Error('Unique node names and IDs required');
 return map;
}
function prepareInventoryIntegration(published,draft){
 published=publishedExport(published);
 const baseNodes=index(published),draftNodes=index(draft);
 if(published.id!==draft.id||!published.versionId||!draft.versionId)throw new Error('Matching versioned workflow exports required');
 const patched=patchInventoryDraft(draft),patchedNodes=index(patched);
 for(const name of chain)if(baseNodes.has(name))throw new Error('Published inventory branch already exists: '+name);
 const dependencies=[N.product,N.mapping,N.account,prefix+'Credential laden',prefix+'Credential entschlüsseln',prefix+'Credential vorbereiten',prefix+'Access Token holen',branch];
 for(const name of dependencies){
  const a=baseNodes.get(name),b=draftNodes.get(name);
  if(!a||!b||a.type!==b.type||!equal(a.parameters,b.parameters)||!equal(a.credentials,b.credentials))throw new Error('Dependency changed: '+name);
 }
 const edge=node=>({node,type:'main',index:0});
 const expected={main:[[edge(prefix+'Produkt aktualisieren')],[edge(prefix+'Produkt erstellen')]]};
 if(!equal(published.connections[branch],expected))throw new Error('Published product routing changed');
 const draftRouting=structuredClone(expected);draftRouting.main[0].push(edge(N.read));
 if(!equal(draft.connections[branch],draftRouting))throw new Error('Draft product routing changed');
 for(const name of [prefix+'Produkt aktualisieren',prefix+'Produkt erstellen'])if(!baseNodes.has(name))throw new Error('Product sibling missing');
 const oldMirror=baseNodes.get(mirror),draftMirror=draftNodes.get(mirror);
 if(oldMirror?.type!=='n8n-nodes-base.httpRequest'||oldMirror.parameters.method!=='POST'||!draftMirror)throw new Error('Product mirror missing');
 const fields=oldMirror.parameters.bodyParameters?.parameters;
 if(!Array.isArray(fields)||new Set(fields.map(f=>f.name)).size!==fields.length)throw new Error('Unique mirror body fields required');
 const stock=fields.filter(f=>f.name==='bestand');
 if(stock.length!==1||stock[0].value!==stockValue)throw new Error('Unexpected legacy stock expression');
 const updatedFields=fields.filter(f=>f.name!=='bestand');
 if(!equal(updatedFields,draftMirror.parameters.bodyParameters?.parameters))throw new Error('Draft changes unrelated mirror fields');
 const candidate=structuredClone(published);
 candidate.nodes.find(n=>n.name===mirror).parameters.bodyParameters.parameters=structuredClone(updatedFields);
 candidate.nodes.push(...chain.map(name=>structuredClone(patchedNodes.get(name))));
 candidate.connections[branch]=draftRouting;
 for(const name of chain)candidate.connections[name]=structuredClone(patched.connections[name]);
 index(candidate);
 const summary={workflow_id:published.id,published_version:published.versionId,draft_version:draft.versionId,
  source_nodes_sha256:hash(published.nodes),source_connections_sha256:hash(published.connections),
  before_nodes:published.nodes.length,after_nodes:candidate.nodes.length,added_nodes:chain,
  modified_existing_nodes:[mirror],modified_existing_connections:[branch],
  protected_nodes_unchanged:published.nodes.length-1,product_mutations_unchanged:true,
  credentials_unchanged:true,settings_unchanged:true,executed:false,published:false};
 return {candidate,summary};
}
module.exports={prepareInventoryIntegration};
if(require.main===module){
 const [publishedPath,draftPath,outputPath,summaryPath]=process.argv.slice(2);
 if(!summaryPath)throw new Error('PUBLISHED.json DRAFT.json NEW_PRIVATE_CANDIDATE.json NEW_SUMMARY.json required');
 for(const p of [outputPath,summaryPath])if(fs.existsSync(p))throw new Error('Output already exists');
 const {candidate,summary}=prepareInventoryIntegration(JSON.parse(fs.readFileSync(publishedPath,'utf8')),JSON.parse(fs.readFileSync(draftPath,'utf8')));
 fs.writeFileSync(outputPath,JSON.stringify(candidate,null,2)+'\n',{flag:'wx',mode:0o600});
 fs.writeFileSync(summaryPath,JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify(summary));
}
