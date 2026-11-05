const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const site='ab990000-0000-4000-8000-000000000071',id='ab990000-0000-4000-8000-000000000072',origin='https://test.sma-automation.com';
async function fixture(config={[origin]:site},resolver){
 const {createWebsiteImageHandler}=await import('../supabase/functions/sma-website-image/handler.mjs'),{imageDigest}=await import('../supabase/functions/_shared/website-image.mjs');
 const bytes=new Uint8Array(await fs.readFile(__dirname+'/fixtures/website-images/logo.png'));let available=true,downloads=0,revokeDuringDownload=false;
 const calls=[];
 const handler=createWebsiteImageHandler({publicSiteOrigins:config,resolvePublicOrigin:resolver,authenticate:()=>{throw Error('must not authenticate');},rpc:async(_name,p)=>{calls.push(p);return available?{ok:true,id,mime:'image/png',size:bytes.length,sha256:await imageDigest(bytes)}:{ok:false,code:'IMAGE_UNAVAILABLE'};},download:async()=>{downloads++;if(revokeDuringDownload)available=false;return bytes;},upload:()=>{throw Error('must not upload');},remove:()=>{throw Error('must not remove');}});
 return {handler,calls,bytes,get downloads(){return downloads;},offline(){available=false;},revokeDuringDownload(){revokeDuringDownload=true;}};
}
const req=(options={},query='?id='+id+'&site='+site)=>new Request('https://api.example.test/image'+query,{...options,headers:{origin,...options.headers}});
test('additional origins are disabled by default',async()=>{
 const f=await fixture({}),r=await f.handler(req());assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);assert.equal(f.calls.length,0);
});
test('configured public image origin serves only its site with both snapshot checks',async()=>{
 const f=await fixture(),r=await f.handler(req());assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),origin);assert.equal(r.headers.get('access-control-allow-credentials'),null);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('access-control-allow-methods'),'GET, OPTIONS');
 assert.deepEqual(new Uint8Array(await r.arrayBuffer()),f.bytes);assert.equal(f.calls.length,2);assert(f.calls.every(c=>c.p_action==='read_public'&&c.p_user_id===null&&c.p_input.site_id===site));
});
test('configured origin permits only public GET preflights without owner authorization',async()=>{
 const f=await fixture(),headers={'access-control-request-method':'GET','access-control-request-headers':'ApiKey'};
 const r=await f.handler(req({method:'OPTIONS',headers}));assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-headers'),'apikey');assert.equal(f.calls.length,0);
 for(const altered of [{...headers,'access-control-request-method':'POST'},{...headers,'access-control-request-headers':'apikey, authorization'},{...headers,'access-control-request-headers':'x-other'},{}])assert.equal((await f.handler(req({method:'OPTIONS',headers:altered}))).status,403);
 assert.equal(f.calls.length,0);
});
test('configured origin cannot read another site, use private operations or reach storage through malformed requests',async()=>{
 const f=await fixture();
 for(const request of [req({},'?id='+id),req({},'?id='+id+'&site='+id),req({},'?id='+id+'&site='+site+'&site='+site),req({},'?id=bad&site='+site),req({method:'POST'}),req({method:'DELETE'}),req({headers:{authorization:'Bearer fixture'}}),req({headers:{origin:'https://test.sma-automation.com.evil.test'}}),req({headers:{origin:'null'}})]){const r=await f.handler(request);assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);}
 assert.equal(f.calls.length,0);assert.equal(f.downloads,0);
});
test('offline or unreferenced images remain unavailable and revocation during download discards bytes',async()=>{
 for(const before of [true,false]){const f=await fixture();if(before)f.offline();else f.revokeDuringDownload();const r=await f.handler(req());assert.equal(r.status,404);assert.equal(r.headers.get('access-control-allow-origin'),origin);assert.deepEqual(await r.json(),{ok:false,code:'IMAGE_UNAVAILABLE'});assert.equal(f.downloads,before?0:1);}
});
test('main SMA origin retains its original preflight and public reads',async()=>{
 const f=await fixture();let r=await f.handler(req({method:'OPTIONS',headers:{origin:'https://sma-automation.com'}}));assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-methods'),'GET, POST, OPTIONS');
 r=await f.handler(req({headers:{origin:'https://sma-automation.com'}}));assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),'https://sma-automation.com');
});
test('public-origin configuration rejects wildcards, paths, credentials and invalid IDs; handler snapshots it',async()=>{
 const {publicWebsiteOrigins}=await import('../supabase/functions/sma-website-image/handler.mjs');
 for(const config of [null,[],{'*':site},{'http://test.example.com':site},{'https://test.example.com/':site},{'https://test.example.com:443':site},{'https://user@test.example.com':site},{'https://a..example.com':site},{'https://sma-automation.com':site},{[origin]:'invalid'}])assert.throws(()=>publicWebsiteOrigins(config));
 const config={[origin]:site},f=await fixture(config);config[origin]=id;assert.equal((await f.handler(req())).status,200);
});

test('dynamic origin lookup overrides a stale static allowlist and fails closed',async()=>{
 for(const resolver of [async()=>false,async()=>{throw Error('offline');}]){
  const f=await fixture({[origin]:site},resolver),r=await f.handler(req());assert.equal(r.status,403);assert.equal(f.downloads,0);
 }
 const calls=[],f=await fixture({},async(o,s)=>{calls.push([o,s]);return o===origin&&s===site;});
 const r=await f.handler(req());assert.equal(r.status,200);assert.deepEqual(calls,[[origin,site],[origin,site]]);
});
test('address revocation during image download suppresses the bytes',async()=>{
 let checks=0;const f=await fixture({},async()=>++checks===1),r=await f.handler(req());assert.equal(r.status,404);assert.equal((await r.json()).code,'IMAGE_UNAVAILABLE');
});
