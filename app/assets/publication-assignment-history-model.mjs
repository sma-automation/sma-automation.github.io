import {historyPlatforms,validHistoryMonth} from './publication-history-model.mjs?v=3';

export const assignmentEvents=Object.freeze({baseline:'Übernommener Stand',assigned:'Datei zugeordnet',updated:'Zuordnung aktualisiert'});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const timestamp=v=>typeof v==='string'&&/^20\d{2}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v));
const revision=v=>Number.isInteger(v)&&v>0&&v<=2147483647;
const text=(v,max)=>typeof v==='string'&&Array.from(v).length<=max;
const monthOf=v=>{const p=new Intl.DateTimeFormat('en-GB',{year:'numeric',month:'2-digit',timeZone:'Europe/Vienna'}).formatToParts(new Date(v));return p.find(x=>x.type==='year').value+'-'+p.find(x=>x.type==='month').value;};
export function readPublicationAssignmentHistory(value){
 if(!object(value)||value.ok!==true||value.version!==1||value.timezone!=='Europe/Vienna'||!(value.month===null||validHistoryMonth(value.month))||!Array.isArray(value.entries)||value.entries.length>20||typeof value.has_more!=='boolean'||!Number.isSafeInteger(value.total)||value.total<value.entries.length)throw Error('INVALID_HISTORY');
 const seen=new Set(),entries=value.entries.map(e=>{
  if(!object(e)||!uuid(e.id)||seen.has(e.id)||!uuid(e.asset_id)||!uuid(e.preview_id)||!Object.hasOwn(historyPlatforms,e.platform)||e.platform==='unknown'||!Object.hasOwn(assignmentEvents,e.event_kind)||!revision(e.assignment_revision)||!revision(e.preview_revision)||!text(e.asset_revision,250)||!e.asset_revision||!text(e.file_name,500)||!text(e.title,400)||!text(e.body,1200)||!timestamp(e.recorded_at)||!timestamp(e.source_updated_at)||value.month!==null&&monthOf(e.recorded_at)!==value.month)throw Error('INVALID_HISTORY');
  seen.add(e.id);return Object.fromEntries(['id','asset_id','platform','preview_id','preview_revision','assignment_revision','asset_revision','file_name','title','body','event_kind','recorded_at','source_updated_at'].map(k=>[k,e[k]]));
 });
 const last=entries.at(-1);
 if(value.has_more?entries.length!==20||value.total<=20||!object(value.next)||value.next.before_id!==last.id||value.next.before_at!==last.recorded_at:value.next!==null)throw Error('INVALID_HISTORY');
 return {entries,total:value.total,month:value.month,next:value.has_more?{before_at:last.recorded_at,before_id:last.id}:null};
}
