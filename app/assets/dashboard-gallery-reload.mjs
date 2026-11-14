// A tab may restore its own gallery filters after a document reload. File contents stay in the catalogue.
const key='sma.dashboard.gallery-reload.v1';
const portals=new Set(['all','youtube','tiktok','instagram','facebook']);
const controls=new Set(['search','filter','file','select','next','back']);
const validId=id=>id===null||typeof id==='string'&&id.length>0&&id.length<=128;

const isToken=value=>typeof value==='string'&&value.length>0&&value.length<=128;
function validPreview(v){
 if(!isToken(v.key)||!isToken(v.id)||!portals.has(v.portal)||v.portal==='all')return false;
 const origin=v.origin;
 if(!origin||typeof origin.query!=='string')return false;
 if(origin.global===true)return isToken(origin.page)&&(origin.chapter===null||isToken(origin.chapter))&&
  (origin.launcherId===null||isToken(origin.launcherId))&&typeof origin.mobile==='boolean';
 return origin.global===false&&portals.has(origin.portal)&&Number.isSafeInteger(origin.page)&&origin.page>=0;
}

export function previewMatchesHistory(v,route){
 return v?.kind==='preview'&&route?.smaOptimization===true&&route.view==='preview'&&
  route.searchKey===v.key&&route.assetId===v.id&&route.portal===v.portal;
}

export function previewReloadSnapshot(route,origin){
 if(!route?.searchKey||!origin||origin.id!==route.assetId)return null;
 const view={kind:'preview',key:route.searchKey,id:origin.id,portal:route.portal,
  origin:origin.global?{global:true,query:origin.query,page:origin.page,chapter:origin.chapter??null,
   launcherId:origin.launcher?.id||null,mobile:origin.launcher?.dataset?.smaMobileTarget==='search'}:
   {global:false,query:origin.query,page:origin.page,portal:origin.portal}};
 return previewMatchesHistory(view,route)&&validPreview(view)?view:null;
}

export function galleryReloadStore(win){
 const entry=win.location.href;
 const reload=win.performance.getEntriesByType('navigation')[0]?.type==='reload';
 function clear(){try{win.sessionStorage.removeItem(key);}catch{}}
 return {
  save(owner,view){
   clear();
   if(!owner||!view)return;
   try{win.sessionStorage.setItem(key,JSON.stringify({owner,entry:win.location.href,view}));}catch{}
  },
  take(owner){
   try{
    const saved=JSON.parse(win.sessionStorage.getItem(key));
    clear();
    if(!reload||!owner||saved?.owner!==owner||saved.entry!==entry)return null;
    const v=saved.view;
    if(v?.kind==='preview')return validPreview(v)?v:null;
    if(!v||typeof v.query!=='string'||!portals.has(v.portal)||!Number.isSafeInteger(v.page)||v.page<0||
       !validId(v.selected)||!validId(v.file)||!controls.has(v.focus))return null;
    return v;
   }catch{clear();return null;}
  },
  clear
 };
}
