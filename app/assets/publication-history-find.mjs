import {historyStatuses,historyPlatforms} from './publication-history-model.mjs';
const id=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function readHistoryFind(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||
  value.ok!==true||value.version!==1||value.can_upload!==false||
  value.can_publish!==false||typeof value.has_more!=='boolean'||
  !Array.isArray(value.entries)||value.entries.length>20)throw Error('HISTORY_FIND_INVALID');
 const seen=new Set();
 const entries=value.entries.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||
   !id.test(row.id)||seen.has(row.id)||typeof row.title!=='string'||
   row.title.length>180||!Object.hasOwn(historyPlatforms,row.platform)||
   !Object.hasOwn(historyStatuses,row.status)||typeof row.created_at!=='string'||
   !Number.isFinite(Date.parse(row.created_at)))throw Error('HISTORY_FIND_INVALID');
  seen.add(row.id);
  return {id:row.id,title:row.title,platform:row.platform,status:row.status,created_at:row.created_at};
 });
 return {entries,has_more:value.has_more};
}
