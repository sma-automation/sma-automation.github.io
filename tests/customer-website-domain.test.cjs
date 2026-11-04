const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const site='ab990000-0000-4000-8000-000000000071',other='ab990000-0000-4000-8000-000000000072',origin='https://test.sma-automation.com',binding={origin,siteId:site};
const model=()=>import('../app/assets/customer-website-domain-model.mjs');
test('customer domain resolves only its assigned HTTPS root and preserves page anchors',async()=>{
 const {domainPageSearch}=await model();
 for(const suffix of ['/','/index.html','/#kontakt'])assert.equal(domainPageSearch(origin+suffix,binding),'?site='+site);
});
test('foreign hosts, nonstandard ports, paths and user queries cannot choose a customer or private preview',async()=>{
 const {domainPageSearch}=await model();
 for(const url of ['http://test.sma-automation.com/','https://test.sma-automation.com:8443/','https://test.sma-automation.com.evil.example/','https://sample.pages.dev/','https://test.sma-automation.com./',origin+'/?preview=1',origin+'/?site='+other,origin+'/?site='+site,origin+'/?tracking=1',origin+'/app/website-builder.html','https://user:password@test.sma-automation.com/'])assert.equal(domainPageSearch(url,binding),'',url);
});
test('domain binding rejects malformed config and copies caller-owned values',async()=>{
 const {readDomainBinding,domainPageSearch}=await model();
 for(const value of [null,[],{...binding,secret:'no'}, {...binding,siteId:'bad'}, {...binding,origin:'https://test.sma-automation.com/'},{...binding,origin:'https://test.sma-automation.com:443'},{...binding,origin:'https://*.example.com'},{...binding,origin:'https://a..example.com'},{...binding,origin:'https://-a.example.com'}]){assert.throws(()=>readDomainBinding(value));assert.equal(domainPageSearch(origin+'/',value),'');}
 const input={...binding},copy=readDomainBinding(input);input.siteId=other;assert.equal(copy.siteId,site);assert(Object.isFrozen(copy));
});
test('static build has a complete module graph, identical styles and no auth client, dashboard or customer content',async()=>{
 const {buildCustomerWebsite,publicAssets}=await import('../hosting/customer-website/build.mjs');
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'sma-domain-'));
 try{
  const built=await buildCustomerWebsite({...binding,out});assert.equal(built.files.length,publicAssets.length+6);
  for(const name of built.files.filter(n=>n.endsWith('.mjs'))){
   const text=await fs.readFile(path.join(out,name),'utf8');
   for(const match of text.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/g)){
    assert(match[2].startsWith('.'),`external import in ${name}`);
    const target=path.posix.normalize(path.posix.join(path.posix.dirname(name),match[2].split('?')[0]));assert(built.files.includes(target),`${name} -> ${target}`);
   }
   assert(!/getSession|createClient|sb_secret_|service_role/.test(text),name);
  }
  assert.deepEqual(await fs.readFile(path.join(out,'assets/customer-website.css')),await fs.readFile(path.join(__dirname,'../app/assets/customer-website.css')));
  assert(built.files.includes('404.html'));assert(!built.files.some(name=>/editor|fixture|CNAME|config\.toml|\.sql|test\./.test(name)));
  assert.match(await fs.readFile(path.join(out,'_headers'),'utf8'),/frame-ancestors 'none'/);
  assert.match(await fs.readFile(path.join(out,'binding.mjs'),'utf8'),new RegExp(site));
  await assert.rejects(buildCustomerWebsite({...binding,out}),/OUTPUT_NOT_EMPTY/);
 }finally{await fs.rm(out,{recursive:true,force:true});}
});
test('build refuses the existing main domain and invalid configuration before creating files',async()=>{
 const {buildCustomerWebsite}=await import('../hosting/customer-website/build.mjs');
 await assert.rejects(buildCustomerWebsite({...binding,origin:'https://sma-automation.com',out:'/unused'}),/INVALID_BUILD_TARGET/);
 await assert.rejects(buildCustomerWebsite({...binding,siteId:'invalid',out:'/unused'}));
});
test('public transport omits cookies and owner credentials and binds every image to a site',async()=>{
 const api=await import('../app/assets/customer-website-public-api.mjs'),before=global.fetch,calls=[];
 global.fetch=async(url,options)=>{calls.push({url,options});return String(url).includes('/rpc/')?Response.json({ok:false,code:'NOT_AVAILABLE'}):new Response(new Uint8Array(24),{headers:{'content-type':'image/png'}});};
 try{
  assert.equal((await api.publicWebsiteRequest(site)).code,'NOT_AVAILABLE');await api.websiteImageRequest(other,site);
  assert.equal(JSON.parse(calls[0].options.body).p_site_id,site);
  assert.equal(new URL(calls[1].url).searchParams.get('site'),site);
  for(const {options} of calls){assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(new Headers(options.headers).get('authorization'),null);assert(new Headers(options.headers).has('apikey'));}
  await assert.rejects(api.websiteImageRequest(other,null));await assert.rejects(api.publicWebsiteRequest('bad'));assert.equal(calls.length,2);
 }finally{global.fetch=before;}
});
test('public transport rejects failed, wrong-type and oversized image responses',async()=>{
 const api=await import('../app/assets/customer-website-public-api.mjs'),before=global.fetch;
 try{
  for(const response of [new Response('',{status:404}),new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}}),new Response(new Uint8Array(2_000_001),{headers:{'content-type':'image/png'}})]){global.fetch=async()=>response;await assert.rejects(api.websiteImageRequest(other,site),/IMAGE_UNAVAILABLE/);}
 }finally{global.fetch=before;}
});
