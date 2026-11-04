const test=require('node:test'),assert=require('node:assert/strict');
const mod=()=>import('../supabase/functions/sma-wordpress-sync/handler.mjs');
const signing=import('../supabase/functions/_shared/wordpress-bridge.mjs');
const keys=signing.then(m=>m.createBridgeKeys());
const uid='fc990000-0000-4000-8000-000000000001',attempt='ac990000-0000-4000-8000-000000000001',requestId='bc990000-0000-4000-8000-000000000001',lease='dc990000-0000-4000-8000-000000000001';
const website='https://example.com/blog/';
const req=(body,headers={})=>new Request('https://service.example/sync',{method:'POST',headers:{Authorization:'Bearer synthetic',Origin:'https://sma-automation.com','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
async function setup(){
 const pair=await keys,calls=[],commands=[];let saved={ok:true,state:'idle',attempt_id:attempt,request_id:requestId,lease_id:null,website_url:website,shop_slug:'fixture-shop',expected_revision:null,previous_post_id:null,post_id:null,revision:null,last_error:null,completed_at:null,retry_after:null,can_publish:false};
 let remoteRevision=0,lastRequest=null,lost=false;
 const deps={authenticate:async()=>({id:uid}),serviceRpc:async(name,input)=>{
  calls.push({name,input});assert.equal(input.p_user_id,uid);assert.equal(input.p_attempt_id,attempt);
  if(name==='sma_website_provider_credential_v1')return {ok:true,provider:'wordpress',attempt_id:attempt,website_url:website,provider_site_id:'wordpress-bridge:'+attempt,credentials:{bridge_private_key:pair.privateKey}};
  assert.equal(name,'sma_wordpress_sync_job_v1');const {p_action:action,p_input:p}=input;
  if(action==='status')return {...saved,lease_id:null};
  if(action==='claim'){if(!['draft','blocked'].includes(saved.state))saved={...saved,state:'running',lease_id:lease};}
  if(action==='dispatch'){
   if(p.proof){saved.expected_revision=p.proof.revision;saved.previous_post_id=p.proof.post_id;}
   assert.notEqual(saved.expected_revision,null);
  }
  if(action==='complete')saved={...saved,state:'draft',lease_id:null,post_id:p.proof.post_id,revision:p.proof.revision,completed_at:'2026-11-04T14:00:00Z'};
  if(action==='retry'||action==='block')saved={...saved,state:action==='retry'?'retry':'blocked',lease_id:null,last_error:p.code};
  return {...saved};
 },probe:async(url,signed)=>{
  assert.equal(url,website);const p=JSON.parse(signed.body);commands.push(p);
  const result={ok:true,attempt_id:attempt,website_url:website,shop_slug:'fixture-shop',revision:remoteRevision,post_id:remoteRevision?42:null,can_read:true,can_sync_draft:true,can_publish:false};
  if(p.action==='inspect')return result;
  assert.equal(saved.expected_revision,p.expected_revision,'command was persisted before network write');
  if(lastRequest!==p.request_id){assert.equal(p.expected_revision,remoteRevision);remoteRevision++;lastRequest=p.request_id;}
  if(lost){lost=false;throw Error('lost response');}
  return {...result,revision:remoteRevision,post_id:42,state:'draft'};
 }};
 const m=await mod();return {deps,calls,commands,handler:()=>m.createSyncHandler(deps),saved:()=>saved,lost:()=>{lost=true;},remoteRevision:()=>remoteRevision};
}
test('WordPress draft sync rejects caller-selected identity, URL, content and foreign origins',async()=>{
 const s=await setup(),h=s.handler();
 for(const extra of [{user_id:uid},{website_url:website},{post_id:99},{content:'x'},{publish:true}])assert.equal((await h(req({action:'sync',attempt_id:attempt,...extra}))).status,400);
 assert.equal((await h(req({action:'sync',attempt_id:attempt},{Origin:'https://evil.example'}))).status,403);
 s.deps.authenticate=async()=>null;assert.equal((await s.handler()(req({action:'status',attempt_id:attempt}))).status,401);assert.equal(s.calls.length,0);assert.equal(s.commands.length,0);
});
test('a read of sync status never creates a job or contacts WordPress',async()=>{
 const s=await setup(),r=await (await s.handler()(req({action:'status',attempt_id:attempt}))).json();
 assert.equal(r.state,'idle');assert.equal(r.can_synchronize,true);assert.equal(s.calls.length,1);assert.equal(s.calls[0].input.p_action,'status');assert.equal(s.commands.length,0);
});
test('one explicit sync stores its baseline before signing and records only a draft',async()=>{
 const s=await setup(),r=await (await s.handler()(req({action:'sync',attempt_id:attempt}))).json();
 assert.equal(r.state,'draft');assert.equal(r.can_publish,false);assert.equal(r.edit_url,website+'wp-admin/post.php?post=42&action=edit');
 assert.deepEqual(s.commands.map(c=>c.action),['inspect','sync_draft']);assert.equal(s.commands[1].request_id,requestId);
 assert(!JSON.stringify(r).includes('PRIVATE KEY'));assert(!('lease_id' in r));assert(!('request_id' in r));
 await s.handler()(req({action:'sync',attempt_id:attempt}));assert.equal(s.commands.length,2,'repeated successful request creates no second page');
});
test('lost provider replies resume the same stored UUID and original revision without rebaselining',async()=>{
 const s=await setup();s.lost();const h=s.handler();
 let r=await (await h(req({action:'sync',attempt_id:attempt}))).json();assert.equal(r.state,'retry');assert.equal(s.remoteRevision(),1);
 r=await (await h(req({action:'sync',attempt_id:attempt}))).json();assert.equal(r.state,'draft');assert.equal(s.remoteRevision(),1);
 const writes=s.commands.filter(c=>c.action==='sync_draft');assert.equal(writes.length,2);assert.equal(writes[0].request_id,writes[1].request_id);assert.equal(writes[0].expected_revision,writes[1].expected_revision);
 assert.equal(s.commands.filter(c=>c.action==='inspect').length,1,'a retry must not adopt the remote increment and create another operation');
});
test('an edited or published WordPress page blocks further writes and keeps its reason',async()=>{
 const s=await setup(),probe=s.deps.probe;s.deps.probe=async(url,signed)=>JSON.parse(signed.body).action==='sync_draft'?{ok:false,code:'PAGE_CHANGED'}:probe(url,signed);
 const r=await (await s.handler()(req({action:'sync',attempt_id:attempt}))).json();assert.equal(r.state,'blocked');assert.equal(r.last_error,'PAGE_CHANGED');assert.equal(r.can_synchronize,false);
 assert.equal(s.remoteRevision(),0);const count=s.calls.length;await s.handler()(req({action:'sync',attempt_id:attempt}));assert.equal(s.calls.length,count+1);
});
test('mismatched provider results are never recorded as a successful sync',async()=>{
 for(const patch of [{shop_slug:'other-shop'},{website_url:'https://evil.example/'},{can_publish:true},{revision:2}]){
  const s=await setup(),probe=s.deps.probe;s.deps.probe=async(url,signed)=>({...await probe(url,signed),...(JSON.parse(signed.body).action==='sync_draft'?patch:{})});
  const r=await (await s.handler()(req({action:'sync',attempt_id:attempt}))).json();assert.equal(r.state,'blocked');assert.equal(r.last_error,'INVALID_PROVIDER_RESULT');assert(!s.calls.some(c=>c.input.p_action==='complete'));
 }
});
test('a changed binding at dispatch prevents the outbound write and cannot select new credentials',async()=>{
 const s=await setup(),rpc=s.deps.serviceRpc;s.deps.serviceRpc=async(name,input)=>input.p_action==='dispatch'?{ok:false,code:'REQUEST_STALE'}:rpc(name,input);
 await s.handler()(req({action:'sync',attempt_id:attempt}));assert.equal(s.commands.filter(c=>c.action==='sync_draft').length,0);
});
test('only bounded recognized WordPress errors are returned by the opt-in transport',async()=>{
 const {parseWordpressHttp}=await import('../supabase/functions/_shared/wordpress-transport.mjs');
 const raw=(status,body)=>new TextEncoder().encode('HTTP/1.1 '+status+' Error\r\nContent-Type: application/json\r\n\r\n'+JSON.stringify(body));
 assert.deepEqual(parseWordpressHttp(raw(409,{ok:false,code:'PAGE_CHANGED'}),{allowBridgeErrors:true}),{ok:false,code:'PAGE_CHANGED'});
 assert.deepEqual(parseWordpressHttp(raw(403,{code:'sma_not_authorized',message:'x',data:{status:403}}),{allowBridgeErrors:true}),{ok:false,code:'NOT_CONNECTED'});
 assert.throws(()=>parseWordpressHttp(raw(409,{ok:false,code:'PAGE_CHANGED'})));
 for(const body of [{ok:false,code:'secret'},{ok:false,code:'PAGE_CHANGED',secret:'x'},{ok:true,code:'PAGE_CHANGED'}])assert.throws(()=>parseWordpressHttp(raw(409,body),{allowBridgeErrors:true}));
});
test('client rejects mismatched result links and discards in-flight account changes',async()=>{
 const {readWordpressSync,createWordpressSyncClient}=await import('../app/assets/wordpress-sync.mjs');
 const r={ok:true,state:'draft',attempt_id:attempt,website_url:website,can_synchronize:false,can_publish:false,post_id:42,revision:1,completed_at:'2026-11-04T14:00:00Z',edit_url:website+'wp-admin/post.php?post=42&action=edit',last_error:null,retry_after:null};
 assert.equal(readWordpressSync(r,attempt,website).state,'draft');
 for(const patch of [{edit_url:'https://evil.example/'},{attempt_id:uid},{can_publish:true},{post_id:99},{can_synchronize:true},{completed_at:'invalid'}])assert.throws(()=>readWordpressSync({...r,...patch},attempt,website));
 let release,owner=uid;const client=createWordpressSyncClient({getOwnerId:async()=>owner,request:()=>new Promise(resolve=>release=resolve)});
 const pending=client.load(attempt,website);await new Promise(r=>setImmediate(r));owner='changed';release(r);await assert.rejects(pending,{code:'AUTH_REQUIRED'});await assert.rejects(client.sync(),{code:'AUTH_REQUIRED'});
});
