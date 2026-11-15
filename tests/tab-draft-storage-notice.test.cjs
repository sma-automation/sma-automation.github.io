const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const source=fs.readFileSync('app/assets/publication-tab-draft.mjs','utf8');
const key=p=>'sma.publication.pending-save.v1.'+p;
const copy=v=>JSON.parse(JSON.stringify(v));
function record(portal='youtube'){
 const fields={title:'Privater Titel',body:'Privater Beitragstext.',hashtags:['SMA'],product_id:null};
 return {token:'60600000-0000-4000-8000-000000000001',owner:'fixture-owner',portal,route:'[null,null,null,null]',
  fileId:'60600000-0000-4000-8000-000000000002',fileRevision:'version:1',previewId:'60600000-0000-4000-8000-000000000003',
  assignment:2,revision:3,shop:'https://sma-automation.com/app/shop.html?shop=fixture',base:copy(fields),sent:copy(fields),
  form:{title:fields.title,body:fields.body,tags:'#SMA'}};
}
function fixture({dom=true,brokenDom=false}={}){
 const entries=new Map(),nodes=[];let denyWrite=false,denyRead=false,denyRemove=false;
 const status={textContent:'Speicherstand bei SMA noch ungeklärt.'},input={value:'Neueste offene Eingabe'};
 const main={prepend:n=>nodes.unshift(n)};
 const win={sessionStorage:{getItem(k){if(denyRead)throw Error('denied');return entries.get(k)??null;},
  setItem(k,v){if(denyWrite)throw Object.assign(Error('full'),{name:'QuotaExceededError'});entries.set(k,v);},
  removeItem(k){if(denyRemove)throw Error('denied');entries.delete(k);}}};
 if(dom)win.document={querySelector(){if(brokenDom)throw Error('view removed');return main;},
  getElementById:id=>id==='saveStatus'?status:nodes.find(n=>n.id===id),
  createElement:tag=>({tag,attrs:{},writes:0,set textContent(v){this.text=v;this.writes++;},get textContent(){return this.text;},
   setAttribute(k,v){this.attrs[k]=v;}})};
 const store=vm.runInNewContext(source.replace('export function tabDraftStore','function tabDraftStore')+';tabDraftStore',{})(win);
 return {store,entries,nodes,status,input,warning:()=>nodes.find(n=>n.id==='tabDraftStorageWarning'),
  denyWrite:v=>denyWrite=v,denyRead:v=>denyRead=v,denyRemove:v=>denyRemove=v};
}
for(const portal of ['youtube','tiktok'])test(portal+': failed first checkpoint warns separately without changing fields or server status',()=>{
 const f=fixture(),v=record(portal);f.denyWrite(true);f.store.write(v);
 assert.equal(f.warning()?.hidden,false);assert.match(f.warning().textContent,/kopiere.*vor dem Neuladen/);
 assert.match(f.warning().textContent,/Speicherstatus bei SMA/);
 assert.equal(f.warning().attrs.role,'status');assert.equal(f.warning().attrs['aria-live'],'polite');
 assert.equal(f.warning().attrs['aria-atomic'],'true');
 assert.equal(f.status.textContent,'Speicherstand bei SMA noch ungeklärt.');assert.equal(f.input.value,'Neueste offene Eingabe');
 assert.equal(f.entries.size,0);
 for(const value of [v.owner,v.token,v.form.title,v.form.body,v.shop])assert.equal(f.warning().textContent.includes(value),false);
});
test('last stored form remains intact and repeated failures neither duplicate nor reannounce the warning',()=>{
 const f=fixture(),v=record();f.store.write(v);const stored=f.entries.get(key(v.portal));assert.equal(f.nodes.length,0);
 f.denyWrite(true);v.form.body='Spätere ungesicherte Eingabe';f.store.update(v);
 assert.equal(f.warning()?.hidden,false);const writes=f.warning().writes;
 for(let i=0;i<5;i++)f.store.update(v);
 assert.equal(f.nodes.length,1);assert.equal(f.warning().writes,writes);assert.equal(f.entries.get(key(v.portal)),stored);
});
test('successful checkpoint hides the warning without claiming a confirmed server save',()=>{
 const f=fixture(),v=record();f.store.write(v);f.denyWrite(true);v.form.body='Später';f.store.update(v);
 assert.equal(f.warning()?.hidden,false);f.denyWrite(false);f.store.update(v);
 assert.equal(f.warning().hidden,true);assert.equal(f.warning().textContent,'');
 assert.equal(f.store.read(v.portal,v.owner,v.route).form.body,'Später');
 assert.equal(f.status.textContent,'Speicherstand bei SMA noch ungeklärt.');
});
test('a blocked read during a tracked update warns without erasing the persisted record',()=>{
 const f=fixture(),v=record();f.store.write(v);const stored=f.entries.get(key(v.portal));
 f.denyRead(true);v.form.body='Später';f.store.update(v);
 assert.equal(f.warning()?.hidden,false);assert.equal(f.entries.get(key(v.portal)),stored);
});
test('late update and forget from an older attempt cannot hide a newer failure',()=>{
 const f=fixture(),old=record(),next=record();next.token='60600000-0000-4000-8000-000000000099';
 f.store.write(old);f.denyWrite(true);f.store.write(next);assert.equal(f.warning()?.hidden,false);
 f.store.update(old);f.store.forget(old);f.store.clearOwner('another-owner');assert.equal(f.warning().hidden,false);
 f.store.forget(next);assert.equal(f.warning().hidden,true);
});
test('logout clears the warning even when all storage access fails and no checkpoint exists',()=>{
 const f=fixture(),v=record();f.denyWrite(true);f.denyRead(true);f.denyRemove(true);f.store.write(v);
 assert.equal(f.warning()?.hidden,false);assert.doesNotThrow(()=>f.store.clearOwner(v.owner));
 assert.equal(f.warning().hidden,true);f.store.update(v);assert.equal(f.warning().hidden,true);
});
test('owner changes and explicit discard remove the notice without depending on storage writes',()=>{
 for(const change of ['owner','discard']){
  const f=fixture(),v=record();f.store.write(v);f.denyWrite(true);f.store.update(v);assert.equal(f.warning()?.hidden,false);
  if(change==='owner')assert.equal(f.store.read(v.portal,'other-owner',v.route),null);else f.store.forget(v);
  assert.equal(f.warning().hidden,true);assert.equal(f.entries.has(key(v.portal)),false);
 }
});
test('a successful new attempt clears a stale warning and invalid form sizes remain unsaved',()=>{
 const f=fixture(),v=record();f.denyWrite(true);f.store.write(v);assert.equal(f.warning()?.hidden,false);
 f.denyWrite(false);const next={...v,token:'60600000-0000-4000-8000-000000000099'};f.store.write(next);
 assert.equal(f.warning().hidden,true);next.form={...next.form,body:'x'.repeat(2401)};f.store.update(next);
 assert.equal(f.warning().hidden,false);assert.equal(f.entries.has(key(v.portal)),false);
});
test('warning is optional outside the publication view and DOM failures never block storage operations',()=>{
 for(const opts of [{dom:false},{brokenDom:true}]){
  const f=fixture(opts),v=record();f.store.write(v);f.denyWrite(true);f.store.update(v);
  assert.equal(f.nodes.length,0);assert.equal(f.entries.size,1);assert.doesNotThrow(()=>f.store.clearOwner(v.owner));
 }
});

test('desktop and mobile show the warning after real quota exhaustion, retain the form and clear it after recovery/logout',async()=>{
 const runtime=process.env.SMA_TEST_PLAYWRIGHT?pathToFileURL(process.env.SMA_TEST_PLAYWRIGHT).href:'./dom-runtime/node_modules/playwright-core/index.mjs';
 const {chromium}=await import(runtime);
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome',
  args:process.env.SMA_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]});
 try{for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
  const page=await context.newPage(),external=[],initial=record(),origin='https://sma-draft-fixture.test';
  await page.route('**/*',route=>{
   if(route.request().url()===origin+'/')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta name="viewport" content="width=device-width"><link rel="icon" href="data:,"><style>[hidden]{display:none!important}*{box-sizing:border-box}main{max-width:720px;margin:auto;padding:16px}.notice{padding:13px 16px;line-height:1.55}textarea{max-width:100%}</style><main><p id="saveStatus">Speicherstand bei SMA noch ungeklärt.</p><label>Beitrag<textarea id="body"></textarea></label><button id="checkpoint">Zwischenstand</button></main>'});
   external.push(route.request().url());return route.abort();
  });
  await page.goto(origin+'/');
  await page.evaluate(({source,initial})=>{
   window.store=Function('win',source.replace('export function tabDraftStore','function tabDraftStore')+';return tabDraftStore(win)')(window);
   window.record=initial;store.write(record);document.getElementById('body').value=record.form.body;
   document.getElementById('checkpoint').onclick=()=>{record.form.body=document.getElementById('body').value;store.update(record);};
  },{source,initial});
  const quota=await page.evaluate(()=>{
   let failures=0,count=0;
   for(const size of [262144,32768,4096,512,64,1])while(count<10000){
    try{sessionStorage.setItem('fixture-quota-'+count,'x'.repeat(size));count++;}
    catch(e){if(e.name!=='QuotaExceededError')throw e;failures++;break;}
   }
   return {failures,count};
  });
  assert.ok(quota.failures>0&&quota.count<10000);
  const later='Neuere offene Eingabe '.repeat(80);await page.locator('#body').fill(later);await page.locator('#checkpoint').click();
  const warning=page.locator('#tabDraftStorageWarning');assert.equal(await warning.isVisible(),true);
  assert.match(await warning.textContent(),/kopiere.*vor dem Neuladen/);assert.equal(await page.locator('#body').inputValue(),later);
  assert.equal(await page.locator('#saveStatus').textContent(),'Speicherstand bei SMA noch ungeklärt.');
  assert.equal(await page.evaluate(()=>store.read(record.portal,record.owner,record.route).form.body),initial.form.body);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#checkpoint').click();assert.equal(await warning.count(),1);
  await page.evaluate(()=>{for(const k of Object.keys(sessionStorage))if(k.startsWith('fixture-quota-'))sessionStorage.removeItem(k);});
  await page.locator('#checkpoint').click();assert.equal(await warning.isVisible(),false);
  assert.equal(await page.evaluate(()=>store.read(record.portal,record.owner,record.route).form.body),later);
  await page.evaluate(()=>{record.form.body='x'.repeat(2401);store.update(record);});assert.equal(await warning.isVisible(),true);
  await page.evaluate(()=>store.clearOwner(record.owner));assert.equal(await warning.isVisible(),false);
  assert.deepEqual(external,[]);await context.close();
 }}finally{await browser.close();}
});
