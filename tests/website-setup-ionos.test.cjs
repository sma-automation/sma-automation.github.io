const test=require('node:test');
const assert=require('node:assert/strict');
const modulePromise=import('../hosting/customer-website-setup/ionos.mjs');
const preflightPromise=import('../hosting/customer-website-setup/preflight.mjs');
const zoneId='11111111-1111-4111-8111-111111111111',recordId='22222222-2222-4222-8222-222222222222';
const plan={zone:'sma-automation.com',hostname:'test.sma-automation.com',target:'sma-customer-website-test.pages.dev'};
const key='publicprefix.ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789';
function fixture({records=[],onCreate,zoneType='NATIVE',beforeRead}={}){
 let current=structuredClone(records),reads=0;
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});
  assert.equal(options.headers['X-API-Key'],key);assert.equal(options.redirect,'error');
  assert.ok(options.signal);assert.equal(options.credentials,'omit');
  if(url.endsWith('/v1/zones'))return Response.json([{id:zoneId,name:plan.zone,type:zoneType}]);
  if(url.endsWith('/records')){
   assert.equal(options.method,'POST');
   const body=JSON.parse(options.body);assert.equal(body.length,1);
   const created={...body[0],id:recordId,rootName:plan.zone};
   current.push(created);
   if(onCreate)return onCreate(created);
   return Response.json([created],{status:201});
  }
  assert.equal(url,'https://api.hosting.ionos.com/dns/v1/zones/'+zoneId);
  reads++;if(beforeRead)current=beforeRead(reads,current);
  return Response.json({id:zoneId,name:plan.zone,type:zoneType,records:current});
 };
 return {calls,fetchImpl,get records(){return current;}};
}
const cname=(extra={})=>({id:recordId,name:plan.hostname,type:'CNAME',content:plan.target,disabled:false,ttl:3600,...extra});
async function client(f,options={}){const {createIonosDns}=await modulePromise;return createIonosDns({apiKey:key,authorizedZones:[plan.zone],fetchImpl:f.fetchImpl,...options});}

test('DNS plan only accepts a subdomain within an explicitly authorized zone and Pages target',async()=>{
 const {validatePlan}=await modulePromise;
 assert.deepEqual(validatePlan(plan),plan);
 for(const patch of [{hostname:plan.zone},{hostname:'sma-automation.com.attacker.com'},{hostname:'https://test.sma-automation.com'},{hostname:'test.sma-automation.com:443'},{hostname:'*.sma-automation.com'},{hostname:'TEST.sma-automation.com'},{target:'localhost'},{target:'pages.dev.attacker.com'},{target:'user.pages.dev/path'},{zone:'sma-automation.com',hostname:'other.com'},{customerId:4}])assert.throws(()=>validatePlan({...plan,...patch}));
});
test('missing/malformed credential and missing private allowlist fail before network',async()=>{
 const {createIonosDns}=await modulePromise;
 for(const apiKey of [undefined,'','Bearer '+key,'public.secret'])assert.throws(()=>createIonosDns({apiKey,authorizedZones:[plan.zone]}));
 assert.throws(()=>createIonosDns({apiKey:key}),/ZONE_AUTHORIZATION_REQUIRED/);
 const f=fixture(),dns=await client(f,{authorizedZones:['other.com']});await assert.rejects(()=>dns.ensureCname(plan),/ZONE_NOT_AUTHORIZED/);assert.equal(f.calls.length,0);
});
test('copy whitespace around complete key parts is normalized before sending the header',async()=>{
 for(const apiKey of [' '+key+'\r\n',key.replace('.',' \n.\t'), '\u00a0'+key+'\u00a0']){
  const f=fixture({records:[cname()]});
  const result=await (await client(f,{apiKey})).inspect(plan);
  assert.equal(result.state,'present');assert.equal(f.calls.length,2);
  assert.ok(f.calls.every(c=>c.options.headers['X-API-Key']===key&&c.options.method==='GET'));
 }
});
test('malformed keys receive actionable fixed codes without revealing either part or making requests',async()=>{
 const {createIonosDns}=await modulePromise;let calls=0;
 for(const [apiKey,expected] of [
  [' \r\n','IONOS_ACCESS_REQUIRED'],
  [key.replace('.',''),'IONOS_KEY_SEPARATOR_MISSING'],
  ['publicprefix.','IONOS_KEY_PART_MISSING'],
  ['.'+key.split('.')[1],'IONOS_KEY_PART_MISSING'],
  [key+'.extra','IONOS_KEY_SEPARATOR_INVALID'],
  [key.replace('ABC','A\nBC'),'IONOS_KEY_INTERNAL_WHITESPACE'],
  [key.replace('_','!'),'IONOS_KEY_CHARACTERS_INVALID'],
  ['publicprefix.short','IONOS_KEY_LENGTH_INVALID'],
  ['x'.repeat(2049),'IONOS_KEY_FORMAT_INVALID']
 ]){
  assert.throws(()=>createIonosDns({apiKey,authorizedZones:[plan.zone],fetchImpl:async()=>{calls++;}}),e=>e.code===expected&&e.message===expected&&!e.stack.includes(apiKey));
 }
 assert.equal(calls,0);
 const {preflight}=await preflightPromise;
 const report=await preflight({env:{IONOS_DNS_API_KEY:key.replace('.','')},fetchImpl:async()=>{calls++;}});
 assert.deepEqual(report,{cloudflare:'CLOUDFLARE_ACCESS_REQUIRED',ionos:'IONOS_KEY_SEPARATOR_MISSING',dnsModified:false,ready:false});
 assert.equal(calls,0);assert.ok(!JSON.stringify(report).includes(key.split('.')[1]));
});
test('inspection never writes and returns only the matched zone/record identifiers',async()=>{
 const f=fixture({records:[cname()]});const result=await (await client(f)).inspect(plan);
 assert.deepEqual(result,{state:'present',recordId,zoneId});assert.ok(f.calls.every(c=>c.options.method==='GET'));
});
test('creates one CNAME and leaves root/mail records untouched; re-running does not duplicate',async()=>{
 const mail=cname({id:'33333333-3333-4333-8333-333333333333',name:plan.zone,type:'MX',content:'mx00.ionos.de'});
 const root=cname({id:'44444444-4444-4444-8444-444444444444',name:plan.zone,type:'A',content:'185.199.108.153'});
 const f=fixture({records:[mail,root]}),dns=await client(f);
 assert.equal((await dns.ensureCname(plan)).changed,true);assert.equal((await dns.ensureCname(plan)).changed,false);
 assert.deepEqual(f.records.slice(0,2),[mail,root]);
 const writes=f.calls.filter(c=>c.options.method!=='GET');assert.equal(writes.length,1);
 assert.deepEqual(JSON.parse(writes[0].options.body),[{name:plan.hostname,type:'CNAME',content:plan.target,ttl:3600,prio:0,disabled:false}]);
});
test('existing exact CNAME is reused despite case/trailing-dot presentation',async()=>{
 const f=fixture({records:[cname({name:'TEST.SMA-AUTOMATION.COM.',content:plan.target.toUpperCase()+'.'})]});
 assert.equal((await (await client(f)).ensureCname(plan)).changed,false);assert.ok(f.calls.every(c=>c.options.method==='GET'));
});
test('refuses A/AAAA/MX/TXT/CNAME conflicts, disabled records and duplicate records',async()=>{
 for(const records of [[cname({type:'A',content:'1.1.1.1'})],[cname({type:'AAAA',content:'::1'})],[cname({type:'MX'})],[cname({type:'TXT'})],[cname({content:'foreign.pages.dev'})],[cname({disabled:true})],[cname(),cname({id:'55555555-5555-4555-8555-555555555555'})]]){
  const f=fixture({records});await assert.rejects(()=>(client(f)).then(dns=>dns.ensureCname(plan)),/DNS_RECORD_CONFLICT/);assert.ok(f.calls.every(c=>c.options.method==='GET'));
 }
});
test('refuses subtree, wildcard and ancestor delegation rather than disabling another service',async()=>{
 for(const [custom,records] of [[plan,[cname({name:'mail.'+plan.hostname,type:'MX'})]],[plan,[cname({name:'*.sma-automation.com'})]],[{...plan,hostname:'test.customer.sma-automation.com'},[cname({name:'customer.sma-automation.com',type:'NS'})]],[{...plan,hostname:'test.customer.sma-automation.com'},[cname({name:'customer.sma-automation.com',type:'CNAME'})]]]){
  const f=fixture({records});await assert.rejects(()=>(client(f)).then(dns=>dns.ensureCname(custom)),/CONFLICT/);assert.ok(f.calls.every(c=>c.options.method==='GET'));
 }
});
test('a competing edit before creation prevents the POST',async()=>{
 const f=fixture({beforeRead:(read,records)=>read===2?[cname({type:'A',content:'1.2.3.4'})]:records});
 await assert.rejects(()=>(client(f)).then(dns=>dns.ensureCname(plan)),/CONFLICT/);assert.ok(f.calls.every(c=>c.options.method==='GET'));
});
test('matching record arriving during preflight is adopted without a write',async()=>{
 const f=fixture({beforeRead:(read,records)=>read===2?[cname()]:records});
 assert.equal((await (await client(f)).ensureCname(plan)).changed,false);assert.ok(f.calls.every(c=>c.options.method==='GET'));
});
test('lost create response stays unconfirmed and next run reads the existing result',async()=>{
 const f=fixture({onCreate:()=>{throw Error('Network lost with sensitive token '+key);}}),dns=await client(f);
 await assert.rejects(()=>dns.ensureCname(plan),error=>error.code==='DNS_WRITE_UNCONFIRMED'&&!error.message.includes(key));
 assert.equal((await dns.ensureCname(plan)).changed,false);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
});
test('provider create success alone does not mark DNS ready',async()=>{
 const f=fixture({beforeRead:(read,records)=>read>=3?[]:records});
 await assert.rejects(()=>(client(f)).then(dns=>dns.ensureCname(plan)),/DNS_WRITE_UNCONFIRMED/);
});
test('nonnative zones and inconsistent/malformed records stop before writes',async()=>{
 const slave=fixture({zoneType:'SLAVE'});await assert.rejects(()=>(client(slave)).then(dns=>dns.inspect(plan)),/ZONE_UNAVAILABLE/);
 for(const records of [[cname({id:'../../bad'})],[cname({disabled:undefined})],[cname({name:'other.com'})],[cname(),cname()]]){
  const f=fixture({records});await assert.rejects(()=>(client(f)).then(dns=>dns.ensureCname(plan)),/INVALID_RECORD_RESPONSE/);assert.ok(f.calls.every(c=>c.options.method==='GET'));
 }
});
test('provider errors are bounded fixed codes and never leak credential/body',async()=>{
 for(const [status,expected] of [[401,'IONOS_KEY_REJECTED'],[403,'IONOS_ACCESS_FORBIDDEN'],[429,'IONOS_RATE_LIMITED'],[500,'IONOS_UNAVAILABLE'],[302,'IONOS_UNAVAILABLE']]){
  const dns=await client({fetchImpl:async()=>new Response(key,{status})});await assert.rejects(()=>dns.inspect(plan),e=>e.code===expected&&!e.message.includes(key));
 }
 const malformed=await client({fetchImpl:async()=>new Response('not JSON '+key)});await assert.rejects(()=>malformed.inspect(plan),/IONOS_RESPONSE_INVALID/);
 const oversized=await client({fetchImpl:async()=>new Response('x'.repeat(2*1024*1024+1))});await assert.rejects(()=>oversized.inspect(plan),/IONOS_RESPONSE_TOO_LARGE/);
});
test('preflight checks actual Cloudflare binding but makes no claim about missing IONOS access',async()=>{
 const {preflight}=await preflightPromise;const calls=[];
 const result=await preflight({env:{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN_READONLY:'test-token'},fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({success:true,result:{name:plan.hostname,status:'active'}});}});
 assert.deepEqual(result,{cloudflare:'TEST_DOMAIN_ACTIVE',ionos:'IONOS_ACCESS_REQUIRED',dnsModified:false,ready:false});assert.equal(calls.length,1);assert.equal(calls[0].options.method,undefined);
});
test('preflight readiness requires both exact existing provider states',async()=>{
 const {preflight}=await preflightPromise;const f=fixture({records:[cname()]});
 const result=await preflight({env:{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN_READONLY:'test-token',IONOS_DNS_API_KEY:key},fetchImpl:async(url,options)=>url.includes('api.cloudflare.com')?Response.json({success:true,result:{name:plan.hostname,status:'active'}}):f.fetchImpl(url,options)});
 assert.deepEqual(result,{cloudflare:'TEST_DOMAIN_ACTIVE',ionos:'TEST_CNAME_CONFIRMED',dnsModified:false,ready:true});assert.ok(f.calls.every(c=>c.options.method==='GET'));
});
