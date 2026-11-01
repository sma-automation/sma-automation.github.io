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
 assert.deepEqual(next('Ordner prüfen'),['Uploadordner lesen']);assert.deepEqual(next('Uploadordner lesen'),['Verarbeitungsordner lesen']);assert.deepEqual(next('Verarbeitungsordner lesen'),['Ordnerzugriff bestätigen']);assert.deepEqual(next('Ordnerzugriff bestätigen'),['Dateimetadaten aus Drive lesen']);assert.deepEqual(next('Ordnerzugriff bestätigen',1),['Dateifehler zuordnen']);
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
