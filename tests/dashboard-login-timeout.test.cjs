const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('app/dashboard.html','utf8');
const source=html.slice(html.indexOf('let pending;'),html.indexOf('async function logout(){'))+
 html.slice(html.indexOf('async function logout(){'),html.indexOf("document.getElementById('retry').addEventListener"))+
 html.slice(html.indexOf('function leaveDashboard(){'),html.indexOf('await load();'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const order='60600000-0000-4000-8000-000000000011';
const shell='<body data-sma-customer-id="fixture"><p>Mein Kundenbereich</p></body>';
let tabDraftStore;
test.before(async()=>{({tabDraftStore}=await import('../app/assets/publication-tab-draft.mjs'));});

function setup({hold=null,status=200,paused=null,onboarding=false,pilot=false,sessionStorage=null,onTeardown=()=>{}}={}){
 let owner='first',phase='initial',holdStage=hold,authHandler,clock=0,next=0;
 const calls=[],signals=[],held=[],redirects=[],timers=new Map(),nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',srcdoc:'',
  removeAttribute(name){this[name]='';}});return nodes.get(id);};
 const stage=(name,value)=>{
  calls.push(name);
  if(holdStage===name){holdStage=null;return new Promise((resolve,reject)=>held.push({resolve,reject,value}));}
  return Promise.resolve(value);
 };
 const client={auth:{
  getSession:()=>stage(phase,{data:{session:owner?{user:{id:owner},access_token:owner}:null}}),
  onAuthStateChange:fn=>{authHandler=fn;},signOut:async()=>{onTeardown('sign-out');return {error:null};}
 },rpc:(name,args)=>({abortSignal(signal){
  signals.push(signal);
  if(name==='sma_customer_media_pilot_v1'){assert.equal(args.p_route,'eligible');return stage('pilot',{data:{ok:true}});}
  if(name==='sma_onboarding_paused_booking_v1'){assert.equal(args,undefined);return stage('paused',{data:paused});}
  assert.equal(name,'sma_onboarding_plan_choice_v1');assert.equal(args.p_owner,'first');
  return stage('plan',{data:{ok:onboarding}});
 }})};
 const env={AbortController,AbortSignal,URLSearchParams,Response,supabase:client,
  clearSharedThumbnailCache(){calls.push('clear-thumbnail-cache');},
  clearSharedOriginalMediaCache(){calls.push('clear-original-cache');},
  document:{getElementById:node,documentElement:{dataset:{}}},
  window:{sessionStorage,location:{replace:path=>{onTeardown('redirect');redirects.push(path);}}},location:{search:pilot?'?kundenmedien=pilot':''},
  endpoint:'https://fixture.invalid/dashboard',dashboardOwnerId:null,startupView:null,
  galleryReload:{take(){return null;},clear(){}},previewMatchesHistory:()=>false,history:{state:null},
  clearOptimizer(){onTeardown('remove-editors');},frame:node('dashboard'),state:node('state'),
  setTimeout:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:clock+delay});return id;},clearTimeout:id=>timers.delete(id),
  fetch:(url,options)=>{
   assert.equal(url,'https://fixture.invalid/dashboard');assert.equal(options.method,'POST');
   assert.equal(options.headers.Authorization,'Bearer first');assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');
   signals.push(options.signal);phase='final';
   return stage('shell',{ok:status===200,status,json:()=>stage('body',{html:shell})});
  }
 };
 env.publicationDrafts=tabDraftStore(env.window);
 for(const key of ['dashboardMobileNav','dashboardQuickFind','dashboardCloudUpload','musicLibraryDashboard','mediaEditorEntry',
 'dashboardChapters','publicationHistory','customerWebsiteDashboard','companyProfileDashboard','websitePreparation','fileView'])env[key]=null;
 vm.createContext(env);vm.runInContext(source,env);
 return {node,calls,signals,held,redirects,timers,
  start(){phase='initial';return env.load();},raw(){phase='initial';return env.dashboardHtml();},
  hold:name=>{holdStage=name;},setStatus:value=>{status=value;},setPaused:value=>{paused=value;},setOnboarding:value=>{onboarding=value;},
  owner:id=>{owner=id;},active:()=>vm.runInContext('dashboardReads.size',env),retryable:()=>vm.runInContext('retryDashboardOnReconnect',env),
  async advance(ms){clock+=ms;for(const [id,timer] of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}await flush();},
  async release(index=0,error=false){const job=held[index];assert.ok(job);if(error)job.reject(Error('late fixture failure'));else job.resolve(job.value);await flush();},
  async auth(event,id){owner=id;authHandler(event,id?{user:{id}}:null);await flush();},
  logout:()=>env.logout()
 };
}

for(const [name,config] of [
 ['initial session',{hold:'initial'}],['dashboard HTTP',{hold:'shell'}],['JSON body',{hold:'body'}],
 ['paused booking',{hold:'paused',status:403}],['plan lookup',{hold:'plan',status:403}],
 ['private pilot',{hold:'pilot',pilot:true}],['final active session',{hold:'final'}],
 ['final paused session',{hold:'final',status:403,paused:order}],
 ['final plan session',{hold:'final',status:403,onboarding:true}]
])test('normal login bounds a stalled '+name+' and leaves a usable retry',async()=>{
 const f=setup(config);let finished=false;const run=f.start().then(()=>{finished=true;});await flush();
 assert.equal(f.held.length,1);assert.equal(f.node('retry').hidden,true);
 await f.advance(44999);assert.equal(finished,false);
 await f.advance(1);assert.equal(finished,true,'whole login must stop at 45 seconds');await run;
 assert.match(f.node('message').textContent,/dauert gerade zu lange/);assert.equal(f.node('retry').hidden,false);
 assert.equal(f.node('dashboard').hidden,true);assert.equal(f.node('dashboard').srcdoc,'');
 assert.equal(f.retryable(),true);assert.deepEqual(f.redirects,[]);assert.equal(f.timers.size,0);assert.equal(f.active(),0);
 for(const signal of f.signals)assert.equal(signal.aborted,true);
 const before=f.calls.length;await f.release();assert.equal(f.calls.length,before);assert.deepEqual(f.redirects,[]);
 f.setStatus(200);await f.start();assert.equal(f.node('dashboard').srcdoc,shell);assert.equal(f.node('dashboard').hidden,false);
 assert.equal(f.timers.size,0);assert.equal(f.active(),0);
});

test('all stages share one deadline instead of resetting the budget after a slow response',async()=>{
 const f=setup({hold:'initial'});const run=f.start();await flush();await f.advance(40000);
 f.hold('body');await f.release();assert.equal(f.held.length,2);assert.equal(f.timers.size,1);
 await f.advance(5000);await run;assert.match(f.node('message').textContent,/dauert gerade zu lange/);
 await f.release(1);assert.equal(f.node('dashboard').srcdoc,'');assert.deepEqual(f.redirects,[]);
});

test('late old replies cannot mount, redirect or finish a newer attempt; repeated retry clicks stay single-flight',async()=>{
 for(const old of [{hold:'shell'},{hold:'paused',status:403,paused:order},{hold:'plan',status:403,onboarding:true}]){
  const f=setup(old);const first=f.start();await flush();await f.advance(45000);await first;
  f.setStatus(200);f.hold('shell');const second=f.start();await flush();const calls=f.calls.length;
  const duplicate=f.start();await flush();assert.equal(f.calls.length,calls);
  await f.release();assert.deepEqual(f.redirects,[]);assert.equal(f.node('dashboard').srcdoc,'');
  assert.equal(f.node('retry').hidden,true);assert.equal(f.active(),1);assert.equal(f.timers.size,1);
  await f.release(1);await Promise.all([second,duplicate]);assert.equal(f.node('dashboard').srcdoc,shell);
  assert.equal(f.timers.size,0);assert.equal(f.active(),0);
 }
});

test('late rejections are consumed and never replace the next successful login',async()=>{
 for(const hold of ['initial','shell','body','final']){
  const f=setup({hold});const run=f.start();await flush();await f.advance(45000);await run;
  await f.start();assert.equal(f.node('dashboard').srcdoc,shell);
  await f.release(0,true);assert.equal(f.node('dashboard').srcdoc,shell);assert.deepEqual(f.redirects,[]);
 }
});

test('actual sign-out and account-change handlers cancel every pending dashboard read without waiting for timeout',async()=>{
 for(const [event,id] of [['SIGNED_OUT',null],['SIGNED_IN','second']]){
  const f=setup({hold:'shell'});let finished=false;const run=f.start().then(()=>{finished=true;});await flush();
  await f.auth(event,id);await run;assert.equal(finished,true);
  assert.equal(f.active(),0);assert.equal(f.timers.size,0);assert.deepEqual(f.redirects,['index.html']);
  for(const signal of f.signals)assert.equal(signal.aborted,true);
  await f.release();assert.equal(f.node('dashboard').srcdoc,'');assert.deepEqual(f.redirects,['index.html']);
 }
 const first=setup({hold:'initial'});const run=first.start();await flush();await first.logout();await run;
 assert.equal(first.timers.size,0);await first.release();assert.deepEqual(first.calls,['initial','clear-thumbnail-cache','clear-original-cache']);
 assert.deepEqual(first.redirects,['index.html']);
});

for(const departure of ['logout','account-change'])test(departure+': parent teardown purges previous-owner checkpoints after child pagehide without relying on child auth callbacks',async()=>{
 const rows=new Map(),sessionStorage={get length(){return rows.size;},key:i=>[...rows.keys()][i]??null,
  getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
 const drafts=tabDraftStore({sessionStorage}),id=n=>'60600000-0000-4000-8000-'+String(n).padStart(12,'0');
 const record=(n,owner,kind)=>({token:id(n),owner,portal:'youtube',route:JSON.stringify([null,id(n+1),null,null]),
  fileId:id(n+1),fileRevision:'version:1',previewId:id(n+2),assignment:4,revision:1,
  shop:'https://sma-automation.com/app/shop.html?shop=fixture',
  base:{title:'Gespeicherter Titel',body:'Die bisherige gespeicherte Fassung.',hashtags:[],product_id:null},
  ...(kind==='edit'?{kind}:{sent:{title:'Gespeicherter Titel',body:'Gesendete Fassung ohne Empfangsbestätigung.',hashtags:[],product_id:null}}),
  form:{title:'Lokaler Titel',body:'Die noch offene Bearbeitung '+n+'.',tags:'',source:{text:'Private Beschreibung '+n,language:'de'}}});
 const pending=record(701,'first'),editing=record(711,'first','edit'),foreign=record(721,'separate-owner','edit');
 let armed=false,removed=false;
 const remaining=record=>drafts.read(record.portal,record.owner,record.route);
 const f=setup({sessionStorage,onTeardown(stage){
  if(!armed)return;
  if(stage==='remove-editors'){
   removed=true;
   // A departing child can still perform its ordinary final pagehide checkpoint.
   drafts.write({...editing,token:id(731),form:{...editing.form,body:'Letzte Eingabe beim Entfernen des Editors.'}});
   return;
  }
  assert.equal(removed,true,'the owner purge must follow editor removal');
  assert.equal(remaining(pending),null,'the pending save checkpoint must be purged before '+stage);
  assert.equal(remaining(editing),null,'the final pagehide checkpoint must be purged before '+stage);
  assert.deepEqual(remaining(foreign),foreign,'another owner checkpoint must remain');
  assert.equal(sessionStorage.getItem('fixture.unrelated'),'behalten');
 }});
 await f.start();drafts.write(pending);drafts.write(editing);drafts.write(foreign);sessionStorage.setItem('fixture.unrelated','behalten');
 assert.equal(rows.size,4);armed=true;
 if(departure==='logout')await f.logout();else await f.auth('SIGNED_IN','second');
 assert.equal(f.calls.filter(call=>call==='clear-original-cache').length,1,'leaving the owner clears held original media');
 assert.equal(rows.size,2);assert.equal(remaining(pending),null);assert.equal(remaining(editing),null);
 assert.deepEqual(f.redirects,['index.html']);
});

test('owner changes without auth events still refuse active shell and both booking destinations',async()=>{
 for(const config of [{},{status:403,paused:order},{status:403,onboarding:true}]){
  const f=setup({...config,hold:'shell'});const run=f.start();await flush();f.owner('second');await f.release();await run;
  assert.deepEqual(f.redirects,['index.html']);assert.equal(f.node('dashboard').srcdoc,'');assert.equal(f.active(),0);
 }
});

test('separate OAuth shell reads keep independent deadlines but sign-out cancels both',async()=>{
 const f=setup({hold:'shell'});const a=f.raw().catch(e=>e);await flush();await f.advance(10000);
 f.hold('shell');const b=f.raw().catch(e=>e);await flush();assert.equal(f.active(),2);
 await f.advance(35000);assert.equal((await a).retryOnReconnect,true);assert.equal(f.active(),1);
 assert.equal(f.signals[0].aborted,true);assert.equal(f.signals[1].aborted,false);
 await f.auth('SIGNED_OUT',null);await b;assert.equal(f.signals[1].aborted,true);assert.equal(f.active(),0);
 await f.release(0);await f.release(1);assert.deepEqual(f.redirects,['index.html']);
});

test('valid active, paused, new, refused and private pilot routes retain existing decisions',async()=>{
 const active=setup();await active.start();assert.equal(active.node('dashboard').srcdoc,shell);assert.deepEqual(active.calls,['initial','shell','body','final']);
 for(const [config,path] of [[{status:403,paused:order},'paketwahl.html?buchung='+order],[{status:403,onboarding:true},'paketwahl.html']]){
  const f=setup(config);await f.start();assert.deepEqual(f.redirects,[path]);assert.equal(f.active(),0);assert.equal(f.timers.size,0);
 }
 const refused=setup({status:403});await refused.start();assert.match(refused.node('message').textContent,/zugeordnet/);assert.equal(refused.retryable(),false);
 const pilot=setup({pilot:true});await pilot.start();assert.equal(pilot.node('dashboard').srcdoc,shell);assert.ok(pilot.calls.includes('pilot'));assert.ok(!pilot.calls.includes('paused'));
 const signedOut=setup();signedOut.owner(null);await signedOut.start();assert.deepEqual(signedOut.redirects,['index.html']);assert.deepEqual(signedOut.calls,['initial']);
});

const browserRuntime='./dom-runtime/node_modules/playwright-core/index.mjs';
test('desktop and mobile login retry remains usable after stalled auth, HTTP, body and booking lookups',
 {skip:!fs.existsSync('tests/'+browserRuntime)?'Pinned browser runtime is installed in GitHub CI':false,timeout:90000},async()=>{
 const {chromium}=await import(browserRuntime);
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
 const site='https://sma.test';
 const fake=`export function createClient(){
  const f=window.dashboardFixture;
  return {auth:{getSession:()=>{const phase=++f.sessions===1?'initial':'final';return f.stage(phase,{data:{session:{user:{id:'fixture'},access_token:'fixture'}}});},
   onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},signOut:async()=>({error:null})},
   rpc:(name,args)=>({abortSignal(signal){f.signals.push(signal);if(name==='sma_onboarding_paused_booking_v1')return f.stage('paused',{data:f.paused});
    if(name==='sma_onboarding_plan_choice_v1')return f.stage('plan',{data:{ok:true}});
    if(name==='sma_customer_media_pilot_v1')return f.stage('pilot',{data:{ok:true}});
    throw Error('Unexpected RPC '+name);}})};
 }`;
 try{
  for(const mobile of [false,true])for(const hold of ['initial','shell','body','paused','plan','final','pilot']){
   const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
   try{
    const page=await context.newPage(),errors=[],unexpected=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(({hold,shell,order})=>{
     const f=window.dashboardFixture={hold,sessions:0,status:['paused','plan'].includes(hold)?403:200,
      paused:hold==='paused'?order:null,held:[],calls:[],signals:[]};
     f.stage=(name,value)=>{f.calls.push(name);if(f.hold===name){f.hold=null;return new Promise(resolve=>f.held.push(()=>resolve(value)));}return Promise.resolve(value);};
     const fetch=window.fetch.bind(window);
     window.fetch=(url,options)=>{
      if(String(url)!=='https://johnmusic.app.n8n.cloud/webhook/sma-dashboard-session')return fetch(url,options);
      f.signals.push(options.signal);
      return f.stage('shell',{ok:f.status===200,status:f.status,json:()=>f.stage('body',{html:shell})});
     };
    },{hold,shell,order});
    await page.route('**/*',async route=>{
     const req=route.request(),url=new URL(req.url());
     if(req.method()==='GET'&&url.origin===site&&/^\/app\/(dashboard\.html|assets\/[\w.-]+\.m?js)$/.test(url.pathname))
      return route.fulfill({contentType:url.pathname.endsWith('.html')?'text/html; charset=utf-8':'text/javascript',body:fs.readFileSync('.'+url.pathname,'utf8')});
     if(req.method()==='GET'&&url.origin==='https://esm.sh'&&/^\/@supabase\/supabase-js@2(?:\.57\.4)?$/.test(url.pathname))
      return route.fulfill({contentType:'text/javascript',body:fake});
     unexpected.push(req.method()+' '+req.url());return route.abort();
    });
    await page.clock.install();await page.goto(site+'/app/dashboard.html'+(hold==='pilot'?'?kundenmedien=pilot':''));
    await page.waitForFunction(()=>window.dashboardFixture.held.length===1);
    assert.equal(await page.locator('#retry').isHidden(),true);
    await page.clock.fastForward(45001);await page.getByText(/Die Anmeldung dauert gerade zu lange/).waitFor();
    assert.equal(await page.locator('#dashboard').isHidden(),true);
    assert.equal(await page.locator('#retry').isEnabled(),true);
    assert.equal(await page.evaluate(()=>dashboardFixture.signals.every(s=>s.aborted)),true);
    await page.evaluate(()=>{dashboardFixture.status=200;dashboardFixture.sessions=0;dashboardFixture.hold='shell';});
    if(mobile)await page.locator('#retry').tap();else await page.locator('#retry').click();
    await page.waitForFunction(()=>dashboardFixture.held.length===2);
    await page.evaluate(()=>dashboardFixture.held[0]());
    assert.equal(await page.locator('#retry').isHidden(),true);
    assert.equal(await page.locator('#dashboard').isHidden(),true);
    assert.equal(new URL(page.url()).pathname,'/app/dashboard.html');
    await page.evaluate(()=>dashboardFixture.held[1]());
    await page.frameLocator('#dashboard').getByText('Mein Kundenbereich').waitFor();
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
   }finally{await context.close();}
  }
 }finally{await browser.close();}
});
