// Presentation only: move the existing elements, never copy forms or customer data.
export function createChapterTabs({doc,id,entries,initial=entries[0]?.key,list,onSelect}){
 const nav=list||doc.createElement('nav');
 const cleanups=[],saved=[];let selected=null,disposed=false;
 const remember=(el,names)=>{const attrs=names.map(name=>[name,el.getAttribute(name)]);saved.push(()=>{for(const [name,value] of attrs)value===null?el.removeAttribute(name):el.setAttribute(name,value);});};
 remember(nav,['class','role','aria-label']);nav.classList.add('sma-chapters');nav.setAttribute('role','tablist');
 nav.setAttribute('aria-label',nav.getAttribute('aria-label')||'Kapitel');
 for(const entry of entries){
  const button=entry.button||doc.createElement('button');entry.button=button;
  remember(button,['id','role','aria-controls','aria-selected','aria-pressed','tabindex','type']);
  button.type='button';button.id=id+'-tab-'+entry.key;button.setAttribute('role','tab');
  if(entry.label){button.textContent=entry.label;button.dataset.de=entry.label;button.dataset.en=entry.en||entry.label;}
  if(entry.panel){
   remember(entry.panel,['id','role','aria-labelledby','tabindex','hidden']);
   entry.panel.id=entry.panel.id||id+'-panel-'+entry.key;
   entry.panel.setAttribute('role','tabpanel');entry.panel.setAttribute('aria-labelledby',button.id);entry.panel.tabIndex=0;
   button.setAttribute('aria-controls',entry.panel.id);
  }
  const click=()=>select(entry.key);button.addEventListener('click',click);cleanups.push(()=>button.removeEventListener('click',click));
  if(button.parentNode!==nav)nav.append(button);
 }
 function select(key,{notify=true,focus=false}={}){
  if(disposed||!entries.some(entry=>entry.key===key))return false;
  selected=key;
  for(const entry of entries){const active=entry.key===key;entry.button.setAttribute('aria-selected',String(active));entry.button.setAttribute('aria-pressed',String(active));entry.button.tabIndex=active?0:-1;if(entry.panel)entry.panel.hidden=!active;}
  if(notify)onSelect?.(key);
  if(focus)entries.find(entry=>entry.key===key).button.focus();return true;
 }
 const keydown=event=>{
  const current=entries.findIndex(entry=>entry.button===event.target);if(current<0)return;
  let next;if(event.key==='ArrowRight')next=(current+1)%entries.length;else if(event.key==='ArrowLeft')next=(current+entries.length-1)%entries.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=entries.length-1;else return;
  event.preventDefault();select(entries[next].key,{focus:true});
 };
 nav.addEventListener('keydown',keydown);select(initial,{notify:false});
 return {nav,entries,select,get selected(){return selected;},destroy(){if(disposed)return;disposed=true;nav.removeEventListener('keydown',keydown);cleanups.forEach(fn=>fn());saved.reverse().forEach(fn=>fn());if(!list)nav.remove();}};
}

export function placeChapterBar(page,nav){
 const heading=page.querySelector(':scope > .page-head h1')||page.querySelector(':scope > h1');
 if(heading)heading.after(nav);else page.prepend(nav);
 page.setAttribute('data-sma-chapters','');
}

export function mountDashboardChapters({doc,stylesheetUrl,websiteView,onPreparePost}){
 const css=doc.createElement('link');css.rel='stylesheet';css.href=stylesheetUrl;doc.head.append(css);
 const cleanups=[],controllers=new Map();
 const children=(el,selector)=>el?[...el.children].filter(child=>child.matches(selector)):[];
 const page=id=>doc.getElementById('page-'+id);
 function moveGroup(target,nodes,restore){
  for(const node of nodes.filter(Boolean)){
   const anchor=doc.createComment('chapter position');node.before(anchor);target.append(node);
   restore.push(()=>{if(anchor.parentNode){anchor.replaceWith(node);}});
  }
 }
 function mount(name,groups,{shared,sharedIn=[]}={}){
  const root=page(name);if(!root||controllers.has(name))return null;
  groups=groups.map(group=>({...group,nodes:group.nodes.filter(Boolean)})).filter(group=>group.nodes.length||group.emptyPanel);
  if(groups.length<2)return null;
  const restore=[],panels=[];
  const entries=groups.map(group=>{
   const panel=doc.createElement('section');panel.className='sma-chapter-panel';panel.dataset.chapter=group.key;
   root.append(panel);panels.push(panel);
   const target=group.grid?doc.createElement('div'):panel;if(group.grid){target.className='grid';panel.append(target);}
   moveGroup(target,group.nodes,restore);return {...group,panel};
  });
  if(shared){const anchor=doc.createComment('shared chapter result');shared.before(anchor);restore.push(()=>anchor.parentNode&&anchor.replaceWith(shared));}
  const syncShared=key=>{if(shared){const entry=entries.find(e=>e.key===key);if(sharedIn.includes(key))entry.panel.append(shared);else entries.find(e=>sharedIn.includes(e.key))?.panel.append(shared);}};
  const tabs=createChapterTabs({doc,id:'sma-'+name,entries,onSelect:syncShared});placeChapterBar(root,tabs.nav);syncShared(tabs.selected);
  controllers.set(name,tabs);
  cleanups.push(()=>{tabs.destroy();restore.reverse().forEach(fn=>fn());panels.forEach(panel=>panel.remove());root.removeAttribute('data-sma-chapters');});
  return tabs;
 }
 const overview=children(page('overview')?.querySelector('.grid'),'.card');
 mount('overview',[
  {key:'work',label:'Arbeitsbereich',en:'Workspace',nodes:overview.slice(0,2),grid:true},
  {key:'account',label:'Konto & Paket',en:'Account & plan',nodes:overview.slice(2),grid:true}
 ]);
 const publishing=page('publishing'),heads=children(publishing,'.page-head');
 mount('publishing',[
  {key:'portals',label:'Portale',en:'Platforms',nodes:children(publishing,'.card')},
  {key:'files',label:'Dateien',en:'Files',nodes:[...heads.slice(1),doc.getElementById('publishingFilesSlot')]}
 ]);
 const workPanel=doc.getElementById('sma-overview-panel-work');
 if(workPanel&&controllers.has('publishing')&&typeof onPreparePost==='function'){
  const prepare=doc.createElement('button');
  prepare.type='button';
  prepare.className='sma-prepare-post';
  prepare.dataset.de='Beitrag vorbereiten';
  prepare.dataset.en='Prepare a post';
  prepare.textContent=/^en/i.test(doc.documentElement.lang)?prepare.dataset.en:prepare.dataset.de;
  prepare.addEventListener('click',onPreparePost);
  workPanel.prepend(prepare);
  cleanups.push(()=>{prepare.removeEventListener('click',onPreparePost);prepare.remove();});
 }
 const socialCards=[...page('social')?.querySelectorAll('.platform-card')||[]];
 mount('social',['YouTube','TikTok','Instagram','Facebook'].map(label=>({key:label.toLowerCase(),label,nodes:socialCards.filter(card=>card.querySelector('.platform-info strong')?.textContent.trim()===label)})));
 const content=page('content'),contentTools=children(content?.querySelector('.grid'),'.card');
 mount('content',[
  {key:'files',label:'Meine Dateien',en:'My files',nodes:children(content,'.card')},
  {key:'optimizer',label:'Content Optimizer',nodes:contentTools.slice(0,1)},
  {key:'magic',label:'Magic Effect',nodes:contentTools.slice(1)}
 ],{shared:doc.getElementById('contentOptimizerResult'),sharedIn:['optimizer','magic']});
 const music=page('music'),musicOptions=children(music?.querySelector('.grid'),'.card'),musicCards=children(music,'.card');
 mount('music',[
  {key:'tracks',label:'Tracks',nodes:[musicOptions[0],musicCards[0]]},
  {key:'playlist',label:'Meine Playlist',en:'My playlist',nodes:[musicOptions[1],musicCards[1],doc.getElementById('playlistResultSlot')]},
  {key:'catalog',label:'SMA-Musik',en:'SMA music',emptyPanel:true,nodes:[]}
 ]);
 const settings=page('settings'),settingGrids=children(settings,'.grid'),settingCards=children(settings,'.card');
 mount('settings',[
  {key:'account',label:'Kundenkonto',en:'Account',nodes:[settingGrids[0],settingCards[2]]},
  {key:'company',label:'Firmendaten',en:'Company details',nodes:[settings?.querySelector('.company-profile-overview')]},
  {key:'plan',label:'Paket & Credits',en:'Plan & credits',nodes:[settingGrids[1]]},
  {key:'connections',label:'Schnittstellen',en:'Connections',nodes:settingCards.slice(0,2)}
 ]);
 const tutorials=page('tutorials'),tutorialCards=children(tutorials?.querySelector('.grid'),'.card');
 mount('tutorials',[
  {key:'start',label:'Schnellstart',en:'Quick start',nodes:children(tutorials,'.card')},
  {key:'guides',label:'Anleitungen',en:'Guides',nodes:tutorialCards.slice(0,-1),grid:true},
  {key:'help',label:'Hilfe',en:'Help',nodes:tutorialCards.slice(-1)}
 ],{shared:doc.getElementById('tutorialContentSlot'),sharedIn:['guides','help']});
 const seller=page('seller');
 mount('seller',[
  {key:'chat',label:'Beratung',en:'Advice',nodes:children(seller,'div').filter(el=>!el.matches('.page-head,.package-module-status,.package-feature-list'))},
  {key:'products',label:'Produkte & Content',en:'Products & content',nodes:[seller?.querySelector('.package-feature-list')]}
 ]);
 const assistant=page('assistant');
 mount('assistant',[
  {key:'setup',label:'Einrichtung',en:'Setup',nodes:[assistant?.querySelector('.package-feature-list')]},
  {key:'assistant',label:'Assistenz',en:'Assistant',nodes:[assistant?.querySelector('.package-module-slot')]}
 ]);
 // The existing History controller owns its data and pagination.
 const history=page('history'),historyNav=history?.querySelector('.sma-history-switcher');
 if(historyNav){const anchor=doc.createComment('history tabs');historyNav.before(anchor);placeChapterBar(history,historyNav);cleanups.push(()=>{anchor.replaceWith(historyNav);history.removeAttribute('data-sma-chapters');});}
 const website=page('website');
 if(website&&websiteView?.openChapter){
  const entries=[['website','Webseite','Website'],['company','Firmendaten','Company details'],['shop','Shop-Button','Shop button'],['domain','Domain','Domain'],['connection','WordPress','WordPress']]
   .map(([key,label,en])=>({key,label,en,panel:website.querySelector('[data-website-view="'+key+'"]')})).filter(entry=>entry.panel);
  const tabs=createChapterTabs({doc,id:'sma-website',entries,onSelect:key=>websiteView.openChapter(key)});placeChapterBar(website,tabs.nav);controllers.set('website',tabs);
  const sync=event=>tabs.select(event.detail.view,{notify:false});website.addEventListener('sma:website-view-changed',sync);
  cleanups.push(()=>{website.removeEventListener('sma:website-view-changed',sync);tabs.destroy();website.removeAttribute('data-sma-chapters');});
 }
 // Keep the real Shop iframe and its existing controls, selection and listeners.
 const shop=page('shop'),shopFrame=doc.getElementById('smaShopFrame');
 if(shop&&shopFrame){
  const extras=children(shop,'.package-feature-list,#smaProductDetails'),savedExtras=extras.map(el=>[el,el.hidden]);
  const previousHeight=shopFrame.style.height;let observer,unbind=[];
  const tabs=createChapterTabs({doc,id:'sma-shop',entries:[{key:'products',label:'Produkte',en:'Products'},{key:'orders',label:'Bestellungen',en:'Orders'}],onSelect:key=>{
   for(const el of extras)el.hidden=key!=='products';
   try{shopFrame.contentDocument?.getElementById(key==='orders'?'showOrders':'showProducts')?.click();}catch{}
  }});for(const entry of tabs.entries)entry.button.setAttribute('aria-controls',shopFrame.id);placeChapterBar(shop,tabs.nav);controllers.set('shop',tabs);
  const attach=()=>{
   observer?.disconnect();unbind.forEach(fn=>fn());unbind=[];
   let child;try{child=shopFrame.contentDocument;}catch{return;}if(!child)return;
   const childNav=child.querySelector('.shop-sections');if(!childNav)return;
   const previousDisplay=childNav.style.display;childNav.style.display='none';unbind.push(()=>{childNav.style.display=previousDisplay;});
   const resize=()=>{const content=child.querySelector('#app .content');if(content&&!content.closest('.hidden')){const height=Math.ceil(content.getBoundingClientRect().height);if(height>0)shopFrame.style.height=Math.max(320,height+24)+'px';}};
   for(const [key,id] of [['products','showProducts'],['orders','showOrders']]){const button=child.getElementById(id);if(!button)continue;const sync=()=>{tabs.select(key,{notify:false});for(const el of extras)el.hidden=key!=='products';resize();};button.addEventListener('click',sync);unbind.push(()=>button.removeEventListener('click',sync));}
   if(doc.defaultView.ResizeObserver){observer=new doc.defaultView.ResizeObserver(resize);observer.observe(child.body);const content=child.querySelector('#app .content');if(content)observer.observe(content);}
   tabs.select(tabs.selected);resize();
  };
  shopFrame.addEventListener('load',attach);attach();
  cleanups.push(()=>{shopFrame.removeEventListener('load',attach);observer?.disconnect();unbind.forEach(fn=>fn());shopFrame.style.height=previousHeight;savedExtras.forEach(([el,hidden])=>el.hidden=hidden);tabs.destroy();shop.removeAttribute('data-sma-chapters');});
 }
 // Original layout containers remain in the DOM for existing code; empty ones take no space.
 return {controllers,destroy(){cleanups.reverse().forEach(fn=>fn());css.remove();}};
}
