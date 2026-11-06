const test=require('node:test'),assert=require('node:assert/strict');
const m={name:'Musik.wav',sha256:'a'.repeat(64),size_bytes:1000,mime_type:'audio/wav',volume:25,start_ms:500};
test('music recipes preserve old drafts and reject invalid or image recipes',async()=>{
 const {readEditorSettings,editorDefaults:d}=await import('../app/assets/media-editor-model.mjs');assert.deepEqual(readEditorSettings(d),d);assert.deepEqual(readEditorSettings({...d,music:m}).music,m);
 for(const bad of [null,{...m,volume:101},{...m,start_ms:600000},{...m,size_bytes:8000001},{...m,sha256:'bad'},{...m,name:'x\n'},{...m,extra:1},{...m,mime_type:'audio/ogg'}])assert.throws(()=>readEditorSettings({...d,music:bad}));
 assert.throws(()=>readEditorSettings({...d,music:m},{media_kind:'image'}));
});
test('music bytes bind saved recipe and probe excludes unsupported audio',async()=>{
 const {inspectMusic,verifyMusicBytes,verifyMusicProbe}=await import('../app/assets/media-music-model.mjs');const f=new File([Buffer.from('RIFFabcdWAVE1234')],'tone.wav');const setting=await inspectMusic(f);assert.equal(setting.mime_type,'audio/wav');assert.equal(await verifyMusicBytes(f,setting),f);await assert.rejects(()=>verifyMusicBytes(new Blob(['different']),setting),/MUSIC_REQUIRED/);
 const p={streams:[{codec_type:'audio',codec_name:'pcm_s16le',channels:1,sample_rate:'44100'}],format:{duration:'2'}};assert.equal(verifyMusicProbe(p,setting).duration_ms,2000);
 for(const bad of [{...p,format:{duration:'601'}},{...p,streams:[...p.streams,...p.streams]},{...p,streams:[{...p.streams[0],channels:6}]},{...p,streams:[...p.streams,{codec_type:'video'}]}])assert.throws(()=>verifyMusicProbe(bad,setting));assert.throws(()=>verifyMusicProbe(p,{...setting,start_ms:2000}));
});
test('music mixes fixed filters with original audio and supports music-only or muted export',async()=>{
 const {exportPlan,exportArguments,verifyMediaProbe}=await import('../app/assets/media-export-model.mjs'),{editorDefaults:d}=await import('../app/assets/media-editor-model.mjs'),f={media_kind:'video',mime_type:'video/mp4',width_px:320,height_px:240,duration_ms:3000,size_bytes:1000};
 const p=exportPlan(f,{...d,music:m});let a=exportArguments(p,true),filter=a[a.indexOf('-filter_complex')+1];assert.match(filter,/amix=inputs=2:duration=longest:normalize=0/);assert.match(filter,/\[2:a:0\]atrim=start=0.5:duration=3/);assert.match(filter,/volume=0.25,apad/);assert.ok(a.includes('music'));
 a=exportArguments(p,false);assert.ok(a.includes('[music]'));assert.ok(!a.includes('-an'));assert.ok(exportArguments(exportPlan(f,{...d,audio_volume:0,music:{...m,volume:0}}),true).includes('-an'));
 const probe={streams:[{codec_type:'video',codec_name:'h264',pix_fmt:'yuv420p',width:320,height:240},{codec_type:'audio',codec_name:'aac'}],format:{duration:'3'}};assert.doesNotThrow(()=>verifyMediaProbe(probe,f,{outputPlan:p,hasAudio:false}));
});
test('cover lookup validates exact selected export and never accepts foreign response',async()=>{
 const {readExportCover}=await import('../app/assets/publication-export-cover.mjs');const f={id:'ab660000-0000-4000-9000-000000000001',revision:'r1'},r={ok:true,version:1,can_publish:false,asset_id:f.id,asset_revision:f.revision,cover:{asset_id:'ab660000-0000-4000-9000-000000000002',asset_revision:'sha256:'+'a'.repeat(64)+':2',name:'Cover.png',position_ms:1000}};
 assert.equal(readExportCover(r,f).media_kind,'image');assert.equal(readExportCover({...r,cover:null},f),null);for(const bad of [{...r,asset_id:r.cover.asset_id},{...r,asset_revision:'r2'},{...r,can_publish:true},{...r,cover:{...r.cover,position_ms:-1}}])assert.throws(()=>readExportCover(bad,f));
});
