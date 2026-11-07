const test=require('node:test'), assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const fs=require('node:fs');
const {inspectVideo,soundtrackMP4}=require('../n8n/publishing/gallery-soundtrack.cjs');
const fixture=require('../n8n/publishing/fixtures/gallery-music-probe.json');
const video=Buffer.from(fixture.video,'base64'),audio=Buffer.from(fixture.audio,'base64');
test('n8n renders the deterministic one-second clip, preserves media bytes and skips the generated audio',()=>{
 const result=soundtrackMP4(video,audio);
 assert.equal(result.state,'rendered');assert.equal(createHash('sha256').update(result.bytes).digest('hex'),fixture.expected);
 const mdat=video.indexOf(Buffer.from('mdat'));assert.ok(mdat>4);
 const end=mdat-4+video.readUInt32BE(mdat-4);
 assert.deepEqual(result.bytes.subarray(mdat,end),video.subarray(mdat,end));
 assert.equal(soundtrackMP4(result.bytes,null).state,'audio_present');
});
test('rejects truncated MP4, external data references, fragments, and truncated or unrecognised music',()=>{
 for(const at of [7,21,100,video.length-1])assert.throws(()=>inspectVideo(video.subarray(0,at)),/UNSUPPORTED/);
 const external=Buffer.from(video);const ref=external.indexOf(Buffer.from('url '));assert.ok(ref>4);external[ref+7]=0;
 assert.throws(()=>inspectVideo(external),/UNSUPPORTED/);
 assert.throws(()=>inspectVideo(Buffer.concat([video,Buffer.from([0,0,0,8,109,111,111,102])])),/UNSUPPORTED/);
 for(const bad of [Buffer.alloc(0),audio.subarray(0,100),Buffer.alloc(audio.length)])assert.throws(()=>soundtrackMP4(video,bad),/UNSUPPORTED/);
});
test('all production workflow edges resolve and both trigger branches have a bounded execution path',()=>{
 const w=JSON.parse(fs.readFileSync('n8n/publishing/gallery-soundtrack-workflow.json'));
 const names=new Set(w.nodes.map(n=>n.name));assert.equal(names.size,w.nodes.length);
 for(const [src,ports] of Object.entries(w.connections)){
  assert.ok(names.has(src));for(const slot of ports.main)for(const {node} of slot)assert.ok(names.has(node),node);
 }
 for(const n of w.nodes.filter(n=>n.type.endsWith('.code')))assert.doesNotThrow(()=>new (Object.getPrototypeOf(async function(){}).constructor)(n.parameters.jsCode),n.name);
 const allowed=['n8n-nodes-base.code','n8n-nodes-base.httpRequest','n8n-nodes-base.if','n8n-nodes-base.manualTrigger','n8n-nodes-base.dataTable','n8n-nodes-base.webhook'];
 assert.ok(w.nodes.every(n=>allowed.includes(n.type)));
 assert.ok(w.connections['Auftrag verfügbar?'].main.length===1);
 assert.equal(w.connections['Synthetischer Prüflauf?'].main[0][0].node,'Testmusik und Videospur prüfen');
});
