const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const vm=require('vm');
const {CATEGORIES,normalizeFrames}=require('../n8n/publishing/content-review.cjs');
const {POLICY,FIELDS,providerCapability,prepareReview,normalizeSightengine,completeReview}=require('../n8n/publishing/review-providers.cjs');
const {buildLocalRequest,normalizeLocalResponse}=require('../n8n/publishing/self-hosted-review.cjs');
const hash='a'.repeat(64),lease='fa330000-0000-4000-8000-000000000001';
const profile={policy_version:'local-fixture-v1',model_revision:'fixture-only@1'};
const context={lease_id:lease,review:{policy_version:profile.policy_version},asset_revision:'sha256:'+hash+':1',media_kind:'image',mime_type:'image/png',size_bytes:100,duration_ms:null};
const cleanFrame={position_ms:0,scores:Object.fromEntries(CATEGORIES.map(c=>[c,.01]))};
function sightengineFrame(){const f={};for(const paths of Object.values(FIELDS))for(const path of paths){const keys=path.split('.');let o=f;for(const k of keys.slice(0,-1))o=o[k]??={};o[keys.at(-1)]=.01;}return f;}
const cleanProvider={status:'success',...sightengineFrame()};
function localResponse(request){const {schema,request_id,content_sha256,policy_version,model_revision,media_kind,sampling_ms}=request;return {schema,request_id,content_sha256,policy_version,model_revision,media_kind,sampling_ms,frames:[structuredClone(cleanFrame)]};}

test('production provider is fixed; an unavailable provider or video cannot silently fall back',()=>{
 assert.equal(providerCapability('sightengine','image').available,true);
 assert.deepEqual(providerCapability('sightengine','video'),{available:false,code:'VIDEO_PLAN_REQUIRED'});
 for(const name of ['self_hosted','',null,'https://external.invalid'])assert.throws(()=>providerCapability(name,'image'),/PROVIDER_FAILED/);
 const job=prepareReview({...context,provider:'self_hosted',url:'https://external.invalid',review:{policy_version:POLICY}},hash);
 assert.equal(job.provider,'sightengine');assert.equal(job.url,undefined);assert.equal(job.lease_id,undefined);
 assert.deepEqual(completeReview(cleanProvider,job),normalizeSightengine(cleanProvider,'image'));
 assert.throws(()=>prepareReview({...context,review:{policy_version:POLICY},media_kind:'video'},hash),/VIDEO_PLAN_REQUIRED/);
 assert.throws(()=>prepareReview(context,hash),/INCOMPLETE/);
 assert.throws(()=>completeReview(cleanProvider,{...job,policy_version:'local-fixture-v1'}),/INCOMPLETE/);
 assert.throws(()=>completeReview(cleanProvider,{...job,provider:'self_hosted'}),/PROVIDER_FAILED/);
});

test('generic evaluation requires every category and enforces frame coverage independently of provider',()=>{
 assert.equal(normalizeFrames([cleanFrame],'image',null,'fixture-v1').outcome,'clear');
 for(const category of CATEGORIES)for(const bad of [undefined,null,'0',NaN,Infinity,-.1,1.1]){
  const f=structuredClone(cleanFrame);f.scores[category]=bad;
  assert.throws(()=>normalizeFrames([f],'image',null,'fixture-v1'),/INCOMPLETE/);
 }
 for(const frames of [[],[null],[{...cleanFrame,position_ms:1}],[cleanFrame,cleanFrame]])assert.throws(()=>normalizeFrames(frames,'image',null,'fixture-v1'),/INCOMPLETE/);
 const frames=[0,1000,2000].map(position_ms=>({...cleanFrame,position_ms}));
 assert.equal(normalizeFrames(frames,'video',2800,'fixture-v1').frames_checked,3);
 for(const values of [frames.slice(1),frames.slice(0,1),[frames[0],frames[2]],[frames[0],frames[0]]])assert.throws(()=>normalizeFrames(values,'video',2800,'fixture-v1'),/INCOMPLETE/);
 assert.throws(()=>normalizeFrames([cleanFrame],'unknown',null,'fixture-v1'),/UNSUPPORTED/);
});

test('Sightengine mapping preserves category order, all subfields and the 0.35 threshold',()=>{
 for(const [category,paths] of Object.entries(FIELDS))for(const path of paths)for(const score of [.3499,.35,1]){
  const raw=structuredClone(cleanProvider);let o=raw;const keys=path.split('.');for(const k of keys.slice(0,-1))o=o[k];o[keys.at(-1)]=score;
  const result=normalizeSightengine(raw,'image');
  assert.deepEqual(result,{policy_version:POLICY,outcome:score<.35?'clear':'needs_review',categories:score<.35?[]:[category],frames_checked:1,sampling_ms:0,can_publish:false});
 }
});

test('local protocol carries only explicit file/job metadata and uses a distinct cache policy',()=>{
 const request=buildLocalRequest({...context,kunde_email:'private@example.invalid',drive_file_id:'private',auth:'secret',url:'https://external.invalid'},hash,profile);
 assert.deepEqual(Object.keys(request).sort(),['schema','request_id','content_sha256','policy_version','model_revision','media_kind','mime_type','size_bytes','duration_ms','sampling_ms','required_categories'].sort());
 assert.deepEqual(request.required_categories,CATEGORIES);
 assert.equal(normalizeLocalResponse(localResponse(request),request,profile).policy_version,profile.policy_version);
 assert.throws(()=>buildLocalRequest(context,hash,{...profile,policy_version:POLICY}),/INCOMPLETE/);
 assert.throws(()=>buildLocalRequest(context,'b'.repeat(64),profile),/FILE_CHANGED/);
 assert.throws(()=>buildLocalRequest({...context,lease_id:'invalid'},hash,profile),/INCOMPLETE/);
});

test('local response must match job, exact content, policy, model, kind and sampling',()=>{
 const request=buildLocalRequest(context,hash,profile);
 for(const key of ['schema','request_id','content_sha256','policy_version','model_revision','media_kind','sampling_ms']){
  const wrong=localResponse(request);wrong[key]='different';assert.throws(()=>normalizeLocalResponse(wrong,request,profile),/INCOMPLETE/);
  delete wrong[key];assert.throws(()=>normalizeLocalResponse(wrong,request,profile),/INCOMPLETE/);
 }
 assert.throws(()=>normalizeLocalResponse(localResponse(request),request,{...profile,model_revision:'changed@2'}),/INCOMPLETE/);
});

test('partial local model coverage and claimed approval never turn into a clean result',()=>{
 const request=buildLocalRequest(context,hash,profile),response=localResponse(request);
 response.can_publish=true;response.outcome='clear';response.frames[0].scores.weapons=.6;
 const result=normalizeLocalResponse(response,request,profile);assert.equal(result.can_publish,false);assert.equal(result.outcome,'needs_review');assert.deepEqual(result.categories,['weapons']);
 delete response.frames[0].scores.hate;assert.throws(()=>normalizeLocalResponse(response,request,profile),/INCOMPLETE/);
 assert.throws(()=>normalizeLocalResponse({...response,frames:[]},request,profile),/INCOMPLETE/);
});

test('compiled n8n nodes execute the adapter contract with verified bytes and reservation policy',async()=>{
 const workflow=JSON.parse(fs.readFileSync('n8n/publishing/content-review-workflow.json'));
 const source=name=>workflow.nodes.find(n=>n.name===name).parameters.jsCode;
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
 const sha=require('crypto').createHash('sha256').update(png).digest('hex');
 const f={...context,revision:'sha256:'+sha+':1',size_bytes:png.length};
 const reserved={...f,review:{policy_version:POLICY}},binary={data:{id:'n8n-binary-fixture'}};
 const binding=vm.runInNewContext('(async function(){'+source('Dateiinhalt binden')+'})',{require,$input:{first:()=>({binary})},$:(name)=>({first:()=>({json:name==='Dateistand prüfen'?f:reserved})})});
 const [bound]=await binding.call({helpers:{getBinaryDataBuffer:async()=>png}});
 assert.equal(bound.json.sha256,sha);assert.equal(bound.json.provider,'sightengine');assert.equal(bound.binary,binary);
 const evaluate=vm.runInNewContext('(async function(){'+source('Prüfergebnis auswerten')+'})',{$input:{first:()=>({json:cleanProvider})},$:()=>({first:()=>bound})});
 const [result]=await evaluate();assert.equal(result.json.result.outcome,'clear');assert.equal(result.json.result.can_publish,false);assert.equal(result.json.sha256,sha);
 reserved.review.policy_version='local-fixture-v1';await assert.rejects(()=>binding.call({helpers:{getBinaryDataBuffer:async()=>png}}),/INCOMPLETE/);
});
