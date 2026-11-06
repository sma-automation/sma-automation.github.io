'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const expected=require('./stock-request-source-fingerprints.json');
const contract=fs.readFileSync(path.join(__dirname,'stock-request-confirmation.cjs'),'utf8').split('module.exports=')[0];
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const runtime=node=>Object.fromEntries(['alwaysOutputData','continueOnFail','onError','retryOnFail','executeOnce']
  .map(key=>[key,node[key]??(key==='onError'?'stopWorkflow':false)]));
const names={read:'Shopify-Bestand lesen',write:'Shopify-Bestand setzen',result:'Shopify-Ergebnis prüfen',
  readback:'Shopify-Bestand nachlesen',finish:'Auftrag abschließen'};
function patchStockRequestConfirmation(source){
  if(source.id!==expected.workflow_id||source.nodes?.length!==30||Object.keys(source.pinData||{}).length)
    throw Error('Unexpected source');
  const workflow=structuredClone(source),map=new Map(workflow.nodes.map(n=>[n.name,n]));
  if(map.size!==30||new Set(workflow.nodes.map(n=>n.id)).size!==30||map.has(names.readback))
    throw Error('Unexpected nodes');
  for(const [name,fingerprint]of Object.entries(expected.nodes)){
    const node=map.get(name);
    if(!node||node.disabled||node.type!==fingerprint.type||node.typeVersion!==fingerprint.typeVersion||
        hash(node.parameters)!==fingerprint.parameters||hash(runtime(node))!==fingerprint.runtime||
        hash(workflow.connections[name]??null)!==fingerprint.connections)throw Error('Source changed: '+name);
  }
  const readback=structuredClone(map.get(names.read));
  readback.id=crypto.randomUUID();readback.name=names.readback;readback.position=[1664,1104];
  readback.retryOnFail=false;readback.continueOnFail=false;readback.alwaysOutputData=true;
  readback.onError='continueRegularOutput';
  const result=map.get(names.result);
  result.parameters.jsCode=contract+`\nreturn [{json:stockRequestConfirmation(
    $('${names.write}').first().json,$json,$('Änderung vorbereiten').first().json,
    $('Auftrag beanspruchen').first().json,$('Zuordnung prüfen').first().json)}];`;
  workflow.nodes.push(readback);
  const edge=node=>({node,type:'main',index:0});
  workflow.connections[names.write]={main:[[edge(names.readback)]]};
  workflow.connections[names.readback]={main:[[edge(names.result)]]};
  return workflow;
}
module.exports={patchStockRequestConfirmation,names};
if(require.main===module){
  const [input,output]=process.argv.slice(2);
  if(!input||!output||fs.existsSync(output))throw Error('SOURCE_PRIVATE.json NEW_PRIVATE.json');
  const workflow=patchStockRequestConfirmation(JSON.parse(fs.readFileSync(input,'utf8')));
  fs.writeFileSync(output,JSON.stringify(workflow,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({written:true,nodes:workflow.nodes.length,executed:false,published:false}));
}
