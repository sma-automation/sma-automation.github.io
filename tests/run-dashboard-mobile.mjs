import assert from 'node:assert/strict';
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
const file={id:asset,media_kind:'video',mime_type:'video/mp4',name:'Testclip.mp4',duration_ms:3000,
 width_px:720,height_px:1280,revision:'current',assignments:[{platform:'youtube',revision:2,status:'assigned'}]};
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
async function selectedRow(frame,width){
 const row=frame.locator('.sma-history-list details[open] summary');
 await fits(row,width);
 assert.match(await row.innerText(),/17:44/);
 assert.match(await row.innerText(),/Vorbereitung abgelaufen/);
 assert.match(await frame.locator('#historyActivitySlot [role=status]').first().innerText(),/Seite 2 von 2/);
 const visible=await row.evaluate(el=>{
  const doc=el.ownerDocument,r=el.getBoundingClientRect();
  return doc.activeElement===el&&r.top>=0&&r.bottom<=doc.documentElement.clientHeight&&
    el.contains(doc.elementFromPoint(r.left+r.width/2,r.top+r.height/2));
 });
 assert(visible,'Selected row should be focused, visible and reachable above the mobile navigation');
}
// First visit with an empty gallery. The shell provides only the customer's
// existing dashboard elements. Production code builds the navigation and preview.
const newCustomerShell=`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;font:16px Arial,sans-serif}aside,.page:not(.active){display:none}main{padding:16px}</style>
<body data-sma-customer-id="fixture"><header class="topbar"><div class="topbar-actions"></div></header>
<aside><button data-page="publishing">Veröffentlichung</button></aside><main>
<section class="page active" id="page-overview"><div class="page-head"><h1>Übersicht</h1></div><div class="grid">
<div class="card">Social Media</div><div class="card">Content</div><div class="card">Konto</div></div></section>
<section class="page" id="page-publishing"><div class="page-head"><h1>Veröffentlichung</h1></div>
<div class="card"><div class="platform-card"><span class="platform-info"><strong>YouTube</strong></span></div></div>
<div id="publishingFilesSlot"></div></section></main>
<script>document.querySelector('aside button').onclick=()=>{document.querySelector('#page-overview').classList.remove('active');document.querySelector('#page-publishing').classList.add('active')}</script></body></html>`;

async function firstPostRoute(route,readPortalFiles){
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
  if(url.origin===site&&url.pathname==='/fixture/sma_publication_files_v1'&&args.p_action==='list'){
   return reply(args.p_input?.platform==='youtube'?readPortalFiles():{ok:true,files:[]});
  }
  if(url.origin===site&&url.pathname==='/fixture/sma_publication_preview_v1'&&args.p_action==='latest'){
   assert.equal(args.p_input.platform,'youtube');return reply({ok:true,status:'empty'});
  }
  if(url.origin==='https://bnvnmdxosbnuzedokqgh.supabase.co'&&url.pathname==='/rest/v1/rpc/sma_gallery_music_v1'&&args.p_action==='claim')return reply({ok:true,state:'idle'});
 }
 throw Error('Unexpected first-post request '+request.method()+' '+url.pathname);
}

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
  await frame.getByRole('button',{name:'Optimieren'}).tap();
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
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
try{
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
    const back=page.getByRole('link',{name:/Zurück zum Auftrag/});await fits(back,width);await back.tap();
    await selectedRow(frame,width);assert.equal(page.url(),originURL);
    assert.deepEqual(errors,[]);console.log(width+' × '+height+': touch search, reload, current draft and return to page 2 passed');
   }catch(e){throw Error(width+'px: '+e.message+'; '+errors.join(', '),{cause:e});}
  }finally{await context.close();}
 }
 for(const [width,height] of [[320,568],[390,844]])await firstPost(browser,width,height);
 await firstPost(browser,320,568,{failFirstRead:true});
}finally{await browser.close();}
