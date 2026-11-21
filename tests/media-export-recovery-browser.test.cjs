const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const origin='https://sma-export-recovery-fixture.test';
const id=n=>'ae770000-0000-4000-8000-'+String(n).padStart(12,'0');
const owner=id(91),otherOwner=id(92),assetId=id(1);
const prefix='sma.media-export.pending.v1.';
const html=fs.readFileSync('app/media-editor.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'')
 .replace('</head>','<link rel="icon" href="data:,"></head>')
 .replace('</body>','<script type="module" src="/fixture.mjs"></script></body>');

// These are the unmodified production modules. Only render/source/upload and
// backend replies are synthetic; checkpoint storage and Web Locks are real.
const bootstrap=`
import {mountMediaExport} from '/app/assets/media-export-view.mjs';
import {createExportCheckpoints} from '/app/assets/media-export-checkpoint.mjs';
import {editorDefaults} from '/app/assets/media-editor-model.mjs';
import {sha256} from '/app/assets/media-export-model.mjs';
const owner=new URL(location.href).searchParams.get('owner')||'${owner}';
const file={id:'${assetId}',name:'Synthetic source video',revision:'r1',media_kind:'video',mime_type:'video/mp4',
 width_px:320,height_px:240,duration_ms:3000,size_bytes:1000};
const saved={revision:1,settings:{...editorDefaults,cover_ms:500},saved_at:'2026-11-06T12:00:00Z',changed:false};
const panel=document.getElementById('exportPanel');document.querySelector('main').replaceChildren(panel);panel.hidden=false;
const api=async(action,input,signal)=>{
 const response=await fetch('/fixture-api',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({owner,action,input}),signal});
 if(!response.ok)throw Error('Synthetic backend unavailable');
 const result=await response.json();
 if(action==='list')fixture.completedLists++;
 return result;
};
const fixture=window.fixture={owner,file,saved,sources:0,renders:0,authLost:0,completedLists:0};
fixture.view=mountMediaExport({doc:document,expectedOwnerId:owner,getOwnerId:async()=>fixture.owner,
 onAuthLost:()=>{fixture.authLost++;fixture.view.destroy();},setBusy:value=>document.body.dataset.busy=String(value),
 getDraft:async()=>({ok:true,version:1,can_publish:false,asset_id:file.id,asset_revision:file.revision,
  revision:saved.revision,settings:saved.settings,saved_at:saved.saved_at,changed:false}),
 uuid:()=>crypto.randomUUID(),request:(action,input)=>api(action,input),
 source:async()=>{fixture.sources++;return new Blob(['Synthetic original']);},
 render:async()=>{fixture.renders++;return {media:new Blob(['Identical synthetic rendered video']),cover:new Blob(['Identical synthetic rendered cover'])};},
 upload:async(blob,artifact,signal)=>api('upload',{upload_id:artifact.upload_id,sha256:await sha256(await blob.arrayBuffer())},signal)});
fixture.checkpoints=createExportCheckpoints({storage:()=>localStorage,locks:()=>navigator.locks,uuid:()=>crypto.randomUUID()});
fixture.binding={owner,asset_id:file.id,asset_revision:file.revision,draft_revision:saved.revision,media_kind:'video',
 outputs:{media:{sha256:'a'.repeat(64),size_bytes:100},cover:{sha256:'b'.repeat(64),size_bytes:50}}};
fixture.reserve=async(owner=fixture.owner)=>{
 try{return {ok:true,...await fixture.checkpoints.reserve({...fixture.binding,owner})};}
 catch(error){return {ok:false,code:error.code};}
};
fixture.view.setContext(file,saved,false);fixture.ready=true;
`;

function backend({loseFirstCompletion=true}={}){
 const calls=[],uploads=[],rows=new Map();let sequence=200,lost=false;
 const receipt=row=>({ok:true,version:1,can_publish:false,export_id:row.input.export_id,
  draft_revision:row.input.draft_revision,status:row.completed?'completed':'prepared',
  media:{upload_id:row.input.export_id,name:'SMA-Export-'+row.input.export_id+'.mp4',mime_type:'video/mp4',asset_id:row.completed?row.mediaAsset:null},
  cover:{upload_id:row.coverUpload,name:'SMA-Export-'+row.input.export_id+'-Cover.png',mime_type:'image/png',asset_id:row.completed?row.coverAsset:null}});
 function handle(body){
  const {owner:customer,action,input}=body;assert.ok([owner,otherOwner].includes(customer));calls.push(structuredClone(body));
  if(action==='list'){
   assert.deepEqual(input,{asset_id:assetId,asset_revision:'r1'});
   return {ok:true,version:1,can_publish:false,exports:[]};
  }
  if(action==='prepare'){
   assert.equal(input.asset_id,assetId);assert.equal(input.asset_revision,'r1');assert.equal(input.draft_revision,1);
   const key=customer+':'+input.export_id,previous=rows.get(key);
   if(previous)assert.deepEqual(input,previous.input,'A recovered export keeps its exact content hashes');
   else rows.set(key,{owner:customer,input:structuredClone(input),coverUpload:id(sequence++),mediaAsset:id(sequence++),coverAsset:id(sequence++),uploaded:new Set(),completed:false});
   return receipt(rows.get(key));
  }
  if(action==='upload'){
   const row=[...rows.values()].find(row=>row.owner===customer&&[row.input.export_id,row.coverUpload].includes(input.upload_id));
   assert.ok(row,'Synthetic upload must belong to an existing own export');
   const kind=input.upload_id===row.input.export_id?'media':'cover';
   assert.equal(input.sha256,row.input.outputs[kind].sha256);uploads.push({owner:customer,id:input.upload_id});
   row.uploaded.add(input.upload_id);return {ok:true};
  }
  assert.equal(action,'complete','No publication, payment or unrelated backend action is permitted');
  const row=rows.get(customer+':'+input.export_id);assert.ok(row);
  assert.deepEqual(input,{asset_id:assetId,asset_revision:'r1',draft_revision:1,export_id:row.input.export_id});
  if(loseFirstCompletion&&!lost){lost=true;return {lost:true};}
  if(row.uploaded.size!==2)return {ok:false,code:'EXPORT_INCOMPLETE'};
  row.completed=true;return receipt(row);
 }
 return {calls,uploads,rows,handle};
}

async function fixture(browser,mobile,options={}){
 const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},
  isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
 const state=backend(options),external=[],errors=[],fixtureErrors=[];
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){external.push(request.url());return route.abort();}
  try{
   if(url.pathname==='/app/media-editor.html')return route.fulfill({contentType:'text/html; charset=utf-8',body:html});
   if(url.pathname==='/fixture.mjs')return route.fulfill({contentType:'text/javascript',body:bootstrap});
   if(url.pathname==='/fixture-api'){
    assert.equal(request.method(),'POST');const result=state.handle(request.postDataJSON());
    if(result.lost)return route.abort('failed');
    return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
   }
   if(/^\/app\/assets\/[\w.-]+\.(?:m?js|css)$/.test(url.pathname))return route.fulfill({
    contentType:url.pathname.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(path.join(process.cwd(),url.pathname.slice(1)),'utf8')});
   throw Error('Unexpected fixture resource: '+url.pathname);
  }catch(error){fixtureErrors.push(error.stack);return route.fulfill({status:500,body:'Invalid synthetic request'});}
 });
 const open=async(customer=owner)=>{
  const page=await context.newPage();await page.goto(origin+'/app/media-editor.html?owner='+customer);
  await page.waitForFunction(()=>window.fixture?.ready&&fixture.completedLists>0);
  return page;
 };
 const clean=()=>{assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(fixtureErrors,[]);};
 return {context,state,open,clean};
}
async function generate(page){
 const previousLists=await page.evaluate(()=>fixture.completedLists);
 await page.locator('#generateExport').click();
 await page.waitForFunction(previous=>document.body.dataset.busy==='false'&&!document.getElementById('exportResult').hidden&&
  fixture.completedLists>previous,previousLists);
 assert.match(await page.locator('#exportStatus').textContent(),/Vorschau fertig/);
}
async function waitStored(page){
 await page.waitForFunction(()=>document.body.dataset.busy==='false'&&document.getElementById('exportStatus').textContent.includes('im Kundenordner gespeichert'));
 assert.equal(await page.locator('#storeExport').isDisabled(),true);
}

const runtime=process.env.SMA_TEST_PLAYWRIGHT?pathToFileURL(process.env.SMA_TEST_PLAYWRIGHT).href:'./dom-runtime/node_modules/playwright-core/index.mjs';
test('actual browser export recovery preserves identities across reloads, tabs and storage failure',
 {skip:!process.env.SMA_TEST_PLAYWRIGHT&&!fs.existsSync('tests/dom-runtime/node_modules/playwright-core/index.mjs')?'Pinned browser runtime is installed in CI':false,timeout:90000},async t=>{
 const {chromium}=await import(runtime);
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome',
  args:process.env.SMA_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]});
 try{
  for(const mobile of [false,true]){
   const device=mobile?'mobile':'desktop';
   await t.test(device+': reload resumes the same export and probes completion before uploading again',async()=>{
    const f=await fixture(browser,mobile);
    try{
     const page=await f.open();assert.deepEqual(f.state.calls.map(call=>call.action),['list']);
     assert.equal(await page.evaluate(()=>fixture.sources+fixture.renders),0);
     await generate(page);assert.equal(f.state.uploads.length,0);
     await page.locator('#storeExport').click();
     await page.waitForFunction(()=>document.body.dataset.busy==='false'&&document.getElementById('exportStatus').textContent.includes('fortgesetzt'));
     assert.equal(f.state.uploads.length,2);assert.equal(f.state.rows.size,1);
     const first=f.state.calls.find(call=>call.action==='prepare').input,checkpoint=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),prefix+owner);
     assert.equal(checkpoint.length,1);assert.equal(checkpoint[0].export_id,first.export_id);
     const before=f.state.calls.length;
     await page.reload();await page.waitForFunction(()=>window.fixture?.ready&&fixture.completedLists>0);
     assert.deepEqual(f.state.calls.slice(before).map(call=>call.action),['list'],'Opening the editor performs no recovery write');
     assert.equal(f.state.uploads.length,2);assert.equal(await page.evaluate(()=>fixture.sources+fixture.renders),0);
     await generate(page);const beforeSave=f.state.calls.length;
     await page.locator('#storeExport').click();await waitStored(page);
     assert.deepEqual(f.state.calls.slice(beforeSave).map(call=>call.action),['prepare','complete','list']);
     assert.deepEqual(f.state.calls.filter(call=>call.action==='prepare').map(call=>call.input),[first,first]);
     assert.equal(f.state.uploads.length,2,'Both finished uploads survive reload without another transfer');
     assert.equal(f.state.rows.size,1);assert.equal([...f.state.rows.values()][0].completed,true);
     await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'[]').length===0,prefix+owner);
     f.clean();
    }finally{await f.context.close();}
   });
   await t.test(device+': a pending tab reconciles its original export after another tab removes the completed checkpoint',async()=>{
    const f=await fixture(browser,mobile);
    try{
     const [first,second]=await Promise.all([f.open(),f.open()]);
     await generate(second);await second.locator('#storeExport').click();
     await second.waitForFunction(()=>document.body.dataset.busy==='false'&&document.getElementById('exportStatus').textContent.includes('fortgesetzt'));
     const original=f.state.calls.find(call=>call.action==='prepare').input.export_id;
     assert.equal(f.state.uploads.length,2);
     await generate(first);await first.locator('#storeExport').click();await waitStored(first);
     await first.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'[]').length===0,prefix+owner);
     const before=f.state.calls.length;
     await second.locator('#storeExport').click();await waitStored(second);
     assert.deepEqual(f.state.calls.slice(before).map(call=>call.action),['complete','list'],
      'The pending tab only reconciles its original ID after the other tab removes the checkpoint');
     assert.equal(f.state.rows.size,1);assert.equal(f.state.uploads.length,2);
     assert.ok(f.state.calls.filter(call=>['prepare','complete'].includes(call.action)).every(call=>call.input.export_id===original));
     f.clean();
    }finally{await f.context.close();}
   });
   await t.test(device+': real Web Locks share one checkpoint between tabs and isolate another owner',async()=>{
    const f=await fixture(browser,mobile);
    try{
     const [first,second]=await Promise.all([f.open(),f.open()]);
     assert.equal(await first.evaluate(()=>typeof navigator.locks?.request),'function');
     let results=await Promise.all([first.evaluate(()=>fixture.reserve()),second.evaluate(()=>fixture.reserve())]);
     for(let index=0;index<results.length;index++)if(!results[index].ok){
      assert.equal(results[index].code,'EXPORT_CHECKPOINT_BUSY');
      results[index]=await [first,second][index].evaluate(()=>fixture.reserve());
     }
     assert.ok(results.every(result=>result.ok));assert.equal(results[0].record.export_id,results[1].record.export_id);
     const own=results[0].record.export_id,other=await second.evaluate(other=>fixture.reserve(other),otherOwner);
     assert.equal(other.ok,true);assert.notEqual(other.record.export_id,own);assert.equal(other.record.owner,otherOwner);
     assert.equal((await first.evaluate(()=>fixture.reserve())).record.export_id,own);
     const saved=await first.evaluate(keys=>keys.map(key=>JSON.parse(localStorage.getItem(key))),[prefix+owner,prefix+otherOwner]);
     assert.deepEqual(saved.map(records=>records.length),[1,1]);
     assert.deepEqual(saved.map(records=>records[0].owner),[owner,otherOwner]);
     assert.ok(f.state.calls.every(call=>call.action==='list'));assert.equal(f.state.uploads.length,0);f.clean();
    }finally{await f.context.close();}
   });
   await t.test(device+': a real localStorage quota failure stops saving before backend preparation',async()=>{
    const f=await fixture(browser,mobile,{loseFirstCompletion:false});
    try{
     const page=await f.open();await generate(page);
     const filled=await page.evaluate(()=>{
      let failures=0,count=0;
      for(const size of [262144,32768,4096,512,64,1]){
       while(count<10000){try{localStorage.setItem('fixture-quota-'+count,'x'.repeat(size));count++;}
        catch(error){if(error.name!=='QuotaExceededError')throw error;failures++;break;}}
      }
      return {failures,count};
     });
     assert.ok(filled.failures>0&&filled.count<10000);
     await page.locator('#storeExport').click();
     await page.waitForFunction(()=>document.body.dataset.busy==='false'&&document.getElementById('exportStatus').textContent.includes('Wiederaufnahme kann'));
     assert.ok(f.state.calls.every(call=>call.action==='list'));assert.equal(f.state.uploads.length,0);
     assert.equal(await page.locator('#exportResult').isVisible(),true);assert.equal(await page.locator('#storeExport').isDisabled(),false);
     await page.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('fixture-quota-'))localStorage.removeItem(key);});
     await page.locator('#storeExport').click();await waitStored(page);
     assert.equal(f.state.rows.size,1);assert.equal(f.state.uploads.length,2);f.clean();
    }finally{await f.context.close();}
   });
  }
 }finally{await browser.close();}
});
