const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {pathToFileURL}=require('node:url');
let browser;
test.before(async()=>{
 const runtime=process.env.SMA_TEST_PLAYWRIGHT?pathToFileURL(process.env.SMA_TEST_PLAYWRIGHT).href:'./dom-runtime/node_modules/playwright-core/index.mjs';
 const {chromium}=await import(runtime);
 browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome',args:process.env.SMA_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]});
});
test.after(async()=>{await browser?.close();});

// The complete application and its navigation run unchanged. Only service replies
// and the account-specific dashboard shell are synthetic; no request reaches a server.
const site='https://sma.test',url=site+'/app/dashboard.html';
const uuid=n=>'a9900000-0000-4000-8000-'+String(n).padStart(12,'0');
const wanted=uuid(1),query='Suchweg',pending='Meine ungesicherte Änderung im Suchweg.';
const files=Array.from({length:14},(_,i)=>({id:uuid(i+1),name:'Suchweg Datei '+(i+1)+'.mp4',
 revision:'synthetic:'+i,media_kind:'video',mime_type:'video/mp4',duration_ms:3000,width_px:160,height_px:90,size_bytes:100,
 modified_at:'2026-11-16T00:00:00Z',assignments:[{platform:'youtube',revision:1,status:'assigned',title:'Suchweg Beitrag '+(i+1)}]}));
const shell=`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;font:16px Arial,sans-serif}.page:not(.active){display:none}@media(max-width:650px){aside{display:none}}main{padding:16px}.platform-card{display:grid;gap:14px;padding:16px}.card{padding:12px}</style>
<body data-sma-customer-id="fixture"><header class="topbar"><div class="topbar-actions"></div></header>
<aside><p>Arbeitsbereich</p><button data-page="overview">Übersicht</button><button data-page="publishing">Veröffentlichung</button></aside><main>
<section class="page active" id="page-overview"><div class="page-head"><h1>Übersicht</h1></div><div class="grid"><div class="card">Social Media</div><div class="card">Content</div><div class="card">Konto</div></div></section>
<section class="page" id="page-publishing"><div class="page-head"><h1>Veröffentlichung</h1></div>
<div class="card"><div class="platform-list"><article class="platform-card"><div class="platform-icon"></div><div class="platform-info"><strong>YouTube</strong></div></article></div></div><div id="publishingFilesSlot"></div></section></main>
<script>document.querySelector('aside').onclick=e=>{const nav=e.target.closest('[data-page]');if(nav)for(const p of document.querySelectorAll('.page'))p.classList.toggle('active',p.id==='page-'+nav.dataset.page)}</script></body></html>`;
const client=`export function createClient(){return {
 auth:{getSession:async()=>({data:{session:{user:{id:'fixture'},access_token:'fixture'}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 rpc(name,args){const controller=new AbortController();const p=fetch('/fixture/'+name,{method:'POST',body:JSON.stringify(args),signal:controller.signal}).then(r=>r.json()).then(data=>({data}));
 p.abortSignal=signal=>{if(signal.aborted)controller.abort();else signal.addEventListener('abort',()=>controller.abort(),{once:true});return p;};return p;}
}}`;
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0b8AAAAASUVORK5CYII=';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const focused=locator=>locator.evaluate(el=>el.ownerDocument.activeElement===el);

async function fixture(t,mobile){
 const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile,locale:'de-AT',serviceWorkers:'block'});
 const errors=[],unexpected=[],calls=[];
 let catalog=files.slice(),nextCatalogGate=null,closing=false;
 const gates=[];
 await context.routeWebSocket('**/*',socket=>{unexpected.push('WebSocket '+socket.url());socket.close();});
 await context.route('**/*',async route=>{
  const request=route.request(),address=new URL(request.url()),path=address.pathname;
  const reply=data=>route.fulfill({json:data,headers:{'Access-Control-Allow-Origin':'*'}});
  try{
   if(request.method()==='GET'){
    if(address.origin===site&&/^\/app\/(dashboard\.html|publication-preview\.html|assets\/[\w.-]+\.(css|m?js))$/.test(path)){
     return await route.fulfill({contentType:path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'text/javascript',body:await fs.readFile('.'+path)});
    }
    if(address.origin==='https://esm.sh'&&path.startsWith('/@supabase/supabase-js@'))return await route.fulfill({contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:client});
   }
   if(request.method()==='POST'){
    if(address.origin==='https://johnmusic.app.n8n.cloud'&&path==='/webhook/sma-dashboard-session')return await reply({html:shell});
    const args=request.postDataJSON();calls.push({path,args});
    if(address.origin===site&&path==='/fixture/sma_publication_files_v1'){
     if(args.p_action==='list'){
      if(args.p_input?.dashboard_labels){
       const gate=nextCatalogGate;nextCatalogGate=null;
       if(gate){gate.started.resolve();await gate.released.promise;}
       return await reply({ok:true,files:catalog,sync_state:'complete'});
      }
      assert.equal(args.p_input?.platform,'youtube');return await reply({ok:true,files});
     }
     const file=files.find(f=>f.id===args.p_input?.asset_id);assert.ok(file,'only synthetic files');
     if(args.p_action==='get')return await reply({ok:true,status:'completed',id:uuid(100),revision:1,assignment_revision:1,
      preview:{can_publish:false,language:'de',shop_url:'https://sma-automation.com/app/shop.html?shop=fixture',drafts:[{platform:'youtube',title:file.assignments[0].title,body:'Gespeicherter Suchweg-Text.',hashtags:[],review_notes:[],caption:'Gespeicherter Suchweg-Text.'}]}});
     if(args.p_action==='check')return await reply({ok:true});
    }
    if(address.origin===site&&path==='/fixture/sma_publication_preview_v1'&&args.p_action==='latest')return await reply({ok:true,status:'empty'});
    if(address.origin===site&&path==='/fixture/sma_publication_video_magic_v1'&&args.p_action==='get')return await reply({ok:false,code:'UNAVAILABLE'});
    if(address.origin===site&&path==='/fixture/sma_publication_editor_result_v1'){
     const file=files.find(f=>f.id===args.p_asset_id);assert.ok(file);
     return await reply({ok:true,version:1,can_publish:false,asset_id:file.id,asset_revision:file.revision,cover:null});
    }
    if(address.origin==='https://bnvnmdxosbnuzedokqgh.supabase.co'&&path==='/rest/v1/rpc/sma_gallery_music_v1'&&args.p_action==='claim')return await reply({ok:true,state:'idle'});
    if(address.origin==='https://johnmusic.app.n8n.cloud'&&path==='/webhook/sma-publication-asset-preview-v1'){
     const file=files.find(f=>f.id===args.asset_id);assert.ok(file);
     return await reply({ok:true,can_publish:false,asset_id:file.id,asset_revision:file.revision,media_kind:'video',mime_type:'image/png',image_base64:png});
    }
   }
   throw Error('Unexpected request '+request.method()+' '+address.origin+path);
  }catch(error){if(!closing)unexpected.push(error.message);await route.abort().catch(()=>{});}
 });
 const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));
 t.after(async()=>{closing=true;for(const gate of gates)gate.released.resolve();await context.close();assert.deepEqual(unexpected,[],'all requests are isolated and allowlisted');assert.deepEqual(errors,[],'no browser errors');});
 await page.goto(url);
 const dashboard=page.frameLocator('#dashboard');
 const account=dashboard.getByRole('tab',{name:'Konto & Paket'});await account.click();
 const launcher=mobile?dashboard.getByRole('navigation',{name:'SMA Schnellnavigation'}).getByRole('button',{name:'Suche'}):dashboard.locator('#smaGlobalQuickFind');
 await launcher.click();
 const dialog=dashboard.getByRole('dialog',{name:'SMA durchsuchen'}),input=dialog.getByRole('searchbox');
 await input.fill(query);
 const hit=dialog.locator('[data-quick-file="'+wanted+'"]');await hit.waitFor();
 const editor=dashboard.frameLocator('iframe[data-portal="youtube"]');
 const previewBack=editor.locator('#workspacePreviewBack'),body=editor.locator('#youtube-body');
 async function open(){
  await hit.click();await editor.locator('#workspaceEditPost').waitFor();
  await page.waitForFunction(id=>history.state?.smaOptimization&&history.state.assetId===id&&history.state.view==='preview',wanted);
 }
 async function edit(){
  await editor.locator('#workspaceEditPost').click();await body.fill(pending);
  await page.waitForFunction(()=>history.state?.view==='source');
 }
 async function returnToSearch(){
  await editor.locator('#workspacePreviewEdits').click();await previewBack.click();await dialog.waitFor();
  assert.equal(await input.inputValue(),query);
 }
 async function refreshCatalog(updated){
  catalog=updated;
  const gate={started:deferred(),released:deferred()};gates.push(gate);nextCatalogGate=gate;
  // This is the existing event the real editor emits after its file metadata changes.
  // Sending it from the actual editor window keeps the production source/origin checks.
  await body.evaluate(()=>window.top.postMessage({type:'sma-publication-file-updated'},location.origin));
  await gate.started.promise;
  return async()=>{
   gate.released.resolve();
   await page.waitForFunction(()=>document.getElementById('dashboard').contentDocument.querySelector('.sma-file-toolbar button')?.disabled===false);
  };
 }
 return {page,dashboard,dialog,input,hit,editor,body,previewBack,launcher,account,open,edit,returnToSearch,refreshCatalog,calls};
}

for(const mobile of [false,true]){
 const label=mobile?'mobile':'desktop';
 test(label+': real search, unsaved edits, preview, explicit return and browser history preserve one file',{timeout:30000},async t=>{
  const f=await fixture(t,mobile);await f.open();await f.edit();
  const originalFrame=await f.dashboard.locator('iframe[data-portal="youtube"]').elementHandle();
  const route=await f.page.evaluate(()=>history.state);
  await f.page.goBack();await f.dialog.waitFor();assert(await focused(f.hit));
  assert.equal(await f.account.getAttribute('aria-selected'),'true');
  await f.page.goForward();await f.body.waitFor();assert.equal(await f.body.inputValue(),pending);
  assert.equal(await f.page.evaluate(()=>history.state.searchKey),route.searchKey);
  await f.returnToSearch();assert(await focused(f.hit));
  await f.page.goForward();await f.previewBack.waitFor();
  assert.equal(await f.editor.locator('#workspacePostCaption').textContent(),pending);
  await f.page.goBack();await f.dialog.waitFor();assert(await focused(f.hit));
  await f.page.keyboard.press('Escape');assert(await focused(f.launcher));
  assert.equal(await f.account.getAttribute('aria-selected'),'true');
  assert.equal(await f.dashboard.locator('iframe[data-portal="youtube"]').count(),1);
  assert.equal(await f.body.inputValue(),pending);
  assert(await originalFrame.evaluate(el=>el===el.ownerDocument.querySelector('iframe[data-portal="youtube"]')),'the actual editor iframe is reused');
 });
 test(label+': late catalog completion while editing keeps route, local draft and keyboard focus',{timeout:30000},async t=>{
  const f=await fixture(t,mobile);await f.open();await f.edit();
  const route=await f.page.evaluate(()=>JSON.stringify(history.state));
  const release=await f.refreshCatalog([files[1],files[0],...files.slice(2)]);
  assert(await focused(f.body));await release();
  assert.equal(await f.page.evaluate(()=>JSON.stringify(history.state)),route);
  assert.equal(await f.body.inputValue(),pending);assert(await focused(f.body));
  assert.equal(await f.dialog.isVisible(),false);
  await f.returnToSearch();assert(await focused(f.hit));
 });
 test(label+': a delayed catalog moving the selected match beyond the first ten still returns to that match',{timeout:30000},async t=>{
  const f=await fixture(t,mobile);await f.open();await f.edit();
  const release=await f.refreshCatalog([...files.slice(1),files[0]]);await release();
  await f.returnToSearch();
  assert.equal(await f.hit.count(),1,'the original matching file stays reachable after catalog reordering');
  assert(await focused(f.hit),'return focuses the selected file, even beyond the original first ten');
  assert.match(await f.dialog.getByRole('status').textContent(),/14 direkte Treffer/);
  assert.equal(await f.dialog.locator('[data-quick-file]').count(),10,'keep the existing result limit');
  assert.equal(await f.body.inputValue(),pending);
  await f.input.fill('Suchweg Beitrag 14');
  assert.equal(await f.hit.count(),0,'changing the query must not retain an unrelated return target');
  assert.equal(await f.dialog.locator('[data-quick-file]').count(),1);
  await f.input.fill('S');
  assert.equal(await f.dialog.locator('[data-quick-file]').count(),0,'a short query keeps the existing search threshold');
 });
 test(label+': slow catalog completing after Browser Back preserves the restored search and Forward draft',{timeout:30000},async t=>{
  const f=await fixture(t,mobile);await f.open();await f.edit();
  const release=await f.refreshCatalog([files[2],files[0],files[1],...files.slice(3)]);
  await f.page.goBack();await f.dialog.waitFor();assert(await focused(f.hit));
  await release();assert.equal(await f.input.inputValue(),query);assert(await focused(f.hit));
  await f.page.goForward();await f.body.waitFor();assert.equal(await f.body.inputValue(),pending);
  assert.equal(await f.dialog.isVisible(),false);
 });
 test(label+': a removed file returns to the search field and Browser Forward cannot reopen it',{timeout:30000},async t=>{
  const f=await fixture(t,mobile);await f.open();await f.edit();
  const release=await f.refreshCatalog(files.slice(1));await release();
  assert.equal(await f.body.inputValue(),pending);assert(await focused(f.body));
  await f.returnToSearch();assert.equal(await f.hit.count(),0);assert(await focused(f.input));
  await f.page.goForward();await f.dialog.waitFor();
  assert.equal(await f.page.evaluate(()=>Boolean(history.state?.smaOptimization)),false);
  assert.equal(await f.input.inputValue(),query);assert(await focused(f.input));
  assert.equal(await f.dashboard.locator('#smaOptimizationPage').isVisible(),false);
 });
}
