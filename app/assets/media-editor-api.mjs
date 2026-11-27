import {createMusicLibraryAPI} from './music-library-api.mjs?v=4';
import {refreshMediaCatalog} from './media-metadata.mjs?v=3';
import {syncSharedCatalogRefreshOwner} from './catalog-refresh.mjs?v=1';
import {createSharedThumbnailClient} from './thumbnail-batch.mjs?v=1';
import {createFileJobClient} from './file-job-client.mjs?v=1';
import {transferDeviceFile} from './device-upload.mjs?v=1';
import {createSharedOriginalMediaClient,syncSharedOriginalMediaOwner} from './original-media-cache.mjs?v=1';
import {editorUUID} from './media-editor-model.mjs?v=2';
const origin='https://bnvnmdxosbnuzedokqgh.supabase.co',key='sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW';let client,authPending;
async function auth(){if(!client){if(!authPending)authPending=import('https://esm.sh/@supabase/supabase-js@2.57.4').then(({createClient})=>{client=createClient(origin,key);client.auth.onAuthStateChange((event,s)=>{syncSharedOriginalMediaOwner(s?.user?.id||null,undefined,{initial:event==='INITIAL_SESSION'});syncSharedCatalogRefreshOwner(s?.user?.id||null,undefined,{initial:event==='INITIAL_SESSION'});});return client;}).catch(error=>{authPending=null;throw error;});await authPending;}return client;}
async function session(owner){const {data,error}=await (await auth()).auth.getSession();if(error||!data?.session||owner&&data.session.user.id!==owner)throw Error('AUTH_REQUIRED');return data.session;}
const fileJobs=createFileJobClient({session});let originalMedia=null,thumbnailOwner=null,thumbnails=null;
globalThis.window?.addEventListener('pagehide',()=>{originalMedia?.dispose();originalMedia=null;});
export const editorMusicLibrary=owner=>createMusicLibraryAPI({owner,getSession:()=>session(owner),includeCatalog:true});
export async function getOwnerId(){try{return (await session()).user.id;}catch{return null;}}
export async function watchOwner(callback){return (await auth()).auth.onAuthStateChange((_event,s)=>{if(thumbnailOwner!==s?.user?.id){thumbnails?.dispose();thumbnails=null;thumbnailOwner=null;fileJobs.clear();}callback(s?.user?.id||null);}).data.subscription;}
async function rpc(name,body,owner,signal){signal?.throwIfAborted();const s=await session(owner);signal?.throwIfAborted();const response=await fetch(origin+'/rest/v1/rpc/'+name,{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(15000)]),headers:{'Content-Type':'application/json',apikey:key,Authorization:'Bearer '+s.access_token},body:JSON.stringify(body)});if(!response.ok)throw Error(response.status===401?'AUTH_REQUIRED':'UNAVAILABLE');return response.json();}
export const galleryMusicRequest=(action,input,owner,signal)=>rpc('sma_gallery_music_v1',{p_action:action,p_input:input},owner,signal);
export const editorRequest=(action,input,owner,signal)=>rpc('sma_publication_editor_v1',{p_action:action,p_input:input},owner,signal);
export const editorFiles=(owner,signal)=>rpc('sma_publication_files_v1',{p_action:'list',p_input:{dashboard_labels:true}},owner,signal);
export const editorFileByDriveId=(driveId,owner,signal)=>rpc('sma_editor_drive_file_v1',{p_drive_file_id:driveId},owner,signal);
export async function editorDriveFolder(owner){
 const current=await session(owner);
 const response=await fetch(origin+'/functions/v1/sma-editor-drive-folder',{method:'POST',cache:'no-store',credentials:'omit',redirect:'error',
  headers:{apikey:key,Authorization:'Bearer '+current.access_token},signal:AbortSignal.timeout(45000)});
 const result=await response.json();await session(owner);
 if(!response.ok||typeof result?.folder_id!=='string'||!/^[a-zA-Z0-9_-]{10,200}$/.test(result.folder_id))throw Error(response.status===429?'RATE_LIMITED':'FOLDER_UNAVAILABLE');
 return 'https://drive.google.com/drive/folders/'+result.folder_id;
}
export const editorPilotAccess=owner=>rpc('sma_customer_media_pilot_v1',{p_route:'eligible'},owner);
function editorRefreshScope(parent){
 // A finished folder sync does not reset the deadline for its saved-list and
 // final-session reads. Late SDK/body replies are consumed after cancellation.
 const controller=new AbortController(),signal=controller.signal,expires=Date.now()+90000;
 const failure=code=>Object.assign(Error(code),{code});
 const abort=reason=>{if(!signal.aborted)controller.abort(reason||failure('FILE_SYNC_ABORTED'));};
 const parentAbort=()=>abort(parent.reason);
 const timer=setTimeout(()=>abort(failure('FILE_SYNC_TIMEOUT')),90000);
 parent?.addEventListener('abort',parentAbort,{once:true});if(parent?.aborted)parentAbort();
 const check=()=>{if(Date.now()>=expires)abort(failure('FILE_SYNC_TIMEOUT'));signal.throwIfAborted();};
 function read(start){
  return new Promise((resolve,reject)=>{
   let settled=false;
   const finish=(callback,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',onAbort);callback(value);};
   const onAbort=()=>finish(reject,signal.reason||failure('FILE_SYNC_ABORTED'));
   if(signal.aborted)return onAbort();signal.addEventListener('abort',onAbort,{once:true});
   Promise.resolve().then(()=>{check();return start();})
    .then(value=>{try{check();finish(resolve,value);}catch(error){finish(reject,error);}},error=>finish(reject,error));
  });
 }
 return {signal,read,close(){clearTimeout(timer);parent?.removeEventListener('abort',parentAbort);}};
}
export async function editorRefreshFiles(owner,signal){
 const scope=editorRefreshScope(signal);
 try{
  await scope.read(()=>refreshMediaCatalog({getSession:()=>session(owner),
   readStatus:sharedSignal=>rpc('sma_publication_files_v1',{p_action:'sync_status',p_input:{}},owner,sharedSignal),owner,signal:scope.signal}));
  const result=await scope.read(()=>editorFiles(owner,scope.signal));
  await scope.read(()=>session(owner));scope.signal.throwIfAborted();return result;
 }finally{scope.close();}
}
export async function editorThumbnail(file,signal,owner){
 const current=(await session(owner)).user.id;
 if(!thumbnails||thumbnailOwner!==current){thumbnails?.dispose();thumbnailOwner=current;thumbnails=createSharedThumbnailClient({getSession:()=>session(current),getOwnerId:()=>thumbnailOwner});}
 const blob=await thumbnails.request(file,signal);await session(owner);signal?.throwIfAborted();return blob;
}
export const exportRequest=(action,input,owner)=>rpc('sma_publication_editor_export_v1',{p_action:action,p_input:input},owner);
export function editorSource(file,signal,owner){originalMedia??=createSharedOriginalMediaClient({getSession:()=>session()});return originalMedia.request(file,{owner,signal});}
export async function uploadExport(blob,artifact,signal,owner,onProgress=()=>{},portal=null){
 const call=async(action)=>{
  signal.throwIfAborted();await session(owner);
  const meta={name:artifact.name,mime_type:artifact.mime_type,size_bytes:blob.size};
  const response=await fileJobs.request({anchor:{kind:'upload',upload_id:artifact.upload_id,...meta},operation:action==='start'?'upload_start':'upload_finish',input:{upload_id:artifact.upload_id,...(action==='start'?meta:{})},signal,timeoutMs:90000});
  if(!response.ok)throw Error('UPLOAD_UNAVAILABLE');const r=await response.json();if(r?.ok!==true)throw Error(r?.code||'UPLOAD_UNAVAILABLE');if(r.upload_id!==artifact.upload_id||r.can_publish!==false||!['ready','completed'].includes(r.status)||r.status==='completed'&&!editorUUID(r.asset_id))throw Error('UPLOAD_UNAVAILABLE');await session(owner);return r;
 };
 const started=await call('start');
 if(portal){
  const bound=await rpc('sma_publication_upload_portal_v1',{p_upload:artifact.upload_id,p_platform:portal},owner,signal);
  if(bound!==true)throw Error('UPLOAD_PORTAL_UNAVAILABLE');
 }
 if(started.status==='completed')return started.asset_id;
 await transferDeviceFile({file:blob,url:started.upload_url,mime:artifact.mime_type,signal,onProgress});
 const completed=await call('finish');if(completed.status!=='completed')throw Error('UPLOAD_INCOMPLETE');return completed.asset_id;
}
