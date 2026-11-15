const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const source=fs.readFileSync('app/assets/publication-tab-draft.mjs','utf8');
const storageKey=portal=>'sma.publication.pending-save.v1.'+portal;
const clone=value=>JSON.parse(JSON.stringify(value));
function record(portal='youtube'){
 const fields={title:'Gespeicherter Titel',body:'Mein letzter vollständiger Beitrag.',hashtags:['SMA'],product_id:null};
 return {token:'60600000-0000-4000-8000-000000000001',owner:'fixture-owner',portal,route:'[null,null,null,null]',
  fileId:'60600000-0000-4000-8000-000000000002',fileRevision:'version:1',previewId:'60600000-0000-4000-8000-000000000003',
  assignment:2,revision:3,shop:'https://sma-automation.com/app/shop.html?shop=fixture',base:{...clone(fields),body:'Ursprünglicher Beitrag vor dem Speicherversuch.'},sent:clone(fields),
  form:{title:fields.title,body:fields.body,tags:'#SMA'}};
}
function fixture(){
 const entries=new Map();let failWrite=false,failRead=false,failRemove=false;
 const win={sessionStorage:{getItem(key){if(failRead)throw Error('storage denied');return entries.get(key)??null;},
  setItem(key,value){if(failWrite)throw Object.assign(Error('storage full'),{name:'QuotaExceededError'});entries.set(key,value);},
  removeItem(key){if(failRemove)throw Error('storage denied');entries.delete(key);}}};
 const {tabDraftStore}=vm.runInNewContext(source.replace('export function tabDraftStore','function tabDraftStore')+'\n({tabDraftStore})');
 return {store:tabDraftStore(win),entries,reload:()=>tabDraftStore(win),failWrite:value=>failWrite=value,
  failRead:value=>failRead=value,failRemove:value=>failRemove=value};
}
for(const portal of ['youtube','tiktok'])test(portal+': a failed form checkpoint preserves the last stored copy of the same interrupted save',()=>{
 const f=fixture(),v=record(portal);f.store.write(v);const before=f.entries.get(storageKey(portal));
 f.failWrite(true);v.form.body='Spätere Eingabe, die noch nicht zwischengespeichert werden konnte.';f.store.update(v);
 assert.equal(f.entries.get(storageKey(portal)),before);
 const restored=f.reload().read(portal,v.owner,v.route);
 assert.equal(restored.form.body,'Mein letzter vollständiger Beitrag.');assert.notEqual(restored.form.body,v.form.body);
 assert.equal(restored.token,v.token);
});
test('recovery retains the most recent successful checkpoint and resumes updates when storage works again',()=>{
 const f=fixture(),v=record();f.store.write(v);v.form.body='Zweiter vollständiger Zwischenstand.';f.store.update(v);
 f.failWrite(true);v.form.body='Dritter noch nicht gespeicherter Zwischenstand.';f.store.update(v);
 assert.equal(f.reload().read(v.portal,v.owner,v.route).form.body,'Zweiter vollständiger Zwischenstand.');
 f.failWrite(false);f.store.update(v);assert.equal(f.reload().read(v.portal,v.owner,v.route).form.body,v.form.body);
});
test('a failed write cannot retain a different account, file, route, attempt, revision or sent payload',()=>{
 const changes=[v=>v.owner='other-owner',v=>v.token='60600000-0000-4000-8000-000000000099',
  v=>v.route='[null,"other",null,null]',v=>v.fileId='60600000-0000-4000-8000-000000000099',
  v=>v.fileRevision='version:2',v=>v.previewId='60600000-0000-4000-8000-000000000099',
  v=>v.assignment++,v=>v.revision++,v=>v.shop='https://sma-automation.com/app/shop.html?shop=other',
  v=>v.base.title='Andere Basis',v=>v.base.body='Andere Basisbeschreibung',v=>v.base.hashtags=['Andere'],v=>v.base.product_id='other',
  v=>v.sent.title='Anderer gesendeter Titel',v=>v.sent.body='Andere gesendete Beschreibung',v=>v.sent.hashtags=['Andere'],v=>v.sent.product_id='other'];
 for(const change of changes){const f=fixture(),v=record();f.store.write(v);change(v);f.failWrite(true);f.store.write(v);
  assert.equal(f.entries.has(storageKey(v.portal)),false,String(change));}
});
test('equivalent immutable fields in a different property order still describe the same pending save',()=>{
 const f=fixture(),v=record();f.store.write(v);f.failWrite(true);
 for(const name of ['base','sent'])v[name]=Object.fromEntries(Object.entries(v[name]).reverse());
 v.form.title='Noch nicht gespeichert';f.store.update(v);
 assert.equal(f.reload().read(v.portal,v.owner,v.route).form.title,'Gespeicherter Titel');
});
test('invalid and oversized form records still invalidate recovery instead of reviving old content',()=>{
 for(const change of [v=>v.form.body='x'.repeat(2401),v=>v.form.tags='x'.repeat(1001),v=>v.form.link={url:'https://foreign.invalid'},
  v=>v.extra='x'.repeat(32001),v=>v.sent.hashtags=['one','two','three','four'],v=>v.self=v]){
  const f=fixture(),v=record();f.store.write(v);change(v);f.failWrite(true);assert.doesNotThrow(()=>f.store.write(v));
  assert.equal(f.entries.has(storageKey('youtube')),false);
 }
});
test('another route cannot read the fallback and an account switch or logout clears it even while writes fail',()=>{
 for(const action of ['switch','logout','forget']){
  const f=fixture(),v=record();f.store.write(v);f.failWrite(true);v.form.body='Später';f.store.update(v);
  assert.ok(f.entries.has(storageKey(v.portal)));
  assert.equal(f.reload().read(v.portal,v.owner,'other-route'),null);
  if(action==='switch')assert.equal(f.reload().read(v.portal,'other-owner',v.route),null);
  else if(action==='logout')f.store.clearOwner(v.owner);else f.store.forget(v);
  assert.equal(f.entries.has(storageKey(v.portal)),false);
 }
});
test('late update and forget from an older editor cannot change a newer pending save',()=>{
 const f=fixture(),old=record(),next=record();next.token='60600000-0000-4000-8000-000000000099';next.form.body='Neuer Vorgang';
 f.store.write(old);f.store.write(next);f.failWrite(true);old.form.body='Verspätete Eingabe';f.store.update(old);f.store.forget(old);
 assert.equal(f.reload().read(next.portal,next.owner,next.route).token,next.token);
 assert.equal(f.reload().read(next.portal,next.owner,next.route).form.body,'Neuer Vorgang');
});
test('storage failures remain optional and never create an in-memory or cross-portal recovery',()=>{
 const f=fixture(),v=record(),other=record('tiktok');f.store.write(other);f.failWrite(true);f.store.write(v);
 assert.equal(f.store.read(v.portal,v.owner,v.route),null);assert.ok(f.store.read(other.portal,other.owner,other.route));
 f.failRead(true);f.failRemove(true);assert.doesNotThrow(()=>f.store.write(v));assert.doesNotThrow(()=>f.store.update(v));
 assert.doesNotThrow(()=>f.store.clearOwner(v.owner));assert.equal(f.store.read(other.portal,other.owner,other.route),null);
});
test('corrupted old storage cannot be rescued by a failed valid write',()=>{
 for(const raw of ['{broken','null','x'.repeat(32001),JSON.stringify({...record(),owner:''})]){
  const f=fixture(),v=record();f.entries.set(storageKey(v.portal),raw);f.failWrite(true);f.store.write(v);
  assert.equal(f.store.read(v.portal,v.owner,v.route),null);assert.equal(f.entries.has(storageKey(v.portal)),false);
 }
});

test('desktop and mobile reload recover only the last stored form after a real browser quota failure',async()=>{
 const runtime=process.env.SMA_TEST_PLAYWRIGHT?pathToFileURL(process.env.SMA_TEST_PLAYWRIGHT).href:
  './dom-runtime/node_modules/playwright-core/index.mjs';
 const {chromium}=await import(runtime);
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome',
  args:process.env.SMA_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]});
 try{
  for(const mobile of [false,true]){
   const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
   const page=await context.newPage(),external=[];
   const origin='https://sma-draft-fixture.test',initial=record();
   await page.route('**/*',route=>{
    if(route.request().url()===origin+'/')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta name="viewport" content="width=device-width"><link rel="icon" href="data:,"><label>Beitrag<textarea id="body"></textarea></label><button id="save">Bearbeiten</button>'});
    external.push(route.request().url());return route.abort();
   });
   async function mount(){
    await page.evaluate(({source,initial})=>{
     window.store=Function('win',source.replace('export function tabDraftStore','function tabDraftStore')+';return tabDraftStore(win)')(window);
     window.currentRecord=store.read(initial.portal,initial.owner,initial.route)||initial;
     document.getElementById('body').value=currentRecord.form.body;
     document.getElementById('save').onclick=()=>{currentRecord.form.body=document.getElementById('body').value;store.update(currentRecord);};
    },{source,initial});
   }
   await page.goto(origin+'/');await mount();
   await page.evaluate(()=>store.write(currentRecord));
   // Exhaust the actual isolated sessionStorage, leaving less than the next valid form's growth.
   const filled=await page.evaluate(()=>{
    let failures=0,count=0;
    for(const size of [262144,32768,4096,512,64,1]){
     while(count<10000){try{sessionStorage.setItem('fixture-quota-'+count,'x'.repeat(size));count++;}catch(e){if(e.name!=='QuotaExceededError')throw e;failures++;break;}}
    }
    return {failures,count};
   });
   assert.ok(filled.failures>0);assert.ok(filled.count<10000);
   const later='Spätere Eingabe '.repeat(100);await page.locator('#body').fill(later);await page.locator('#save').click();
   assert.equal(await page.locator('#body').inputValue(),later,'failed checkpoint does not overwrite the current form');
   assert.equal(await page.evaluate(()=>store.read(currentRecord.portal,currentRecord.owner,currentRecord.route)?.form.body),initial.form.body);
   await page.reload();await mount();assert.equal(await page.locator('#body').inputValue(),initial.form.body);
   await page.evaluate(()=>{for(const k of Object.keys(sessionStorage))if(k.startsWith('fixture-quota-'))sessionStorage.removeItem(k);});
   await page.locator('#body').fill('Nach freiem Speicher erneut gesichert.');await page.locator('#save').click();
   await page.reload();await mount();assert.equal(await page.locator('#body').inputValue(),'Nach freiem Speicher erneut gesichert.');
   await page.evaluate(()=>store.clearOwner(currentRecord.owner));
   assert.equal(await page.evaluate(()=>store.read(currentRecord.portal,currentRecord.owner,currentRecord.route)),null);
   assert.deepEqual(external,[]);await context.close();
  }
 }finally{await browser.close();}
});
