const {test}=require('node:test');const assert=require('node:assert/strict');const {verifiedFolders,accessibleFolders,catalogFiles}=require('../n8n/publishing/file-catalog.cjs');
const context={ok:true,n8n_kunde_id:'kunde_test',kunde_email:'test@example.com'};
const row={kunde_id:'kunde_test',kunde_email:'test@example.com',zugang_aktiv:true,demo_delta_aktiv:true,upload_folder_id:'upload_folder_123',processing_folder_id:'processing_folder_456'};
const file={id:'drive_file_123456',name:'Testvideo.mp4',mimeType:'video/mp4',parents:[row.upload_folder_id],version:'3',modifiedTime:'2026-11-01T10:00:00Z',size:'1024',md5Checksum:'a'.repeat(32)};
test('folder resolution rejects other customers, duplicate mappings and query injection',()=>{assert.equal(verifiedFolders([row],context).folders.length,2);for(const rows of [[{...row,kunde_id:'foreign'}],[row,row],[{...row,upload_folder_id:"abc' or trashed=false"}],[{...row,zugang_aktiv:false}]])assert.throws(()=>verifiedFolders(rows,context),/FOLDER_UNAVAILABLE/);});
test('empty file results are valid only after both configured folders are accessible',()=>{
 const mapping=verifiedFolders([row],context);
 const metadata=mapping.folders.map(id=>({id,mimeType:'application/vnd.google-apps.folder',trashed:false,capabilities:{canListChildren:true}}));
 assert.equal(accessibleFolders(metadata,mapping),mapping);
 assert.deepEqual(catalogFiles({files:[]},mapping.folders),[]);
 for(const bad of [undefined,null,{}, {error:'not found'}, {...metadata[0],id:'foreign_folder'}, {...metadata[0],mimeType:'image/png'}, {...metadata[0],trashed:true}, {...metadata[0],trashed:undefined}, {...metadata[0],capabilities:{}}, {...metadata[0],capabilities:{canListChildren:false}}]){
  assert.throws(()=>accessibleFolders([bad,metadata[1]],mapping),/FOLDER_UNAVAILABLE/);
  assert.throws(()=>accessibleFolders([metadata[0],bad],mapping),/FOLDER_UNAVAILABLE/);
 }
 assert.throws(()=>accessibleFolders(metadata.slice(0,1),mapping),/FOLDER_UNAVAILABLE/);
 assert.throws(()=>accessibleFolders(metadata.reverse(),mapping),/FOLDER_UNAVAILABLE/);
});
test('compiled catalog routes every sync through folder access checks before listing and storage',()=>{
 const fs=require('fs'),vm=require('vm'),w=JSON.parse(fs.readFileSync('n8n/publishing/file-catalog-workflow.json'));
 const next=(name,port=0)=>w.connections[name]?.main[port]?.map(e=>e.node)||[];
 assert.deepEqual(next('Ordner prüfen'),['Uploadordner lesen']);assert.deepEqual(next('Uploadordner lesen'),['Verarbeitungsordner lesen']);assert.deepEqual(next('Verarbeitungsordner lesen'),['Ordnerzugriff bestätigen']);assert.deepEqual(next('Ordnerzugriff bestätigen'),['Drive-Seite vorbereiten']);assert.deepEqual(next('Ordnerzugriff bestätigen',1),['Dateifehler zuordnen']);
 for(const name of ['Uploadordner lesen','Verarbeitungsordner lesen']){
  const n=w.nodes.find(n=>n.name===name);assert.equal(n.onError,'continueRegularOutput');assert.equal(n.credentials.googleDriveOAuth2Api.id,'VcVRAhAAnk2YcHNE');assert.equal(n.parameters.options.redirect.redirect.followRedirects,false);assert.match(n.parameters.queryParameters.parameters[0].value,/canListChildren/);
 }
 const mapping=verifiedFolders([row],context),data={'Ordner prüfen':mapping,'Uploadordner lesen':{error:'404'},'Verarbeitungsordner lesen':{id:mapping.folders[1],mimeType:'application/vnd.google-apps.folder',trashed:false,capabilities:{canListChildren:true}}};
 const code=w.nodes.find(n=>n.name==='Ordnerzugriff bestätigen').parameters.jsCode;
 const run=()=>vm.runInNewContext('(function(){'+code+'})()',{$:name=>({first:()=>({json:data[name]})})});
 assert.throws(run,/FOLDER_UNAVAILABLE/);
 data['Uploadordner lesen']={id:mapping.folders[0],mimeType:'application/vnd.google-apps.folder',trashed:false,capabilities:{canListChildren:true}};
 assert.equal(run()[0].json.q,mapping.q);
});
test('only verified folder files become catalog entries with stable content/version identity',()=>{const r=catalogFiles({files:[file]},[row.upload_folder_id]);assert.equal(r[0].revision,'md5:'+'a'.repeat(32)+':3');assert.equal(r[0].media_kind,'video');assert.equal(r[0].size_bytes,'1024');});
test('partial listings, foreign parents, duplicates and malformed metadata fail without a partial catalog',()=>{for(const response of [{files:[file],nextPageToken:'next'},{files:[file],incompleteSearch:true},{files:[{...file,parents:['foreign']}]},{files:[file,file]},{files:[{...file,version:undefined}]},{files:[{...file,trashed:true}]},{files:[{...file,name:'bad\nname'}]}])assert.throws(()=>catalogFiles(response,[row.upload_folder_id]));});
const {runCatalog}=require('./fixtures/private-file-catalog.cjs');
const mapping=verifiedFolders([row],context);
const lease={user_id:'own',lease_id:'test-lease'};
const batch=Array.from({length:1000},(_,i)=>({...file,id:'fixture_drive_'+i}));
const lastFile={...file,id:'fixture_drive_1000',name:'Werkstatt Finale.mp4',parents:[mapping.folders[1]]};
async function scan(pages){
 const requests=[],finishes=[];
 const result=await runCatalog({mapping,lease,readPage:query=>{
  assert.equal(query.q,mapping.q);assert.equal(query.pageSize,1000);assert.equal(query.spaces,'drive');
  assert.match(query.fields,/nextPageToken/);
  const page=pages[requests.length];requests.push(query);
  if(page instanceof Error)throw page;
  return page;
 },finish:payload=>{
  finishes.push(payload);assert.equal(payload.p_user_id,lease.user_id);assert.equal(payload.p_lease_id,lease.lease_id);
  return payload.p_error?{ok:false,code:payload.p_error}:{ok:true,count:payload.p_files.length};
 }});
 assert.equal(finishes.length,1);
 return {result,requests,payload:finishes[0]};
}
test('Drive follows opaque tokens after full, short and empty pages and commits once',async()=>{
 const token='a/+=&%b';
 for(const first of [[],batch.slice(0,3),batch]){
  const {requests,payload,result}=await scan([{files:first,nextPageToken:token},{files:[],nextPageToken:'c'},{files:[lastFile]}]);
  assert(!Object.hasOwn(requests[0],'pageToken'));
  assert.deepEqual(requests.map(q=>q.pageToken),[undefined,token,'c']);
  assert.deepEqual(result,{ok:true,count:first.length+1});assert.equal(payload.p_files.at(-1).drive_file_id,lastFile.id);
 }
 assert.deepEqual((await scan([{files:batch}])).result,{ok:true,count:1000});
 assert.deepEqual((await scan([{files:[]}])).result,{ok:true,count:0});
});
test('interrupted, incomplete, malformed and looping continuations send only the lease error',async()=>{
 for(const [tail,code] of [
  [[Error('Drive disconnected')],'FILE_SYNC_UNAVAILABLE'],
  [[{files:[lastFile],incompleteSearch:true}],'FILE_METADATA_INVALID'],
  [[{files:[lastFile],nextPageToken:'again'}],'FILE_METADATA_INVALID'],
  [[{files:[],nextPageToken:'other'},{files:[],nextPageToken:'again'}],'FILE_METADATA_INVALID'],
  [[{files:[lastFile],nextPageToken:17}],'FILE_METADATA_INVALID'],
  [[{files:[lastFile],incompleteSearch:'true'}],'FILE_METADATA_INVALID'],
  [[{files:[{...lastFile,parents:['foreign']}]}],'FILE_METADATA_INVALID'],
  [[{files:[batch[0]]}],'FILE_METADATA_INVALID'],
  [[{files:[...batch,lastFile]}],'FILE_CATALOG_TOO_LARGE']
 ]){
  const {result,requests,payload}=await scan([{files:batch,nextPageToken:'again'},...tail]);
  assert.equal(requests.length,tail.length+1);
  assert.deepEqual(result,{ok:false,code});assert.deepEqual(payload,{p_user_id:lease.user_id,p_lease_id:lease.lease_id,p_error:code});
 }
});
test('a rejected database finish releases the same lease using its error response',async()=>{
 const calls=[];
 const result=await runCatalog({mapping,lease,readPage:()=>({files:[file]}),finish:body=>{
  calls.push(body);
  return {ok:false,code:body.p_error||'FILE_CATALOG_TOO_LARGE'};
 }});
 assert.equal(calls.length,2);assert.equal(calls[0].p_files.length,1);
 assert.deepEqual(calls[1],{p_user_id:lease.user_id,p_lease_id:lease.lease_id,p_error:'FILE_CATALOG_TOO_LARGE'});
 assert.deepEqual(result,{ok:false,code:'FILE_CATALOG_TOO_LARGE'});
});
test('video metadata is extracted without substituting missing dimensions or duration',()=>{
 const get=extra=>catalogFiles({files:[{...file,...extra}]},[row.upload_folder_id])[0];
 const valid=get({videoMediaMetadata:{width:1080,height:1920,durationMillis:'12500',location:'private'}});
 assert.equal(valid.width_px,1080);assert.equal(valid.height_px,1920);assert.equal(valid.duration_ms,12500);assert.ok(!JSON.stringify(valid).includes('private'));
 const absent=get({});assert.equal(absent.width_px,null);assert.equal(absent.height_px,null);assert.equal(absent.duration_ms,null);
 const invalid=get({videoMediaMetadata:{width:'1080',height:-1,durationMillis:'Infinity'}});assert.equal(invalid.width_px,null);assert.equal(invalid.height_px,null);assert.equal(invalid.duration_ms,null);
});
test('image catalog retains only dimensions and never EXIF location or unrelated video duration',()=>{
 const r=catalogFiles({files:[{...file,mimeType:'image/jpeg',imageMediaMetadata:{width:1200,height:800,location:{latitude:48},cameraMake:'private'},videoMediaMetadata:{durationMillis:'5000'}}]},[row.upload_folder_id])[0];
 assert.equal(r.width_px,1200);assert.equal(r.height_px,800);assert.equal(r.duration_ms,null);assert.ok(!JSON.stringify(r).includes('latitude'));assert.ok(!JSON.stringify(r).includes('private'));
});
