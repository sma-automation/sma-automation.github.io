// The session shell owns OAuth clicks, signed links, status reads and translated labels.
// Keep its social list intact when displaying it in the publishing chapter.
export function mountPortalConnections(doc,publishing,social){
 const original=publishing?.querySelector('.platform-list'),list=social?.querySelector('.platform-list');
 if(!original||!list)return null;
 const name=card=>card.querySelector('.platform-info strong')?.textContent.trim();
 const cards=parent=>[...parent.children].filter(child=>child.matches('.platform-card'));
 const optimizers=new Map(cards(original).map(card=>[name(card),card.querySelector('.sma-optimize')]));
 const rows=cards(list);
 if(!rows.length||rows.length!==optimizers.size||new Set(rows.map(name)).size!==rows.length||
    !rows.every(row=>optimizers.get(name(row))&&row.querySelector('.platform-action :is(a,button)')))return null;

 const previous=doc.createComment('social page position');
 const nav=[...doc.querySelectorAll('[data-page="social"]')].map(el=>[el,el.hidden]);
 const wasPage=social.classList.contains('page'),wasHidden=original.hidden;
 if(social.classList.contains('active'))doc.querySelector('[data-page="publishing"]')?.click();
 social.before(previous);
 social.classList.remove('page');social.classList.add('sma-portal-connections');
 // The native refresh updates both lists by selector, in this order in the document.
 original.after(social);original.hidden=true;
 for(const [el] of nav)el.hidden=true;

 function locationOf(control){
  const manual=control?.closest?.('.sma-manual-post');
  if(manual&&list.contains(manual))return {kind:'portal-action',portal:manual.dataset.portal,action:'manual'};
  const icon=control?.closest?.('.sma-optimize');
  if(icon&&list.contains(icon))return {kind:'portal-action',portal:icon.dataset.portal,action:'optimize'};
  const group=control?.closest?.('.sma-portal-actions');
  if(!group||!list.contains(group))return null;
  const portal=group.closest('.platform-card')?.querySelector('.sma-optimize')?.dataset.portal;
  const action=control.closest('a[href],button:not(:disabled)')?'connect':null;
  return portal&&action?{kind:'portal-action',portal,action}:null;
 }
 function visible(){
  return publishing.classList.contains('active')&&!publishing.classList.contains('sma-optimizing')&&
   !list.closest('[hidden]')&&doc.getElementById('smaQuickFindDialog')?.hidden!==false;
 }
 function restore(view){
  if(!view||!visible())return false;
  const optimize=[...optimizers.values()].find(el=>el.dataset.portal===view.portal);
  if(!optimize||!list.contains(optimize))return false;
  const control=view.action==='manual'?optimize.closest('.platform-card').querySelector('.sma-manual-post'):view.action==='connect'?optimize.closest('.platform-card').querySelector('.platform-action :is(a[href],button:not(:disabled))'):null;
  (control||optimize).focus();return true;
 }
 let lastFocus=null;
 const remember=event=>{const view=locationOf(event.target);lastFocus=view?{control:event.target,view}:null;};
 doc.addEventListener('focusin',remember);
 function reconcile(){
  const liveRows=cards(list),byName=new Map(liveRows.map(row=>[name(row),row]));
  const ordered=[...optimizers.keys()].map(key=>byName.get(key)).filter(Boolean);
  for(const row of ordered){
   const actions=row.querySelector('.platform-action');
   if(!actions)continue;
   const optimize=optimizers.get(name(row));
   if(!row.contains(optimize)){
    const icon=row.querySelector('.platform-icon');
    if(!icon)continue;
    if(original.contains(optimize))optimize.replaceWith(optimize.firstElementChild.cloneNode(true));
    const slot=icon.closest('.sma-optimize')||icon;
    slot.replaceWith(optimize);optimize.replaceChildren(icon);
   }
   if(actions.closest('.sma-portal-actions'))continue;
   const group=doc.createElement('div'),pair=doc.createElement('div');
   group.className='sma-portal-actions';
   pair.className='sma-publish-buttons';
   const manual=doc.createElement('a');
   manual.className='sma-manual-post button';manual.dataset.portal=optimize.dataset.portal;manual.target='_top';
   manual.href=new URL('../sofort-posten.html?portal='+encodeURIComponent(optimize.dataset.portal),import.meta.url).href;
   manual.textContent=['youtube','tiktok'].includes(optimize.dataset.portal)?'Sofort posten':'Drive-Ordner öffnen';
   // OAuth uses delegated clicks inside .platform-action. Keep its own container.
   actions.before(group);pair.append(manual);group.append(pair,actions);
  }
  // The connection list and the publishing list can arrive in different orders.
  ordered.forEach((row,index)=>{if(list.children[index]!==row)list.insertBefore(row,list.children[index]||null);});
 }
 reconcile();
 const Observer=doc.defaultView?.MutationObserver;
 const observer=Observer?new Observer(()=>{
  const resume=lastFocus&&(doc.activeElement===doc.body||!doc.activeElement)&&!list.contains(lastFocus.control)?lastFocus.view:null;
  reconcile();
  if(resume)restore(resume);
 }):null;
 observer?.observe(list,{childList:true});
 return {restore,snapshot:()=>visible()?locationOf(doc.activeElement):null,destroy(){
  observer?.disconnect();doc.removeEventListener('focusin',remember);
  const liveOriginal=new Map(cards(original).map(row=>[name(row),row]));
  for(const [key,button] of optimizers){
   const target=liveOriginal.get(key);
   const icon=button.querySelector('.platform-icon');
   if(icon)button.replaceWith(icon);
   const homeIcon=target?.querySelector('.platform-icon');
   if(homeIcon){homeIcon.replaceWith(button);button.replaceChildren(homeIcon);}else button.remove();
  }
  for(const group of list.querySelectorAll('.sma-portal-actions')){
   const native=group.querySelector('.platform-action');
   if(native)group.replaceWith(native);else group.remove();
  }
  // Restore the initial row order when the session still owns the same nodes.
  for(const row of rows)if(row.parentNode===list)list.append(row);
  if(wasPage)social.classList.add('page');
  social.classList.remove('sma-portal-connections');
  previous.replaceWith(social);original.hidden=wasHidden;
  for(const [el,hidden] of nav)el.hidden=hidden;
 }};
}
