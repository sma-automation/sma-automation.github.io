// Generate a native, private n8n workflow for one enrolled SMA gallery.
// A deployment injects its source UUID; the template contains no customer folder IDs.
'use strict';
const {createHash}=require('node:crypto');
const base=require('./file-catalog-workflow.json');
const find=name=>base.nodes.find(node=>node.name===name);
const {verifiedFolders}=require('./file-catalog.cjs');
const nodes=[],connections={};
const key=process.argv[2] || null;
if(key && !/^[a-f0-9-]{36}$/.test(key))throw Error('Invalid source UUID');
function add(name,type,parameters,position,version,extra={}){
 const h=createHash('sha256').update('sma-drive-rotation/'+name).digest('hex');
 nodes.push({id:[h.slice(0,8),h.slice(8,12),'4'+h.slice(13,16),'8'+h.slice(17,20),h.slice(20,32)].join('-'),name,type:'n8n-nodes-base.'+type,typeVersion:version,position,parameters,...extra});
}
function edge(from,to,port=0){
 const m=(connections[from]??={main:[]}).main;
 (m[port]??=[]).push({node:to,type:'main',index:0});
}
function code(name,jsCode,x,y=0){add(name,'code',{jsCode},[x,y],2);}
const authDrive={authentication:'predefinedCredentialType',nodeCredentialType:'googleDriveOAuth2Api'};
const google=find('Dateimetadaten aus Drive lesen');
const service=base.nodes.find(n=>n.credentials?.httpHeaderAuth);
const options={timeout:35000,redirect:{redirect:{followRedirects:false}}};
function drive(name,params,x,y=0){add(name,'httpRequest',{...authDrive,options,...params},[x,y],4.5,{credentials:google.credentials});}
function rpc(name,action,input,x,y=0){
 const url=service.parameters.url.replace(/[^/]+$/,'sma_rotation_import_v1');
 add(name,'httpRequest',{method:'POST',url,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',
  sendBody:true,specifyBody:'json',jsonBody:"={{ ({p_source:$('Quelle').first().json.id,p_action:'"+action+"',p_input:("+input+")} ) }}",options},[x,y],4.5,{credentials:service.credentials});
}
function condition(name,expr,x,y=0){
 const p=structuredClone(find('Konto freigegeben?').parameters);
 p.conditions.conditions[0].leftValue=expr;
 add(name,'if',p,[x,y],2.3);
}
add('Jetzt abgleichen','manualTrigger',{},[0,0],1);
add('Täglich vor der Planung','scheduleTrigger',{rule:{interval:[{field:'cronExpression',expression:'0 15 8,15 * * *'}]}},[0,200],1.2);
code('Quelle',key?'return [{json:{id:'+JSON.stringify(key)+'}}];':"if(!$vars.SMA_DRIVE_ROTATION_SOURCE)throw Error('SOURCE_NOT_CONFIGURED');return [{json:{id:$vars.SMA_DRIVE_ROTATION_SOURCE}}];",220);
rpc('Konfiguration','context','{}',440);
const kt=find('Kundenordner zuordnen');add('Kundenordner','dataTable',kt.parameters,[660,0],kt.typeVersion,{alwaysOutputData:true});
code('Ordnerbindung', "const DRIVE_ID=/^[A-Za-z0-9_-]{10,200}$/;\n"+verifiedFolders.toString()+`
const cfg=$('Konfiguration').first().json;
const {folders}=verifiedFolders($input.all().map(i=>i.json),cfg);
if(!DRIVE_ID.test(cfg.source)||cfg.source===folders[0]||cfg.source===folders[1]||folders[1]!==cfg.destination)throw Error('FOLDER_BINDING_CHANGED');
return [{json:{id:cfg.source}}];`,880);
const api='https://www.googleapis.com/drive/v3/files';
drive('Quellordner lesen',{url:"={{ '"+api+"/'+$json.id+'?supportsAllDrives=true&fields=id,mimeType,trashed,capabilities(canListChildren)' }}"},1100);
code('Suche starten',`const f=$input.first().json,cfg=$('Konfiguration').first().json;
if(f.id!==cfg.source||f.trashed!==false||f.mimeType!=='application/vnd.google-apps.folder'||!f.capabilities?.canListChildren)throw Error('SOURCE_UNAVAILABLE');
return [{json:{queue:[cfg.source],visited:[],tokens:[],candidates:[]}}];`,1320);
code('Drive-Seite',`const s=$input.first().json;const folder=s.queue[0];
if(!/^[A-Za-z0-9_-]{10,200}$/.test(folder))throw Error('INVALID_FOLDER');
const query={q:"trashed = false and '"+folder+"' in parents and (mimeType='application/vnd.google-apps.folder' or mimeType contains 'video/')",spaces:'drive',pageSize:1000,
fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,parents,trashed,size,sha256Checksum)'};
if(s.tokens.length)query.pageToken=s.tokens[s.tokens.length-1];
return [{json:{...s,query}}];`,1540);
drive('Ordnerinhalt',{url:api,sendQuery:true,specifyQuery:'json',jsonQuery:'={{ JSON.stringify($json.query) }}'},1760);
code('Dateien sammeln',`const s=$('Drive-Seite').first(0,$runIndex).json;
const {query,...next}=s, cfg=$('Konfiguration').first().json, page=$input.first().json, parent=next.queue[0];
if(page.incompleteSearch||!Array.isArray(page.files))throw Error('INCOMPLETE_LISTING');
const known=new Set([...cfg.completed,...next.candidates.map(f=>f.digest)]);
const visited=new Set([...next.visited,...next.queue]);
for(const f of page.files){
 if(f.trashed!==false||!f.parents?.includes(parent)||!/^[A-Za-z0-9_-]{10,200}$/.test(f.id))throw Error('SOURCE_CHANGED');
 if(f.mimeType==='application/vnd.google-apps.folder'){
  if(f.id===cfg.destination)throw Error('SOURCE_CONTAINS_DESTINATION');
  if(!visited.has(f.id)){visited.add(f.id);next.queue.push(f.id);}
 }else if(parent!==cfg.source && f.mimeType?.startsWith('video/') && /^[1-9][0-9]*$/.test(f.size) && /^[0-9a-f]{64}$/.test(f.sha256Checksum) && !known.has(f.sha256Checksum)){
  next.candidates.push({original_id:f.id,name:f.name,digest:f.sha256Checksum});known.add(f.sha256Checksum);
 }
}
if(page.nextPageToken){if(next.tokens.includes(page.nextPageToken))throw Error('REPEATED_PAGE');next.tokens.push(page.nextPageToken);}
else{next.visited.push(next.queue.shift());next.tokens=[];}
return [{json:next}];`,1980);
condition('Weitere Ordner?','={{ $json.queue.length > 0 }}',2200);
code('Neue Videos',`return $input.first().json.candidates.map(f=>({json:f}));`,2420,120);
add('Video für Video','splitInBatches',{batchSize:1,options:{}},[2640,120],3);
drive('Drive-ID reservieren',{url:api+'/generateIds?count=1&space=drive&type=files'},2860,230);
rpc('Kopie zuordnen','reserve',"{...$('Video für Video').item.json,copy_id:$json.ids[0]}",3080,230);
drive('Video kopieren',{method:'POST',url:"={{ '"+api+"/'+$('Video für Video').item.json.original_id+'/copy?supportsAllDrives=true&fields=id' }}",
 sendBody:true,specifyBody:'json',jsonBody:"={{ ({id:$json.id,name:$('Video für Video').item.json.name,parents:[$('Konfiguration').first().json.destination],appProperties:{sma_rotation_source:$('Quelle').first().json.id} }) }}",
 options:{...options,response:{response:{fullResponse:true,neverError:true}}}},3300,230);
code('Kopierergebnis',`const result=$input.first().json,id=$('Kopie zuordnen').item.json.id;
if(![200,201,409].includes(result.statusCode) || (result.statusCode!==409 && result.body?.id!==id))throw Error('DRIVE_COPY_FAILED_'+result.statusCode);
return [{json:{id},pairedItem:{item:0}}];`,3520,230);
drive('Kopie aus Drive prüfen',{url:"={{ '"+api+"/'+$json.id+'?supportsAllDrives=true&fields=id,name,mimeType,size,sha256Checksum,parents,trashed,version,modifiedTime,appProperties,videoMediaMetadata(width,height,durationMillis)' }}"},3740,230);
rpc('In SMA übernehmen','verify',"{digest:$('Video für Video').item.json.digest,file:$json}",3960,230);
for(const [first,...rest] of [['Jetzt abgleichen','Quelle','Konfiguration','Kundenordner','Ordnerbindung','Quellordner lesen','Suche starten','Drive-Seite','Ordnerinhalt','Dateien sammeln','Weitere Ordner?'],['Täglich vor der Planung','Quelle'],['Neue Videos','Video für Video'],['Drive-ID reservieren','Kopie zuordnen','Video kopieren','Kopierergebnis','Kopie aus Drive prüfen','In SMA übernehmen','Video für Video']]){
 let prev=first;for(const n of rest){edge(prev,n);prev=n;}
}
edge('Weitere Ordner?','Drive-Seite',0);edge('Weitere Ordner?','Neue Videos',1);edge('Video für Video','Drive-ID reservieren',1);
for(const c of Object.values(connections))c.main=Array.from(c.main,v=>v??[]);
process.stdout.write(JSON.stringify({name:'SMA – Drive-Galerie abgleichen',nodes,connections,settings:{timezone:'Europe/Vienna',executionOrder:'v1',saveDataSuccessExecution:'none',saveManualExecutions:false}},null,2));
