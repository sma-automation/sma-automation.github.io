// Session storage is optional. Keep independent checkpoints for each owner and exact editor route.
const legacyKey=portal=>'sma.publication.pending-save.v1.'+portal;
const ownerPrefix=(portal,owner)=>'sma.publication.pending-save.v2.'+portal+':'+encodeURIComponent(owner)+':';
const portals=['youtube','tiktok'];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const string=(v,max)=>typeof v==='string'&&v.length<=max;
const uuid=v=>typeof v==='string'&&/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v);
const product=v=>v===null||(typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v));
function key(portal,owner,route){
 if(!portals.includes(portal)||!string(owner,128)||!owner||!string(route,200))return null;
 try{return ownerPrefix(portal,owner)+encodeURIComponent(route);}catch{return null;}
}
function validFields(v){
 return object(v)&&string(v.title,160)&&string(v.body,2400)&&Array.isArray(v.hashtags)&&v.hashtags.length<=3&&
  v.hashtags.every(tag=>typeof tag==='string'&&/^[\p{L}\p{N}_]{1,50}$/u.test(tag))&&product(v.product_id);
}
function validLink(v){
 return v===undefined||v===null||(object(v)&&Object.keys(v).every(k=>['source','product_id','name','purpose'].includes(k))&&['choice','matched','catalog'].includes(v.source)&&
  typeof v.product_id==='string'&&product(v.product_id)&&string(v.name,500)&&string(v.purpose,8000));
}
function validSource(v){
 return v===undefined||(object(v)&&Object.keys(v).every(k=>['text','language'].includes(k))&&
  string(v.text,8000)&&['de','en'].includes(v.language));
}
function valid(v,portal){
 return object(v)&&portals.includes(portal)&&v.portal===portal&&uuid(v.token)&&string(v.owner,128)&&v.owner.length>0&&
  (v.kind===undefined||v.kind==='edit')&&
  string(v.route,200)&&uuid(v.fileId)&&string(v.fileRevision,250)&&v.fileRevision.length>0&&uuid(v.previewId)&&
  Number.isSafeInteger(v.assignment)&&v.assignment>0&&Number.isSafeInteger(v.revision)&&v.revision>0&&
  typeof v.shop==='string'&&/^https:\/\/sma-automation\.com\/app\/shop\.html\?shop=[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.shop)&&
  validFields(v.base)&&(v.kind==='edit'?v.sent===undefined:validFields(v.sent))&&object(v.form)&&string(v.form.title,160)&&string(v.form.body,2400)&&
  string(v.form.tags,1000)&&validLink(v.form.link)&&validSource(v.form.source);
}
// Only form edits may reuse the last persisted checkpoint after a storage failure.
// A legacy migration may hand the same verified checkpoint to a fresh editor token;
// a different owner, file, route, baseline or sent payload must never revive it.
function sameAttempt(a,b,migration=false){
 if(!a)return false;
 for(const field of ['kind','token','owner','portal','route','fileId','fileRevision','previewId','assignment','revision','shop'])
  if(!(migration&&field==='token')&&a[field]!==b[field])return false;
 const fields=v=>[v.title,v.body,v.hashtags,v.product_id];
 return JSON.stringify(fields(a.base))===JSON.stringify(fields(b.base))&&
  (a.kind==='edit'||JSON.stringify(fields(a.sent))===JSON.stringify(fields(b.sent)));
}
// Optional browser-only notice. It never changes form fields or the server save status.
// Track only the current attempt's identity, not a second in-memory draft copy.
function checkpointNotice(win){
 let current=null,node=null,actions=null,copyButton=null,copyStatus=null,manual=null;
 let copyGeneration=0,copyTimer=null;
 // Request the native leave confirmation only while a checkpoint failure is unresolved.
 // This is not a save and browsers may omit the prompt (for example on mobile shutdown).
 let warnOnLeave=false;
 function beforeUnload(event){
  if(!warnOnLeave||!current)return;
  event.preventDefault();event.returnValue='';
 }
 function guardLeave(enabled){
  if(warnOnLeave===enabled)return;
  warnOnLeave=enabled;
  try{
   if(enabled)win.addEventListener?.('beforeunload',beforeUnload);
   else win.removeEventListener?.('beforeunload',beforeUnload);
  }catch{/* Optional browser events must not block checkpoint or logout cleanup. */}
 }
 const matches=v=>!!current&&!!v&&['token','owner','portal'].every(k=>current[k]===v[k]);
 function clearCopy(){
  copyGeneration++;
  if(copyTimer!==null){win.clearTimeout(copyTimer);copyTimer=null;}
  if(actions){actions.hidden=true;copyButton.disabled=false;copyStatus.textContent='';manual.value='';manual.hidden=true;}
 }
 function hide(){guardLeave(false);try{clearCopy();if(node){node.hidden=true;node.textContent='';}}catch{}}
 // Read only the current portal's editable text, at the explicit click, not its old checkpoint.
 function copyFields(){
  const doc=win.document,p=current?.portal;
  if(!portals.includes(p))return null;
  const fields=[['Titel',p+'-title'],['Beitrag',p+'-body'],['Hashtags',p+'-hashtags']];
  const values=[];
  for(const [label,id] of fields){
   const field=doc.getElementById(id);
   if(typeof field?.value!=='string')return null;
   values.push(label+'\n'+field.value);
  }
  const description=doc.getElementById('source_text');
  if(typeof description?.value==='string'&&description.value)values.push('Inhaltsbeschreibung\n'+description.value);
  const text=values.join('\n\n');
  return text.length<=32000?text:null; // Never silently truncate a rescue copy.
 }
 function offerCopy(){
  try{
   if(copyFields()===null||typeof node.after!=='function')return;
   if(!actions){
    const doc=win.document;
    actions=doc.createElement('div');actions.id='tabDraftStorageActions';actions.className='actions';
    copyButton=doc.createElement('button');copyButton.id='tabDraftCopy';copyButton.type='button';
    copyButton.className='secondary';copyButton.textContent='Aktuelle Texte kopieren';
    copyStatus=doc.createElement('p');copyStatus.id='tabDraftCopyStatus';copyStatus.className='note';
    copyStatus.setAttribute('role','status');copyStatus.setAttribute('aria-live','polite');
    copyStatus.style.cssText='flex-basis:100%;margin:0;overflow-wrap:anywhere';
    manual=doc.createElement('textarea');manual.id='tabDraftManualCopy';manual.readOnly=true;manual.hidden=true;
    manual.setAttribute('aria-label','Aktuelle Texte zum manuellen Kopieren');manual.setAttribute('aria-describedby',copyStatus.id);
    manual.style.cssText='width:100%;min-width:0;max-width:100%;white-space:pre-wrap';
    copyButton.addEventListener('click',()=>{
     if(!current||node.hidden||actions.hidden||copyButton.disabled)return;
     const text=copyFields();
     if(text===null){manual.value='';manual.hidden=true;copyStatus.textContent='Bitte kopiere deine Texte direkt aus den Eingabefeldern. Es wurde nichts kopiert.';return;}
     const ticket=++copyGeneration;let settled=false;
     copyButton.disabled=true;manual.value=text;manual.hidden=true;copyStatus.textContent='Texte werden kopiert …';
     const finish=ok=>{
      if(settled||ticket!==copyGeneration||!current||node.hidden)return;settled=true;
      if(copyTimer!==null){win.clearTimeout(copyTimer);copyTimer=null;}
      copyButton.disabled=false;
      if(ok){manual.value='';manual.hidden=true;copyStatus.textContent='Texte vom Klick kopiert. Bitte außerhalb von SMA einfügen und sichern. Das bestätigt keine Speicherung bei SMA.';}
      else{manual.hidden=false;copyStatus.textContent='Automatisches Kopieren nicht bestätigt. Markiere und kopiere den Text im folgenden Feld und sichere ihn außerhalb von SMA.';manual.focus();manual.select();}
     };
     try{
      if(typeof win.navigator?.clipboard?.writeText!=='function'){finish(false);return;}
      copyTimer=win.setTimeout(()=>finish(false),10000);
      // Preserve the user gesture; never read the clipboard or retry automatically.
      Promise.resolve(win.navigator.clipboard.writeText(text)).then(()=>finish(true),()=>finish(false));
     }catch{finish(false);}
    });
    actions.append(copyButton,copyStatus,manual);node.after(actions);
   }
   actions.hidden=false;
  }catch{/* The original manual-copy warning remains available. */}
 }
 return {
  begin(v){
   if(!v||!portals.includes(v.portal)||!uuid(v.token)||!string(v.owner,128)||!v.owner)return;
   if(!matches(v))hide();
   current={token:v.token,owner:v.owner,portal:v.portal};
  },
  failed(v){
   if(!matches(v))return;
   guardLeave(true);
   try{
    const doc=win.document,main=doc?.querySelector('main');
    if(!main||!doc.getElementById('saveStatus'))return;
    if(!node){
     node=doc.createElement('p');node.id='tabDraftStorageWarning';node.className='notice';
     node.setAttribute('role','status');node.setAttribute('aria-live','polite');node.setAttribute('aria-atomic','true');
     node.hidden=true;main.prepend(node);
    }
    if(node.hidden){
     node.textContent='Zwischensicherung im Browser nicht möglich. Lass diese Seite geöffnet und kopiere deine aktuellen Texte vor dem Neuladen. Beachte zusätzlich den Speicherstatus bei SMA.';
     node.hidden=false;
    }
    offerCopy();
   }catch{/* A missing view must never interrupt saving or sign-out. */}
  },
  saved(v){if(matches(v))hide();},
  forget(v){if(matches(v)){hide();current=null;}},
  clearOwner(owner){if(current?.owner===owner){hide();current=null;}}
 };
}
export function tabDraftStore(win){
 const notice=checkpointNotice(win);
 // A recovered legacy record receives a fresh editor token. Remember only that token handoff
 // while a failed migration awaits storage; never keep a second copy of its draft text.
 const migrations=new Map();
 function slot(storageKey,portal,owner,route){
  const raw=win.sessionStorage.getItem(storageKey);
  if(raw===null)return {key:storageKey,present:false,value:null};
  let value;
  if(typeof raw==='string'&&raw.length<=32000)try{value=JSON.parse(raw);}catch{}
  if(!valid(value,portal)||(owner!==undefined&&(value.owner!==owner||value.route!==route)))value=null;
  return {key:storageKey,present:true,value};
 }
 function legacy(portal,owner,route){
  const saved=slot(legacyKey(portal),portal);
  return saved.value?.owner===owner&&saved.value.route===route?saved:null;
 }
 function removeLegacy(portal,owner,route){
  const saved=legacy(portal,owner,route);
  if(saved)win.sessionStorage.removeItem(saved.key);
 }
 function read(portal,owner,route){
  const storageKey=key(portal,owner,route);if(!storageKey)return null;
  try{
   const saved=slot(storageKey,portal,owner,route);
   if(saved.present){
    if(saved.value)return saved;
    // Even a damaged v2 slot supersedes v1. Keep that shadow if legacy cleanup fails,
    // rather than making an older checkpoint look current on the next read or reload.
    removeLegacy(portal,owner,route);
    win.sessionStorage.removeItem(storageKey);
    return null;
   }
   return legacy(portal,owner,route);
  }catch{/* Storage may be unavailable in an embedded preview. */}
  return null;
 }
 function owns(v,saved){
  if(!v||!saved?.value)return false;
  if(saved.value.token===v.token)return true;
  const migration=migrations.get(key(v.portal,v.owner,v.route));
  return saved.key===legacyKey(v.portal)&&migration?.from===saved.value.token&&migration.to===v.token&&
   sameAttempt(saved.value,v,true);
 }
 return {
  read(portal,owner,route){return read(portal,owner,route)?.value??null;},
  matches(v){return !!v&&owns(v,read(v.portal,v.owner,v.route));},
  write(v){
   notice.begin(v);
   const storageKey=key(v?.portal,v?.owner,v?.route);
   let validWrite=false;
   try{
    const raw=JSON.stringify(v);
    validWrite=!!storageKey&&valid(v,v.portal)&&raw.length<=32000;
    if(validWrite){
     win.sessionStorage.setItem(storageKey,raw);migrations.delete(storageKey);
     // Migration is committed only after v2 is stored. A leftover v1 is shadowed by v2.
     try{removeLegacy(v.portal,v.owner,v.route);}catch{}
     notice.saved(v);return;
    }
   }catch{}
   if(storageKey)try{
    const saved=slot(storageKey,v.portal,v.owner,v.route);
    if(validWrite&&saved.value&&sameAttempt(saved.value,v)){notice.failed(v);return;}
    if(!saved.present){
     const old=legacy(v.portal,v.owner,v.route);
     if(validWrite&&old&&sameAttempt(old.value,v,true)){
      migrations.set(storageKey,{from:old.value.token,to:v.token});notice.failed(v);return;
     }
    }
    // Incompatible attempts cannot revive an old save payload. Invalidate only this
    // route, removing its legacy shadow first; never evict another file to free space.
    removeLegacy(v.portal,v.owner,v.route);win.sessionStorage.removeItem(storageKey);
    migrations.delete(storageKey);
   }catch{}
   notice.failed(v);
  },
  update(v){
   if(!v)return;
   const saved=read(v.portal,v.owner,v.route);
   if(owns(v,saved))this.write(v);
   else if(!saved)notice.failed(v);
  },
  forget(v){
   notice.forget(v);
   if(!v)return;
   try{
    const saved=read(v.portal,v.owner,v.route);
    if(owns(v,saved)){
     removeLegacy(v.portal,v.owner,v.route);
     if(saved.key!==legacyKey(v.portal))win.sessionStorage.removeItem(saved.key);
     migrations.delete(key(v.portal,v.owner,v.route));
    }
   }catch{}
  },
  clearOwner(owner){
   notice.clearOwner(owner);
   if(!string(owner,128)||!owner)return;
   for(const portal of portals){
    try{
     const prefix=ownerPrefix(portal,owner),storage=win.sessionStorage,keys=[];
     for(const name of migrations.keys())if(name.startsWith(prefix))migrations.delete(name);
     // Remove legacy first so a denied cleanup cannot uncover an older owner record.
     const old=slot(legacyKey(portal),portal);if(old.value?.owner===owner)storage.removeItem(old.key);
     for(let i=0;i<storage.length;i++){const name=storage.key(i);if(name?.startsWith(prefix))keys.push(name);}
     for(const name of keys)try{storage.removeItem(name);}catch{}
    }catch{}
   }
  }
 };
}
