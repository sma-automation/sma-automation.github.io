export const historyStatuses=Object.freeze({
 preparing:['Wird vorbereitet','Die Vorbereitung läuft.'],
 prepared:['Vorbereitet','Die finale Freigabe steht noch aus.'],
 approved:['Freigegeben','Die Freigabe allein bestätigt noch keine Veröffentlichung.'],
 checking:['Wird geprüft','Die Auftragsprüfung läuft.'],
 blocked:['Blockiert','Eine erforderliche Prüfung oder Voraussetzung ist nicht erfüllt.'],
 checked:['Prüfung abgeschlossen','Noch keine Veröffentlichung bestätigt.'],
 cancelled:['Abgebrochen','Der Auftrag wurde abgebrochen.'],
 pending:['Übertragung vorbereitet','Noch kein abgeschlossenes Ergebnis bestätigt.'],
 uploading:['Wird übertragen','Die Übertragung ist noch nicht abgeschlossen.'],
 processing:['Wird verarbeitet','Das Portal verarbeitet den Beitrag.'],
 failed:['Fehlgeschlagen','Das Portal hat einen Fehler gemeldet.'],
 uncertain:['Ergebnis unklar','Das Ergebnis muss geprüft werden. Nicht erneut veröffentlichen.'],
 needs_review:['Prüfung erforderlich','Das gespeicherte Ergebnis lässt sich nicht eindeutig zuordnen.'],
 complete_unknown:['Abgeschlossen · Sichtbarkeit unbestätigt','Die öffentliche Verfügbarkeit ist nicht bestätigt.'],
 public_confirmed:['Öffentlich bestätigt','Das Portal hat die öffentliche Verfügbarkeit bestätigt.'],
 private_complete:['Privat abgeschlossen','Der Beitrag ist als privat bestätigt.'],
 unlisted_complete:['Nicht gelistet abgeschlossen','Der Beitrag ist als nicht gelistet bestätigt.'],
 limited_complete:['Eingeschränkt sichtbar','Der Beitrag ist für den gewählten eingeschränkten Personenkreis abgeschlossen.'],
 unknown:['Status unbekannt','Für diesen Auftrag liegt kein eindeutiger Status vor.']
});
export const historyPlatforms=Object.freeze({youtube:'YouTube',tiktok:'TikTok',instagram:'Instagram',facebook:'Facebook',unknown:'Portal unbekannt'});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const timestamp=v=>typeof v==='string'&&/^20\d{2}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v));
export function readPublicationHistory(value){
 if(!object(value)||value.ok!==true||value.version!==1||!Array.isArray(value.entries)||value.entries.length>20||typeof value.has_more!=='boolean')throw Error('INVALID_HISTORY');
 const seen=new Set();
 const entries=value.entries.map(e=>{
  if(!object(e)||!uuid(e.id)||seen.has(e.id)||!Object.hasOwn(historyPlatforms,e.platform)||!Object.hasOwn(historyStatuses,e.status)||typeof e.title!=='string'||e.title.length>400||typeof e.target_name!=='string'||e.target_name.length>320||!timestamp(e.created_at)||!timestamp(e.updated_at))throw Error('INVALID_HISTORY');
  seen.add(e.id);return {id:e.id,platform:e.platform,status:e.status,title:e.title,target_name:e.target_name,created_at:e.created_at,updated_at:e.updated_at};
 });
 const last=entries.at(-1);
 if(value.has_more?entries.length!==20||!object(value.next)||!uuid(value.next.before_id)||!timestamp(value.next.before_at)||value.next.before_id!==last.id||value.next.before_at!==last.created_at:value.next!==null)throw Error('INVALID_HISTORY');
 return {entries,next:value.has_more?{before_at:value.next.before_at,before_id:value.next.before_id}:null};
}
