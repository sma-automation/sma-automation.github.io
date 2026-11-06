import {readMusicSetting} from './media-music-model.mjs?v=1';
export const editorDefaults=Object.freeze({format:'original',fit:'contain',position_x:50,position_y:50,start_ms:0,end_ms:null,cover_ms:null,overlay_text:'',overlay_position:'bottom',audio_volume:100});
export const editorLabels=Object.freeze({format:'Format',fit:'Bildeinpassung',position_x:'Ausschnitt horizontal',position_y:'Ausschnitt vertikal',start_ms:'Schnittbeginn',end_ms:'Schnittende',cover_ms:'Cover-Zeitpunkt',overlay_text:'Texteinblendung',overlay_position:'Textposition',audio_volume:'Originalton',music:'Musikspur'});
export const editorUUID=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const editorTimestamp=v=>typeof v==='string'&&/^20\d{2}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v));
export function readEditorSettings(s,file){
 if(!object(s)||![10,11].includes(Object.keys(s).length)||Object.keys(s).some(k=>k!=='music'&&!Object.hasOwn(editorDefaults,k))||Object.keys(editorDefaults).some(k=>!Object.hasOwn(s,k))||!['original','9:16','1:1','16:9'].includes(s.format)||!['contain','cover'].includes(s.fit)||!['top','center','bottom'].includes(s.overlay_position)||typeof s.overlay_text!=='string'||Array.from(s.overlay_text).length>160||/[\u0000-\u001f\u007f]/.test(s.overlay_text))throw Error('INVALID_SETTINGS');
 for(const k of ['position_x','position_y','audio_volume','start_ms','end_ms','cover_ms']){if(['end_ms','cover_ms'].includes(k)&&s[k]===null)continue;if(!Number.isSafeInteger(s[k])||s[k]<0||s[k]>99999999999999||(['position_x','position_y','audio_volume'].includes(k)&&s[k]>100))throw Error('INVALID_SETTINGS');}
 if(file){if(file.media_kind==='image'||!Number.isFinite(file.duration_ms)||file.duration_ms<=0){if(s.start_ms!==0||s.end_ms!==null||s.cover_ms!==null)throw Error('INVALID_SETTINGS');}else{const end=s.end_ms??file.duration_ms;if(s.start_ms>=end||end>file.duration_ms||s.cover_ms!==null&&(s.cover_ms<s.start_ms||s.cover_ms>=end))throw Error('INVALID_SETTINGS');}if(file.media_kind==='image'&&s.audio_volume!==100)throw Error('INVALID_SETTINGS');}
 if(Object.hasOwn(s,'music')&&(file&&file.media_kind!=='video'))throw Error('INVALID_SETTINGS');
 return {...Object.fromEntries(Object.keys(editorDefaults).map(k=>[k,s[k]])),...(Object.hasOwn(s,'music')?{music:readMusicSetting(s.music)}:{})};
}
export function readEditorState(r,file){
 if(!object(r)||r.ok!==true)throw Error(r?.code||'UNAVAILABLE');
 if(r.version!==1||r.can_publish!==false||r.asset_id!==file.id||r.asset_revision!==file.revision||!Number.isInteger(r.revision)||r.revision<0||r.revision>2147483647||typeof r.changed!=='boolean'||(r.revision===0?r.saved_at!==null:!editorTimestamp(r.saved_at)))throw Error('UNAVAILABLE');
 return {revision:r.revision,settings:readEditorSettings(r.settings,file),saved_at:r.saved_at,changed:r.changed};
}
export function readEditorFiles(r){
 if(!object(r)||r.ok!==true||!Array.isArray(r.files)||r.files.length>1000)throw Error(r?.code||'UNAVAILABLE');
 const ids=new Set();return r.files.map(f=>{if(!object(f)||!editorUUID(f.id)||ids.has(f.id)||typeof f.name!=='string'||Array.from(f.name).length>500||typeof f.revision!=='string'||!f.revision||f.revision.length>250||!['image','video'].includes(f.media_kind)||f.duration_ms!==null&&(!Number.isSafeInteger(f.duration_ms)||f.duration_ms<0)||[f.width_px,f.height_px].some(n=>n!==null&&(!Number.isInteger(n)||n<=0))||f.size_bytes!==undefined&&(!Number.isSafeInteger(f.size_bytes)||f.size_bytes<0))throw Error('UNAVAILABLE');ids.add(f.id);return Object.fromEntries(['id','name','revision','media_kind','mime_type','duration_ms','width_px','height_px',...(f.size_bytes!==undefined?['size_bytes']:[])].map(k=>[k,f[k]]));});
}
export function editorValue(key,v){
 if(key==='music')return v?v.name+' · '+v.volume+' % · ab '+(v.start_ms/1000).toLocaleString('de-AT')+' s':'Keine';
 if(key.endsWith('_ms'))return v===null?(key==='end_ms'?'Dateiende':'Nicht gewählt'):(v/1000).toLocaleString('de-AT',{maximumFractionDigits:3})+' s';
 if(['position_x','position_y','audio_volume'].includes(key))return v+' %';
 const values={original:'Original',contain:'Ganzes Bild',cover:'Fläche ausfüllen',top:'Oben',center:'Mitte',bottom:'Unten'};return Object.hasOwn(values,v)?values[v]:v||'Keine';
}
