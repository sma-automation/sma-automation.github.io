const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const source=fs.readFileSync(process.env.SMA_DRAFT_SOURCE||'app/assets/publication-tab-draft.mjs','utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function record(portal='youtube'){
 const fields={title:'Alter Titel',body:'Alter gesicherter Beitrag.',hashtags:['SMA'],product_id:null};
 return {token:'60600000-0000-4000-8000-000000000001',owner:'fixture-owner',portal,route:'[null,null,null,null]',
 fileId:'60600000-0000-4000-8000-000000000002',fileRevision:'version:1',previewId:'60600000-0000-4000-8000-000000000003',
 assignment:2,revision:3,shop:'https://sma-automation.com/app/shop.html?shop=fixture',base:{...fields},sent:{...fields},
 form:{title:fields.title,body:fields.body,tags:'#SMA'}};
}
const current={title:'Aktueller Titel – Grüße 👋',body:'Meine neueste Eingabe.\nZweite Zeile <b>bleibt Text</b>.',tags:'#SMA #Österreich',description:'Meine aktuelle Inhaltsbeschreibung.'};
const expected='Titel\n'+current.title+'\n\nBeitrag\n'+current.body+'\n\nHashtags\n'+current.tags+'\n\nInhaltsbeschreibung\n'+current.description;
function fixture(portal='youtube'){
 const nodes=new Map(),entries=new Map(),calls=[],timers=new Map();let denyWrite=false,write,sequence=0;
 class Element{
  constructor(tag){this.tag=tag;this.attrs={};this.children=[];this.events={};this.style={};this.textContent='';this.value='';this.hidden=false;this.disabled=false;}
  setAttribute(k,v){this.attrs[k]=v;}
  append(...children){this.children.push(...children);for(const child of children)if(child.id)nodes.set(child.id,child);}
  prepend(child){this.children.unshift(child);if(child.id)nodes.set(child.id,child);}
  after(child){main.append(child);}
  addEventListener(name,fn){this.events[name]=fn;}
  focus(){this.focused=true;}
  select(){this.selected=true;}
  click(){return this.events.click?.();}
 }
 const main=new Element('main'),status=new Element('p');status.textContent='Speicherstand bei SMA ungeklärt.';nodes.set('saveStatus',status);
 for(const p of ['youtube','tiktok'])for(const [field,value]of [['title',current.title],['body',current.body],['hashtags',current.tags]]){
  const el=new Element(field==='title'?'input':'textarea');el.value=p===portal?value:'Fremdes Portal';nodes.set(p+'-'+field,el);
 }
 const desc=new Element('textarea');desc.value=current.description;nodes.set('source_text',desc);
 const win={document:{querySelector:s=>s==='main'?main:null,getElementById:id=>nodes.get(id),createElement:tag=>new Element(tag)},
 sessionStorage:{getItem:k=>entries.get(k)??null,setItem(k,v){if(denyWrite)throw Error('storage full');entries.set(k,v);},removeItem:k=>entries.delete(k)},
 navigator:{clipboard:{writeText(text){calls.push(text);return write?write(text):Promise.resolve();}}},
 setTimeout(fn,ms){assert.equal(ms,10000);const id=++sequence;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
 const store=vm.runInNewContext(source.replace('export function tabDraftStore','function tabDraftStore')+';tabDraftStore')(win);
 const v=record(portal);store.write(v);const saved=entries.get('sma.publication.pending-save.v1.'+portal);
 const fail=()=>{denyWrite=true;store.update(v);};fail();
 return {store,v,win,nodes,calls,entries,saved,fail,denyWrite:value=>denyWrite=value,setWrite:fn=>write=fn,
  el:id=>nodes.get(id),copy:()=>{const button=nodes.get('tabDraftCopy');assert.ok(button,'copy action is available');return button.click();},
  timeout(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());},timers};
}
for(const portal of ['youtube','tiktok'])test(portal+': explicit copy reads latest visible fields, never the old saved checkpoint or other portal',async()=>{
 const f=fixture(portal);assert.equal(f.calls.length,0);assert.equal(f.el('tabDraftCopy')?.textContent,'Aktuelle Texte kopieren');
 f.copy();await tick();assert.deepEqual(f.calls,[expected]);
 assert.equal(f.el(portal+'-body').value,current.body);assert.equal(f.el('saveStatus').textContent,'Speicherstand bei SMA ungeklärt.');
 assert.equal(f.entries.get('sma.publication.pending-save.v1.'+portal),f.saved);
 for(const forbidden of [f.v.owner,f.v.token,f.v.fileId,f.v.previewId,f.v.shop,'Fremdes Portal','Alter gesicherter Beitrag'])assert.ok(!f.calls[0].includes(forbidden));
 assert.match(f.el('tabDraftCopyStatus').textContent,/kopiert.*keine Speicherung/);assert.equal(f.el('tabDraftManualCopy').value,'');
});
test('edits after the warning are copied raw, including an empty title, invalid hashtags and Unicode',async()=>{
 const f=fixture();f.el('youtube-title').value='';f.el('youtube-body').value='Ungeprüfter Text 🧪';f.el('youtube-hashtags').value='#kein gültiger Tag';
 f.copy();await tick();assert.match(f.calls[0],/Titel\n\n\nBeitrag\nUngeprüfter Text 🧪/);assert.ok(f.calls[0].includes('#kein gültiger Tag'));
});
for(const mode of ['absent','reject','throw'])test(mode+': clipboard failure offers selectable plain text without changing the original form',async()=>{
 const f=fixture();if(mode==='absent')delete f.win.navigator.clipboard;
 else f.setWrite(()=>{if(mode==='throw')throw Error('denied');return Promise.reject(Error('denied'));});
 f.copy();await tick();const manual=f.el('tabDraftManualCopy');
 assert.equal(manual.hidden,false);assert.equal(manual.readOnly,true);assert.equal(manual.value,expected);assert.ok(manual.focused&&manual.selected);
 assert.equal(f.el('youtube-body').value,current.body);assert.match(f.el('tabDraftCopyStatus').textContent,/nicht bestätigt/);
 assert.equal(f.el('tabDraftCopy').disabled,false);assert.equal(f.timers.size,0);
});
test('a stalled clipboard operation is bounded and its late success cannot finish a newer copy',async()=>{
 const f=fixture();let late,second;f.setWrite(()=>new Promise(resolve=>late=resolve));f.copy();f.copy();assert.equal(f.calls.length,1);
 f.timeout();assert.equal(f.el('tabDraftCopy').disabled,false);assert.equal(f.el('tabDraftManualCopy').hidden,false);
 f.setWrite(()=>new Promise(resolve=>second=resolve));f.copy();late();await tick();
 assert.equal(f.el('tabDraftCopy').disabled,true);assert.match(f.el('tabDraftCopyStatus').textContent,/werden kopiert/);
 second();await tick();assert.equal(f.el('tabDraftCopy').disabled,false);assert.match(f.el('tabDraftCopyStatus').textContent,/Texte vom Klick kopiert/);
});
test('logout, discard and successful checkpoint erase the manual snapshot and ignore a late clipboard answer',async()=>{
 for(const action of ['logout','discard','saved']){
  const f=fixture();let late;f.setWrite(()=>new Promise(resolve=>late=resolve));f.copy();
  if(action==='logout')f.store.clearOwner(f.v.owner);else if(action==='discard')f.store.forget(f.v);else{f.denyWrite(false);f.store.update(f.v);}
  assert.equal(f.el('tabDraftStorageActions').hidden,true);assert.equal(f.el('tabDraftManualCopy').value,'');assert.equal(f.timers.size,0);
  late();await tick();assert.equal(f.el('tabDraftCopyStatus').textContent,'');f.copy();assert.equal(f.calls.length,1);
 }
});
test('a new attempt clears the old copy while stale old cleanup cannot remove the new warning',async()=>{
 const f=fixture();delete f.win.navigator.clipboard;f.copy();await tick();
 const next={...f.v,token:'60600000-0000-4000-8000-000000000099'};f.store.write(next);
 assert.equal(f.el('tabDraftManualCopy').value,'');assert.equal(f.el('tabDraftManualCopy').hidden,true);
 f.store.forget(f.v);assert.equal(f.el('tabDraftStorageActions').hidden,false);f.copy();assert.equal(f.el('tabDraftManualCopy').value,expected);
 f.store.clearOwner(next.owner);assert.equal(f.el('tabDraftManualCopy').value,'');
});
test('missing or oversized current fields are not guessed or silently truncated',async()=>{
 for(const invalid of ['missing','oversized']){
  const f=fixture();if(invalid==='missing')f.nodes.delete('youtube-body');else f.el('youtube-body').value='x'.repeat(33000);
  f.copy();await tick();assert.deepEqual(f.calls,[]);assert.equal(f.el('tabDraftManualCopy').value,'');assert.match(f.el('tabDraftCopyStatus').textContent,/nichts kopiert/);
 }
});
test('repeated checkpoint failures add no duplicate actions, clipboard reads, requests or persistence',async()=>{
 const f=fixture(),before=new Map(f.entries);for(let i=0;i<5;i++)f.fail();
 assert.equal(f.win.document.querySelector('main').children.filter(n=>n.id==='tabDraftStorageActions').length,1);
 assert.equal(f.calls.length,0);f.copy();await tick();assert.deepEqual(f.entries,before);
 assert.doesNotMatch(source,/clipboard\s*\.\s*read|execCommand|localStorage|\bfetch\s*\(/);
});

test('desktop and mobile can copy or manually rescue current text with the actual notice and page styles',async()=>{
 const runtime=process.env.SMA_TEST_PLAYWRIGHT?pathToFileURL(process.env.SMA_TEST_PLAYWRIGHT).href:'./dom-runtime/node_modules/playwright-core/index.mjs';
 const {chromium}=await import(runtime);
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome',args:process.env.SMA_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]});
 const html=fs.readFileSync('app/publication-preview.html','utf8');
 const styles=[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
 try{for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
  const page=await context.newPage(),external=[],errors=[];page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{external.push(route.request().url());return route.abort();});
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width"><style>'+styles+'</style><body class="portal-mode"><main><p id="saveStatus">Speicherstand bei SMA ungeklärt.</p><label>Titel<input id="youtube-title"></label><label>Beitrag<textarea id="youtube-body"></textarea></label><label>Hashtags<input id="youtube-hashtags"></label><label>Inhalt<textarea id="source_text"></textarea></label></main></body>');
  await page.evaluate(({source,current,v})=>{
   window.copyCalls=[];window.copyMode='success';
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:text=>{copyCalls.push(text);return copyMode==='success'?Promise.resolve():Promise.reject(Error('permission denied'));}}});
   for(const [name,value]of [['youtube-title',current.title],['youtube-body',current.body],['youtube-hashtags',current.tags],['source_text',current.description]])document.getElementById(name).value=value;
   window.fixtureOwner=v.owner;window.fixtureRecord=v;
   const win={document,navigator,setTimeout:setTimeout.bind(window),clearTimeout:clearTimeout.bind(window),sessionStorage:{getItem:()=>null,setItem(){throw Error('simulated quota');},removeItem(){}}};
   window.fixtureStore=Function('win',source.replace('export function tabDraftStore','function tabDraftStore')+';return tabDraftStore(win)')(win);fixtureStore.write(v);
  },{source,current,v:record()});
  const action=page.getByRole('button',{name:'Aktuelle Texte kopieren'});
  assert.equal(await action.isVisible(),true);assert.deepEqual(await page.evaluate(()=>copyCalls),[]);
  if(mobile)await action.tap();else{await action.focus();await page.keyboard.press('Enter');}
  await page.waitForFunction(()=>document.getElementById('tabDraftCopyStatus').textContent.includes('Texte vom Klick kopiert'));
  assert.deepEqual(await page.evaluate(()=>copyCalls),[expected]);
  const later='Später bearbeiteter Text 🧪';await page.locator('#youtube-body').fill(later);
  await page.evaluate(()=>{copyMode='reject';});await action.click();
  const manual=page.getByRole('textbox',{name:'Aktuelle Texte zum manuellen Kopieren'});await manual.waitFor({state:'visible'});
  assert.equal(await manual.inputValue(),expected.replace(current.body,later));assert.equal(await page.locator('#youtube-body').inputValue(),later);
  assert.equal(await page.evaluate(()=>document.activeElement===document.getElementById('tabDraftManualCopy')),true);
  assert.equal(await page.evaluate(()=>{const el=document.getElementById('tabDraftManualCopy');return el.selectionStart===0&&el.selectionEnd===el.value.length;}),true);
  assert.equal(await page.locator('#saveStatus').textContent(),'Speicherstand bei SMA ungeklärt.');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>fixtureStore.clearOwner(fixtureOwner));assert.equal(await action.isVisible(),false);assert.equal(await page.locator('#tabDraftManualCopy').inputValue(),'');
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);await context.close();
 }}finally{await browser.close();}
});
