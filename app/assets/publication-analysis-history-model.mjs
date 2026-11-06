import {validHistoryMonth} from './publication-history-model.mjs?v=4';
import {editorUUID,editorTimestamp} from './media-editor-model.mjs?v=3';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const monthOf=v=>{const p=new Intl.DateTimeFormat('en-GB',{year:'numeric',month:'2-digit',timeZone:'Europe/Vienna'}).formatToParts(new Date(v));return p.find(x=>x.type==='year').value+'-'+p.find(x=>x.type==='month').value;};
export const analysisStatuses={
 processing:['Analyse läuft','Der Versuch wurde gestartet; ein abgeschlossenes Ergebnis liegt noch nicht vor.'],
 completed:['Analyse abgeschlossen','Ein Ergebnis wurde für den damaligen Dateistand gespeichert.'],
 failed:['Analyse fehlgeschlagen','Der Versuch endete ohne verwendbares Analyseergebnis.'],
 timed_out:['Zeit abgelaufen','Innerhalb der vorgesehenen Laufzeit wurde kein Abschluss gespeichert. Es erfolgt kein automatischer Neustart.']
};
export const analysisErrors={
 FILE_CHANGED:'Die Datei wurde während der Analyse geändert oder war nicht mehr verfügbar.',
 ACCESS_INACTIVE:'Der SMA-Zugang war beim Abschluss nicht mehr verfügbar.',
 FOLDER_UNAVAILABLE:'Der Kundenordner war nicht erreichbar.',
 CHECKSUM_REQUIRED:'Die erforderliche Dateiprüfsumme fehlte.',
 MEDIA_UNSUPPORTED:'Das Bild konnte nicht verarbeitet werden.',
 VIDEO_UNSUPPORTED:'Das Video konnte nicht verarbeitet werden.',
 MAGIC_UNAVAILABLE:'Die Analyse konnte nicht erfolgreich abgeschlossen werden.'
};
export function readPublicationAnalysisHistory(value){
 if(!object(value)||value.ok!==true||value.version!==1||value.can_publish!==false||value.timezone!=='Europe/Vienna'||!(value.month===null||validHistoryMonth(value.month))||!Array.isArray(value.entries)||value.entries.length>20||typeof value.has_more!=='boolean'||!Number.isSafeInteger(value.total)||value.total<value.entries.length)throw Error('INVALID_HISTORY');
 const seen=new Set(),entries=value.entries.map(e=>{
  if(!object(e)||!editorUUID(e.id)||seen.has(e.id)||!['image','video'].includes(e.media_kind)||typeof e.file_name!=='string'||Array.from(e.file_name).length>500||!editorTimestamp(e.started_at)||value.month!==null&&monthOf(e.started_at)!==value.month||!Object.hasOwn(analysisStatuses,e.status))throw Error('INVALID_HISTORY');
  if(['completed','failed'].includes(e.status)?!editorTimestamp(e.finished_at)||Date.parse(e.finished_at)<Date.parse(e.started_at):e.finished_at!==null)throw Error('INVALID_HISTORY');
  if(e.status==='failed'?!Object.hasOwn(analysisErrors,e.error_code):e.error_code!==null)throw Error('INVALID_HISTORY');
  seen.add(e.id);return Object.fromEntries(['id','file_name','media_kind','started_at','finished_at','status','error_code'].map(k=>[k,e[k]]));
 });
 const last=entries.at(-1);if(value.has_more?entries.length!==20||value.total<=20||!object(value.next)||value.next.before_id!==last.id||value.next.before_at!==last.started_at:value.next!==null)throw Error('INVALID_HISTORY');
 return {entries,total:value.total,month:value.month,next:value.has_more?{before_at:last.started_at,before_id:last.id}:null};
}
