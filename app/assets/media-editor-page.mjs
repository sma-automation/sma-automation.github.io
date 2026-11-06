import {mountMediaEditor} from './media-editor-view.mjs?v=4';
import {getOwnerId,watchOwner,editorRequest,editorFiles,editorRefreshFiles,editorThumbnail,exportRequest,editorSource,uploadExport} from './media-editor-api.mjs?v=3';
const owner=await getOwnerId();let view,subscription;
if(!owner){document.getElementById('status').textContent='Bitte melde dich bei SMA an.';document.getElementById('login').hidden=false;}
else{
 view=mountMediaEditor({doc:document,expectedOwnerId:owner,getOwnerId,request:(a,i)=>editorRequest(a,i,owner),listFiles:()=>editorFiles(owner),refreshMetadata:signal=>editorRefreshFiles(owner,signal),thumbnail:(f,s)=>editorThumbnail(f,s,owner),uuid:()=>crypto.randomUUID(),exportDependencies:{request:(a,i)=>exportRequest(a,i,owner),source:(f,s)=>editorSource(f,s,owner),upload:(b,a,s,p)=>uploadExport(b,a,s,owner,p)},initialAssetId:new URLSearchParams(location.search).get('asset')});
 subscription=await watchOwner(id=>view.invalidateOwner(id));
 view.invalidateOwner(await getOwnerId());
}
window.addEventListener('pagehide',()=>{view?.destroy();subscription?.unsubscribe();});

window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
