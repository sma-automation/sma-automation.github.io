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
export function tabDraftStore(win){
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
   try{
    const raw=JSON.stringify(v);
    if(valid(v,v.portal)&&raw.length<=32000){win.sessionStorage.setItem(key(v.portal),raw);return;}
   }catch{}
   try{win.sessionStorage.removeItem(key(v.portal));}catch{}
  },
  update(v){if(read(v.portal)?.token===v.token)this.write(v);},
  forget(v){
   try{if(v&&read(v.portal)?.token===v.token)win.sessionStorage.removeItem(key(v.portal));}catch{}
  },
  clearOwner(owner){
   for(const portal of portals){const v=read(portal);if(v&&v.owner===owner)this.forget(v);}
  }
 };
}
