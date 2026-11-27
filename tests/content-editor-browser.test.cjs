const test=require('node:test');
const assert=require('node:assert/strict');

test('edit, attach, save and request the exact portal post without contacting a provider',async()=>{
 const {chromium}=await import('./dom-runtime/node_modules/playwright-core/index.mjs');
 const {site,serve,file,original,uuid}=await import('./run-dashboard-mobile.mjs');
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
 try{
  for(const portal of ['youtube','tiktok','instagram','facebook']){
   const context=await browser.newContext(),page=await context.newPage();
   page.setDefaultTimeout(8000);
   const errors=[],sends=[],jobs=new Map(),folder='folder_'+portal+'_privat',shop='https://sma-automation.com/app/shop.html?shop=test';
   let files=[],saved=null,productReads=0,magicStarts=0,releaseProduct,failProduct=false;
   page.on('pageerror',e=>errors.push(e.message));
   await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const reply=data=>route.fulfill({json:data,headers:{'Access-Control-Allow-Origin':'*'}});
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'PUT,POST','Access-Control-Allow-Headers':'*'}});
    if(req.method()==='GET')return serve(route);
    if(req.method()==='PUT'){
     assert.equal(url.hostname,'www.googleapis.com');
     if(req.headers()['content-range'].startsWith('bytes */'))return route.fulfill({status:308,headers:{'Access-Control-Allow-Origin':'*'}});
     return route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*'}});
    }
    const a=req.postDataJSON()||{},input=a.p_input||{};
    if(path.endsWith('/sma_portal_gallery_v1'))return reply({ok:true,folder,drive_account:'test@example.test',folder_version:folder+'/1',files});
    if(path.endsWith('/sma_publication_files_v1')){
     if(a.p_action==='get')return reply(saved||{ok:true,status:'empty'});
     if(a.p_action==='product'){
      productReads++;if(failProduct)return reply({ok:false,code:'FILE_UNAVAILABLE'});
      await new Promise(resolve=>{releaseProduct=resolve;});
     }
     if(a.p_action==='assign'){saved.assignment_revision++;files[0].assignments=[{platform:portal,revision:saved.assignment_revision}];return reply(saved);}
     return reply({ok:true});
    }
    if(path.endsWith('/sma-file-job')){
     jobs.set(a.command_id,a);if(a.operation.startsWith('magic_'))magicStarts++;
     return reply({ok:true,job_id:a.job_id,command_id:a.command_id});
    }
    if(path.endsWith('/sma_file_job_v1')){
     if(a.p_action==='start')return reply({ok:true,job_id:uuid(84),deadline_at:new Date(Date.now()+600000).toISOString()});
     const j=jobs.get(input.command_id);assert(j);
     let body={ok:true,can_publish:false,upload_id:j.input.upload_id};
     if(j.operation==='upload_start')Object.assign(body,{status:'ready',upload_url:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=fixture'});
     else if(j.operation==='upload_finish'){
      files=[{...file,name:'Editor-Clip.mp4',verified_at:new Date().toISOString(),assignments:[]}];
      Object.assign(body,{status:'completed',asset_id:file.id});
     }else if(j.operation==='preview_prepare'){
      saved={...saved,input:j.input,id:j.input.request_id,assignment_revision:saved.assignment_revision};
      body=saved;
     }else throw Error('Unexpected worker operation '+j.operation);
     return reply({ok:true,job_id:j.job_id,commands:[{command_id:j.command_id,operation:j.operation,state:'completed',response:{status:200,body}}]});
    }
    if(path.endsWith('/sma_publication_upload_portal_v1')){assert.equal(a.p_platform,portal);return reply(true);}
    if(path.endsWith('/sma_manual_portal_v1')&&a.p_action==='read'){
     assert.equal(a.p_asset,file.id);assert.equal(a.p_revision,file.revision);assert.equal(a.p_platform,portal);
     return reply({ok:true,order:uuid(88),state:'complete'});
    }
    if(path.endsWith('/sma_publication_history_order_page_v1')){
     assert.equal(a.p_order_id,uuid(88));
     return reply({entries:[{id:uuid(88),platform:portal,status:'public_confirmed'}]});
    }
    if(path.endsWith('/sma_content_editor_v1')){
     assert.equal(input.platform,portal);assert.equal(input.asset_id,file.id);assert.equal(input.asset_revision,file.revision);
     if(a.p_action==='send'){sends.push(input);assert.equal(input.preview_revision,saved.revision);assert.equal(input.assignment_revision,saved.assignment_revision);return reply({ok:true,accepted:true,order:uuid(88)});}
     assert.equal(a.p_action,'save');
     const revision=(saved?.revision||0)+1;
     saved={ok:true,status:'completed',id:uuid(93),revision,assignment_revision:revision,input:{editor_source_text:input.source_text,source_text:input.source_text,language:'de',media_kind:'video',platforms:[portal]},
      preview:{can_publish:false,language:'de',shop_url:shop,drafts:[{platform:portal,title:input.title,body:input.body,hashtags:input.hashtags,review_notes:[],caption:input.body+' '+input.hashtags.join(' ')}]}};
     files[0].assignments=[{platform:portal,revision,status:'assigned'}];return reply(saved);
    }
    if(path.endsWith('/sma_publication_video_magic_v1'))return reply({ok:true,analysis:{status:'unrecognized',can_publish:false,asset_id:file.id,asset_revision:file.revision,policy_version:'magic-video-2026-11-03.1'}});
    return reply({ok:true,status:'empty',files:[]});
   });
   await page.goto(site+'/app/publication-preview.html?wide=1&portal='+portal);
   await page.getByRole('tab',{name:'Inhalt und Ziel'}).click();
   assert.equal(await page.locator('#loadLatest,#generate').count(),0);
   assert.equal(await page.getByText('Medienprüfung · Datei auswählen',{exact:true}).isVisible(),false);
   const drive=await page.getByRole('link',{name:'Drive-Ordner öffnen'}).getAttribute('href');
   assert.equal(new URL(drive).pathname,'/drive/folders/'+folder);assert.equal(new URL(drive).searchParams.get('authuser'),'test@example.test');
   await page.locator('#workspaceDrop').evaluate(node=>{
    const dataTransfer=new DataTransfer();dataTransfer.items.add(new File(['x'],'Beispiel.pdf',{type:'application/pdf'}));
    node.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));
   });
   assert.match(await page.locator('#uploadStatus').innerText(),/Bild- oder Videodatei/);assert.equal(jobs.size,0);
   const text='Dieser Beitrag zeigt ein privates Beispiel im Test.';
   await page.getByRole('textbox',{name:'Beitragstext',exact:true}).fill(text);
   await page.getByRole('textbox',{name:'Hashtags',exact:true}).fill('#Privat #Test');
   await page.locator('#source_text').fill('Die Beispieldatei zeigt einen kurzen Ausschnitt mit einem Testmotiv.');
   await page.locator('#workspaceDrop').evaluate((node,bytes)=>{
    const dataTransfer=new DataTransfer();dataTransfer.items.add(new File([Uint8Array.from(bytes)],'Editor-Clip.mp4',{type:'video/mp4'}));
    node.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));
   },[...original]);
   await page.waitForFunction(()=>document.querySelector('#workspaceSelectedName').textContent==='Editor-Clip.mp4'&&!document.querySelector('#workspaceSaveManual').disabled&&document.querySelector('#workspaceEmptyBody').value.length>0);
   assert.equal(await page.getByRole('textbox',{name:'Beitragstext',exact:true}).inputValue(),text);
   await page.getByRole('button',{name:'Entwurf speichern',exact:true}).click();
   await page.locator('#'+portal+'-body').waitFor();assert.equal(saved.preview.drafts[0].body,text);assert.deepEqual(saved.preview.drafts[0].hashtags,['Privat','Test']);
   await page.getByRole('textbox',{name:'Beitragstext',exact:true}).fill(text+' Geändert.');
   await page.getByRole('textbox',{name:'Hashtags',exact:true}).fill('#Neu');
   await page.locator('#source_text').fill('Die Beschreibung wurde zusammen mit dem Beitrag geändert.');
   await page.getByRole('button',{name:/Auf .* posten/}).click();
   await page.locator('#workspaceSendStatus').filter({hasText:'hat die öffentliche Sichtbarkeit bestätigt'}).waitFor();
   assert.equal(sends.length,1);assert.equal(saved.preview.drafts[0].body,text+' Geändert.');assert.deepEqual(saved.preview.drafts[0].hashtags,['Neu']);
   // Author-provided evidence avoids a media recognition job.
   await page.locator('#source_text').fill('Eine neue eigene Beschreibung des gezeigten Inhalts für den Magic Effect.');
   await page.locator('#magicText').click();await page.locator('#confirmMagicReplace').click();
   await page.locator('#magicReadiness[data-state="working"]').waitFor();
   while(!releaseProduct)await new Promise(resolve=>setTimeout(resolve,10));
   releaseProduct();
   await page.waitForFunction(()=>document.querySelector('#portalStatus').textContent.includes('Textvorschau ist gespeichert'));
   assert.equal(magicStarts,0);assert.equal(productReads,1);
   failProduct=true;
   await page.locator('#magicText').click();
   await page.waitForFunction(()=>document.querySelector('#portalStatus').dataset.error==='true');
   assert.match(await page.locator('#portalStatus').textContent(),/Datei/);
   assert.notEqual(await page.locator('#magicReadiness').getAttribute('data-state'),'working');
   assert.deepEqual(errors,[]);await context.close();
  }
 }finally{await browser.close();}
});
