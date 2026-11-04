const maxSourceBytes=5_000_000,maxStoredBytes=2_000_000;
const fail=code=>{throw Object.assign(Error(code),{code});};
export function checkSourceImage(file){
 if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type))fail('IMAGE_FORMAT');
 if(!Number.isSafeInteger(file.size)||file.size<1||file.size>maxSourceBytes)fail('IMAGE_SIZE');return file;
}
export async function prepareWebsiteImage(file,kind,{decode=createImageBitmap,doc=document}={}){
 checkSourceImage(file);if(!['logo','hero'].includes(kind))fail('INVALID_INPUT');
 let bitmap;
 try{
  bitmap=await decode(file);if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>32_000_000)fail('IMAGE_SIZE');
  const max=kind==='logo'?512:1600,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
  const canvas=doc.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext('2d');if(!ctx)fail('IMAGE_FORMAT');
  if(kind==='hero'){ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);}ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,kind==='logo'?'image/png':'image/jpeg',.85));
  if(!blob||blob.size>maxStoredBytes)fail('IMAGE_SIZE');return blob;
 }catch(e){if(e.code)throw e;fail('IMAGE_FORMAT');}finally{bitmap?.close();}
}
const messages={IMAGE_FORMAT:'Bitte wähle ein lesbares PNG-, JPEG- oder WebP-Bild.',IMAGE_SIZE:'Das Bild ist zu groß. Wähle eine Datei bis 5 MB mit höchstens 32 Millionen Bildpunkten.',IMAGE_LIMIT:'Das Upload-Limit ist erreicht. Bitte versuche es später erneut.',AUTH_REQUIRED:'Bitte melde dich erneut bei SMA an.',IMAGE_CONFLICT:'Dieser Upload konnte nicht eindeutig zugeordnet werden. Wähle das Bild erneut.'};
export function mountWebsiteImageFields({doc,upload,request,getOwnerId,canEdit,onDirty,onBusy,prepare=prepareWebsiteImage,makeURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url),uuid=()=>crypto.randomUUID()}){
 const $=id=>doc.getElementById(id);let epoch=0,destroyed=false,uploading=false,owner=null;let ownerReady=Promise.resolve(null);const controllers=new Set(),urls=new Map();
 function resetPreview(kind){const img=$(kind+'ImagePreview');img.hidden=true;img.removeAttribute('src');if(urls.has(kind))revokeURL(urls.get(kind));urls.delete(kind);}
 function install(kind,blob){resetPreview(kind);const url=makeURL(blob);urls.set(kind,url);const img=$(kind+'ImagePreview');img.src=url;img.hidden=false;}
 const value=kind=>doc.querySelector('[name="'+kind+'_image_id"]');
 function sync(){for(const kind of ['logo','hero'])$(kind+'ImageRemove').disabled=!value(kind).value||uploading;}
 async function thumbnail(kind,id,version){
  if(!id||!request)return;const controller=new AbortController();controllers.add(controller);
  try{const expected=await ownerReady;if(!expected||destroyed||version!==epoch)return;const blob=await request(id,null,controller.signal),current=await getOwnerId();if(destroyed||version!==epoch||current!==expected||value(kind).value!==id)return;install(kind,blob);}
  catch{if(!destroyed&&version===epoch&&value(kind).value===id)$(kind+'ImageStatus').textContent='Bild gespeichert; Vorschau gerade nicht verfügbar.';}
  finally{controllers.delete(controller);}
 }
 async function selected(kind){
  const file=$(kind+'ImageFile').files?.[0];$(kind+'ImageFile').value='';if(!file||destroyed||uploading||!canEdit())return;
  const version=epoch,controller=new AbortController();controllers.add(controller);uploading=true;onBusy(true);sync();$(kind+'ImageStatus').textContent='Bild wird vorbereitet …';
  try{
   const expected=await getOwnerId();if(destroyed||version!==epoch)return;if(!expected||owner&&owner!==expected)fail('AUTH_REQUIRED');owner=expected;
   const blob=await prepare(file,kind,{doc}),beforeUpload=await getOwnerId();if(destroyed||version!==epoch)return;if(beforeUpload!==expected)fail('AUTH_REQUIRED');controller.signal.throwIfAborted();
   $(kind+'ImageStatus').textContent='Bild wird privat hochgeladen …';const id=uuid(),image=await upload(blob,id,controller.signal,expected),current=await getOwnerId();
   if(destroyed||version!==epoch||current!==expected)return;
   if(image.id!==id)fail('IMAGE_CONFLICT');value(kind).value=id;
   if(kind==='hero')doc.querySelector('[name="hero"] option[value="image"]').selected=true;
   install(kind,blob);$(kind+'ImageStatus').textContent='Ausgewählt. Mit „Änderungen speichern“ übernehmen.';onDirty();
  }catch(e){if(!destroyed&&version===epoch)$(kind+'ImageStatus').textContent=messages[e.code]||'Der Upload ist gerade nicht möglich. Deine bisherige Auswahl bleibt erhalten.';}
  finally{controllers.delete(controller);if(!destroyed&&version===epoch){uploading=false;onBusy(false);sync();}}
 }
 for(const kind of ['logo','hero']){
  $(kind+'ImageSelect').onclick=()=>{if(canEdit()&&!uploading)$(kind+'ImageFile').click();};
  $(kind+'ImageFile').onchange=()=>selected(kind);
  $(kind+'ImageRemove').onclick=()=>{if(!canEdit()||uploading)return;value(kind).value='';resetPreview(kind);if(kind==='hero'){
   doc.querySelector('[name="hero_image_alt"]').value='';if(doc.querySelector('[name="hero"]').value==='image')doc.querySelector('[name="hero"] option[value="shk"]').selected=true;
  }$(kind+'ImageStatus').textContent='Entfernung mit „Änderungen speichern“ übernehmen.';onDirty();sync();};
 }
 function clear(){epoch++;for(const c of controllers)c.abort();controllers.clear();uploading=false;owner=null;ownerReady=Promise.resolve(null);onBusy(false);for(const kind of ['logo','hero']){resetPreview(kind);$(kind+'ImageFile').value='';$(kind+'ImageStatus').textContent='Kein Bild ausgewählt.';}sync();}
 return {load(content){clear();const version=epoch;ownerReady=getOwnerId().then(id=>{if(!destroyed&&version===epoch)owner=id;return id;}).catch(()=>null);for(const kind of ['logo','hero']){const id=content[kind+'_image_id'];$(kind+'ImageStatus').textContent=id?'Bild gespeichert.':'Kein Bild ausgewählt.';thumbnail(kind,id,version);}sync();},clear,destroy(){destroyed=true;clear();for(const kind of ['logo','hero']){$(kind+'ImageSelect').onclick=null;$(kind+'ImageFile').onchange=null;$(kind+'ImageRemove').onclick=null;}}};
}
