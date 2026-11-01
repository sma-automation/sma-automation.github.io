const {test}=require('node:test');const assert=require('node:assert/strict');const {verifiedFolders,catalogFiles}=require('../n8n/publishing/file-catalog.cjs');
const context={ok:true,n8n_kunde_id:'kunde_test',kunde_email:'test@example.com'};
const row={kunde_id:'kunde_test',kunde_email:'test@example.com',zugang_aktiv:true,demo_delta_aktiv:true,upload_folder_id:'upload_folder_123',processing_folder_id:'processing_folder_456'};
const file={id:'drive_file_123456',name:'Testvideo.mp4',mimeType:'video/mp4',parents:[row.upload_folder_id],version:'3',modifiedTime:'2026-11-01T10:00:00Z',size:'1024',md5Checksum:'a'.repeat(32)};
test('folder resolution rejects other customers, duplicate mappings and query injection',()=>{assert.equal(verifiedFolders([row],context).folders.length,2);for(const rows of [[{...row,kunde_id:'foreign'}],[row,row],[{...row,upload_folder_id:"abc' or trashed=false"}],[{...row,zugang_aktiv:false}]])assert.throws(()=>verifiedFolders(rows,context),/FOLDER_UNAVAILABLE/);});
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
