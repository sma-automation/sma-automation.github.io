const test=require('node:test');
const assert=require('node:assert/strict');
const ready=import('../app/assets/website-connection-model.mjs');
const id='a1000000-0000-4000-8000-000000000101';
const state=(patch={})=>({ok:true,state:'not_requested',revision:0,preparation_revision:1,
 website_url:'https://example.com/',provider:null,attempt_id:null,expires_at:null,
 website_connected:false,can_synchronize:false,can_publish:false,...patch});
const active=()=>state({state:'pending',revision:1,provider:'wordpress',attempt_id:id,expires_at:'2026-11-04T12:10:00Z'});
const now=()=>Date.parse('2026-11-04T12:00:00Z');

test('connection requests cannot claim a completed connection or publishing permission',async()=>{
 const {readConnectionRequest}=await ready;
 const result=readConnectionRequest(active(),{now});
 assert.equal(result.state,'pending');assert.equal(result.websiteConnected,false);assert.equal(result.canSynchronize,false);
 for(const key of ['website_connected','can_synchronize','can_publish']){
  assert.throws(()=>readConnectionRequest({...active(),[key]:true},{now}),{code:'INVALID_RESPONSE'});
  const missing=active();delete missing[key];assert.throws(()=>readConnectionRequest(missing,{now}),{code:'INVALID_RESPONSE'});
 }
 for(const patch of [{state:'connected'},{provider:'ionos'},{attempt_id:'bad'},{expires_at:null},{revision:0},{preparation_revision:0},{website_url:null},{website_url:'https://user:secret@example.com/'},{website_url:'http://localhost/'}])assert.throws(()=>readConnectionRequest({...active(),...patch},{now}),{code:'INVALID_RESPONSE'});
});

test('expired browser state loses the attempt and revocation never exposes an old attempt',async()=>{
 const {readConnectionRequest}=await ready;
 const expired=readConnectionRequest(active(),{now:()=>Date.parse('2026-11-04T12:10:00Z')});
 assert.equal(expired.state,'expired');assert.equal(expired.attemptId,null);assert.equal(expired.expiresAt,null);
 assert.throws(()=>readConnectionRequest({...active(),state:'revoked'},{now}),{code:'INVALID_RESPONSE'});
 const revoked=readConnectionRequest({...active(),state:'revoked',attempt_id:null,expires_at:null},{now});
 assert.equal(revoked.state,'revoked');assert.equal(revoked.canPublish,false);
});

test('lost prepare response reuses the exact UUID and revision without accepting caller account IDs',async()=>{
 const {createConnectionRequestClient}=await ready;const calls=[];let attempt=0,generated=0;
 const client=createConnectionRequestClient({now,getOwnerId:async()=>'owner',uuid:()=>{generated++;return id;},request:async(action,input)=>{
  calls.push({action,input});if(action==='get')return state();if(++attempt===1)throw Error('transport');return active();
 }});
 await client.load();await assert.rejects(client.prepare('wordpress'),/transport/);await client.prepare('wordpress');
 assert.deepEqual(calls[1],calls[2]);assert.equal(generated,1);
 assert.deepEqual(calls[1].input,{expected_revision:0,request_id:id,provider:'wordpress'});
});

test('owner changes before or during a request cannot expose another account state',async()=>{
 const {createConnectionRequestClient}=await ready;let owner='first',calls=0,change=false;
 const client=createConnectionRequestClient({now,getOwnerId:async()=>owner,uuid:()=>id,request:async action=>{
  calls++;if(change)owner='second';return action==='get'?state():active();
 }});
 await client.load();owner='second';await assert.rejects(client.prepare('wordpress'),{code:'AUTH_REQUIRED'});assert.equal(calls,1);
 owner='first';change=true;await assert.rejects(client.prepare('wordpress'),{code:'AUTH_REQUIRED'});
});

test('unsupported providers do not issue requests and a loaded revision is required',async()=>{
 const {createConnectionRequestClient}=await ready;let calls=0;
 const client=createConnectionRequestClient({now,getOwnerId:async()=>'owner',uuid:()=>id,request:async()=>{calls++;return state();}});
 await assert.rejects(client.prepare('wordpress'),{code:'AUTH_REQUIRED'});
 await client.load();await assert.rejects(client.prepare('ionos'),{code:'PROVIDER_UNSUPPORTED'});assert.equal(calls,1);
});

test('revocation uses the persisted revision and retains the request after a lost response',async()=>{
 const {createConnectionRequestClient}=await ready;let attempts=0;const requests=[];
 const client=createConnectionRequestClient({now,getOwnerId:async()=>'owner',uuid:()=>id,request:async(action,input)=>{
  if(action==='get')return active();requests.push({action,input});if(++attempts===1)throw Error('lost');
  return {...active(),state:'revoked',revision:2,attempt_id:null,expires_at:null};
 }});
 await client.load();await assert.rejects(client.revoke(),/lost/);assert.equal((await client.revoke()).state,'revoked');
 assert.deepEqual(requests[0],requests[1]);assert.equal(requests[0].input.expected_revision,1);assert.equal(requests[0].action,'revoke');
});

test('concurrent requests are rejected while the initial request is in flight',async()=>{
 const {createConnectionRequestClient}=await ready;let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const client=createConnectionRequestClient({now,getOwnerId:async()=>'owner',request:async()=>{await gate;return state();}});
 const loading=client.load();await assert.rejects(client.load(),{code:'BUSY'});release();await loading;
});
