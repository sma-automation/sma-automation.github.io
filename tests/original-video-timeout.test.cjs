const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const moduleSource=fs.readFileSync('app/assets/original-video-preview.mjs','utf8');
const source=moduleSource.replace(/^export /gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const file={id:'own-video',revision:'original-1',media_kind:'video',mime_type:'video/mp4',size_bytes:12,duration_ms:10000};
const blob=()=>new Blob([new Uint8Array(12)],{type:'video/mp4'});
function fixture({hold=null}={}){
 let holdPhase=hold,account='first',ownerReads=0,clock=0,nextTimer=0,fail=null;
 const calls=[],held=[],signals=[],created=[],revoked=[],ready=[],timers=new Map(),elements=[];
 const stage=(name,value)=>{
  calls.push(name);
  if(holdPhase===name){holdPhase=null;return new Promise((resolve,reject)=>held.push({resolve,reject,value}));}
  return fail===name?Promise.reject(Error('fixture outage')):Promise.resolve(value);
 };
 const doc={createElement(tag){
  const el={tag,style:{},hidden:false,disabled:false,textContent:'',handlers:{},children:[],attrs:{},paused:true,
   setAttribute(name,value){this.attrs[name]=value;},removeAttribute(name){delete this.attrs[name];if(name==='src')this.src='';},
   addEventListener(name,fn){this.handlers[name]=fn;},append(...children){this.children.push(...children);},
   pause(){this.paused=true;},load(){},play(){assert.fail('Preview must not autoplay');}};
  elements.push(el);return el;
 }};
 const env={AbortController,Blob,URL,
  setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timers.delete(id)};
 const mount=vm.runInNewContext(source+'\nmountOriginalVideo',env);
 const host=doc.createElement('host'),thumb=doc.createElement('thumb');
 const view=mount({doc,host,thumbnailHost:thumb,expectedOwnerId:'first',
  getOwnerId:()=>stage(++ownerReads===1?'owner-first':'owner-final',account),
  source:(selected,signal)=>{assert.equal(selected.id,file.id);signals.push(signal);return stage('source',blob());},
  createURL:value=>{created.push(value);return 'blob:fixture-'+created.length;},revokeURL:url=>revoked.push(url),
  onReadyChange:value=>ready.push(value)});
 const button=elements.find(e=>e.tag==='button'),video=elements.find(e=>e.tag==='video'),status=elements.find(e=>e.tag==='p'),box=host.children[0];
 view.setContext(file);
 return {view,button,video,status,box,thumb,calls,held,signals,created,revoked,ready,timers,
  click(){ownerReads=0;return button.handlers.click();},hold:phase=>{holdPhase=phase;},owner:id=>{account=id;},fail:phase=>{fail=phase;},
  async advance(ms){clock+=ms;for(const [id,t] of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}await tick();},
  async release(index=0,error=false){const h=held[index];assert.ok(h);if(error)h.reject(Error('late fixture error'));else h.resolve(h.value);await tick();}
 };
}
for(const hold of ['owner-first','source','owner-final'])test('original preview bounds stalled '+hold+' and permits an explicit retry',async()=>{
 const f=fixture({hold});let done=false;const run=f.click().then(()=>{done=true;});await tick();
 assert.equal(f.held.length,1);assert.equal(f.button.disabled,true);
 await f.advance(179999);assert.equal(done,false);await f.advance(1);
 assert.equal(done,true,'the whole original preview must finish within its existing 180-second source allowance');await run;
 assert.equal(f.button.disabled,false);assert.equal(f.button.hidden,false);assert.equal(f.video.hidden,true);
 assert.equal(f.created.length,0);assert.equal(f.thumb.style.display,'');assert.match(f.status.textContent,/dauert gerade zu lange/);
 assert.equal(f.timers.size,0);for(const signal of f.signals)assert.equal(signal.aborted,true);
 const count=f.calls.length;await f.release();assert.equal(f.calls.length,count);assert.equal(f.created.length,0);
 await f.click();assert.equal(f.video.hidden,false);assert.equal(f.created.length,1);assert.equal(f.timers.size,0);
 assert.equal(f.video.paused,true);assert.equal(f.video.autoplay,undefined);f.view.destroy();assert.equal(f.revoked.length,1);
});
test('owner, source and final ownership share one deadline rather than restarting it',async()=>{
 const f=fixture({hold:'owner-first'});const run=f.click();await tick();await f.advance(170000);
 f.hold('owner-final');await f.release();assert.equal(f.held.length,2);assert.equal(f.timers.size,1);
 await f.advance(10000);await run;assert.equal(f.created.length,0);assert.equal(f.button.disabled,false);
 await f.release(1);assert.equal(f.created.length,0);assert.match(f.status.textContent,/zu lange/);
});
test('late old success or failure cannot render a video or unlock a newer attempt',async()=>{
 for(const hold of ['owner-first','source','owner-final'])for(const error of [false,true]){
  const f=fixture({hold});let done=false;const old=f.click().then(()=>{done=true;});await tick();await f.advance(180000);
  assert.equal(done,true);await old;f.hold('source');const fresh=f.click();await tick();assert.equal(f.held.length,2);
  const count=f.calls.length;await f.button.handlers.click();assert.equal(f.calls.length,count);
  await f.release(0,error);assert.equal(f.button.disabled,true);assert.equal(f.created.length,0);assert.equal(f.timers.size,1);
  await f.release(1);await fresh;assert.equal(f.created.length,1);assert.equal(f.video.hidden,false);assert.equal(f.timers.size,0);f.view.destroy();
 }
});
test('selection changes, sign-out and destroy cancel every hanging phase immediately',async()=>{
 for(const hold of ['owner-first','source','owner-final'])for(const action of ['select','signout','destroy']){
  const f=fixture({hold});let done=false;const run=f.click().then(()=>{done=true;});await tick();
  if(action==='select')f.view.setContext({...file,revision:'original-2'});
  else if(action==='signout')f.view.invalidateOwner(null);
  else f.view.destroy();
  await tick();assert.equal(done,true,'cancellation must settle without waiting for the original operation');await run;
  assert.equal(f.timers.size,0);assert.equal(f.created.length,0);assert.equal(f.video.hidden,true);
  if(action!=='select')assert.equal(f.box.hidden,true);
  await f.release();assert.equal(f.created.length,0);assert.equal(f.status.textContent,'');
 }
});
test('a retry rechecks the owner; missing or changed ownership never exposes bytes',async()=>{
 for(const account of [null,'second']){
  const f=fixture({hold:'source'});let done=false;const run=f.click().then(()=>{done=true;});await tick();await f.advance(180000);
  assert.equal(done,true);await run;f.owner(account);await f.click();await f.release();
  assert.equal(f.created.length,0);assert.equal(f.box.hidden,true);assert.equal(f.timers.size,0);
 }
 const f=fixture({hold:'source'});const run=f.click();await tick();f.owner('second');await f.release();await run;
 assert.equal(f.created.length,0);assert.equal(f.box.hidden,true);assert.equal(f.timers.size,0);
});
test('failed sources and normal playback preserve existing messages, poster and URL cleanup',async()=>{
 const f=fixture();f.fail('source');await f.click();assert.match(f.status.textContent,/nicht geladen/);
 assert.equal(f.button.disabled,false);assert.equal(f.timers.size,0);
 f.fail(null);await f.click();f.view.setPoster(file,'blob:cover');assert.equal(f.video.attrs.poster,'blob:cover');
 f.video.handlers.loadeddata();assert.equal(f.ready.at(-1),true);
 f.view.stop();assert.equal(f.video.paused,true);assert.equal(f.revoked.length,0);
 f.video.handlers.error();assert.equal(f.video.hidden,true);assert.equal(f.button.hidden,false);assert.equal(f.revoked.length,1);
 assert.match(f.status.textContent,/nicht abspielen/);f.view.destroy();assert.equal(f.revoked.length,1);
});

const browserRuntime='./dom-runtime/node_modules/playwright-core/index.mjs';
test('desktop and mobile original-preview buttons recover and ignore late replies using actual DOM',
 {skip:!fs.existsSync('tests/'+browserRuntime)?'Browser runtime is installed in CI':false,timeout:60000},async()=>{
 const {chromium}=await import(browserRuntime);
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
 const bootstrap=`
 const f=window.originalFixture={hold:null,held:[],owners:0,calls:[],created:0};
 f.stage=(name,value)=>{f.calls.push(name);if(f.hold===name){f.hold=null;return new Promise(resolve=>f.held.push(()=>resolve(value)));}return Promise.resolve(value);};
 const testFile=${JSON.stringify(file)};
 const view=window.originalView=mountOriginalVideo({doc:document,host:document.querySelector('main'),thumbnailHost:document.querySelector('#thumb'),
  expectedOwnerId:'first',getOwnerId:()=>f.stage(++f.owners===1?'owner-first':'owner-final','first'),
  source:(_file,signal)=>{f.signal=signal;return f.stage('source',new Blob([new Uint8Array(12)],{type:'video/mp4'}));},
  createURL:()=>{f.created++;return '';},revokeURL(){}});
 view.setContext(testFile);`;
 try{
  for(const mobile of [false,true])for(const hold of ['owner-first','source','owner-final']){
   const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
   try{
    const page=await context.newPage(),requests=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
    await page.setContent('<style>[hidden]{display:none!important}</style><main><div id="thumb">Vorschaubild</div></main>');await page.clock.install();
    await page.addScriptTag({content:source+'\n'+bootstrap});
    await page.evaluate(hold=>{originalFixture.hold=hold;},hold);
    const button=page.getByRole('button',{name:'Originalvideo laden',exact:true});
    if(mobile)await button.tap();else await button.click();await page.waitForFunction(()=>originalFixture.held.length===1);
    assert.equal(await button.isDisabled(),true);await page.clock.fastForward(180001);
    await page.getByText(/Das Laden des Originalvideos dauert gerade zu lange/).waitFor();assert.equal(await button.isEnabled(),true);
    assert.equal(await page.locator('video').isHidden(),true);assert.equal(await page.locator('#thumb').isVisible(),true);
    await page.evaluate(()=>{originalFixture.owners=0;originalFixture.hold='source';});
    if(mobile)await button.tap();else await button.click();await page.waitForFunction(()=>originalFixture.held.length===2);
    await page.evaluate(()=>originalFixture.held[0]());assert.equal(await button.isDisabled(),true);
    assert.equal(await page.evaluate(()=>originalFixture.created),0);
    await page.evaluate(()=>originalView.setContext(null));await page.evaluate(()=>originalFixture.held[1]());
    assert.equal(await page.locator('#originalVideoPreview').isHidden(),true);assert.equal(await page.evaluate(()=>originalFixture.created),0);
    assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
   }finally{await context.close();}
  }
 }finally{await browser.close();}
});
