const test=require('node:test'),assert=require('node:assert/strict');
const mod=()=>import('../app/assets/customer-website-model.mjs');
const id='ab660000-0000-4000-8000-000000000061';
async function content(){const m=await mod();return {...Object.fromEntries(Object.keys(m.contentLimits).map(k=>[k,''])),name:'SHK Musterbetrieb',headline:'Wasser. Wärme. Wohlfühlen.'};}
function state(c,revision=1){return {ok:true,site_id:id,revision,content:c,published:false,publicly_available:false,has_changes:true,can_edit:true,shop_url:null,website_url:'https://sma-automation.com/app/website.html?site='+id};}
test('website content accepts plain text and rejects control characters, extra fields and email injection',async()=>{
 const m=await mod(),c=await content();assert.equal(m.readWebsiteContent({...c,about:'<img src=x onerror=alert(1)>'}).about,'<img src=x onerror=alert(1)>');
 for(const bad of [{...c,name:''},{...c,headline:'x'.repeat(161)},{...c,x:'x'},{...c,about:'x\u0000'},{...c,contact_email:'x@example.com?bcc=evil'},{...c,contact_email:'x@local'}])assert.throws(()=>m.readWebsiteContent(bad),{code:'INVALID_CONTENT'});
 assert.equal(m.readWebsiteContent({...c,contact_email:'info@example.com'}).contact_email,'info@example.com');
});
test('website public routes and server states reject mismatched URLs and ambiguous selectors',async()=>{
 const m=await mod(),c=await content();assert.equal(m.pageMode('?preview=1').preview,true);assert.equal(m.pageMode('?site='+id).siteId,id);
 for(const search of ['','?site=x','?preview=1&site='+id,'?preview=1&preview=1'])assert.equal(m.pageMode(search),null);
 assert.equal(m.readCustomerWebsite(state(c)).siteId,id);
 assert.throws(()=>m.readCustomerWebsite({...state(c),website_url:'https://evil.example'}),{code:'INVALID_RESPONSE'});
});
test('lost saves reuse the request ID and revision, and do not publish implicitly',async()=>{
 const m=await mod(),c=await content(),calls=[];let fail=true;
 const client=m.createCustomerWebsiteClient({getOwnerId:async()=>id,uuid:()=>id,request:async(action,input)=>{calls.push({action,input});if(action==='save'&&fail){fail=false;throw Error('lost');}return state(c,action==='get'?1:2);}});
 await client.load();await assert.rejects(client.save(c));await client.save(c);
 assert.deepEqual(calls[1],calls[2]);assert.equal(calls[1].input.expected_revision,1);assert.equal(calls.filter(c=>c.action==='publish').length,0);
});
test('account changes discard in-flight website results and block subsequent writes',async()=>{
 const m=await mod(),c=await content();let owner=id,release;
 const client=m.createCustomerWebsiteClient({getOwnerId:async()=>owner,request:()=>new Promise(r=>release=r)});
 const pending=client.load();await new Promise(r=>setImmediate(r));owner='new-owner';release(state(c));await assert.rejects(pending,{code:'AUTH_REQUIRED'});await assert.rejects(client.publish(),{code:'AUTH_REQUIRED'});
});
test('explicit invalidation discards same-account stale results',async()=>{
 const m=await mod(),c=await content();let release;const client=m.createCustomerWebsiteClient({getOwnerId:async()=>id,request:()=>new Promise(r=>release=r)});
 const pending=client.load();await new Promise(r=>setImmediate(r));client.invalidate();release(state(c));await assert.rejects(pending,{code:'AUTH_REQUIRED'});
});
test('website design keeps legacy content valid and accepts every fixed palette and motif',async()=>{
 const m=await mod(),c=await content();assert.deepEqual(m.readWebsiteContent(c),c);
 for(const accent of m.appearanceOptions.accent)for(const hero of m.appearanceOptions.hero){
  const styled={...c,accent,hero};assert.deepEqual(m.readWebsiteContent(styled),styled);
 }
});
test('website design rejects arbitrary CSS, URLs, unknown choices and non-string values',async()=>{
 const m=await mod(),c=await content();
 for(const key of ['accent','hero'])for(const value of [null,{},[],false,1,'','blue; background:url(https://example.com)','<img src=x>','https://example.com'])assert.throws(()=>m.readWebsiteContent({...c,[key]:value}),{code:'INVALID_CONTENT'});
 assert.throws(()=>m.readWebsiteContent({...c,style:'color:red'}),{code:'INVALID_CONTENT'});
});
test('design-only saves preserve text and retry the same revision without publishing',async()=>{
 const m=await mod(),c={...await content(),accent:'green',hero:'abstract'},calls=[];let fail=true;
 const client=m.createCustomerWebsiteClient({getOwnerId:async()=>id,uuid:()=>id,request:async(action,input)=>{calls.push({action,input});if(action==='save'&&fail){fail=false;throw Error('lost');}return state(action==='save'?input.content:c,action==='save'?2:1);}});
 await client.load();await assert.rejects(client.save(c));const result=await client.save(c);
 assert.deepEqual(result.content,c);assert.deepEqual(calls[1],calls[2]);assert(!calls.some(c=>c.action==='publish'));
});
