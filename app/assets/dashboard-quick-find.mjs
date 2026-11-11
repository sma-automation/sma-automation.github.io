// One small dashboard-wide finder over already loaded, owner-bound data.
// No network, credentials, new search endpoint, persistence or publishing.
import {filterDashboardFiles} from './dashboard-file-search.mjs';
const normalize=x=>String(x??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('de').trim();
export const sectionCatalog=Object.freeze([
 {key:'overview',label:'Übersicht',hint:'Dashboard Start'},
 {key:'publishing',label:'Veröffentlichung',hint:'Portale und Beiträge'},
 {key:'files',label:'Meine Dateien',hint:'Dateien suchen und bearbeiten'},
 {key:'history',label:'History & Aufträge',hint:'Aufträge Bearbeiten Analyse'},
 {key:'social',label:'Social Media',hint:'YouTube TikTok Instagram Facebook'},
 {key:'content',label:'Content',hint:'Magic Effect Texte'},
 {key:'music',label:'Musikbibliothek',hint:'Tracks Playlists'},
 {key:'shop',label:'Shop',hint:'Produkte Bestellungen'},
 {key:'website',label:'Webseite',hint:'Domain Firmendaten WordPress'},
 {key:'settings',label:'Einstellungen',hint:'Kundenkonto Paket'},
 {key:'tutorials',label:'Tutorials',hint:'Hilfe Anleitungen'},
 {key:'seller',label:'Verkäufer',hint:'Verkauf Beratung'},
 {key:'assistant',label:'Assistent',hint:'24/7 Assistent'}
]);
export function quickFindMatches(query,areas,files){
 const q=normalize(query);
 const nav=Array.isArray(areas)?areas:[];
 return {
  areas:nav.filter(a=>a&&typeof a.key==='string'&&typeof a.label==='string'&&(!q||normalize(a.label+' '+(a.hint||'')).includes(q))).slice(0,8),
  files:q.length>=2?filterDashboardFiles(files||[],q).slice(0,10):[]
 };
}
export function mountDashboardQuickFind({doc,getAreas,getFiles,onNavigate,onOpenFile}){
 if(!doc||[getAreas,getFiles,onNavigate,onOpenFile].some(fn=>typeof fn!=='function')||
   doc.getElementById('smaGlobalQuickFind'))return null;
 const header=[...doc.querySelectorAll('header,[role="banner"],.topbar,.top-bar')]
  .find(x=>!x.closest('[id^="page-"],aside,nav'));
 if(!header)return null;
 const anchor=header.querySelector('.topbar-actions,.top-bar-actions')||header;
 const create=(tag,text)=>{const el=doc.createElement(tag);if(text)el.textContent=text;return el;};
 const style=create('style');style.textContent=[
 '#smaGlobalQuickFind{border:0;border-bottom:1px solid #aeb8c8;border-radius:0;background:transparent;color:inherit;padding:9px 12px;margin:0 8px;font:600 13px Inter,Arial,sans-serif;cursor:pointer}',
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
 const button=create('button','⌕  Suche');button.type='button';button.id='smaGlobalQuickFind';
 button.title='Bereiche und Dateien suchen';button.setAttribute('aria-haspopup','dialog');
 button.setAttribute('aria-controls','smaQuickFindDialog');button.setAttribute('aria-expanded','false');
 anchor.prepend(button);
 const overlay=create('div');overlay.id='smaQuickFindDialog';overlay.hidden=true;
 const panel=create('section');panel.id='smaQuickFindPanel';panel.setAttribute('role','dialog');
 panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','smaQuickFindTitle');
 const head=create('div');head.className='sma-qf-head';
 const h=create('h2','SMA durchsuchen');h.id='smaQuickFindTitle';
 const close=create('button','×');close.type='button';close.className='sma-qf-close';close.setAttribute('aria-label','Suche schließen');head.append(h,close);
 const input=create('input');input.type='search';input.id='smaQuickFindInput';input.placeholder='Datei oder Bereich eingeben …';
 input.setAttribute('aria-label','Dashboard durchsuchen');input.autocomplete='off';
 const status=create('p');status.className='sma-qf-status';status.setAttribute('role','status');
 const results=create('div');results.id='smaQuickFindResults';
 panel.append(head,input,status,results);overlay.append(panel);doc.body.append(overlay);
 let disposed=false;
 function hide(){overlay.hidden=true;button.setAttribute('aria-expanded','false');input.value='';results.replaceChildren();button.focus();}
 function item(title,subtitle,handler){
  const el=create('button');el.type='button';el.className='sma-qf-item';
  el.append(create('strong',title),create('small',subtitle));el.addEventListener('click',async()=>{
   if(disposed)return;
   try{if(await handler()===true)hide();else status.textContent='Bereich derzeit nicht verfügbar.';}
   catch{status.textContent='Der Bereich konnte nicht geöffnet werden.';}
  });results.append(el);
 }
 function render(){
  if(disposed||overlay.hidden)return;
  results.replaceChildren();
  const found=quickFindMatches(input.value,getAreas(),getFiles());
  for(const a of found.areas)item(a.label,a.hint||'Dashboard-Bereich',()=>onNavigate(a.key));
  for(const f of found.files)item(f.name,'Kundendatei · im Portal öffnen',()=>onOpenFile(f.id));
  status.textContent=results.children.length?results.children.length+' Treffer':'Keine Treffer. Versuche einen kürzeren Begriff.';
 }
 function show(){if(disposed)return;overlay.hidden=false;button.setAttribute('aria-expanded','true');input.value='';render();input.focus();}
 const keydown=e=>{
  if(disposed)return;
  if(e.key==='Escape'&&!overlay.hidden){e.preventDefault();hide();return;}
  if((e.ctrlKey||e.metaKey)&&e.key?.toLowerCase()==='k'){e.preventDefault();overlay.hidden?show():hide();}
 };
 const backdrop=e=>{if(e.target===overlay)hide();};
 const inputHandler=()=>render();
 button.addEventListener('click',show);close.addEventListener('click',hide);
 overlay.addEventListener('click',backdrop);input.addEventListener('input',inputHandler);
 doc.addEventListener('keydown',keydown);
 return {button,show,hide,refresh:render,destroy(){
  if(disposed)return;disposed=true;doc.removeEventListener('keydown',keydown);
  input.removeEventListener('input',inputHandler);overlay.removeEventListener('click',backdrop);
  button.removeEventListener('click',show);close.removeEventListener('click',hide);
  button.remove();overlay.remove();style.remove();
 }};
}
