const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFile}=require('node:fs/promises');

test('every video card opens its bound file, plays it and saves a private edit',async()=>{
 const {chromium}=await import('./dom-runtime/node_modules/playwright-core/index.mjs');
 const {site,serve,file,original,checksum,uuid}=await import('./run-dashboard-mobile.mjs');
 const {editorDefaults}=await import('../app/assets/media-editor-model.mjs');
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
 try{
  for(const portal of ['youtube','tiktok','instagram','facebook']){
   const context=await browser.newContext(),page=await context.newPage();
   const files=Array.from({length:3},(_,i)=>({...file,id:uuid(20+i),name:'Clip.mp4',revision:file.revision+'-'+i}));
   const rows=files.map((f,i)=>({asset_id:f.id,asset_revision:f.revision,media_kind:'video',current:true,name:f.name,texts:[],times:{[portal]:'2026-11-27T1'+i+':00:00Z'}}));
   const seen=[],saved=[],errors=[];
   context.on('page',tab=>tab.on('pageerror',e=>errors.push(e.message)));
   await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const reply=data=>route.fulfill({json:data,headers:{'Access-Control-Allow-Origin':'*'}});
    if(path==='/schedule')return route.fulfill({contentType:'text/html',body:`<section></section><script type="module">
      import {mountDailySchedule} from '/app/assets/publication-daily-schedule.mjs';
      mountDailySchedule(document,document.querySelector('section'),async()=>({ok:true,version:1,times:{},files:${JSON.stringify(rows)}}),null,location.origin+'/app/media-editor.html').open('${portal}');
    </script>`});
    if(path==='/app/media-editor.html')return route.fulfill({contentType:'text/html',body:await readFile('app/media-editor.html')});
    if(req.method()==='GET')return serve(route);
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'*'}});
    const payload=req.postDataJSON()||{},input=payload.p_input||{};
    if(path.endsWith('/sma_publication_files_v1'))return reply({ok:true,files});
    if(path.endsWith('/sma_publication_editor_v1')){
     const isSave=payload.p_action==='save';
     if(isSave)saved.push(input);
     return reply({ok:true,version:1,can_publish:false,asset_id:input.asset_id,asset_revision:input.asset_revision,
      settings:isSave?input.settings:editorDefaults,revision:isSave?1:0,changed:isSave,saved_at:isSave?new Date().toISOString():null});
    }
    if(path.endsWith('/sma_portal_playback_batch_v1')){
     seen.push(payload);return reply({first:0,size:original.length,parts:1,sha:checksum,chunks:[original.toString('base64')]});
    }
    return reply({ok:false,code:'UNAVAILABLE'});
   });
   await page.goto(site+'/schedule');const links=page.getByRole('link',{name:/Video bearbeiten/});
   await links.first().waitFor();assert.equal(await links.count(),files.length);
   for(const [index,f] of files.entries()){
    const popup=context.waitForEvent('page');await links.nth(index).click();const editor=await popup;
    await editor.locator('#stagePlayback').click({timeout:6500});
    await editor.waitForFunction(()=>document.querySelector('#stage video')?.currentTime>0,{},{timeout:6500});
    assert.equal(await editor.locator('#asset').inputValue(),f.id);
    const request=seen.at(-1);assert.equal(request.p_portal,portal);assert.equal(request.p_asset,f.id);assert.equal(request.p_revision,f.revision);
    await editor.locator('#trimStart').press('ArrowRight');
    await editor.locator('#save').click();
    await editor.waitForFunction(()=>document.querySelector('#status').textContent.includes('Entwurf gespeichert'),{},{timeout:6000});
    assert.equal(saved.at(-1).asset_id,f.id);assert.equal(saved.at(-1).asset_revision,f.revision);assert(saved.at(-1).settings.start_ms>0);
    await editor.close();
   }
   assert.equal(saved.length,files.length);assert.deepEqual(errors,[]);await context.close();
  }
 }finally{await browser.close();}
});
