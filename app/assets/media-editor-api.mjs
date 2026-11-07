import {createMusicLibraryAPI} from './music-library-api.mjs?v=2';
import {refreshMediaCatalog} from './media-metadata.mjs?v=1';
import {fetchAssetThumbnail} from './asset-thumbnail.mjs?v=1';
import {transferDeviceFile} from './device-upload.mjs?v=1';
import {sha256,EXPORT_MAX_BYTES} from './media-export-model.mjs?v=1';
import {editorUUID} from './media-editor-model.mjs?v=2';
const origin='https://bnvnmdxosbnuzedokqgh.supabase.co',key='sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW';let client;
async function auth(){if(!client){const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2.57.4');client=createClient(origin,key);}return client;}
async function session(owner){const {data,error}=await (await auth()).auth.getSession();if(error||!data?.session||owner&&data.session.user.id!==owner)throw Error('AUTH_REQUIRED');return data.session;}
export const editorMusicLibrary=owner=>createMusicLibraryAPI({owner,getSession:()=>session(owner),includeCatalog:true});
export async function getOwnerId(){try{return (await session()).user.id;}catch{return null;}}
export async function watchOwner(callback){return (await auth()).auth.onAuthStateChange((_event,s)=>callback(s?.user?.id||null)).data.subscription;}
async function rpc(name,body,owner){const s=await session(owner);const response=await fetch(origin+'/rest/v1/rpc/'+name,{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',apikey:key,Authorization:'Bearer '+s.access_token},body:JSON.stringify(body)});if(!response.ok)throw Error(response.status===401?'AUTH_REQUIRED':'UNAVAILABLE');return response.json();}
export const editorRequest=(action,input,owner)=>rpc('sma_publication_editor_v1',{p_action:action,p_input:input},owner);
export const editorFiles=owner=>rpc('sma_publication_files_v1',{p_action:'list'},owner);
export async function editorRefreshFiles(owner,signal){await refreshMediaCatalog({getSession:()=>session(owner),owner,signal});signal?.throwIfAborted();const result=await editorFiles(owner);await session(owner);signal?.throwIfAborted();return result;}
export async function editorThumbnail(file,signal,owner){return fetchAssetThumbnail(file,(await session(owner)).access_token,signal);}
export const exportRequest=(action,input,owner)=>rpc('sma_publication_editor_export_v1',{p_action:action,p_input:input},owner);
export async function editorSource(file,signal,owner){
 const s=await session(owner),response=await fetch('https://johnmusic.app.n8n.cloud/webhook/sma-publication-editor-source-v1',{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(180000)]),headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token},body:JSON.stringify({asset_id:file.id||file.asset_id,asset_revision:file.revision||file.asset_revision})});
 if(!response.ok)throw Error('SOURCE_UNAVAILABLE');const r=await response.json();
 if(r?.ok!==true)throw Error(r?.code||'SOURCE_UNAVAILABLE');
 if(r.can_publish!==false||r.asset_id!==(file.id||file.asset_id)||r.asset_revision!==(file.revision||file.asset_revision)||!['video/mp4','image/jpeg','image/png','image/webp'].includes(r.mime_type)||file.mime_type&&r.mime_type!==file.mime_type||!Number.isInteger(r.size_bytes)||r.size_bytes<12||r.size_bytes>EXPORT_MAX_BYTES||typeof r.sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256)||typeof r.data_base64!=='string'||r.data_base64.length>32000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(r.data_base64))throw Error('SOURCE_UNAVAILABLE');
 const bytes=Uint8Array.from(atob(r.data_base64),c=>c.charCodeAt(0));if(bytes.length!==r.size_bytes||await sha256(bytes)!==r.sha256||r.asset_revision.startsWith('sha256:')&&r.asset_revision.split(':')[1]!==r.sha256)throw Error('SOURCE_UNAVAILABLE');
 signal.throwIfAborted();await session(owner);return new Blob([bytes],{type:r.mime_type});
}
export async function uploadExport(blob,artifact,signal,owner,onProgress=()=>{}){
 const call=async(action)=>{
  signal.throwIfAborted();const s=await session(owner),response=await fetch('https://johnmusic.app.n8n.cloud/webhook/sma-publication-device-upload-v1',{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(90000)]),headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token},body:JSON.stringify({action,upload_id:artifact.upload_id,...(action==='start'?{name:artifact.name,mime_type:artifact.mime_type,size_bytes:blob.size}:{})})});
  if(!response.ok)throw Error('UPLOAD_UNAVAILABLE');const r=await response.json();if(r?.ok!==true)throw Error(r?.code||'UPLOAD_UNAVAILABLE');if(r.upload_id!==artifact.upload_id||r.can_publish!==false||!['ready','completed'].includes(r.status)||r.status==='completed'&&!editorUUID(r.asset_id))throw Error('UPLOAD_UNAVAILABLE');await session(owner);return r;
 };
 const started=await call('start');if(started.status==='completed')return started.asset_id;
 await transferDeviceFile({file:blob,url:started.upload_url,mime:artifact.mime_type,signal,onProgress});
 const completed=await call('finish');if(completed.status!=='completed')throw Error('UPLOAD_INCOMPLETE');return completed.asset_id;
}
