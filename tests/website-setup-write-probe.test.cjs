const test=require('node:test');
const assert=require('node:assert/strict');
const modulePromise=import('../hosting/customer-website-setup/write-probe.mjs');
const zoneId='11111111-1111-4111-8111-111111111111',recordId='probe-record_123';
const host='setup-check-12345-1.sma-automation.com';
const key='publicprefix.ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789';
const env={GITHUB_RUN_ID:'12345',GITHUB_RUN_ATTEMPT:'1',IONOS_DNS_API_PREFIX:'publicprefix',IONOS_DNS_API_KEY:key.split('.')[1]};
const cname={id:recordId,name:host,type:'CNAME',content:'sma-customer-website-test.pages.dev',disabled:false,ttl:3600};
function fixture({preexisting=false,deleteStatus=204,alterAfterCreate=false,loseCreateResponse=false}={}){
 const initial=[{id:'root-record',name:'sma-automation.com',type:'A',content:'185.199.108.153',disabled:false},{id:'mail-record',name:'sma-automation.com',type:'MX',content:'mx00.ionos.de',disabled:false}];
 let records=structuredClone(initial),created=false,readsAfterCreate=0;
 if(preexisting)records.push({...cname});
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,method:options.method});
  assert.equal(options.headers['X-API-Key'],key);assert.equal(options.redirect,'error');
  if(options.method==='POST'){
   assert.equal(url,'https://api.hosting.ionos.com/dns/v1/zones/'+zoneId+'/records');
   const body=JSON.parse(options.body);assert.equal(body.length,1);assert.equal(body[0].name,host);
   records.push({...body[0],id:recordId});created=true;
   if(loseCreateResponse)throw Error('sensitive body '+key);
   return Response.json([{...body[0],id:recordId}],{status:201});
  }
  if(options.method==='DELETE'){
   assert.equal(url,'https://api.hosting.ionos.com/dns/v1/zones/'+zoneId+'/records/'+recordId);
   if(deleteStatus===204)records=records.filter(r=>r.id!==recordId);
   return new Response(null,{status:deleteStatus});
  }
  assert.equal(options.method,'GET');
  if(url.endsWith('/v1/zones'))return Response.json([{id:zoneId,name:'sma-automation.com',type:'NATIVE'}]);
  assert.equal(url,'https://api.hosting.ionos.com/dns/v1/zones/'+zoneId);
  if(created){readsAfterCreate++;if(alterAfterCreate&&readsAfterCreate>=2)records=records.map(r=>r.id===recordId?{...r,content:'foreign.pages.dev'}:r);}
  return Response.json({id:zoneId,name:'sma-automation.com',type:'NATIVE',records});
 };
 return {fetchImpl,calls,initial,get records(){return records;}};
}
test('live probe creates one disposable host, reuses it and removes only its exact record',async()=>{
 const {writeProbe}=await modulePromise;const f=fixture();
 const report=await writeProbe({env,fetchImpl:f.fetchImpl});
 assert.deepEqual(report,{status:'DNS_WRITE_CHECK_PASSED',created:true,repeatedWithoutDuplicate:true,removed:true,temporaryHost:host});
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1);
 assert.deepEqual(f.records,f.initial);assert.ok(!JSON.stringify(report).includes(key));
});
test('preexisting host is never adopted or removed by the disposable probe',async()=>{
 const {writeProbe}=await modulePromise;const f=fixture({preexisting:true});
 const report=await writeProbe({env,fetchImpl:f.fetchImpl});
 assert.equal(report.status,'PROBE_HOST_ALREADY_PRESENT');assert.ok(f.calls.every(c=>c.method==='GET'));assert.equal(f.records.length,3);
});
test('failed deletion is reported with cleanup required, not as a passing write test',async()=>{
 const {writeProbe}=await modulePromise;const f=fixture({deleteStatus:500});
 const report=await writeProbe({env,fetchImpl:f.fetchImpl});
 assert.equal(report.status,'PROBE_CLEANUP_REQUIRED');assert.equal(report.removed,false);assert.equal(report.cleanup,'PROBE_CLEANUP_UNCONFIRMED');
 assert.equal(f.records.length,3);assert.deepEqual(f.records.slice(0,2),f.initial);
});
test('concurrent retargeting prevents cleanup from deleting a modified record',async()=>{
 const {writeProbe}=await modulePromise;const f=fixture({alterAfterCreate:true});
 const report=await writeProbe({env,fetchImpl:f.fetchImpl});
 assert.equal(report.status,'PROBE_CLEANUP_REQUIRED');assert.equal(report.removed,false);assert.equal(f.calls.filter(c=>c.method==='DELETE').length,0);
});
test('lost create response requires review rather than guessing the record to delete',async()=>{
 const {writeProbe}=await modulePromise;const f=fixture({loseCreateResponse:true});
 const report=await writeProbe({env,fetchImpl:f.fetchImpl});
 assert.equal(report.status,'DNS_WRITE_UNCONFIRMED');assert.equal(report.cleanup,'REVIEW_REQUIRED');assert.equal(f.calls.filter(c=>c.method==='DELETE').length,0);
 assert.ok(!JSON.stringify(report).includes(key));
});
test('missing or untrusted run identifier stops before any request',async()=>{
 const {writeProbe}=await modulePromise;let calls=0;
 for(const GITHUB_RUN_ID of ['',undefined,'../other','1.example.com']){
  const report=await writeProbe({env:{...env,GITHUB_RUN_ID},fetchImpl:async()=>{calls++;}});
  assert.equal(report.status,'PROBE_RUN_REQUIRED');
 }
 assert.equal(calls,0);
});
