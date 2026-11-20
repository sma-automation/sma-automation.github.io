// One small dashboard-wide finder over already loaded, owner-bound data.
// No network, credentials, new search endpoint, persistence or publishing.
import {filterDashboardFiles,dashboardFileDescription} from './dashboard-file-search.mjs?v=2';
const normalize=x=>String(x??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('de').trim();
export const sectionCatalog=Object.freeze([
 {key:'overview',label:'Übersicht',hint:'Dashboard Start'},
 {key:'publishing',label:'Veröffentlichung',hint:'Beiträge vorbereiten'},
 {key:'files',label:'Meine Dateien',hint:'Dateien suchen und bearbeiten'},
 {key:'history',label:'History & Aufträge',hint:'Aufträge Bearbeiten Analyse'},
 {key:'content',label:'Content',hint:'Magic Effect Texte'},
 {key:'music',label:'Musikbibliothek',hint:'Tracks Playlists'},
 {key:'shop',label:'Shop',hint:'Produkte Bestellungen'},
 {key:'website',label:'Webseite',hint:'Domain Firmendaten WordPress'},
 {key:'settings',label:'Einstellungen',hint:'Kundenkonto Paket'},
 {key:'tutorials',label:'Tutorials',hint:'Hilfe Anleitungen'},
 {key:'seller',label:'Verkäufer',hint:'Verkauf Beratung'},
 {key:'assistant',label:'Assistent',hint:'24/7 Assistent'},
 {key:'portals',label:'Portale',hint:'Veröffentlichung · Social Media verbinden · YouTube, TikTok, Instagram und Facebook',page:'publishing'},
 {key:'approval-status',label:'Freigabestatus der Aufträge',hint:'History · Gespeicherte Kundenfreigabe und Auftragsstatus ansehen',page:'history',historyView:'orders'},
 {key:'saved-texts',label:'Gespeicherte Beitragstexte',hint:'History · Portaltexte und frühere Textvarianten ansehen',page:'history',historyView:'texts'}
]);
export function canSearchHistory(value){
 const q=typeof value==='string'?value.trim():'';
 return q.length>=2&&q.length<=80&&new TextEncoder().encode(q).length<=240;
}
export function canSearchOrders(value){
 const q=typeof value==='string'?value.trim():'';
 return q.length>=2&&q.length<=60&&/^[\p{L}\p{N} #./-]*$/u.test(q);
}
export function quickFindMatches(query,areas,files,retainedFileId=null){
 const q=normalize(query);
 const nav=Array.isArray(areas)?areas:[];
 const matchedFiles=q.length>=2?filterDashboardFiles(files||[],q):[];
 const visibleFiles=matchedFiles.slice(0,10);
 // A catalog refresh may move the open result beyond the compact list.
 // Retain it only while it still matches the current owner's query.
 if(retainedFileId&&!visibleFiles.some(file=>file.id===retainedFileId)){
  const retained=matchedFiles.find(file=>file.id===retainedFileId);
  if(retained)visibleFiles[visibleFiles.length-1]=retained;
 }
 return {
  areas:nav.filter(a=>a&&typeof a.key==='string'&&typeof a.label==='string'&&(!q||normalize(a.label+' '+(a.hint||'')).includes(q))).slice(0,8),
  files:visibleFiles,
  fileCount:matchedFiles.length
 };
}
export function mountDashboardQuickFind({doc,getAreas,getFiles,getFileStatus=()=> 'ready',getFileWarning=()=>'',getFileRetry=()=>null,onRetryFiles,onNavigate,onOpenFile,onDismiss}){
 if(!doc||[getAreas,getFiles,onNavigate,onOpenFile].some(fn=>typeof fn!=='function')||
   doc.getElementById('smaGlobalQuickFind'))return null;
 const header=[...doc.querySelectorAll('header,[role="banner"],.topbar,.top-bar')]
  .find(x=>!x.closest('[id^="page-"],aside,nav'));
 if(!header)return null;
 const anchor=header.querySelector('.topbar-actions,.top-bar-actions')||header;
 const create=(tag,text)=>{const el=doc.createElement(tag);if(text)el.textContent=text;return el;};
 const style=create('style');style.textContent=[
 '#smaGlobalQuickFind{max-width:100%}',
 '#smaGlobalQuickFind:focus-visible{outline:2px solid #4065d8;outline-offset:2px}',
 '#smaQuickFindDialog[hidden]{display:none!important}',
 '#smaQuickFindDialog{position:fixed;z-index:2147483000;inset:0;background:rgba(10,20,40,.55);display:flex;justify-content:center;align-items:flex-start;padding:9vh 16px 16px}',
 '#smaQuickFindPanel{width:min(600px,100%);max-height:82vh;overflow:auto;background:#fff;color:#17233b;border-radius:14px;box-shadow:0 22px 80px rgba(10,20,50,.3);padding:18px;border:1px solid #d3deef}',
 '#smaQuickFindPanel .sma-qf-head{display:flex;align-items:center;justify-content:space-between;gap:10px}',
 '#smaQuickFindPanel h2{margin:0;font:700 19px Inter,Arial,sans-serif}',
 '#smaQuickFindPanel .sma-qf-close{border:0;background:transparent;color:#405271;font-size:26px;cursor:pointer}',
 '#smaQuickFindInput{display:block;width:100%;margin:14px 0 6px;padding:13px 14px;border:1px solid #9aacca;border-radius:9px;font:500 15px Inter,Arial,sans-serif;background:#fff;color:#17233b}',
 '#smaQuickFindResults{display:grid;gap:5px;margin-top:13px}',
 '#smaQuickFindResults .sma-qf-item{display:flex;flex-direction:column;align-items:flex-start;width:100%;gap:3px;margin:0;padding:11px 13px;border:1px solid #e1e7f1;border-radius:9px;text-align:left;background:#fff;color:#17233b;cursor:pointer;overflow-wrap:anywhere}',
 '#smaQuickFindResults .sma-qf-item:hover,#smaQuickFindResults .sma-qf-item:focus-visible{background:#edf2ff;border-color:#99abe4;outline:none}',
 '#smaQuickFindResults small{font-size:12px;color:#66758b}',
 '#smaQuickFindPanel .sma-qf-status{font:400 12px Inter,Arial,sans-serif;color:#61708b;margin:8px 0 0}'
 ].join('');
 doc.head?.append(style);
 const button=create('input');button.type='search';button.autocomplete='off';button.placeholder='Dateien suchen';button.setAttribute('aria-label','Dashboard durchsuchen');button.id='smaGlobalQuickFind';
 button.title='Bereiche und Dateien suchen';button.setAttribute('aria-haspopup','dialog');
 button.setAttribute('aria-controls','smaQuickFindDialog');button.setAttribute('aria-expanded','false');
 anchor.prepend(button);
 const overlay=create('div');overlay.id='smaQuickFindDialog';overlay.hidden=true;
 const panel=create('section');panel.id='smaQuickFindPanel';panel.setAttribute('role','dialog');
 panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','smaQuickFindTitle');
 const head=create('div');head.className='sma-qf-head';
 const h=create('h2','SMA durchsuchen');h.id='smaQuickFindTitle';
 const close=create('button','×');close.type='button';close.className='sma-qf-close';close.setAttribute('aria-label','Suche schließen');head.append(h,close);
 const input=create('input');input.type='search';input.id='smaQuickFindInput';input.placeholder='Dateien suchen';
 input.setAttribute('aria-label','Dashboard durchsuchen');input.autocomplete='off';
 const status=create('p');status.className='sma-qf-status';status.setAttribute('role','status');
 const retry=create('button');retry.type='button';retry.hidden=true;
 retry.addEventListener('click',()=>{
  if(!disposed&&!overlay.hidden&&getFileStatus()!=='loading'&&getFileRetry())onRetryFiles?.();
 });
 const results=create('div');results.id='smaQuickFindResults';
 panel.append(head,input,status,retry,results);overlay.append(panel);doc.body.append(overlay);
 let disposed=false,launcher=button,retainedFileId=null;
 function translateSearch(){
  const en=doc.documentElement.lang==='en';
  const label=en?'Search files':'Dateien suchen';
  button.placeholder=input.placeholder=label;
  const files=doc.getElementById('smaFileSearch');if(files)files.placeholder=label;
  button.title=en?'Search sections and files':'Bereiche und Dateien suchen';
  button.setAttribute('aria-label',en?'Search dashboard':'Dashboard durchsuchen');
 }
 translateSearch();
 const languageObserver=new doc.defaultView.MutationObserver(translateSearch);
 languageObserver.observe(doc.documentElement,{attributes:true,attributeFilter:['lang']});
 function focusLauncher(target=launcher){
  if(target&&target!==doc.body&&target!==doc.documentElement){
   target.focus?.();if(doc.activeElement===target)return;
  }
  button.focus();
  if(doc.activeElement!==button)doc.querySelector('#smaMobileQuickNav [data-sma-mobile-target="search"]')?.focus();
 }
 function hide(restoreFocus=true){overlay.hidden=true;button.value='';button.setAttribute('aria-expanded','false');input.value='';retainedFileId=null;results.replaceChildren();if(restoreFocus)focusLauncher();}
 function dismiss(){hide();onDismiss?.();}
 function item(title,subtitle,handler,restoreFocus=true,key=null){
  const el=create('button');el.type='button';el.className='sma-qf-item';
  if(key)el.dataset.quickAction=key;
  el.append(create('strong',title),create('small',subtitle));el.addEventListener('click',async()=>{
   if(disposed)return;
   try{if(await handler()===true)hide(restoreFocus);else status.textContent='Bereich derzeit nicht verfügbar.';}
   catch{status.textContent='Der Bereich konnte nicht geöffnet werden.';}
  });results.append(el);return el;
 }
 function render(restoredFileId){
  if(disposed||overlay.hidden)return;
  const focusedFile=restoredFileId===undefined?doc.activeElement?.dataset?.quickFile:restoredFileId;
  const focusedAction=restoredFileId===undefined?doc.activeElement?.dataset?.quickAction:null;
  if(focusedFile)retainedFileId=focusedFile;
  results.replaceChildren();
  const query=input.value.trim(),areas=getAreas();
  const found=quickFindMatches(query,areas,getFiles(),retainedFileId);
  for(const a of found.areas)item(a.label,a.hint||'Dashboard-Bereich',()=>onNavigate(a.key),!a.page,'area:'+a.key);
  for(const file of found.files){
   const label=dashboardFileDescription(file,query);
   const hit=item(label.title,label.version||'Kundendatei · im Portal öffnen',()=>onOpenFile(file.id,label.portal,input.value,launcher),false);
   hit.dataset.quickFile=file.id;
  }
  if(found.fileCount>found.files.length&&Array.isArray(areas)&&areas.some(a=>a.key==='files')){
   item('Alle '+found.fileCount+' Dateien anzeigen','Gefilterte Galerie öffnen',()=>onNavigate('files',query),false,'all-files');
  }
  // Deep-search actions are NOT matches; keep them out of the hit count.
  let deepActions=0;
  if(Array.isArray(areas)){
   if(canSearchHistory(query)&&areas.some(a=>a.key==='history')){
    item('In Aufträgen suchen','Eigene Veröffentlichungsaufträge durchsuchen',()=>onNavigate('history-search',query),false,'history-search');
    deepActions++;
   }
   if(canSearchOrders(query)&&areas.some(a=>a.key==='shop')){
    item('In Bestellungen suchen','Bestellnummern im Shop durchsuchen',()=>onNavigate('shop-search',query),false,'shop-search');
    deepActions++;
   }
  }
  const directHits=found.areas.length+found.fileCount;
  const fileStatus=getFileStatus(),fileWarning=getFileWarning();
  const retryAction=onRetryFiles&&getFileRetry();
  const retryFocused=doc.activeElement===retry;
  retry.hidden=!retryAction;
  retry.textContent=retryAction==='folder'?'Ordnerabgleich wiederholen':retryAction==='status'?'Abgleichstatus prüfen':'Dateiliste erneut laden';
  retry.setAttribute('aria-disabled',String(fileStatus==='loading'));
  if(retry.hidden&&retryFocused)input.focus();
  const prefix=directHits===1?'1 direkter Treffer':directHits>1?directHits+' direkte Treffer':'';
  if(fileStatus==='loading')
   status.textContent=(prefix?prefix+' · ':'')+(retryAction==='folder'?'Kundenordner wird geprüft …':'Kundendateien werden geladen …');
  else if(fileWarning)
   status.textContent=(prefix?prefix+' · ':'')+fileWarning;
  else if(fileStatus==='error')
   status.textContent=(prefix?prefix+' · ':'')+'Dateiliste nicht erreichbar.';
  else
   status.textContent=prefix||(deepActions?'Keine direkten Treffer. Suche in Aufträgen oder Bestellungen.':'Keine Treffer. Versuche einen kürzeren Begriff.');
  status.setAttribute('aria-busy',fileStatus==='loading'?'true':'false');
  if(focusedFile)focusFile(focusedFile);
  else if(focusedAction)([...results.children].find(el=>el.dataset.quickAction===focusedAction)||input).focus();
 }
 function focusFile(id){
  const hit=[...results.children].find(el=>el.dataset.quickFile===id);
  (hit||input).focus();
 }
 function restore(query,id,trigger=button){
  if(disposed)return;launcher=trigger;retainedFileId=id;
  const rect=button.getBoundingClientRect?.();
  overlay.classList.toggle('sma-header-results',trigger===button&&rect?.width>0);
  if(trigger===button&&rect?.width){
   overlay.style.setProperty('--search-x',rect.left+'px');overlay.style.setProperty('--search-y',rect.top+'px');
   overlay.style.setProperty('--search-width',rect.width+'px');overlay.style.setProperty('--search-height',rect.height+'px');
  }
  overlay.hidden=false;button.setAttribute('aria-expanded','true');input.value=query;render(id);
  focusFile(id);
 }
 function show(trigger=button){restore('',null,trigger);}
 const openFromHeader=()=>{if(overlay.hidden)restore(button.value,null,button);};
 button.addEventListener('input',openFromHeader);
 const keydown=e=>{
  if(disposed)return;
  if(e.key==='Tab'&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!overlay.hidden){
   // Keep keyboard navigation inside the modal without stealing focus from an opened destination.
   const controls=[close,input,...(retry.hidden?[]:[retry]),...results.children]
    .filter(el=>!el.hidden&&!el.disabled&&el.tabIndex>=0);
   const current=controls.indexOf(doc.activeElement);
   if(current<0||e.shiftKey&&current===0||!e.shiftKey&&current===controls.length-1){
    e.preventDefault();(e.shiftKey?controls.at(-1):controls[0])?.focus();
   }
   return;
  }
  if(e.key==='Escape'&&!overlay.hidden){e.preventDefault();dismiss();return;}
  if((e.ctrlKey||e.metaKey)&&e.key?.toLowerCase()==='k'){e.preventDefault();overlay.hidden?show(doc.activeElement||button):dismiss();}
 };
 const backdrop=e=>{if(e.target===overlay)dismiss();};
 const inputHandler=()=>{retainedFileId=null;render();};
 button.addEventListener('click',openFromHeader);close.addEventListener('click',dismiss);
 overlay.addEventListener('click',backdrop);input.addEventListener('input',inputHandler);
 doc.addEventListener('keydown',keydown);
 return {button,show,hide,restore,focusLauncher,refresh:render,destroy(){
  if(disposed)return;disposed=true;languageObserver.disconnect();doc.removeEventListener('keydown',keydown);
  input.removeEventListener('input',inputHandler);overlay.removeEventListener('click',backdrop);
  button.removeEventListener('input',openFromHeader);button.removeEventListener('click',openFromHeader);close.removeEventListener('click',dismiss);
  button.remove();overlay.remove();style.remove();
 }};
}
