import {editorUUID} from './media-editor-model.mjs?v=3';
export function readExportCover(r,file){
 if(!r||r.ok!==true||r.version!==1||r.can_publish!==false||r.asset_id!==file.id||r.asset_revision!==file.revision)throw Error('COVER_UNAVAILABLE');
 if(r.cover===null)return null;const c=r.cover;
 if(!c||!editorUUID(c.asset_id)||c.asset_id===file.id||!/^sha256:[a-f0-9]{64}:[0-9]{1,30}$/.test(c.asset_revision)||typeof c.name!=='string'||c.name.length>250||(c.size_bytes!=null&&(!Number.isInteger(c.size_bytes)||c.size_bytes<33||c.size_bytes>24000000))||!Number.isInteger(c.position_ms)||c.position_ms<0||c.position_ms>=60000)throw Error('COVER_UNAVAILABLE');
 return {id:c.asset_id,revision:c.asset_revision,name:c.name,media_kind:'image',mime_type:'image/png',size_bytes:c.size_bytes,position_ms:c.position_ms};
}
export function exportCoverNote(portal){
 if(portal==='youtube')return 'Bei einer freigegebenen Veröffentlichung wird dieses Cover nach der Videoverarbeitung an YouTube übergeben. Die Übertragung ist erst mit der Portalbestätigung abgeschlossen.';
 if(portal==='tiktok')return 'Bei einer freigegebenen Veröffentlichung erhält TikTok den gewählten Bildzeitpunkt im fertigen Video. TikTok erzeugt daraus das Cover.';
 return 'Dein Cover bleibt beim Export gespeichert. Für dieses Portal ist die automatische Cover-Übertragung noch nicht angebunden.';
}
export function mountExportCover({doc,request,getOwnerId,expectedOwnerId,loadImage,portal,createURL=URL.createObjectURL,revokeURL=URL.revokeObjectURL}){
 const $=id=>doc.getElementById(id);let generation=0,controller=null,url=null,disposed=false;
 if($('exportCoverNote'))$('exportCoverNote').textContent=exportCoverNote(portal);
 function clear(){generation++;controller?.abort();controller=null;if(url)revokeURL(url);url=null;$('exportCoverImage').removeAttribute('src');$('exportCoverImage').hidden=true;$('exportCoverPanel').hidden=true;$('exportCoverPanel').open=false;$('exportCoverStatus').textContent='';}
 const active=g=>!disposed&&g===generation;
 async function owned(g){
  try{return active(g)&&await getOwnerId()===expectedOwnerId&&active(g);}catch{return false;}
 }
 async function setContext(file){
  clear();
  if(disposed||file?.media_kind!=='video')return null;
  const g=generation;controller=new AbortController();const signal=controller.signal;
  try{
   if(!await owned(g))return {unavailable:true};
   const cover=readExportCover(await request(file),file);
   if(!await owned(g))return {unavailable:true};
   if(!cover)return null;
   $('exportCoverPanel').hidden=false;$('exportCoverStatus').textContent='Cover wird geladen …';
   const blob=await loadImage(cover,signal);
   if(!await owned(g)||signal.aborted){if(active(g))clear();return {unavailable:true};}
   url=createURL(blob);$('exportCoverImage').src=url;$('exportCoverImage').hidden=false;
   $('exportCoverStatus').textContent='Cover aus deinem Export · bei '+(cover.position_ms/1000).toLocaleString('de-AT')+' Sek.';
   return {cover,blob};
  }catch{
   if(active(g)&&!signal.aborted&&await owned(g)){
    $('exportCoverPanel').hidden=false;
    $('exportCoverStatus').textContent='Das Cover ist gerade nicht verfügbar. Bitte aktualisiere die Dateien.';
   }
   return {unavailable:true};
  }
 }
 return {setContext,clear,destroy(){clear();disposed=true;}};
}
