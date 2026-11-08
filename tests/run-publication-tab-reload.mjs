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
  $('workspaceViewFile').click();await until(()=>frame.dataset.view==='preview',frame);
  const returned=new Promise(resolve=>parent.addEventListener('popstate',resolve,{once:true}));
  $('workspaceEditPost').click();await returned;
  if(parent.history.state?.view!=='source'||$('workspaceSource').hidden||document.activeElement!==body)throw Error('Editing lost the selected text field');
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
  const dialog=$('draftReloadDialog'),recordKey='sma.publication.pending-save.v1.youtube';
  async function openChoice(){
   $('loadLatest').click();await until(()=>dialog.open||!busy);
   if(!dialog.open)throw Error('Missing reload choice: '+$('status').textContent);
  }
  await openChoice();
  report.previewShown=$('draftReloadPreview').textContent.includes('Mein früherer Beitragstext.')&&document.activeElement===$('keepDraftEdits');
  $('keepDraftEdits').click();await until(()=>!busy);
  report.kept=body.value===pending&&!!sessionStorage.getItem(recordKey)&&!dialog.open;
  await openChoice();$('useStoredDraft').click();await until(()=>!busy);
  report.loaded=$('youtube-body').value==='Mein früherer Beitragstext.'&&!sessionStorage.getItem(recordKey)&&!dialog.open;
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
  // The fixture's order client has only an in-memory account response. Other actions fail the test.
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
 if(event.data?.type==='sma-publication-workspace-view')optimizerWorkspaceView(frame,event.data.view);
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
  if(path==='/app/assets/publication-order.mjs')source=source.replace('fetcher=fetch','fetcher=fixtureOrderFetch')+`
async function fixtureOrderFetch(_url,options){
 const {action,input}=JSON.parse(options.body);sessionStorage.fixtureOrderActions=[sessionStorage.fixtureOrderActions,action].filter(Boolean).join(',');
 if(action!=='account')throw Error('Unexpected synthetic order action');
 if(sessionStorage.fixtureFailAccount){sessionStorage.removeItem('fixtureFailAccount');throw new TypeError('Synthetic network failure');}
 if(window.fixtureAccountHold){window.fixtureAccountStarted();await window.fixtureAccountHold;}
 return {ok:true,json:async()=>({ok:true,id:input.id,stage:'account',can_upload:false,can_publish:false,
  target:{id:'fixture-channel',platform:'youtube'},account_check:{target_id:'fixture-channel',display_name:'Testkanal',policy:{}}})};
}`;
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
 console.log('Chromium distinguished a lost save from a confirmed preview save and kept order preparation separate.');
}finally{server.close();await rm(profile,{recursive:true,force:true});}
