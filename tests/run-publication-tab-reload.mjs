// Run the actual editor through an iframe reload. The fixture has only a local, synthetic RPC client.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';

const fileId='a7700000-0000-4000-8000-000000000011';
const client=`
const file={id:'${fileId}',revision:'version:1',media_kind:'video',name:'Testvideo.webm',mime_type:'video/webm',verified_at:new Date().toISOString(),
 assignments:[{platform:'youtube',revision:4,status:'assigned'}]};
const draft={platform:'youtube',title:'Gespeichert',body:'Mein früherer Beitragstext.',hashtags:[],review_notes:[],caption:'Mein früherer Beitragstext.'};
const saved={ok:true,status:'completed',id:'a7700000-0000-4000-8000-000000000022',revision:1,assignment_revision:4,
 preview:{can_publish:false,language:'de',shop_url:'https://sma-automation.com/app/shop.html?shop=fixture',drafts:[draft]}};
let offline=false;
export function createClient(){return {auth:{onAuthStateChange(){},getSession:async()=>({data:{session:{user:{id:'fixture-owner'},access_token:'fixture'}}})},
 rpc(name,args){
  const call=(async()=>{
   if(name==='sma_publication_joint_plan_v1') {
     const channels=[{platform:'youtube',target:'YouTube-Test',order_state:'checked'},{platform:'tiktok',target:'Testkonto',order_state:'blocked'}];
     if(args.p_action==='save')sessionStorage.jointTime=args.p_time;
     return {data:{ok:true,channels,version:sessionStorage.jointTime?1:0,desired_at:sessionStorage.jointTime||null}};
   }
   if(name==='sma_publication_order_v1'){
    const order=window.fixtureTargetOrder;
    if(args.p_action!=='get'||!order||args.p_input?.id!==order.id||Object.keys(args.p_input).length!==1)throw Error('Unexpected synthetic stored-order action');
    sessionStorage.fixtureStoredOrderReads=String(Number(sessionStorage.fixtureStoredOrderReads||0)+1);
    return {data:structuredClone(order)};
   }
   if(name==='sma_publication_history_order_page_v1'){
    const stored=sessionStorage.fixtureTransferStatus;
    const status=stored?.startsWith('uncertain')?'uncertain':stored;
    const date='2026-11-07T10:00:00Z';
    const row={id:args.p_order_id,status,platform:'youtube',title:'Gespeichert',target_name:'Testkanal',
     created_at:date,updated_at:date,cover:{status:'not_recorded',updated_at:null}};
    if(status==='missing')return {data:{ok:false,code:'ORDER_UNAVAILABLE'}};
    if(status==='wrong_order')Object.assign(row,{id:'a7700000-0000-4000-8000-000000000099',status:'private_complete'});
    return {data:{ok:true,version:3,...(stored==='uncertain_resumable'?{can_reconcile_transfer:true}:stored==='uncertain_blocked'?{can_reconcile_transfer:false}:{}),timezone:'Europe/Vienna',month:'2026-11',
     summary:{orders:1,public_confirmed:0,platforms:['youtube']},months:[],entries:[row],has_more:false,next:null}};
   }
   if(name==='sma_publication_files_v1'){
    if(args.p_action==='list')return {data:{ok:true,files:[file]}};
    if(args.p_action==='save'){
     sessionStorage.fixtureWrites=String(Number(sessionStorage.fixtureWrites||0)+1);
     if(!sessionStorage.fixtureReload){offline=true;throw Error('lost reply');}
     if(args.p_input.assignment_revision!==saved.assignment_revision)return {data:{ok:false,code:'ASSIGNMENT_CONFLICT'}};
     const {title,body,hashtags}=args.p_input;Object.assign(draft,{title,body,hashtags,caption:body});
     saved.revision++;file.assignments[0].revision=++saved.assignment_revision;return {data:saved};
    }
    if(args.p_action==='get'){
     if(offline)throw Error('offline');
     if(sessionStorage.fixtureNewerPost){return {data:{...saved,revision:saved.revision+1,assignment_revision:saved.assignment_revision+1,
      preview:{...saved.preview,drafts:[{...draft,title:'Späterer Titel'}]}}};}
     return {data:saved};
    }
   }
   return {data:{ok:false,code:'UNAVAILABLE'}};
  })();
  call.abortSignal=()=>call;return call;
 }};}`;

// Keep the real file-job client. Only its transport is local: commands have
// immutable stored responses. A deliberate retry is a new command in the same
// job; direct order-status reads never repeat the account or preparation work.
const fileJobTransport=`
const fixtureJobs=new Map(),fixtureCommands=new Map();
const fixtureCount=name=>{sessionStorage[name]=String(Number(sessionStorage[name]||0)+1);};
async function fixtureFileJobFetch(url,options){
 const path=new URL(url).pathname,body=JSON.parse(options.body);
 if(path==='/rest/v1/rpc/sma_file_job_v1'){
  const input=body.p_input;
  if(body.p_action==='start'){
   if(input.anchor?.kind!=='asset'||input.anchor.asset_id!=='${fileId}'||input.anchor.asset_revision!=='version:1')throw Error('Unexpected synthetic file binding');
   const key=JSON.stringify(input.anchor);
   if(!fixtureJobs.has(key)){
    fixtureCount('fixtureJobStarts');
    fixtureJobs.set(key,{ok:true,job_id:crypto.randomUUID(),state:'running',deadline_at:new Date(Date.now()+86400000).toISOString()});
   }
   return Response.json({...fixtureJobs.get(key),commands:[]});
  }
  if(body.p_action!=='get')throw Error('Unexpected synthetic job action');
  const job=[...fixtureJobs.values()].find(j=>j.job_id===input.job_id);
  if(!job)throw Error('Unknown synthetic job');
  fixtureCount('fixtureJobReads');
  const command=fixtureCommands.get(input.command_id);
  if(command&&command.job_id!==job.job_id)throw Error('Synthetic command belongs to another job');
  return Response.json({...job,commands:command?[{command_id:input.command_id,operation:command.operation,state:command.state,response:command.response}]:[]});
 }
 if(path!=='/functions/v1/sma-file-job'||!['account','order_prepare'].includes(body.operation))throw Error('Unexpected synthetic order action');
 if(![...fixtureJobs.values()].some(j=>j.job_id===body.job_id))throw Error('Unknown synthetic command job');
 const signature=JSON.stringify({job_id:body.job_id,operation:body.operation,input:body.input});
 let command=fixtureCommands.get(body.command_id);
 if(command&&command.signature!==signature)throw Error('Synthetic command conflict');
 if(!command){
  command={signature,job_id:body.job_id,operation:body.operation,state:'running',response:null};
  fixtureCommands.set(body.command_id,command);fixtureCount('fixtureJobCommands');
  sessionStorage.fixtureOrderActions=[sessionStorage.fixtureOrderActions,body.operation].filter(Boolean).join(',');
  if(body.operation==='order_prepare'){
   const order=window.fixtureTargetOrder,attempts=JSON.parse(sessionStorage.fixturePrepareCommands||'[]');
   if(!order||signature!==JSON.stringify({job_id:body.job_id,operation:'order_prepare',input:{id:order.id,...order.binding,choices:order.choices}}))throw Error('Unexpected synthetic prepare binding');
   if(attempts.length>=2)throw Error('Unexpected additional preparation command');
   attempts.push({job_id:body.job_id,command_id:body.command_id,input:body.input});
   sessionStorage.fixturePrepareCommands=JSON.stringify(attempts);
   if(attempts.length===1){
    command.state='failed';command.response={status:200,body:{ok:false,can_upload:false,can_publish:false,code:'TARGET_CHECK_UNAVAILABLE'}};
   }else{
    window.fixtureTargetOrder={...order,state:'prepared',preparation_window:null,
     target:{id:'fixture-channel',platform:'youtube',name:'Testkanal'},
     account_check:{target_id:'fixture-channel',platform:'youtube',display_name:'Testkanal',policy:{}},
     approval_policy:'media-consent-2026-11-03.1',approval_token:'synthetic-order-token',
     approval_window:{status:'active',expires_at:new Date(Date.now()+1800000).toISOString()}};
    command.state='completed';command.response={status:200,body:structuredClone(window.fixtureTargetOrder)};
   }
  }else if(sessionStorage.fixtureFailAccount){
   sessionStorage.removeItem('fixtureFailAccount');command.state='failed';
   command.response={status:200,body:{ok:false,code:'TARGET_CHECK_UNAVAILABLE'}};
  }else{
   if(window.fixtureAccountHold){window.fixtureAccountStarted();await window.fixtureAccountHold;}
   command.state='completed';command.response={status:200,body:{ok:true,id:body.input.id,stage:'account',can_upload:false,can_publish:false,
    target:{id:'fixture-channel',platform:'youtube'},account_check:{target_id:'fixture-channel',display_name:'Testkanal',policy:{}}}};
  }
 }
 return Response.json({ok:true,job_id:body.job_id,command_id:body.command_id,accepted:true});
}`;

const exercise=`
try{
 const body=document.getElementById('youtube-body'),pending='Lokale Korrektur aus dem vorherigen Seitenaufruf.';
  function until(test,root=document.body){
   if(test())return Promise.resolve();
   return new Promise(resolve=>{
    const observer=new MutationObserver(()=>{if(test()){observer.disconnect();resolve();}});
    observer.observe(root,{attributes:true,childList:true,subtree:true});
   });
  }
 if(!sessionStorage.fixtureReload){
  if(!body)throw Error('Editor did not open');
  const frame=window.frameElement;
  await until(()=>$('filePickerList')?.querySelector('.gallery-select'));
  $('filePickerList').querySelector('.gallery-select').click();await until(()=>frame.dataset.view==='preview',frame);
  const returned=new Promise(resolve=>parent.addEventListener('popstate',resolve,{once:true}));
  $('workspaceEditPost').click();await returned;
  if(parent.history.state?.view!=='source'||$('workspaceSource').hidden||document.activeElement!==body)throw Error('Editing lost the selected text field');
  if($('jointPlan').hidden||!$('workspacePreparationTools').contains($('jointPlan'))||$('workspacePostView').contains($('jointPlan')))throw Error('Private Terminplanung am falschen Ort');
  $('jointPlan').querySelector('summary').click();
  await until(()=>$('jointPlanChannels').textContent.includes('Testkonto'));
  $('jointPlanTime').value='2099-07-25T15:45';
  $('jointPlanTime').dispatchEvent(new Event('input'));
  $('jointPlanSave').click();
  await until(()=>$('jointPlanStatus').textContent==='Gemeinsamer Terminentwurf gespeichert.');
  if(sessionStorage.jointTime!=='2099-07-25T13:45:00.000Z')throw Error('Falscher UTC-Zeitpunkt');
  $('jointPlan').querySelector('summary').click();
  const original=body.value,source=$('source_text'),initialSource=source.value;
  const type=(field,value)=>{field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));};
  type(body,pending);type(source,'Beschreibung in Bearbeitung.');type(body,original);
  if(!$('save').disabled)throw Error('Reverted body still needs a save');
  $('workspacePreviewEdits').click();await until(()=>frame.dataset.view==='preview',frame);
  if($('workspaceDraftAction').textContent!=='Inhaltsangaben öffnen')throw Error('Remaining source edit was lost');
  const editorReturn=new Promise(resolve=>parent.addEventListener('popstate',resolve,{once:true}));
  $('workspaceDraftAction').click();await editorReturn;type(source,initialSource);
  $('workspacePreviewEdits').click();await until(()=>frame.dataset.view==='preview',frame);
  if($('preparePublicationOrder').hidden||!$('workspaceDraftAction').hidden||sessionStorage.fixtureWrites)throw Error('Fully reverted form requested another write');
  const editAgain=new Promise(resolve=>parent.addEventListener('popstate',resolve,{once:true}));
  $('workspaceEditPost').click();await editAgain;type(body,pending);
  $('workspacePreviewEdits').click();await until(()=>frame.dataset.view==='preview',frame);
  if($('workspacePostCaption').textContent!==pending||sessionStorage.fixtureWrites)throw Error('Edited preview saved or showed stale text');
  parent.history.back();await until(()=>!$('workspaceSource').hidden);
  if(body.value!==pending||$('youtube-body')!==body)throw Error('Browser Back lost the draft');
  $('workspacePreviewEdits').click();await until(()=>frame.dataset.view==='preview',frame);
  if(!$('preparePublicationOrder').hidden||$('workspaceDraftAction').textContent!=='Entwurf speichern')throw Error('Unstored post offers preparation');
  const unresolved=new Promise(resolve=>{
   const observer=new MutationObserver(()=>{if(!busy&&!document.getElementById('checkDraftSave').hidden){
    observer.disconnect();resolve();
   }});
   observer.observe(document.body,{attributes:true,childList:true,subtree:true});
  });
  $('workspaceDraftAction').click();await unresolved;
  if($('workspaceDraftAction').textContent!=='Speicherstand prüfen'||!$('preparePublicationOrder').hidden)throw Error('Lost reply offered another save');
  sessionStorage.fixtureReload='1';location.reload();
 }else{
  const report={type:'reload-result',restored:body?.value===pending,notice:$('saveStatus').textContent,ready:!busy&&!$('save').disabled};
  const dialog=$('draftReloadDialog');
  const checkpoint=()=>tabDrafts.read(selectedPortal,previewOwnerId,draftRoute());
  async function openChoice(){
   $('loadLatest').click();await until(()=>dialog.open||!busy);
   if(!dialog.open)throw Error('Missing reload choice: '+$('status').textContent);
  }
  await openChoice();
  report.previewShown=$('draftReloadPreview').textContent.includes('Mein früherer Beitragstext.')&&document.activeElement===$('keepDraftEdits');
  $('keepDraftEdits').click();await until(()=>!busy);
  report.kept=body.value===pending&&checkpoint()?.form.body===pending&&!dialog.open;
  await openChoice();$('useStoredDraft').click();await until(()=>!busy);
  report.loaded=$('youtube-body').value==='Mein früherer Beitragstext.'&&!checkpoint()&&!dialog.open;
  report.writes=Number(sessionStorage.fixtureWrites);
  const updated=$('youtube-body'),newText='Jetzt ausdrücklich in der Vorschau gespeichert.';
  const tags=$('youtube-hashtags');
  tags.value='#Doppelt #Doppelt';tags.dispatchEvent(new Event('input',{bubbles:true}));
  const frame=window.frameElement;
  $('workspacePreviewEdits').click();await until(()=>frame.dataset.view==='preview',frame);
  if($('workspaceDraftAction').textContent!=='Hashtags korrigieren'||!$('workspaceDraftNotice').textContent.includes('doppelt')||
   !$('preparePublicationOrder').hidden||$('workspacePostTags').textContent!==tags.value)throw Error('Missing duplicate hashtag guidance');
  const correcting=new Promise(resolve=>parent.addEventListener('popstate',resolve,{once:true}));
  $('workspaceDraftAction').click();await correcting;
  if(document.activeElement!==tags||$('workspaceSource').hidden||Number(sessionStorage.fixtureWrites)!==1||!tags.validity.customError)throw Error('Correction did not reach the original hashtag input');
  tags.value='#Aktuell';tags.dispatchEvent(new Event('input',{bubbles:true}));
  if(tags.validity.customError)throw Error('Corrected hashtags still have an error');
  updated.value=newText;updated.dispatchEvent(new Event('input',{bubbles:true}));$('workspacePreviewEdits').click();
  const action=$('workspaceDraftAction'),prepare=$('preparePublicationOrder');
  const offered=!action.hidden&&action.textContent==='Entwurf speichern'&&prepare.hidden;
  action.click();action.click();await until(()=>!busy);
  report.savedInPreview=offered&&!$('workspacePreview').hidden&&action.hidden&&!prepare.hidden&&!prepare.disabled&&
   $('workspacePostCaption').textContent===newText&&$('workspaceDraftNotice').textContent==='Gespeicherter Entwurf'&&
   !$('publicationOrderDialog').open&&Number(sessionStorage.fixtureWrites)===2;
  // The real file-job path has local account and explicitly bound preparation workers.
  const review=$('publicationOrderDialog'),reviewButton=text=>[...review.querySelectorAll('button')].find(b=>b.textContent===text);
  const retry=reviewButton('Zielkonto erneut prüfen'),close=reviewButton('Schließen');
  sessionStorage.fixtureFailAccount='1';prepare.click();await until(()=>!retry.hidden&&!retry.disabled);
  if(!review.open||!review.querySelector('form').hidden||sessionStorage.fixtureOrderActions!=='account')throw Error('Account check retry missing');
  let finish;window.fixtureAccountHold=new Promise(resolve=>{finish=resolve;});
  const started=new Promise(resolve=>{window.fixtureAccountStarted=resolve;});retry.click();await started;
  if(close.disabled)throw Error('Cannot leave a pending account lookup');
  close.click();if(review.open)throw Error('Account lookup keeps the dialog open');
  prepare.click();finish();await until(()=>!review.querySelector('form').hidden);
  const summary=review.querySelector('.order-caption');summary.querySelector('summary').click();
  report.reviewedStoredPost=review.open&&summary.open&&summary.querySelector('pre').textContent===newText&&
   review.querySelector('h3').textContent===$('youtube-title').value&&review.textContent.includes('Testvideo.webm')&&
   review.textContent.includes('Testkanal · fixture-channel')&&sessionStorage.fixtureOrderActions==='account,account';
  sessionStorage.fixtureNewerPost='1';$('order-visibility').value='private';
  $('order-made_for_kids').value='false';$('order-contains_synthetic_media').value='false';
  review.querySelector('form').requestSubmit();await until(()=>!review.open);
  report.staleStopped=document.activeElement===$('loadLatest')&&$('sourcePanel').open&&!$('workspaceSource').hidden&&
   $('youtube-title').value!=='Späterer Titel'&&sessionStorage.fixtureOrderActions==='account,account';
  sessionStorage.removeItem('fixtureNewerPost');
  const storedPost=current.preview.drafts.find(draft=>draft.platform===selectedPortal);
  window.fixtureTargetOrder={ok:true,id:'a7700000-0000-4000-8000-000000000044',
   binding:{...fileContext(),preview_id:current.id,preview_revision:current.revision},
   choices:{visibility:'private',made_for_kids:false,contains_synthetic_media:false},
   draft:{title:storedPost.title,caption:storedPost.caption},state:'preparing',approved_at:null,
   target:null,account_check:null,approval_token:null,approval_window:null,can_upload:false,can_publish:false,
   preparation_window:{status:'active',expires_at:new Date(Date.now()+1800000).toISOString()}};
  if(!orderReview.resumePrepared(structuredClone(window.fixtureTargetOrder)))throw Error('Pending history order did not open');
  const checkTarget=reviewButton('Zielkonto prüfen'),reloadOrder=reviewButton('Status erneut laden'),approve=reviewButton('Veröffentlichung freigeben');
  if(!review.open||checkTarget.disabled||!approve.hidden)throw Error('Pending order offers the wrong customer action');
  checkTarget.click();await until(()=>!reloadOrder.disabled);
  if(!review.textContent.includes('Bitte versuche es später erneut')||Number(sessionStorage.fixtureJobCommands)!==3||
   window.fixtureTargetOrder.state!=='preparing')throw Error('First target check did not preserve the pending order');
  const directReads=Number(sessionStorage.fixtureStoredOrderReads),jobReads=Number(sessionStorage.fixtureJobReads);
  reloadOrder.click();await until(()=>!reloadOrder.disabled);
  const statusReadOnly=Number(sessionStorage.fixtureStoredOrderReads)===directReads+1&&
   Number(sessionStorage.fixtureJobReads)===jobReads&&Number(sessionStorage.fixtureJobCommands)===3;
  if(!statusReadOnly)throw Error('Order status refresh repeated preparation work');
  if(checkTarget.disabled)throw Error('Confirmed target failure cannot be retried');
  checkTarget.click();checkTarget.click();await until(()=>!reloadOrder.disabled);
  const attempts=JSON.parse(sessionStorage.fixturePrepareCommands||'[]');
  report.targetRetry={prepared:window.fixtureTargetOrder.state==='prepared',statusReadOnly,
   sameJob:attempts.length===2&&attempts[0].job_id===attempts[1].job_id,
   sameOrder:attempts.length===2&&JSON.stringify(attempts[0].input)===JSON.stringify(attempts[1].input)&&attempts[1].input.id===window.fixtureTargetOrder.id,
   newCommand:attempts.length===2&&attempts[0].command_id!==attempts[1].command_id,
   unapproved:!approve.hidden&&approve.disabled&&!$('order-final-consent').checked&&window.fixtureTargetOrder.approved_at===null};
  if(sessionStorage.fixtureOrderActions!=='account,account,order_prepare,order_prepare')throw Error('Target recovery started an unexpected order action');
  report.fileJobs={starts:Number(sessionStorage.fixtureJobStarts),commands:Number(sessionStorage.fixtureJobCommands),reads:Number(sessionStorage.fixtureJobReads)};
  const historyId='a7700000-0000-4000-8000-000000000033';
  for(const [stored,expected,canContinue] of [['checked','noch kein Übertragungsversuch',true],['private_complete','Privat abgeschlossen',true],['uncertain_blocked','Ergebnis unklar',false],['uncertain','Ergebnis unklar',false],['uncertain_resumable','Ergebnis unklar',false]]){
   sessionStorage.fixtureTransferStatus=stored;
   const state=await readTransferStatus(historyId,'youtube');
   if(!state.message.includes(expected)||state.canContinue!==canContinue)throw Error('Wrong transfer status: '+stored);
  }
  for(const [stored,platform] of [['missing','youtube'],['wrong_order','youtube'],['private_complete','tiktok']]){
   sessionStorage.fixtureTransferStatus=stored;
   let rejected=false;
   try{await readTransferStatus(historyId,platform);}catch{rejected=true;}
   if(!rejected)throw Error('Unbound history result displayed');
  }
  parent.postMessage(report,location.origin);
 }
}catch(error){parent.postMessage({type:'reload-result',error:String(error)},location.origin);}`;
// Use the dashboard's actual frame and history handlers around the synthetic editor.
const dashboard=await readFile(new URL('../app/dashboard.html',import.meta.url),'utf8');
const navigation=dashboard.slice(dashboard.indexOf('let optimizerFrames='),dashboard.indexOf('// Extend the existing portal cards'));
const host=`<!DOCTYPE html><main><button id="optimize">Optimieren</button></main><script>
const portalNames={youtube:'YouTube'};
${navigation}
attachOptimizerPage(document,document.querySelector('main'));
addEventListener('message',event=>{
 const frame=optimizerFrames.firstElementChild;
 if(event.origin!==location.origin||event.source!==frame?.contentWindow)return;
 if(event.data?.type==='sma-publication-workspace-view')optimizerWorkspaceView(frame,event.data.view,event.data.previewUnavailable===true);
 if(event.data?.type==='reload-result'){const o=document.createElement('output');o.textContent=JSON.stringify(event.data);document.body.append(o);}
});
selectedFileId='${fileId}';openOptimizer('youtube',document.getElementById('optimize'));
</script>`;
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  const send=(type,body)=>{res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store',
   'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data: blob:"});res.end(body);};
  if(path==='/app/dashboard.html')return send('text/html',host);
  if(path==='/client.mjs')return send('text/javascript',client);
  if(path!=='/app/publication-preview.html'&&!/^\/app\/assets\/[\w.-]+\.(css|m?js)$/.test(path)){res.writeHead(404).end();return;}
  let source=await readFile(new URL('..'+path,import.meta.url),'utf8');
  if(path==='/app/assets/file-job-client.mjs'){
   assert.equal(source.split('fetcher=fetch').length,2,'File-job transport injection must match exactly once');
   source=source.replace('fetcher=fetch','fetcher=fixtureFileJobFetch')+fileJobTransport;
  }
  if(path==='/app/assets/publication-preview.js')source=source.replace("import('https://esm.sh/@supabase/supabase-js@2')","import('/client.mjs')")+exercise;
  send(path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'text/javascript',source);
 }catch{res.writeHead(500).end();}
});
const profile=await mkdtemp(join(tmpdir(),'sma-tab-reload-'));
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const {stdout}=await promisify(execFile)(process.env.CHROME_BIN||'google-chrome',[
  '--headless','--disable-gpu','--disable-background-networking','--disable-dev-shm-usage','--no-sandbox',
  '--user-data-dir='+profile,'--virtual-time-budget=12000','--dump-dom','http://127.0.0.1:'+server.address().port+'/app/dashboard.html'
 ],{timeout:45000,maxBuffer:2*1024*1024});
 const match=stdout.match(/<output>([^<]+)<\/output>/);assert.ok(match,'Reloaded editor did not report its state: '+stdout.slice(-500));
 const result=JSON.parse(match[1]);assert.equal(result.restored,true,JSON.stringify(result));assert.equal(result.ready,true);
 assert.match(result.notice,/wiederhergestellt/);assert.equal(result.writes,1);
 assert.ok(result.previewShown&&result.kept&&result.loaded&&result.savedInPreview&&result.reviewedStoredPost&&result.staleStopped,JSON.stringify(result));
 assert.deepEqual(result.targetRetry,{prepared:true,statusReadOnly:true,sameJob:true,sameOrder:true,newCommand:true,unapproved:true});
 assert.equal(result.fileJobs.starts,1);assert.equal(result.fileJobs.commands,4);assert.ok(result.fileJobs.reads>=5);
 console.log('Chromium preserved preview edits and recovered a target check through the real page adapter without another file job or approval.');
}finally{server.close();await rm(profile,{recursive:true,force:true});}
