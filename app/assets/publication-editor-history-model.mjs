import {validHistoryMonth} from './publication-history-model.mjs?v=3';
import {readEditorSettings,editorDefaults,editorUUID,editorTimestamp} from './media-editor-model.mjs?v=1';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const monthOf=v=>{const p=new Intl.DateTimeFormat('en-GB',{year:'numeric',month:'2-digit',timeZone:'Europe/Vienna'}).formatToParts(new Date(v));return p.find(x=>x.type==='year').value+'-'+p.find(x=>x.type==='month').value;};
export function readPublicationEditorHistory(value){
 if(!object(value)||value.ok!==true||value.version!==1||value.timezone!=='Europe/Vienna'||!(value.month===null||validHistoryMonth(value.month))||!Array.isArray(value.entries)||value.entries.length>20||typeof value.has_more!=='boolean'||!Number.isSafeInteger(value.total)||value.total<value.entries.length)throw Error('INVALID_HISTORY');
 const seen=new Set(),entries=value.entries.map(e=>{
  if(!object(e)||!editorUUID(e.id)||seen.has(e.id)||!editorUUID(e.asset_id)||!['image','video'].includes(e.media_kind)||!Number.isInteger(e.revision)||e.revision<1||e.revision>2147483647||typeof e.file_name!=='string'||Array.from(e.file_name).length>500||typeof e.asset_revision!=='string'||!e.asset_revision||e.asset_revision.length>250||!editorTimestamp(e.recorded_at)||value.month!==null&&monthOf(e.recorded_at)!==value.month||!Array.isArray(e.changed_fields)||!e.changed_fields.length||e.changed_fields.length>10||e.changed_fields.some(k=>!Object.hasOwn(editorDefaults,k))||new Set(e.changed_fields).size!==e.changed_fields.length)throw Error('INVALID_HISTORY');
  const settings=readEditorSettings(e.settings),previous_settings=readEditorSettings(e.previous_settings),changed_fields=Object.keys(settings).filter(k=>settings[k]!==previous_settings[k]).sort();
  if(JSON.stringify([...e.changed_fields].sort())!==JSON.stringify(changed_fields))throw Error('INVALID_HISTORY');
  seen.add(e.id);return {...Object.fromEntries(['id','asset_id','asset_revision','file_name','media_kind','revision','recorded_at'].map(k=>[k,e[k]])),settings,previous_settings,changed_fields};
 });
 const last=entries.at(-1);if(value.has_more?entries.length!==20||value.total<=20||!object(value.next)||value.next.before_id!==last.id||value.next.before_at!==last.recorded_at:value.next!==null)throw Error('INVALID_HISTORY');
 return {entries,total:value.total,month:value.month,next:value.has_more?{before_at:last.recorded_at,before_id:last.id}:null};
}
