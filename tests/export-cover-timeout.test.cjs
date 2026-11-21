const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app/assets/publication-export-cover.mjs','utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
const preview=fs.readFileSync('app/assets/publication-preview.js','utf8');
const previewStart=preview.indexOf('function clearAssetPreview(){');
const previewCode=preview.slice(previewStart,preview.indexOf("window.addEventListener('pagehide'",previewStart));
const file={id:'60600000-0000-4000-8000-000000000001',revision:'sha256:'+'a'.repeat(64)+':1',media_kind:'video'};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const cover={asset_id:'60600000-0000-4000-8000-000000000002',asset_revision:'sha256:'+'b'.repeat(64)+':2',name:'Cover.png',position_ms:500,size_bytes:Buffer.from(png,'base64').length};
const response=()=>({ok:true,version:1,can_publish:false,asset_id:file.id,asset_revision:file.revision,cover:{...cover}});
const image=()=>new Blob([Buffer.from(png,'base64')],{type:'image/png'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const phases=['owner-first','lookup','owner-middle','image','owner-final'];
function fixture(initial=null){
 let now=0,phase=initial,owner='first',auth=0,lookupResult=response();
 const timers=[],gates=[],calls=[],created=[],revoked=[],nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,textContent:'',removeAttribute(name){delete this[name];}});return nodes.get(id);};
 const wait=(stage,value)=>{
  calls.push(stage);
  if(phase!==stage)return Promise.resolve(value);
  return new Promise((resolve,reject)=>gates.push({stage,value,resolve,reject}));
 };
 const env={AbortController,AbortSignal:{any:signals=>AbortSignal.any(signals),timeout:ms=>{
  assert.equal(ms,180000);const controller=new AbortController();timers.push({at:now+ms,controller});return controller.signal;
 }},URL,editorUUID:value=>/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)};
 vm.runInNewContext(source,env);
 const view=env.mountExportCover({doc:{getElementById:node},expectedOwnerId:'first',portal:'youtube',
  getOwnerId:()=>wait(['owner-first','owner-middle','owner-final'][auth++%3],owner),
  request:(selected,signal)=>{assert.equal(selected.id,file.id);return wait('lookup',lookupResult);},
  loadImage:(selected,signal)=>{assert.equal(selected.id,cover.asset_id);return wait('image',image());},
  createURL:blob=>{created.push(blob);return 'blob:cover-'+created.length;},revokeURL:url=>revoked.push(url)});
 return {view,node,gates,calls,created,revoked,timers,
  phase:value=>{phase=value;},owner:value=>{owner=value;},result:value=>{lookupResult=value;},
  async advance(ms){now+=ms;for(const timer of timers)if(timer.at<=now)timer.controller.abort();await tick();},
  async release(index=0,error=false){const g=gates[index];if(error)g.reject(Error('PRIVATE_UPSTREAM_DETAILS'));else g.resolve(g.value);await tick();}
 };
}
for(const phase of phases)test('cover '+phase+' cannot strand the selected preview and explicit retry succeeds',async()=>{
 const f=fixture(phase);let finished=false;
 const work=f.view.setContext(file).then(result=>{finished=true;return result;});await tick();
 assert.equal(finished,false);assert.equal(f.gates.length,1);
 await f.advance(179999);assert.equal(finished,false);
 await f.advance(1);assert.equal(finished,true,'whole preview read must settle at the deadline');
 assert.equal((await work).unavailable,true);assert.equal(f.created.length,0);
 assert.match(f.node('exportCoverStatus').textContent,/nicht verfügbar/);
 f.phase(null);const restored=await f.view.setContext(file);assert.equal(restored.cover.id,cover.asset_id);
 assert.equal(f.node('exportCoverImage').hidden,false);assert.equal(f.created.length,1);
 const src=f.node('exportCoverImage').src;
 await f.release(0);assert.equal(f.created.length,1);assert.equal(f.node('exportCoverImage').src,src);
 f.view.destroy();assert.deepEqual(f.revoked,[src]);
});
test('ownership, cover lookup and image share one allowance; no per-stage restart',async()=>{
 const f=fixture('owner-first');let finished=false;
 const work=f.view.setContext(file).then(result=>{finished=true;return result;});await tick();
 await f.advance(60000);f.phase('lookup');await f.release(0);
 await f.advance(60000);f.phase('image');await f.release(1);
 assert.equal(f.gates[2].stage,'image');assert.equal(f.timers.length,1);
 await f.advance(59999);assert.equal(finished,false);
 await f.advance(1);assert.equal(finished,true);assert.equal((await work).unavailable,true);
 await f.release(2);assert.equal(f.created.length,0);
});
test('file selection, logout cleanup and destroy immediately settle all stalled phases',async()=>{
 for(const phase of phases)for(const action of ['select','clear','destroy']){
  const f=fixture(phase);let finished=false;
  const old=f.view.setContext(file).then(result=>{finished=true;return result;});await tick();
  f.phase(null);
  if(action==='select')await f.view.setContext(file);else f.view[action]();
  await tick();assert.equal(finished,true,phase+' '+action);assert.equal((await old).unavailable,true);
  const before=f.node('exportCoverStatus').textContent,created=f.created.length;
  await f.release(0,action==='destroy');assert.equal(f.created.length,created);assert.equal(f.node('exportCoverStatus').textContent,before);
  if(action!=='select')assert.equal(f.node('exportCoverPanel').hidden,true);
  f.view.destroy();
 }
});
test('an old success or rejection cannot finish or replace a newer pending cover',async()=>{
 for(const reject of [false,true]){
  const f=fixture('lookup');const old=f.view.setContext(file);await tick();await f.advance(180000);await old;
  let done=false;const current=f.view.setContext(file).then(result=>{done=true;return result;});await tick();
  await f.release(0,reject);assert.equal(done,false);assert.equal(f.created.length,0);
  f.phase(null);await f.release(1);assert.equal((await current).cover.id,cover.asset_id);assert.equal(f.created.length,1);
  f.view.destroy();
 }
});
test('a failed request does not enter a new hanging ownership check during recovery',async()=>{
 const f=fixture('lookup'),work=f.view.setContext(file);await tick();f.phase('owner-middle');await f.release(0,true);
 let done=false;work.then(()=>{done=true;});await tick();assert.equal(done,true);
 assert.equal((await work).unavailable,true);assert.equal(f.gates.length,1);
 assert.match(f.node('exportCoverStatus').textContent,/nicht verfügbar/);
 assert.doesNotMatch(f.node('exportCoverStatus').textContent,/PRIVATE_UPSTREAM/);f.view.destroy();
});
test('owner changes and foreign metadata fail closed; verified no-cover still allows ordinary preview',async()=>{
 for(const phase of ['owner-first','owner-middle','owner-final']){
  const f=fixture(phase),work=f.view.setContext(file);await tick();f.gates[0].resolve('other');
  assert.equal((await work).unavailable,true);assert.equal(f.created.length,0);assert.equal(f.node('exportCoverPanel').hidden,true);f.view.destroy();
 }
 for(const patch of [{asset_id:'other'},{asset_revision:'old'},{can_publish:true},{cover:{...cover,asset_id:file.id}}]){
  const f=fixture();f.result({...response(),...patch});assert.equal((await f.view.setContext(file)).unavailable,true);assert.equal(f.created.length,0);f.view.destroy();
 }
 const empty=fixture();empty.result({...response(),cover:null});assert.equal(await empty.view.setContext(file),null);
 assert.equal(empty.calls.includes('image'),false);assert.equal(empty.node('exportCoverPanel').hidden,true);
 assert.equal(await empty.view.setContext({...file,media_kind:'image'}),null);empty.view.destroy();
});

test('actual preview retry recovers on desktop and mobile without losing the selected file or edits',async()=>{
 const {chromium}=await import(process.env.SMA_PLAYWRIGHT_MODULE||'./dom-runtime/node_modules/playwright-core/index.mjs');
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
 try{for(const mobile of [false,true])for(const phase of phases){
  const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
  const page=await context.newPage(),requests=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
  await page.clock.install();
  await page.setContent('<style>[hidden]{display:none!important}</style><input id="draftTitle" value="Mein ungespeicherter Text"><div id="assetPreviewMedia"></div><p id="assetPreviewStatus"></p><button id="retryAssetPreview" hidden>Vorschau erneut laden</button><details id="exportCoverPanel" hidden><img id="exportCoverImage" hidden><p id="exportCoverStatus"></p><p id="exportCoverNote"></p></details>');
  await page.evaluate(({source,previewCode,file,cover,png,phase})=>{
   window.fixture={phase,auth:0,gates:[],calls:0};const f=window.fixture;
   AbortSignal.timeout=ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(),ms);return controller.signal;};
   const boot=new Function('file','cover','png',source+`\n
    const $=id=>document.getElementById(id),f=window.fixture;
    let signedOut=false,selectedAsset=file,selectedPortal='youtube',localMedia=null,mediaViewKey='',mediaViewUrl=null,mediaViewController=null;
    const originalVideo={setPoster(){}},editorUUIDUnused=null;
    const wait=(stage,value)=>f.phase===stage?new Promise(resolve=>f.gates.push(()=>resolve(value))):Promise.resolve(value);
    const coverView=mountExportCover({doc:document,portal:selectedPortal,expectedOwnerId:'first',
     getOwnerId:()=>wait(['owner-first','owner-middle','owner-final'][f.auth++%3],'first'),
     request:async()=>{f.calls++;return wait('lookup',{ok:true,version:1,can_publish:false,asset_id:file.id,asset_revision:file.revision,cover});},
     loadImage:()=>wait('image',new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'}))});
    const session=async()=>{throw Error('Unexpected fallback authentication');};
    const previewThumbnails={request(){throw Error('A timed-out cover must not fall back to another frame');}};
    `+previewCode+`\n
    f.begin=()=>loadAssetPreview();f.finishOld=()=>{for(const release of f.gates)release();};
    f.clear=()=>{coverView.clear();clearAssetPreview();};f.selected=()=>selectedAsset.id;
    f.begin();`);
   boot(file,cover,png);
  },{source:'const editorUUID=v=>/^[\\da-f]{8}(?:-[\\da-f]{4}){3}-[\\da-f]{12}$/i.test(v);\n'+source,previewCode,file,cover,png,phase});
  await page.waitForFunction(()=>fixture.gates.length===1);
  await page.locator('#draftTitle').fill('Meine Änderung bleibt erhalten');
  await page.clock.fastForward(180001);
  await page.getByRole('button',{name:'Vorschau erneut laden'}).waitFor({state:'visible'});
  assert.match(await page.locator('#assetPreviewStatus').textContent(),/Titelbild.*nicht verfügbar/);
  assert.equal(await page.locator('#assetPreviewMedia img').count(),0);
  await page.evaluate(()=>{fixture.phase=null;});
  await page.getByRole('button',{name:'Vorschau erneut laden'}).click();
  await page.waitForFunction(()=>document.querySelector('#assetPreviewMedia img')?.naturalWidth===1);
  assert.equal(await page.locator('#draftTitle').inputValue(),'Meine Änderung bleibt erhalten');
  assert.equal(await page.evaluate(()=>fixture.selected()),file.id);
  const url=await page.locator('#assetPreviewMedia img').getAttribute('src');
  await page.evaluate(()=>fixture.finishOld());
  assert.equal(await page.locator('#assetPreviewMedia img').getAttribute('src'),url);
  assert.equal(await page.locator('#retryAssetPreview').isHidden(),true);
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  await page.evaluate(()=>fixture.clear());assert.equal(await page.locator('#assetPreviewMedia img').count(),0);
  await context.close();
 }}finally{await browser.close();}
});
