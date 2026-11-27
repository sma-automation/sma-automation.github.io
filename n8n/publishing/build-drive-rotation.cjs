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
// These are the saved PHP/Geld slots in Vienna. Recheck ten minutes later if a worker was busy.
add('Versandtermine Wien','scheduleTrigger',{rule:{interval:[{field:'cronExpression',expression:'0 0,10 10,14,18 * * *'}]}},[0,680],1.2);
code('Versandquelle',key?'return [{json:{id:'+JSON.stringify(key)+'}}];':"if(!$vars.SMA_DRIVE_ROTATION_SOURCE)throw Error('SOURCE_NOT_CONFIGURED');return [{json:{id:$vars.SMA_DRIVE_ROTATION_SOURCE}}];",220,680);
const dueURL=service.parameters.url.replace(/[^/]+$/,'sma_rotation_due_v1');
add('Fällige Aufträge','httpRequest',{method:'POST',url:dueURL,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',
 sendBody:true,specifyBody:'json',jsonBody:"={{ ({p_source:$('Versandquelle').first().json.id}) }}",options},[440,680],4.5,{credentials:service.credentials});
code('Aufträge verteilen',`const jobs=$input.first().json.jobs;
if(!Array.isArray(jobs))throw Error('INVALID_DUE_RESPONSE');
return jobs.map(json=>({json}));`,660,680);
add('Auftrag einzeln','splitInBatches',{batchSize:1,options:{reset:"={{ $prevNode.name === 'Aufträge verteilen' }}"}},[880,680],3);
condition('Ausführungsprüfung?', "={{ $json.operation === 'publication.execution_check' }}",1100,760);
function worker(name,id,x,y){
 add(name,'executeWorkflow',{source:'database',workflowId:{__rl:true,value:id,mode:'id'},mode:'once',
  options:{waitForSubWorkflow:true}},[x,y],1.3);
}
worker('SMA Auftrag prüfen','RdtCqCWRi7P4W7B0',1320,690);
worker('SMA Versand fortsetzen','JaidX5YeKl6ZTqjQ',1320,860);
code('Weitere Rückmeldung',`if($runIndex>=8)return [];return [{json:{}}];`,1100,520);
add('Providerstatus abwarten','wait',{resume:'timeInterval',amount:20,unit:'seconds'},[1320,520],1.1);
edge('Versandtermine Wien','Versandquelle');edge('Versandquelle','Fällige Aufträge');edge('Fällige Aufträge','Aufträge verteilen');
edge('Aufträge verteilen','Auftrag einzeln');edge('Auftrag einzeln','Ausführungsprüfung?',1);edge('Auftrag einzeln','Weitere Rückmeldung',0);
edge('Ausführungsprüfung?','SMA Auftrag prüfen',0);edge('Ausführungsprüfung?','SMA Versand fortsetzen',1);
edge('SMA Auftrag prüfen','Auftrag einzeln');edge('SMA Versand fortsetzen','Auftrag einzeln');
edge('Weitere Rückmeldung','Providerstatus abwarten');edge('Providerstatus abwarten','Fällige Aufträge');
// Portal membership has its own schedule and commits only complete scans.
const {beginScan,collectPage}=require('./drive-portal-folders.cjs');
add('Portalordner jetzt prüfen','manualTrigger',{},[0,1240],1);
add('Portalordner täglich prüfen','scheduleTrigger',{rule:{interval:[{field:'cronExpression',expression:'0 35 8,15 * * *'}]}},[0,1440],1.2);
code('Portalquelle',nodes.find(n=>n.name==='Quelle').parameters.jsCode,220,1240);
function portalRpc(name,body,x){
 add(name,'httpRequest',{method:'POST',url:service.parameters.url.replace(/[^/]+$/,'sma_publication_portal_scan_v1'),
  authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody:body,options},
  [x,1240],4.5,{credentials:service.credentials});
}
portalRpc('Portalprüfung beginnen',"={{ ({p_source:$json.id,p_action:'start'}) }}",440);
code('Portalordner vormerken',beginScan.toString()+"\nreturn [{json:beginScan($input.first().json)}];",660,1240);
const pageQuery=nodes.find(n=>n.name==='Drive-Seite').parameters.jsCode.replace('folder=s.queue[0]','folder=s.queue[0].id');
code('Portalseite vorbereiten',pageQuery,880,1240);
drive('Portalseite lesen',{url:api,sendQuery:true,specifyQuery:'json',jsonQuery:'={{ JSON.stringify($json.query) }}'},1100,1240);
code('Portalinhalte sammeln',collectPage.toString()+"\nreturn [{json:collectPage($('Portalseite vorbereiten').first(0,$runIndex).json,$input.first().json)}];",1320,1240);
condition('Weitere Portalseiten?','={{ $json.queue.length > 0 }}',1540,1240);
portalRpc('Portalbestand speichern',"={{ ({p_source:$('Portalquelle').first().json.id,p_action:'finish',p_ticket:$('Portalprüfung beginnen').first().json.ticket,p_rows:$json.rows}) }}",1760);
edge('Portalordner jetzt prüfen','Portalquelle');edge('Portalordner täglich prüfen','Portalquelle');
for(const [a,b] of [['Portalquelle','Portalprüfung beginnen'],['Portalprüfung beginnen','Portalordner vormerken'],['Portalordner vormerken','Portalseite vorbereiten'],['Portalseite vorbereiten','Portalseite lesen'],['Portalseite lesen','Portalinhalte sammeln'],['Portalinhalte sammeln','Weitere Portalseiten?']])edge(a,b);
edge('Weitere Portalseiten?','Portalseite vorbereiten',0);edge('Weitere Portalseiten?','Portalbestand speichern',1);
for(const c of Object.values(connections))c.main=Array.from(c.main,v=>v??[]);
// Deploy the importer and dispatcher independently so the verified live import need not be replaced.
const dispatchOnly=process.argv.includes('--dispatch-only');
const chosen=new Set();
function include(name){
 if(chosen.has(name))return;
 chosen.add(name);
 for(const port of connections[name]?.main||[])for(const link of port)include(link.node);
}
const portalsOnly=process.argv.includes('--portal-folders-only');
const customTimes=process.argv.includes('--custom-times');
if(customTimes){
 const wake='Geänderter Portaltermin',claim='Versandtermin bestätigen';
 add(wake,'webhook',{httpMethod:'POST',path:'sma-portal-versandtermin-v1',responseMode:'onReceived',options:{responseData:'noData'}},[0,680],2.1,{webhookId:'2f2f773c-5268-4ffa-aba1-8c39dfea6fd8'});
 code('Terminticket lesen',`const ticket=$input.first().json.body?.ticket;
return typeof ticket==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ticket)?[{json:{ticket}}]:[];`,220,680);
 add(claim,'httpRequest',{method:'POST',url:dueURL.replace('sma_rotation_due_v1','sma_claim_portal_schedule_v1'),authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',
  sendBody:true,specifyBody:'json',jsonBody:'={{ ({p_ticket:$json.ticket}) }}',options},[440,680],4.5,{credentials:service.credentials});
 connections['Auftrag einzeln'].main[0]=[];
 edge(wake,'Terminticket lesen');edge('Terminticket lesen',claim);edge(claim,'Aufträge verteilen');
 include(wake);
 const scanWake='Drive-Ordner angefordert',scanClaim='Ordneranfrage bestätigen';
 add(scanWake,'webhook',{httpMethod:'POST',path:'sma-portalordner-oeffnen-v1',responseMode:'onReceived',options:{responseData:'noData'}},[0,1440],2.1,{webhookId:'4434ae65-7e5c-4683-8201-e7dc67bc6236'});
 code('Ordnerticket lesen',nodes.find(n=>n.name==='Terminticket lesen').parameters.jsCode,220,1440);
 add(scanClaim,'httpRequest',{...nodes.find(n=>n.name===claim).parameters,url:dueURL.replace('sma_rotation_due_v1','sma_claim_manual_portal_scan_v1')},[440,1440],4.5,{credentials:service.credentials});
 nodes.find(n=>n.name==='Portalquelle').parameters.jsCode="const id=$input.first().json.source_id;return id?[{json:{id}}]:[];";
 edge(scanWake,'Ordnerticket lesen');edge('Ordnerticket lesen',scanClaim);edge(scanClaim,'Portalquelle');include(scanWake);
}
else if(portalsOnly){include('Portalordner jetzt prüfen');include('Portalordner täglich prüfen');}
else if(dispatchOnly)include('Versandtermine Wien');
else{include('Jetzt abgleichen');include('Täglich vor der Planung');}
const name=customTimes?'SMA – Geänderte Versandtermine':portalsOnly?'SMA – Portalordner abgleichen':dispatchOnly?'SMA – Tagesversand PHP und Geld':'SMA – Drive-Galerie abgleichen';
process.stdout.write(JSON.stringify({name,nodes:nodes.filter(n=>chosen.has(n.name)),
 connections:Object.fromEntries(Object.entries(connections).filter(([n])=>chosen.has(n))),
 settings:{timezone:'Europe/Vienna',executionOrder:'v1',...(customTimes?{saveDataSuccessExecution:'none',saveDataErrorExecution:'none'}:{})}},null,2));
