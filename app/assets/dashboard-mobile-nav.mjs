// Compact bottom navigation for the authenticated mobile SMA dashboard.
// All routes delegate to the EXISTING sidebar; this module owns no APIs,
// authorizations, file reads, uploads, provider calls or payment actions.
const choices=Object.freeze([
 {key:'overview',label:'Start',icon:'⌂'},
 {key:'files',label:'Dateien',icon:'▧'},
 {key:'history',label:'Aufträge',icon:'▤'},
 {key:'shop',label:'Shop',icon:'▦'},
 {key:'search',label:'Suche',icon:'⌕'}
]);
export function mountDashboardMobileNav({doc,available,onNavigate,onSearch}){
 if(!doc||typeof available!=='function'||typeof onNavigate!=='function'||
  typeof onSearch!=='function'||doc.getElementById('smaMobileQuickNav'))return null;
 // Keep native/mobile dashboard navigation as the single source if present.
 if(doc.querySelector('nav.mobile-nav,[data-mobile-navigation]'))return null;
 const items=choices.filter(x=>x.key==='search'?available('search'):available(x.key));
 if(!items.length)return null;
 const style=doc.createElement('style');style.id='smaMobileQuickNavCss';
 style.textContent=[
  '#smaMobileQuickNav{display:none}',
  '@media(max-width:700px){',
  'body.sma-mobile-quick-mounted{padding-bottom:calc(80px + env(safe-area-inset-bottom))!important}',
  '#smaMobileQuickNav{position:fixed;bottom:0;left:0;right:0;display:grid;grid-template-columns:repeat(var(--sma-nav-count),minmax(0,1fr));gap:1px;align-items:stretch;z-index:1050;min-height:65px;padding:5px 7px calc(5px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid #d7dfea;box-shadow:0 -8px 22px rgba(0,0,0,.06)}',
  '#smaMobileQuickNav button{display:flex;min-width:0;min-height:51px;flex-direction:column;align-items:center;justify-content:center;gap:3px;margin:0;padding:4px 3px;border:0;border-radius:7px;background:transparent;color:#596880;font:600 11px/1.25 Inter,Arial,sans-serif;cursor:pointer}',
  '#smaMobileQuickNav button:focus-visible{outline:2px solid #4065d8;outline-offset:-2px}',
  '#smaMobileQuickNav button:hover,#smaMobileQuickNav button[aria-current=page]{background:#edf2ff;color:#3157cd}',
  '#smaMobileQuickNav .sma-mobile-nav-icon{font:600 20px/1 Inter,Arial,sans-serif;color:inherit}',
  '}'
 ].join('\n');
 doc.head.append(style);
 const nav=doc.createElement('nav');nav.id='smaMobileQuickNav';nav.className='sma-mobile-quick-nav';
 nav.setAttribute('aria-label','SMA Schnellnavigation');
 nav.style.setProperty('--sma-nav-count',String(items.length));
 const cleanups=[];
 for(const item of items){
  const button=doc.createElement('button');button.type='button';
  button.dataset.smaMobileTarget=item.key;
  button.setAttribute('aria-label',item.label);
  const icon=doc.createElement('span');icon.className='sma-mobile-nav-icon';icon.setAttribute('aria-hidden','true');icon.textContent=item.icon;
  const caption=doc.createElement('span');caption.textContent=item.label;
  button.append(icon,caption);
  const click=()=>{
   let ok=false;
   try{ok=item.key==='search'?onSearch()===true:onNavigate(item.key)===true;}catch{return;}
   if(!ok)return;
   // Mark only the page the original dashboard actually shows.
   // A successful click handler is not proof of a completed page change.
   if(item.key!=='search')syncActive();
  };
  button.addEventListener('click',click);
  cleanups.push(()=>button.removeEventListener('click',click));
  nav.append(button);
 }
 doc.body.append(nav);doc.body.classList.add('sma-mobile-quick-mounted');
 // The active page is owned by the original dashboard, not by this quick bar.
 // Watch only existing page/chapters, and keep buttons correct after sidebar,
 // global search, browser history or account-dependent navigation.
 function syncActive(){
  const active=[...doc.querySelectorAll('[id^="page-"].active')].find(el=>el.id?.startsWith('page-'));
  const page=active?.id.slice(5);
  const filesTab=doc.getElementById('sma-publishing-tab-files');
  const current=page==='overview'?'overview':page==='history'?'history':page==='shop'?'shop':
   page==='publishing'&&!active.classList.contains('sma-optimizing')&&filesTab?.getAttribute('aria-selected')==='true'?'files':null;
  for(const button of nav.querySelectorAll('button[data-sma-mobile-target]')){
   if(button.dataset.smaMobileTarget===current)button.setAttribute('aria-current','page');
   else button.removeAttribute('aria-current');
  }
 }
 const Observer=doc.defaultView?.MutationObserver;
 const observer=typeof Observer==='function'?new Observer(syncActive):null;
 if(observer){
  for(const page of doc.querySelectorAll('[id^="page-"]'))
   observer.observe(page,{attributes:true,attributeFilter:['class','hidden']});
  const fileTab=doc.getElementById('sma-publishing-tab-files');
  if(fileTab)observer.observe(fileTab,{attributes:true,attributeFilter:['aria-selected']});
 }
 syncActive();
 return {nav,destroy(){
  observer?.disconnect();
  cleanups.forEach(fn=>fn());
  nav.remove();style.remove();
  doc.body.classList.remove('sma-mobile-quick-mounted');
 }};
}
