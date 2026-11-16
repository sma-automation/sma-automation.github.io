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
const pendingSource='Isolierte Beschreibung für den Reload-Test: ein fiktives Reisevideo ohne echte Kundendatei.';
const files=Array.from({length:14},(_,i)=>({id:uuid(i+1),name:'Suchweg Datei '+(i+1)+'.mp4',
 revision:'synthetic:'+i,media_kind:'video',mime_type:'video/mp4',duration_ms:3000,width_px:160,height_px:90,size_bytes:100,
 modified_at:'2026-11-16T00:00:00Z',assignments:[{platform:'youtube',revision:1,status:'assigned',title:'Suchweg Beitrag '+(i+1)}]}));
const shell=`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;font:16px Arial,sans-serif}.page:not(.active){display:none}@media(max-width:650px){aside{display:none}}main{padding:16px}.platform-card{display:grid;gap:14px;padding:16px}.card{padding:12px}</style>
<body data-sma-customer-id="fixture"><header class="topbar"><div class="topbar-actions"><button id="fixtureLogout" onclick="parent.postMessage({type:'sma-dashboard-logout'},top.location.origin)">Abmelden</button></div></header>
<aside><p>Arbeitsbereich</p><button data-page="overview">Übersicht</button><button data-page="publishing">Veröffentlichung</button></aside><main>
<section class="page active" id="page-overview"><div class="page-head"><h1>Übersicht</h1></div><div class="grid"><div class="card">Social Media</div><div class="card">Content</div><div class="card">Konto</div></div></section>
<section class="page" id="page-publishing"><div class="page-head"><h1>Veröffentlichung</h1></div>
<div class="card"><div class="platform-list"><article class="platform-card"><div class="platform-icon"></div><div class="platform-info"><strong>YouTube</strong></div></article></div></div><div id="publishingFilesSlot"></div></section></main>
<script>document.querySelector('aside').onclick=e=>{const nav=e.target.closest('[data-page]');if(nav)for(const p of document.querySelectorAll('.page'))p.classList.toggle('active',p.id==='page-'+nav.dataset.page)}</script></body></html>`;
const client=`export function createClient(){
 const auth=window.top.smaFixtureAuth;
 return {
 auth:{getSession:async()=>({data:{session:auth.session()}}),
  onAuthStateChange(callback){const listener={window,callback};auth.listeners.add(listener);return {data:{subscription:{unsubscribe(){auth.listeners.delete(listener);}}}};},
  async signOut(){await fetch('/fixture/sign-out',{method:'POST',body:'{}'});auth.emit('SIGNED_OUT',null);return {error:null};},
  async signInWithPassword(input){const response=await fetch('/fixture/sign-in',{method:'POST',body:JSON.stringify(input)}),data=await response.json();auth.emit('SIGNED_IN',data.owner);return {data:{session:auth.session()},error:null};}
 },
 rpc(name,args){const controller=new AbortController();const p=fetch('/fixture/'+name,{method:'POST',headers:{'X-Fixture-Owner':auth.owner||''},body:JSON.stringify(args),signal:controller.signal}).then(r=>r.json()).then(data=>({data}));
 p.abortSignal=signal=>{if(signal.aborted)controller.abort();else signal.addEventListener('abort',()=>controller.abort(),{once:true});return p;};return p;}
}}`;
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0b8AAAAASUVORK5CYII=';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const focused=locator=>locator.evaluate(el=>el.ownerDocument.activeElement===el);

async function fixture(t,mobile,{distinctDrafts=false,allowDraftSave=false,startAtLogin=false}={}){
 const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile,locale:'de-AT',serviceWorkers:'block'});
 const errors=[],unexpected=[],calls=[];
 const ownedFiles=structuredClone(files).map(file=>({...file,verified_at:new Date().toISOString()}));
 const drafts=new Map(ownedFiles.map((file,i)=>[file.id,{ok:true,status:'completed',id:uuid(100+(distinctDrafts?i:0)),revision:1,assignment_revision:1,
  preview:{can_publish:false,language:'de',shop_url:'https://sma-automation.com/app/shop.html?shop=fixture',drafts:[{platform:'youtube',title:file.assignments[0].title,body:'Gespeicherter Suchweg-Text.',hashtags:[],review_notes:[],caption:'Gespeicherter Suchweg-Text.'}]}}]));
 let catalog=ownedFiles.slice(),nextCatalogGate=null,nextDraftGate=null,nextSignOutGate=null,nextLostSave=null,closing=false;
 const unreadableDrafts=new Set();
 const gates=[];
 await context.addInitScript(startAtLogin=>{
  if(window!==window.top||location.origin==='null')return;
  const key='sma.fixture.owner',stored=sessionStorage.getItem(key);
  window.smaFixtureAuth={owner:stored===null?(startAtLogin?null:'fixture'):stored||null,listeners:new Set(),
   session(){return this.owner?{user:{id:this.owner},access_token:this.owner}:null;},
   emit(event,owner){
    this.owner=owner;sessionStorage.setItem(key,owner||'');
    // Parent-first auth delivery: removed editor windows never receive their own event.
    for(const listener of [...this.listeners])if(listener.window===window&&this.listeners.has(listener))listener.callback(event,this.session());
   }
  };
 },startAtLogin);
 await context.routeWebSocket('**/*',socket=>{unexpected.push('WebSocket '+socket.url());socket.close();});
 await context.route('**/*',async route=>{
  const request=route.request(),address=new URL(request.url()),path=address.pathname;
  const reply=data=>route.fulfill({json:data,headers:{'Access-Control-Allow-Origin':'*'}});
  try{
   if(request.method()==='GET'){
    if(address.origin===site&&/^\/app\/(dashboard\.html|index\.html|publication-preview\.html|assets\/[\w.-]+\.(css|m?js))$/.test(path)){
     return await route.fulfill({contentType:path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'text/javascript',body:await fs.readFile('.'+path)});
    }
    if(address.origin==='https://esm.sh'&&path.startsWith('/@supabase/supabase-js@'))return await route.fulfill({contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:client});
   }
   if(request.method()==='POST'){
    if(address.origin==='https://johnmusic.app.n8n.cloud'&&path==='/webhook/sma-dashboard-session'){
     const owner=request.headers().authorization?.replace(/^Bearer /,'');assert.ok(['fixture','second'].includes(owner));
     return await reply({html:shell.replace('data-sma-customer-id="fixture"','data-sma-customer-id="'+owner+'"')});
    }
    if(address.origin==='https://johnmusic.app.n8n.cloud'&&path==='/webhook/sma-publication-files-v1'){
     assert.ok(startAtLogin,'only the new-customer entry requests a folder refresh');
     assert.equal(request.headers().authorization,'Bearer second');
     calls.push({path,args:null,owner:'second'});return await reply({ok:true});
    }
    const args=request.postDataJSON(),owner=request.headers()['x-fixture-owner'];calls.push({path,args,owner});
    if(address.origin===site&&path==='/fixture/sign-out'){
     const gate=nextSignOutGate;nextSignOutGate=null;
     if(gate){gate.started.resolve();await gate.released.promise;}
     return await reply({ok:true});
    }
    if(address.origin===site&&path==='/fixture/sign-in'){
     assert.equal(args.password,'Fixture-only_123!');assert.ok(['fixture@example.test','second@example.test'].includes(args.email));
     return await reply({owner:args.email.split('@')[0]});
    }
    if(address.origin===site&&path==='/fixture/sma_publication_files_v1'){
     assert.ok(['fixture','second'].includes(owner),'file reads require a synthetic signed-in owner');
     if(owner==='second'){assert.equal(args.p_action,'list','the second account cannot request the first account files');return await reply({ok:true,files:[],sync_state:'complete'});}
     if(args.p_action==='list'){
      if(args.p_input?.dashboard_labels){
       const gate=nextCatalogGate;nextCatalogGate=null;
       if(gate){gate.started.resolve();await gate.released.promise;}
       return await reply({ok:true,files:catalog,sync_state:'complete'});
      }
      assert.equal(args.p_input?.platform,'youtube');return await reply({ok:true,files:ownedFiles});
     }
     const file=ownedFiles.find(f=>f.id===args.p_input?.asset_id);assert.ok(file,'only synthetic files');
     if(args.p_action==='get'){
      if(unreadableDrafts.has(file.id))return await route.abort('failed');
      const saved=structuredClone(drafts.get(file.id));
      const gate=nextDraftGate;nextDraftGate=null;
      if(gate){gate.started.resolve();await gate.released.promise;}
      if(request.frame().isDetached())return await route.abort('aborted').catch(()=>{});
      return await reply(saved);
     }
     if(args.p_action==='save'&&allowDraftSave){
      assert.equal(args.p_input.platform,'youtube');assert.equal(args.p_input.asset_revision,file.revision);
      if(args.p_input.assignment_revision!==drafts.get(file.id).assignment_revision)return await reply({ok:false,code:'ASSIGNMENT_CONFLICT'});
      const {title,body,hashtags}=args.p_input;
      const saved=advanceDraft(file.id,{title,body,hashtags});
      if(nextLostSave===file.id){nextLostSave=null;unreadableDrafts.add(file.id);return await route.abort('failed');}
      return await reply(saved);
     }
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
     assert.equal(request.headers().authorization,'Bearer fixture');
     const batch=Object.hasOwn(args,'assets'),inputs=batch?args.assets:[args];
     assert.deepEqual(Object.keys(args).sort(),batch?['assets']:['asset_id','asset_revision']);
     assert.ok(Array.isArray(inputs)&&inputs.length>0&&inputs.length<=10);
     assert.equal(new Set(inputs.map(input=>input.asset_id+'\n'+input.asset_revision)).size,inputs.length);
     const images=inputs.map(input=>{
      assert.deepEqual(Object.keys(input).sort(),['asset_id','asset_revision']);
      const file=files.find(f=>f.id===input.asset_id);assert.ok(file,'only synthetic thumbnail files');
      assert.equal(input.asset_revision,file.revision);
      return {ok:true,can_publish:false,asset_id:file.id,asset_revision:file.revision,media_kind:'video',mime_type:'image/png',image_base64:png};
     });
     return await reply(batch?{ok:true,can_publish:false,assets:images}:images[0]);
    }
   }
   throw Error('Unexpected request '+request.method()+' '+address.origin+path);
  }catch(error){if(!closing)unexpected.push(error.message);await route.abort().catch(()=>{});}
 });
 const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));
 t.after(async()=>{closing=true;for(const gate of gates)gate.released.resolve();await context.close();assert.deepEqual(unexpected,[],'all requests are isolated and allowlisted');assert.deepEqual(errors,[],'no browser errors');});
 await page.goto(startAtLogin?site+'/app/index.html':url);
 const dashboard=page.frameLocator('#dashboard');
 const account=dashboard.getByRole('tab',{name:'Konto & Paket'});
 const launcher=mobile?dashboard.getByRole('navigation',{name:'SMA Schnellnavigation'}).getByRole('button',{name:'Suche'}):dashboard.locator('#smaGlobalQuickFind');
 const dialog=dashboard.getByRole('dialog',{name:'SMA durchsuchen'}),input=dialog.getByRole('searchbox');
 const hit=dialog.locator('[data-quick-file="'+wanted+'"]');
 if(!startAtLogin){
  await account.click();await launcher.click();await input.fill(query);await hit.waitFor();
 }
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
 function holdCatalog(updated=catalog){
  catalog=updated;
  const gate={started:deferred(),released:deferred()};gates.push(gate);nextCatalogGate=gate;
  return {started:gate.started.promise,release:async()=>{
   gate.released.resolve();
   await page.waitForFunction(()=>document.getElementById('dashboard').contentDocument.querySelector('.sma-file-toolbar button')?.disabled===false);
  }};
 }
 async function refreshCatalog(updated){
  const gate=holdCatalog(updated);
  // This is the existing event the real editor emits after its file metadata changes.
  // Sending it from the actual editor window keeps the production source/origin checks.
  await body.evaluate(()=>window.top.postMessage({type:'sma-publication-file-updated'},location.origin));
  await gate.started;
  return gate.release;
 }
 function holdDraft(){
  const gate={started:deferred(),released:deferred()};gates.push(gate);nextDraftGate=gate;
  return {started:gate.started.promise,release:()=>gate.released.resolve()};
 }
 function holdSignOut(){
  const gate={started:deferred(),released:deferred()};gates.push(gate);nextSignOutGate=gate;
  return {started:gate.started.promise,release:()=>gate.released.resolve()};
 }
 async function switchOwner(owner){
  await page.evaluate(owner=>window.smaFixtureAuth.emit('SIGNED_IN',owner),owner);
  await page.waitForFunction(owner=>document.getElementById('dashboard')?.contentDocument?.body?.dataset.smaCustomerId===owner,owner);
  await dashboard.getByRole('tab',{name:'Konto & Paket'}).waitFor();
 }
 async function signIn(owner='fixture'){
  // Auth notification and explicit logout may both replace the same login URL.
  await page.locator('#authSubmit:enabled').waitFor();
  assert.equal(new URL(page.url()).pathname,'/app/index.html');
  await page.locator('#email').fill(owner+'@example.test');await page.locator('#password').fill('Fixture-only_123!');
  await page.locator('#authSubmit').click();
  await page.waitForFunction(owner=>document.getElementById('dashboard')?.contentDocument?.body?.dataset.smaCustomerId===owner,owner);
  await dashboard.getByRole('tab',{name:'Konto & Paket'}).waitFor();
 }
 function advanceDraft(id,fields){
  const saved=drafts.get(id),file=ownedFiles.find(file=>file.id===id);assert.ok(saved&&file);
  const draft=saved.preview.drafts[0];Object.assign(draft,structuredClone(fields));draft.caption=draft.body;
  saved.revision++;saved.assignment_revision++;file.assignments[0].revision=saved.assignment_revision;
  return structuredClone(saved);
 }
 return {page,dashboard,dialog,input,hit,editor,body,previewBack,launcher,account,open,edit,returnToSearch,refreshCatalog,holdCatalog,holdDraft,calls,
  advanceDraft,holdSignOut,switchOwner,signIn,savedDraft:id=>structuredClone(drafts.get(id)),
  loseNextSaveReply(id){assert.ok(allowDraftSave&&drafts.has(id));nextLostSave=id;},
  allowDraftRead(id){unreadableDrafts.delete(id);}};
}

const editorFor=(f,id)=>f.dashboard.frameLocator('iframe[data-key="youtube:'+id+'"]');
async function workspaceFailure(f,id,error){
 const state=await f.page.evaluate(()=>{
  const frame=document.getElementById('dashboard'),doc=frame?.contentDocument;
  return {url:location.href,route:history.state,rootMessage:document.getElementById('message')?.textContent,
   dashboardHidden:frame?.hidden,editors:[...(doc?.querySelectorAll('iframe[data-key]')||[])].map(editor=>{
    const content=editor.contentDocument;
    return {key:editor.dataset.key,restoring:editor.dataset.restoring,hidden:editor.hidden,src:editor.src,
     status:content?.getElementById('status')?.textContent,saveStatus:content?.getElementById('saveStatus')?.textContent,
     assetStatus:content?.getElementById('assetStatus')?.textContent,bodyDisabled:content?.getElementById('youtube-body')?.disabled};
   })};
 }).catch(reason=>({diagnosticError:reason.message}));
 const requests=f.calls.slice(-12).map(call=>({path:call.path,owner:call.owner,action:call.args?.p_action,file:call.args?.p_input?.asset_id}));
 throw new Error('File workspace did not become ready: '+JSON.stringify({id,state,requests}),{cause:error});
}
async function waitForFile(f,id){
 try{
  await f.page.waitForFunction(id=>{
   const dashboard=document.getElementById('dashboard').contentDocument;
   const editor=dashboard?.querySelector('iframe[data-key="youtube:'+id+'"]');
   return editor?.dataset.restoring!=='true'&&editor?.contentDocument?.getElementById('youtube-body')?.disabled===false;
  },id);
 }catch(error){await workspaceFailure(f,id,error);}
}
async function waitForWorkspaceView(f,editor,view=null){
 let key;
 try{
  key=await editor.locator('body').evaluate(()=>window.frameElement.dataset.key);
  await f.page.waitForFunction(({key,view})=>{
   const route=history.state,doc=document.getElementById('dashboard')?.contentDocument;
   const frame=doc?.querySelector('iframe[data-key="'+key+'"]'),content=frame?.contentDocument;
   const shown=content?.getElementById('workspaceSource')?.hidden===false?'source':content?.getElementById('workspacePreview')?.hidden===false?'preview':null;
   return frame&&!frame.hidden&&frame.dataset.restoring!=='true'&&route?.smaOptimization&&
    key===route.portal+':'+(route.assetId||'template')&&route.view===shown&&frame.dataset.view===shown&&(!view||view===shown);
  },{key,view});
 }catch(error){await workspaceFailure(f,key,error);}
}
async function openSearchFile(f,id){
 await f.launcher.click();await f.input.fill(query);
 await f.dialog.locator('[data-quick-file="'+id+'"]').click();await f.dialog.waitFor({state:'hidden'});
 await waitForFile(f,id);
 await f.page.waitForFunction(id=>history.state?.smaOptimization&&history.state.assetId===id&&['source','preview'].includes(history.state.view),id);
}
async function checkpoint(f,id){
 return f.page.evaluate(id=>{
  for(let i=0;i<sessionStorage.length;i++){
   const raw=sessionStorage.getItem(sessionStorage.key(i));
   try{if(JSON.parse(raw)?.fileId===id)return raw;}catch{}
  }
  return null;
 },id);
}
const draftWrites=f=>f.calls.filter(call=>call.path==='/fixture/sma_publication_files_v1'&&call.args.p_action==='save');
async function showSource(editor,f){
 // Reused editors can still show the old panel until their search-open message arrives.
 await waitForWorkspaceView(f,editor);
 if(!await editor.locator('#workspaceSource').isVisible())await editor.locator('#workspaceEditPost').click();
 await waitForWorkspaceView(f,editor,'source');
}
async function showPreview(editor,f){
 await waitForWorkspaceView(f,editor);
 if(!await editor.locator('#workspacePreview').isVisible())await editor.locator('#workspacePreviewEdits').click();
 await waitForWorkspaceView(f,editor,'preview');
}

for(const mobile of [false,true]){
 const label=mobile?'mobile':'desktop';
 test(label+': a new signed-in customer reaches the empty catalogue and first file preparation through real navigation',{timeout:45000},async t=>{
  const f=await fixture(t,mobile,{startAtLogin:true});
  await f.signIn('second');
  await f.page.waitForFunction(()=>document.getElementById('dashboard')?.contentDocument?.querySelector('.sma-file-toolbar button')?.disabled===false);
  await f.dashboard.getByRole('tab',{name:'Arbeitsbereich',selected:true}).waitFor();
  await f.dashboard.getByRole('button',{name:'Beitrag vorbereiten',exact:true}).click();
  const portals=f.dashboard.getByRole('tab',{name:'Portale',exact:true});
  const fileTab=f.dashboard.getByRole('tab',{name:'Dateien',exact:true});
  assert.equal(await portals.getAttribute('aria-selected'),'true');
  await fileTab.click();
  const emptyCatalogue=f.dashboard.getByText('Noch keine Bild- oder Videodateien in der gespeicherten Liste.',{exact:true});
  await emptyCatalogue.waitFor();
  assert.equal(await f.dashboard.locator('.sma-file-grid .sma-file-row').count(),0);
  assert.equal(await f.dashboard.locator('iframe[data-portal]').count(),0);
  await f.launcher.click();await f.input.fill(query);
  await f.dialog.getByText('Keine Treffer. Versuche einen kürzeren Begriff.',{exact:true}).waitFor();
  assert.equal(await f.dialog.locator('[data-quick-file]').count(),0);
  await f.input.press('Escape');await f.dialog.waitFor({state:'hidden'});
  assert.equal(await fileTab.getAttribute('aria-selected'),'true');
  assert(await emptyCatalogue.isVisible());assert(await focused(f.launcher));
  await portals.click();await f.dashboard.locator('.sma-optimize[data-portal="youtube"]').click();
  const firstUpload=f.editor.getByRole('button',{name:'Leere Dateivorschau für den ersten Upload öffnen'});
  await firstUpload.waitFor();
  assert.equal(await f.editor.locator('#filePickerCount').textContent(),'Noch keine Dateien in deiner Galerie.');
  await firstUpload.click();await waitForWorkspaceView(f,f.editor,'preview');
  await f.editor.getByRole('heading',{name:'Datei für YouTube vorbereiten',exact:true}).waitFor();
  assert(await f.editor.locator('#workspaceUploadIntro').isVisible());
  assert.equal(await f.editor.locator('#workspaceEditPost').isVisible(),false);
  assert.equal(await f.editor.locator('#preparePublicationOrder').isVisible(),false);
  const add=f.editor.getByRole('button',{name:'Datei hinzufügen',exact:true});
  const [picker]=await Promise.all([f.page.waitForEvent('filechooser'),add.click()]);
  assert.equal(await picker.element().getAttribute('accept'),'video/*');
  await picker.setFiles([]);
  await f.previewBack.click();await firstUpload.waitFor();
  await f.page.waitForFunction(()=>history.state?.smaOptimization&&history.state.view==='files'&&!history.state.assetId);
  await f.dashboard.getByRole('button',{name:'Zurück zur Veröffentlichung',exact:true}).click();
  await f.dashboard.locator('#smaOptimizationPage').waitFor({state:'hidden'});
  assert.equal(await portals.getAttribute('aria-selected'),'true');
  await f.page.goForward();await firstUpload.waitFor();
  await f.page.goForward();await waitForWorkspaceView(f,f.editor,'preview');
  await f.page.goBack();await firstUpload.waitFor();
  assert(await focused(firstUpload));
  const fileReads=f.calls.filter(call=>call.path==='/fixture/sma_publication_files_v1');
  assert.ok(fileReads.some(call=>call.args.p_input?.dashboard_labels));
  assert.ok(fileReads.some(call=>call.args.p_input?.platform==='youtube'));
  assert.ok(fileReads.every(call=>call.owner==='second'&&call.args.p_action==='list'));
  assert.equal(f.calls.filter(call=>call.path==='/webhook/sma-publication-files-v1').length,1);
  assert.deepEqual(f.calls.filter(call=>!['/fixture/sign-in','/fixture/sma_publication_files_v1','/fixture/sma_publication_preview_v1','/rest/v1/rpc/sma_gallery_music_v1','/webhook/sma-publication-files-v1'].includes(call.path)),[],
   'opening and cancelling the file picker never fetches, uploads, edits or publishes media');
 });
 for(const departure of ['logout','account-change'])test(label+': '+departure+' clears both file checkpoints before re-entry even with a late save receipt',{timeout:45000},async t=>{
  const f=await fixture(t,mobile,{distinctDrafts:true,allowDraftSave:true}),other=uuid(2);
  const editorA=editorFor(f,wanted),editorB=editorFor(f,other),bodyA=editorA.locator('#youtube-body'),bodyB=editorB.locator('#youtube-body');
  const sent='Die ausdrücklich gespeicherte Fassung von A bleibt auf dem simulierten Server.';
  const privateA='Private spätere Eingabe von A vor dem Verlassen des Kontos.';
  const privateB='Private offene Eingabe von B vor dem Verlassen des Kontos.';
  await f.open();await f.edit();await bodyA.fill(sent);f.loseNextSaveReply(wanted);
  await editorA.locator('#save').click();await waitForFile(f,wanted);await editorA.locator('#checkDraftSave').waitFor();
  await bodyA.fill(privateA);
  if(await editorA.locator('#sourcePanel').getAttribute('open')===null)await editorA.locator('#sourceSummary').click();
  await editorA.locator('#source_text').fill(pendingSource);
  await openSearchFile(f,other);await showSource(editorB,f);await bodyB.fill(privateB);
  await openSearchFile(f,wanted);await showSource(editorA,f);
  const receipt=f.holdDraft();f.allowDraftRead(wanted);await editorA.locator('#checkDraftSave').click();await receipt.started;
  await openSearchFile(f,other);await showSource(editorB,f);assert.equal(await bodyB.inputValue(),privateB);
  assert.ok(await checkpoint(f,wanted));assert.ok(await checkpoint(f,other));assert.equal(draftWrites(f).length,1);
  const authCalls=f.calls.length;
  if(departure==='logout'){
   const signOut=f.holdSignOut();await f.dashboard.getByRole('button',{name:'Abmelden',exact:true}).click();await signOut.started;
   assert.equal(await f.page.locator('#dashboard').isVisible(),false);
   assert.equal(await checkpoint(f,wanted),null,'A is purged before the sign-out service replies');
   assert.equal(await checkpoint(f,other),null,'B is purged before the sign-out service replies');
   receipt.release();signOut.release();await f.signIn();
   assert.equal(f.calls.slice(authCalls).filter(call=>call.path==='/fixture/sign-out').length,1);
  }else{
   await f.switchOwner('second');
   assert.equal(await checkpoint(f,wanted),null);assert.equal(await checkpoint(f,other),null);
   receipt.release();
   await f.launcher.click();assert.equal(await f.input.inputValue(),'');await f.input.fill(query);
   await f.dialog.getByText('Keine Treffer. Versuche einen kürzeren Begriff.',{exact:true}).waitFor();
   assert.equal(await f.dialog.locator('[data-quick-file]').count(),0,'another account never sees the former file search');
   await f.input.press('Escape');
   for(const direction of ['goBack','goForward']){
    await f.page[direction]();
    await f.page.waitForFunction(()=>document.getElementById('dashboard')?.contentDocument?.body?.dataset.smaCustomerId==='second');
    assert.equal(await f.dashboard.locator('iframe[data-portal]').count(),0,'old history cannot restore a former account editor');
    assert.equal(await checkpoint(f,wanted),null);assert.equal(await checkpoint(f,other),null);
   }
   await f.switchOwner('fixture');
  }
  assert.equal(await checkpoint(f,wanted),null);assert.equal(await checkpoint(f,other),null);
  await openSearchFile(f,wanted);await showSource(editorA,f);
  assert.equal(await bodyA.inputValue(),sent,'returning to the former account starts from the actually saved A');
  assert.equal((await editorA.locator('#source_text').inputValue()).includes(pendingSource),false);
  assert.equal(await editorA.locator('#checkDraftSave').isVisible(),false);
  await openSearchFile(f,other);await showSource(editorB,f);
  assert.equal(await bodyB.inputValue(),'Gespeicherter Suchweg-Text.','B has no remaining local draft after explicit account departure');
  await showPreview(editorB,f);await editorB.locator('#workspacePreviewBack').click();await f.dialog.waitFor();
  assert(await focused(f.dialog.locator('[data-quick-file="'+other+'"]')));
  await f.page.goForward();await editorB.locator('#workspacePreview').waitFor();
  await f.page.goBack();await f.dialog.waitFor();assert(await focused(f.dialog.locator('[data-quick-file="'+other+'"]')));
  assert.equal(draftWrites(f).length,1);assert.equal(f.savedDraft(wanted).preview.drafts[0].body,sent);
  assert.equal(await checkpoint(f,wanted),null);assert.equal(await checkpoint(f,other),null);
 });
 test(label+': a lost save receipt resolves while A is hidden without replacing later A edits or B navigation',{timeout:45000},async t=>{
  const f=await fixture(t,mobile,{distinctDrafts:true,allowDraftSave:true}),other=uuid(2);
  const editorA=editorFor(f,wanted),editorB=editorFor(f,other),bodyA=editorA.locator('#youtube-body'),bodyB=editorB.locator('#youtube-body');
  const sent='Diese erste Fassung von A wird trotz verlorener Antwort genau einmal gespeichert.';
  const later='Diese neuere Eingabe von A wurde noch nicht ausdrücklich gespeichert.';
  const laterB='Neuere Eingaben in B während die Bestätigung für A noch aussteht.';
  const rawTags='#Spaeter #Spaeter';
  await f.open();await f.edit();await bodyA.fill(sent);
  const before=f.savedDraft(wanted);f.loseNextSaveReply(wanted);
  await editorA.locator('#save').click();await waitForFile(f,wanted);
  await editorA.locator('#checkDraftSave').waitFor();
  assert.equal(await editorA.locator('#save').isVisible(),false);
  assert.match(await editorA.locator('#saveStatus').textContent(),/Speicherstand ist noch unklar/);
  assert.equal(draftWrites(f).length,1);assert.equal(f.savedDraft(wanted).revision,before.revision+1);
  assert.equal(f.savedDraft(wanted).preview.drafts[0].body,sent);
  const readStart=f.calls.length;
  await editorA.locator('#checkDraftSave').click();await waitForFile(f,wanted);
  assert.deepEqual(f.calls.slice(readStart).filter(call=>call.path==='/fixture/sma_publication_files_v1'&&call.args.p_input?.asset_id===wanted)
   .map(call=>call.args.p_action),['get'],'retrying an unavailable receipt only reads A');
  assert.equal(draftWrites(f).length,1);
  await openSearchFile(f,other);await showSource(editorB,f);await bodyB.fill('Die erste unabhängige Bearbeitung von B bleibt erhalten.');
  await openSearchFile(f,wanted);await showSource(editorA,f);await bodyA.fill(later);
  await editorA.locator('#youtube-hashtags').fill(rawTags);
  if(await editorA.locator('#sourcePanel').getAttribute('open')===null)await editorA.locator('#sourceSummary').click();
  await editorA.locator('#source_text').fill(pendingSource);await editorA.locator('#language').selectOption('en');
  const gate=f.holdDraft();f.allowDraftRead(wanted);
  await editorA.locator('#checkDraftSave').click();await gate.started;
  assert.equal(await bodyA.isDisabled(),true,'A stays locked while its receipt read is pending');
  await openSearchFile(f,other);await showSource(editorB,f);await bodyB.fill(laterB);
  const bCheckpoint=await checkpoint(f,other),route=await f.page.evaluate(()=>JSON.stringify(history.state));assert.ok(bCheckpoint);
  gate.release();await waitForFile(f,wanted);
  assert.match(await editorA.locator('#saveStatus').textContent(),/gesendete Fassung ist gespeichert.*späteren Texteingaben sind noch offen/);
  assert.equal(await editorA.locator('#checkDraftSave').getAttribute('hidden'),'');
  assert.equal(await bodyA.inputValue(),later);assert.equal(await editorA.locator('#youtube-hashtags').inputValue(),rawTags);
  assert.equal(await editorA.locator('#source_text').inputValue(),pendingSource);assert.equal(await editorA.locator('#language').inputValue(),'en');
  assert.equal(await bodyB.inputValue(),laterB);assert.equal(await checkpoint(f,other),bCheckpoint);
  assert.equal(await f.page.evaluate(()=>JSON.stringify(history.state)),route);
  assert(await f.page.evaluate(id=>{
   const dashboard=document.getElementById('dashboard'),editor=dashboard.contentDocument.querySelector('iframe[data-key="youtube:'+id+'"]');
   return document.activeElement===dashboard&&dashboard.contentDocument.activeElement===editor&&editor.contentDocument.activeElement?.id==='youtube-body';
  },other),'a background receipt leaves the keyboard focus in B');
  assert.equal(draftWrites(f).length,1);assert.equal(f.savedDraft(wanted).revision,before.revision+1);
  await openSearchFile(f,wanted);await showSource(editorA,f);
  await f.page.reload({waitUntil:'domcontentloaded'});await waitForFile(f,wanted);await showSource(editorA,f);
  assert.equal(await bodyA.inputValue(),later);assert.equal(await editorA.locator('#youtube-hashtags').inputValue(),rawTags);
  assert.equal(await editorA.locator('#source_text').inputValue(),pendingSource);assert.equal(await editorA.locator('#language').inputValue(),'en');
  assert.equal(await editorA.locator('#checkDraftSave').isVisible(),false);
  assert.equal(await checkpoint(f,other),bCheckpoint);assert.equal(draftWrites(f).length,1);
  assert.equal(f.savedDraft(wanted).preview.drafts[0].body,sent,'later input stays local until another explicit save');
  await showPreview(editorA,f);
  assert.equal(await editorA.locator('#workspacePostCaption').textContent(),later);
  assert.equal(await editorA.locator('#workspacePostTags').textContent(),rawTags);
  assert.equal(await editorA.locator('#workspaceDraftAction').textContent(),'Hashtags korrigieren');
  await editorA.locator('#workspacePreviewBack').click();await f.dialog.waitFor();assert(await focused(f.hit));
  await f.page.goForward();await editorA.locator('#workspacePreview').waitFor();assert.equal(await bodyA.inputValue(),later);
  await f.page.goBack();await f.dialog.waitFor();assert(await focused(f.hit));
  await f.dialog.locator('[data-quick-file="'+other+'"]').click();await waitForFile(f,other);assert.equal(await bodyB.inputValue(),laterB);
  await showPreview(editorB,f);await editorB.locator('#workspacePreviewBack').click();await f.dialog.waitFor();
  assert(await focused(f.dialog.locator('[data-quick-file="'+other+'"]')));assert.equal(draftWrites(f).length,1);
 });
 test(label+': a second server change during comparison requires another choice after real reload and preserves B',{timeout:45000},async t=>{
  const f=await fixture(t,mobile,{distinctDrafts:true,allowDraftSave:true}),other=uuid(2);
  const editorA=editorFor(f,wanted),editorB=editorFor(f,other);
  const bodyA=editorA.locator('#youtube-body'),bodyB=editorB.locator('#youtube-body');
  const localA='Meine lokalen Eingaben von A bleiben bis zur bewussten Übernahme erhalten.';
  const localB='Die offenen Eingaben von B bleiben während weiterer A-Versionen erhalten.';
  await f.open();await f.edit();await bodyA.fill(localA);
  if(await editorA.locator('#sourcePanel').getAttribute('open')===null)await editorA.locator('#sourceSummary').click();
  await editorA.locator('#source_text').fill(pendingSource);await editorA.locator('#language').selectOption('en');
  await openSearchFile(f,other);await showSource(editorB,f);await bodyB.fill(localB);
  const otherCheckpoint=await checkpoint(f,other);assert.ok(otherCheckpoint);
  await openSearchFile(f,wanted);
  const first=f.advanceDraft(wanted,{title:'Suchweg erste externe Änderung',body:'Die erste externe Änderung am Beitrag von Datei A.'});
  await f.page.reload({waitUntil:'domcontentloaded'});await waitForFile(f,wanted);await showSource(editorA,f);
  assert.equal(await bodyA.inputValue(),localA);assert.equal(await editorA.locator('#save').isDisabled(),true);
  const compare=editorA.locator('#compareDraft'),dialog=editorA.locator('#draftConflictDialog');
  await compare.click();await dialog.waitFor();
  assert.match(await dialog.textContent(),new RegExp(first.preview.drafts[0].body));
  const second=f.advanceDraft(wanted,{title:'Suchweg zweite externe Änderung',body:'Die zweite externe Änderung entstand während des offenen Vergleichs.'});
  await dialog.locator('input[name="draft-conflict-body"]').nth(0).check();
  await editorA.locator('#draftConflictApply').click();await dialog.waitFor({state:'hidden'});await waitForFile(f,wanted);
  assert.equal(draftWrites(f).length,0,'accepting an earlier comparison does not write');
  await editorA.locator('#save').click();
  await editorA.locator('#saveStatus').getByText('Änderungen noch nicht gespeichert',{exact:true}).waitFor();
  assert.equal(draftWrites(f).length,1);
  assert.equal(draftWrites(f)[0].args.p_input.assignment_revision,first.assignment_revision);
  assert.deepEqual(f.savedDraft(wanted),second,'the server refuses the now-stale assignment without overwriting it');
  assert.equal(await bodyA.inputValue(),localA);assert.equal(await compare.isVisible(),true);
  assert.equal(await checkpoint(f,other),otherCheckpoint);
  // Use the browser's actual reload, including the existing pagehide checkpoint.
  await f.page.reload({waitUntil:'domcontentloaded'});await waitForFile(f,wanted);await showSource(editorA,f);
  assert.equal(await bodyA.inputValue(),localA);assert.equal(await editorA.locator('#source_text').inputValue(),pendingSource);
  assert.equal(await editorA.locator('#language').inputValue(),'en');
  assert.equal(await editorA.locator('#save').isDisabled(),true,'reload still requires comparison against the latest baseline');
  assert.equal(await checkpoint(f,other),otherCheckpoint);assert.equal(draftWrites(f).length,1);
  await compare.click();await dialog.waitFor();
  assert.match(await dialog.textContent(),new RegExp(second.preview.drafts[0].body));
  assert.equal(await editorA.locator('#draftConflictApply').isDisabled(),true);
  await dialog.locator('input[name="draft-conflict-body"]').nth(0).check();
  await editorA.locator('#draftConflictApply').click();await dialog.waitFor({state:'hidden'});await waitForFile(f,wanted);
  assert.equal(draftWrites(f).length,1,'the second selection still needs an explicit save');
  await editorA.locator('#save').click();
  await editorA.locator('#saveStatus').getByText('Dieser Datei und diesem Portal zugeordnet',{exact:true}).waitFor();
  assert.equal(draftWrites(f).length,2);assert.equal(draftWrites(f)[1].args.p_input.assignment_revision,second.assignment_revision);
  assert.equal(f.savedDraft(wanted).revision,second.revision+1,'only the accepted save advances the server revision');
  assert.equal(f.savedDraft(wanted).preview.drafts[0].body,localA);
  assert.equal(f.savedDraft(wanted).preview.drafts[0].title,second.preview.drafts[0].title);
  assert.equal(await editorA.locator('#source_text').inputValue(),pendingSource,'saving the post retains its separate source input');
  assert.equal(await checkpoint(f,other),otherCheckpoint);
  await showPreview(editorA,f);await editorA.locator('#workspacePreviewBack').click();await f.dialog.waitFor();
  assert(await focused(f.hit));assert.equal(await f.input.inputValue(),query);
  await f.page.goForward();await editorA.locator('#workspacePreview').waitFor();assert.equal(await bodyA.inputValue(),localA);
  await f.page.goBack();await f.dialog.waitFor();assert(await focused(f.hit));
  await f.dialog.locator('[data-quick-file="'+other+'"]').click();await waitForFile(f,other);
  assert.equal(await bodyB.inputValue(),localB);
  await showPreview(editorB,f);await editorB.locator('#workspacePreviewBack').click();await f.dialog.waitFor();
  assert(await focused(f.dialog.locator('[data-quick-file="'+other+'"]')));
 });
 for(const choice of ['local','stored'])test(label+': two file checkpoints survive a newer server draft, explicit '+choice+' comparison and real history',{timeout:45000},async t=>{
  const f=await fixture(t,mobile,{distinctDrafts:true,allowDraftSave:choice==='local'}),other=uuid(2);
  const editorA=editorFor(f,wanted),editorB=editorFor(f,other);
  const bodyA=editorA.locator('#youtube-body'),bodyB=editorB.locator('#youtube-body');
  const textA='Meine offene Bearbeitung von Datei A vor dem Versionsvergleich.';
  const textB='Die unabhängige offene Bearbeitung von Datei B bleibt erhalten.';
  const remoteBody='Die inzwischen gespeicherte Fassung von Datei A aus einem zweiten Editor.';
  await f.open();await f.edit();await bodyA.fill(textA);
  if(choice==='stored'){
   if(await editorA.locator('#sourcePanel').getAttribute('open')===null)await editorA.locator('#sourceSummary').click();
   await editorA.locator('#source_text').fill(pendingSource);await editorA.locator('#language').selectOption('en');
  }
  await openSearchFile(f,other);await showSource(editorB,f);await bodyB.fill(textB);
  const otherCheckpoint=await checkpoint(f,other);assert.ok(otherCheckpoint);
  await openSearchFile(f,wanted);
  const newer=f.advanceDraft(wanted,{title:'Suchweg neuer Titel vom zweiten Editor',body:remoteBody});
  await f.page.reload({waitUntil:'domcontentloaded'});await waitForFile(f,wanted);
  await showSource(editorA,f);
  assert.equal(await bodyA.inputValue(),textA,'reload keeps the local body until a deliberate choice');
  assert.equal(await editorA.locator('#save').isDisabled(),true,'a changed server baseline cannot be blindly saved');
  assert.equal(await checkpoint(f,other),otherCheckpoint);
  assert.equal(draftWrites(f).length,0);
  const compare=editorA.locator('#compareDraft'),dialog=editorA.locator('#draftConflictDialog');
  await compare.click();await dialog.waitFor();
  assert.match(await dialog.textContent(),new RegExp(remoteBody));
  assert.match(await dialog.textContent(),new RegExp(textA));
  assert.equal(await editorA.locator('#draftConflictApply').isDisabled(),true,'conflicting body requires an explicit selection');
  await editorA.locator('#draftConflictBack').click();await waitForFile(f,wanted);
  assert.equal(await bodyA.inputValue(),textA,'cancelling comparison preserves the local text');
  assert.equal(await checkpoint(f,other),otherCheckpoint);
  assert.equal(draftWrites(f).length,0,'opening or cancelling comparison never saves');
  await compare.click();await dialog.waitFor();
  await dialog.locator('input[name="draft-conflict-body"]').nth(choice==='local'?0:1).check();
  await editorA.locator('#draftConflictApply').click();await dialog.waitFor({state:'hidden'});await waitForFile(f,wanted);
  assert.equal(draftWrites(f).length,0,'accepting comparison only stages the chosen fields');
  assert.equal(await bodyA.inputValue(),choice==='local'?textA:remoteBody);
  assert.equal(await editorA.locator('#youtube-title').inputValue(),newer.preview.drafts[0].title,'unchanged local title adopts the newer server title');
  assert.equal(await checkpoint(f,other),otherCheckpoint,'comparison changes only A');
  if(choice==='local'){
   await editorA.locator('#save').click();
   await editorA.locator('#saveStatus').getByText('Dieser Datei und diesem Portal zugeordnet',{exact:true}).waitFor();
   assert.equal(draftWrites(f).length,1,'only the explicit save creates one synthetic write');
   assert.equal(draftWrites(f)[0].args.p_input.assignment_revision,newer.assignment_revision);
   assert.equal(f.savedDraft(wanted).preview.drafts[0].body,textA);
   assert.equal(await checkpoint(f,wanted),null,'saving A clears only its completed checkpoint');
  }else{
   assert.equal(await editorA.locator('#source_text').inputValue(),pendingSource);
   assert.equal(await editorA.locator('#language').inputValue(),'en');
   assert.ok(await checkpoint(f,wanted),'remaining source edits must keep a checkpoint after choosing all saved post fields');
   await f.page.reload({waitUntil:'domcontentloaded'});await waitForFile(f,wanted);
   assert.equal(await editorA.locator('#source_text').inputValue(),pendingSource,'remaining description survives a second full reload');
   assert.equal(await editorA.locator('#language').inputValue(),'en');
   assert.equal(await bodyA.inputValue(),remoteBody);
   assert.equal(await editorA.locator('#compareDraft').isVisible(),false,'the accepted server baseline needs no duplicate comparison');
   assert.equal(draftWrites(f).length,0);
  }
  assert.equal(await checkpoint(f,other),otherCheckpoint,'save or reload of A leaves B byte-for-byte intact');
  await showPreview(editorA,f);await editorA.locator('#workspacePreviewBack').click();
  await f.dialog.waitFor();assert.equal(await f.input.inputValue(),query);assert(await focused(f.hit));
  await f.page.goForward();await editorA.locator('#workspacePreview').waitFor();
  assert.equal(await f.page.evaluate(()=>history.state.assetId),wanted);
  assert.equal(await bodyA.inputValue(),choice==='local'?textA:remoteBody);
  await f.page.goBack();await f.dialog.waitFor();assert(await focused(f.hit));
  await f.dialog.locator('[data-quick-file="'+other+'"]').click();await waitForFile(f,other);
  assert.equal(await bodyB.inputValue(),textB,'B recovers its unchanged checkpoint through the original search');
  await showPreview(editorB,f);await editorB.locator('#workspacePreviewBack').click();await f.dialog.waitFor();
  assert(await focused(f.dialog.locator('[data-quick-file="'+other+'"]')));
  // This later search was opened from the editor's publishing page, not the
  // initial account chapter. Its own origin must remain active behind the dialog.
  assert.equal(await f.dashboard.locator('#page-publishing').isVisible(),true);
  assert.equal(await f.dashboard.locator('#sma-publishing-tab-files').getAttribute('aria-selected'),'true');
 });
 test(label+': a slow conflicting reload of A cannot replace newer edits or history in B',{timeout:45000},async t=>{
  const f=await fixture(t,mobile,{distinctDrafts:true}),other=uuid(2);
  const editorA=editorFor(f,wanted),editorB=editorFor(f,other),bodyA=editorA.locator('#youtube-body'),bodyB=editorB.locator('#youtube-body');
  const textA='Die lokale Bearbeitung von A wartet auf den Versionsvergleich.';
  const textB='Neuere Eingaben in B während die Antwort für A noch aussteht.';
  await f.open();await f.edit();await bodyA.fill(textA);
  await openSearchFile(f,other);await showSource(editorB,f);await bodyB.fill('Frühere ungesicherte Eingaben in Datei B.');
  await openSearchFile(f,wanted);
  f.advanceDraft(wanted,{body:'Neue gespeicherte A-Fassung für den verzögerten Abruf.'});
  const gate=f.holdDraft();await f.page.reload({waitUntil:'domcontentloaded'});await gate.started;
  await f.page.goBack();await f.dialog.waitFor();assert(await focused(f.hit));
  await f.dialog.locator('[data-quick-file="'+other+'"]').click();await waitForFile(f,other);
  await showSource(editorB,f);await bodyB.fill(textB);
  const before=await checkpoint(f,other),route=await f.page.evaluate(()=>JSON.stringify(history.state));
  gate.release();await waitForFile(f,wanted);
  assert.equal(await bodyA.inputValue(),textA);assert.equal(await editorA.locator('#compareDraft').getAttribute('hidden'),null);
  assert.equal(await bodyB.inputValue(),textB);assert(await focused(bodyB));
  assert(await f.page.evaluate(id=>{
   const dashboard=document.getElementById('dashboard'),editor=dashboard.contentDocument.querySelector('iframe[data-key="youtube:'+id+'"]');
   return document.activeElement===dashboard&&dashboard.contentDocument.activeElement===editor&&editor.contentDocument.activeElement?.id==='youtube-body';
  },other),'late A restoration leaves the whole keyboard focus chain in B');
  assert.equal(await checkpoint(f,other),before,'late A restoration cannot update B storage');
  assert.equal(await f.page.evaluate(()=>JSON.stringify(history.state)),route,'late A restoration cannot replace B navigation');
  assert.equal(draftWrites(f).length,0);
  await showPreview(editorB,f);await editorB.locator('#workspacePreviewBack').click();await f.dialog.waitFor();
  assert(await focused(f.dialog.locator('[data-quick-file="'+other+'"]')));
  await f.page.goForward();await editorB.locator('#workspacePreview').waitFor();assert.equal(await bodyB.inputValue(),textB);
  await f.page.goBack();await f.dialog.waitFor();
  await f.hit.click();await showSource(editorA,f);await editorA.locator('#compareDraft').click();
  await editorA.locator('#draftConflictDialog').waitFor();
  assert.equal(await editorA.locator('#draftConflictApply').isDisabled(),true);
  await editorA.locator('#draftConflictBack').click();await waitForFile(f,wanted);
  assert.equal(await bodyA.inputValue(),textA);assert.equal(await bodyB.inputValue(),textB);assert.equal(draftWrites(f).length,0);
 });
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
 for(const view of ['source','preview'])for(const delayed of [false,true]){
  test(label+': full reload preserves an ordinary unsaved '+view+' view'+(delayed?' after slow catalog and draft reads':'')+' and its search history',{timeout:30000},async t=>{
   const f=await fixture(t,mobile);await f.open();await f.edit();
   const source=f.editor.locator('#source_text'),language=f.editor.locator('#language');
   if(await f.editor.locator('#sourcePanel').getAttribute('open')===null)await f.editor.locator('#sourceSummary').click();
   await source.fill(pendingSource);await language.selectOption('en');
   if(view==='preview'){
    await f.editor.locator('#workspacePreviewEdits').click();
    await f.page.waitForFunction(()=>history.state?.view==='preview');
   }
   const originalRoute=await f.page.evaluate(()=>history.state);
   const gate=delayed?f.holdCatalog([...files.slice(1),files[0]]):null;
   const draftGate=delayed?f.holdDraft():null;
   await f.page.reload({waitUntil:'domcontentloaded'});
   if(gate){
    await gate.started;
    assert.equal(await f.dashboard.locator('iframe[data-portal]').count(),0,'restore waits for the current owned catalog');
    await gate.release();
   }
   if(draftGate){
    // The new child has its scripts but not its saved draft yet. Releasing this
    // separately exercises restoration after the parent's early navigation message.
    await draftGate.started;draftGate.release();
   }
   await f.body.waitFor({state:'attached'});
   await f.page.waitForFunction(()=>{
    const dashboard=document.getElementById('dashboard').contentDocument;
    return dashboard?.querySelector('iframe[data-portal="youtube"]')?.contentDocument?.getElementById('youtube-body')?.disabled===false;
   });
   assert.equal(await f.body.inputValue(),pending,'ordinary typing is restored without a server save');
   assert.equal(await source.inputValue(),pendingSource,'the unsaved file description survives reload');
   assert.equal(await language.inputValue(),'en','the unsaved language selection survives reload');
   await f.editor.locator(view==='source'?'#workspaceSource':'#workspacePreview').waitFor();
   await f.page.waitForFunction(expected=>history.state?.view===expected,view);
   const restored=await f.page.evaluate(()=>history.state);
   for(const key of ['searchKey','assetId','portal','view'])assert.equal(restored?.[key],originalRoute[key],'reload keeps '+key);
   assert.equal(await f.editor.locator(view==='source'?'#workspaceSource':'#workspacePreview').isVisible(),true,'reload keeps the visible workspace');
   if(view==='preview')assert.equal(await f.editor.locator('#workspacePostCaption').textContent(),pending);
   const restoredFrame=await f.dashboard.locator('iframe[data-portal="youtube"]').elementHandle();
   await f.page.goBack();await f.dialog.waitFor();
   assert.equal(await f.input.inputValue(),query);assert(await focused(f.hit));
   assert.equal(await f.account.getAttribute('aria-selected'),'true');
   await f.page.goForward();
   await f.editor.locator(view==='source'?'#workspaceSource':'#workspacePreview').waitFor();
   assert.equal(await f.body.inputValue(),pending);
   assert.equal(await source.inputValue(),pendingSource);
   assert.equal(await language.inputValue(),'en');
   assert.equal(await f.page.evaluate(()=>history.state?.searchKey),originalRoute.searchKey);
   assert(await restoredFrame.evaluate(el=>el===el.ownerDocument.querySelector('iframe[data-portal="youtube"]')),'Back and Forward reuse the restored editor');
   if(view==='source')await f.editor.locator('#workspacePreviewEdits').click();
   await f.previewBack.click();await f.dialog.waitFor();assert(await focused(f.hit));
   await f.page.keyboard.press('Escape');assert(await focused(f.launcher));
  });
 }
 test(label+': a new search during slow reload cancels the old preview restore and keeps edits bound to their file',{timeout:30000},async t=>{
  const f=await fixture(t,mobile);await f.open();await f.edit();
  await f.editor.locator('#workspacePreviewEdits').click();
  await f.page.waitForFunction(()=>history.state?.view==='preview');
  const portalReads=()=>f.calls.filter(call=>call.path==='/fixture/sma_publication_files_v1'&&call.args.p_action==='list'&&call.args.p_input?.platform).length;
  const readsBefore=portalReads(),gate=f.holdCatalog();
  await f.page.reload({waitUntil:'domcontentloaded'});await gate.started;
  await f.account.click();await f.launcher.click();await f.input.fill('Suchweg Beitrag 14');
  await gate.release();
  assert.equal(await f.input.inputValue(),'Suchweg Beitrag 14');assert(await focused(f.input));
  assert.equal(await f.dashboard.locator('iframe[data-portal]').count(),0,'late catalog cannot reopen the cancelled preview');
  assert.equal(portalReads(),readsBefore,'cancellation does not read the old portal draft');
  assert.equal(await f.page.evaluate(()=>Boolean(history.state?.smaOptimization)),false);
  const otherHit=f.dialog.locator('[data-quick-file="'+uuid(14)+'"]');await otherHit.click();
  await f.editor.locator('#workspaceEditPost').waitFor();
  assert.equal(await f.body.inputValue(),'Gespeicherter Suchweg-Text.','unsaved text from another file must not leak into the new selection');
  assert.equal(await f.page.evaluate(()=>history.state?.assetId),uuid(14));
  await f.previewBack.click();await f.dialog.waitFor();
  assert.equal(await f.input.inputValue(),'Suchweg Beitrag 14');assert(await focused(otherHit));
 });
 test(label+': a deliberate workspace tab change during a slow child reload wins over the saved preview view',{timeout:30000},async t=>{
  const f=await fixture(t,mobile);await f.open();await f.edit();
  await f.editor.locator('#workspacePreviewEdits').click();
  await f.page.waitForFunction(()=>history.state?.view==='preview');
  const catalogGate=f.holdCatalog(),draftGate=f.holdDraft();
  await f.page.reload({waitUntil:'domcontentloaded'});await catalogGate.started;
  await catalogGate.release();await draftGate.started;
  const sourceTab=f.editor.locator('#workspaceTab-source');
  assert.equal(await sourceTab.isEnabled(),true,'workspace navigation remains usable while the draft read is pending');
  await sourceTab.click();await f.page.waitForFunction(()=>history.state?.view==='source');
  draftGate.release();
  await f.body.waitFor();
  await f.page.waitForFunction(()=>{
   const editor=document.getElementById('dashboard').contentDocument.querySelector('iframe[data-portal="youtube"]');
   return editor?.dataset.restoring!=='true'&&editor?.contentDocument?.getElementById('youtube-body')?.disabled===false;
  });
  assert.equal(await f.page.evaluate(()=>history.state?.view),'source');
  assert.equal(await f.editor.locator('#workspaceSource').isVisible(),true);
  assert.equal(await f.editor.locator('#workspacePreview').isVisible(),false);
  assert.equal(await f.body.inputValue(),pending,'the newer view choice does not lose the restored local text');
 });
 test(label+': child readiness cannot take focus away from a newer global search opened during reload',{timeout:30000},async t=>{
  const f=await fixture(t,mobile);await f.open();await f.edit();
  await f.editor.locator('#workspacePreviewEdits').click();
  await f.page.waitForFunction(()=>history.state?.view==='preview');
  const catalogGate=f.holdCatalog(),draftGate=f.holdDraft();
  await f.page.reload({waitUntil:'domcontentloaded'});await catalogGate.started;
  await catalogGate.release();await draftGate.started;
  await f.launcher.click();await f.input.fill('Suchweg Beitrag 14');
  assert(await focused(f.input));
  draftGate.release();
  await f.body.waitFor({state:'attached'});
  await f.page.waitForFunction(()=>{
   const editor=document.getElementById('dashboard').contentDocument.querySelector('iframe[data-portal="youtube"]');
   return editor?.dataset.restoring!=='true'&&editor?.contentDocument?.getElementById('youtube-body')?.disabled===false;
  });
  await f.editor.locator('#workspacePreview').waitFor();
  assert.equal(await f.dialog.isVisible(),true);
  assert.equal(await f.input.inputValue(),'Suchweg Beitrag 14');
  assert(await focused(f.input),'restoring the background preview must not focus its return button behind the modal');
  assert.equal(await f.dialog.locator('[data-quick-file="'+uuid(14)+'"]').count(),1);
  assert.equal(await f.body.inputValue(),pending);
 });
 test(label+': reopening a search result focuses the same editor after its reload completed while hidden',{timeout:30000},async t=>{
  const f=await fixture(t,mobile);await f.open();await f.edit();
  await f.editor.locator('#workspacePreviewEdits').click();
  await f.page.waitForFunction(()=>history.state?.view==='preview');
  const catalogGate=f.holdCatalog(),draftGate=f.holdDraft();
  await f.page.reload({waitUntil:'domcontentloaded'});await catalogGate.started;
  await catalogGate.release();await draftGate.started;
  const restoredFrame=await f.dashboard.locator('iframe[data-portal="youtube"]').elementHandle();
  await f.page.goBack();await f.dialog.waitFor();
  assert.equal(await f.input.inputValue(),query);assert(await focused(f.hit));
  draftGate.release();
  await f.body.waitFor({state:'attached'});
  await f.page.waitForFunction(()=>{
   const editor=document.getElementById('dashboard').contentDocument.querySelector('iframe[data-portal="youtube"]');
   return editor?.dataset.restoring!=='true'&&editor?.contentDocument?.getElementById('youtube-body')?.disabled===false;
  });
  assert.equal(await f.dialog.isVisible(),true);
  assert.equal(await f.input.inputValue(),query);assert(await focused(f.hit),'hidden readiness leaves the restored result focused');
  assert.equal(await f.body.inputValue(),pending);
  await f.hit.click();await f.previewBack.waitFor();
  await f.page.waitForFunction(id=>history.state?.smaOptimization&&history.state.assetId===id&&history.state.view==='preview',wanted);
  assert(await restoredFrame.evaluate(el=>el===el.ownerDocument.querySelector('iframe[data-portal="youtube"]')),'the explicitly reopened result reuses the restored iframe');
  assert.equal(await f.dashboard.locator('iframe[data-portal="youtube"]').count(),1);
  assert.equal(await f.body.inputValue(),pending);
  assert.equal(await f.editor.locator('#workspacePostCaption').textContent(),pending);
  assert(await focused(f.previewBack),'explicit reopening focuses the preview return button after initial loading has finished');
  await f.previewBack.click();await f.dialog.waitFor();
  assert.equal(await f.input.inputValue(),query);assert(await focused(f.hit));
 });
 test(label+': two files in the same portal keep independent unsaved texts across search navigation and a full reload',{timeout:30000},async t=>{
  const f=await fixture(t,mobile,{distinctDrafts:true}),other=uuid(2);
  const textA='Ungespeicherter Text für Datei A im YouTube-Portal.';
  const textB='Ungespeicherter Text für Datei B im selben YouTube-Portal.';
  const selector=id=>'iframe[data-key="youtube:'+id+'"]';
  const editorA=f.dashboard.frameLocator(selector(wanted)),editorB=f.dashboard.frameLocator(selector(other));
  const bodyA=editorA.locator('#youtube-body'),bodyB=editorB.locator('#youtube-body');
  async function openThroughSearch(id){
   await f.launcher.click();await f.input.fill(query);
   await f.dialog.locator('[data-quick-file="'+id+'"]').click();
   await f.dialog.waitFor({state:'hidden'});
   await f.page.waitForFunction(id=>{
    const dashboard=document.getElementById('dashboard').contentDocument;
    const editor=[...dashboard.querySelectorAll('iframe[data-key]')].find(frame=>frame.dataset.key==='youtube:'+id);
    return history.state?.smaOptimization&&history.state.assetId===id&&['source','preview'].includes(history.state.view)&&
     editor?.contentDocument?.getElementById('youtube-body')?.disabled===false;
   },id);
  }
  await f.open();await f.edit();await bodyA.fill(textA);
  const originalA=await f.dashboard.locator(selector(wanted)).elementHandle();
  await openThroughSearch(other);
  await editorB.locator('#workspaceEditPost').click();await bodyB.fill(textB);
  await openThroughSearch(wanted);
  assert(await originalA.evaluate(el=>el===el.ownerDocument.querySelector('iframe[data-key="'+el.dataset.key+'"]')),'returning through search reuses the first file editor');
  assert.equal(await bodyA.inputValue(),textA);assert.equal(await bodyB.inputValue(),textB);
  assert.equal(await f.dashboard.locator('iframe[data-portal="youtube"]').count(),2);
  await editorA.locator('#workspacePreview').waitFor();
  await f.page.reload({waitUntil:'domcontentloaded'});
  await bodyA.waitFor({state:'attached'});
  await f.page.waitForFunction(id=>{
   const dashboard=document.getElementById('dashboard').contentDocument;
   const editor=[...dashboard.querySelectorAll('iframe[data-key]')].find(frame=>frame.dataset.key==='youtube:'+id);
   return editor?.dataset.restoring!=='true'&&editor?.contentDocument?.getElementById('youtube-body')?.disabled===false;
  },wanted);
  assert.equal(await bodyA.inputValue(),textA,'the first file checkpoint must survive editing another file in the same portal');
  assert.equal(await f.dashboard.locator('iframe[data-portal="youtube"]').count(),1,'the reload recreated only the active file editor');
  await editorA.locator('#workspacePreview').waitFor();
  await openThroughSearch(other);
  assert.equal(await bodyB.inputValue(),textB,'restoring the first file must not overwrite the second file checkpoint');
  assert.equal(await bodyA.inputValue(),textA,'both reopened files keep their own local edits');
  assert.equal(await f.page.evaluate(()=>history.state?.assetId),other);
 });
}
