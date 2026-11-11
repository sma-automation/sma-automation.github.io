// Global one-entry upload route for the SMA dashboard. Presentation only:
// the existing authenticated publication optimizer owns all uploads, file
// assignments, preview edits, account checks, credits and publishing gates.
const portals=Object.freeze([
 {id:'youtube',name:'YouTube'},
 {id:'tiktok',name:'TikTok'},
 {id:'instagram',name:'Instagram'},
 {id:'facebook',name:'Facebook'}
]);

function globalHeader(doc){
 const candidates=[...doc.querySelectorAll('header,[role="banner"],.topbar,.top-bar,.dashboard-header')];
 return candidates.find(el=>!el.closest('[id^="page-"]')&&!el.closest('aside')&&!el.closest('nav'))||null;
}

function languageControl(header){
 const controls=[...header.querySelectorAll('select,button,[role="combobox"],[data-language]')];
 return controls.find(el=>{
  const hint=[el.id,el.className,el.getAttribute('name'),el.getAttribute('aria-label'),
   el.getAttribute('title'),el.getAttribute('data-language'),el.getAttribute('data-lang')].join(' ');
  const options=el.tagName==='SELECT'?[...el.options].map(x=>x.value+' '+x.textContent).join(' '):'';
  return /sprache|language|locale|lang[-_]?switch|translate|übersetz|deutsch|english/i.test(hint+' '+options)
   || /^(DE|EN|Deutsch|English|Sprache)$/i.test((el.textContent||'').trim());
 })||null;
}

function svgCloud(doc){
 const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','24');
 svg.setAttribute('height','24');svg.setAttribute('fill','none');
 svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.9');
 svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
 svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
 for(const path of [
  'M5.5 18.5A4.5 4.5 0 0 1 5 9.55 7.25 7.25 0 0 1 18.65 11 3.75 3.75 0 0 1 19 18.5',
  'M12 20V11.5','m8.5 15 3.5-3.5 3.5 3.5'
 ]){const p=doc.createElementNS(ns,'path');p.setAttribute('d',path);svg.append(p);}
 return svg;
}

// Find the real existing "Veröffentlichung" navigation item without
// changing the sidebar, its menu structure, its logo or any click handlers.
function publishingNavigationItem(doc){
 const nodes=[...doc.querySelectorAll(
  'aside a,aside button,aside [role="button"],.sidebar a,.sidebar button,.sidebar [role="button"],#sidebar a,#sidebar button,#sidebar [role="button"],nav a,nav button'
 )];
 const matches=nodes.filter(el=>{
  if(el.closest('header,[role="banner"],[id^="page-"],main'))return false;
  const text=(el.textContent||'').replace(/\s+/g,' ').trim().toLowerCase();
  const route=[el.dataset?.page,el.dataset?.target,el.getAttribute('href'),el.getAttribute('aria-label')].filter(Boolean).join(' ').toLowerCase();
  return text==='veröffentlichung'||text==='publishing'||route.includes('publishing');
 });
 const item=matches[0];
 if(!item)return null;
 // Move only the cloud button. Leave the native menu element in place.
 return item.closest('.sidebar-item,.nav-item,.menu-item,.sidebar-link,.nav-link,.menu-link')||item;
}

// Keep the four original header controls and their events. Give them the
// SAME flat, underlined tab appearance as "Portale / Dateien" (no pill buttons).
function styleAccountTabs(header){
 header.classList.add('sma-account-tabs-header');
 const candidates=[...header.querySelectorAll('button,a,select,[role="button"],[role="combobox"],span,strong,[data-user-name],[data-profile-name]')];
 const tabs=[];
 for(const category of ['profile','package','language','logout']){
  const match=candidates.find(el=>{
   if(el.closest('#smaDashboardCloudUpload')||tabs.some(t=>t.contains(el)))return false;
   const text=(el.textContent||'').replace(/\s+/g,' ').trim();
   const hint=[el.id,typeof el.className==='string'?el.className:'',el.getAttribute('aria-label'),
    el.getAttribute('title'),el.getAttribute('name'),el.getAttribute('data-language')].join(' ');
   if(category==='profile')return /profil|profile|benutzername|username|user-name|account-name|kundenname/i.test(hint)||
      /^Profil(?:name)?(?:\s*:.*)?$/i.test(text);
   if(category==='package')return /paket|tarif|subscription|plan/i.test(hint+' '+text);
   if(category==='language')return /sprache|language|locale|lang(?:uage)?[-_]?switch/i.test(hint)||
      /^(DE|EN|Deutsch|English)$/i.test(text)||el.tagName==='SELECT'&&/Deutsch|English|DE|EN/.test(text);
   return /abmelden|logout|sign\s*out/i.test(hint+' '+text);
  });
  if(match){match.classList.add('sma-dashboard-account-tab');match.dataset.smaAccountTab=category;tabs.push(match);}
 }
 return ()=>{for(const el of tabs){el.classList.remove('sma-dashboard-account-tab');delete el.dataset.smaAccountTab;}header.classList.remove('sma-account-tabs-header');};
}

// This is only a visual/position change. No upload endpoint is added.
export function mountDashboardCloudUpload({doc,onPortal,stylesheetUrl}){
 if(!doc||typeof onPortal!=='function')return null;
 const header=globalHeader(doc);
 if(!header||doc.getElementById('smaDashboardCloudUpload'))return null;
 const publishing=publishingNavigationItem(doc);
 if(!publishing)return null; // Never put the requested sidebar upload at the wrong location.
 const lang=languageControl(header);
 const restoreAccountTabs=styleAccountTabs(header);
 const docBody=doc.body;
 if(!docBody)return null;
 const link=doc.createElement('link');link.rel='stylesheet';link.href=stylesheetUrl;
 doc.head?.append(link);

 const button=doc.createElement('button');
 button.type='button';button.id='smaDashboardCloudUpload';
 button.className='sma-dashboard-cloud-upload';
 button.setAttribute('aria-haspopup','dialog');
 button.setAttribute('aria-controls','smaDashboardCloudDialog');
 button.setAttribute('aria-expanded','false');
 button.setAttribute('aria-label','Datei hochladen und Portal auswählen');
 button.title='Datei hochladen und Portal auswählen';
 button.append(svgCloud(doc));
 const buttonLabel=doc.createElement('span');buttonLabel.className='sma-cloud-upload-label';
 button.append(buttonLabel);
 // Exactly as requested: upload on the LEFT, immediately ABOVE Publishing.
 // The existing portal chooser and upload workflow are otherwise unchanged.
 button.classList.add('sma-cloud-sidebar-upload');
 publishing.before(button);
 const overlay=doc.createElement('div');overlay.id='smaDashboardCloudDialog';overlay.className='sma-dashboard-cloud-overlay';overlay.hidden=true;
 const panel=doc.createElement('section');panel.className='sma-dashboard-cloud-panel';panel.setAttribute('role','dialog');
 panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','smaCloudHeading');panel.setAttribute('aria-describedby','smaCloudInstructions');
 const top=doc.createElement('div');top.className='sma-cloud-panel-top';
 const heading=doc.createElement('h2');heading.id='smaCloudHeading';
 const closeButton=doc.createElement('button');closeButton.type='button';closeButton.className='sma-cloud-close';closeButton.setAttribute('aria-label','Schließen');closeButton.title='Schließen';closeButton.textContent='×';
 top.append(heading,closeButton);
 const explain=doc.createElement('p');explain.id='smaCloudInstructions';
 const grid=doc.createElement('div');grid.className='sma-cloud-portal-grid';
 const portalButtons=[];
 const labels={};
 for(const portal of portals){
  const item=doc.createElement('button');item.type='button';item.className='sma-cloud-portal';
  item.dataset.portal=portal.id;
  const mark=doc.createElement('span');mark.className='sma-cloud-portal-mark';
  mark.textContent=portal.name.slice(0,1);mark.setAttribute('aria-hidden','true');
  const name=doc.createElement('strong');name.textContent=portal.name;
  const hint=doc.createElement('small');item.append(mark,name,hint);
  labels[portal.id]=hint;grid.append(item);portalButtons.push(item);
 }
 const note=doc.createElement('p');note.className='sma-cloud-no-post';
 const status=doc.createElement('p');status.className='sma-cloud-error';status.setAttribute('role','status');status.hidden=true;
 panel.append(top,explain,grid,note,status);overlay.append(panel);docBody.append(overlay);

 let destroyed=false;
 const isEnglish=()=>/^en/i.test(doc.documentElement?.lang||'')||
    ['en','english'].includes(String(lang?.value||'').toLowerCase());
 function translate(){
  const en=isEnglish();
  buttonLabel.textContent=en?'Upload':'Upload';
  button.setAttribute('aria-label',en?'Upload media and choose a platform':'Datei hochladen und Portal auswählen');
  button.title=en?'Upload media and choose a platform':'Datei hochladen und Portal auswählen';
  heading.textContent=en?'Upload & optimize':'Hochladen & optimieren';
  explain.textContent=en?
    'Choose a platform. Then use File to upload or select a file and Content & goal to prepare its own post.':
    'Portal auswählen. Unter „Datei“ hochladen oder auswählen und unter „Inhalt und Ziel“ den eigenen Beitrag vorbereiten.';
  for(const portal of portals)labels[portal.id].textContent=en?'File · Content & goal':'Datei · Inhalt und Ziel';
  note.textContent=en?'Nothing will be published automatically. Open the cloud again for another platform.':
    'Es wird nichts automatisch veröffentlicht. Für ein weiteres Portal die Wolke erneut öffnen.';
  closeButton.setAttribute('aria-label',en?'Close':'Schließen');
  closeButton.title=en?'Close':'Schließen';
 }
 function hide({focus=true}={}){
  if(overlay.hidden)return;
  overlay.hidden=true;button.setAttribute('aria-expanded','false');status.hidden=true;status.textContent='';
  if(focus&&!destroyed)button.focus();
 }
 function show(){
  if(destroyed)return;
  translate();
  overlay.hidden=false;button.setAttribute('aria-expanded','true');status.hidden=true;status.textContent='';
  portalButtons[0].focus();
 }
 const clickButton=()=>overlay.hidden?show():hide();
 const clickClose=()=>hide();
 const clickOverlay=e=>{if(e.target===overlay)hide();};
 const keydown=e=>{
  if(overlay.hidden)return;
  if(e.key==='Escape'){e.preventDefault();hide();return;}
  if(e.key!=='Tab')return;
  const focusables=[closeButton,...portalButtons];
  const first=focusables[0],last=focusables[focusables.length-1];
  if(e.shiftKey&&doc.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&doc.activeElement===last){e.preventDefault();first.focus();}
 };
 button.addEventListener('click',clickButton);
 closeButton.addEventListener('click',clickClose);
 overlay.addEventListener('click',clickOverlay);
 doc.addEventListener('keydown',keydown);
 for(const item of portalButtons)item.addEventListener('click',()=>{
  if(destroyed)return;
  const result=onPortal(item.dataset.portal,button);
  if(result===false){status.textContent=isEnglish()?'Please open Publishing and retry.':'Veröffentlichung konnte nicht geöffnet werden. Bitte erneut versuchen.';status.hidden=false;return;}
  hide({focus:false});
 });
 translate();
 return {button,overlay,portalButtons,open:show,close:hide,destroy(){
  if(destroyed)return;destroyed=true;
  doc.removeEventListener('keydown',keydown);
  button.removeEventListener('click',clickButton);
  closeButton.removeEventListener('click',clickClose);
  overlay.removeEventListener('click',clickOverlay);
  restoreAccountTabs();overlay.remove();button.remove();link.remove();
 }};
}
