const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {requireHandoffRequest,handoffRpcInput,makeHandoff}=require('../n8n/publishing/publisher-handoff.cjs');
const now=Date.parse('2026-11-03T12:00:00Z');
const selection={version:1,customer_id:1,drive_file_id:'synthetic_drive_file',asset_id:'00000000-0000-4000-8000-000000000001',asset_revision:'sha256:'+'a'.repeat(64)+':9',platform:'youtube',assignment_revision:3,preview_id:'00000000-0000-4000-8000-000000000002',preview_revision:1,shop_url:'https://sma-automation.com/app/shop.html?shop=synthetic-test',media_kind:'video'};
function stored(p='youtube',language='de') {
 const body='Ein rotes Teil liegt neben einer Tasche.\n\nDie Aufnahme zeigt beide Gegenstände.';
 const hashtags=['Überblick','Video'];
 return {ok:true,can_publish:false,...Object.fromEntries(['asset_id','asset_revision','assignment_revision','preview_id','preview_revision','shop_url','media_kind'].map(k=>[k,selection[k]])),platform:p,
  text:{platform:p,title:'Rotes Teil und Tasche',body,hashtags,review_notes:[],caption:body+'\n\n#Überblick #Video\n\n'+(language==='de'?'🛒 Zum Shop: ':'🛒 Visit our shop: ')+selection.shop_url},
  media_check:{asset_id:selection.asset_id,asset_revision:selection.asset_revision,verified_at:new Date(now-60000).toISOString(),can_publish:false,status:'needs_review',checks:[{code:'FILE_SIZE',status:'pass'},{code:'CONTENT_REVIEW_PENDING',status:'pending'}]}};
}
const run=(response=stored(),input=selection,clock=now)=>makeHandoff(response,input,clock);

test('all four channels preserve saved Unicode, paragraphs, tags and shop exactly',()=>{
 for(const platform of ['youtube','instagram','facebook','tiktok'])for(const language of ['de','en']) {
  const response=stored(platform,language),result=run(response,{...selection,platform});
  assert.equal(result.ok,true);assert.equal(result.can_publish,false);assert.equal(result.can_upload,false);
  assert.deepEqual(result.draft,response.text);assert.equal(result.draft.caption.split(selection.shop_url).length,2);
  assert.deepEqual(result.binding,{...selection,platform});
  result.draft.hashtags.push('extra');assert.equal(response.text.hashtags.length,2);
 }
});
test('a stale selected identity or revision never silently adopts the newer saved assignment',()=>{
 for(const [field,value] of Object.entries({asset_id:'00000000-0000-4000-8000-000000000003',asset_revision:'version:10',platform:'instagram',assignment_revision:4,preview_id:'00000000-0000-4000-8000-000000000004',preview_revision:2,shop_url:'https://sma-automation.com/app/shop.html?shop=changed',media_kind:'image'})) {
  const result=run({...stored(),[field]:value});assert.equal(result.code,'HANDOFF_CHANGED',field);assert.ok(!result.draft);
 }
});
test('only exact internal selection fields enter the service-role RPC',()=>{
 assert.deepEqual(handoffRpcInput(selection),{p_customer_id:1,p_drive_file_id:'synthetic_drive_file',p_asset_revision:selection.asset_revision,p_platform:'youtube'});
 for(const patch of [{version:2},{customer_id:'1'},{customer_id:0},{customer_id:Number.MAX_SAFE_INTEGER+1},{preview_revision:0},{assignment_revision:1.5},{drive_file_id:'../foreign'},{asset_id:'not-uuid'},{asset_revision:'sha256:bad:1'},{platform:'all'},{shop_url:selection.shop_url+'&other=1'},{media_kind:'audio'},{caption:'override'},{authorization:'Bearer secret'},{can_publish:true}])assert.throws(()=>requireHandoffRequest({...selection,...patch}),/INVALID_HANDOFF_INPUT/);
 for(const value of [null,[],{}])assert.throws(()=>requireHandoffRequest(value),/INVALID_HANDOFF_INPUT/);
});
test('access failures and malformed provider responses cannot expose drafts or raw errors',()=>{
 for(const code of ['ACCESS_INACTIVE','FILE_UNAVAILABLE','FILE_CHANGED','ASSIGNMENT_UNAVAILABLE','ASSIGNMENT_CHANGED']) {
  const result=run({ok:false,code,text:stored().text});assert.equal(result.code,code);assert.ok(!result.draft);
 }
 for(const raw of [null,[],{error:{message:'secret'}},{ok:false,code:'private response text'},[{...stored()}],{...stored(),can_publish:true}])assert.deepEqual(run(raw),{ok:false,stage:'handoff_preview',can_publish:false,can_upload:false,code:'HANDOFF_UNAVAILABLE'});
});
test('null, stale and future verification times fail closed; no timestamp refresh is invented',()=>{
 for(const value of [null,undefined,'bad',new Date(now-900000).toISOString(),new Date(now+60001).toISOString()]) {
  const response=stored();response.media_check.verified_at=value;assert.equal(run(response).code,'FILE_REFRESH_REQUIRED');
 }
 assert.equal(run(stored(),selection,NaN).code,'FILE_REFRESH_REQUIRED');
});
test('missing, foreign or malformed media evidence never becomes a passed check',()=>{
 for(const patch of [{asset_id:'foreign'},{asset_revision:'version:1'},{can_publish:true},{status:'passed'},{checks:[]},{checks:[{code:'FILE_SIZE',status:'unknown'}]}]) {
  const response=stored();Object.assign(response.media_check,patch);assert.equal(run(response).code,'MEDIA_CHECK_UNAVAILABLE');
 }
});
test('missing text, duplicated footers, hidden links and modified captions are rejected without fallback',()=>{
 for(const patch of [{title:''},{body:''},{caption:''},{platform:'facebook'},{hashtags:['x','X']},{caption:stored().text.caption+'\n'+selection.shop_url},{caption:stored().text.caption+' '},{body:stored().text.body+' https://foreign.example'},{review_notes:['\u202eunsafe']}]) {
  const response=stored();Object.assign(response.text,patch);assert.equal(run(response).code,'SAVED_TEXT_INVALID');
 }
 const response=stored();delete response.text;assert.equal(run(response).code,'SAVED_TEXT_INVALID');
});
test('media failures and internal text notes remain blockers outside the public caption',()=>{
 const response=stored();response.media_check.status='needs_changes';response.media_check.checks.push({code:'YOUTUBE_DURATION',status:'fail'});response.text.review_notes=['Eine Produktangabe muss bestätigt werden.'];
 const result=run(response);assert.equal(result.ok,true);assert.equal(result.can_upload,false);assert.equal(result.can_publish,false);
 for(const blocker of ['DRIVE_RECHECK_REQUIRED','MEDIA_APPROVAL_REQUIRED','CONTENT_APPROVAL_REQUIRED','TARGET_ACCOUNT_REQUIRED','PUBLICATION_APPROVAL_REQUIRED','PUBLICATION_RESERVATION_REQUIRED','MEDIA_CHANGES_REQUIRED','TEXT_REVIEW_REQUIRED'])assert.ok(result.blockers.includes(blocker));
 assert.ok(!result.draft.caption.includes(response.text.review_notes[0]));
});
test('the generated subworkflow performs one read-only RPC, accepts no webhooks and has no upload path',()=>{
 const workflow=JSON.parse(fs.readFileSync('n8n/publishing/publisher-handoff-workflow.json','utf8'));
 assert.deepEqual(workflow.pinData,{});assert.equal(workflow.active,false);
 assert.equal(workflow.settings.callerPolicy,'workflowsFromSameOwner');assert.equal(workflow.settings.availableInMCP,false);
 for(const key of ['saveDataErrorExecution','saveDataSuccessExecution'])assert.equal(workflow.settings[key],'none');
 assert.equal(workflow.settings.saveManualExecutions,false);
 assert.deepEqual(workflow.nodes.map(n=>n.type),['n8n-nodes-base.executeWorkflowTrigger','n8n-nodes-base.code','n8n-nodes-base.httpRequest','n8n-nodes-base.code']);
 const http=workflow.nodes[2];assert.match(http.parameters.url,/\/rpc\/sma_publication_assignment_v1$/);assert.equal(http.parameters.options.redirect.redirect.followRedirects,false);
 const validate=workflow.nodes[1].parameters.jsCode,finish=workflow.nodes[3].parameters.jsCode;
 const call=(code,items,saved)=>JSON.parse(JSON.stringify(vm.runInNewContext('(function(){'+code+'})()',{Buffer,Date:class extends Date {static now(){return now;}},$input:{all:()=>items,first:()=>items[0]},$:()=>({first:()=>({json:saved})})})));
 const prepared=call(validate,[{json:selection}])[0].json;
 assert.deepEqual(prepared.rpc,handoffRpcInput(selection));assert.deepEqual(call(finish,[{json:stored()}],prepared)[0].json,run());
 assert.throws(()=>call(validate,[{json:selection},{json:selection}]),/INVALID_HANDOFF_INPUT/);
 assert.throws(()=>call(finish,[{json:stored()},{json:stored()}],prepared),/HANDOFF_UNAVAILABLE/);
});

test('product footers must match the exact ID on the saved file assignment in both languages',()=>{
 for(const platform of ['youtube','instagram','facebook','tiktok'])for(const language of ['de','en']){
  const response=stored(platform,language);
  const draft=response.text;
  draft.product_id='Article_01';
  draft.caption=draft.caption.replace(/🛒 .+$/, (language==='en'?'🛒 View product: ':'🛒 Zum Produkt: ')+selection.shop_url+'&produkt=Article_01');
  assert.deepEqual(run(response,{...selection,platform}).draft,draft);
  for(const id of [undefined,null,'Other','Article_01&shop=x','Article/01']){
   assert.equal(run({...response,text:{...draft,product_id:id}},{...selection,platform}).code,'SAVED_TEXT_INVALID');
  }
 }
});
