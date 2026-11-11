// SMA global find-and-open. Uses only the existing owner-scoped file catalog;
// never requests provider credentials, uploads, approvals or customer writes.
const PORTALS=Object.freeze(['youtube','tiktok','instagram','facebook']);
const PAGES=Object.freeze([
 {id:'files',page:'publishing',chapter:'files',label:'Dateien',keywords:'datei suchen medien galerie kundenordner video bild'},
 {id:'publishing',page:'publishing',chapter:'portals',label:'Veröffentlichung',keywords:'portale posting youtube tiktok instagram facebook optimieren'},
 {id:'history',page:'history',label:'Aufträge & History',keywords:'aufträge bearbeiten analyse verlauf veröffentlichungen'},
 {id:'overview',page:'overview',label:'Übersicht',keywords:'start dashboard kundenbereich'},
 {id:'content',page:'content',label:'Content & Magic Effect',keywords:'editor optimierung magic effect texte'},
 {id:'social',page:'social',label:'Social Media',keywords:'konten verbindungen youtube tiktok instagram facebook'},
 {id:'music',page:'music',label:'Musikbibliothek',keywords:'tracks playlist audio credits vertonung'},
 {id:'shop',page:'shop',label:'Shop & Bestellungen',keywords:'shopify bestellungen produkte marktplatz'},
 {id:'website',page:'website',label:'Webseite & Domain',keywords:'wordpress domain firmendaten homepage hosting'},
 {id:'settings',page:'settings',label:'Einstellungen',keywords:'firma profil paket zugang schnittstellen'},
 {id:'tutorials',page:'tutorials',label:'Tutorials & Hilfe',keywords:'anleitung schritte lernen'},
 {id:'seller',page:'seller',label:'SMA 24/7-Verkäufer',keywords:'verkäufer beratung'},
 {id:'assistant',page:'assistant',label:'Kundenassistent',keywords:'assistent einrichtung'}
]);
const normalize=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('de').replace(/\s+/g,' ').trim();
const validFileId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export function filePortal(file){
 const platforms=Array.isArray(file?.assignments)?file.assignments.filter(a=>a?.status==='assigned').map(a=>a.platform):[];
 return PORTALS.find(p=>platforms.includes(p))||(file?.media_kind==='image'?'instagram':'youtube');
}
export function findDashboardNav(doc,page){
 if(!PAGES.some(x=>x.page===page))return null;
 const selectors='aside a,aside button,aside [role="button"],.sidebar a,.sidebar button,[data-sidebar] a,[data-sidebar] button';
 const candidates=[...doc.querySelectorAll(selectors)];
 const byData=candidates.find(el=>[el.dataset?.page,el.dataset?.target,el.dataset?.section]
  .some(v=>v===page)||['#'+page,'#page-'+page].includes(el.getAttribute('href')));
 if(byData)return byData;
 const labels={
  overview:['übersicht','overview'],publishing:['veröffentlichung','publishing'],
  history:['history','verlauf'],content:['content','inhalte'],social:['social media'],
  music:['musikbibliothek','musik'],shop:['shop'],website:['webseite','website'],
  settings:['einstellungen','settings'],tutorials:['tutorials','hilfe'],
  seller:['verkäufer','sma 24/7-verkäufer'],assistant:['kundenassistent']
 };
 return candidates.find(el=>(labels[page]||[]).includes(normalize(el.textContent)))||null;
}
export function searchDashboard(query,{files=[],pages=[],limit=20}={}){
 const q=normalize(query),words=q.split(' ').filter(Boolean);
 const available=new Set(pages);
 const matched=(hay)=>words.every(word=>normalize(hay).includes(word));
 const areas=PAGES.filter(x=>available.has(x.page)&&(!q||matched(x.label+' '+x.keywords)))
   .slice(0,q?12:6).map(x=>({type:'area',...x}));
 const valid=(Array.isArray(files)?files:[]).filter(f=>validFileId(f?.id)&&typeof f.name==='string')
   .map(f=>({f,search:f.name+' '+(f.media_kind==='video'?'Video':'Bild')+' '+(f.assignments||[]).map(a=>a.platform||'').join(' ')}))
   .filter(({search})=>!q||matched(search))
   .sort((a,b)=>String(b.f.modified_at||'').localeCompare(String(a.f.modified_at||'')));
 const entries=valid.slice(0,Math.max(0,limit-areas.length)).map(({f})=>({
  type:'file',id:f.id,label:f.name,media_kind:f.media_kind,portal:filePortal(f),
  modified_at:f.modified_at||null,assigned:Array.isArray(f.assignments)?
   f.assignments.filter(a=>a?.status==='assigned').map(a=>a.platform):[]
 }));
 return [...areas,...entries];
}
function findHeader(doc){
 const items=[...doc.querySelectorAll('header,[role="banner"],.topbar,.top-bar,.dashboard-header')];
 return items.find(x=>!x.closest('aside,nav,[id^="page-"]'))||null;
}
function appendText(doc,root,text,tag='span',cls=''){
 const node=doc.createElement(tag);if(cls)node.className=cls;node.textContent=text;root.append(node);return node;
}
export function mountDashboardSearch({
 doc,expectedOwnerId,getOwnerId,listFiles,onOpenFile,onNavigate,stylesheetUrl
}){
 if(!doc||!expectedOwnerId||typeof getOwnerId!=='function'||typeof listFiles!=='function'
   ||typeof onOpenFile!=='function'||typeof onNavigate!=='function')return null;
 const header=findHeader(doc);
 if(!header||doc.getElementById('smaDashboardSearch'))return null;
 const host=header.querySelector('.topbar-actions')||header;
 const stylesheet=doc.createElement('link');stylesheet.rel='stylesheet';stylesheet.href=stylesheetUrl;
 doc.head.append(stylesheet);
 const entry=doc.createElement('div');entry.id='smaDashboardSearch';entry.className='sma-dashboard-search';
 const small=doc.createElement('input');small.type='search';small.id='smaDashboardSearchQuick';
 small.placeholder='Dateien oder Bereiche suchen …';small.setAttribute('aria-label','Im SMA-Dashboard suchen');
 small.setAttribute('aria-haspopup','dialog');small.setAttribute('aria-controls','smaDashboardSearchDialog');
 entry.append(small);
 const lang=host.querySelector('[data-sma-account-tab="language"],#languageSwitcher,[aria-label="Sprache"]');
 if(lang?.parentNode===host)host.insertBefore(entry,lang);else host.prepend(entry);
 const overlay=doc.createElement('div');overlay.id='smaDashboardSearchDialog';
 overlay.className='sma-search-overlay';overlay.hidden=true;
 const panel=doc.createElement('section');panel.className='sma-search-panel';
 panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
 panel.setAttribute('aria-labelledby','smaSearchHeading');
 const top=doc.createElement('div');top.className='sma-search-top';
 const heading=appendText(doc,top,'SMA durchsuchen','h2');heading.id='smaSearchHeading';
 const closeButton=doc.createElement('button');closeButton.type='button';
 closeButton.className='sma-search-close';closeButton.textContent='×';
 closeButton.setAttribute('aria-label','Suche schließen');top.append(closeButton);
 const input=doc.createElement('input');input.type='search';input.id='smaSearchQuery';
 input.placeholder='Dateiname oder Dashboard-Bereich eingeben';
 input.setAttribute('aria-label','Datei oder Bereich suchen');input.setAttribute('autocomplete','off');
 const status=doc.createElement('p');status.className='sma-search-status';status.setAttribute('role','status');
 status.setAttribute('aria-live','polite');
 const matches=doc.createElement('div');matches.className='sma-search-results';
 panel.append(top,input,status,matches);overlay.append(panel);doc.body.append(overlay);
 let destroyed=false,searchText='',files=[],loaded=false,loading=null,ticket=0,restoringFocus=false;
 const availablePages=PAGES.filter(x=>doc.getElementById('page-'+x.page)).map(x=>x.page);
 function redraw(){
  if(destroyed||overlay.hidden)return;
  matches.replaceChildren();
  const items=searchDashboard(searchText,{files,pages:availablePages});
  const areas=items.filter(x=>x.type==='area'),media=items.filter(x=>x.type==='file');
  if(!items.length){status.textContent=loaded?'Keine Treffer. Suche nach einem anderen Namen oder Bereich.':'Dateien werden geladen …';return;}
  status.textContent=loaded?media.length+' Datei(en) · '+areas.length+' Bereich(e) gefunden':'Bereiche verfügbar · Dateisuche wird geladen …';
  for(const group of [areas,media]){
   if(!group.length)continue;
   appendText(doc,matches,group===areas?'Dashboard-Bereiche':'Deine Dateien','h3','sma-search-group');
   for(const item of group){
    const button=doc.createElement('button');button.type='button';button.className='sma-search-hit';
    button.dataset.type=item.type;
    if(item.type==='area'){
     button.dataset.page=item.page;appendText(doc,button,item.label,'strong');
     appendText(doc,button,item.chapter==='files'?'Dateien im Dashboard öffnen':'Zum Bereich wechseln','small');
    }else{
     button.dataset.fileId=item.id;
     appendText(doc,button,item.label,'strong');
     const portal={youtube:'YouTube',tiktok:'TikTok',instagram:'Instagram',facebook:'Facebook'}[item.portal];
     appendText(doc,button,(item.media_kind==='video'?'Video':'Bild')+' · '+portal+' optimieren','small');
    }
    button.addEventListener('click',async()=>{
     if(destroyed||overlay.hidden)return;
     const current=await getOwnerId().catch(()=>null);
     if(destroyed||current!==expectedOwnerId){clearSensitive();return;}
     const ok=item.type==='area'?onNavigate(item.page,item.chapter||null)
       :onOpenFile(item.id,item.portal,small);
     if(ok===false){status.textContent='Dieser Bereich konnte nicht geöffnet werden. Bitte erneut versuchen.';return;}
     hide(false);
    });
    matches.append(button);
   }
  }
 }
 function clearSensitive(){ticket++;loaded=false;files=[];searchText='';small.value='';input.value='';hide(false);}
 async function fetchFiles(){
  if(destroyed||loaded)return;
  if(loading)return loading;
  const currentTicket=++ticket;
  loading=(async()=>{
   const active=await getOwnerId().catch(()=>null);
   if(active!==expectedOwnerId){clearSensitive();return;}
   try{
    const value=await listFiles();
    if(destroyed||currentTicket!==ticket)return;
    const stillActive=await getOwnerId().catch(()=>null);
    if(stillActive!==expectedOwnerId){clearSensitive();return;}
    if(!Array.isArray(value))throw Error('FILES_INVALID');
    files=value;loaded=true;redraw();
   }catch{
    if(!destroyed&&currentTicket===ticket){
     loaded=true;files=[];redraw();
     status.textContent='Dateisuche gerade nicht verfügbar. Dashboard-Bereiche bleiben erreichbar.';
    }
   }
  })().finally(()=>{loading=null;});
  return loading;
 }
 function show(){
  if(destroyed)return;
  overlay.hidden=false;input.value=searchText;small.value=searchText;
  redraw();input.focus();void fetchFiles();
 }
 function hide(focus=true){
  overlay.hidden=true;
  if(focus&&!destroyed){
   restoringFocus=true;
   try{small.focus();}finally{restoringFocus=false;}
  }
 }
 function change(value){searchText=String(value||'').slice(0,160);input.value=searchText;small.value=searchText;redraw();}
 const quickInput=()=>{change(small.value);show();};
 const mainInput=()=>change(input.value);
 const openInput=()=>{if(!restoringFocus)show();};
 const clickClose=()=>hide();
 const clickOverlay=e=>{if(e.target===overlay)hide();};
 const keydown=e=>{
  if((e.ctrlKey||e.metaKey)&&String(e.key).toLowerCase()==='k'){
   e.preventDefault();show();return;
  }
  if(!overlay.hidden&&e.key==='Escape'){e.preventDefault();hide();}
  if(!overlay.hidden&&e.key==='Enter'&&e.target===input){
   const first=matches.querySelector('button.sma-search-hit');
   if(first){e.preventDefault();first.click();}
  }
 };
 small.addEventListener('input',quickInput);
 small.addEventListener('focus',openInput);
 input.addEventListener('input',mainInput);
 closeButton.addEventListener('click',clickClose);
 overlay.addEventListener('click',clickOverlay);
 doc.addEventListener('keydown',keydown);
 return {entry,overlay,input,show,hide,search:change,refresh(){
  loaded=false;files=[];return fetchFiles();
 },destroy(){
  if(destroyed)return;destroyed=true;clearSensitive();
  small.removeEventListener('input',quickInput);small.removeEventListener('focus',openInput);
  input.removeEventListener('input',mainInput);closeButton.removeEventListener('click',clickClose);
  overlay.removeEventListener('click',clickOverlay);doc.removeEventListener('keydown',keydown);
  entry.remove();overlay.remove();stylesheet.remove();
 }};
}
