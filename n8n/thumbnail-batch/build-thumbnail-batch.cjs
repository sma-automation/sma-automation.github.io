'use strict';
const crypto=require('node:crypto');

// Embedded verbatim in the private candidate's Code nodes. No service access,
// credentials, customer records or live export is included in this source file.
function createThumbnailBatchRuntime(){
 const MAX_ITEMS=10,MAX_BYTES=8*1024*1024,WORK_MS=35000;
 const codes=['AUTH_REQUIRED','INVALID_INPUT','FILE_UNAVAILABLE','FILE_CHANGED','ACCESS_INACTIVE','ACCOUNT_UNAVAILABLE','FOLDER_UNAVAILABLE'];
 const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
 const validAsset=asset=>record(asset)&&Object.keys(asset).length===2&&Object.keys(asset).every(key=>['asset_id','asset_revision'].includes(key))&&/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(asset.asset_id||'')&&typeof asset.asset_revision==='string'&&asset.asset_revision.length>=1&&asset.asset_revision.length<=250;
 const error=code=>({ok:false,code:codes.includes(code)?code:'PREVIEW_UNAVAILABLE',can_publish:false});
 function copyItem(item,json=item.json){
  // Native subexecution metadata is not a legal Code-node output field in
  // n8n 2.47.7. Preserve only the public transport fields around the Fach-JSON.
  const output={json};for(const key of ['binary','pairedItem','error','index'])if(item[key]!==undefined)output[key]=item[key];return output;
 }
 function normalize(input,now){
  const internal=input._thumbnail_internal===true;
  // Public webhook items cannot supply this top-level mark: only the native
  // trigger's adapter sets it. A field inside HTTP body does not become a mark.
  const output={...input,_thumbnail_internal:internal,_thumbnail_mode:'single',_thumbnail_deadline:null};
  if(internal){
   const deadline=input._thumbnail_deadline;
   output._thumbnail_deadline=Number.isFinite(deadline)&&deadline>0&&deadline<=now+WORK_MS?deadline:now;
   return output;
  }
  const body=input.body;
  if(!record(body)||!Object.hasOwn(body,'assets'))return output;
  const auth=input.headers?.authorization;
  let code;
  if(typeof auth!=='string'||!/^Bearer [A-Za-z0-9._-]{20,8000}$/.test(auth))code='AUTH_REQUIRED';
  else if(Object.keys(body).length!==1||!Array.isArray(body.assets)||body.assets.length<1||body.assets.length>MAX_ITEMS||!body.assets.every(validAsset)||new Set(body.assets.map(asset=>JSON.stringify([asset.asset_id,asset.asset_revision]))).size!==body.assets.length)code='INVALID_INPUT';
  if(code)return {...output,...error(code),_thumbnail_mode:'invalid'};
  return {...output,_thumbnail_mode:'batch',_thumbnail_deadline:now+WORK_MS};
 }
 function workItems(input){
  if(input._thumbnail_mode!=='batch')throw Error('INVALID_BATCH');
  return input.body.assets.map(asset=>({
   ...input,body:{asset_id:asset.asset_id,asset_revision:asset.asset_revision},
   _thumbnail_mode:'single',_thumbnail_internal:false,
  }));
 }
 function allowed(input,now){return input._thumbnail_internal!==true||(Number.isFinite(input._thumbnail_deadline)&&input._thumbnail_deadline>now);}
 function timeout(input,now){return input._thumbnail_internal===true?Math.max(1,Math.min(25000,input._thumbnail_deadline-now)):25000;}
 function boundResult(result,asset){
  const binding={asset_id:asset.asset_id,asset_revision:asset.asset_revision};
  if(result?.ok!==true)return {...error(result?.code),...binding};
  if(result.can_publish!==false||result.asset_id!==asset.asset_id||result.asset_revision!==asset.asset_revision||!['image','video'].includes(result.media_kind)||!['image/png','image/jpeg','image/webp'].includes(result.mime_type)||typeof result.image_base64!=='string'||result.image_base64.length>2666668||!/^[A-Za-z0-9+/]+={0,2}$/.test(result.image_base64))return {...error(),...binding};
  const size=Buffer.from(result.image_base64,'base64').length;if(size<12||size>2000000)return {...error(),...binding};
  return {ok:true,...binding,media_kind:result.media_kind,mime_type:result.mime_type,image_base64:result.image_base64,can_publish:false};
 }
 function internalResult(result,input,now){return boundResult(allowed(input,now)?result:error(),input.body||{});}
 function collect(items,work){
  // Start with small errors for every requested identity; missing or failed
  // child results never leak error payloads or silently remove an input row.
  const assets=work.map(input=>boundResult(null,input.body)),seen=new Set();
  for(let position=0;position<items.length;position++){
   const item=items[position],index=Number.isInteger(item.pairedItem?.item)?item.pairedItem.item:position;
   if(index<0||index>=work.length||seen.has(index))continue;seen.add(index);
   const candidate=boundResult(item.json,work[index].body),previous=assets[index];assets[index]=candidate;
   if(Buffer.byteLength(JSON.stringify({ok:true,can_publish:false,assets}),'utf8')>MAX_BYTES)assets[index]=previous;
  }
  return {ok:true,can_publish:false,assets};
 }
 return {MAX_ITEMS,MAX_BYTES,WORK_MS,copyItem,normalize,workItems,allowed,timeout,internalResult,collect};
}

function transformThumbnailSource(original){
 const workflow=structuredClone(original);
 const prefix=workflow.id==='aEm2khRhdM6EUdoq'?'Vorschaubild · ':workflow.id==='c6ncyk7ZTlQzX7z3'?'':null;
 if(prefix===null)throw Error('UNKNOWN_THUMBNAIL_SOURCE');
 const operation=prefix?'media.thumbnail.pilot_single':'media.thumbnail.single';
 const old=name=>prefix+name,newName=name=>prefix+'Paket · '+name;
 const byName=name=>{const node=workflow.nodes.find(item=>item.name===name);if(!node)throw Error('MISSING_NODE: '+name);return node;};
 for(const name of ['Medienvorschau','Anfrage prüfen','Eigene Datei prüfen','Kundenordner zuordnen','Dateimetadaten lesen','Vorschaubild laden','Vorschauantwort bereinigen','Vorschauantwort'])byName(old(name));
 if(workflow.nodes.some(node=>node.type==='n8n-nodes-base.executeWorkflowTrigger'))throw Error('INTERNAL_TRIGGER_ALREADY_PRESENT');
 const runtime='const batch=('+createThumbnailBatchRuntime.toString()+')();\n';
 const nodes=[],metadata={sourceId:workflow.id,sourceVersionId:workflow.versionId,operation,internalTrigger:null,entryNode:null};
 function add(label,type,parameters,extra={}){
  const name=newName(label),hex=crypto.createHash('sha256').update(workflow.id+'\0thumbnail-batch-v1\0'+name).digest('hex');
  const id=hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-8'+hex.slice(17,20)+'-'+hex.slice(20,32);
  const node={id,name,type:'n8n-nodes-base.'+type,typeVersion:type==='code'?2:type==='if'?2.2:type==='executeWorkflow'?1.3:1.1,
   position:[-720+(nodes.length%3)*320,560+Math.floor(nodes.length/3)*180],parameters,...extra};nodes.push(node);return name;
 }
 function connect(from,to,output=0){
  const connection=workflow.connections[from]??={main:[]};while(connection.main.length<=output)connection.main.push([]);
  connection.main[output].push({node:to,type:'main',index:0});
 }
 function boolean(expression){return {conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:'bool',leftValue:expression,rightValue:'',operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}};}
 const internal=add('Internes Einzelbild','executeWorkflowTrigger',{inputSource:'passthrough'});
 const mark=add('Internen Eingang markieren','code',{jsCode:runtime+'const item=$input.first();return [batch.copyItem(item,{...item.json,_thumbnail_internal:true})];'});
 const entry=add('Anfrageform prüfen','code',{jsCode:runtime+'const item=$input.first();return [batch.copyItem(item,batch.normalize(item.json,Date.now()))];'});
 const singleRoute=add('Interner Einzelpfad?', 'if',boolean('={{ $('+JSON.stringify(internal)+').isExecuted }}'));
 const batchRoute=add('Mehrere Vorschaubilder?', 'if',boolean("={{ $json._thumbnail_mode === 'batch' }}"));
 const invalid=add('Paket ungültig?', 'if',boolean("={{ $json._thumbnail_mode === 'invalid' }}"));
 const prepare=add('Einzelanfragen vorbereiten','code',{jsCode:runtime+'const item=$input.first();return batch.workItems(item.json).map(json=>({json,...(item.binary?{binary:item.binary}:{})}));'});
 const execute=add('Einzelbilder nacheinander prüfen','executeWorkflow',{source:'database',workflowId:{__rl:true,value:workflow.id,mode:'id'},mode:'each',options:{waitForSubWorkflow:true}},
  {onError:'continueRegularOutput',notes:'Native internal calls, one item at a time. The consolidation builder maps this source ID and wraps its unchanged item as {operation,payload,context:{deadlineAt}}. Never call a public webhook here.'});
 const collect=add('Paketantwort begrenzen','code',{jsCode:runtime+'return [{json:batch.collect($input.all(),$('+JSON.stringify(prepare)+').all().map(item=>item.json))}];'});
 // The route is bound to the actually executed internal entry, not an input
 // field. The consolidation builder can prove the public response unreachable
 // for this child while keeping the original public single-file response.
 const returnRoute=add('Interne Einzelantwort?', 'if',boolean('={{ $('+JSON.stringify(internal)+').isExecuted }}'));
 const result=add('Einzelbild zurückgeben','code',{jsCode:runtime+'return [{json:batch.internalResult($input.first().json,$('+JSON.stringify(entry)+').first().json,Date.now())}];'});
 const expired=add('Paketfrist abgelaufen','code',{jsCode:"return [{json:{ok:false,code:'PREVIEW_UNAVAILABLE',can_publish:false}}];"});
 workflow.connections[old('Medienvorschau')]={main:[[{node:entry,type:'main',index:0}]]};
 connect(internal,mark);connect(mark,entry);connect(entry,singleRoute);connect(singleRoute,old('Anfrage prüfen'),0);connect(singleRoute,batchRoute,1);connect(batchRoute,prepare,0);connect(batchRoute,invalid,1);
 connect(invalid,old('Vorschauantwort bereinigen'),0);connect(invalid,old('Anfrage prüfen'),1);
 connect(prepare,execute);connect(execute,collect);connect(collect,old('Vorschauantwort'));
 workflow.connections[old('Vorschauantwort bereinigen')]={main:[[{node:returnRoute,type:'main',index:0}]]};
 connect(returnRoute,result,0);connect(returnRoute,old('Vorschauantwort'),1);connect(expired,old('Vorschauantwort bereinigen'));
 // Check the same absolute deadline before every external read, including the
 // DataTable lookup. A timeout/failure returns a bound per-file error; no retry.
 for(const label of ['Eigene Datei prüfen','Kundenordner zuordnen','Dateimetadaten lesen','Vorschaubild laden']){
  const target=old(label),guard=add('Restfrist vor '+label,'if',boolean('={{ $('+JSON.stringify(entry)+').first().json._thumbnail_internal !== true || $('+JSON.stringify(entry)+').first().json._thumbnail_deadline > Date.now() }}'));
  for(const connection of Object.values(workflow.connections))for(const output of connection.main||[])for(const edge of output)if(edge.node===target)edge.node=guard;
  connect(guard,target,0);connect(guard,expired,1);
  const node=byName(target);
  if(node.type==='n8n-nodes-base.httpRequest')node.parameters.options={...node.parameters.options,timeout:'={{ $('+JSON.stringify(entry)+').first().json._thumbnail_internal === true ? Math.max(1,Math.min(25000,$('+JSON.stringify(entry)+').first().json._thumbnail_deadline-Date.now())) : 25000 }}'};
 }
 workflow.nodes.push(...nodes);
 metadata.internalTrigger=internal;metadata.entryNode=mark;
 return {workflow,metadata};
}

module.exports={createThumbnailBatchRuntime,transformThumbnailSource};

if(require.main===module){
 const fs=require('node:fs'),path=require('node:path');
 const [sourceDir,outputDir]=process.argv.slice(2);
 if(!sourceDir||!outputDir||process.argv.length!==4)throw Error('Usage: node build-thumbnail-batch.cjs PRIVATE_SOURCE_DIR PRIVATE_OUTPUT_DIR');
 // Never overwrite either immutable source export and never accidentally place
 // a credential-bearing candidate in the public repository.
 const output=path.resolve(outputDir),repository=path.resolve(__dirname,'../..');
 if(output===path.resolve(sourceDir)||output===repository||output.startsWith(repository+path.sep))throw Error('PRIVATE_OUTPUT_REQUIRED');
 fs.mkdirSync(output,{recursive:true});const manifest=[];
 for(const id of ['c6ncyk7ZTlQzX7z3','aEm2khRhdM6EUdoq']){
  const sourcePath=path.join(sourceDir,id+'.json'),input=fs.readFileSync(sourcePath),parsed=JSON.parse(input),source=Array.isArray(parsed)?parsed[0]:parsed;
  const {workflow,metadata}=transformThumbnailSource(source),candidate=JSON.stringify(workflow,null,2)+'\n',filename=id+'.json';
  fs.writeFileSync(path.join(output,filename),candidate,{mode:0o600});
  manifest.push({...metadata,file:filename,sourceSha256:crypto.createHash('sha256').update(input).digest('hex'),candidateSha256:crypto.createHash('sha256').update(candidate).digest('hex')});
 }
 fs.writeFileSync(path.join(output,'thumbnail-batch-overlays.json'),JSON.stringify({version:1,overlays:manifest},null,2)+'\n',{mode:0o600});
 process.stdout.write(JSON.stringify({overlays:manifest.map(({sourceId,file,sourceSha256,candidateSha256,operation})=>({sourceId,file,sourceSha256,candidateSha256,operation}))},null,2)+'\n');
}
