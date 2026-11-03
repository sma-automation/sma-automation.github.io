const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const {orderTarget,orderFailure,orderRequest}=require('../n8n/publishing/publisher-order.cjs');
const {accountInput,accountRefresh,accountSaved,accountBody,accountEvidence,accountChoices,accountFailure}=require('../n8n/publishing/publisher-account.cjs');
const now=Date.parse('2026-11-03T12:00:00.000Z');
const row={id:1,kunde_id:'fixture',kunde_email:'fixture@example.invalid',zugang_aktiv:true,demo_delta_aktiv:true,youtube_channel_id:'UC_fixture',youtube_channel_title:'Saved channel',youtube_access_token:'OLD_ACCESS_TOKEN',youtube_refresh_token:'OLD_REFRESH_TOKEN',tiktok_open_id:'tt_fixture',tiktok_access_token:'OLD_ACCESS_TOKEN',tiktok_refresh_token:'OLD_REFRESH_TOKEN'};
const context=p=>({ok:true,n8n_kunde_id:row.kunde_id,kunde_email:row.kunde_email,binding:{customer_id:7,platform:p}});
const input=p=>accountInput([row],context(p),orderTarget([row],context(p)).target);
const refresh={access_token:'NEW_ACCESS_TOKEN',refresh_token:'NEW_REFRESH_TOKEN',expires_in:3600,refresh_expires_in:86400,open_id:'tt_fixture',scope:'video.publish,user.info.basic'};
const ytProfile={items:[{id:'UC_fixture',snippet:{title:'Verified channel'}}]};
const ytScope={scope:'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload',expires_in:'3590'};
const ttProfile={data:{user:{open_id:'tt_fixture',display_name:'Example'}},error:{code:'ok'}};
const ttPolicy={data:{creator_nickname:'Verified creator',privacy_level_options:['SELF_ONLY','PUBLIC_TO_EVERYONE'],comment_disabled:true,duet_disabled:false,stitch_disabled:true,max_video_post_duration_sec:600},error:{code:'ok'}};
function evidence(p,profile=p==='youtube'?ytProfile:ttProfile,policy=p==='youtube'?ytScope:ttPolicy){return accountEvidence(input(p),accountRefresh(refresh,input(p),now),profile,policy,now);}
test('account input requires a selected customer and refresh token',()=>{
 assert.equal(input('youtube').customer_id,7);assert.match(input('tiktok').fingerprint,/^[a-f0-9]{64}$/);
 for(const rows of [[],[row,row],[{...row,tiktok_refresh_token:''}]])assert.throws(()=>accountInput(rows,context('tiktok'),input('tiktok').target));
});
test('refresh rotation is retained independently of missing scopes/profile',()=>{
 const r=accountRefresh({...refresh,scope:undefined,open_id:undefined},input('tiktok'),now);assert.equal(r.refresh_token,'NEW_REFRESH_TOKEN');
 assert.equal(accountRefresh({...refresh,refresh_token:undefined},input('youtube'),now).refresh_token,'OLD_REFRESH_TOKEN');
 assert.throws(()=>accountRefresh({...refresh,refresh_token:undefined},input('tiktok'),now),/TARGET_REFRESH_UNCERTAIN/);
 for(const raw of [{statusCode:400,body:{error:'invalid_grant'}},{...refresh,expires_in:0},{...refresh,access_token:''}])assert.throws(()=>accountRefresh(raw,input('youtube'),now));
});
test('stored tokens must be read back from exactly the same customer row',()=>{
 const tokens=accountRefresh(refresh,input('tiktok'),now),saved={...row,tiktok_access_token:tokens.access_token,tiktok_refresh_token:tokens.refresh_token};
 assert.equal(accountSaved([saved],input('tiktok'),tokens).saved,true);
 for(const rows of [[],[saved,saved],[row],[{...saved,id:2}],[{...saved,kunde_email:'other@example.invalid'}]])assert.throws(()=>accountSaved(rows,input('tiktok'),tokens),/TARGET_TOKEN_SAVE_FAILED/);
});
test('YouTube verifies exactly one authenticated channel and the upload scope',()=>{
 const e=evidence('youtube');assert.equal(e.display_name,'Verified channel');assert.deepEqual(e.permissions,['youtube.upload']);assert.equal(e.expires_at,'2026-11-03T12:05:00.000Z');
 for(const profile of [{items:[]},{items:[...ytProfile.items,...ytProfile.items]},{items:[{id:'foreign',snippet:{title:'Other'}}]},{...ytProfile,nextPageToken:'more'}])assert.throws(()=>evidence('youtube',profile),/TARGET_ACCOUNT_CHANGED/);
 for(const proof of [{scope:'https://www.googleapis.com/auth/youtube.readonly',expires_in:3000},{...ytScope,expires_in:0},{...ytScope,scope:undefined}])assert.throws(()=>evidence('youtube',ytProfile,proof),/TARGET_PERMISSIONS_REQUIRED/);
 assert.ok(!/TOKEN|kunde_email|access_token|refresh_token/.test(JSON.stringify(e)));
});
test('TikTok checks open_id, scopes and creator-info policy without default visibility',()=>{
 const e=evidence('tiktok');assert.equal(e.target_id,'tt_fixture');assert.deepEqual(e.policy.privacy_levels,['SELF_ONLY','PUBLIC_TO_EVERYONE']);
 assert.throws(()=>evidence('tiktok',{...ttProfile,data:{user:{open_id:'foreign'}}}),/TARGET_ACCOUNT_CHANGED/);
 for(const patch of [{privacy_level_options:[]},{privacy_level_options:['unknown']},{privacy_level_options:['SELF_ONLY','SELF_ONLY']},{comment_disabled:'false'},{max_video_post_duration_sec:0},{creator_nickname:'bad\u202ename'}])assert.throws(()=>evidence('tiktok',ttProfile,{...ttPolicy,data:{...ttPolicy.data,...patch}}));
 assert.throws(()=>accountEvidence(input('tiktok'),{...accountRefresh(refresh,input('tiktok'),now),scope:'user.info.basic'},ttProfile,ttPolicy,now),/TARGET_PERMISSIONS_REQUIRED/);
});
test('provider errors and untrusted raw responses cannot become evidence',()=>{
 for(const r of [{statusCode:401,body:{}},{statusCode:429,body:{}},{statusCode:503,body:{}},{statusCode:200,body:{error:{code:'access_token_invalid'}}}])assert.throws(()=>accountBody(r));
 assert.equal(accountFailure({error:'TARGET_CHECK_RUNNING'}).code,'TARGET_CHECK_RUNNING');
 assert.equal(accountFailure({error:'secret: TOKEN'}).code,'TARGET_CHECK_UNAVAILABLE');
 assert.equal(orderFailure({error:'AUTH_REQUIRED'}).code,'AUTH_REQUIRED');
});
test('TikTok respects disabled interactions and rejects private branded content',()=>{
 const e=evidence('tiktok'),choices={visibility:'SELF_ONLY',disable_comment:true,disable_stitch:true,disable_duet:false,brand_content_toggle:false};
 assert.equal(accountChoices(e,choices),true);
 for(const patch of [{visibility:'FOLLOWER_OF_CREATOR'},{disable_comment:false},{disable_stitch:false},{brand_content_toggle:true}])assert.throws(()=>accountChoices(e,{...choices,...patch}),/TARGET_OPTIONS_CHANGED/);
});
test('account preflight is owner authenticated and cannot accept target/owner overrides',()=>{
 const req={headers:{authorization:'Bearer '+'x'.repeat(30)},body:{action:'account',input:{id:'fa660000-0000-4000-8000-000000000001',platform:'tiktok'}}};assert.equal(orderRequest(req).action,'account');
 for(const patch of [{customer_id:9},{target_id:'foreign'},{platform:'unsupported'}])assert.throws(()=>orderRequest({...req,body:{...req.body,input:{...req.body.input,...patch}}}));
});
test('generated account workflow serializes refresh, CAS saves, then verifies identity',()=>{
 const w=JSON.parse(fs.readFileSync('n8n/publishing/publication-account-workflow.json')),n=Object.fromEntries(w.nodes.map(x=>[x.name,x]));
 assert.match(n['Kontozugang auswählen'].parameters.jsCode,/const configured=false/);
 assert.equal(w.active,false);assert.equal(w.settings.saveManualExecutions,false);assert.equal(w.settings.saveDataErrorExecution,'none');assert.deepEqual(w.pinData,{});
 const seen=new Set(),todo=['Kontoprüfung anfordern'];while(todo.length){const name=todo.pop();if(seen.has(name))continue;seen.add(name);assert.ok(n[name]);for(const port of w.connections[name]?.main||[])for(const e of port)todo.push(e.node);}assert.equal(seen.size,w.nodes.length);
 for(const x of w.nodes){assert.ok(!x.retryOnFail);if(x.type.endsWith('.code'))new vm.Script('(async function(){'+x.parameters.jsCode+'})');}
 for(const label of ['YouTube','TikTok']){
  const refreshNode=n[label+'-Zugang erneuern'];assert.match(refreshNode.parameters.bodyParameters.parameters.find(p=>p.name==='client_secret').value,/^__SMA_/);
  assert.equal(w.connections[label+'-Token speichern'].main[0][0].node,'Gespeicherten Zugang zurücklesen');
  const filters=n[label+'-Token speichern'].parameters.filters.conditions.map(c=>c.keyName);assert.ok(filters.includes('id'));assert.ok(filters.includes(label.toLowerCase()+'_refresh_token'));assert.ok(filters.includes(label.toLowerCase()+'_access_token'));
 }
 const endpoints=w.nodes.filter(n=>n.type.endsWith('.httpRequest')).map(n=>n.parameters.url);
 assert.ok(endpoints.every(u=>/supabase\.co\/rest\/v1\/rpc\/sma_publication_account_worker_v1$|oauth2\.googleapis\.com\/(token|tokeninfo)$|www\.googleapis\.com\/youtube\/v3\/channels$|open\.tiktokapis\.com\/v2\/(oauth\/token|user\/info|post\/publish\/creator_info\/query)\/$/.test(u)));
});
test('TikTok UI offers only provider options and preserves forced interaction restrictions',async()=>{
 const {accountChoiceOptions}=await import('../app/assets/publication-order.mjs');const r=accountChoiceOptions('tiktok',{account_check:evidence('tiktok')});
 assert.deepEqual(r.visibility,[['SELF_ONLY','Nur ich'],['PUBLIC_TO_EVERYONE','Öffentlich']]);assert.equal(r.forced.disable_comment,true);assert.equal(r.forced.disable_duet,false);
 assert.throws(()=>accountChoiceOptions('tiktok',null));assert.equal(accountChoiceOptions('youtube',null),null);
});
