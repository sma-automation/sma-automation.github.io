const test=require('node:test');
const assert=require('node:assert/strict');
const ready=import('../app/assets/website-domain-model.mjs');
const id='a1000000-0000-4000-8000-000000000001';
const empty=()=>({ok:true,state:'preparation',revision:0,draft:null,can_publish:false,shop_url:null});
const saved=(draft,revision=1)=>({...empty(),draft,revision});
const draft={mode:'existing',website_url:'https://meine-firma.at/',desired_domain:''};

test('website addresses normalize without treating a domain wish as a verified connection',async()=>{
 const m=await ready;
 assert.equal(m.normalizeWebsite(' Meine-Firma.AT '),'https://meine-firma.at/');
 assert.deepEqual(m.normalizeDraft({mode:'new',desired_domain:' Neue-Firma.AT '}),{mode:'new',website_url:'',desired_domain:'neue-firma.at'});
 assert.throws(()=>m.normalizeDraft({mode:'existing'}),/WEBSITE_REQUIRED/);
 assert.throws(()=>m.normalizeDraft({mode:'new',website_url:'https://firma.at'}),/INVALID_WEBSITE/);
});
test('credentials, local targets, scripts and non-HTTPS links cannot become website addresses',async()=>{
 const m=await ready;
 for(const url of ['javascript:alert(1)','http://firma.at','https://user:password@firma.at','https://127.0.0.1','https://[::1]','https://localhost','https://host.local','https://firma.at:8080','https://firma.at/?token=x','https://firma.at/#x','https://firma.at\\@evil.at']){
  assert.throws(()=>m.normalizeWebsite(url),/INVALID_WEBSITE/);
 }
});
test('domain wishes reject malformed names and only the exact SMA shop origin is exposed',async()=>{
 const m=await ready;
 for(const domain of ['-x.at','x-.at','x..at','x.invalid','x.test','x.example','a'.repeat(64)+'.at','firma.at:80'])assert.throws(()=>m.normalizeDomain(domain),/INVALID_DOMAIN/);
 assert.equal(m.safeShopLink('https://sma-automation.com/app/shop.html?shop=mein-shop'),'https://sma-automation.com/app/shop.html?shop=mein-shop');
 for(const value of ['https://sma-automation.com.evil.at/app/shop.html?shop=x','javascript:alert(1)','https://sma-automation.com/app/shop.html?shop=x&secret=y'])assert.equal(m.safeShopLink(value),null);
});
test('unexpected response states never turn preparation into publishing',async()=>{
 const m=await ready;
 for(const value of [{...empty(),can_publish:true},{...empty(),state:'connected'},{...empty(),revision:1},{...empty(),revision:-1}])assert.throws(()=>m.readWebsiteState(value));
 assert.throws(()=>m.readWebsiteState({ok:false,code:'DELTA_REQUIRED'}),/DELTA_REQUIRED/);
});
test('lost save response retries the same UUID and revision without a duplicate update',async()=>{
 const m=await ready,requests=[];let calls=0,uuids=0;
 const client=m.createWebsiteDraftClient({getOwnerId:async()=> 'owner-a',uuid:()=>{uuids++;return id;},request:async(action,input)=>{
  if(action==='get')return empty();requests.push(JSON.stringify(input));if(++calls===1)throw Error('network');return saved(draft);
 }});
 await client.load();await assert.rejects(()=>client.save(draft),/network/);await client.save(draft);
 assert.equal(requests[0],requests[1]);assert.equal(uuids,1);assert.equal(JSON.parse(requests[0]).expected_revision,0);
});
test('successful saves advance revision and changed inputs receive a different request',async()=>{
 const m=await ready,requests=[];let number=0;
 const client=m.createWebsiteDraftClient({getOwnerId:async()=> 'owner-a',uuid:()=>id.slice(0,-1)+String(++number),request:async(action,input)=>{
  if(action==='get')return empty();requests.push(input);return saved({mode:input.mode,website_url:input.website_url,desired_domain:input.desired_domain},requests.length);
 }});
 await client.load();await client.save(draft);await client.save({...draft,desired_domain:'firma.at'});
 assert.equal(requests[1].expected_revision,1);assert.notEqual(requests[0].request_id,requests[1].request_id);
});
test('account switch and stale revision cannot silently save another customer draft',async()=>{
 const m=await ready;let owner='a',writes=0;
 const client=m.createWebsiteDraftClient({getOwnerId:async()=>owner,uuid:()=>id,request:async action=>{if(action==='get')return empty();writes++;return {ok:false,code:'REVISION_CONFLICT'};}});
 await client.load();owner='b';await assert.rejects(()=>client.save(draft),/AUTH_REQUIRED/);assert.equal(writes,0);
 owner='a';await assert.rejects(()=>client.save(draft),/REVISION_CONFLICT/);assert.equal(writes,1);
});
test('a second save is blocked while the first request is in flight',async()=>{
 const m=await ready;let release,entered;
 const called=new Promise(resolve=>{entered=resolve;});
 const client=m.createWebsiteDraftClient({getOwnerId:async()=> 'a',uuid:()=>id,request:async action=>{
  if(action==='get')return empty();entered();return new Promise(resolve=>{release=()=>resolve(saved(draft));});
 }});
 await client.load();const pending=client.save(draft);await called;
 await assert.rejects(()=>client.save(draft),/BUSY/);release();await pending;
});

test('a stalled owner session is bounded and a fresh load can succeed',async()=>{
 const m=await ready;let attempts=0;
 const client=m.createWebsiteDraftClient({
  getOwnerId:async()=>++attempts===1?new Promise(()=>{}):'owner',
  request:async()=>empty(),uuid:()=>id,timeoutMs:10
 });
 await assert.rejects(()=>client.load(),/REQUEST_TIMEOUT/);
 assert.equal((await client.load()).revision,0);
 assert.equal(attempts,3,'Owner is checked before and after the response');
});

test('a stalled preparation GET releases the client for a retry',async()=>{
 const m=await ready;let requests=0;
 const client=m.createWebsiteDraftClient({
  getOwnerId:async()=>'owner',uuid:()=>id,timeoutMs:10,
  request:async()=>++requests===1?new Promise(()=>{}):empty()
 });
 await assert.rejects(()=>client.load(),/REQUEST_TIMEOUT/);
 assert.equal((await client.load()).revision,0);
 assert.equal(requests,2);
});

test('an uncertain timed-out save retries the same idempotent UUID and revision',async()=>{
 const m=await ready,requests=[];let nextId=0;
 const client=m.createWebsiteDraftClient({
  getOwnerId:async()=>'owner',timeoutMs:10,
  uuid:()=>id.slice(0,-1)+String(++nextId),
  request:async(action,input)=>{
   if(action==='get')return empty();
   requests.push({...input});
   if(requests.length===1)return new Promise(()=>{});
   return saved(draft);
  }
 });
 await client.load();
 await assert.rejects(()=>client.save(draft),/REQUEST_TIMEOUT/);
 assert.equal((await client.save(draft)).revision,1);
 assert.deepEqual(requests[0],requests[1]);
 assert.equal(nextId,1,'Never create a different save intent after a timeout');
});

test('website loading errors are shown beside save and disabled buttons do not fake a pending request',()=>{
 const fs=require('node:fs');
 const page=fs.readFileSync('app/assets/website-domain.mjs','utf8');
 const css=fs.readFileSync('app/assets/website-domain.css','utf8');
 const dashboard=fs.readFileSync('app/dashboard.html','utf8');
 assert.match(page,/\$\('form'\)\.after\(status\)/);
 assert.match(page,/REQUEST_TIMEOUT:'Die SMA-Verbindung antwortet nicht/);
 assert.match(css,/#smaWebsitePreparation button:disabled\{cursor:not-allowed\}/);
 assert.match(css,/#smaWebsitePreparation\[aria-busy="true"\] button:disabled\{cursor:progress\}/);
 assert.match(dashboard,/website-domain\.mjs\?v=17/);
 assert.match(dashboard,/website-domain\.css\?v=5/);
});
