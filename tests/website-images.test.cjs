const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const id='ab990000-0000-4000-8000-000000000091',uid='fa990000-0000-4000-8000-000000000091';
const moduleImage=()=>import('../supabase/functions/_shared/website-image.mjs');
const fixture=async(name='logo.png')=>new Uint8Array(await fs.readFile(__dirname+'/fixtures/website-images/'+name));
test('server accepts real bounded PNG and JPEG files with their actual dimensions',async()=>{
 const m=await moduleImage();assert.deepEqual(m.inspectWebsiteImage(await fixture()),{width:320,height:160,mime:'image/png'});assert.deepEqual(m.inspectWebsiteImage(await fixture('hero.jpg')),{width:960,height:640,mime:'image/jpeg'});
});
test('server rejects SVG, WebP, broken image data, trailing bytes and oversized payloads',async()=>{
 const m=await moduleImage(),png=await fixture();const broken=png.slice();broken[50]^=1;
 for(const b of [new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),await fixture('hero.webp'),png.slice(0,-1),broken,new Uint8Array([...png,1]),new Uint8Array(2_000_001)])assert.throws(()=>m.inspectWebsiteImage(b),{code:'IMAGE_FORMAT'});
});
test('bounded reads reject oversized declared and streamed bodies',async()=>{
 const m=await moduleImage();await assert.rejects(m.boundedImageBody(new Response('x',{headers:{'content-length':'2000001'}})),{code:'IMAGE_SIZE'});
 await assert.rejects(m.boundedImageBody(new Response(new Uint8Array(2_000_001))),{code:'IMAGE_SIZE'});
 assert.deepEqual(await m.boundedImageBody(new Response(await fixture())),await fixture());
});
test('browser-style JPEG color profiles are bounded; malformed or foreign APP2 metadata is rejected',async()=>{
 const m=await moduleImage(),bytes=await fixture('hero-icc.jpg');assert.deepEqual(m.inspectWebsiteImage(bytes),{width:960,height:640,mime:'image/jpeg'});
 const malformed=bytes.slice();const index=Buffer.from(bytes).indexOf('ICC_PROFILE');assert(index>0);malformed[index]=0;assert.throws(()=>m.inspectWebsiteImage(malformed),{code:'IMAGE_FORMAT'});
 const exif=bytes.slice();exif[index-3]=225;assert.throws(()=>m.inspectWebsiteImage(exif),{code:'IMAGE_FORMAT'});
});
test('a stalled image stream is cancelled at the request deadline',async()=>{
 const m=await moduleImage();let cancelled=false;await assert.rejects(m.boundedImageBody(new Response(new ReadableStream({pull(){},cancel(){cancelled=true;}})),{timeoutMs:5}),/UNAVAILABLE/);assert(cancelled);
});
test('source file checks allow only images with an explicit size limit',async()=>{
 const m=await import('../app/assets/customer-website-images.mjs');for(const type of ['image/png','image/jpeg','image/webp'])assert.equal(m.checkSourceImage({type,size:100}).size,100);
 for(const f of [{type:'image/svg+xml',size:100},{type:'image/jpeg',size:0},{type:'image/png',size:5_000_001}])assert.throws(()=>m.checkSourceImage(f));
});
test('browser image conversion resizes, re-encodes and closes decoded bitmaps',async()=>{
 const {prepareWebsiteImage}=await import('../app/assets/customer-website-images.mjs');let closed=0,draw,encoded,canvas;
 const doc={createElement:()=>canvas={getContext:()=>({drawImage:(_b,x,y,w,h)=>draw={w,h},fillRect(){}}),toBlob:(cb,mime,quality)=>{encoded={mime,quality};cb(new Blob(['normalized'],{type:mime}));}}};
 await prepareWebsiteImage({type:'image/webp',size:500},'hero',{doc,decode:async()=>({width:3200,height:2000,close(){closed++;}})});
 assert.deepEqual(draw,{w:1600,h:1000});assert.equal(encoded.mime,'image/jpeg');assert.equal(closed,1);
 await prepareWebsiteImage({type:'image/png',size:500},'logo',{doc,decode:async()=>({width:1024,height:512,close(){closed++;}})});assert.deepEqual(draw,{w:512,h:256});assert.equal(encoded.mime,'image/png');assert.equal(closed,2);
});
async function handlerFixture(options={}){
 const {createWebsiteImageHandler}=await import('../supabase/functions/sma-website-image/handler.mjs');const m=await moduleImage(),bytes=await fixture();let files=new Map(),ready=false,revoked=false;const calls=[];
 const meta={ok:true,id,mime:'image/png',size:bytes.length,width:320,height:160,sha256:await m.imageDigest(bytes)};
 const deps={authenticate:async()=>({id:uid}),rpc:async(name,p)=>{calls.push(p);if(revoked)return {ok:false,code:'IMAGE_UNAVAILABLE'};if(p.p_action==='reap')return {ok:true,images:[]};if(p.p_action==='complete')ready=true;return {...meta,state:ready?'ready':'reserved'};},upload:async(path,b)=>{if(files.has(path))return false;files.set(path,b);return true;},download:async path=>files.get(path)||bytes,remove:async path=>files.delete(path),...options};
 return {handler:createWebsiteImageHandler(deps),calls,files,bytes,revoke(){revoked=true;},meta};
}
const req=(bytes,extra={})=>new Request('https://example.com/?id='+id,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'image/png',origin:'https://sma-automation.com',...extra},body:bytes});
test('image upload authenticates, reserves an immutable object and completes the same ID',async()=>{
 const f=await handlerFixture();const r=await f.handler(req(f.bytes));assert.equal(r.status,200);assert.equal((await r.json()).image.id,id);assert.deepEqual(f.calls.map(c=>c.p_action),['reap','reserve','complete']);assert.equal(f.files.size,1);
 assert.equal((await f.handler(req(f.bytes))).status,200);assert.equal(f.files.size,1);
});
test('forbidden origins, missing authentication and malformed routes cannot reach storage',async()=>{
 let touched=0;const f=await handlerFixture({upload:()=>{touched++;},rpc:()=>{touched++;}});
 assert.equal((await f.handler(req(f.bytes,{origin:'https://evil.example'}))).status,403);
 assert.equal((await f.handler(new Request('https://example.com/?id='+id,{method:'POST',body:f.bytes}))).status,401);
 assert.equal((await f.handler(new Request('https://example.com/?id='+id+'&id='+id))).status,409);assert.equal(touched,0);
});
test('MIME spoofing and malformed images are rejected before any image reservation',async()=>{
 const f=await handlerFixture();assert.equal((await f.handler(req(f.bytes,{'content-type':'image/jpeg'}))).status,409);assert.equal((await f.handler(req(new TextEncoder().encode('<svg><script/></svg>')))).status,409);assert.equal(f.calls.length,0);
});
test('lost upload responses retry the same immutable object and verify its digest',async()=>{
 let stored,attempts=0;const f=await handlerFixture({upload:async(_path,bytes)=>{attempts++;if(!stored){stored=bytes;throw Error('lost response');}return false;},download:async()=>stored});
 assert.equal((await f.handler(req(f.bytes))).status,409);assert.equal((await f.handler(req(f.bytes))).status,200);assert.equal(attempts,2);assert.equal(f.calls.filter(c=>c.p_action==='complete').length,1);
});
test('an existing object with different bytes cannot complete an upload',async()=>{
 const f=await handlerFixture({upload:async()=>false,download:async()=>new Uint8Array([1,2,3])});const r=await f.handler(req(f.bytes));assert.equal((await r.json()).code,'IMAGE_CONFLICT');assert(!f.calls.some(c=>c.p_action==='complete'));
});
test('public reads require the exact site snapshot and never authenticate as an owner',async()=>{
 const f=await handlerFixture({authenticate:()=>{throw Error('public path must not authenticate');}});const r=await f.handler(new Request('https://example.com/?id='+id+'&site='+id));assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(f.calls.length,2);assert(f.calls.every(c=>c.p_action==='read_public'&&c.p_user_id===null&&c.p_input.site_id===id));
});
test('read permission is checked again after a storage download',async()=>{
 let f;f=await handlerFixture({download:async()=>{f.revoke();return f.bytes;}});const r=await f.handler(new Request('https://example.com/?id='+id+'&site='+id));assert.equal(r.status,404);assert.equal((await r.json()).code,'IMAGE_UNAVAILABLE');
});
test('storage read failures do not leak implementation or authentication details',async()=>{
 const f=await handlerFixture({download:async()=>{throw Error('server-secret');}});const r=await f.handler(new Request('https://example.com/?id='+id+'&site='+id));assert.equal(r.status,409);assert(!JSON.stringify(await r.json()).includes('secret'));
});
test('cleanup only removes server-marked objects',async()=>{
 const removed=[];let cleanupCalls=0;const f=await handlerFixture({rpc:async(_n,p)=>{if(p.p_action==='reap')return {ok:true,images:[{id,mime:'image/png'}]};if(p.p_action==='discard'){cleanupCalls++;return {ok:true};}return {ok:true,id,mime:'image/png',state:'ready'};},remove:async path=>removed.push(path)});
 assert.equal((await f.handler(req(f.bytes))).status,200);assert.deepEqual(removed,['images/'+id+'.png']);assert.equal(cleanupCalls,1);
});
test('failed storage cleanup does not mark an image deleted and does not block the new upload',async()=>{
 let discarded=false;const f=await handlerFixture({rpc:async(_n,p)=>{if(p.p_action==='reap')return {ok:true,images:[{id,mime:'image/png'}]};if(p.p_action==='discard')discarded=true;return {ok:true,id,mime:'image/png',state:'ready'};},remove:async()=>{throw Error('offline');}});assert.equal((await f.handler(req(f.bytes))).status,200);assert.equal(discarded,false);
});
test('image references and alt text accept bounded content only',async()=>{
 const m=await import('../app/assets/customer-website-model.mjs'),content={...Object.fromEntries(Object.keys(m.contentLimits).map(k=>[k,''])),name:'Test',headline:'Test'};
 assert.equal(m.readWebsiteContent({...content,hero:'image',hero_image_id:id,logo_image_id:id,hero_image_alt:'<strong>Nur Text</strong>'}).hero_image_id,id);
 for(const extra of [{hero:'image'},{hero_image_id:'https://example.com/image.png'},{logo_image_id:123},{hero_image_alt:'x'.repeat(201)},{hero_image_alt:'x\ny'}])assert.throws(()=>m.readWebsiteContent({...content,...extra}),{code:'INVALID_CONTENT'});
});
test('image API binds uploads to the expected account and omits owner credentials on public reads',async()=>{
 const source=(await fs.readFile(__dirname+'/../app/assets/customer-website-api.mjs','utf8')).replaceAll('await auth()','globalThis.__imageAuth');
 const api=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const originalFetch=globalThis.fetch,requests=[];let sessionUser=uid;
 globalThis.__imageAuth={auth:{getSession:async()=>({data:{session:{access_token:'test-only',user:{id:sessionUser}}}})}};
 globalThis.fetch=async(url,options)=>{requests.push({url,options});return options.method==='POST'?Response.json({ok:true,image:{id}}):new Response(await fixture(),{headers:{'content-type':'image/png'}});};
 try{
  await assert.rejects(api.uploadWebsiteImage(new Blob([await fixture()],{type:'image/png'}),id,undefined,id),{code:'AUTH_REQUIRED'});assert.equal(requests.length,0);
  await api.uploadWebsiteImage(new Blob([await fixture()],{type:'image/png'}),id,undefined,uid);assert.equal(requests[0].options.headers.Authorization,'Bearer test-only');assert.equal(requests[0].options.redirect,'error');
  await api.websiteImageRequest(id,id);assert.equal(requests[1].options.headers.Authorization,undefined);assert.equal(new URL(requests[1].url).searchParams.get('site'),id);
  sessionUser=null;globalThis.__imageAuth.auth.getSession=async()=>({data:{session:null}});await assert.rejects(api.websiteImageRequest(id),{code:'AUTH_REQUIRED'});assert.equal(requests.length,2);
 }finally{globalThis.fetch=originalFetch;delete globalThis.__imageAuth;}
});
