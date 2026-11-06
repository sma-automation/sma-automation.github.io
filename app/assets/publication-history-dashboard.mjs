import {readPublicationHistory,historyStatuses,historyPlatforms} from './publication-history-model.mjs?v=1';

export function mountPublicationHistory({doc,request,getOwnerId,expectedOwnerId,watchOwner,ownerWindow=doc.defaultView,stylesheetUrl}){
 const page=doc.getElementById('page-history'),slot=page?.querySelector('#historyActivitySlot');
 if(!slot||!expectedOwnerId)return {destroy(){}};
 const css=doc.createElement('link');css.rel='stylesheet';css.href=stylesheetUrl;doc.head.append(css);
 const create=(tag,text,className)=>{const el=doc.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;};
 const title=slot.parentElement.querySelector('.card-title'),intro=slot.parentElement.querySelector('p');
 function translated(el,de,en){if(el){el.textContent=de;el.setAttribute('data-de',de);el.setAttribute('data-en',en);}}
 translated(title,'Veröffentlichungsaufträge','Publication orders');
 translated(intro,'Deine Aufträge mit dem zuletzt gespeicherten Status. Aktualisieren lädt ausschließlich den Verlauf.','Your orders and their latest recorded status. Refresh only reads the history.');
 slot.classList.remove('empty-state');slot.classList.add('sma-publication-history');
 const toolbar=create('div',null,'sma-history-toolbar'),refresh=create('button','Verlauf aktualisieren'),message=create('p');
 refresh.type='button';message.setAttribute('role','status');message.setAttribute('aria-live','polite');
 const list=create('ol',null,'sma-history-list'),more=create('button','Weitere Aufträge laden');more.type='button';more.hidden=true;
 toolbar.append(refresh);slot.replaceChildren(toolbar,message,list,more);
 let entries=[],cursor=null,busy=false,disposed=false,invalidOwner=false,generation=0;
 const active=()=>!disposed&&!invalidOwner&&page.classList.contains('active')&&ownerWindow.document.visibilityState!=='hidden';
 function clear(text=''){generation++;busy=false;entries=[];cursor=null;list.replaceChildren();message.textContent=text;more.hidden=true;refresh.disabled=false;slot.setAttribute('aria-busy','false');}
 function invalidateOwner(){invalidOwner=true;clear('Bitte melde dich erneut an, um deinen Verlauf zu sehen.');refresh.disabled=true;}
 const current=g=>g===generation&&active();
 const format=value=>new Intl.DateTimeFormat('de-AT',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
 function render(){
  list.replaceChildren();
  for(const entry of entries){
   const row=create('li'),heading=create('div',null,'sma-history-heading');
   const name=create('strong',entry.title||'Beitrag'),status=create('span',historyStatuses[entry.status][0],'sma-history-status');
   status.dataset.status=entry.status;heading.append(name,status);
   const meta=create('p',[historyPlatforms[entry.platform],entry.target_name].filter(Boolean).join(' · '));
   const detail=create('p',historyStatuses[entry.status][1]);
   const dates=create('small','Erstellt: '+format(entry.created_at)+' · Stand: '+format(entry.updated_at));
   row.append(heading,meta,detail,dates);list.append(row);
  }
  message.textContent=entries.length?entries.length+' Aufträge geladen. Neueste zuerst.':'Noch keine Veröffentlichungsaufträge vorhanden.';
  more.hidden=!cursor;
 }
 async function load(append=false){
  if(!active()||busy||append&&!cursor)return;
  if(!append)clear();
  const g=generation,input=append?{...cursor}:{};
  busy=true;refresh.disabled=true;more.disabled=true;slot.setAttribute('aria-busy','true');message.textContent='Verlauf wird geladen …';
  try{
   const before=await getOwnerId();if(!current(g))return;if(before!==expectedOwnerId){invalidateOwner();return;}
   const response=await request(input);if(!current(g))return;
   const after=await getOwnerId();if(!current(g))return;if(after!==expectedOwnerId){invalidateOwner();return;}
   const result=readPublicationHistory(response);
   if(append&&result.entries.some(e=>entries.some(old=>old.id===e.id)))throw Error('INVALID_HISTORY');
   entries=append?[...entries,...result.entries]:result.entries;cursor=result.next;render();
  }catch{if(current(g))clear('Der Verlauf konnte nicht geladen werden. Bitte erneut aktualisieren.');}
  finally{if(g===generation&&!disposed){busy=false;refresh.disabled=invalidOwner;more.disabled=false;slot.setAttribute('aria-busy','false');}}
 }
 const onRefresh=()=>load(),onMore=()=>load(true);
 const onVisibility=()=>{if(active())load();else clear();};
 const onFocus=()=>{if(active())load();};
 refresh.addEventListener('click',onRefresh);more.addEventListener('click',onMore);
 const observer=new doc.defaultView.MutationObserver(onVisibility);observer.observe(page,{attributes:true,attributeFilter:['class']});
 ownerWindow.addEventListener('focus',onFocus);ownerWindow.document.addEventListener('visibilitychange',onVisibility);
 const subscription=watchOwner?.(id=>{if(id!==expectedOwnerId)invalidateOwner();});
 load();
 return {destroy(){disposed=true;clear();observer.disconnect();subscription?.unsubscribe();refresh.removeEventListener('click',onRefresh);more.removeEventListener('click',onMore);ownerWindow.removeEventListener('focus',onFocus);ownerWindow.document.removeEventListener('visibilitychange',onVisibility);slot.replaceChildren();css.remove();}};
}
