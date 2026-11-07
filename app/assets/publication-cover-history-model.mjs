import {readPublicationHistoryMonths} from './publication-history-model.mjs?v=3';

export const historyCoverStatuses=Object.freeze({
 not_recorded:['Noch nicht festgehalten','Für diesen Auftrag ist noch kein Cover-Status gespeichert. Das ist keine Übertragungsbestätigung.'],
 not_applicable:['Nicht vorgesehen','Für dieses Portal oder diesen Dateityp ist keine automatische Cover-Übergabe angebunden.'],
 none:['Ohne eigenes Cover','Dieser Auftrag wurde ohne eigenes Cover gestartet. Das Portal verwendet seine eigene Auswahl.'],
 pending:['Ausstehend','Die Cover-Übergabe steht noch aus und setzt eine freigegebene Videoübertragung voraus.'],
 sending:['Wird übertragen','Die Übertragung läuft. Eine Bestätigung liegt noch nicht vor.'],
 complete:['Übertragung bestätigt','YouTube hat die Übertragung des Covers bestätigt. Das bestätigt nicht die öffentliche Sichtbarkeit des Videos.'],
 timestamp_sent:['Bildzeitpunkt übergeben','Der gewählte Bildzeitpunkt wurde mit dem Video an TikTok übergeben. TikTok bestätigt das fertige Coverbild nicht separat.'],
 blocked:['Nicht übertragen','Die Videoübertragung ist fehlgeschlagen, blockiert oder abgebrochen. Das Cover wurde nicht übertragen.'],
 permission_required:['Berechtigung fehlt','YouTube hat die Cover-Übertragung wegen fehlender Berechtigung abgelehnt. Das bereits übertragene Video bleibt erhalten.'],
 failed:['Abgelehnt','YouTube hat die Cover-Übertragung abgelehnt. Das bereits übertragene Video bleibt erhalten.'],
 uncertain:['Ergebnis unklar','Die Cover-Übergabe muss geprüft werden. Es wird nicht automatisch erneut übertragen.'],
 needs_review:['Prüfung erforderlich','Der gespeicherte Cover-Status lässt sich nicht eindeutig diesem Auftrag zuordnen.']
});
const timestamp=v=>typeof v==='string'&&/^20\d{2}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v));
export function readPublicationCoverHistory(value){
 if(!value||value.version!==3)throw Error('INVALID_HISTORY');
 const result=readPublicationHistoryMonths({...value,version:2});
 result.entries=result.entries.map((entry,i)=>{
  const c=value.entries[i].cover;
  if(!c||Array.isArray(c)||typeof c!=='object'||!Object.hasOwn(historyCoverStatuses,c.status)
   ||!(c.updated_at===null||timestamp(c.updated_at))
   ||(['not_recorded','not_applicable'].includes(c.status)!==(c.updated_at===null))
   ||(['complete','sending','permission_required','failed'].includes(c.status)&&entry.platform!=='youtube')
   ||(c.status==='timestamp_sent'&&entry.platform!=='tiktok')
   ||(['complete','timestamp_sent','sending','permission_required','failed'].includes(c.status)&&!['public_confirmed','private_complete','unlisted_complete','limited_complete'].includes(entry.status)))throw Error('INVALID_HISTORY');
  const w=value.entries[i].approval_window;
  if(w!=null&&(typeof w!=='object'||!['active','expired','recheck'].includes(w.status)||!timestamp(w.expires_at)))throw Error('INVALID_HISTORY');
  const pending=value.entries[i].preparation_window;
  if(pending!=null&&(w!=null||!['active','expired'].includes(pending.status)||!timestamp(pending.expires_at)))throw Error('INVALID_HISTORY');
  return {...entry,...(pending&&entry.status==='preparing'?{preparation_window:{status:pending.status,expires_at:pending.expires_at}}:{}),...(w&&entry.status==='prepared'?{approval_window:{status:w.status,expires_at:w.expires_at}}:{}),cover:{status:c.status,updated_at:c.updated_at}};
 });
 return result;
}
