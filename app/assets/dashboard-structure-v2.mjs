// SMA Dashboard V2: rearrange existing authenticated navigation nodes only.
// Never replace the original SMA honeycomb logo, account controls or publish APIs.
const MENU=[
 {section:'Start',items:[['overview','Übersicht']]},
 {section:'Erstellen',items:[['publishing','Veröffentlichung'],['content','Content'],['music','Musikbibliothek']]},
 {section:'Verkaufen',items:[['shop','Shop'],['seller','24/7 Verkäufer'],['website','Webseite & Domain']]},
 {section:'Verwalten',items:[['social','Social Media'],['history','History'],['assistant','Kundenassistent'],['settings','Einstellungen'],['tutorials','Tutorials']]}
];
const labels=MENU.flatMap(group=>group.items);
const compact=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
function menuId(el){
 const s=compact(el.textContent);
 if(!s)return null;
 // Check longer labels first so "Social Media" never matches an "SMA" badge.
 for(const [id,name] of [...labels].sort((a,b)=>b[1].length-a[1].length)){
  const target=compact(name);
  if(s===target||s.endsWith(' '+target)||s.startsWith(target+' ')||s.endsWith(target))return id;
 }
 return null;
}
function sideNavigation(doc){
 const containers=[...doc.querySelectorAll('aside nav, .sidebar nav, #sidebar nav, aside, .sidebar, #sidebar, nav')];
 let best=null,score=0;
 for(const candidate of containers){
  const found=new Set([...candidate.querySelectorAll('a,button,[role="button"]')].map(menuId).filter(Boolean));
  if(found.size>score){best=candidate;score=found.size;}
 }
 return score>=5?best:null;
}
function discoverItems(root){
 const entries=new Map();
 for(const el of root.querySelectorAll('a,button,[role="button"]')){
  const id=menuId(el);if(id&&!entries.has(id))entries.set(id,el);
 }
 return entries;
}
function topHeader(doc){
 for(const header of doc.querySelectorAll('.topbar,.top-bar,.dashboard-header,header,[role="banner"]')){
  if(header.closest('aside')||header.closest('[id^="page-"]'))continue;
  return header;
 }
 return null;
}
function accountTabs(header){
 if(!header)return [];
 header.classList.add('sma-v2-topbar');
 const controls=[...header.querySelectorAll('button,a,select,[role="button"],[role="combobox"]')];
 const kept=[];
 for(const el of controls){
  if(el.id==='smaDashboardCloudUpload')continue;
  const hint=compact([el.textContent,el.getAttribute('aria-label'),el.id,el.className].join(' '));
  if(/abmelden|logout|profil|profile|konto|account|paket|tarif|plan|sprache|language|deutsch|english|\bde\b|\ben\b/.test(hint)){
   el.classList.add('sma-v2-account-tab');kept.push(el);
  }
 }
 return kept;
}
export function mountDashboardStructureV2({doc,cloudButton,stylesheetUrl}){
 if(!doc||doc.documentElement?.dataset.smaStructureV2==='1')return null;
 doc.documentElement.dataset.smaStructureV2='1';
 const stylesheet=doc.createElement('link');stylesheet.rel='stylesheet';stylesheet.href=stylesheetUrl;
 doc.head.append(stylesheet);
 const originals=[],sectionLabels=[],restores=[];
 const nav=sideNavigation(doc),items=nav?discoverItems(nav):new Map();
 // Only reorder when the original clickable menu links are siblings. This
 // preserves the existing delegated navigation and all bound click handlers.
 const nodes=[...items.values()];
 const parents=new Set(nodes.map(n=>n.parentElement));
 if(nodes.length>=7&&parents.size===1){
  const parent=nodes[0].parentElement;
  const pin=doc.createComment('sma-v2-navigation-anchor');
  parent.insertBefore(pin,nodes[0]);
  const markers=new Map();
  for(const node of nodes){
   const marker=doc.createComment('sma-v2-restore');
   node.before(marker);markers.set(node,marker);
  }
  for(const group of MENU){
   const groupItems=group.items.map(([id])=>items.get(id)).filter(Boolean);
   if(!groupItems.length)continue;
   const section=doc.createElement('div');section.className='sma-v2-sidebar-section';
   section.textContent=group.section;parent.insertBefore(section,pin);sectionLabels.push(section);
   for(const item of groupItems)parent.insertBefore(item,pin);
  }
  pin.remove();
  restores.push(()=>{
   for(const [node,marker] of markers){if(marker.parentNode)marker.replaceWith(node);}
   sectionLabels.forEach(label=>label.remove());
  });
 }else if(items.size){
  // Unrecognized nested navigation: leave the links in their native places.
  // Do not break routing merely to force a cosmetic reordering.
  const first=items.get('overview')||nodes[0];
  if(first){
   const section=doc.createElement('div');section.textContent='Start';section.className='sma-v2-sidebar-section';
   first.before(section);sectionLabels.push(section);
  }
  restores.push(()=>sectionLabels.forEach(label=>label.remove()));
 }
 if(nav)nav.classList.add('sma-v2-navigation');
 const publishing=items.get('publishing');
 if(publishing&&cloudButton){
  const marker=doc.createComment('sma-v2-cloud-original');
  cloudButton.before(marker);
  publishing.before(cloudButton);
  cloudButton.classList.add('sma-v2-cloud-side');
  originals.push(()=>{cloudButton.classList.remove('sma-v2-cloud-side');if(marker.parentNode)marker.replaceWith(cloudButton);});
 }
 const header=topHeader(doc);
 const accounts=accountTabs(header);
 // Styles only: keep the live SMA logo and current account controls intact.
 return {menu:items,header,cloudButton,destroy(){
  for(const restore of originals.reverse())restore();
  for(const restore of restores.reverse())restore();
  for(const node of accounts)node.classList.remove('sma-v2-account-tab');
  if(header)header.classList.remove('sma-v2-topbar');
  if(nav)nav.classList.remove('sma-v2-navigation');
  stylesheet.remove();delete doc.documentElement.dataset.smaStructureV2;
 }};
}
