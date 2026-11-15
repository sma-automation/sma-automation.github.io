const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const html=fs.readFileSync('app/dashboard.html','utf8');
const begin=html.indexOf("window.addEventListener('message',event=>{");
const end=html.indexOf('\nfunction leaveDashboard()',begin);
assert.ok(begin>0&&end>begin);
const source=html.slice(begin,end);
const types=['sma-publication-preview-close','sma-publication-search-return','sma-publication-order-open','sma-publication-workspace-view'];
function fixture(){
 const calls=[],visible={hidden:false,style:{},dataset:{portal:'youtube'}},hidden={hidden:true,style:{},dataset:{portal:'tiktok'}};
 for(const item of [visible,hidden])item.contentWindow={postMessage:(...args)=>calls.push(['post',...args])};
 let handler,active=true;
 const env={signedOut:false,window:{location:{origin:'https://sma.test'},innerHeight:800,addEventListener:(name,fn)=>{assert.equal(name,'message');handler=fn;}},
  optimizerFrames:{children:[visible,hidden]},optimizerPage:{hidden:false,scrollIntoView:()=>calls.push(['scroll'])},
  publishingPage:{classList:{contains:name=>name==='active'&&active}},frame:{hidden:false,contentWindow:{}},
  fileSearchReturns:new Map([['search-1',{}]]),history:{state:{searchKey:'search-1'}},
  closeOptimizer:()=>calls.push(['close']),optimizerWorkspaceView:(preview,view,unavailable)=>calls.push(['view',preview.dataset.portal,view,unavailable]),
  fileView:{load:sync=>calls.push(['files',sync])},load:()=>calls.push(['reload']),logout:()=>calls.push(['logout'])};
 vm.runInNewContext(source,env);
 return {env,calls,visible,hidden,active:value=>{active=value;},send(type,from=visible,patch={}){
  handler({origin:'https://sma.test',source:from?.contentWindow,data:{type,view:'source',height:640},...patch});
 }};
}
for(const type of types)test(type+': only the visible customer workspace may navigate',()=>{
 for(const state of ['hidden-frame','hidden-editor','inactive-section','hidden-dashboard','signed-out','detached','foreign-origin','missing-section']){
  const f=fixture();let sender=f.visible,patch={};
  if(state==='hidden-frame')sender=f.hidden;
  if(state==='hidden-editor')f.env.optimizerPage.hidden=true;
  if(state==='inactive-section')f.active(false);
  if(state==='hidden-dashboard')f.env.frame.hidden=true;
  if(state==='signed-out')f.env.signedOut=true;
  if(state==='detached')f.env.optimizerFrames.children=[];
  if(state==='foreign-origin')patch.origin='https://foreign.invalid';
  if(state==='missing-section')f.env.publishingPage=null;
  f.send(type,sender,patch);assert.deepEqual(f.calls,[],state);
 }
});
test('active preview keeps close, search return, order viewport and workspace navigation',()=>{
 const f=fixture();
 f.send(types[0]);assert.deepEqual(f.calls.pop(),['close']);
 f.send(types[1]);assert.deepEqual(f.calls.pop(),['close']);
 f.send(types[2]);assert.equal(f.calls.shift()[0],'scroll');
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls.shift())),['post',{type:'sma-publication-order-viewport',height:660},'https://sma.test']);
 f.send(types[3]);assert.deepEqual(f.calls.pop(),['view','youtube','source',false]);
 f.env.history.state=null;f.send(types[1]);assert.deepEqual(f.calls,[]);
});
test('a late old portal cannot navigate after switching; returning makes its current messages usable again',()=>{
 const f=fixture();f.visible.hidden=true;f.hidden.hidden=false;
 for(const type of types)f.send(type,f.visible);
 assert.deepEqual(f.calls,[]);f.send(types[0],f.hidden);assert.deepEqual(f.calls.pop(),['close']);
 f.visible.hidden=false;f.hidden.hidden=true;f.send(types[0],f.visible);assert.deepEqual(f.calls.pop(),['close']);
});
test('non-navigation sizing and file updates retain their existing source checks',()=>{
 const f=fixture();f.active(false);
 f.send('sma-publication-preview-height',f.hidden);assert.equal(f.hidden.style.height,'640px');
 f.send('sma-publication-file-updated',f.hidden);assert.deepEqual(f.calls.pop(),['files',false]);
 f.send('sma-publication-preview-height',{contentWindow:{}},{data:{type:'sma-publication-preview-height',height:999}});
 assert.equal(f.hidden.style.height,'640px');
 for(const height of [299,30001,NaN,Infinity,'640'])f.send('sma-publication-preview-height',f.hidden,{data:{type:'sma-publication-preview-height',height}});
 assert.equal(f.hidden.style.height,'640px');
});
test('customer-dashboard reload and logout still require the actual dashboard frame',()=>{
 const f=fixture();
 for(const type of ['sma-dashboard-reload','sma-dashboard-logout']){
  f.send(type);f.send(type,f.hidden);assert.deepEqual(f.calls,[]);
  f.send(type,f.env.frame,{origin:'https://foreign.invalid'});assert.deepEqual(f.calls,[]);
  f.send(type,f.env.frame);assert.equal(f.calls.pop()[0],type.endsWith('reload')?'reload':'logout');
 }
});
test('desktop and mobile: delayed hidden-frame messages preserve open edits and the active return route',async()=>{
 const runtime=process.env.SMA_TEST_PLAYWRIGHT?pathToFileURL(process.env.SMA_TEST_PLAYWRIGHT).href:'./dom-runtime/node_modules/playwright-core/index.mjs';
 const {chromium}=await import(runtime);
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome',args:process.env.SMA_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]});
 try{for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
  const page=await context.newPage(),external=[],errors=[];
  await page.route('**/*',route=>{external.push(route.request().url());return route.abort();});
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<style>[hidden]{display:none!important}iframe{width:100%;border:0}</style><section id="publishing" class="active"><section id="optimizer"><div id="frames"><iframe id="one" srcdoc="<textarea>Mein offener YouTube-Text</textarea>"></iframe><iframe id="two" hidden srcdoc="<textarea>Mein offener TikTok-Text</textarea>"></iframe></div></section></section><iframe id="dashboard"></iframe>');
  await page.frameLocator('#one').locator('textarea').fill('Meine ungesicherte Änderung');
  await page.evaluate(source=>{
   window.signedOut=false;window.publishingPage=document.getElementById('publishing');window.optimizerPage=document.getElementById('optimizer');window.optimizerFrames=document.getElementById('frames');window.frame=document.getElementById('dashboard');
   window.fileSearchReturns=new Map([['search-1',{}]]);window.actions=[];
   window.closeOptimizer=()=>{actions.push('close');optimizerPage.hidden=true;};
   window.optimizerWorkspaceView=()=>actions.push('view');window.fileView={load:()=>actions.push('files')};window.load=()=>actions.push('reload');window.logout=()=>actions.push('logout');
   history.replaceState({smaOptimization:true,searchKey:'search-1',assetId:'fixture-file'},'');
   window.routeBefore=JSON.stringify(history.state);(0,eval)(source);
   // The marker is ordered after the real postMessage event from the same source.
   window.addEventListener('message',event=>{if(event.data?.type==='fixture-flush')window.flushed=event.data.id;});
  },source);
  let id=0;
  async function send(selector,type){
   const current=++id;
   await page.locator(selector).evaluate((iframe,{type,current})=>{
    iframe.contentWindow.eval(`parent.postMessage({type:${JSON.stringify(type)},view:'source'},'*');parent.postMessage({type:'fixture-flush',id:${current}},'*');`);
   },{type,current});
   await page.waitForFunction(id=>window.flushed===id,current);
  }
  for(const type of types)await send('#two',type);
  assert.deepEqual(await page.evaluate(()=>actions),[]);
  await page.evaluate(()=>publishingPage.classList.remove('active'));
  for(const type of types)await send('#one',type);
  assert.deepEqual(await page.evaluate(()=>actions),[]);
  assert.equal(await page.frameLocator('#one').locator('textarea').inputValue(),'Meine ungesicherte Änderung');
  assert.equal(await page.evaluate(()=>JSON.stringify(history.state)===routeBefore),true);
  await page.evaluate(()=>{publishingPage.classList.add('active');document.getElementById('one').hidden=true;document.getElementById('two').hidden=false;});
  await send('#one',types[0]);assert.deepEqual(await page.evaluate(()=>actions),[]);
  assert.equal(await page.frameLocator('#two').locator('textarea').inputValue(),'Mein offener TikTok-Text');
  await page.evaluate(()=>{document.getElementById('one').hidden=false;document.getElementById('two').hidden=true;});
  assert.equal(await page.frameLocator('#one').locator('textarea').inputValue(),'Meine ungesicherte Änderung');
  await send('#one',types[0]);assert.deepEqual(await page.evaluate(()=>actions),['close']);
  assert.equal(await page.locator('#optimizer').isVisible(),false);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  await context.close();
 }}finally{await browser.close();}
});
