const test=require('node:test'),assert=require('node:assert/strict');
const mod=()=>import('../app/assets/company-profile-model.mjs');
const id='ab770000-0000-4000-8000-000000000071';
async function profile(){return {...(await mod()).emptyCompanyProfile(),company_name:'SHK Musterbetrieb',street:'Musterstraße',house_number:'12a',postal_code:'1010',city:'Wien',country:'Österreich',public_email:'office@example.com'};}
const state=(p,revision=1)=>({ok:true,profile:p,revision,can_edit:true,suggested:null});
test('company profile validates structured public details and formats one address',async()=>{
 const m=await mod(),p=await profile();assert.deepEqual(m.readCompanyProfile(p),p);assert.equal(m.companyAddress(p),'Musterstraße 12a\n1010 Wien\nÖsterreich');
 assert.equal(m.companyAddress({...m.emptyCompanyProfile(),city:'Wien'}),'Wien');
 for(const bad of [{...p,company_name:''},{...p,city:'x'.repeat(101)},{...p,private_email:'x'},{...p,phone:'x\n1'},{...p,public_email:'x@example.com?bcc=evil'},{...p,street:'x\u0000'}])assert.throws(()=>m.readCompanyProfile(bad),{code:'INVALID_PROFILE'});
 assert.equal(m.readCompanyProfile({...p,opening_hours:'Mo–Fr\n08–17 Uhr'}).opening_hours,'Mo–Fr\n08–17 Uhr');
});
test('company state rejects mismatched revisions and keeps account data absent',async()=>{
 const m=await mod(),p=await profile();assert.equal(m.readCompanyState(state(p)).revision,1);
 for(const bad of [state(p,0),state(null,1),state(p,-1),{...state(p),can_edit:'true'},{...state(p),suggested:{company_name:'x'}}])assert.throws(()=>m.readCompanyState(bad),{code:'INVALID_RESPONSE'});
 assert.equal(m.readCompanyState(state(null,0)).profile,null);
});
test('lost profile replies retry the same request and require the loaded revision',async()=>{
 const m=await mod(),p=await profile(),calls=[];let fail=true;
 const client=m.createCompanyProfileClient({getOwnerId:async()=>id,uuid:()=>id,request:async(action,input)=>{calls.push({action,input});if(action==='save'&&fail){fail=false;throw Error('lost');}return state(p,action==='get'?4:5);}});
 await client.load();await assert.rejects(client.save(p));await client.save(p);
 assert.deepEqual(calls[1],calls[2]);assert.equal(calls[1].input.expected_revision,4);assert.deepEqual(calls.map(c=>c.action),['get','save','save']);
});
test('owner changes and invalidation discard profile results and prevent cross-account saves',async()=>{
 const m=await mod(),p=await profile();let owner=id,release;
 const client=m.createCompanyProfileClient({getOwnerId:async()=>owner,request:()=>new Promise(r=>release=r)});
 let pending=client.load();await new Promise(r=>setImmediate(r));owner='other';release(state(p));await assert.rejects(pending,{code:'AUTH_REQUIRED'});await assert.rejects(client.save(p),{code:'AUTH_REQUIRED'});
 pending=client.load();await new Promise(r=>setImmediate(r));client.invalidate();release(state(p));await assert.rejects(pending,{code:'AUTH_REQUIRED'});
});
test('website writes carry the company revision that was actually previewed',async()=>{
 const m=await import('../app/assets/customer-website-model.mjs'),p=await profile(),calls=[];
 const content={...Object.fromEntries(Object.keys(m.contentLimits).map(k=>[k,''])),name:p.company_name,headline:'Willkommen'};
 const r={ok:true,site_id:id,revision:2,content,company_profile:p,company_revision:7,published:false,publicly_available:false,has_changes:true,can_edit:true,shop_url:null,website_url:'https://sma-automation.com/app/website.html?site='+id};
 const client=m.createCustomerWebsiteClient({getOwnerId:async()=>id,uuid:()=>id,request:async(action,input)=>{calls.push({action,input});return r;}});
 await client.load();await client.save(content);await client.publish();
 assert.equal(calls[1].input.expected_company_revision,7);assert.equal(calls[2].input.expected_company_revision,7);
 assert.throws(()=>m.readCustomerWebsite({...r,company_revision:0}),{code:'INVALID_RESPONSE'});
});
