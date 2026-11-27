const test=require('node:test');
const assert=require('node:assert/strict');

test('four portal icons, muted hover, exact post player, reload and direct entry',async()=>{
 const {chromium}=await import('./dom-runtime/node_modules/playwright-core/index.mjs');
 const {dashboard,platformNames,newCustomerShell,serve,file,original,checksum,uuid,catalogSyncStatus,png}=await import('./run-dashboard-mobile.mjs');
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
 try{
  for(const name of platformNames){
   const portal=name.toLowerCase();
   const files=[1,2].map(i=>({...file,id:uuid(i+50),name:name+'-Clip-'+i+'.mp4',assignments:[]}));
   const context=await browser.newContext(),page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await context.route('**/*',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()==='GET')return serve(route);
    const reply=json=>route.fulfill({json,headers:{'Access-Control-Allow-Origin':'*'}});
    if(path==='/webhook/sma-dashboard-session')return reply({html:newCustomerShell});
    const args=request.postDataJSON()||{};
    if(path.endsWith('/sma_portal_playback_v1')){
     assert.equal(args.p_portal,portal);
     assert(files.some(row=>row.id===args.p_asset));
     assert.equal(args.p_revision,file.revision);
     return reply(args.p_part===null?{size:original.length,parts:1,sha:checksum}:original.toString('base64'));
    }
    if(path.endsWith('/sma_publication_files_v1')){
     if(args.p_action==='list')return reply({ok:true,files:args.p_input.platform===portal?files:[]});
     if(args.p_action==='sync_status')return reply(catalogSyncStatus());
    }
    if(path.endsWith('/sma-publication-asset-preview-v1'))return reply({ok:true,can_publish:false,asset_id:args.asset_id,
     asset_revision:file.revision,media_kind:'video',mime_type:'image/png',image_base64:png});
    return reply({ok:true,status:'empty',files:[]});
   });
   const frame=page.frameLocator('#dashboard'),editor=frame.frameLocator('iframe[data-portal="'+portal+'"]');
   const tile=editor.locator('.gallery-select').nth(1),player=editor.locator('#originalVideoPreview video');
   await page.goto(dashboard);
   await frame.getByRole('button',{name:'Veröffentlichung',exact:true}).click();
   const icon=frame.getByRole('button',{name:name+' optimieren',exact:true});
   assert.equal(await icon.locator('.platform-icon').count(),1);
   assert.equal((await icon.innerText()).trim(),'');
   if(name==='YouTube'||name==='Facebook')await icon.press('Enter');else await icon.click();
   await tile.hover();
   const hover=tile.locator('video');
   await decodedFrame(hover);
   assert(await hover.evaluate(video=>video.muted));
   await editor.locator('.gallery-caption').first().hover();
   assert.equal(await hover.count(),0);
   await tile.click();
   await player.waitFor();
   await player.evaluate(video=>video.play());
   await decodedFrame(player);
   assert(await player.evaluate(video=>video.controls&&!video.muted));
   assert.equal(await editor.locator('#workspaceMediaLabel').innerText(),name+' · '+files[1].name);
   await page.waitForFunction(()=>location.hash.endsWith('/vorschau'));
   await page.reload();
   await player.waitFor();
   assert.equal(await editor.locator('#workspaceMediaLabel').innerText(),name+' · '+files[1].name);
   const fresh=await context.newPage();
   await fresh.goto(dashboard+'#optimieren/'+portal+'/vorschau');
   const direct=fresh.frameLocator('#dashboard').frameLocator('iframe[data-portal="'+portal+'"]');
   await direct.locator('#originalVideoPreview video').waitFor();
   assert.equal(await direct.locator('#workspaceMediaLabel').innerText(),name+' · '+files[0].name);
   assert.deepEqual(errors,[]);
   await context.close();
  }
 }finally{await browser.close();}
});

async function decodedFrame(locator){
 await locator.waitFor({state:'visible'});
 await locator.evaluate(video=>new Promise((resolve,reject)=>{
  const deadline=setTimeout(()=>reject(Error('No decoded video frame')),6000);
  function check(_now,frame){
   if(frame.width>0&&frame.mediaTime>0){clearTimeout(deadline);resolve();}
   else video.requestVideoFrameCallback(check);
  }
  video.requestVideoFrameCallback(check);
 }));
}
