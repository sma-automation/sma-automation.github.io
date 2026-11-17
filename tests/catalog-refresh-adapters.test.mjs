import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {refreshMediaCatalog} from '../app/assets/media-metadata.mjs';
import {clearSharedCatalogRefreshCache,CATALOG_REFRESH_READ_MS} from '../app/assets/catalog-refresh.mjs';
import {customerMediaEndpoint} from '../app/assets/customer-media-routes.mjs';

// Execute the current production adapters, including their error handling and
// follow-up reads. The coordinator is imported unchanged. The fake services
// below cannot reach n8n, Supabase, a payment service or a publishing endpoint.
const dashboardSource=readFileSync(new URL('../app/dashboard.html',import.meta.url),'utf8');
const publicationSource=readFileSync(new URL('../app/assets/publication-preview.js',import.meta.url),'utf8');
const editorSource=readFileSync(new URL('../app/assets/media-editor-api.mjs',import.meta.url),'utf8');
function between(source,start,end){
 const first=source.indexOf(start),last=source.indexOf(end,first+start.length);
 assert.ok(first>=0&&last>first,'Production extraction anchors must exist: '+start+' … '+end);
 return source.slice(first,last);
}
function sourceLine(source,start){
 const at=source.indexOf(start);assert.ok(at>=0,'Production line must exist: '+start);
 return source.slice(at,source.indexOf('\n',at));
}
const dashboardCode=[
 between(dashboardSource,'async function dashboardSession(','async function dashboardHtml('),
 between(dashboardSource,"const interruptedNotice=",' function finishReload('),
 between(dashboardSource,'function readCatalogWithin(',' function retryCatalog(')
].join('\n');
const publicationCode=[
 sourceLine(publicationSource,'const messages='),
 sourceLine(publicationSource,'Object.assign(messages,{FILE_UNAVAILABLE:'),
 sourceLine(publicationSource,'function errorText('),
 sourceLine(publicationSource,'async function session('),
 between(publicationSource,'function fileError(','function fileContext('),
 between(publicationSource,'async function syncFileCatalog(','function catalogFileIsFresh(')
].join('\n');
const editorCode=[
 sourceLine(editorSource,"const origin='"),
 sourceLine(editorSource,'async function session('),
 between(editorSource,'async function rpc(','export const galleryMusicRequest='),
 sourceLine(editorSource,'export const editorFiles='),
 // Includes the production refresh scope as well as editorRefreshFiles; its
 // deadline/cancellation behavior is not replaced by a fixture implementation.
 between(editorSource,'export const editorPilotAccess=','export async function editorThumbnail(')
].join('\n').replace(/^export /gm,'');

const owner='cc990000-0000-4000-8000-000000000091';
const nativeEndpoint=customerMediaEndpoint('catalog');
const apiEndpoint='https://bnvnmdxosbnuzedokqgh.supabase.co/rest/v1/rpc/sma_publication_files_v1';
const savedFile={id:'cc990000-0000-4000-8000-000000000093',name:'Gespeicherte Kundendatei.mp4',
 revision:'saved-catalogue-revision',media_kind:'video',assignments:[]};
const status=extra=>({ok:true,version:1,can_publish:false,sync_state:'idle',retry_after_ms:0,synced_at:null,...extra});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};

function fixture({preflight=status(),holdPost=false,nativeBody={ok:true},nativeStatus=200,listFailures=0}={}){
 const gate=deferred(),host={setTimeout,clearTimeout},calls=[],posts=[],notices=[],draws=[];
 const session={user:{id:owner},access_token:'synthetic-catalog-owner'};
 let remainingListFailures=listFailures;
 const listBody=()=>({ok:true,can_publish:false,files:[savedFile],sync_state:preflight.sync_state,synced_at:preflight.synced_at});
 function auth(adapter){return {getSession:async()=>{calls.push({adapter,action:'auth'});return {data:{session},error:null};}};}
 async function rpcReply(adapter,args,signal){
  signal?.throwIfAborted();
  assert.ok(['sync_status','list'].includes(args.p_action),'Unexpected synthetic RPC action: '+args.p_action);
  assert.deepEqual(JSON.parse(JSON.stringify(args.p_input)),args.p_action==='sync_status'?{}:{dashboard_labels:true});
  calls.push({adapter,action:args.p_action,signal});
  if(args.p_action==='sync_status')return {data:preflight,error:null};
  if(adapter==='dashboard'&&remainingListFailures>0){remainingListFailures--;return {data:null,error:Error('Synthetic saved-list outage')};}
  return {data:listBody(),error:null};
 }
 function supabase(adapter){return {auth:auth(adapter),rpc(name,args){
  assert.equal(name,'sma_publication_files_v1');let signal;
  return {abortSignal(value){assert.ok(value instanceof AbortSignal);signal=value;return this;},
   then(yes,no){return rpcReply(adapter,args,signal).then(yes,no);}};
 }};}
 function fetchFor(adapter){return async(url,init)=>{
  assert.equal(init.method,'POST');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
  assert.equal(new Headers(init.headers).get('Authorization'),'Bearer synthetic-catalog-owner');
  assert.ok(init.signal instanceof AbortSignal);init.signal.throwIfAborted();
  if(url===nativeEndpoint){
   assert.equal(init.body,undefined,'The adapter must not upload media or add a new request payload');
   calls.push({adapter,action:'native-post'});posts.push({adapter,url,init});
   if(holdPost)await gate.promise;
   return new Response(JSON.stringify(nativeBody),{status:nativeStatus,headers:{'Content-Type':'application/json'}});
  }
  assert.equal(url,apiEndpoint,'Every request must remain inside the synthetic catalogue services');
  assert.equal(adapter,'editor');
  const result=await rpcReply(adapter,JSON.parse(init.body),init.signal);
  return new Response(JSON.stringify(result.data),{status:result.error?503:200,headers:{'Content-Type':'application/json'}});
 };}
 function base(adapter){
  const fetch=fetchFor(adapter);
  return {AbortController,AbortSignal,Response,Headers,setTimeout,clearTimeout,Date,fetch,customerMediaEndpoint,
   supabase:supabase(adapter),CATALOG_REFRESH_READ_MS,
   // Inject only the host, clock and network boundary into the real helper.
   refreshMediaCatalog:options=>refreshMediaCatalog({...options,host,now:()=>1000,request:fetch,endpoint:()=>nativeEndpoint})};
 }
 const dashboard={...base('dashboard'),owner,dashboardOwnerId:owner,disposed:false,signedOut:false,
  loading:false,catalogState:'ready',catalogController:null,files:[savedFile],hasCatalog:true,
  retryStep:null,scanRunning:false,folderNotice:'',selectedFileId:savedFile.id,
  refresh:{textContent:'Dateien aktualisieren',disabled:false},dashboardQuickFind:null,
  // Presentation callbacks record what the unmodified load function produces;
  // no adapter, auth, refresh, error or retry decision is implemented here.
  say:text=>notices.push(text),draw:()=>draws.push(dashboard.files.slice()),finishReload:()=>false,wakeMusic:()=>{},
  connectionError:message=>Error(message),leaveDashboard:()=>{throw Error('Unexpected owner change in synthetic fixture');}};
 vm.createContext(dashboard);vm.runInContext(dashboardCode,dashboard,{filename:'production-dashboard-catalogue.js'});
 const publication={...base('publication'),signedOut:false,previewOwnerId:owner};
 vm.createContext(publication);vm.runInContext(publicationCode,publication,{filename:'production-publication-catalogue.js'});
 const editor={...base('editor')};editor.auth=async()=>({auth:auth('editor')});
 vm.createContext(editor);vm.runInContext(editorCode,editor,{filename:'production-editor-catalogue.js'});
 return {dashboard,publication,editor,calls,posts,notices,draws,
  start:adapter=>adapter==='dashboard'?dashboard.load(true):adapter==='publication'?publication.syncFileCatalog():editor.editorRefreshFiles(owner),
  release:()=>gate.resolve(),
  count:(action,adapter)=>calls.filter(call=>call.action===action&&(!adapter||call.adapter===adapter)).length,
  close(){gate.resolve();clearSharedCatalogRefreshCache(host);}};
}

test('the actual dashboard, publication and editor adapters share exactly one simultaneous native POST',async()=>{
 const f=fixture({holdPost:true});let combined;
 try{
  combined=Promise.all(['dashboard','publication','editor'].map(adapter=>f.start(adapter)));
  await flush();assert.equal(f.posts.length,1);assert.equal(f.count('sync_status'),1);
  assert.ok(f.calls.findIndex(call=>call.action==='sync_status')<f.calls.findIndex(call=>call.action==='native-post'));
  f.release();const results=await combined;
  assert.equal(f.posts.length,1);assert.equal(f.count('list','dashboard'),1);assert.equal(f.count('list','editor'),1);
  assert.equal(f.dashboard.catalogState,'ready');assert.deepEqual(f.dashboard.files,[savedFile]);
  assert.equal(f.dashboard.refresh.disabled,false);assert.deepEqual(results[2].files,[savedFile]);
  assert.equal(results[1],undefined);assert.equal(f.dashboard.folderNotice,'');
 }finally{f.close();await combined?.catch(()=>{});}
});

for(const first of ['dashboard','publication','editor'])test('the real '+first+' preflight can lead the shared refresh for the other two adapters',async()=>{
 const f=fixture({holdPost:true});const pending=[];
 try{
  pending.push(f.start(first));await flush();assert.equal(f.posts.length,1);assert.equal(f.count('sync_status',first),1);
  for(const adapter of ['dashboard','publication','editor'])if(adapter!==first)pending.push(f.start(adapter));
  await flush();assert.equal(f.posts.length,1);f.release();await Promise.all(pending);
  assert.equal(f.posts.length,1);assert.equal(f.count('sync_status'),1);
 }finally{f.close();await Promise.allSettled(pending);}
});

for(const [name,preflight,code,notice] of [
 ['running',status({sync_state:'running',retry_after_ms:120000}),'FILE_SYNC_RUNNING',/Ein Ordnerabgleich läuft bereits/],
 ['cooldown',status({sync_state:'complete',retry_after_ms:14999,synced_at:'2026-11-17T12:00:00Z'}),'FILE_SYNC_RATE_LIMITED',/Bitte warte kurz/]
])test('known '+name+' reaches each actual adapter without a native POST and retains the dashboard saved-list path',async()=>{
 // Separate fixtures make every adapter supply its own real status RPC; none
 // can pass only because another adapter happened to perform its preflight.
 for(const adapter of ['dashboard','publication','editor']){
  const f=fixture({preflight});try{
   if(adapter==='dashboard'){
    await f.start(adapter);assert.equal(f.dashboard.catalogState,'ready');assert.equal(f.count('list','dashboard'),1);
    assert.deepEqual(f.dashboard.files,[savedFile]);assert.match(f.notices.at(-1),notice);
    assert.match(f.notices.at(-1),/zuletzt gespeicherte Dateiliste/);assert.equal(f.dashboard.refresh.disabled,false);
    assert.equal(f.dashboard.refresh.textContent,name==='running'?'Abgleichstatus prüfen':'Dateien aktualisieren');
    const statusReads=f.count('sync_status');await f.dashboard.load(false);
    assert.equal(f.count('sync_status'),statusReads);assert.equal(f.count('list','dashboard'),2);
   }else{
    await assert.rejects(f.start(adapter),error=>{
     assert.equal(error.code,code);
     if(adapter==='publication')assert.match(error.message,name==='running'?/wird bereits aktualisiert/:/Bitte warte kurz/);
     else assert.equal(error.message,code);
     return true;
    });assert.equal(f.count('list',adapter),0);
   }
   assert.equal(f.count('sync_status',adapter),1);assert.equal(f.posts.length,0);
  }finally{f.close();}
 }
});

test('real publication and editor adapters retain useful backend codes and hide unknown backend details',async()=>{
 for(const [upstream,expected] of [
  ['FILE_CATALOG_TOO_LARGE','FILE_CATALOG_TOO_LARGE'],['FILE_METADATA_INVALID','FILE_METADATA_INVALID'],
  ['FOLDER_UNAVAILABLE','FOLDER_UNAVAILABLE'],['Synthetic internal database detail','FILE_SYNC_UNAVAILABLE']
 ])for(const adapter of ['publication','editor']){
  const f=fixture({nativeBody:{ok:false,code:upstream},nativeStatus:400});try{
   await assert.rejects(f.start(adapter),error=>{
    assert.equal(error.code,expected);
    if(adapter==='editor')assert.equal(error.message,expected);
    else{assert.notEqual(error.message,expected);assert.doesNotMatch(error.message,/Synthetic internal database detail/);}
    return true;
   });
   assert.equal(f.posts.length,1);assert.equal(f.count('sync_status',adapter),1);assert.equal(f.count('list',adapter),0);
  }finally{f.close();}
 }
});

test('the dashboard retries a failed saved-list read after a successful shared refresh without repeating n8n',async()=>{
 const f=fixture({listFailures:1});try{
  await f.dashboard.load(true);
  assert.equal(f.posts.length,1);assert.equal(f.dashboard.catalogState,'error');assert.equal(f.dashboard.retryStep,'catalog');
  assert.equal(f.dashboard.refresh.textContent,'Dateiliste erneut laden');assert.deepEqual(f.dashboard.files,[savedFile]);
  assert.match(f.notices.at(-1),/Dateiliste ist gerade nicht erreichbar/);assert.equal(f.draws.length,0);
  const statusReads=f.count('sync_status');await f.dashboard.load(false);
  assert.equal(f.posts.length,1);assert.equal(f.count('sync_status'),statusReads);assert.equal(f.count('list','dashboard'),2);
  assert.equal(f.dashboard.catalogState,'ready');assert.equal(f.dashboard.retryStep,null);
  assert.equal(f.dashboard.refresh.textContent,'Dateien aktualisieren');assert.deepEqual(f.dashboard.files,[savedFile]);
  assert.equal(f.draws.length,1);
 }finally{f.close();}
});
