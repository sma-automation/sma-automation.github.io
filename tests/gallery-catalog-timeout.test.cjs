const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('app/dashboard.html','utf8');
const start=html.includes('function readCatalogWithin(')?html.indexOf('function readCatalogWithin('):html.indexOf('async function catalogSession(');
const code=html.slice(start,html.indexOf('function retryCatalog()',start));
const clearCode=html.match(/clear\(\)\{cancelReload\(\);disposed=true;[^\n]+/)[0].replace(/^clear\(\)/,'function disposeCatalog()').replace(/\}\};\s*$/,'}');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const oldFiles=[{id:'previous-file',name:'Vorherige Datei'}];
function setup({hold=null,withCatalog=true,syncState='complete'}={}){
 let holdStage=hold,clock=0,next=0,sessionCount=0,account='first',failure=null;
 const calls=[],held=[],signals=[],timers=new Map(),redirects=[],draws=[],notes=[];
 let nextFiles=[{id:'new-file',name:'Neue Datei'}];
 const stage=(name,value)=>{
  calls.push(name);
  if(holdStage===name){holdStage=null;return new Promise((resolve,reject)=>held.push({resolve,reject,value}));}
  if(failure===name)return Promise.reject(Error('fixture failure'));
  return Promise.resolve(value);
 };
 const env={AbortController,AbortSignal,disposed:false,signedOut:false,owner:'first',dashboardOwnerId:'first',
  catalogController:null,loading:false,catalogState:withCatalog?'ready':'loading',files:withCatalog?oldFiles.slice():[],hasCatalog:withCatalog,
  lastSync:0,retryStep:null,scanRunning:false,folderNotice:'',selectedFileId:withCatalog?'previous-file':null,
  interruptedNotice:'Der Ordnerabgleich wurde nicht abgeschlossen.',runningNotice:'Ein Ordnerabgleich läuft bereits.',rateLimitNotice:'Bitte warte kurz.',
  refresh:{textContent:'Dateien aktualisieren',disabled:false},dashboardQuickFind:{refresh(){}},
  say:text=>notes.push(text),draw:()=>draws.push(env.files.slice()),finishReload:()=>false,wakeMusic:()=>calls.push('music'),
  customerMediaEndpoint:kind=>{assert.equal(kind,'catalog');return 'https://fixture.invalid/catalog';},
  dashboardSession:read=> (read||((fn)=>fn()))(()=>stage(++sessionCount===1?'session-first':'session-final',{user:{id:account},access_token:'fixture'})),
  leaveDashboard(){env.signedOut=true;env.disposeCatalog();redirects.push('index.html');},
  cancelReload(){},soundtrack:{destroy(){}},doc:{removeEventListener(){}},thumbnails:{clear(){}},thumbnailClient:{dispose(){}},
  setTimeout:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:clock+delay});return id;},clearTimeout:id=>timers.delete(id),
  supabase:{rpc:(name,args)=>{
   assert.equal(name,'sma_publication_files_v1');assert.equal(JSON.stringify(args),JSON.stringify({p_action:'list',p_input:{dashboard_labels:true}}));
   const request={then:(yes,no)=>stage('catalog',{data:{ok:true,files:nextFiles,sync_state:syncState},error:null}).then(yes,no),
    abortSignal(signal){signals.push(signal);return this;}};
   return request;
  }},
  fetch:(url,options)=>{
   assert.equal(url,'https://fixture.invalid/catalog');assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,'Bearer fixture');
   assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
   signals.push(options.signal);
   return stage('http',{ok:true,json:()=>stage('body',{ok:true})});
  }
 };
 vm.createContext(env);vm.runInContext(code+'\n'+clearCode,env);
 return {env,calls,held,signals,timers,redirects,draws,notes,
  load:sync=>{sessionCount=0;return env.load(sync);},hold:name=>{holdStage=name;},fail:name=>{failure=name;},
  files:value=>{nextFiles=value;},owner:value=>{account=value;},
  async advance(ms){clock+=ms;for(const [id,timer] of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}await flush();},
  async release(index=0,error=false){const h=held[index];assert.ok(h);if(error)h.reject(Error('late fixture error'));else h.resolve(h.value);await flush();},
  dispose:()=>env.disposeCatalog()
 };
}
for(const [phase,sync,limit] of [['catalog',false,15000],['session-first',false,15000],['session-first',true,90000],
 ['http',true,90000],['body',true,90000],['catalog',true,90000],['session-final',true,90000]]){
 test('file list releases stalled '+phase+' (folder sync '+sync+') without losing its previous files',async()=>{
  const f=setup({hold:phase});let finished=false;const run=f.load(sync).then(()=>{finished=true;});await flush();
  assert.equal(f.held.length,1);assert.equal(f.env.refresh.disabled,true);
  await f.advance(limit-1);assert.equal(finished,false);
  await f.advance(1);assert.equal(finished,true,'stalled catalogue must finish at its deadline');await run;
  assert.equal(f.env.refresh.disabled,false);assert.equal(f.env.catalogState,'error');assert.deepEqual(f.env.files,oldFiles);
  assert.equal(f.env.selectedFileId,'previous-file');assert.equal(f.draws.length,0);assert.equal(f.timers.size,0);
  assert.match(f.notes.at(-1),/zu lange|erneut/);assert.ok(!f.calls.includes('music'));
  for(const signal of f.signals)assert.equal(signal.aborted,true);
  const count=f.calls.length;await f.release();assert.equal(f.calls.length,count);assert.deepEqual(f.env.files,oldFiles);
  await f.load(false);assert.equal(f.env.catalogState,'ready');assert.equal(f.env.files[0].id,'new-file');assert.equal(f.timers.size,0);
 });
}
test('a first failed list remains unknown rather than claiming an empty folder',async()=>{
 const f=setup({hold:'catalog',withCatalog:false});const run=f.load(false);await flush();await f.advance(15000);await run;
 assert.equal(f.env.hasCatalog,false);assert.equal(f.env.catalogState,'error');assert.equal(f.env.refresh.textContent,'Dateiliste erneut laden');
 assert.equal(f.draws.length,0);assert.equal(f.env.refresh.disabled,false);await f.release();assert.equal(f.env.hasCatalog,false);
});
test('all phases share the folder deadline; a successful folder response cannot reset it',async()=>{
 const f=setup({hold:'http'});const run=f.load(true);await flush();await f.advance(89999);
 f.hold('catalog');await f.release();assert.equal(f.held.length,2);assert.equal(f.timers.size,1);
 await f.advance(1);await run;assert.equal(f.env.refresh.textContent,'Dateiliste erneut laden');
 assert.deepEqual(f.env.files,oldFiles);await f.release(1);assert.deepEqual(f.env.files,oldFiles);
});
test('late old success and rejection cannot replace or unlock a newer catalogue request',async()=>{
 for(const error of [false,true]){
  const f=setup({hold:'catalog'});const a=f.load(false);await flush();await f.advance(15000);await a;
  f.hold('catalog');f.files([{id:'newer-file'}]);const b=f.load(false);await flush();const count=f.calls.length;
  await f.load(false);assert.equal(f.calls.length,count);
  await f.release(0,error);assert.equal(f.env.refresh.disabled,true);assert.equal(f.env.loading,true);assert.deepEqual(f.env.files,oldFiles);
  await f.release(1);await b;assert.equal(f.env.files[0].id,'newer-file');assert.equal(f.env.refresh.disabled,false);
  assert.equal(f.timers.size,0);
 }
});
test('disposing the actual file-list controller cancels requests and prevents later rendering',async()=>{
 for(const [hold,sync] of [['catalog',false],['session-first',true],['http',true],['body',true]]){
  const f=setup({hold});let finished=false;const run=f.load(sync).then(()=>{finished=true;});await flush();
  f.dispose();await flush();assert.equal(finished,true);await run;assert.equal(f.timers.size,0);
  assert.equal(f.env.disposed,true);const count=f.calls.length;await f.release();assert.equal(f.calls.length,count);
  assert.equal(f.draws.length,0);assert.ok(!f.calls.includes('music'));
 }
});
test('a changed account cannot adopt a catalogue response, including after a retry',async()=>{
 const f=setup({hold:'catalog'});const run=f.load(false);await flush();f.owner('second');await f.release();await run;
 assert.deepEqual(f.redirects,['index.html']);assert.deepEqual(f.env.files,oldFiles);assert.equal(f.draws.length,0);assert.equal(f.timers.size,0);
});
test('ordinary success and transport failure retain the existing scoped read-only paths',async()=>{
 const f=setup();await f.load(true);assert.deepEqual(f.calls,['session-first','http','body','catalog','session-final','music']);
 assert.equal(f.env.catalogState,'ready');assert.equal(f.env.folderNotice,'');assert.equal(f.timers.size,0);
 f.fail('catalog');const previous=f.env.files;await f.load(false);
 assert.equal(f.env.files,previous);assert.equal(f.env.refresh.textContent,'Dateiliste erneut laden');assert.equal(f.env.refresh.disabled,false);
 assert.equal(f.timers.size,0);
});

const browserRuntime='./dom-runtime/node_modules/playwright-core/index.mjs';
test('desktop and mobile gallery retain the last complete list and recover after a stalled catalogue or folder read',
 {skip:!fs.existsSync('tests/'+browserRuntime)?'Pinned browser runtime is installed in CI':false,timeout:60000},async()=>{
 const {chromium}=await import(browserRuntime);
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
 const attach=html.slice(html.indexOf('function attachFileList('),html.indexOf('\nlet pending;'));
 const session=html.slice(html.indexOf('async function dashboardSession('),html.indexOf('async function dashboardHtml('));
 const helpers=fs.readFileSync('app/assets/file-description.mjs','utf8').replace(/export /g,'')+'\n'+
  fs.readFileSync('app/assets/dashboard-file-search.mjs','utf8').replace(/^import[^\n]*\n/,'').replace(/export /g,'');
 try{
  for(const mobile of [false,true])for(const phase of ['catalog','session','http','body']){
   const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
   try{
    const page=await context.newPage(),errors=[],requests=[];
    page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
    await page.setContent('<main id="publishingFilesSlot"></main>');await page.clock.install();
    const bootstrap=`
     let dashboardOwnerId='first',signedOut=false,selectedFileId=null,dashboardQuickFind=null;
     const portalNames={youtube:'YouTube',tiktok:'TikTok',instagram:'Instagram',facebook:'Facebook'};
     const connectionError=message=>Error(message);
     const galleryVisible=()=>false;
     const customerMediaEndpoint=kind=>{if(kind!=='catalog')throw Error('unexpected route');return 'fixture:catalog';};
     const createSharedThumbnailClient=()=>({dispose(){}});
     const createMediaThumbnailLoader=()=>({reset(){},observe(){},clear(){}});
     const mountGalleryMusic=()=>({wake(){},destroy(){}});
     const leaveDashboard=()=>{signedOut=true;window.gallery.clear();};
     const f=window.catalogFixture={hold:null,held:[],calls:[],suffix:'Alt'};
     f.stage=(name,value)=>{f.calls.push(name);if(f.hold===name){f.hold=null;return new Promise(resolve=>f.held.push(()=>resolve(value)));}return Promise.resolve(value);};
     const supabase={auth:{getSession:()=>f.stage('session',{data:{session:{user:{id:'first'},access_token:'fixture'}}})},
      rpc:(name,args)=>{if(name!=='sma_publication_files_v1'||args.p_action!=='list')throw Error('unexpected RPC');
       return {abortSignal(){return f.stage('catalog',{data:{ok:true,sync_state:'complete',files:[{id:'own-file',revision:'own-revision',name:f.suffix+' Datei.mp4',media_kind:'video',modified_at:'2026-11-15T12:00:00Z',assignments:[]}]},error:null});}}}};
     window.fetch=(url,options)=>{if(url!=='fixture:catalog'||options.method!=='POST')throw Error('unexpected request');return f.stage('http',{ok:true,json:()=>f.stage('body',{ok:true})});};
    `;
    await page.addScriptTag({content:bootstrap+'\n'+helpers+'\n'+session+'\n'+attach+'\nwindow.gallery=attachFileList(document,document.body,"editor.html");'});
    await page.getByRole('button',{name:/Datei auswählen: Alt Datei/}).waitFor();
    const sync=['http','body'].includes(phase);
    await page.evaluate(({phase,sync})=>{catalogFixture.hold=phase;void gallery.load(sync);},{phase,sync});
    await page.waitForFunction(()=>catalogFixture.held.length===1);
    await page.clock.fastForward(sync?90001:15001);
    const retry=page.getByRole('button',{name:sync?'Dateien aktualisieren':'Dateiliste erneut laden',exact:true});
    await retry.waitFor();assert.equal(await retry.isEnabled(),true);
    assert.equal(await page.getByRole('button',{name:/Datei auswählen: Alt Datei/}).count(),1);
    assert.equal(await page.evaluate(()=>gallery.getCatalogState()),'error');
    await page.evaluate(()=>{catalogFixture.suffix='Neu';catalogFixture.hold='catalog';});
    if(mobile)await retry.tap();else await retry.click();
    await page.waitForFunction(()=>catalogFixture.held.length===2);
    await page.evaluate(()=>catalogFixture.held[0]());assert.equal(await retry.isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:/Datei auswählen: Alt Datei/}).count(),1);
    await page.evaluate(()=>catalogFixture.held[1]());
    await page.getByRole('button',{name:/Datei auswählen: Neu Datei/}).waitFor();
    assert.equal(await page.evaluate(()=>gallery.getCatalogState()),'ready');
    assert.equal(await page.getByRole('button',{name:'Dateien aktualisieren',exact:true}).isEnabled(),true);
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
   }finally{await context.close();}
  }
 }finally{await browser.close();}
});
