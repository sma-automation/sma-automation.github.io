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
export function historyStatusLabel(status,window){
 if(window){
  if(window.status==='expired'||Date.parse(window.expires_at)<=Date.now())return 'Vorbereitung abgelaufen';
  if(window.status==='recheck')return 'Kontoprüfung erforderlich';
  if(status==='prepared')return 'Freigabe ausstehend';
 }
 return historyStatuses[status][0];
}
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

export const validHistoryMonth=v=>typeof v==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(v);
export const formatHistoryMonth=v=>v===null?'Alle Monate':new Intl.DateTimeFormat('de-AT',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(v+'-01T12:00:00Z'));
const calendarMonth=value=>{
 const parts=new Intl.DateTimeFormat('en-GB',{year:'numeric',month:'2-digit',timeZone:'Europe/Vienna'}).formatToParts(new Date(value));
 return parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value;
};
export function readPublicationHistoryMonths(value){
 if(!object(value)||value.version!==2||value.timezone!=='Europe/Vienna'||!(value.month===null||validHistoryMonth(value.month)))throw Error('INVALID_HISTORY');
 const {entries,next}=readPublicationHistory({...value,version:1}),s=value.summary;
 if(!object(s)||!Number.isSafeInteger(s.orders)||s.orders<entries.length||!Number.isSafeInteger(s.public_confirmed)||s.public_confirmed<0||s.public_confirmed>s.orders||!Array.isArray(s.platforms)||s.platforms.length>4||s.platforms.length>s.orders||new Set(s.platforms).size!==s.platforms.length||s.platforms.some(p=>!Object.hasOwn(historyPlatforms,p)||p==='unknown'))throw Error('INVALID_HISTORY');
 if(entries.some(e=>(value.month!==null&&calendarMonth(e.created_at)!==value.month)||(e.platform!=='unknown'&&!s.platforms.includes(e.platform))))throw Error('INVALID_HISTORY');
 if(!Array.isArray(value.months)||value.months.length>12)throw Error('INVALID_HISTORY');
 const months=value.months.map((m,i)=>{
  if(!object(m)||!validHistoryMonth(m.month)||!Number.isSafeInteger(m.orders)||m.orders<1||i>0&&value.months[i-1].month<=m.month)throw Error('INVALID_HISTORY');
  return {month:m.month,orders:m.orders};
 });
 return {entries,next,month:value.month,summary:{orders:s.orders,public_confirmed:s.public_confirmed,platforms:[...s.platforms]},months};
}

export const textHistoryKey=e=>e.preview_id+':'+e.revision+':'+e.platform;
export function readPublicationTextHistory(value){
 if(!object(value)||value.ok!==true||value.version!==1||value.timezone!=='Europe/Vienna'||!(value.month===null||validHistoryMonth(value.month))||!Array.isArray(value.entries)||value.entries.length>20||typeof value.has_more!=='boolean'||!Number.isSafeInteger(value.total)||value.total<value.entries.length)throw Error('INVALID_HISTORY');
 const seen=new Set();
 const entries=value.entries.map(e=>{
  if(!object(e)||!uuid(e.preview_id)||!Number.isSafeInteger(e.revision)||e.revision<1||e.revision>2147483647||!Object.hasOwn(historyPlatforms,e.platform)||e.platform==='unknown'||typeof e.body!=='string'||[...e.body].length<10||[...e.body].length>1200||!timestamp(e.recorded_at)||value.month!==null&&calendarMonth(e.recorded_at)!==value.month||seen.has(textHistoryKey(e)))throw Error('INVALID_HISTORY');
  const hashtags=e.hashtags??null;
  if(hashtags!==null&&(!Array.isArray(hashtags)||hashtags.length>3||hashtags.some(tag=>typeof tag!=='string'||[...tag].length<1||[...tag].length>50||!/^[_\p{L}\p{N}]+$/u.test(tag)||tag!==tag.normalize('NFC'))||new Set(hashtags.map(tag=>tag.toLocaleLowerCase('de'))).size!==hashtags.length))throw Error('INVALID_HISTORY');
  seen.add(textHistoryKey(e));return {preview_id:e.preview_id,revision:e.revision,platform:e.platform,body:e.body,hashtags:hashtags===null?null:[...hashtags],recorded_at:e.recorded_at};
 });
 const last=entries.at(-1),next=last?{before_at:last.recorded_at,before_id:last.preview_id,before_revision:last.revision,before_platform:last.platform}:null;
 if(value.has_more?entries.length!==20||value.total<=entries.length||!object(value.next)||Object.keys(next).some(k=>value.next[k]!==next[k]):value.next!==null)throw Error('INVALID_HISTORY');
 return {entries,next:value.has_more?next:null,month:value.month,total:value.total};
}
