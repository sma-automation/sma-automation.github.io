const test=require('node:test'),assert=require('node:assert/strict');
const ready=import('../supabase/functions/sma-wordpress-connect/handler.mjs');
const signing=import('../supabase/functions/_shared/wordpress-bridge.mjs');
const uid='c1000000-0000-4000-8000-000000000101',attempt='a1000000-0000-4000-8000-000000000101',requestId='b1000000-0000-4000-8000-000000000101';
const website='https://example.com/';
const keys=signing.then(m=>m.createBridgeKeys());
function request(body,headers={}){return new Request('https://service.example/connect',{method:'POST',headers:{Authorization:'Bearer synthetic',Origin:'https://sma-automation.com','Content-Type':'application/json',...headers},body:JSON.stringify(body)});}
async function setup(){
 const calls=[],pair=await keys;let stored=false,verified=false,privateResponse;
 const ticket={ok:true,attempt_id:attempt,website_url:website,shop_slug:'sma-testkunde',account_label:'synthetic@example.invalid',public_key:pair.publicKey,private_key:pair.privateKey,expires_at:Math.floor(Date.now()/1000)+300};
 const deps={authenticate:async()=>({id:uid}),keys:async()=>pair,
  userRpc:async(auth,action,input)=>{calls.push({type:'user',action,input});return {ok:true,state:action==='revoke'?'revoked':'pending',revision:1,attempt_id:attempt,website_url:website};},
  serviceRpc:async(name,input)=>{
   calls.push({name,input});
   if(name==='sma_wordpress_ticket_cleanup_v1')return 0;
   if(name==='sma_website_provider_context_v1')return verified?{ok:true,state:'verified',provider:'wordpress',attempt_id:attempt,website_url:website,website_connected:true}:{ok:true,state:'not_connected'};
   if(name==='sma_wordpress_ticket_context_v1')return stored?ticket:{ok:false,code:'TICKET_UNAVAILABLE'};
   if(name==='sma_wordpress_ticket_issue_v1'){stored=true;return ticket;}
   if(name==='sma_website_provider_begin_v1')return {ok:true,verification_id:requestId};
   if(name==='sma_wordpress_ticket_finish_v1'){verified=true;return {ok:true,state:'verified'};}
   if(name==='sma_wordpress_verify_release_v1')return true;
   throw Error('unexpected RPC');
  },
  probe:async(url,signed)=>{calls.push({type:'probe',url,signed});return {ok:true,attempt_id:attempt,website_url:website,shop_slug:'sma-testkunde',revision:0,post_id:null,can_read:true,can_sync_draft:true,can_publish:false};}
 };
 const m=await ready;return {deps,calls,ticket,handler:()=>m.createConnectHandler(deps),stored:()=>{stored=true;},verified:()=>{verified=true;}};
}
test('connection rejects caller identity overrides, foreign origins and invalid sessions without RPCs',async()=>{
 const s=await setup();const h=s.handler();
 assert.equal((await h(request({action:'start',expected_revision:0,request_id:requestId,user_id:uid}))).status,400);
 assert.equal((await h(request({action:'status'},{Origin:'https://evil.example'}))).status,403);
 s.deps.authenticate=async()=>null;assert.equal((await s.handler()(request({action:'status'}))).status,401);assert.equal(s.calls.length,0);
});
test('start and resume return only the bound WordPress authorization link, retaining the same key',async()=>{
 const s=await setup(),h=s.handler();
 const first=await (await h(request({action:'start',expected_revision:0,request_id:requestId}))).json();
 const second=await (await h(request({action:'resume',attempt_id:attempt}))).json();
 assert.equal(first.authorization_url,second.authorization_url);assert.match(first.authorization_url,/^https:\/\/example.com\/wp-admin\/options-general.php\?page=sma-bridge&ticket=[a-f0-9]{64}$/);
 assert(!JSON.stringify(first).includes('PRIVATE KEY'));assert.equal(s.calls.filter(x=>x.name==='sma_wordpress_ticket_issue_v1').length,1);
 assert.equal(s.calls.filter(x=>x.type==='probe').length,0);assert.equal(s.calls.filter(x=>x.type==='user'&&x.action==='prepare').length,1);
});
test('verification signs a read-only probe then completes atomically; reload handles lost completion replies',async()=>{
 const s=await setup();s.stored();const h=s.handler();
 const r=await (await h(request({action:'verify',attempt_id:attempt}))).json();assert.equal(r.state,'verified');assert.equal(r.can_synchronize,false);
 const probe=s.calls.find(x=>x.type==='probe');assert.equal(JSON.parse(probe.signed.body).action,'inspect');assert.equal(probe.url,website);
 const finish=s.calls.find(x=>x.name==='sma_wordpress_ticket_finish_v1');assert.equal(finish.input.p_user_id,uid);assert.equal(finish.input.p_proof.provider_site_id,'wordpress-bridge:'+attempt);
 assert(!JSON.stringify(r).includes('PRIVATE KEY'));
 assert.equal((await (await h(request({action:'verify',attempt_id:attempt}))).json()).state,'verified');assert.equal(s.calls.filter(x=>x.type==='probe').length,1);
});
test('wrong shop or network rejection cannot complete a connection and releases its lease',async()=>{
 for(const bad of ['shop','network']){
  const s=await setup();s.stored();const original=s.deps.probe;
  s.deps.probe=bad==='network'?async()=>{throw Error('PRIVATE_KEY_MUST_NOT_LEAK');}:async(...args)=>({...await original(...args),shop_slug:'wrong-shop'});
  const r=await (await s.handler()(request({action:'verify',attempt_id:attempt}))).json();assert.equal(r.ok,false);assert(!JSON.stringify(r).includes('PRIVATE_KEY'));
  assert(!s.calls.some(x=>x.name==='sma_wordpress_ticket_finish_v1'));assert(s.calls.some(x=>x.name==='sma_wordpress_verify_release_v1'));
 }
});
test('revocation remains available when ordinary status is inaccessible',async()=>{
 const s=await setup();s.deps.userRpc=async(auth,action)=>{assert.equal(action,'revoke');return {ok:true,state:'revoked',revision:2};};
 const r=await (await s.handler()(request({action:'revoke',expected_revision:1,request_id:requestId}))).json();assert.equal(r.state,'revoked');
});
test('public ticket endpoint hashes its opaque token and strips all private response fields',async()=>{
 const {createTicketHandler,digest}=await ready;const s=await setup(),token='a'.repeat(64);let hash;
 const h=createTicketHandler({serviceRpc:async(name,input)=>{if(name.endsWith('cleanup_v1'))return 0;hash=input.p_ticket_hash;return {...s.ticket,other_secret:'DO_NOT_SEND'};}});
 const r=await h(new Request('https://service.example/ticket',{method:'POST',body:JSON.stringify({ticket:token,website_url:website})}));
 assert.equal(r.status,200);const body=await r.json();assert.equal(Object.keys(body).length,7);assert(!('private_key'in body));assert(!('other_secret'in body));assert.equal(hash,await digest(token));
 assert.equal((await h(request({ticket:token,website_url:website}))).status,403);
});
test('WordPress client retains start UUID across a lost response and rejects unsafe authorization links',async()=>{
 const {createWordpressClient,readWordpressState}=await import('../app/assets/wordpress-connection.mjs');let count=0;const calls=[];
 const base={ok:true,state:'not_requested',revision:0,website_url:website,can_publish:false,can_synchronize:false};
 const pending={...base,state:'pending',revision:1,attempt_id:attempt,authorization_url:website+'wp-admin/options-general.php?page=sma-bridge&ticket='+'a'.repeat(64),expires_at:Math.floor(Date.now()/1000)+100};
 const c=createWordpressClient({getOwnerId:async()=>uid,uuid:()=>requestId,request:async(action,input)=>{calls.push({action,input});if(action==='status')return base;if(++count===1)throw Error('lost');return pending;}});
 await c.load(website);await assert.rejects(c.start());await c.start();assert.deepEqual(calls[1],calls[2]);
 for(const patch of [{authorization_url:'https://evil.example/?ticket=x'},{can_publish:true},{website_url:'https://other.example/'},{expires_at:0}])assert.throws(()=>readWordpressState({...pending,...patch},website));
});
test('changing owner or invalidating the draft discards an in-flight WordPress result',async()=>{
 const {createWordpressClient}=await import('../app/assets/wordpress-connection.mjs');let release;
 const c=createWordpressClient({getOwnerId:async()=>uid,request:()=>new Promise(r=>{release=r;})});
 const loading=c.load(website);await new Promise(r=>setImmediate(r));c.invalidate();release({ok:true,state:'not_requested',revision:0,website_url:website,can_publish:false,can_synchronize:false});await assert.rejects(loading,{code:'AUTH_REQUIRED'});
});

test('a provider HTML page releases the verification lease without establishing a connection',async()=>{
 const s=await setup();s.stored();
 s.deps.probe=async()=>{throw Object.assign(new Error('private provider detail'),{code:'WORDPRESS_HTML_RESPONSE'});};
 const result=await s.handler()(request({action:'verify',attempt_id:attempt}));
 assert.equal(result.status,409);
 assert.deepEqual(await result.json(),{ok:false,code:'WORDPRESS_HTML_RESPONSE'});
 assert(s.calls.some(call=>call.name==='sma_wordpress_verify_release_v1'));
 assert(!s.calls.some(call=>call.name==='sma_wordpress_ticket_finish_v1'));
});
