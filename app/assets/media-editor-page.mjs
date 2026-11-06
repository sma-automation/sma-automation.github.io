import {mountMediaEditor} from './media-editor-view.mjs?v=1';
import {getOwnerId,watchOwner,editorRequest,editorFiles,editorThumbnail} from './media-editor-api.mjs?v=1';
const owner=await getOwnerId();let view,subscription;
if(!owner){document.getElementById('status').textContent='Bitte melde dich bei SMA an.';document.getElementById('login').hidden=false;}
else{
 view=mountMediaEditor({doc:document,expectedOwnerId:owner,getOwnerId,request:(a,i)=>editorRequest(a,i,owner),listFiles:()=>editorFiles(owner),thumbnail:(f,s)=>editorThumbnail(f,s,owner),uuid:()=>crypto.randomUUID(),initialAssetId:new URLSearchParams(location.search).get('asset')});
 subscription=await watchOwner(id=>view.invalidateOwner(id));
 view.invalidateOwner(await getOwnerId());
}
window.addEventListener('pagehide',()=>{view?.destroy();subscription?.unsubscribe();});

window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
