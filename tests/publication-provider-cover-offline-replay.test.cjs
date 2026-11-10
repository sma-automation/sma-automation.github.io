'use strict';
// Synthetic offline replay of the generated 47-node provider + cover copy.
// No provider HTTP, no n8n API, no customer media or credentials.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sma-cover-offline-'));
let workflow;
try{
 const file=path.join(dir,'cover.json');
 execFileSync('python',['n8n/publishing/patch-provider-cover.py','--input',
   'tests/provider-cover-pr57-workflow.json','--output',file],{cwd:root,timeout:15000});
 workflow=JSON.parse(fs.readFileSync(file,'utf8'));
}finally{
 fs.rmSync(dir,{recursive:true,force:true});
}
const nodes=new Map(workflow.nodes.map(n=>[n.name,n]));
assert.equal(nodes.size,47,'Generated workflow must retain every unique node');

function run(name,{json={},lookups={},data=null}={}){
 const node=nodes.get(name);
 assert.equal(node?.type,'n8n-nodes-base.code','Code node not present: '+name);
 const sandbox={
  Buffer,URL,Date,$json:json,
  require:moduleName=>{
   assert.equal(moduleName,'crypto','Offline test must not load network packages');
   return crypto;
  },
  $:nodeName=>{
   if(!Object.hasOwn(lookups,nodeName))throw Error('UNEXPECTED_NODE_LOOKUP');
   return {first:()=>lookups[nodeName]};
  },
  $input:{first:()=>({json,binary:{data:'SYNTHETIC_IN_MEMORY'}})}
 };
 const fn=vm.runInNewContext('(async function(){\n'+node.parameters.jsCode+'\n})',sandbox,{timeout:4000});
 return fn.call({helpers:{getBinaryDataBuffer:async()=>data}}).then(items=>{
  assert.equal(items.length,1);
  return JSON.parse(JSON.stringify(items[0].json));
 });
}
const id=n=>'ab660000-0000-4000-9000-'+String(n).padStart(12,'0');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=','base64');
const videoRevision='sha256:'+'a'.repeat(64)+':2';
const binding={platform:'youtube',media_kind:'video',asset_id:id(1),asset_revision:videoRevision};
const cover={
 version:1,export_id:id(3),video_asset_id:id(1),video_revision:videoRevision,
 asset_id:id(2),asset_revision:'sha256:'+crypto.createHash('sha256').update(png).digest('hex')+':2',
 drive_file_id:'synthetic_cover_1234',mime_type:'image/png',
 size_bytes:png.length,position_ms:1000,duration_ms:3000
};
const token='synthetic-offline-token-123';
const youtubeIntent={
 ok:true,id:id(4),lease_id:id(5),operation:'youtube_thumbnail',
 platform:'youtube',binding,cover,provider_id:'synthetic_1',
 target_id:'UC'+'a'.repeat(22),video_state:'complete'
};
const tiktokIntent={
 ok:true,id:id(4),lease_id:id(5),sequence:1,operation:'init',
 platform:'tiktok',size_bytes:1347227,
 binding:{...binding,platform:'tiktok'},draft:{title:'Synthetisches Demo',caption:'Gespeicherter Testtext ohne Real-Posting.'},
 choices:{visibility:'SELF_ONLY',disable_comment:true,disable_duet:true,disable_stitch:true,
  brand_content_toggle:false,brand_organic_toggle:false,is_aigc:true},
 cover
};
function refs(intent){
 return {'Provideranfrage atomar reservieren':{json:intent},
  'Coveranfrage reservieren':{json:intent},
  'Providerverbindung bestätigen':{json:{token}}};
}

test('generated cover copy stays internal with one upload node and no retry or redirects',()=>{
 assert.equal(workflow.nodes.filter(n=>n.type==='n8n-nodes-base.executeWorkflowTrigger').length,1);
 assert.equal(workflow.nodes.some(n=>/webhook|scheduleTrigger|cron/i.test(n.type)),false);
 const upload=nodes.get('YouTube-Cover übertragen');
 assert.equal(upload.type,'n8n-nodes-base.httpRequest');
 assert.notEqual(upload.retryOnFail,true);
 assert.equal(upload.parameters.options.redirect.redirect.followRedirects,false);
 const finish=nodes.get('Coverergebnis speichern');
 assert.match(finish.parameters.jsonBody,/p_action:'cover_finish'/);
 assert.match(finish.parameters.jsonBody,/p_lease:/);
});

test('actual n8n TikTok init node inserts only the reserved cover timestamp',async()=>{
 const result=await run('Provideranfrage erstellen',{lookups:refs(tiktokIntent)});
 assert.equal(result.request.url,'https://open.tiktokapis.com/v2/post/publish/video/init/');
 assert.equal(result.request.body.post_info.video_cover_timestamp_ms,1000);
 assert.equal(result.request.body.post_info.privacy_level,'SELF_ONLY');
 assert.equal(result.request.body.post_info.title,tiktokIntent.draft.caption);
 assert.equal(result.request.body.post_info.is_aigc,true);
 assert.equal(result.request.body.source_info.source,'FILE_UPLOAD');
 const noCover=await run('Provideranfrage erstellen',{lookups:refs({...tiktokIntent,cover:null})});
 assert.equal(noCover.request.body.post_info.video_cover_timestamp_ms,undefined);
 const notAi=await run('Provideranfrage erstellen',{lookups:refs({...tiktokIntent,choices:{...tiktokIntent.choices,is_aigc:false}})});
 assert.equal(notAi.request.body.post_info.is_aigc,false);
 for(const invalid of [undefined,null,'true',0]){
  const choices={...tiktokIntent.choices};if(invalid===undefined)delete choices.is_aigc;else choices.is_aigc=invalid;
  await assert.rejects(run('Provideranfrage erstellen',{lookups:refs({...tiktokIntent,choices})}),/INVALID_CHOICES/);
 }
 await assert.rejects(run('Provideranfrage erstellen',{lookups:refs({...tiktokIntent,cover:{...cover,video_asset_id:id(99)}})}),/COVER_BINDING_INVALID/);
});

test('actual n8n YouTube cover request uses only validated PNG and bound video ID',async()=>{
 const r=await run('Coveranfrage erstellen',{lookups:refs(youtubeIntent),data:png});
 assert.equal(r.request.method,'POST');
 assert.equal(r.request.url,'https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=synthetic_1');
 assert.equal(r.request.headers['Content-Type'],'image/png');
 assert.equal(r.request.headers['Content-Length'],String(png.length));
 assert.equal(r.request.headers.Authorization,'Bearer '+token);
 assert.equal(r.request.body_type,'binary');
 const tampered=Buffer.from(png);tampered[33]^=1;
 await assert.rejects(run('Coveranfrage erstellen',{lookups:refs(youtubeIntent),data:tampered}),/COVER_BYTES_CHANGED/);
 await assert.rejects(run('Coveranfrage erstellen',{lookups:refs({...youtubeIntent,provider_id:'wrong'}) ,data:png}),/COVER_INTENT_INVALID/);
});

test('provider cover success is not public video success and remains distinct',async()=>{
 const raw={statusCode:200,body:JSON.stringify({kind:'youtube#thumbnailSetResponse',
  items:[{default:{url:'https://i.ytimg.com/vi/synthetic_1/default.jpg',width:120,height:90}}]})};
 const r=await run('Coverantwort auswerten',{json:raw});
 assert.deepEqual(r,{state:'complete',code:'COVER_ACCEPTED'});
 const summary=await run('Coverstatus zurückgeben',{json:{ok:true,cover_state:r.state}});
 assert.deepEqual(summary,{ok:true,state:'complete',cover_state:'complete',can_upload:false,can_publish:false});
 assert.equal(Object.hasOwn(summary,'publicly_available'),false);
});

test('lost or contradictory cover finish cannot be reported as confirmed',async()=>{
 for(const response of [
  {ok:false,code:'INVALID_LEASE',cover_state:'complete'},
  {ok:false,cover_state:'failed'},
  {ok:true,cover_state:'COMPLETE'},
  {ok:true,cover_state:null},
  {}
 ]){
  const status=await run('Coverstatus zurückgeben',{json:response});
  assert.equal(status.ok,false);
  assert.equal(status.cover_state,'uncertain');
  assert.equal(status.can_upload,false);
  assert.equal(status.can_publish,false);
 }
 for(const coverState of ['failed','uncertain']){
  const r=await run('Coverstatus zurückgeben',{json:{ok:true,cover_state:coverState}});
  assert.equal(r.ok,true);
  assert.equal(r.cover_state,coverState);
  assert.equal(r.can_publish,false);
 }
});

test('ambiguous provider responses never silently become successful covers',async()=>{
 for(const json of [
  {statusCode:503,body:'{"secret":"DO_NOT_EXPOSE"}'},
  {statusCode:200,body:'{}'},
  {statusCode:302,headers:{location:'https://attacker.invalid'}},
  {statusCode:403,body:'provider error'}
 ]){
  const observed=await run('Coverantwort auswerten',{json});
  assert.equal(observed.state,'uncertain');
  assert.equal(observed.code,'COVER_RESPONSE_UNCERTAIN');
  assert.doesNotMatch(JSON.stringify(observed),/DO_NOT_EXPOSE|attacker/);
 }
 const rejected=await run('Coverantwort auswerten',{json:{
  statusCode:403,body:{error:{code:403,message:'DO_NOT_EXPOSE'}}
 }});
 assert.deepEqual(rejected,{state:'failed',code:'COVER_PERMISSION_REQUIRED'});
});
