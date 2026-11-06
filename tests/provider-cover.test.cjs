const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{readFileSync,mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path'),{execFileSync}=require('node:child_process');
const {coverPlan,withTikTokCover,coverBytes,youtubeCoverRequest,youtubeCoverObservation}=require('../n8n/publishing/provider-cover.cjs');
const id=n=>'ab660000-0000-4000-9000-'+String(n).padStart(12,'0'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=','base64');
const binding={asset_id:id(1),asset_revision:'sha256:'+'a'.repeat(64)+':2'},plan={version:1,export_id:id(3),video_asset_id:id(1),video_revision:binding.asset_revision,asset_id:id(2),asset_revision:'sha256:'+createHash('sha256').update(png).digest('hex')+':2',drive_file_id:'synthetic_cover_file',mime_type:'image/png',size_bytes:png.length,position_ms:1000,duration_ms:3000};
const intent={ok:true,id:id(4),lease_id:id(5),operation:'init',platform:'tiktok',cover:plan,binding},request={method:'POST',url:'https://open.tiktokapis.com/v2/post/publish/video/init/',body_type:'json',body:{post_info:{title:'Saved caption',privacy_level:'SELF_ONLY'},source_info:{source:'FILE_UPLOAD',video_size:2000}}};
test('TikTok cover is injected only into the bound init post_info; saved caption and upload stay intact',()=>{
 const r=withTikTokCover(request,intent);assert.equal(r.body.post_info.video_cover_timestamp_ms,1000);assert.deepEqual(r.body.source_info,request.body.source_info);assert.equal(r.body.post_info.title,'Saved caption');assert.equal(request.body.post_info.video_cover_timestamp_ms,undefined);
 assert.equal(withTikTokCover(request,{...intent,cover:null}),request);assert.equal(withTikTokCover(request,{...intent,operation:'upload'}),request);
 assert.equal(withTikTokCover(request,{...intent,cover:{...plan,position_ms:0}}).body.post_info.video_cover_timestamp_ms,0);
 for(const c of [{position_ms:-1},{position_ms:3000},{duration_ms:0},{position_ms:1.5},{video_asset_id:id(99)},{video_revision:'other'},{asset_id:id(1)},{drive_file_id:'../other'},{size_bytes:24000001}])assert.throws(()=>withTikTokCover(request,{...intent,cover:{...plan,...c}}));
 for(const r of [{...request,url:'https://attacker.invalid'},{...request,body_type:'binary'},{...request,body:{...request.body,source_info:{source:'PULL_FROM_URL'}}}])assert.throws(()=>withTikTokCover(r,intent));
 assert.throws(()=>withTikTokCover(request,{...intent,lease_id:null}));
});
test('YouTube thumbnail uses exactly the reserved video and checksum-verified PNG bytes',()=>{
 const i={...intent,platform:'youtube',operation:'youtube_thumbnail',provider_id:'synthetic_1',target_id:'UC'+'a'.repeat(22),video_state:'complete'};
 const r=youtubeCoverRequest(i,'synthetic-token',png);assert.equal(r.url,'https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=synthetic_1');assert.equal(r.headers['Content-Length'],String(png.length));assert.equal(r.headers['Content-Type'],'image/png');assert.equal(r.body_type,'binary');
 for(const bad of [{video_state:'processing'},{provider_id:'other'},{target_id:'other'},{operation:'init'},{lease_id:null},{ok:false}])assert.throws(()=>youtubeCoverRequest({...i,...bad},'synthetic-token',png));
 assert.throws(()=>youtubeCoverRequest(i,'secret\r\nx: attack',png));assert.throws(()=>coverBytes(Buffer.concat([png,Buffer.from('x')]),plan));const changed=Buffer.from(png);changed[33]^=1;assert.throws(()=>coverBytes(changed,plan));assert.equal(coverBytes(png,plan),true);
});
test('YouTube rejects ambiguous success, preserves unknown writes and never journals provider URLs',()=>{
 const accepted={statusCode:200,body:JSON.stringify({kind:'youtube#thumbnailSetResponse',items:[{default:{url:'https://i.ytimg.com/vi/synthetic_1/default.jpg',width:120,height:90}}]})};
 assert.deepEqual(youtubeCoverObservation(accepted),{state:'complete',code:'COVER_ACCEPTED'});
 for(const r of [{},{statusCode:503,body:'down'},{statusCode:200,body:'{}'},{statusCode:200,body:{kind:'youtube#thumbnailSetResponse',items:[]}},{statusCode:403,body:'not provider JSON'}])assert.equal(youtubeCoverObservation(r).state,'uncertain');
 assert.deepEqual(youtubeCoverObservation({statusCode:403,body:{error:{code:403,message:'SECRET'}}}),{state:'failed',code:'COVER_PERMISSION_REQUIRED'});
 for(const statusCode of [400,401,404,413,429])assert.equal(youtubeCoverObservation({statusCode,body:{error:{code:statusCode}}}).state,'failed');
});
test('portal cover notes distinguish preparation from actual confirmation',async()=>{
 const {exportCoverNote}=await import('../app/assets/publication-export-cover.mjs');
 assert.match(exportCoverNote('youtube'),/nach der Videoverarbeitung/);assert.match(exportCoverNote('youtube'),/erst mit der Portalbestätigung/);
 assert.match(exportCoverNote('tiktok'),/Bildzeitpunkt im fertigen Video/);assert.match(exportCoverNote('instagram'),/noch nicht angebunden/);assert.match(exportCoverNote('facebook'),/noch nicht angebunden/);
});
test('pinned dispatcher patch preserves old result journal and fences every cover HTTP path',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sma-cover-')),out=join(dir,'workflow.json');try{
  execFileSync('python',['n8n/publishing/patch-provider-cover.py','--input','tests/provider-cover-pr57-workflow.json','--output',out],{cwd:join(__dirname,'..')});
  const w=JSON.parse(readFileSync(out)),nodes=Object.fromEntries(w.nodes.map(n=>[n.name,n])),old=JSON.parse(readFileSync(join(__dirname,'provider-cover-pr57-workflow.json')));
  assert.equal(w.nodes.length,47);assert.deepEqual(nodes['Providerergebnis speichern'],old.nodes.find(n=>n.name==='Providerergebnis speichern'));assert.equal(w.settings.saveDataSuccessExecution,'none');assert.equal(w.settings.saveDataErrorExecution,'none');assert.equal(w.settings.saveManualExecutions,false);assert.equal(w.settings.availableInMCP,false);
  assert.match(nodes['Provideranfrage atomar reservieren'].parameters.jsonBody,/provider_begin/);assert.match(nodes['Provideranfrage erstellen'].parameters.jsCode,/withTikTokCover\(providerRequest/);
  for(const n of w.nodes){assert.notEqual(n.retryOnFail,true);if(n.type.endsWith('.code'))assert.doesNotThrow(()=>new (Object.getPrototypeOf(async function(){}).constructor)(n.parameters.jsCode));}
  const predecessors=name=>Object.entries(w.connections).flatMap(([from,e])=>e.main.flatMap((edges,port)=>edges.filter(x=>x.node===name).map(()=>({from,port}))));
  assert.deepEqual(predecessors('YouTube-Cover übertragen'),[{from:'Coveranfrage erstellen',port:0}]);assert.deepEqual(predecessors('Coveranfrage erstellen'),[{from:'Geprüfte Coverdatei übernehmen',port:0}]);assert.deepEqual(predecessors('Geprüfte Coverdatei übernehmen'),[{from:'Coveranfrage reserviert?',port:0}]);
  assert.equal(w.connections['YouTube-Cover übertragen'].main[1][0].node,'Unklare Coverantwort');assert.equal(w.connections['Unklare Coverantwort'].main[0][0].node,'Coverergebnis speichern');
  assert.equal(nodes['YouTube-Cover übertragen'].parameters.options.redirect.redirect.followRedirects,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
