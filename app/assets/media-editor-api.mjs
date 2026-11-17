import {createMusicLibraryAPI} from './music-library-api.mjs?v=3';
import {refreshMediaCatalog} from './media-metadata.mjs?v=2';
import {createSharedThumbnailClient} from './thumbnail-batch.mjs?v=1';
import {createFileJobClient} from './file-job-client.mjs?v=1';
import {transferDeviceFile} from './device-upload.mjs?v=1';
import {createSharedOriginalMediaClient,syncSharedOriginalMediaOwner} from './original-media-cache.mjs?v=1';
import {editorUUID} from './media-editor-model.mjs?v=2';
const origin='https://bnvnmdxosbnuzedokqgh.supabase.co',key='sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW';let client,authPending;
async function auth(){if(!client){if(!authPending)authPending=import('https://esm.sh/@supabase/supabase-js@2.57.4').then(({createClient})=>{client=createClient(origin,key);client.auth.onAuthStateChange((event,s)=>syncSharedOriginalMediaOwner(s?.user?.id||null,undefined,{initial:event==='INITIAL_SESSION'}));return client;}).catch(error=>{authPending=null;throw error;});await authPending;}return client;}
async function session(owner){const {data,error}=await (await auth()).auth.getSession();if(error||!data?.session||owner&&data.session.user.id!==owner)throw Error('AUTH_REQUIRED');return data.session;}
const fileJobs=createFileJobClient({session});let originalMedia=null,thumbnailOwner=null,thumbnails=null;
globalThis.window?.addEventListener('pagehide',()=>{originalMedia?.dispose();originalMedia=null;});
export const editorMusicLibrary=owner=>createMusicLibraryAPI({owner,getSession:()=>session(owner),includeCatalog:true});
export async function getOwnerId(){try{return (await session()).user.id;}catch{return null;}}
export async function watchOwner(callback){return (await auth()).auth.onAuthStateChange((_event,s)=>{if(thumbnailOwner!==s?.user?.id){thumbnails?.dispose();thumbnails=null;thumbnailOwner=null;fileJobs.clear();}callback(s?.user?.id||null);}).data.subscription;}
async function rpc(name,body,owner,signal){const s=await session(owner);const response=await fetch(origin+'/rest/v1/rpc/'+name,{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(15000)]),headers:{'Content-Type':'application/json',apikey:key,Authorization:'Bearer '+s.access_token},body:JSON.stringify(body)});if(!response.ok)throw Error(response.status===401?'AUTH_REQUIRED':'UNAVAILABLE');return response.json();}
export const galleryMusicRequest=(action,input,owner,signal)=>rpc('sma_gallery_music_v1',{p_action:action,p_input:input},owner,signal);
export const editorRequest=(action,input,owner,signal)=>rpc('sma_publication_editor_v1',{p_action:action,p_input:input},owner,signal);
export const editorFiles=owner=>rpc('sma_publication_files_v1',{p_action:'list',p_input:{dashboard_labels:true}},owner);
export const editorPilotAccess=owner=>rpc('sma_customer_media_pilot_v1',{p_route:'eligible'},owner);
export async function editorRefreshFiles(owner,signal){await refreshMediaCatalog({getSession:()=>session(owner),owner,signal});signal?.throwIfAborted();const result=await editorFiles(owner);await session(owner);signal?.throwIfAborted();return result;}
export async function editorThumbnail(file,signal,owner){
 const current=(await session(owner)).user.id;
 if(!thumbnails||thumbnailOwner!==current){thumbnails?.dispose();thumbnailOwner=current;thumbnails=createSharedThumbnailClient({getSession:()=>session(current),getOwnerId:()=>thumbnailOwner});}
 const blob=await thumbnails.request(file,signal);await session(owner);signal?.throwIfAborted();return blob;
}
export const exportRequest=(action,input,owner)=>rpc('sma_publication_editor_export_v1',{p_action:action,p_input:input},owner);
export function editorSource(file,signal,owner){originalMedia??=createSharedOriginalMediaClient({getSession:()=>session()});return originalMedia.request(file,{owner,signal});}
export async function uploadExport(blob,artifact,signal,owner,onProgress=()=>{}){
 const call=async(action)=>{
  signal.throwIfAborted();await session(owner);
  const meta={name:artifact.name,mime_type:artifact.mime_type,size_bytes:blob.size};
  const response=await fileJobs.request({anchor:{kind:'upload',upload_id:artifact.upload_id,...meta},operation:action==='start'?'upload_start':'upload_finish',input:{upload_id:artifact.upload_id,...(action==='start'?meta:{})},signal,timeoutMs:90000});
  if(!response.ok)throw Error('UPLOAD_UNAVAILABLE');const r=await response.json();if(r?.ok!==true)throw Error(r?.code||'UPLOAD_UNAVAILABLE');if(r.upload_id!==artifact.upload_id||r.can_publish!==false||!['ready','completed'].includes(r.status)||r.status==='completed'&&!editorUUID(r.asset_id))throw Error('UPLOAD_UNAVAILABLE');await session(owner);return r;
 };
 const started=await call('start');if(started.status==='completed')return started.asset_id;
 await transferDeviceFile({file:blob,url:started.upload_url,mime:artifact.mime_type,signal,onProgress});
 const completed=await call('finish');if(completed.status!=='completed')throw Error('UPLOAD_INCOMPLETE');return completed.asset_id;
}
