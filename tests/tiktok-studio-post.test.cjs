const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');

test('both TikTok editors offer the exact MP4 and the current caption for native upload',async()=>{
 const {chromium}=await import('./dom-runtime/node_modules/playwright-core/index.mjs');
 const {site,serve,file,original,catalogSyncStatus}=await import('./run-dashboard-mobile.mjs');
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
 try{
  for(const manual of [false,true]){
   const ctx=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
   const page=await ctx.newPage();page.setDefaultTimeout(8000);
   const current={...file,assignments:[],profile_media:{state:'private_preview_only',source_name:'Zeichentablet.mp4',drive_id:'drive_verified_file'}};
   const calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
   await ctx.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    if(path==='/app/sofort-posten.html')return route.fulfill({contentType:'text/html',body:await fs.readFile('app/sofort-posten.html')});
    if(req.method()==='GET')return serve(route);
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'*'};
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
    const a=req.postDataJSON()||{},reply=json=>route.fulfill({json,headers});
    calls.push([path,a.p_action]);
    if(path.endsWith('/sma_portal_gallery_v1'))return reply({ok:true,folder:'folder_1234567890',folder_version:'v',files:[current]});
    if(path.endsWith('/sma_publication_files_v1')){
     if(a.p_action==='list')return reply({ok:true,files:[current]});
     if(a.p_action==='sync_status')return reply(catalogSyncStatus());
     if(a.p_action==='get')return reply({ok:true,status:'empty'});
    }
    if(path.endsWith('/sma_manual_portal_v1'))return reply({ok:true,folder:'folder_1234567890'});
    if(path.endsWith('/sma_portal_hover_intro_v1'))return reply(original.toString('base64'));
    if(path.endsWith('/sma-publication-editor-source-v1')){
     assert.equal(a.asset_id,file.id);assert.equal(a.asset_revision,file.revision);
     return reply({ok:true,can_publish:false,asset_id:file.id,asset_revision:file.revision,mime_type:file.mime_type,size_bytes:original.length,sha256:file.revision.split(':')[1],data_base64:original.toString('base64')});
    }
    return reply({ok:true,status:'empty',files:[]});
   });
   await page.goto(site+'/app/'+(manual?'sofort-posten.html?':'publication-preview.html?wide=1&')+'portal=tiktok&asset='+file.id);
   if(!manual){await page.getByRole('region',{name:'Auf TikTok posten'}).waitFor();await page.getByRole('button',{name:'Inhalt selbst beschreiben'}).click();}
   const panel=page.getByRole('region',{name:'Auf TikTok posten'});await panel.waitFor();
   assert.equal(await panel.getByRole('link',{name:'TikTok Studio öffnen'}).getAttribute('href'),'https://www.tiktok.com/tiktokstudio/upload');
   await page.getByRole('textbox',{name:'Beitragstext',exact:true}).fill('Die Skizze zeigt einen Stern.');
   await page.getByRole('textbox',{name:'Hashtags',exact:true}).fill('#Tablet #Skizze');
   await panel.getByRole('button',{name:'Beitragstext kopieren'}).click();
   await panel.getByText('Beitragstext mit Hashtags kopiert.').waitFor();
   assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'Die Skizze zeigt einen Stern.\n\n#Tablet #Skizze');
   const download=page.waitForEvent('download');
   await panel.getByRole('button',{name:'Video herunterladen'}).click();
   const output=await download;assert.equal(output.suggestedFilename(),'Zeichentablet.mp4');assert.deepEqual(await fs.readFile(await output.path()),original);
   assert(!calls.some(([path,action])=>action==='send'||path.includes('publication-order-v1')));assert.deepEqual(errors,[]);
   await ctx.close();
  }
 }finally{await browser.close();}
});
