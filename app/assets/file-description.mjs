const dateFormat=new Intl.DateTimeFormat('de-AT');
const timeFormat=new Intl.DateTimeFormat('de-AT',{hour:'2-digit',minute:'2-digit'});
function readableFilename(name){
 const stem=(name||'').replace(/\.[a-z0-9]{1,8}$/i,'').trim();
 // Generated export IDs, digests, camera counters and opaque upload tokens are poor titles.
 if(!stem||/^[a-f\d]{24,}$|[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}|^(?:(?:IMG|VID|DSC|MOV)[-_ ]?)?\d{5,}$/i.test(stem))return '';
 if(/^[a-zA-Z0-9_+=-]{25,}$/.test(stem)&&/[a-z]/.test(stem)&&/[A-Z]/.test(stem)&&/\d/.test(stem)&&/[a-zA-Z0-9]{20}/.test(stem))return '';
 return stem.replace(/_/g,' ');
}
export function describeFile(file){
 const video=file.media_kind==='video';
 const kind=video?'Video':'Bild';
 const variant={original:video?'Originalvideo':'Originalbild',clip:'Videoausschnitt',cover:'Titelbild',
  soundtrack:'Video mit SMA-Musik',export:video?'Bearbeitetes Video':'Bearbeitetes Bild'}[file.display?.variant]||kind;
 const duration=video&&Number.isFinite(file.duration_ms)&&file.duration_ms>0
  ? Math.max(0.1,Math.round(file.duration_ms/100)/10).toLocaleString('de-DE')+' Sek.' : '';
 let title=file.display?.product||file.display?.draft_title||readableFilename(file.display?.source_name)||readableFilename(file.name);
 if(!title){
  const modified=new Date(file.modified_at);
  title=Number.isFinite(modified.getTime())?kind+' vom '+dateFormat.format(modified)+' · '+timeFormat.format(modified):kind;
 }
 return {title,version:[variant,duration].filter(Boolean).join(' · ')};
}
