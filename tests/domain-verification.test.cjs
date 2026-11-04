const {test}=require('node:test');const assert=require('node:assert/strict');
const ready=import('../supabase/functions/sma-website-domain-check/handler.mjs');
const clientReady=import('../app/assets/domain-verification.mjs');
const uid='fa660000-0000-4000-8000-000000000081',attempt='a1000000-0000-4000-8000-000000000081';
const value='sma-verification='+'a'.repeat(64),name='_sma-verification.example.com';
const challenge={ok:true,state:'pending',revision:1,hostname:'example.com',record_name:name,record_type:'TXT',record_value:value,attempt_id:attempt,last_result:'pending',verified_at:null};
const dns=(patch={})=>({Status:0,TC:false,CD:false,Question:[{name:name+'.',type:16}],Answer:[{name:name+'.',type:16,data:'"'+value+'"'}],...patch});
test('DNS proof requires exact TXT value, owner, question and successful complete response',async()=>{
 const {dnsResult}=await ready;assert.equal(dnsResult(dns(),name,value),'found');
 assert.equal(dnsResult(dns({Answer:[{name,type:16,data:'"sma-verification=" "'+'a'.repeat(64)+'"'}]}),name,value),'found');
 for(const patch of [{Status:2},{TC:true},{CD:true},{Question:[]},{Question:[{name:'other.org',type:16}]},{Question:[{name,type:1}]},{Answer:{}}])assert.equal(dnsResult(dns(patch),name,value),'unavailable');
 for(const record of [{name:'other.org',type:16,data:'"'+value+'"'},{name,type:1,data:'"'+value+'"'},{name,type:16,data:'"'+value+'evil"'},{name,type:16,data:'"\\'+value+'"'}])assert.equal(dnsResult(dns({Answer:[record]}),name,value),'not_found');
 assert.equal(dnsResult(dns({Status:3,Answer:undefined}),name,value),'not_found');
});
test('lookup uses a fixed HTTPS DNS resolver with no auth headers or caller URLs',async()=>{
 const {lookupChallenge}=await ready;let called=0;
 const fetcher=async(url,init)=>{called++;const u=new URL(url);assert.equal(u.origin,'https://dns.google');assert.equal(u.pathname,'/resolve');assert.equal(u.searchParams.get('name'),name);assert.equal(u.searchParams.get('edns_client_subnet'),'0.0.0.0/0');assert.equal(init.headers.Authorization,undefined);assert.equal(init.redirect,'error');return Response.json(dns());};
 assert.equal(await lookupChallenge(challenge,fetcher),'found');
 for(const patch of [{hostname:'evil.test/path'},{record_name:'evil.test'},{record_value:'bad'},{attempt_id:'bad'}])assert.equal(await lookupChallenge({...challenge,...patch},fetcher),'unavailable');
 assert.equal(called,1);
 assert.equal(await lookupChallenge(challenge,async()=>{throw Error('timeout');}),'unavailable');
 assert.equal(await lookupChallenge(challenge,async()=>new Response('x'.repeat(65537))),'unavailable');
});
async function app({auth=true,begin=challenge,complete={ok:true},lookupResult='found'}={}){
 const {createHandler}=await ready;const calls=[];
 const handler=createHandler({authenticate:async()=>auth?uid:null,rpc:async(jwt,action)=>{calls.push(['rpc',action]);return action==='begin'?begin:{...challenge,state:'verified',verified_at:'2026-11-04T09:00:00Z',last_result:'found'};},lookup:async()=>{calls.push(['lookup']);return lookupResult;},finish:async(...args)=>{calls.push(['finish',...args]);return complete;}});
 return {calls,send:async(body={action:'verify'},extra={})=>{const r=await handler(new Request('https://function.test',{method:'POST',headers:{Origin:'https://sma-automation.com',Authorization:'Bearer synthetic'},body:JSON.stringify(body),...extra}));return {status:r.status,body:r.status===204?null:await r.json()};}};
}
test('Edge verifies auth, fetches server challenge and records only that user and attempt',async()=>{
 const {send,calls}=await app();assert.equal((await send()).body.state,'verified');assert.deepEqual(calls,[['rpc','begin'],['lookup'],['finish',uid,attempt,'found'],['rpc','get']]);
});
test('wrong auth, client-supplied account/domain/results and rate limits cannot trigger lookup',async()=>{
 const invalid=await app({auth:false});assert.equal((await invalid.send()).status,401);assert.equal(invalid.calls.length,0);
 for(const body of [{action:'verify',user_id:uid},{action:'verify',hostname:'attacker.com'},{action:'verify',result:'found'},{action:'begin'},null,[]]){const a=await app();assert.equal((await a.send(body)).status,400);assert.equal(a.calls.length,0);}
 const a=await app({begin:{ok:false,code:'CHECK_RATE_LIMITED'}});assert.equal((await a.send()).body.code,'CHECK_RATE_LIMITED');assert.deepEqual(a.calls,[['rpc','begin']]);
});
test('stale completion is surfaced and failed DNS is never reported as new success',async()=>{
 const a=await app({complete:{ok:false,code:'CHECK_STALE'},lookupResult:'unavailable'});assert.equal((await a.send()).body.code,'CHECK_STALE');assert.deepEqual(a.calls.at(-1),['finish',uid,attempt,'unavailable']);
});
test('HTTP method, CORS, body size and malformed JSON are bounded',async()=>{
 const a=await app();assert.equal((await a.send(null,{method:'OPTIONS',body:undefined})).status,204);
 assert.equal((await a.send(null,{method:'GET',body:undefined})).status,405);
 assert.equal((await a.send({}, {headers:{Origin:'https://evil.test',Authorization:'Bearer synthetic'}})).status,403);
 for(const body of ['{','x'.repeat(513)])assert.equal((await a.send(null,{body})).status,400);
 assert.equal(a.calls.length,0);
});
test('client binds proof to saved host and revision and rejects invented verified state',async()=>{
 const {readDomainCheck}=await clientReady;const draft={revision:1,draft:{mode:'existing',website_url:'https://example.com/'}};
 assert.equal(readDomainCheck(challenge,draft).recordValue,value);
 for(const patch of [{revision:2},{hostname:'other.com'},{record_name:'other.com'},{record_value:value+'\n'},{state:'verified',verified_at:null},{verified_at:'not-a-date'},{record_type:'CNAME'}])assert.throws(()=>readDomainCheck({...challenge,...patch},draft));
 assert.equal(readDomainCheck({...challenge,state:'verified',verified_at:'2026-11-04T09:00:00Z'},draft).state,'verified');
});
