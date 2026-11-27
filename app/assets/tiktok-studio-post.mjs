// The creator uploads the selected MP4 in Studio. These controls never create a publication order.
export function isStudioPost(portal,file){
 return portal==='tiktok'&&file?.media_kind==='video'&&file.profile_media?.state==='private_preview_only';
}

export function createStudioPost(doc,{owner,caption}){
 const panel=doc.createElement('section');panel.className='studio-post';panel.hidden=true;
 panel.setAttribute('aria-label','Auf TikTok posten');
 const make=(tag,text)=>{const el=doc.createElement(tag);el.textContent=text;return el;};
 const heading=make('h2','Auf TikTok posten');heading.tabIndex=-1;
 const instructions=make('p','Lade das fertige Video herunter und kopiere den Beitragstext mit Hashtags. In TikTok Studio wählst du die MP4 aus und veröffentlichst den Beitrag.');
 const actions=doc.createElement('div');actions.className='studio-actions';
 const download=make('button','Video herunterladen'),copy=make('button','Beitragstext kopieren');
 download.type=copy.type='button';
 const studio=make('a','TikTok Studio öffnen');studio.href='https://www.tiktok.com/tiktokstudio/upload';studio.target='_blank';studio.rel='noopener noreferrer';
 const stored=make('a','Video in Google Drive öffnen');stored.hidden=true;stored.target='_blank';stored.rel='noopener noreferrer';
 const feedback=make('p','');feedback.setAttribute('role','status');
 const fallback=doc.createElement('textarea');fallback.readOnly=true;fallback.hidden=true;fallback.setAttribute('aria-label','Beitragstext zum Kopieren');
 actions.append(download,copy,studio);panel.append(heading,instructions,actions,feedback,stored,fallback);
 let selected=null,controller=null,generation=0;
 function select(portal,file){
  const next=isStudioPost(portal,file)?file:null;
  if(selected?.id===next?.id&&selected?.revision===next?.revision&&selected?.profile_media?.drive_id===next?.profile_media?.drive_id)return;
  generation++;controller?.abort();controller=null;selected=next;panel.hidden=!next;
  feedback.textContent='';fallback.value='';fallback.hidden=stored.hidden=true;stored.removeAttribute('href');
  download.disabled=false;download.setAttribute('aria-busy','false');
  if(next&&/^[A-Za-z0-9_-]{10,200}$/.test(next.profile_media.drive_id||''))stored.href='https://drive.google.com/file/d/'+next.profile_media.drive_id+'/view';
 }
 download.addEventListener('click',async()=>{
  if(!selected||download.disabled||!owner())return;
  const file=selected,id=generation,uid=owner(),request=new AbortController();controller=request;
  download.disabled=true;download.setAttribute('aria-busy','true');feedback.textContent='Video wird geladen …';stored.hidden=true;
  try{
   const {editorSource}=await import('./media-editor-api.mjs?v=16');
   const blob=await editorSource(file,request.signal,uid);
   if(request.signal.aborted||id!==generation||uid!==owner())return;
   const url=URL.createObjectURL(blob),link=doc.createElement('a');
   link.href=url;link.download=file.profile_media?.source_name||file.name;doc.body.append(link);
   try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
   feedback.textContent='Download gestartet. Diese MP4 kannst du in TikTok Studio auswählen.';
  }catch{
   if(id!==generation||uid!==owner())return;
   stored.hidden=!stored.hasAttribute('href');
   feedback.textContent=stored.hidden?'Download fehlgeschlagen. Lade die Dateiliste neu und versuche es erneut.':'Download in SMA fehlgeschlagen. Öffne die Datei in Google Drive und wähle „Herunterladen“.';
  }finally{if(id===generation){download.disabled=false;download.setAttribute('aria-busy','false');controller=null;}}
 });
 copy.addEventListener('click',async()=>{
  if(!selected||!owner())return;
  const id=generation;let text;
  try{text=caption();}catch(e){feedback.textContent=e.message;return;}
  if(!text?.trim()){feedback.textContent='Gib zuerst deinen Beitragstext ein.';return;}
  fallback.hidden=true;
  try{await doc.defaultView.navigator.clipboard.writeText(text);if(id===generation)feedback.textContent='Beitragstext mit Hashtags kopiert.';}
  catch{if(id===generation){fallback.value=text;fallback.hidden=false;fallback.focus();fallback.select();feedback.textContent='Der Beitragstext ist markiert. Kopiere ihn über die Zwischenablage.';}}
 });
 return {panel,select,focus(){if(selected)heading.focus();}};
}
