// Pure client-side search over the current authenticated SMA file catalog.
// No new API, uploads, cross-customer index, persistence or publication.
const clean=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
 .toLocaleLowerCase('de').replace(/[\s\-_]+/g,' ').trim();
const portals=new Set(['youtube','tiktok','instagram','facebook']);
export function filterDashboardFiles(files,query='',portal='all'){
 if(!Array.isArray(files))return [];
 const tokens=clean(query).split(' ').filter(Boolean).slice(0,12);
 const chosen=portals.has(portal)?portal:'all';
 return files.filter(f=>{
  if(!f||typeof f.id!=='string'||typeof f.name!=='string')return false;
  const assignments=Array.isArray(f.assignments)?f.assignments:[];
  if(chosen!=='all'&&!assignments.some(a=>a?.platform===chosen))return false;
  const haystack=clean([f.name, f.media_kind==='video'?'Video':'Bild',
   ...assignments.filter(a=>portals.has(a?.platform)).map(a=>a.platform)
  ].join(' '));
  return tokens.every(t=>haystack.includes(t));
 });
}
export function searchFilePage(files,id,pageSize=10){
 if(!Array.isArray(files)||!Number.isSafeInteger(pageSize)||pageSize<1)return -1;
 const index=files.findIndex(f=>f?.id===id);
 return index<0?-1:Math.floor(index/pageSize);
}
