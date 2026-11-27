const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');

test('manual picker refresh, real video frames, exact posts, approval and provider receipts',async()=>{
 const {chromium}=await import('./dom-runtime/node_modules/playwright-core/index.mjs');
 const {site,serve,file,original,uuid,png,catalogSyncStatus}=await import('./run-dashboard-mobile.mjs');
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
 try{
  for(const portal of ['youtube','tiktok','instagram','facebook']){
   const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(10000);
   let visible=[{...file,profile_media:{source_name:'Original A.mp4'}},{...file,id:uuid(77),revision:'other:1',profile_media:{source_name:'Original B.mp4'}}];
   let notifyScan,posts=0,providerCalls=0,saved=null,stage='empty',prepared=null,orderId=uuid(81),needsApproval=portal==='youtube';
   const jobs=new Map(),err=[],clicks=[];page.on('pageerror',e=>err.push(e.message));
   const chosen=visible[1],tags=['Test','Wien'],text='Text für genau das zweite Video.';
   await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const reply=v=>route.fulfill({json:v,headers:{'Access-Control-Allow-Origin':'*'}});
    if(path==='/app/sofort-posten.html')return route.fulfill({contentType:'text/html',body:await fs.readFile('app/sofort-posten.html')});
    if(req.method()==='GET')return serve(route);
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'*'}});
    const a=req.postData()?req.postDataJSON():{},b=a.p_input||{};
    if(path.endsWith('/sma_publication_files_v1')){
     if(a.p_action==='list')return reply({ok:true,files:visible});
     if(a.p_action==='get')return reply(saved||{ok:true,status:'empty'});
     if(a.p_action==='sync_status')return reply(catalogSyncStatus());
     return reply({ok:true});
    }
    if(path.endsWith('/sma_portal_hover_intro_v1'))return reply(original.toString('base64'));
    if(path.endsWith('/sma_refresh_portal_folder_v1')){if(notifyScan)await new Promise(r=>{notifyScan=r;});return reply({ok:true,background:false});}
    if(path.endsWith('/sma_manual_portal_v1')){
     if(a.p_action==='folder')return reply({ok:true,folder:'folder_0123456789',verified_at:'2026-11-27T13:00:00Z'});
     assert.equal(a.p_action,'read');assert.equal(a.p_asset,chosen.id);
     return reply(stage==='empty'?{ok:true,state:'approval_required'}:{ok:true,order:orderId,can_send:false,background:false,due:new Date(Date.now()-500).toISOString(),state:stage,sequence:1,pending:stage==='checked',provider_code:stage==='failed'?'TIKTOK_RATE_LIMIT':null});
    }
    if(path.endsWith('/sma_content_editor_v1')){
     assert.equal(b.asset_id,chosen.id);assert.equal(b.asset_revision,chosen.revision);assert.equal(b.platform,portal);
     if(a.p_action==='save'){
      assert.equal(b.body,text);assert.deepEqual(b.hashtags,tags);assert.equal(b.assignment_revision,0);
      saved={ok:true,status:'completed',id:uuid(91),revision:2,assignment_revision:1,
       preview:{can_publish:false,language:'de',drafts:[{platform:portal,title:b.title,body:b.body,hashtags:b.hashtags,caption:text+' #Test #Wien'}]},input:{editor_source_text:''}};
      return reply(saved);
     }
     assert.equal(b.preview_revision,2);assert.equal(b.assignment_revision,1);assert.equal(b.preview_id,saved.id);
     if(portal==='instagram'||portal==='facebook')return reply({ok:false,code:'TARGET_ACCOUNT_REQUIRED'});
     clicks.push(b);
     if(needsApproval&&!prepared?.approved_at)return reply({ok:true,state:'approval_required'});
     if(needsApproval)assert.equal(b.order,prepared.id);
     posts++;stage='checked';return reply({ok:true,accepted:true,order:orderId,state:'checked'});
    }
    if(path.endsWith('/sma-file-job')){jobs.set(a.command_id,a);return reply({ok:true,job_id:a.job_id,command_id:a.command_id});}
    if(path.endsWith('/sma_file_job_v1')){
     if(a.p_action==='start')return reply({ok:true,job_id:uuid(17),deadline_at:new Date(Date.now()+600000).toISOString()});
     const j=jobs.get(b.command_id),input=j.input;
     const target={platform:portal,id:'test-channel',name:'Testkonto'},account_check={target_id:target.id,display_name:target.name};
     const base={ok:true,id:input.id,can_upload:false,can_publish:false,target,account_check};
     let body;
     if(j.operation==='account')body={...base,stage:'account'};
     if(j.operation==='order_prepare'){
      const binding=Object.fromEntries(['asset_id','asset_revision','platform','assignment_revision','preview_id','preview_revision'].map(k=>[k,input[k]]));
      orderId=input.id;prepared={...base,binding,draft:saved.preview.drafts[0],choices:input.choices,state:'prepared',approval_policy:'media-consent-2026-11-03.1',approval_token:'test',
       approved_at:null,approval_window:{status:'active',expires_at:new Date(Date.now()+60000).toISOString()},blockers:[]};body=prepared;
     }
     if(j.operation==='order_approve'){assert.equal(input.confirm,true);prepared={...prepared,state:'approved',approved_at:new Date().toISOString(),approval_token:null,approval_window:null,approval_review:input.review};body=prepared;}
     return reply({ok:true,job_id:j.job_id,commands:[{command_id:j.command_id,operation:j.operation,state:'completed',response:{status:200,body}}]});
    }
    if(path.endsWith('/sma-publication-order-v1')){assert.equal(a.action,'get');assert.equal(a.input.id,orderId);providerCalls++;stage=portal==='youtube'?'complete':'failed';return reply({ok:true,id:orderId,state:'checked',can_publish:false,can_upload:false});}
    if(path.endsWith('/sma_publication_history_order_page_v1'))return reply({entries:[{id:orderId,platform:portal,status:'public_confirmed'}]});
    if(path.endsWith('/sma_publication_order_v1'))return reply(prepared);
    if(path.endsWith('/sma_youtube_file_defaults_v1'))return reply({made_for_kids:false,contains_synthetic_media:false});
    if(path.endsWith('asset-preview-v1')&&a.assets)return reply({ok:true,can_publish:false,assets:a.assets.map(x=>({...x,ok:true,can_publish:false,media_kind:'video',mime_type:'image/png',image_base64:png}))});
    return reply({ok:true});
   });
   await page.goto(site+'/app/sofort-posten.html?portal='+portal);
   const reload=page.getByRole('button',{name:'Ordner aktualisieren'}),send=page.getByRole('button',{name:'Jetzt posten'});
   await page.waitForFunction(()=>document.querySelectorAll('.file-thumb img').length===2&&[...document.querySelectorAll('.file-thumb img')].every(x=>x.naturalWidth>1));
   assert.equal(await reload.innerText(),'');assert.equal(await send.isDisabled(),true);
   await page.waitForFunction(()=>!document.querySelector('#reload').disabled);
   visible=visible.slice(1);notifyScan=true;await reload.click();
   await page.waitForFunction(()=>document.querySelector('#reload').getAttribute('aria-busy')==='true');
   while(typeof notifyScan!=='function')await new Promise(r=>setTimeout(r,5));const done=notifyScan;notifyScan=null;done();
   await page.waitForFunction(()=>!document.querySelector('#reload').disabled);
   assert.equal(await page.locator('#driveVideos button').count(),1);
   assert.doesNotMatch(await page.locator('#folderStatus').innerText(),/Ordneransicht|Drive-Dateien aktualisiert|Google-Drive-Link/);
   await page.getByRole('button',{name:'Original B'}).click();
   await page.getByLabel('Beitragstext',{exact:true}).fill(text);await page.getByLabel('Hashtags',{exact:true}).fill('#Test #Wien');
   await send.click();
   if(portal==='youtube'){
    await page.getByRole('dialog').waitFor();await page.locator('#order-visibility').selectOption('public');
    await page.getByRole('button',{name:'Auftrag prüfen'}).click();
    for(const field of ['content_checked','media_rights','music_rights'])await page.locator('#order-review-'+field).check();
    await page.locator('#order-final-consent').check();await page.getByRole('button',{name:'Veröffentlichung freigeben'}).click();
   }
   if(portal==='youtube'||portal==='tiktok'){
    await page.waitForFunction(()=>document.querySelector('#send').getAttribute('aria-busy')==='true');
    await page.waitForFunction(()=>/öffentlich.*bestätigt|zu viele Anfragen/.test(document.querySelector('#status').textContent),{},{timeout:18000});
    assert.equal(await send.getAttribute('aria-busy'),'false');assert.equal(providerCalls,1);assert.equal(posts,1);
   }else{await page.locator('#sendNotice').filter({hasText:'Für dieses Portal ist kein Versandkonto verbunden.'}).waitFor();assert.equal(posts,0);}
   assert.deepEqual(err,[]);await context.close();
  }
 }finally{await browser.close();}
});
