const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
let browser;
test.before(async()=>{
 const runtime=process.env.SMA_TEST_PLAYWRIGHT?pathToFileURL(process.env.SMA_TEST_PLAYWRIGHT).href:'./dom-runtime/node_modules/playwright-core/index.mjs';
 const {chromium}=await import(runtime);
 browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome',args:process.env.SMA_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]});
});
test.after(async()=>{await browser?.close();});
const markup=`<!doctype html><html lang="de"><meta name="viewport" content="width=device-width"><title>Private search fixture</title>
<style>[hidden]{display:none!important}button,input,textarea{font:inherit}body{margin:8px}</style>
<header><button id="before">Übersicht</button></header><main><textarea id="draft">Meine offene Änderung</textarea><button id="background">Hintergrundaktion</button><input id="destination" aria-label="Zielsuche"></main><button id="mobile-search">Mobile Suche</button>
</html>`;
async function fixture(t,mobile,embedded){
 const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
 const unexpected=[],errors=[];
 await context.route('**/*',route=>{unexpected.push(route.request().url());return route.abort();});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 t.after(async()=>{await context.close();assert.deepEqual(unexpected,[],'no external requests');assert.deepEqual(errors,[],'no browser errors');});
 await page.setContent(embedded?'<meta name="viewport" content="width=device-width"><iframe title="Dashboard" style="border:0;width:100%;height:95vh"></iframe>':markup);
 if(embedded)await page.locator('iframe').evaluate((el,html)=>{el.srcdoc=html;},markup);
 if(embedded)await page.waitForFunction(()=>document.querySelector('iframe').contentDocument?.getElementById('draft'));
 const frame=embedded?await (await page.locator('iframe').elementHandle()).contentFrame():page.mainFrame();
 await frame.evaluate(async sources=>{
  // Execute the actual modules in the browser; only redirect imports to local Blob URLs.
  const urls=[];const moduleURL=source=>{const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));urls.push(url);return url;};
  try{
   const description=moduleURL(sources.description);
   const feedback=moduleURL(sources.feedback);
   const search=moduleURL(sources.search.replace("'./file-description.mjs'",JSON.stringify(description)));
   const quick=moduleURL(sources.quick.replace("'./dashboard-file-search.mjs?v=2'",JSON.stringify(search))
    .replace("'./dashboard-feedback.mjs?v=1'",JSON.stringify(feedback)));
   const {mountDashboardQuickFind,sectionCatalog}=await import(quick);
   window.areas=[...sectionCatalog];window.files=[];window.fileStatus='ready';window.retryAction=null;window.actions=[];window.dismissed=0;
   window.finder=mountDashboardQuickFind({doc:document,getAreas:()=>areas,getFiles:()=>files,getFileStatus:()=>fileStatus,getFileRetry:()=>retryAction,
    onRetryFiles:()=>actions.push('retry'),onNavigate:(key,query)=>{actions.push([key,query]);document.getElementById('destination').focus();return true;},
    onOpenFile:(...args)=>{actions.push(['file',...args.slice(0,3)]);document.getElementById('destination').focus();return true;},onDismiss:()=>dismissed++});
   document.getElementById('background').onclick=()=>actions.push('background');
   document.getElementById('mobile-search').onclick=()=>finder.show(document.getElementById('mobile-search'));
  }finally{urls.forEach(url=>URL.revokeObjectURL(url));}
 },{feedback:fs.readFileSync('app/assets/dashboard-feedback.mjs','utf8'),description:fs.readFileSync('app/assets/file-description.mjs','utf8'),search:fs.readFileSync('app/assets/dashboard-file-search.mjs','utf8'),quick:fs.readFileSync('app/assets/dashboard-quick-find.mjs','utf8')});
 const launcher=mobile?'#mobile-search':'#smaGlobalQuickFind';
 await frame.locator(launcher).click();
 return {page,frame,launcher,active:()=>frame.evaluate(()=>document.activeElement?.id||document.activeElement?.textContent)};
}
for(const mobile of [false,true])for(const embedded of [false,true]){
 const label=`${mobile?'mobile':'desktop'} ${embedded?'embedded':'standalone'}`;
 test(label+': Tab and Shift+Tab stay inside the open search',async t=>{
  const {page,frame}=await fixture(t,mobile,embedded);
  await frame.locator('#smaQuickFindResults button').last().focus();await page.keyboard.press('Tab');
  assert.equal(await frame.evaluate(()=>document.activeElement===document.querySelector('.sma-qf-close')),true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await frame.evaluate(()=>document.activeElement===document.querySelector('#smaQuickFindResults button:last-child')),true);
  for(let i=0;i<18;i++){await page.keyboard.press('Tab');assert.equal(await frame.evaluate(()=>document.getElementById('smaQuickFindPanel').contains(document.activeElement)),true);}
  assert.equal(await frame.locator('#draft').inputValue(),'Meine offene Änderung');assert.deepEqual(await frame.evaluate(()=>actions),[]);
 });
 test(label+': refreshing results keeps the selected area and deep-search action',async t=>{
  const {frame}=await fixture(t,mobile,embedded);
  await frame.getByRole('button',{name:'Übersicht Dashboard Start',exact:true}).focus();
  await frame.evaluate(()=>finder.refresh());
  assert.equal(await frame.evaluate(()=>document.activeElement?.textContent),'ÜbersichtDashboard Start');
  await frame.locator('#smaQuickFindInput').fill('SMA');
  await frame.getByRole('button',{name:'In Aufträgen suchen Eigene Veröffentlichungsaufträge durchsuchen',exact:true}).focus();
  await frame.evaluate(()=>finder.refresh());
  assert.equal(await frame.evaluate(()=>document.activeElement?.textContent),'In Aufträgen suchenEigene Veröffentlichungsaufträge durchsuchen');
  await frame.evaluate(()=>{areas=areas.filter(a=>a.key!=='history');finder.refresh();});
  assert.equal(await frame.evaluate(()=>document.activeElement?.id),'smaQuickFindInput');
 });
 test(label+': empty results and disappearing retry keep keyboard focus inside',async t=>{
  const {page,frame}=await fixture(t,mobile,embedded);
  await frame.evaluate(()=>{areas=[];files=[];retryAction='catalog';finder.refresh();});
  await frame.getByRole('button',{name:'Dateiliste erneut laden',exact:true}).focus();
  await frame.evaluate(()=>{retryAction=null;finder.refresh();});
  assert.equal(await frame.evaluate(()=>document.activeElement?.id),'smaQuickFindInput');
  await page.keyboard.press('Tab');assert.equal(await frame.evaluate(()=>document.activeElement===document.querySelector('.sma-qf-close')),true);
  await page.keyboard.press('Shift+Tab');assert.equal(await frame.evaluate(()=>document.activeElement?.id),'smaQuickFindInput');
 });
 test(label+': file and all-results focus survive reordering and changing hit counts',async t=>{
  const {frame}=await fixture(t,mobile,embedded);
  await frame.evaluate(()=>{files=Array.from({length:12},(_,i)=>({id:'fixture-'+i,name:'SMA Datei '+i,media_kind:'image'}));});
  await frame.locator('#smaQuickFindInput').fill('SMA');
  await frame.locator('[data-quick-file="fixture-3"]').focus();
  await frame.evaluate(()=>{files=[files[3],...files.filter(f=>f.id!=='fixture-3')];finder.refresh();});
  assert.equal(await frame.evaluate(()=>document.activeElement?.dataset?.quickFile),'fixture-3');
  await frame.getByRole('button',{name:'Alle 12 Dateien anzeigen Gefilterte Galerie öffnen',exact:true}).focus();
  await frame.evaluate(()=>{files.push({id:'fixture-12',name:'SMA Datei 12',media_kind:'image'});finder.refresh();});
  assert.equal(await frame.evaluate(()=>document.activeElement?.textContent),'Alle 13 Dateien anzeigenGefilterte Galerie öffnen');
  await frame.evaluate(()=>{files=files.slice(0,2);finder.refresh();});
  assert.equal(await frame.evaluate(()=>document.activeElement?.id),'smaQuickFindInput');
 });
 test(label+': Escape returns to the launcher and selected navigation keeps its target focus',async t=>{
  const {page,frame,launcher}=await fixture(t,mobile,embedded);
  await page.keyboard.press('Escape');assert.equal(await frame.locator('#smaQuickFindDialog').isVisible(),false);
  assert.equal(await frame.evaluate(()=>document.activeElement?.id),launcher.slice(1));
  await frame.locator(launcher).click();await frame.locator('#smaQuickFindInput').fill('SMA');
  await frame.getByRole('button',{name:'In Aufträgen suchen Eigene Veröffentlichungsaufträge durchsuchen',exact:true}).click();
  await frame.waitForFunction(()=>document.getElementById('smaQuickFindDialog').hidden);
  assert.equal(await frame.evaluate(()=>document.activeElement?.id),'destination');assert.deepEqual(await frame.evaluate(()=>actions),[['history-search','SMA']]);
  await frame.locator(launcher).click();await frame.evaluate(()=>finder.destroy());
  assert.equal(await frame.locator('#smaQuickFindDialog').count(),0);
  await frame.locator('#before').focus();await page.keyboard.press('Tab');
  assert.equal(await frame.evaluate(()=>document.activeElement?.id),'draft');
 });
}
