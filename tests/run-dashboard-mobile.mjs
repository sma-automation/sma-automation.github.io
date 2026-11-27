import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {chromium} from './dom-runtime/node_modules/playwright-core/index.mjs';

// All HTML, modules and RPC responses are served from the checkout or fixtures.
const site='https://sma.test';
const dashboard=site+'/app/dashboard.html';
const uuid=n=>'a7700000-0000-4000-8000-'+String(n).padStart(12,'0');
const target=uuid(6),asset=uuid(10),title='Mobiler Privattest';
const expiry={status:'expired',expires_at:'2026-11-13T16:49:00Z'};
const rows=Array.from({length:6},(_,i)=>({
 id:uuid(i+1),platform:'youtube',title:[0,5].includes(i)?title:'Anderer Testauftrag '+i,
 created_at:i===5?'2026-11-13T16:44:00Z':'2026-11-13T17:00:00Z',updated_at:'2026-11-13T17:00:00Z',
 target_name:'Testkanal',status:i===5?'prepared':'private_complete',
 ...(i===5?{approval_window:expiry}:{}),cover:{status:'not_recorded',updated_at:null}
}));
const history={ok:true,version:3,month:'2026-11',timezone:'Europe/Vienna',entries:rows,
 summary:{orders:rows.length,public_confirmed:0,platforms:['youtube']},months:[{month:'2026-11',orders:rows.length}],has_more:false,next:null};
// Three seconds of generated test patterns, H.264 at 12 fps, with no audio.
const original=await readFile(new URL('./fixtures/original-video.mp4',import.meta.url));
const checksum=createHash('sha256').update(original).digest('hex');
const file={id:asset,media_kind:'video',mime_type:'video/mp4',name:'Testclip.mp4',duration_ms:3000,
 width_px:160,height_px:90,size_bytes:original.length,revision:'sha256:'+checksum+':1',
 assignments:[{platform:'youtube',revision:2,status:'assigned'}]};
const draft={platform:'youtube',title:'Aktueller mobiler Entwurf',body:'Testtext für die aktuelle Dateiversion.',
 hashtags:[],review_notes:[],caption:'Testtext für die aktuelle Dateiversion.'};
const saved={ok:true,status:'completed',id:uuid(20),revision:1,assignment_revision:2,
 preview:{can_publish:false,language:'de',shop_url:'https://sma-automation.com/app/shop.html?shop=test',drafts:[draft]}};
const order={ok:true,id:target,state:'prepared',approved_at:null,approval_token:null,approval_window:expiry,
 can_publish:false,can_upload:false,binding:{asset_id:asset,asset_revision:'previous',platform:'youtube',
 preview_id:uuid(19),preview_revision:1,assignment_revision:1}};

// The session endpoint supplies the iframe shell. The real dashboard mounts all controls in it.
const shell=`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;font:16px Arial,sans-serif}aside,.page:not(.active){display:none}
header,main{padding:16px}.card{padding:12px;margin-bottom:12px}</style><body data-sma-customer-id="fixture">
<aside><button data-page="history">History</button><button data-page="publishing">Veröffentlichung</button></aside>
<header class="topbar"><div class="topbar-actions"></div></header><main>
<section class="page" id="page-publishing"><div id="publishingFilesSlot"></div></section>
<section class="page active" id="page-history"><h1>History</h1><div class="grid">
${'<div class="card"><div class="card-title"></div><div class="big-value"></div><div class="muted"></div></div>'.repeat(3)}</div>
<div class="card"><div class="card-title"></div><div id="historyMonthSlot"></div></div>
<div class="card"><div class="card-title"></div><div id="historyActivitySlot"></div></div></section></main>
<script>document.querySelector('aside').onclick=e=>{for(const p of document.querySelectorAll('.page'))p.classList.toggle('active',p.id==='page-'+e.target.dataset.page)}</script></body></html>`;
const client=`export function createClient(){return {
 auth:{getSession:async()=>({data:{session:{user:{id:'fixture'},access_token:'fixture'}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 rpc(name,args){const p=fetch('/fixture/'+name,{method:'POST',body:JSON.stringify(args)}).then(r=>r.json()).then(data=>({data}));p.abortSignal=()=>p;return p;}
}}`;
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0b8AAAAASUVORK5CYII=';
const catalogSyncStatus=({sync_state='idle',retry_after_ms=0,synced_at=null}={})=>({
 ok:true,version:1,can_publish:false,sync_state,retry_after_ms,synced_at
});
async function controlCatalogTime(page){
 // The dashboard's shared refresh driver reads Date.now in the top realm.
 // Playwright Clock also replaces performance navigation entries, breaking F5
 // restoration; keep navigation timing and all timers native in this fixture.
 const original=await page.evaluateHandle(()=>Date.now);
 let now=await page.evaluate(()=>Date.now());
 const set=()=>page.evaluate(value=>{Date.now=()=>value;},now);
 await set();
 return {now,
  async advance(ms){now+=ms;await set();return now;},
  async restore(){await original.evaluate(fn=>{Date.now=fn;});await original.dispose();}
 };
}
function rpc(name,args){
 switch(name){
  case 'sma_publication_history_find_v1':
   assert.equal(args.p_query,title);
   return {ok:true,version:1,has_more:false,can_publish:false,can_upload:false,entries:rows.filter(r=>r.title===title).map(r=>({...r,window:r.approval_window}))};
  case 'sma_publication_history_order_page_v1':
   assert.equal(args.p_order_id,target);return {...history,order_page:2};
  case 'sma_publication_order_v1':
   assert.equal(args.p_action,'get');assert.equal(args.p_input.id,target);return order;
  case 'sma_publication_files_v1':
   if(args.p_action==='sync_status'){assert.deepEqual(args.p_input,{});return catalogSyncStatus();}
   if(args.p_action==='list')return {ok:true,files:[file]};
   assert.equal(args.p_input.asset_id,asset);
   if(args.p_action==='get')return saved;
   assert.equal(args.p_action,'check');return {ok:true};
  case 'sma_publication_video_magic_v1':
   assert.equal(args.p_action,'get');return {ok:false,code:'UNAVAILABLE'};
  case 'sma_publication_editor_result_v1':
   return {ok:true,version:1,can_publish:false,asset_id:asset,asset_revision:file.revision,cover:null};
  default:throw Error('Unexpected RPC '+name);
 }
}
async function serve(route){
 const request=route.request(),url=new URL(request.url()),path=url.pathname;
 const reply=data=>route.fulfill({json:data,headers:{'Access-Control-Allow-Origin':'*'}});
 if(url.origin===site&&request.method()==='GET'&&/^\/app\/(dashboard\.html|publication-preview\.html|assets\/[\w.-]+\.(css|m?js))$/.test(path)){
  const contentType=path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'text/javascript';
  return route.fulfill({contentType,body:await readFile(new URL('..'+path,import.meta.url))});
 }
 if(url.origin==='https://esm.sh'&&path.startsWith('/@supabase/supabase-js@'))return route.fulfill({contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:client});
 if(request.method()==='POST'){
  if(url.origin===site&&path.startsWith('/fixture/'))return reply(rpc(path.slice(9),request.postDataJSON()));
  if(url.origin==='https://johnmusic.app.n8n.cloud'){
   if(path==='/webhook/sma-dashboard-session')return reply({html:shell});
   if(path==='/webhook/sma-publication-asset-preview-v1')return reply({ok:true,can_publish:false,
    asset_id:asset,asset_revision:file.revision,media_kind:'video',mime_type:'image/png',image_base64:png});
  }
  if(url.origin==='https://bnvnmdxosbnuzedokqgh.supabase.co'){
   if(path==='/rest/v1/rpc/sma_publication_history_v3')return reply(history);
   if(path==='/rest/v1/rpc/sma_gallery_music_v1'&&request.postDataJSON().p_action==='claim')return reply({ok:true,state:'idle'});
  }
 }
 throw Error('Unexpected request '+request.method()+' '+path);
}
async function fits(locator,width){
 await locator.waitFor();
 const rect=await locator.evaluate(el=>{
  const r=el.getBoundingClientRect(),root=el.ownerDocument.documentElement;
  return {left:r.left,right:r.right,width:root.clientWidth,scroll:root.scrollWidth};
 });
 assert(rect.width>0&&rect.width<=width+1,JSON.stringify(rect));
 assert(rect.scroll<=rect.width+1&&rect.left>=-1&&rect.right<=rect.width+1,JSON.stringify(rect));
 const box=await locator.boundingBox();
 assert(box&&box.x>=-1&&box.x+box.width<=width+1,JSON.stringify(box));
}
async function mockOriginalVideo(page,failFirstRead=false){
 // Only this explicit playback scenario accepts an original-file request.
 const sourceURL='https://johnmusic.app.n8n.cloud/webhook/sma-publication-editor-source-v1';
 let reads=0;
 await page.route(sourceURL,async route=>{
  const request=route.request();
  assert.equal(request.method(),'POST');
  assert.deepEqual(request.postDataJSON(),{asset_id:file.id,asset_revision:file.revision});
  reads++;
  await route.fulfill({json:{ok:true,can_publish:false,asset_id:file.id,asset_revision:file.revision,
   mime_type:file.mime_type,size_bytes:original.length,sha256:failFirstRead&&reads===1?'0'.repeat(64):checksum,
   data_base64:original.toString('base64')},headers:{'Access-Control-Allow-Origin':'*'}});
 });
 return ()=>reads;
}
async function checkOriginalPlayback(page,width,{failFirstRead}){
 const readCount=await mockOriginalVideo(page,failFirstRead);
 const load=page.getByRole('button',{name:'Originalvideo abspielen'});
 const video=page.locator('#originalVideoPreview video');
 await fits(load,width);await load.tap();
 if(failFirstRead){
  await page.getByText('Das Originalvideo konnte nicht geladen werden. Bitte versuche es erneut.').waitFor();
  assert.equal(await video.isVisible(),false);
  await load.tap();
 }
 await fits(video,width);
 await page.waitForFunction(()=>document.querySelector('#originalVideoPreview video')?.readyState>=2);
 assert.deepEqual(await video.evaluate(v=>[v.videoWidth,v.videoHeight,v.duration,v.paused]),
  [file.width_px,file.height_px,file.duration_ms/1000,false]);
 await page.waitForFunction(()=>{const v=document.querySelector('#originalVideoPreview video');return !v.paused&&v.currentTime>0;});
 await page.locator('#workspaceDetailTab').tap();
 const [paused,ended,pausedAt]=await video.evaluate(v=>[v.paused,v.ended,v.currentTime]);
 assert(paused&&!ended,'switching to file details must pause mid-clip');
 await page.locator('#workspacePostTab').tap();
 assert.deepEqual(await video.evaluate(v=>[v.paused,v.currentTime]),[true,pausedAt]);
 await video.press('Space');
 await page.waitForFunction(()=>document.querySelector('#originalVideoPreview video')?.ended);
 assert.deepEqual(await video.evaluate(v=>[v.error?.code??null,v.currentTime]),[null,file.duration_ms/1000]);
 assert.equal(readCount(),failFirstRead?2:1,'returning to the preview must reuse the verified file');
 console.log(width+'px: original MP4 verified, paused on details and played to end'+(failFirstRead?' after checksum retry':''));
}
async function selectedRow(frame,width){
 const row=frame.locator('.sma-history-list details[open] summary');
 await fits(row,width);
 assert.match(await row.innerText(),/17:44/);
 assert.match(await row.innerText(),/Vorbereitung abgelaufen/);
 assert.match(await frame.locator('#historyActivitySlot [role=status]').first().innerText(),/Seite 2 von 2/);
 const visible=await row.evaluate(el=>{
  const doc=el.ownerDocument,r=el.getBoundingClientRect();
  const hit=doc.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
  return {focus:doc.activeElement?.tagName,focused:doc.activeElement===el,top:r.top,bottom:r.bottom,
    height:doc.documentElement.clientHeight,hit:hit?.outerHTML.slice(0,120),reachable:el.contains(hit)};
 });
 assert(visible.focused&&visible.top>=0&&visible.bottom<=visible.height&&visible.reachable,
   'Selected row should be focused, visible and reachable above the mobile navigation: '+JSON.stringify(visible));
}
// First visit with an empty gallery. The shell provides only the customer's
// existing dashboard elements. Production code builds the navigation and preview.
const platformNames=['YouTube','TikTok','Instagram','Facebook'];
const platformInfo=name=>'<div class="platform-icon"></div><div class="platform-info"><strong>'+name+'</strong></div>';
const connectionAction=name=>name==='YouTube'||name==='TikTok'
 ? '<a class="button" target="_blank" href="/connect/'+name+'">'+(name==='YouTube'?'Neu verbinden':'Verbinden')+'</a>'
 : '<button class="button" disabled>Meta-Freigabe offen</button>';
const newCustomerShell=`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;font:16px Arial,sans-serif}.page:not(.active){display:none}@media(max-width:650px){aside{display:none}}main{padding:16px}.platform-card{display:grid;gap:14px;padding:16px}.card{padding:12px}</style>
<body data-sma-customer-id="fixture"><header class="topbar"><div class="topbar-actions"></div></header>
<aside><p>Arbeitsbereich</p><button data-page="overview">Übersicht</button><button data-page="publishing">Veröffentlichung</button><button data-page="social">Social Media</button></aside><main>
<section class="page active" id="page-overview"><div class="page-head"><h1>Übersicht</h1></div><div class="grid">
<div class="card"><div class="card-title">Social Media</div><div class="big-value"><span data-sma-social-count>1/4</span></div><div class="muted">verbundene Plattformen</div></div><div class="card">Content</div><div class="card">Konto</div></div></section>
<section class="page" id="page-publishing"><div class="page-head"><h1>Veröffentlichung</h1></div>
<div class="card"><div class="platform-list">${platformNames.map(name=>'<article class="platform-card">'+platformInfo(name)+'</article>').join('')}</div></div>
<div id="publishingFilesSlot"></div></section>
<section class="page" id="page-social"><div class="platform-list">${platformNames.map(name=>'<article class="platform-card">'+platformInfo(name)+'<div class="platform-action">'+connectionAction(name)+'</div></article>').join('')}</div></section></main>
<script>document.querySelector('aside').onclick=e=>{const nav=e.target.closest('[data-page]');if(nav)for(const p of document.querySelectorAll('.page'))p.classList.toggle('active',p.id==='page-'+nav.dataset.page)}</script></body></html>`;

async function firstPostRoute(route,readPortalFiles,dashboardFiles=[]){
 const request=route.request();
 if(request.method()==='GET')return serve(route);
 const url=new URL(request.url());
 const reply=data=>route.fulfill({json:data,headers:{'Access-Control-Allow-Origin':'*'}});
 if(request.method()==='POST'){
  if(url.origin==='https://johnmusic.app.n8n.cloud'){
   if(url.pathname==='/webhook/sma-dashboard-session')return reply({html:newCustomerShell});
   if(url.pathname==='/webhook/sma-publication-files-v1')return reply({ok:true});
  }
  const args=request.postDataJSON();
  if(url.origin===site&&url.pathname==='/fixture/sma_portal_gallery_v1')return reply({...readPortalFiles(),folder_version:'folder/version'});
  if(url.origin===site&&['/fixture/sma_portal_playback_batch_v1','/fixture/sma_portal_hover_intro_v1'].includes(url.pathname))return reply(null);
  if(url.origin===site&&url.pathname==='/fixture/sma_manual_portal_v1'&&args.p_action==='folder')return reply({ok:true});
  if(url.origin===site&&url.pathname==='/fixture/sma_publication_files_v1'&&args.p_action==='sync_status'){
   assert.deepEqual(args.p_input,{});return reply(catalogSyncStatus());
  }
  if(url.origin===site&&url.pathname==='/fixture/sma_publication_files_v1'&&args.p_action==='list'){
   return reply(args.p_input?.platform==='youtube'?readPortalFiles():{ok:true,files:args.p_input?.dashboard_labels===true?dashboardFiles:[]});
  }
  if(url.origin===site&&url.pathname==='/fixture/sma_publication_preview_v1'&&args.p_action==='latest'){
   assert.equal(args.p_input.platform,'youtube');return reply({ok:true,status:'empty'});
  }
  if(url.origin==='https://bnvnmdxosbnuzedokqgh.supabase.co'&&url.pathname==='/rest/v1/rpc/sma_gallery_music_v1'&&args.p_action==='claim')return reply({ok:true,state:'idle'});
 }
 if(url.origin===site&&['/fixture/sma_publication_files_v1','/fixture/sma_publication_video_magic_v1','/fixture/sma_publication_editor_result_v1'].includes(url.pathname))return serve(route);
 if(url.origin==='https://johnmusic.app.n8n.cloud'&&url.pathname==='/webhook/sma-publication-asset-preview-v1')return serve(route);
 throw Error('Unexpected first-post request '+request.method()+' '+url.pathname);
}

export {site,dashboard,platformNames,newCustomerShell,serve,file,original,checksum,uuid,catalogSyncStatus,png};

async function firstPost(browser,width,height,{failFirstRead=false}={}){
 const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,locale:'de-AT',serviceWorkers:'block'});
 const errors=[];
 try{
  let portalReads=0;
  function readPortalFiles(){
   portalReads++;
   if(failFirstRead&&portalReads===1)return {ok:false,code:'FILE_SYNC_UNAVAILABLE'};
   return {ok:true,files:[]};
  }
  await context.route('**/*',route=>firstPostRoute(route,readPortalFiles).catch(async error=>{errors.push(error.message);await route.abort();}));
  const page=await context.newPage();page.setDefaultTimeout(8000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(dashboard);
  const frame=page.frameLocator('#dashboard');
  const start=frame.getByRole('button',{name:'Beitrag vorbereiten'});
  await fits(start,width);
  assert(await start.evaluate(el=>el.getBoundingClientRect().height>=44));
  await start.tap();
  const platforms=frame.getByRole('tab',{name:'Portale',selected:true});
  assert(await platforms.evaluate(el=>el===el.ownerDocument.activeElement));
  await frame.locator('.sma-optimize[data-portal=youtube]').tap();
  const editor=frame.frameLocator('iframe[data-portal="youtube"]');
  const empty=editor.getByRole('button',{name:'Leere Dateivorschau für den ersten Upload öffnen'});
  if(failFirstRead){
   const retry=editor.getByRole('button',{name:'Dateiliste erneut laden',exact:true});
   await fits(retry,width);
   assert.match(await editor.locator('#portalStatus').innerText(),/Die Dateiliste konnte nicht/);
   assert.equal(await empty.count(),0);
   await retry.tap();
  }
  await fits(empty,width);assert.equal(portalReads,failFirstRead?2:1);await empty.tap();
  await fits(editor.getByRole('heading',{name:'Datei für YouTube vorbereiten'}),width);
  const add=editor.getByRole('button',{name:'Datei hinzufügen',exact:true});
  await fits(add,width);
  // Open the native picker without supplying a file or starting a transfer.
  const [picker]=await Promise.all([page.waitForEvent('filechooser'),add.tap()]);
  assert.equal(await picker.element().getAttribute('accept'),'video/*');
  await picker.setFiles([]);
  const back=editor.getByRole('button',{name:/Zu den Dateien/});
  const previewURL=dashboard+'#optimieren/youtube/vorschau',filesURL=dashboard+'#optimieren/youtube';
  await page.waitForURL(previewURL);
  await back.tap();await page.waitForURL(filesURL);await fits(empty,width);
  assert(await empty.evaluate(el=>el===el.ownerDocument.activeElement));
  await page.goForward();await page.waitForURL(previewURL);
  await fits(add,width);assert(await back.evaluate(el=>el===el.ownerDocument.activeElement));
  await page.goBack();await page.waitForURL(filesURL);await fits(empty,width);
  assert(await empty.evaluate(el=>el===el.ownerDocument.activeElement));
  assert.equal(portalReads,failFirstRead?2:1,'browser navigation must not reload the gallery');
  assert.deepEqual(errors,[]);
  const recovery=failFirstRead?'catalog error and retry, ':'';
  console.log(width+' × '+height+': '+recovery+'first post, empty YouTube preview, device picker, gallery return and browser history passed');
 }catch(error){throw Error(width+'px first post: '+error.message+'; '+errors.join(', '),{cause:error});}
 finally{await context.close();}
}
async function checkFilesShortcut(page,frame,heading,width){
 const mobile=width<=700;
 const files=frame.getByRole('navigation',{name:'SMA Schnellnavigation'}).getByRole('button',{name:'Dateien'});
 const shortcut=mobile?files:frame.getByRole('button',{name:'Kundendateien suchen'});
 const finder=frame.getByRole('searchbox',{name:'Datei nach Namen oder Beitragstitel suchen'});
 await page.waitForURL(dashboard+'#optimieren/youtube/vorschau');
 if(mobile)await shortcut.tap();else await shortcut.click();
 await page.waitForURL(dashboard);
 await fits(finder,width);
 assert(await finder.evaluate(el=>el.ownerDocument.activeElement===el));
 if(mobile)assert.equal(await files.getAttribute('aria-current'),'page');
 await finder.fill(draft.title);
 await frame.getByRole('button',{name:'Datei im Portal öffnen: '+draft.title+' · Bearbeitetes Video · 3 Sek.',exact:true}).waitFor();
 await page.goBack();await page.waitForURL(dashboard+'#optimieren/youtube/vorschau');
 await heading.waitFor();
 if(mobile)assert.equal(await files.getAttribute('aria-current'),null);
 await page.goForward();await page.waitForURL(dashboard);
 await fits(finder,width);assert.equal(await finder.inputValue(),draft.title);
 assert(await finder.evaluate(el=>el.ownerDocument.activeElement===el));
 if(mobile)assert.equal(await files.getAttribute('aria-current'),'page');
 console.log(width+'px: file shortcut focused search, browser back restored the YouTube draft, forward retained the filter');
}

async function checkSearchReturn(page,frame,width){
 const finder=frame.getByRole('searchbox',{name:'Datei nach Namen oder Beitragstitel suchen'});
 const caption=draft.title+' · Bearbeitetes Video · 3 Sek.';
 const hit=frame.getByRole('button',{name:'Datei im Portal öffnen: '+caption,exact:true});
 const previewURL=dashboard+'#optimieren/youtube/vorschau';
 const portal=frame.frameLocator('iframe[data-portal="youtube"]:visible');
 const back=portal.getByRole('button',{name:/Zurück zu den Suchergebnissen/});
 const focused=locator=>locator.evaluate(el=>el===el.ownerDocument.activeElement);
 await hit.click();await page.waitForURL(previewURL);
 await portal.getByRole('heading',{name:draft.title}).waitFor();
 await portal.getByRole('button',{name:'Dateidetails',exact:true}).click();
 assert.deepEqual(await portal.locator('#workspacePreviewFacts dt').allTextContents(),['Dateiname','Medienart','Dauer','Zielportal']);
 assert.equal(await portal.locator('#workspacePreviewFacts dd').last().textContent(),'YouTube');
 await portal.getByRole('button',{name:'Beitragsvorschau',exact:true}).click();
 await portal.getByRole('button',{name:'Bearbeiten',exact:true}).click();
 await portal.getByRole('button',{name:'Gesamttext mit Shop-Link ansehen'}).click();
 assert.match(await portal.locator('#workspaceFullCaption').innerText(),/Testtext/);
 await portal.getByRole('button',{name:'Prüfdetails und Shop-Link'}).click();
 assert(await portal.locator('#workspaceResultDetails[open] .checks').isVisible());
 await portal.locator('#workspacePreviewEdits').click();
 await portal.getByRole('heading',{name:draft.title}).waitFor();
 await page.waitForURL(previewURL);
 await page.waitForFunction(()=>history.state?.view==='preview'&&Boolean(history.state.searchKey));
 await page.reload();
 try{await portal.getByRole('heading',{name:draft.title}).waitFor();}
 catch(error){
  const route=await page.evaluate(()=>{
   const doc=document.querySelector('#dashboard').contentDocument;
   const frame=doc?.querySelector('#smaOptimizerFrames iframe:not([hidden])');
   return {view:history.state?.view,search:!!history.state?.searchKey,portal:frame?.dataset.portal,child:frame?.dataset.view,
    section:doc?.querySelector('.page.active')?.id,frameStatus:frame?.contentDocument?.getElementById('portalStatus')?.textContent};
  });
  throw Error('Private fixture failed to restore its preview '+JSON.stringify(route),{cause:error});
 }
 await back.click();await page.waitForURL(dashboard);
 assert.equal(await finder.inputValue(),draft.title);
 assert(await focused(hit),'the file action should regain focus');
 await page.goForward();await page.waitForURL(previewURL);await back.waitFor();
 await page.goBack();await page.waitForURL(dashboard);assert(await focused(hit));

 const quick=width<=700?frame.getByRole('navigation',{name:'SMA Schnellnavigation'}).getByRole('button',{name:'Suche'}):frame.locator('#smaGlobalQuickFind');
 await quick.click();
 const dialog=frame.getByRole('dialog',{name:'SMA durchsuchen'});
 const globalQuery=dialog.getByRole('searchbox');await globalQuery.fill('bearbeitet');
 const globalHit=dialog.getByRole('button',{name:/Bearbeitetes Video/});
 await globalHit.click();await page.waitForURL(previewURL);
 await back.click();await dialog.waitFor();
 assert.equal(await globalQuery.inputValue(),'bearbeitet');assert(await focused(globalHit));
 await page.goForward();await page.waitForURL(previewURL);
 assert.equal(await dialog.isVisible(),false);await back.waitFor();
 await page.goBack();await dialog.waitFor();
 assert(await focused(globalHit));assert.equal(await globalQuery.inputValue(),'bearbeitet');
 console.log(width+'px: gallery and global search restored query, selected result and keyboard focus in one step');
}

async function checkDashboardPreview(browser,width,height){
 const mobile=width<=700;
 const context=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,locale:'de-AT',serviceWorkers:'block'});
 const errors=[];
 try{
  await context.route('**/*',route=>firstPostRoute(route,()=>({ok:true,files:[file]}),[{...file,display:{variant:'export'},assignments:[{...file.assignments[0],title:draft.title}]}]).catch(async e=>{errors.push(e.message);await route.abort();}));
  const page=await context.newPage();page.setDefaultTimeout(8000);
  page.on('pageerror',e=>errors.push(e.message));
  const readCount=await mockOriginalVideo(page);
  await page.goto(dashboard);
  const frame=page.frameLocator('#dashboard'),sidebar=frame.locator('aside');
  await frame.getByRole('button',{name:'Beitrag vorbereiten'}).click();
  await frame.getByRole('tab',{name:'Dateien'}).click();
  const overview=mobile?frame.getByRole('navigation',{name:'SMA Schnellnavigation'}).getByRole('button',{name:'Start'}):sidebar.getByRole('button',{name:'Übersicht'});
  await overview.click();
  const shortcut=frame.getByRole('button',{name:'Portale öffnen',exact:true});
  await fits(shortcut,width);
  if(mobile){
   const count=frame.locator('#page-overview [data-sma-social-count]');
   await count.scrollIntoViewIfNeeded();
   const box=await count.boundingBox();
   await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
  }else{
   await shortcut.focus();await shortcut.press('Enter');
  }
  const portalTab=frame.getByRole('tab',{name:'Portale',selected:true});
  await portalTab.waitFor();
  assert(await portalTab.evaluate(el=>el===el.ownerDocument.activeElement),'opening the counter selects and focuses Portale');
  assert.equal(await frame.locator('[data-page=social]').isVisible(),false);
  const panel=frame.getByRole('tabpanel',{name:'Portale'});
  for(const name of platformNames){
   const group=panel.locator('.platform-card').filter({hasText:name});
   const optimize=group.getByRole('button',{name:name+' optimieren',exact:true});
   const connect=group.locator('.platform-action :is(a,button):not(.sma-optimize)');
   await fits(optimize,width);await fits(connect,width);
   const first=await optimize.boundingBox(),next=await connect.boundingBox();
   assert(first&&next&&(first.y+first.height<=next.y+1||first.x+first.width<=next.x+1));
   assert(first.height>=44&&next.height>=44);
   if(name==='YouTube'||name==='TikTok')assert.equal(await connect.getAttribute('href'),'/connect/'+name);
   else assert(await connect.isDisabled());
  }
  const connectTikTok=panel.getByRole('link',{name:'Verbinden',exact:true});
  await connectTikTok.focus();
  await page.reload();
  await connectTikTok.waitFor();
  assert(await connectTikTok.evaluate(el=>el.ownerDocument.activeElement===el),'reload should return to the TikTok connection');
  await connectTikTok.evaluate(el=>{
   const doc=el.ownerDocument;
   const native=doc.querySelector('#page-social .platform-list'),publishing=doc.querySelector('#page-publishing .platform-list');
   const fresh=native.cloneNode(true);
   for(const button of fresh.querySelectorAll('.sma-optimize'))button.replaceWith(button.querySelector('.platform-icon'));
   fresh.querySelector('a[href="/connect/TikTok"]').textContent='Neu verbinden';
   native.replaceChildren(...fresh.children);
   publishing.innerHTML=publishing.innerHTML;
  });
  const refreshed=panel.locator('a[href="/connect/TikTok"]');
  assert.equal(await refreshed.textContent(),'Neu verbinden');
  assert(await refreshed.evaluate(el=>el.ownerDocument.activeElement===el),'status refresh should preserve the connection focus');
  assert.equal(await panel.getByRole('button',{name:/ optimieren$/i}).count(),4);
  await panel.locator('.sma-optimize[data-portal=youtube]').click();
  const editor=frame.frameLocator('iframe[data-portal="youtube"]');
  await editor.getByRole('button',{name:/Beitragsvorschau öffnen/}).click();
  const heading=editor.getByRole('heading',{name:draft.title});
  await heading.waitFor();
  if(!mobile){
   const video=editor.locator('#originalVideoPreview video');
   const playerFrame=page.frames().find(f=>f.url().startsWith(site+'/app/publication-preview.html'));
   const state=expression=>playerFrame.waitForFunction(expression);
   await state(()=>document.querySelector('#originalVideoPreview video')?.readyState>=2);
   await state(()=>{const v=document.querySelector('#originalVideoPreview video');return !v.paused&&v.currentTime>0;});
   await sidebar.getByRole('button',{name:'Übersicht'}).click();
   await frame.getByRole('heading',{name:'Übersicht'}).waitFor();
   await playerFrame.waitForFunction(()=>document.querySelector('#originalVideoPreview video').paused,null,{polling:50});
   const pauseTime=await video.evaluate(v=>v.ended?null:v.currentTime);
   assert(pauseTime>0&&pauseTime<file.duration_ms/1000,'hidden preview must pause mid-clip');
   await sidebar.getByRole('button',{name:'Veröffentlichung'}).click();
   await heading.waitFor();
   assert.deepEqual(await video.evaluate(v=>[v.paused,v.currentTime]),[true,pauseTime]);
   await video.press('Space');
   await state(()=>document.querySelector('#originalVideoPreview video').ended);
   assert.equal(readCount(),1);
   console.log('Dashboard: hidden YouTube preview paused, returned to the same position and resumed without reloading');
  }
  await checkFilesShortcut(page,frame,heading,width);
  await checkSearchReturn(page,frame,width);
  assert.equal(readCount(),mobile?0:1);
  assert.deepEqual(errors,[]);
 }catch(e){throw Error('Dashboard playback: '+e.message+'; '+errors.join(', '),{cause:e});}
 finally{await context.close();}
}
async function checkOverviewSearchReturn(browser,width,interrupted,reloadCase=null){
 const mobile=width===320;
 const context=await browser.newContext({viewport:{width,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
 try{
  const errors=[];
  let catalogReads=0,driveReads=0,afterReload=false,portalReads=0;
  let files;
  const started=Promise.withResolvers(),resume=Promise.withResolvers();
  const query='SMA Privattest 02';
  const searchFile={...file,display:{variant:'export'},assignments:[{...file.assignments[0],title:query}]};
  const originalFile={...searchFile,id:uuid(11),display:{variant:'original'}};
  files=[originalFile,searchFile];
  await context.routeWebSocket('**/*',ws=>ws.close());
  await context.route('**/*',async route=>{
   try{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(afterReload&&reloadCase==='other'&&new URL(req.url()).origin==='https://esm.sh'){
     return await route.fulfill({contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:client.replace("id:'fixture'","id:'other'")});
    }
    if(req.method()==='POST'&&path==='/fixture/sma_publication_files_v1'){
     const q=req.postDataJSON();
     if(q.p_action==='list'&&q.p_input?.platform)portalReads++;
     if(q.p_action==='list'&&q.p_input?.dashboard_labels){
      if(afterReload&&reloadCase==='slow'){started.resolve();await resume.promise;}
      if(afterReload&&reloadCase==='unreachable'&&catalogReads===1){catalogReads++;return await route.abort('internetdisconnected');}
      catalogReads++;
      if(interrupted&&catalogReads===1)return await route.abort('internetdisconnected');
     }
    }
    if(path==='/webhook/sma-publication-files-v1')driveReads++;
    await firstPostRoute(route,()=>({ok:true,files:[file]}),files);
   }catch(error){errors.push(error.message);await route.abort();}
  });
  const page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
  const frame=page.frameLocator('#dashboard'),account=frame.getByRole('tab',{name:'Konto & Paket'});
  const launcher=mobile?frame.getByRole('navigation',{name:'SMA Schnellnavigation'}).getByRole('button',{name:'Suche'}):frame.locator('#smaGlobalQuickFind');
  const dialog=frame.getByRole('dialog',{name:'SMA durchsuchen'}),input=dialog.getByRole('searchbox');
  const hit=dialog.locator('[data-quick-file="'+asset+'"]');
  const editor=frame.frameLocator('iframe[data-portal="youtube"]:visible');
  const back=editor.getByRole('button',{name:/Zurück zu den Suchergebnissen/});
  const focus=el=>el.evaluate(node=>node.ownerDocument.activeElement===node);
  await page.goto(dashboard);await account.click();await launcher.click();await input.fill(query);
  if(interrupted){
   await dialog.getByRole('status').filter({hasText:'nicht erreichbar'}).waitFor();
   if(mobile)await dialog.getByRole('button',{name:'Dateiliste erneut laden'}).click();
   else await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  }
  await hit.waitFor();assert.equal(catalogReads,interrupted?2:1);assert.equal(driveReads,0);
  assert.equal(await dialog.locator('[data-quick-file]').count(),2);assert.match(await hit.innerText(),/Bearbeitetes Video · 3 Sek/);
  await hit.click();await back.waitFor();
  if(reloadCase){
   const previousPortalReads=portalReads;afterReload=true;
   if(reloadCase==='removed')files=[originalFile];
   await page.reload({waitUntil:'domcontentloaded'});
   if(reloadCase==='slow'){
    await started.promise;
    try{
     await account.click();await launcher.click();await input.fill('meine neue Suche');
    }finally{resume.resolve();}
    await dialog.getByRole('status').filter({hasText:/Keine (direkten )?Treffer/}).waitFor();
    assert.equal(await input.inputValue(),'meine neue Suche');assert(await focus(input));
   }else if(reloadCase==='other'){
    await launcher.waitFor();await launcher.click();
    assert.equal(await input.inputValue(),'');
    assert.equal(await page.evaluate(()=>history.state?.searchKey??null),null);
   }else{
    await dialog.waitFor();assert.equal(await input.inputValue(),query);assert(await focus(input));
    assert.equal(await hit.count(),0);assert.equal(await account.getAttribute('aria-selected'),'true');
    if(reloadCase==='unreachable'){
     await dialog.getByRole('status').filter({hasText:'nicht erreichbar'}).waitFor();
     await page.evaluate(()=>window.dispatchEvent(new Event('online')));await hit.waitFor();
    }else{assert.equal(await dialog.locator('[data-quick-file]').count(),1);}
   }
   assert.equal(await frame.locator('iframe[data-portal]').count(),0);
   assert.equal(portalReads,previousPortalReads);assert.equal(driveReads,0);assert.deepEqual(errors,[]);
   console.log(width+'px: search preview reload, '+reloadCase+' passed');return;
  }
  await back.click();await hit.waitFor();
  assert.equal(await input.inputValue(),query);assert(await focus(hit));
  await hit.press('Escape');await account.waitFor();
  assert.equal(await account.getAttribute('aria-selected'),'true');assert(await focus(launcher));
  await page.goForward();await back.waitFor();await page.goBack();await account.waitFor();
  assert(!await dialog.isVisible());assert(await focus(launcher));
  await page.goForward();await back.click();await hit.waitFor();assert(await focus(hit));
  await dialog.getByRole('button',{name:'Suche schließen'}).click();
  await account.waitFor();assert.equal(await account.getAttribute('aria-selected'),'true');assert(await focus(launcher));
  await account.focus();await account.press('Control+k');await dialog.waitFor();await input.press('Escape');
  assert(await focus(account));assert.equal(driveReads,0,'opening a saved search result must not synchronize the customer folder');assert.deepEqual(errors,[]);
  console.log(width+'px: global search returned to the original overview chapter and launcher'+(interrupted?' after reconnect':''));
 }finally{await context.close();}
}

async function checkGalleryKeyboard(browser,width){
 const mobile=width===320;
 const ctx=await browser.newContext({viewport:{width,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
 try{
  const wanted={...file,name:'Werkstatt Ziel.mp4'};
  const rest=Array.from({length:999},(_,i)=>({...file,id:uuid(i+100),name:'Werkstatt '+i+'.mp4'}));
  let catalog=[...rest,wanted],catalogReads=0,driveReads=0,preflightReads=0,folderError=null,holdRetry=false,failNextRead=false;
  let clock=Date.now(),startedAt=clock-60000,leaseUntil=0,syncState='complete';
  let syncedAt=new Date(startedAt).toISOString();
  const syncStatus=()=>catalogSyncStatus({sync_state:leaseUntil>clock?'running':syncState,
   retry_after_ms:Math.max(0,Math.min(120000,leaseUntil>clock?leaseUntil-clock:startedAt+15000-clock)),synced_at:syncedAt});
  const requested=Promise.withResolvers(),release=Promise.withResolvers();
  const errors=[];
  await ctx.routeWebSocket('**/*',ws=>ws.close());
  await ctx.route('**/*',async route=>{
   try{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(req.method()==='POST'&&path==='/webhook/sma-publication-files-v1'){
     driveReads++;
     assert.notEqual(syncStatus().sync_state,'running','A known active lease must block before n8n');
     assert.equal(syncStatus().retry_after_ms,0,'A known cooldown must block before n8n');
     assert.ok(folderError===null||['FILE_CATALOG_TOO_LARGE','FILE_SYNC_UNAVAILABLE'].includes(folderError));
     startedAt=clock;leaseUntil=clock+120000;
     if(holdRetry){requested.resolve();await release.promise;}
     leaseUntil=0;syncState=folderError?'interrupted':'complete';if(!folderError)syncedAt=new Date(clock).toISOString();
     return await route.fulfill({json:folderError?{ok:false,code:folderError}:{ok:true},headers:{'Access-Control-Allow-Origin':'*'}});
    }
    if(req.method()==='POST'&&path==='/fixture/sma_publication_files_v1'){
     const q=req.postDataJSON();
     if(q.p_action==='sync_status'){
      assert.deepEqual(q.p_input,{});preflightReads++;return await route.fulfill({json:syncStatus()});
     }
     if(q.p_action==='list'&&q.p_input?.dashboard_labels){
      catalogReads++;
      if(failNextRead){failNextRead=false;return await route.abort('internetdisconnected');}
      return await route.fulfill({json:{ok:true,files:catalog,sync_state:syncStatus().sync_state,synced_at:syncedAt}});
     }
    }
    await firstPostRoute(route,()=>({ok:true,files:catalog}),catalog);
   }catch(e){errors.push(e.message);await route.abort();}
  });
  const page=await ctx.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(dashboard);
  const frame=page.frameLocator('#dashboard'),nav=frame.locator('.sma-file-pages');
  const launcher=mobile?frame.getByRole('navigation',{name:'SMA Schnellnavigation'}).getByRole('button',{name:'Suche'}):frame.locator('#smaGlobalQuickFind');
  await launcher.click();const dialog=frame.getByRole('dialog');await dialog.getByRole('searchbox').fill('Werkstatt');
  await dialog.getByRole('button',{name:/Alle 1000 Dateien anzeigen/}).click();
  const field=frame.locator('#smaFileSearch');
  const next=nav.getByRole('button',{name:'Weiter'}),back=nav.getByRole('button',{name:'Zurück'});
  const focus=loc=>loc.evaluate(el=>el.ownerDocument.activeElement===el);
  await nav.getByText('Seite 1 von 100',{exact:true}).waitFor();assert(await back.isDisabled());
  const initialReads=catalogReads;
  await next.focus();await page.keyboard.press('Enter');
  await nav.getByText('Seite 2 von 100',{exact:true}).waitFor();assert(await focus(next),'Weiter must retain keyboard focus after paging');
  for(let i=2;i<100;i++)await page.keyboard.press('Enter');
  await nav.getByText('Seite 100 von 100',{exact:true}).waitFor();
  assert(await next.isDisabled());assert(await focus(back),'Zurück must take focus at the last page');
  await page.keyboard.press('Space');await nav.getByText('Seite 99 von 100',{exact:true}).waitFor();assert(await focus(back));
  for(let i=99;i>1;i--)await page.keyboard.press('Enter');
  await nav.getByText('Seite 1 von 100',{exact:true}).waitFor();assert(await focus(next),'Weiter must take focus at the first page');
  assert.equal(catalogReads,initialReads,'Blättern must use the loaded catalogue');
  assert.equal(driveReads,0,'showing all matches must not synchronize the customer folder');
  catalog=[wanted,...rest];await page.reload();await nav.getByText('Seite 1 von 100',{exact:true}).waitFor();
  assert(await focus(next),'reloading should restore the paging control');
  const select=frame.getByRole('button',{name:/Datei im Portal öffnen: Werkstatt Ziel/});
  await select.focus();
  catalog=[...rest,wanted];await page.reload();await nav.getByText('Seite 100 von 100',{exact:true}).waitFor();
  assert(await focus(select),'reloading restores focus to the same file on its new page');
  catalog=[];await page.reload();await frame.getByText(/Noch keine Bild- oder Videodateien/).waitFor();
  assert(await focus(field));assert.equal(await field.inputValue(),'Werkstatt');
  const controlled=await controlCatalogTime(page);clock=controlled.now;
  startedAt=clock-60000;syncedAt=new Date(startedAt).toISOString();
  const advance=async ms=>{clock=await controlled.advance(ms);};
  const manual=frame.getByRole('button',{name:'Dateien aktualisieren',exact:true});
  const before=catalogReads,status=frame.locator('.sma-file-toolbar [role=status]').first();
  const quickStatus=dialog.getByRole('status');
  folderError='FILE_CATALOG_TOO_LARGE';await manual.click();await status.filter({hasText:'nicht abgeschlossen'}).waitFor();
  await launcher.click();await dialog.getByRole('searchbox').fill('Werkstatt');
  await quickStatus.filter({hasText:'Keine gespeicherten Dateien'}).waitFor();
  assert.equal(await dialog.locator('[data-quick-file]').count(),0);
  const retry=dialog.getByRole('button',{name:'Ordnerabgleich wiederholen'});
  assert.equal(driveReads,1);const firstPreflight=preflightReads;
  await retry.click();await quickStatus.filter({hasText:'Bitte warte kurz'}).waitFor();
  assert.equal(preflightReads,firstPreflight+1);assert.equal(driveReads,1,'An immediate retry reads cooldown without another n8n start');
  assert.equal(await dialog.locator('[data-quick-file]').count(),0);
  folderError=null;catalog=[wanted];await advance(15000);await retry.click();
  await retry.waitFor({state:'hidden'});await dialog.locator('[data-quick-file]').waitFor();
  await dialog.getByRole('button',{name:'Suche schließen'}).click();await select.waitFor();
  assert.equal(driveReads,2,'An explicit refresh after the 15-second gate still starts once');
  assert.equal(catalogReads,before+2);assert(await select.isVisible());
  folderError='FILE_SYNC_UNAVAILABLE';await advance(15000);await manual.click();await status.filter({hasText:'zuletzt gespeicherte'}).waitFor();
  assert.equal(driveReads,3);
  await launcher.click();const input=dialog.getByRole('searchbox');await input.fill('Werkstatt');
  assert.equal(await dialog.locator('[data-quick-file]').count(),1);assert.match(await quickStatus.innerText(),/zuletzt gespeicherte/);
  await input.fill('Fehlt im Katalog');assert.equal(await dialog.locator('[data-quick-file]').count(),0);
  assert.match(await quickStatus.innerText(),/zuletzt gespeicherte/);
  const beforeCooldown=preflightReads;
  await retry.click();await quickStatus.filter({hasText:'Bitte warte kurz'}).waitFor();
  assert.equal(preflightReads,beforeCooldown+1);assert.equal(driveReads,3,'Server cooldown adds no native start');
  assert.equal(await input.inputValue(),'Fehlt im Katalog');assert(await focus(retry));
  leaseUntil=clock+120000;const beforeRunning=preflightReads;
  await retry.click();await quickStatus.filter({hasText:'läuft bereits'}).waitFor();
  assert.equal(preflightReads,beforeRunning+1);assert.equal(driveReads,3,'An active server lease adds no native start');
  const checkStatus=dialog.getByRole('button',{name:'Abgleichstatus prüfen'});
  leaseUntil=0;syncState='interrupted';await advance(15000);await checkStatus.click();await retry.waitFor();
  assert.equal(driveReads,3,'Checking a finished lease only reloads saved status');
  folderError=null;holdRetry=true;
  await retry.press('Enter');await requested.promise;
  try{
   assert.equal(await retry.getAttribute('aria-disabled'),'true');await page.keyboard.press('Enter');
   assert.equal(driveReads,4,'A repeated keypress while refresh is pending cannot start another workflow');
   await input.fill('Werkstatt Ziel');await dialog.locator('[data-quick-file]').waitFor();
  }finally{release.resolve();}
  await retry.waitFor({state:'hidden'});assert.equal(await input.inputValue(),'Werkstatt Ziel');assert(await focus(input));
  assert.equal(await quickStatus.innerText(),'1 direkter Treffer');
  assert.equal(catalogReads,before+6);assert.equal(driveReads,4);
  await input.press('Escape');folderError='FILE_SYNC_UNAVAILABLE';await advance(15000);await manual.click();
  await status.filter({hasText:'nicht abgeschlossen'}).waitFor();
  assert.equal(driveReads,5);
  await launcher.click();await input.fill('Werkstatt');
  folderError=null;catalog=[{...wanted,name:'Werkstatt Neu.mp4'}];failNextRead=true;await advance(15000);await retry.click();
  await quickStatus.filter({hasText:'zuletzt geladene Dateiliste'}).waitFor();
  await dialog.getByRole('button',{name:/Werkstatt Ziel/}).waitFor();
  await dialog.getByRole('button',{name:'Dateiliste erneut laden'}).click();
  await dialog.getByRole('button',{name:/Werkstatt Neu/}).waitFor();
  assert.equal(await input.inputValue(),'Werkstatt');assert(await focus(input));
  assert.equal(catalogReads,before+8);assert.equal(driveReads,6,'Retrying the saved list never repeats its successful native scan');
  await controlled.restore();
  assert.deepEqual(errors,[]);console.log(width+'px: 1000 files paged forward and back by keyboard; selected file followed across reload and removal');
 }finally{await ctx.close();}
}

async function galleryReloadTest(browser,width,variant){
 const ctx=await browser.newContext({viewport:{width,height:800},isMobile:width===320,hasTouch:width===320,serviceWorkers:'block'});
 const query='Werkstatt',expectedId=asset;
 const rows=Array.from({length:24},(_,i)=>({...file,id:uuid(i+100),name:'Werkstatt Aufnahme '+i+'.mp4'}));
 const wanted={...file,name:'Werkstatt Aufnahme.mp4',assignments:[{...file.assignments[0],title:draft.title}]};
 let catalog=[...rows,wanted],user='fixture',delayed=false,release,start,driveReads=0,editorReads=0;
 const held=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{start=resolve;});
 const recovering=['retry','reconnect','edit-offline'].includes(variant);
 let failures=0,checkingRecovery=false,listReads=0,musicReads=0;
 const errors=[];
 try{
  await ctx.routeWebSocket('**/*',ws=>ws.close());
  await ctx.route('**/*',async route=>{try{
   const req=route.request(),url=new URL(req.url()),path=url.pathname;
   if(url.origin==='https://esm.sh')return await route.fulfill({contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:client.replace("id:'fixture'","id:"+JSON.stringify(user))});
   if(req.method()==='POST'&&path==='/fixture/sma_publication_files_v1'){
    const q=req.postDataJSON();
    if(q.p_action==='list'&&q.p_input.dashboard_labels){
     if(checkingRecovery)listReads++;
     if(failures){failures--;return await route.abort('internetdisconnected');}
     if(delayed){start();await held;}
     return await route.fulfill({json:{ok:true,files:catalog}});
    }
    if(q.p_action==='get')editorReads++;
   }
   if(path==='/webhook/sma-publication-files-v1')driveReads++;
   if(checkingRecovery&&path==='/rest/v1/rpc/sma_gallery_music_v1')musicReads++;
   await firstPostRoute(route,()=>({ok:true,files:catalog}),catalog);
  }catch(e){if(!e.message.includes('has been closed'))errors.push(e.message);await route.abort().catch(()=>{});}});
  const p=await ctx.newPage();p.setDefaultTimeout(5000);p.on('pageerror',e=>errors.push(e.message));
  const frame=p.frameLocator('#dashboard'),field=frame.locator('#smaFileSearch');
  const pages=frame.locator('.sma-file-pages'),next=pages.getByRole('button',{name:'Weiter'});
  const hit=frame.locator('.sma-file-open[data-asset-id="'+expectedId+'"]');
  const launcher=width===320?frame.getByRole('navigation',{name:'SMA Schnellnavigation'}).getByRole('button',{name:'Suche'}):frame.locator('#smaGlobalQuickFind');
  await p.goto(dashboard);await launcher.click();const quick=frame.getByRole('dialog',{name:'SMA durchsuchen'});
  await quick.getByRole('searchbox').fill(query);
  await quick.getByRole('button',{name:/Alle 25 Dateien anzeigen/}).click();
  for(let i=1;i<3;i++)await next.click();
  await pages.getByText('Seite 3 von 3',{exact:true}).waitFor();
  await hit.click();
  const editor=frame.frameLocator('iframe[data-portal="youtube"]:visible');
  await editor.getByRole('heading',{name:draft.title}).waitFor();
  await editor.getByRole('button',{name:/Zurück zu den Suchergebnissen/}).click();
  await hit.waitFor();assert(await hit.evaluate(el=>el.ownerDocument.activeElement===el));
  if(variant==='move')catalog=[wanted,...rows];
  if(variant==='remove')catalog=rows;
  if(variant==='other'){user='second';catalog=[];}
  if(variant==='slow')delayed=true;
  if(recovering){checkingRecovery=true;failures=variant==='retry'?2:1;}
  const before=[driveReads,editorReads];await p.reload();
  if(variant==='other'){
   await frame.getByRole('heading',{name:'Übersicht'}).waitFor();
   assert(!await field.isVisible());assert.equal(await field.inputValue(),'');
  }else{
   await field.waitFor();assert.equal(await field.inputValue(),query);
   if(recovering){
    const retry=frame.getByRole('button',{name:'Dateiliste erneut laden'});
    const status=frame.locator('.sma-file-toolbar [role=status]').first();
    const online=()=>p.evaluate(()=>window.dispatchEvent(new Event('online')));
    await retry.waitFor();
    if(variant==='retry'){
     await retry.click();await status.filter({hasText:'nicht erreichbar'}).waitFor();
    }
    delayed=true;
    if(variant==='reconnect')await online();
    else{await retry.focus();await retry.press('Enter');}
    await status.filter({hasText:'wird erneut geladen'}).waitFor();
    await online();await online();
    if(variant==='edit-offline')await field.fill('Aufnahme 14');
    release();
    await frame.getByRole('button',{name:'Dateien aktualisieren',exact:true}).waitFor();
    assert.equal(listReads,variant==='retry'?3:2);
    assert.equal(musicReads,0);
   }
   if(variant==='edit-offline'){
    assert.equal(await field.inputValue(),'Aufnahme 14');
    assert(await field.evaluate(el=>el.ownerDocument.activeElement===el));assert.equal(await hit.count(),0);
    assert.equal(await frame.locator('.sma-file-open').count(),1);
   }else if(variant==='slow'){await began;await field.fill('Aufnahme 14');release();await frame.locator('.sma-file-open').first().waitFor();assert.equal(await field.inputValue(),'Aufnahme 14');}
   else{
    await pages.getByText(variant==='move'?'Seite 1 von 3':'Seite 3 von 3',{exact:true}).waitFor();
    if(variant==='remove'){assert.equal(await hit.count(),0);assert.equal(await frame.locator('.sma-gallery-select[aria-pressed="true"]').count(),0);assert(await field.evaluate(el=>el.ownerDocument.activeElement===el));}
    else{assert(await hit.evaluate(el=>el.ownerDocument.activeElement===el));assert.equal(await hit.count(),1);}
   }
  }
  assert.deepEqual([driveReads,editorReads],before);
  assert.deepEqual(errors,[]);console.log(width,variant,'OK');
 }finally{release();await ctx.close();}
}

// Called by the SQL rehearsal with the running, isolated database and workflow.
export async function checkPrivateCatalogReturn({wanted,dashboardList,portalList,scan}){
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
 try{
  for(const width of [320,1024]){
   const mobile=width===320,errors=[];
   const ctx=await browser.newContext({viewport:{width,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
   try{
    let scans=0,clock=Date.now(),lastDispatch=clock-15000;
    assert.deepEqual(await scan('first-only'),{ok:true,count:1000});
    await ctx.routeWebSocket('**/*',ws=>ws.close());
    await ctx.route('**/*',async route=>{
     try{
      const req=route.request(),path=new URL(req.url()).pathname;
      const reply=json=>route.fulfill({json,headers:{'Access-Control-Allow-Origin':'*'}});
      if(req.method()==='POST'){
       if(path==='/webhook/sma-publication-files-v1'){
        assert.ok(clock-lastDispatch>=15000,'A retry must wait for its existing dispatch gate');
        lastDispatch=clock;return await reply(await scan(++scans===2?'complete':'interrupt'));
       }
       const args=req.postDataJSON();
       if(path==='/fixture/sma_publication_files_v1'){
        if(args.p_action==='sync_status'){
         assert.deepEqual(args.p_input,{});const current=await dashboardList();
         // The supplied database reader is authoritative for the live lease.
         // Its scan fixture explicitly rewinds SQL cooldowns; mirror elapsed
         // dispatch time here without sleeping or changing that fixture's DB.
         return await reply(catalogSyncStatus({sync_state:current.sync_state,
          retry_after_ms:current.sync_state==='running'?120000:Math.max(0,lastDispatch+15000-clock),
          synced_at:current.synced_at??null}));
        }
        if(args.p_action==='list')return await reply(await (args.p_input.dashboard_labels?dashboardList():portalList()));
        assert.equal(args.p_input.asset_id,wanted.id);
        if(args.p_action==='get')return await reply({ok:true,status:'empty'});
        if(args.p_action==='check')return await reply({ok:true});
       }
       if(path==='/webhook/sma-publication-asset-preview-v1')return await reply({ok:true,can_publish:false,
        asset_id:args.asset_id,asset_revision:args.asset_revision,media_kind:'video',mime_type:'image/png',image_base64:png});
       if(path==='/webhook/sma-publication-editor-source-v1'){
        assert.deepEqual(args,{asset_id:wanted.id,asset_revision:wanted.revision});
        return await reply({ok:true,can_publish:false,...args,mime_type:'video/mp4',size_bytes:original.length,
          sha256:checksum,data_base64:original.toString('base64')});
       }
       if(path==='/fixture/sma_publication_editor_result_v1')return await reply({ok:true,version:1,can_publish:false,asset_id:wanted.id,asset_revision:wanted.revision,cover:null});
      }
      await firstPostRoute(route,()=>({ok:true,files:[]}));
     }catch(e){errors.push(e.message);await route.abort();}
    });
    const page=await ctx.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
    const frame=page.frameLocator('#dashboard'),mobileNav=frame.getByRole('navigation',{name:'SMA Schnellnavigation'});
    const launcher=mobile?mobileNav.getByRole('button',{name:'Suche'}):frame.locator('#smaGlobalQuickFind');
    const dialog=frame.getByRole('dialog',{name:'SMA durchsuchen'}),input=dialog.getByRole('searchbox');
    const hit=dialog.locator('[data-quick-file="'+wanted.id+'"]');
    const status=frame.locator('.sma-file-toolbar [role=status]').first();
    const manual=frame.getByRole('button',{name:'Dateien aktualisieren',exact:true});
    await page.goto(dashboard);await launcher.click();await input.fill('Werkstatt Finale');
    await dialog.getByRole('status').filter({hasText:/Keine (direkten )?Treffer/}).waitFor();
    assert(!await hit.count());
    await input.fill('Kundenclip');await dialog.getByRole('button',{name:'Alle 1000 Dateien anzeigen'}).click();
    const previous=await dashboardList();
    const controlled=await controlCatalogTime(page);clock=controlled.now;lastDispatch=clock-15000;
    const advance=async ms=>{clock=await controlled.advance(ms);};
    await manual.click();
    await status.filter({hasText:'zuletzt gespeicherte Dateiliste'}).waitFor();
    assert.deepEqual(await dashboardList(),{...previous,sync_state:'interrupted'});
    await launcher.click();await input.fill('Werkstatt Finale');assert.equal(await hit.count(),0);
    const retry=dialog.getByRole('button',{name:'Ordnerabgleich wiederholen'});
    assert.equal(scans,1);await retry.click();await dialog.getByRole('status').filter({hasText:'Bitte warte kurz'}).waitFor();
    assert.equal(scans,1,'The SQL-backed catalogue retry is read-only during cooldown');assert.equal(await hit.count(),0);
    await advance(15000);await retry.click();await hit.waitFor();assert.equal(scans,2);assert.equal(await input.inputValue(),'Werkstatt Finale');
    assert.equal(await retry.count(),0);await input.press('Escape');
    await frame.locator('.sma-file-pages').getByText('Seite 1 von 100',{exact:true}).waitFor();
    const complete=await dashboardList();
    await launcher.click();await input.fill('Werkstatt Finale');await hit.waitFor();await input.press('Escape');
    await advance(15000);await manual.click();await status.filter({hasText:'zuletzt gespeicherte Dateiliste'}).waitFor();
    assert.equal(scans,3);
    assert.deepEqual(await dashboardList(),{...complete,sync_state:'interrupted'});
    await controlled.restore();
    const overview=mobile?mobileNav.getByRole('button',{name:'Start'}):frame.locator('aside').getByRole('button',{name:'Übersicht'});
    const account=frame.getByRole('tab',{name:'Konto & Paket'});
    await overview.click();await account.click();await launcher.click();await input.fill('Werkstatt Finale');
    await hit.click();
    const editor=frame.frameLocator('iframe[data-portal="youtube"]:visible');
    const back=editor.getByRole('button',{name:/Zurück zu den Suchergebnissen/});
    await back.waitFor();
    await editor.locator('#selectedFileName').filter({hasText:wanted.name}).waitFor({state:'attached'});
    await editor.getByRole('button',{name:'Originalvideo abspielen'}).click();
    const video=editor.locator('#originalVideoPreview video');
    await video.waitFor();
    await video.evaluate(v=>new Promise((resolve,reject)=>{
     if(v.ended)return resolve();
     const timer=setTimeout(()=>reject(Error('Test video did not finish')),8000);
     v.addEventListener('ended',()=>{clearTimeout(timer);resolve();},{once:true});
    }));
    assert.deepEqual(await video.evaluate(v=>[v.error?.code??null,v.videoWidth,v.videoHeight,v.duration,v.currentTime]),[null,160,90,3,3]);
    await page.reload();await back.waitFor();
    await editor.locator('#selectedFileName').filter({hasText:wanted.name}).waitFor({state:'attached'});
    await back.click();await hit.waitFor();
    await retry.waitFor();
    assert.match(await dialog.getByRole('status').innerText(),/zuletzt gespeicherte/);
    const focus=el=>el.evaluate(node=>node.ownerDocument.activeElement===node);
    assert(await focus(hit));assert.equal(await input.inputValue(),'Werkstatt Finale');
    await hit.press('Escape');await account.waitFor();
    assert.equal(await account.getAttribute('aria-selected'),'true');assert(await focus(launcher));
    const checkStatus=dialog.getByRole('button',{name:'Abgleichstatus prüfen'});
    await scan('complete',async()=>{
      await page.reload();await launcher.click();await input.fill('Werkstatt Finale');await hit.waitFor();
      await checkStatus.waitFor();assert.match(await dialog.getByRole('status').innerText(),/läuft bereits/);
      await checkStatus.click();await dialog.getByRole('status').filter({hasText:'läuft bereits'}).waitFor();
      assert(await focus(checkStatus));assert.equal(scans,3);
    });
    await checkStatus.click();await checkStatus.waitFor({state:'hidden'});
    assert.equal(await dialog.getByRole('status').innerText(),'1 direkter Treffer');
    assert.equal(await input.inputValue(),'Werkstatt Finale');assert(await focus(input));assert.equal(await retry.count(),0);
    await hit.click();await back.waitFor();
    assert.equal(scans,3);assert.deepEqual(errors,[]);
    console.log(width+'px: saved video and retry survived F5; checking another running and completed scan kept file 1001 without an extra Drive request.');
   }catch(error){throw new Error(width+'px catalogue: '+error.message+' '+errors.join(', '),{cause:error});}
   finally{await ctx.close();}
  }
 }finally{await browser.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runMobileChecks();
async function runMobileChecks(){
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
try{
 for(const width of [320,1024]){
  await checkGalleryKeyboard(browser,width);
  await checkOverviewSearchReturn(browser,width,false);
  await checkOverviewSearchReturn(browser,width,true);
 }
 for(const [width,mode] of [[320,'removed'],[1024,'other'],[320,'slow'],[1024,'unreachable']])
  await checkOverviewSearchReturn(browser,width,false,mode);
 for(const [width,scenario] of [[1024,'same'],[320,'move'],[1024,'remove'],[320,'slow'],[320,'other'],[1024,'retry'],[320,'reconnect'],[320,'edit-offline']])await galleryReloadTest(browser,width,scenario);
 for(const [width,height] of [[320,568],[360,740],[390,844],[430,932]]){
  const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,locale:'de-AT',serviceWorkers:'block'});
  try{
   const errors=[];
   await context.route('**/*',route=>serve(route).catch(async e=>{errors.push(e.message);await route.abort();}));
   const page=await context.newPage();page.setDefaultTimeout(8000);
   page.on('pageerror',e=>errors.push(e.message));
   try{
    await page.goto(dashboard);
    const frame=page.frameLocator('#dashboard');
    await frame.getByRole('navigation',{name:'SMA Schnellnavigation'}).getByRole('button',{name:'Suche'}).tap();
    const input=frame.getByRole('searchbox',{name:'Dashboard durchsuchen'});await fits(input,width);await input.fill(title);
    await frame.getByRole('button',{name:/In Aufträgen suchen/}).tap();
    const hits=frame.locator('.sma-history-find-open');
    const expired=hits.filter({hasText:'17:44'});await fits(expired,width);assert.equal(await hits.count(),2);
    await expired.tap();await selectedRow(frame,width);
    const originURL=dashboard+'#auftrag/'+target;assert.equal(page.url(),originURL);
    await page.reload();await selectedRow(frame,width);
    const link=frame.getByRole('link',{name:'Aktuellen Beitrag öffnen'});await fits(link,width);await link.tap();
    const current=page.getByRole('button',{name:'Aktuelle Dateiversion öffnen'});await fits(current,width);await current.tap();
    await fits(page.getByRole('heading',{name:draft.title}),width);
    if(width===320||width===390)await checkOriginalPlayback(page,width,{failFirstRead:width===390});
    const back=page.getByRole('link',{name:/Zurück zum Auftrag/});await fits(back,width);await back.tap();
    await selectedRow(frame,width);assert.equal(page.url(),originURL);
    assert.deepEqual(errors,[]);console.log(width+' × '+height+': touch search, reload, current draft and return to page 2 passed');
   }catch(e){throw Error(width+'px: '+e.message+'; '+errors.join(', '),{cause:e});}
  }finally{await context.close();}
 }
 for(const [width,height] of [[320,568],[390,844]])await firstPost(browser,width,height);
 await firstPost(browser,320,568,{failFirstRead:true});
 for(const [width,height] of [[320,568],[1024,768]])await checkDashboardPreview(browser,width,height);
}finally{await browser.close();}
}
