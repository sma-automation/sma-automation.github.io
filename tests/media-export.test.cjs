const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {editorSourceMetadata,editorSourceBytes}=require('../n8n/publishing/editor-source.cjs');
const defaults={format:'original',fit:'contain',position_x:50,position_y:50,start_ms:0,end_ms:null,cover_ms:null,overlay_text:'',overlay_position:'bottom',audio_volume:100};
test('source proxy binds owner folder and actual checksum while allowing Drive metadata indexing',()=>{
 const bytes=Buffer.concat([Buffer.from([0,0,0,12]),Buffer.from('ftypisomfixture')]),hash=crypto.createHash('sha256').update(bytes).digest('hex'),md5=crypto.createHash('md5').update(bytes).digest('hex');
 const context={ok:true,drive_file_id:'fixture-drive',asset_id:'fixture-asset',asset_revision:'sha256:'+hash+':4',mime_type:'video/mp4',media_kind:'video',size_bytes:bytes.length},file={id:context.drive_file_id,mimeType:context.mime_type,size:bytes.length,version:'4',trashed:false,capabilities:{canDownload:true},parents:['folder'],sha256Checksum:hash,md5Checksum:md5};
 const meta=editorSourceMetadata(file,context,['folder']);const result=editorSourceBytes(bytes,context,meta);assert.equal(result.sha256,hash);assert.equal(result.data_base64,bytes.toString('base64'));assert.equal(result.can_publish,false);assert.equal(result.drive_file_id,undefined);
 for(const change of [{id:'wrong'},{parents:['foreign']},{trashed:true},{size:24000001},{capabilities:{canDownload:false}},{mimeType:'video/quicktime'},{sha256Checksum:'a'.repeat(64)}])assert.throws(()=>editorSourceMetadata({...file,...change},context,['folder']));
 assert.deepEqual(editorSourceMetadata({...file,version:'5'},context,['folder']),meta);
 assert.throws(()=>editorSourceMetadata({...file,version:'5'},{...context,asset_revision:'version:4'},['folder']),/FILE_CHANGED/);
 assert.throws(()=>editorSourceBytes(Buffer.alloc(bytes.length),context,meta));assert.throws(()=>editorSourceBytes(bytes,context,{...meta,md5:'a'.repeat(32)}));
 assert.deepEqual(editorSourceMetadata(file,{...context,asset_revision:'md5:'+md5+':4'},['folder']),meta);
});
test('export geometry and fixed filters apply trim, position, original audio and cover offset',async()=>{
 const {exportPlan,exportArguments}=await import('../app/assets/media-export-model.mjs');const f={media_kind:'video',mime_type:'video/mp4',width_px:1920,height_px:1080,duration_ms:10000,size_bytes:100000};
 const p=exportPlan(f,{...defaults,format:'9:16',fit:'cover',position_x:100,start_ms:2000,end_ms:8000,cover_ms:3000,audio_volume:50,overlay_text:"';[in]bad"});assert.equal(p.width,720);assert.equal(p.height,1280);assert.equal(p.cover_ms,1000);assert.equal(p.x,p.scaledWidth-p.width);const a=exportArguments(p,true);assert.match(a[a.indexOf('-filter_complex')+1],/atrim=start=2:duration=6,asetpts=PTS-STARTPTS,volume=0.5/);assert.ok(!a.join(' ').includes('bad'));assert.ok(a.includes('result.mp4'));
 assert.ok(exportArguments({...p,settings:{...p.settings,audio_volume:0}},true).includes('-an'));assert.ok(exportArguments(p,false).includes('-an'));
 for(const change of [{size_bytes:24000001},{duration_ms:60001},{width_px:4097},{height_px:null}])assert.throws(()=>exportPlan({...f,...change},defaults),/EXPORT_UNSUPPORTED/);
 assert.throws(()=>exportPlan(f,{...defaults,start_ms:9000,end_ms:5000}),/INVALID_SETTINGS/);
 const image=exportPlan({...f,media_kind:'image',mime_type:'image/jpeg',duration_ms:null},defaults);assert.ok(exportArguments(image).includes('result.png'));
});
test('probe rejects wrong duration, geometry, extra streams and wrong output codecs',async()=>{
 const {verifyMediaProbe,exportPlan}=await import('../app/assets/media-export-model.mjs'),f={media_kind:'video',mime_type:'video/mp4',width_px:320,height_px:240,duration_ms:3000,size_bytes:1000},p=exportPlan(f,defaults),probe={streams:[{codec_type:'video',codec_name:'h264',pix_fmt:'yuv420p',width:320,height:240},{codec_type:'audio',codec_name:'aac'}],format:{duration:'3'}};
 assert.equal(verifyMediaProbe(probe,f).hasAudio,true);assert.equal(verifyMediaProbe(probe,f,{outputPlan:p,hasAudio:true}).width,320);
 assert.throws(()=>verifyMediaProbe({...probe,format:{duration:'5'}},f));assert.throws(()=>verifyMediaProbe({...probe,streams:[...probe.streams,probe.streams[0]]},f));assert.throws(()=>verifyMediaProbe(probe,{...f,width_px:1280}));assert.throws(()=>verifyMediaProbe(probe,f,{outputPlan:p,hasAudio:false}));
});
test('workflow proxy is read-only, uses existing folder gates, and retains no execution data',()=>{
 const w=JSON.parse(fs.readFileSync('n8n/publishing/editor-source-workflow.json','utf8'));assert.equal(w.active,false);assert.equal(w.settings.saveDataSuccessExecution,'none');assert.equal(w.settings.saveDataErrorExecution,'none');assert.equal(w.settings.saveManualExecutions,false);assert.equal(w.nodes.filter(n=>n.type==='n8n-nodes-base.webhook').length,1);
 for(const n of w.nodes.filter(n=>n.type==='n8n-nodes-base.httpRequest'&&n.parameters.nodeCredentialType==='googleDriveOAuth2Api'))assert.equal(n.parameters.method||'GET','GET');
 assert.equal(w.nodes.filter(n=>n.name==='Eigentümer erneut prüfen').length,1);assert.equal(w.nodes.filter(n=>n.name==='Unveränderte Quelle bestätigen').length,1);
 assert.equal(fs.readFileSync('supabase/sql/publication-editor-exports.sql','utf8'),fs.readFileSync('supabase/migrations/20261106165123_publication_editor_exports_v1.sql','utf8'));
});
test('embedded binary reader runs with n8n global helpers and no bound this',async()=>{
 const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(12)]),hash=crypto.createHash('sha256').update(bytes).digest('hex');
 const context={ok:true,asset_id:'own-asset',asset_revision:'sha256:'+hash+':3',mime_type:'image/png',media_kind:'image'};
 const code=JSON.parse(fs.readFileSync('n8n/publishing/editor-source-workflow.json','utf8')).nodes.find(n=>n.name==='Originalbytes prüfen').parameters.jsCode;
 const sandbox={require,Buffer,helpers:{getBinaryDataBuffer:async(index,key)=>{assert.equal(index,0);assert.equal(key,'data');return bytes;}},$:(name)=>({first:()=>({json:name==='Eigene Datei prüfen'?context:{sha256:hash,md5:null,size_bytes:bytes.length}})})};
 const run=require('node:vm').runInNewContext('(async function(){'+code+'\n})()',sandbox);
 const result=await run;assert.equal(result[0].json.sha256,hash);assert.equal(result[0].json.data_base64,bytes.toString('base64'));assert.equal(result[0].json.can_publish,false);
});
