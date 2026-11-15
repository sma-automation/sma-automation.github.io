// Session storage is optional. Keep a single interrupted save per portal in this tab.
const key=portal=>'sma.publication.pending-save.v1.'+portal;
const portals=['youtube','tiktok'];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const string=(v,max)=>typeof v==='string'&&v.length<=max;
const uuid=v=>typeof v==='string'&&/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v);
const product=v=>v===null||(typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v));
function validFields(v){
 return object(v)&&string(v.title,160)&&string(v.body,2400)&&Array.isArray(v.hashtags)&&v.hashtags.length<=3&&
  v.hashtags.every(tag=>typeof tag==='string'&&/^[\p{L}\p{N}_]{1,50}$/u.test(tag))&&product(v.product_id);
}
function validLink(v){
 return v===undefined||v===null||(object(v)&&Object.keys(v).every(k=>['source','product_id','name','purpose'].includes(k))&&['choice','matched','catalog'].includes(v.source)&&
  typeof v.product_id==='string'&&product(v.product_id)&&string(v.name,500)&&string(v.purpose,8000));
}
function valid(v,portal){
 return object(v)&&portals.includes(portal)&&v.portal===portal&&uuid(v.token)&&string(v.owner,128)&&v.owner.length>0&&
  string(v.route,200)&&uuid(v.fileId)&&string(v.fileRevision,250)&&v.fileRevision.length>0&&uuid(v.previewId)&&
  Number.isSafeInteger(v.assignment)&&v.assignment>0&&Number.isSafeInteger(v.revision)&&v.revision>0&&
  typeof v.shop==='string'&&/^https:\/\/sma-automation\.com\/app\/shop\.html\?shop=[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.shop)&&
  validFields(v.base)&&validFields(v.sent)&&object(v.form)&&string(v.form.title,160)&&string(v.form.body,2400)&&
  string(v.form.tags,1000)&&validLink(v.form.link);
}
// Only form edits may reuse the last persisted checkpoint after a storage failure.
// A new attempt, owner, file, route, baseline or sent payload must never revive it.
function sameAttempt(a,b){
 if(!a)return false;
 for(const field of ['token','owner','portal','route','fileId','fileRevision','previewId','assignment','revision','shop'])
  if(a[field]!==b[field])return false;
 const fields=v=>[v.title,v.body,v.hashtags,v.product_id];
 return JSON.stringify(fields(a.base))===JSON.stringify(fields(b.base))&&
  JSON.stringify(fields(a.sent))===JSON.stringify(fields(b.sent));
}
// Optional browser-only notice. It never changes form fields or the server save status.
// Track only the current attempt's identity, not a second in-memory draft copy.
function checkpointNotice(win){
 let current=null,node=null;
 const matches=v=>!!current&&!!v&&['token','owner','portal'].every(k=>current[k]===v[k]);
 function hide(){try{if(node){node.hidden=true;node.textContent='';}}catch{}}
 return {
  begin(v){
   if(!v||!portals.includes(v.portal)||!uuid(v.token)||!string(v.owner,128)||!v.owner)return;
   if(!matches(v))hide();
   current={token:v.token,owner:v.owner,portal:v.portal};
  },
  failed(v){
   if(!matches(v))return;
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
   }catch{/* A missing view must never interrupt saving or sign-out. */}
  },
  saved(v){if(matches(v))hide();},
  forget(v){if(matches(v)){hide();current=null;}},
  clearOwner(owner){if(current?.owner===owner){hide();current=null;}}
 };
}
export function tabDraftStore(win){
 const notice=checkpointNotice(win);
 function read(portal){
  if(!portals.includes(portal))return null;
  try{
   const raw=win.sessionStorage.getItem(key(portal));if(raw===null)return null;
   if(raw.length<=32000){
    let v;try{v=JSON.parse(raw);}catch{}
    if(valid(v,portal))return v;
   }
   win.sessionStorage.removeItem(key(portal));
  }catch{/* Storage may be unavailable in an embedded preview. */}
  return null;
 }
 return {
  read(portal,owner,route){
   const v=read(portal);
   if(v&&v.owner!==owner){this.forget(v);return null;}
   return v?.route===route?v:null;
  },
  matches(v){return !!v&&read(v.portal)?.token===v.token;},
  write(v){
   notice.begin(v);
   try{
    const raw=JSON.stringify(v);
    if(valid(v,v.portal)&&raw.length<=32000){
     try{win.sessionStorage.setItem(key(v.portal),raw);notice.saved(v);return;}
     catch{
      // setItem failed: keep only a validated checkpoint of this exact attempt.
      // This does not claim that the newer form reached storage or the server.
      if(sameAttempt(read(v.portal),v)){notice.failed(v);return;}
     }
    }
   }catch{}
   try{win.sessionStorage.removeItem(key(v.portal));}catch{}
   notice.failed(v);
  },
  update(v){
   const saved=read(v.portal);
   if(saved?.token===v.token)this.write(v);
   else if(!saved)notice.failed(v);
  },
  forget(v){
   notice.forget(v);
   try{if(v&&read(v.portal)?.token===v.token)win.sessionStorage.removeItem(key(v.portal));}catch{}
  },
  clearOwner(owner){
   notice.clearOwner(owner);
   for(const portal of portals){const v=read(portal);if(v&&v.owner===owner)this.forget(v);}
  }
 };
}
