const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const source=fs.readFileSync('app/assets/publication-tab-draft.mjs','utf8');
const factory=source.replace('export function tabDraftStore','function tabDraftStore')+';tabDraftStore';
function record(){
 const fields={title:'Eigener Titel',body:'Mein aktueller Beitrag.',hashtags:['SMA'],product_id:null};
 return {token:'60600000-0000-4000-8000-000000000001',owner:'fixture-owner',portal:'youtube',route:'[null,null,null,null]',
  fileId:'60600000-0000-4000-8000-000000000002',fileRevision:'version:1',previewId:'60600000-0000-4000-8000-000000000003',
  assignment:2,revision:3,shop:'https://sma-automation.com/app/shop.html?shop=fixture',base:structuredClone(fields),sent:structuredClone(fields),
  form:{title:fields.title,body:fields.body,tags:'#SMA'}};
}
function fixture({events=true,brokenEvents=false}={}){
 const entries=new Map(),handlers=new Set(),nodes=new Map(),copied=[];let denied=false,reads=0,writes=0,adds=0,removes=0;
 class Element{
  constructor(){this.hidden=false;this.children=[];this.events={};this.style={};this.textContent='';this.value='';}
  setAttribute(){} append(...items){this.children.push(...items);for(const n of items)nodes.set(n.id,n);}
  prepend(n){nodes.set(n.id,n);} after(n){nodes.set(n.id,n);} addEventListener(name,fn){this.events[name]=fn;}
  focus(){} select(){}
 }
 const main=new Element();
 for(const [id,value] of Object.entries({saveStatus:'Speicherstand bei SMA noch ungeklärt.','youtube-title':'Eigener Titel','youtube-body':'Neueste offene Eingabe','youtube-hashtags':'#SMA',source_text:'Eigene Beschreibung'})){
  const node=new Element();node.value=value;node.textContent=value;nodes.set(id,node);
 }
 const win={document:{querySelector:()=>main,getElementById:id=>nodes.get(id),createElement:()=>new Element()},
  sessionStorage:{get length(){return entries.size;},key:i=>[...entries.keys()][i]??null,
   getItem(k){reads++;return entries.get(k)??null;},setItem(k,v){writes++;if(denied)throw Error('quota');entries.set(k,v);},removeItem(k){writes++;entries.delete(k);}},
  navigator:{clipboard:{writeText:async text=>{copied.push(text);}}},setTimeout:()=>1,clearTimeout(){}};
 if(events){
  win.addEventListener=(name,fn)=>{if(brokenEvents)throw Error('unavailable');assert.equal(name,'beforeunload');adds++;handlers.add(fn);};
  win.removeEventListener=(name,fn)=>{if(brokenEvents)throw Error('unavailable');assert.equal(name,'beforeunload');removes++;handlers.delete(fn);};
 }
 const store=vm.runInNewContext(factory)(win);
 function leave(){const event={prevented:false,returnValue:undefined,preventDefault(){this.prevented=true;}};for(const fn of [...handlers])fn(event);return event;}
 return {store,entries,handlers,nodes,copied,leave,deny:v=>denied=v,counts:()=>({reads,writes,adds,removes})};
}

test('ordinary viewing and successful checkpoints never install a leave warning',()=>{
 const f=fixture(),v=record();assert.equal(f.handlers.size,0);f.store.write(v);f.store.update(v);
 assert.equal(f.handlers.size,0);assert.equal(f.leave().prevented,false);assert.equal(f.counts().adds,0);
});
test('failed checkpoint requests browser confirmation without reading, writing or exposing content on leave',()=>{
 const f=fixture(),v=record();f.deny(true);f.store.write(v);
 assert.equal(f.nodes.get('tabDraftStorageWarning').hidden,false);assert.equal(f.handlers.size,1);
 const before=f.counts(),event=f.leave();assert.equal(event.prevented,true);assert.equal(event.returnValue,'');assert.deepEqual(f.counts(),before);
 assert.equal(f.nodes.get('youtube-body').value,'Neueste offene Eingabe');assert.equal(f.nodes.get('saveStatus').textContent,'Speicherstand bei SMA noch ungeklärt.');
});
test('repeated failures keep one listener and abandoning navigation keeps the warning and old checkpoint',()=>{
 const f=fixture(),v=record();f.store.write(v);const old=[...f.entries];f.deny(true);v.form.body='Spätere ungesicherte Eingabe';
 for(let i=0;i<5;i++){f.store.update(v);assert.equal(f.leave().prevented,true);}
 assert.equal(f.handlers.size,1);assert.equal(f.counts().adds,1);assert.deepEqual([...f.entries],old);
 assert.equal(f.nodes.get('tabDraftStorageWarning').hidden,false);
});
test('successful checkpoint removes the listener instead of leaving a permanent navigation warning',()=>{
 const f=fixture(),v=record();f.store.write(v);f.deny(true);v.form.body='Neu';f.store.update(v);assert.equal(f.handlers.size,1);
 f.deny(false);f.store.update(v);assert.equal(f.handlers.size,0);assert.equal(f.leave().prevented,false);assert.equal(f.counts().removes,1);
 f.deny(true);f.store.update(v);assert.equal(f.handlers.size,1);assert.equal(f.counts().adds,2);
});
test('discard, logout and account replacement remove only the matching leave guard',()=>{
 for(const action of ['discard','logout','owner']){
  const f=fixture(),v=record();f.store.write(v);f.deny(true);f.store.update(v);assert.equal(f.handlers.size,1);
  f.store.clearOwner('unrelated-owner');assert.equal(f.handlers.size,1);
  if(action==='discard')f.store.forget(v);
  else{
   if(action==='owner'){assert.equal(f.store.read(v.portal,'other-owner',v.route),null);assert.equal(f.handlers.size,1);}
   f.store.clearOwner(v.owner);
  }
  assert.equal(f.handlers.size,0);assert.equal(f.leave().prevented,false);
 }
});
test('late older actions cannot disable the newer failure guard',()=>{
 const f=fixture(),old=record(),next={...record(),token:'60600000-0000-4000-8000-000000000099'};
 f.store.write(old);f.deny(true);f.store.write(next);f.store.update(old);f.store.forget(old);
 assert.equal(f.handlers.size,1);assert.equal(f.leave().prevented,true);
 f.store.forget(next);assert.equal(f.handlers.size,0);
});
test('copy success is not a save and cannot disable the leave guard',async()=>{
 const f=fixture(),v=record();f.deny(true);f.store.write(v);assert.equal(f.handlers.size,1);
 f.nodes.get('tabDraftCopy').events.click();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.copied.length,1);assert.match(f.nodes.get('tabDraftCopyStatus').textContent,/keine Speicherung/);
 assert.equal(f.leave().prevented,true);assert.equal(f.handlers.size,1);
});
test('optional or unavailable event APIs never interrupt checkpoint or logout cleanup',()=>{
 for(const options of [{events:false},{brokenEvents:true}]){
  const f=fixture(options),v=record();f.deny(true);assert.doesNotThrow(()=>f.store.write(v));
  assert.equal(f.nodes.get('tabDraftStorageWarning').hidden,false);assert.doesNotThrow(()=>f.store.clearOwner(v.owner));
  assert.equal(f.nodes.get('tabDraftStorageWarning').hidden,true);
 }
});

test('desktop and mobile confirm reload and closing for standalone and embedded storage failures',async()=>{
 const runtime=process.env.SMA_TEST_PLAYWRIGHT?pathToFileURL(process.env.SMA_TEST_PLAYWRIGHT).href:'./dom-runtime/node_modules/playwright-core/index.mjs';
 const {chromium}=await import(runtime);
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome',args:process.env.SMA_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]});
 const markup='<main><p id="saveStatus">Speicherstand bei SMA noch ungeklärt.</p><input id="youtube-title"><textarea id="youtube-body"></textarea><input id="youtube-hashtags"><textarea id="source_text"></textarea><button id="checkpoint">Zwischenstand</button></main>';
 try{for(const mobile of [false,true])for(const embedded of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
  const external=[];await context.route('**/*',route=>{external.push(route.request().url());return route.abort();});
  const page=await context.newPage();
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width"><style>[hidden]{display:none!important}</style>'+(embedded?'<iframe style="width:100%;height:700px" title="Beitrag"></iframe>':markup));
  if(embedded)await page.locator('iframe').evaluate((frame,html)=>{frame.srcdoc=html;},markup);
  if(embedded)await page.waitForFunction(()=>document.querySelector('iframe').contentDocument?.getElementById('checkpoint'));
  const target=embedded?page.frames().find(frame=>frame!==page.mainFrame()):page.mainFrame();
  await target.evaluate(({source,initial})=>{
   const entries=new Map();window.failCheckpoint=true;window.clipboardWrites=0;
   const adapter={document,navigator:{clipboard:{writeText:async()=>{window.clipboardWrites++;}}},
    addEventListener:window.addEventListener.bind(window),removeEventListener:window.removeEventListener.bind(window),
    setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window),
    sessionStorage:{get length(){return entries.size;},key:i=>[...entries.keys()][i]??null,
     getItem:k=>entries.get(k)??null,setItem(k,v){if(window.failCheckpoint)throw Error('quota');entries.set(k,v);},removeItem:k=>entries.delete(k)}};
   window.store=Function('win',source.replace('export function tabDraftStore','function tabDraftStore')+';return tabDraftStore(win)')(adapter);
   window.fixtureRecord=initial;
   for(const [id,value] of Object.entries({'youtube-title':initial.form.title,'youtube-body':initial.form.body,'youtube-hashtags':initial.form.tags,source_text:'Inhaltsbeschreibung'}))document.getElementById(id).value=value;
   document.getElementById('checkpoint').onclick=()=>store.write(fixtureRecord);
  },{source,initial:record()});
  if(mobile)await target.locator('#checkpoint').tap();else await target.locator('#checkpoint').click();
  assert.equal(await target.locator('#tabDraftStorageWarning').isVisible(),true);
  const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.type());await dialog.dismiss();});
  const reloadDialog=page.waitForEvent('dialog',{timeout:5000});
  await page.evaluate(()=>window.location.reload());assert.equal((await reloadDialog).type(),'beforeunload');
  assert.equal(await target.locator('#youtube-body').inputValue(),record().form.body);
  const dialogPromise=page.waitForEvent('dialog',{timeout:5000});
  await page.close({runBeforeUnload:true});const dialog=await dialogPromise;assert.equal(dialog.type(),'beforeunload');
  assert.equal(page.isClosed(),false);assert.equal(await target.locator('#youtube-body').inputValue(),record().form.body);
  await target.locator('#tabDraftCopy').click();await target.waitForFunction(()=>document.getElementById('tabDraftCopyStatus').textContent.includes('keine Speicherung'));
  const secondDialog=page.waitForEvent('dialog',{timeout:5000});await page.close({runBeforeUnload:true});await secondDialog;
  assert.deepEqual(dialogs,['beforeunload','beforeunload','beforeunload']);assert.equal(page.isClosed(),false);
  // Clear with both recovery and explicit sign-out; neither requires storage access at leave time.
  await target.evaluate(embedded?()=>store.clearOwner(fixtureRecord.owner):()=>{window.failCheckpoint=false;store.write(fixtureRecord);});
  assert.equal(await target.locator('#tabDraftStorageWarning').isVisible(),false);
  const closed=page.waitForEvent('close',{timeout:5000});await page.close({runBeforeUnload:true});await closed;
  assert.deepEqual(dialogs,['beforeunload','beforeunload','beforeunload']);assert.deepEqual(external,[]);await context.close();
 }}finally{await browser.close();}
});
