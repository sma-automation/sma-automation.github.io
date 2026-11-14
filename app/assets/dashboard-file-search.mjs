import {describeFile} from './file-description.mjs';
// Pure client-side search over the current authenticated SMA file catalog.
// No new API, uploads, cross-customer index, persistence or publication.
const clean=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
 .toLocaleLowerCase('de').replace(/[\s\-_]+/g,' ').trim();
const portals=new Set(['youtube','tiktok','instagram','facebook']);
function assignmentsFor(file,portal){
 const assignments=Array.isArray(file.assignments)?file.assignments:[];
 return assignments.filter(a=>portals.has(a?.platform)&&(!portals.has(portal)||a.platform===portal));
}
function currentTitle(assignment){
 return assignment?.status==='assigned'&&typeof assignment.title==='string'?assignment.title.trim():'';
}
function terms(query){return clean(query).split(' ').filter(Boolean).slice(0,12);}
function labelFor(file,assignment){
 return describeFile({...file,display:{...file.display,draft_title:currentTitle(assignment)}});
}
function matches(file,assignment,tokens){
 if(!tokens.length)return true;
 const label=labelFor(file,assignment);
 const text=clean([file.name,file.display?.source_name,label.title,label.version,
  currentTitle(assignment),assignment?.platform,file.media_kind==='video'?'Video':'Bild'].join(' '));
 return tokens.every(t=>text.includes(t));
}
export function dashboardFileDescription(file,query='',portal='all'){
 const assignments=assignmentsFor(file,portal);
 const tokens=terms(query);
 const candidates=assignments.filter(a=>a.status==='assigned'&&matches(file,a,tokens));
 // A filename can match several portals. Prefer the portal whose saved title the customer typed.
 const assignment=candidates.find(a=>tokens.length&&tokens.every(t=>clean(currentTitle(a)).includes(t)))||
  candidates.find(a=>currentTitle(a))||candidates[0]||assignments.find(a=>a.status==='assigned');
 const section=portals.has(portal)?portal:assignment?.platform||'youtube';
 if(!file.display&&!currentTitle(assignment))return {title:file.name,version:'',portal:section};
 return {...labelFor(file,assignment),portal:section};
}
export function filterDashboardFiles(files,query='',portal='all'){
 if(!Array.isArray(files))return [];
 const tokens=terms(query);
 return files.filter(file=>{
  if(!file||typeof file.id!=='string'||typeof file.name!=='string')return false;
  const assignments=assignmentsFor(file,portal);
  if(!assignments.length)return !portals.has(portal)&&matches(file,null,tokens);
  return assignments.some(a=>matches(file,a,tokens));
 });
}
export function searchFilePage(files,id,pageSize=10){
 if(!Array.isArray(files)||!Number.isSafeInteger(pageSize)||pageSize<1)return -1;
 const index=files.findIndex(f=>f?.id===id);
 return index<0?-1:Math.floor(index/pageSize);
}
