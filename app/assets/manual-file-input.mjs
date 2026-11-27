import {deviceFileMetadata} from './device-upload.mjs?v=1';

const portalNames={youtube:'YouTube',tiktok:'TikTok',instagram:'Instagram',facebook:'Facebook'};
const driveId=/^[\w-]{10,200}$/;
export function driveIdFromLink(value){
 let url;try{url=new URL(value);}catch{return null;}
 if(url.origin!=='https://drive.google.com'||url.username||url.password)return null;
 const path=url.pathname.match(/^\/file\/(?:u\/\d+\/)?d\/([\w-]{10,200})(?:\/(?:view|preview|edit))?\/?$/);
 if(path)return path[1];
 const ids=url.searchParams.getAll('id');
 return /^\/(?:u\/\d+\/)?open\/?$/.test(url.pathname)&&ids.length===1&&driveId.test(ids[0])?ids[0]:null;
}
export function driveOpenId(state){
 try{const data=JSON.parse(state);return data.action==='open'&&Array.isArray(data.ids)&&data.ids.length===1&&typeof data.ids[0]==='string'&&driveId.test(data.ids[0])?data.ids[0]:null;}catch{return null;}
}
function droppedInput(transfer){
 if(transfer.files.length===1)return {file:transfer.files[0]};
 if(transfer.files.length>1)throw Error('Bitte wähle genau ein Video aus.');
 const links=[...transfer.getData('text/uri-list').split(/\r?\n/),transfer.getData('text/plain')];
 const html=transfer.getData('text/html');
 if(html){const fragment=document.createElement('template');fragment.innerHTML=html;for(const a of fragment.content.querySelectorAll('a[href]'))links.push(a.getAttribute('href'));}
 const ids=[...new Set(links.map(driveIdFromLink).filter(Boolean))];
 if(ids.length!==1)throw Error('Ziehe eine MP4 oder den Link zu einer einzelnen Drive-Datei hierher.');
 return {drive:ids[0]};
}
export function mountManualDrop(doc,accept,report){
 const supported=e=>e.dataTransfer&&Array.from(e.dataTransfer.types).some(t=>['Files','text/uri-list','text/plain','text/html'].includes(t));
 const over=e=>{if(supported(e))e.preventDefault();};
 const drop=e=>{if(!supported(e)||e.defaultPrevented)return;e.preventDefault();
  try{const input=droppedInput(e.dataTransfer);Promise.resolve(accept(input,e.target)).catch(err=>report(err.message));}catch(err){report(err.message);}
 };
 doc.addEventListener('dragover',over);doc.addEventListener('drop',drop);
 return ()=>{doc.removeEventListener('dragover',over);doc.removeEventListener('drop',drop);};
}
async function digest(file){
 if(file.size<=64*1024*1024)return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const {sha256}=await import('https://esm.sh/@noble/hashes@1.8.0/sha256');
 const hash=sha256.create(),reader=file.stream().getReader();
 try{for(;;){const {value,done}=await reader.read();if(done)break;hash.update(value);}}finally{reader.releaseLock();}
 return [...hash.digest()].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function choosePortal(doc){
 return new Promise(resolve=>{
  const dialog=doc.createElement('dialog'),title=doc.createElement('h2');title.textContent='Portal für dieses Video auswählen';dialog.append(title);
  for(const [id,name] of Object.entries(portalNames)){const button=doc.createElement('button');button.textContent=name;button.onclick=()=>dialog.close(id);dialog.append(button);}
  const cancel=doc.createElement('button');cancel.textContent='Abbrechen';cancel.onclick=()=>dialog.close('');dialog.append(cancel);
  dialog.onclose=()=>{const portal=dialog.returnValue;dialog.remove();resolve(Object.hasOwn(portalNames,portal)?portal:null);};doc.body.append(dialog);dialog.showModal();
 });
}
export function createManualIntake({doc,db,owner,portal,getOwner,report,selected}){
 let running=false;
 const ensureOwner=async()=>{if(!owner||await getOwner()!==owner)throw Error('Bitte melde dich erneut bei SMA an.');};
 return async(input,target)=>{
  if(running)return;running=true;
  try{
   await ensureOwner();let sha=null;
   if(input.file){if(deviceFileMetadata(input.file,portal).mime_type!=='video/mp4')throw Error('Manuell posten unterstützt MP4-Videos.');report('Videodatei wird geprüft …');sha=await digest(input.file);}
   const {data,error}=await db.rpc('sma_manual_drive_selection_v1',{p_drive:input.drive||null,p_sha:sha});
   await ensureOwner();if(error)throw Error('Die Portalzuordnung konnte nicht geprüft werden.');
   if(data?.id&&Object.hasOwn(portalNames,data.platform)){report('');await selected(data);return;}
   if(data?.code==='AMBIGUOUS')throw Error('Die Datei ist mehreren Einträgen zugeordnet. Wähle den Videotitel im Portalordner.');
   if(!input.file||data?.code!=='FILE_UNAVAILABLE')throw Error('Diese Drive-Datei ist in deinen SMA-Portalordnern nicht verfügbar.');
   const card=target?.closest?.('.platform-card')?.querySelector('.sma-optimize')?.dataset.portal;
   const destination=portal||(Object.hasOwn(portalNames,card)?card:await choosePortal(doc));if(!destination){report('');return;}
   await ensureOwner();report('Datei wird privat in den Portalordner übernommen …');
   const {uploadExport}=await import('./media-editor-api.mjs?v=16');
   const meta=deviceFileMetadata(input.file,destination);
   const id=await uploadExport(input.file,{...meta,upload_id:input.uploadId??=crypto.randomUUID()},new AbortController().signal,owner,()=>{},destination);
   await ensureOwner();await selected({id,platform:destination},input.file);
  }finally{running=false;}
 };
}
export function manualURL(platform,asset){
 const url=new URL('../sofort-posten.html',import.meta.url);url.searchParams.set('portal',platform);url.searchParams.set('asset',asset);url.searchParams.set('v','5');return url.href;
}
export function mountDashboardManualDrop(doc,db,owner,getOwner,portal=null){
 let status;
 const report=message=>{if(!status){status=doc.createElement('p');status.setAttribute('role','status');status.style.cssText='position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);z-index:2147483640;background:white;color:#17233b;padding:.6rem 1rem;border:1px solid #a9b6cc;border-radius:8px';doc.body.append(status);}status.textContent=message;status.hidden=!message;};
 const accept=createManualIntake({doc,db,owner,portal,getOwner,report,selected:({platform,id})=>window.top.location.assign(manualURL(platform,id))});
 return mountManualDrop(doc,accept,report);
}
