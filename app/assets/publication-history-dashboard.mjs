import {mountPublicationAnalysisHistory} from './publication-analysis-history-dashboard.mjs?v=1';
import {mountPublicationEditorHistory} from './publication-editor-history-dashboard.mjs?v=2';
import {mountPublicationAssignmentHistory} from './publication-assignment-history-dashboard.mjs?v=1';
import {mountPublicationTextHistory} from './publication-text-history-dashboard.mjs?v=3';
import {historyStatuses,historyPlatforms,validHistoryMonth,formatHistoryMonth} from './publication-history-model.mjs?v=4';
import {readPublicationCoverHistory,historyCoverStatuses} from './publication-cover-history-model.mjs?v=3';
import {createChapterTabs} from './dashboard-chapters.mjs?v=1';

export function mountPublicationHistory({doc,request,requestTexts,requestAssignments,requestEditors,requestAnalyses,getOwnerId,expectedOwnerId,watchOwner,ownerWindow=doc.defaultView,stylesheetUrl}){
 const page=doc.getElementById('page-history'),slot=page?.querySelector('#historyActivitySlot');
 if(!slot||!expectedOwnerId)return {destroy(){}};
 const css=doc.createElement('link');css.rel='stylesheet';css.href=stylesheetUrl;doc.head.append(css);
 const create=(tag,text,className)=>{const el=doc.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;};
 const title=slot.parentElement.querySelector('.card-title'),intro=slot.parentElement.querySelector('p');
 function translated(el,de,en){if(el){el.textContent=de;el.setAttribute('data-de',de);el.setAttribute('data-en',en);}}
 translated(title,'Veröffentlichungsaufträge','Publication orders');
 translated(intro,'Deine Aufträge mit dem zuletzt gespeicherten Status. Monatszuordnung nach Erstellung; alle Zeiten in Wiener Zeit.','Your orders and their latest recorded status. Grouped by creation month; all times in Vienna time.');
 slot.classList.remove('empty-state');slot.classList.add('sma-publication-history');
 const toolbar=create('div',null,'sma-history-toolbar'),refresh=create('button','Verlauf aktualisieren'),message=create('p');
 refresh.type='button';message.setAttribute('role','status');message.setAttribute('aria-live','polite');
 const list=create('ol',null,'sma-history-list'),nav=create('nav',null,'sma-history-pagination'),previous=create('button','‹ Zurück'),more=create('button','Weiter ›');
 previous.type=more.type='button';previous.setAttribute('aria-label','Vorherige Aufträge');more.setAttribute('aria-label','Weitere Aufträge');nav.setAttribute('aria-label','Auftragsseiten');nav.hidden=true;nav.append(previous,more);
 toolbar.append(refresh);slot.replaceChildren(toolbar,message,list,nav);
 const cards=[...page.querySelectorAll('.grid > .card')].slice(0,3);
 const metrics=[['Aufträge','Orders','orders'],['Davon öffentlich bestätigt','Publicly confirmed','public_confirmed'],['Portale in den Aufträgen','Platforms in orders','platforms']];
 cards.forEach((card,i)=>{translated(card.querySelector('.card-title'),metrics[i][0],metrics[i][1]);card.querySelector('.big-value')?.setAttribute('data-history-metric',metrics[i][2]);});
 const monthSlot=page.querySelector('#historyMonthSlot');
 let picker,monthButtons,period,periodDisclosure,periodHeading;
 const chooseMonth=value=>{if(!active())return;selection=value;periodDisclosure?.removeAttribute('open');clear();load();};
 if(monthSlot){
  monthSlot.classList.add('sma-history-months');
  const archiveCard=monthSlot.closest('.card'),activityCard=slot.closest('.card');
  if(archiveCard?.parentElement===page&&activityCard?.parentElement===page)page.insertBefore(archiveCard,activityCard);
  if(archiveCard?.querySelector('p'))archiveCard.querySelector('p').hidden=true;
  if(archiveCard?.querySelector('.card-title'))archiveCard.querySelector('.card-title').hidden=true;
  periodDisclosure=create('details',null,'sma-history-period-picker');periodHeading=create('summary','Monat auswählen');archiveCard.append(periodDisclosure);periodDisclosure.append(periodHeading,monthSlot);
  const controls=create('div',null,'sma-history-month-controls'),label=create('label','Monat');
  picker=create('input');picker.type='month';picker.min='2000-01';picker.max='2099-12';picker.setAttribute('aria-label','Monat auswählen');label.append(picker);
  const apply=create('button','Monat anzeigen'),all=create('button','Alle Monate'),today=create('button','Aktueller Monat');
  for(const b of [apply,all,today])b.type='button';
  apply.addEventListener('click',()=>{if(validHistoryMonth(picker.value))chooseMonth(picker.value);else message.textContent='Bitte wähle einen gültigen Monat.';});
  all.addEventListener('click',()=>chooseMonth(null));today.addEventListener('click',()=>chooseMonth(undefined));
  monthButtons=create('div',null,'sma-history-month-links');period=create('p');period.setAttribute('data-history-period','');
  const archive=create('details'),archiveLabel=create('summary','Monate mit Aufträgen');archive.append(archiveLabel,monthButtons);
  controls.append(label,apply,today,all);monthSlot.replaceChildren(controls,period,archive);
 }
 const textHistory=requestTexts?mountPublicationTextHistory({doc,after:slot.closest('.card'),request:requestTexts,getOwnerId,expectedOwnerId,isActive:()=>active(),onOwnerLost:()=>invalidateOwner()}):null;
 const assignmentHistory=requestAssignments?mountPublicationAssignmentHistory({doc,after:page.querySelector('#historyTextCard')||slot.closest('.card'),request:requestAssignments,getOwnerId,expectedOwnerId,isActive:()=>active(),onOwnerLost:()=>invalidateOwner()}):null;
 const editorHistory=requestEditors?mountPublicationEditorHistory({doc,after:page.querySelector('#historyAssignmentCard')||page.querySelector('#historyTextCard')||slot.closest('.card'),request:requestEditors,getOwnerId,expectedOwnerId,isActive:()=>active(),onOwnerLost:()=>invalidateOwner()}):null;
 const analysisHistory=requestAnalyses?mountPublicationAnalysisHistory({doc,after:page.querySelector('#historyEditorCard')||page.querySelector('#historyAssignmentCard')||page.querySelector('#historyTextCard')||slot.closest('.card'),request:requestAnalyses,getOwnerId,expectedOwnerId,isActive:()=>active(),onOwnerLost:()=>invalidateOwner()}):null;
 const activityCard=slot.closest('.card'),textCard=page.querySelector('#historyTextCard'),assignmentCard=page.querySelector('#historyAssignmentCard'),editorCard=page.querySelector('#historyEditorCard'),analysisCard=page.querySelector('#historyAnalysisCard');
 const switcher=create('div',null,'sma-history-switcher');switcher.setAttribute('role','group');switcher.setAttribute('aria-label','History-Bereich');
 let chapterTabs;
 if(textCard||assignmentCard||editorCard||analysisCard){
  activityCard.id='historyOrderCard';
  chapterTabs=createChapterTabs({doc,id:'sma-history',list:switcher,entries:[
   {key:'orders',label:'Aufträge',en:'Orders',panel:activityCard},
   ...(textCard?[{key:'texts',label:'Portaltexte',en:'Platform texts',panel:textCard}]:[]),
   ...(assignmentCard?[{key:'assignments',label:'Dateiverlauf',en:'File history',panel:assignmentCard}]:[]),
   ...(editorCard?[{key:'edits',label:'Bearbeitungen',en:'Editing drafts',panel:editorCard}]:[]),
   ...(analysisCard?[{key:'analyses',label:'Analysen',en:'Analyses',panel:analysisCard}]:[])
  ]});page.insertBefore(switcher,activityCard);
 }
 const analyticsCard=page.querySelector('#historyAnalyticsSlot')?.closest('.card');
 let analyticsDisclosure;
 if(analyticsCard){analyticsDisclosure=create('details',null,'sma-history-analytics');const label=create('summary','Analytics · In Vorbereitung');analyticsCard.before(analyticsDisclosure);analyticsDisclosure.append(label,analyticsCard);}
 const pageSize=5;
 const expiryTimers=[];
 function clearExpiryTimers(){for(const timer of expiryTimers)clearTimeout(timer);expiryTimers.length=0;}
 let pageNumber=0,lastResult=null,entries=[],cursor=null,busy=false,disposed=false,invalidOwner=false,generation=0,selection,summary;
 const active=()=>!disposed&&!invalidOwner&&page.classList.contains('active')&&ownerWindow.document.visibilityState!=='hidden';
 function clear(text=''){
  clearExpiryTimers();
  textHistory?.clear();assignmentHistory?.clear();editorHistory?.clear();analysisHistory?.clear();
  generation++;busy=false;entries=[];cursor=null;summary=null;pageNumber=0;lastResult=null;list.replaceChildren();message.textContent=text;nav.hidden=true;refresh.disabled=false;slot.setAttribute('aria-busy','false');
  cards.forEach(card=>{const v=card.querySelector('.big-value');if(v)v.textContent='–';translated(card.querySelector('.muted'),'Wird mit dem Verlauf geladen','Loaded with the history');});
  monthButtons?.replaceChildren();if(period)period.textContent='';if(periodHeading)periodHeading.textContent='Monat auswählen';
 }
 function invalidateOwner(){invalidOwner=true;clear('Bitte melde dich erneut an, um deinen Verlauf zu sehen.');refresh.disabled=true;if(picker)picker.value='';for(const el of monthSlot?.querySelectorAll('button,input')||[])el.disabled=true;}
 const current=g=>g===generation&&active();
 const format=value=>new Intl.DateTimeFormat('de-AT',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Vienna'}).format(new Date(value));
 function render(result=lastResult){
  clearExpiryTimers();lastResult=result;
  const label=formatHistoryMonth(selection);
  const values=[summary.orders,summary.public_confirmed,summary.platforms.length];
  cards.forEach((card,i)=>{const v=card.querySelector('.big-value');if(v)v.textContent=String(values[i]);const detail=i===2?(summary.platforms.map(p=>historyPlatforms[p]).join(' · ')||'Noch keine Portale'):i===1?'Bestätigter Stand dieser Aufträge':label;translated(card.querySelector('.muted'),detail,detail);});
  if(picker)picker.value=selection||'';
  if(period)period.textContent=label+' · nach Erstellungsmonat · Wiener Zeit';
  if(periodHeading)periodHeading.textContent=label+' · Zeitraum ändern';
  if(monthButtons){monthButtons.replaceChildren();for(const m of result.months){const b=create('button',formatHistoryMonth(m.month)+' · '+m.orders);b.type='button';b.setAttribute('aria-pressed',String(selection===m.month));b.addEventListener('click',()=>chooseMonth(m.month));monthButtons.append(b);}}
  list.replaceChildren();
  for(const entry of entries.slice(pageNumber*pageSize,(pageNumber+1)*pageSize)){
   const row=create('li'),heading=create('div',null,'sma-history-heading');
   const name=create('strong',entry.title||'Beitrag'),status=create('span',historyStatuses[entry.status][0],'sma-history-status');
   status.dataset.status=entry.status;heading.append(name,status);
   const meta=create('small',historyPlatforms[entry.platform]+' · '+format(entry.created_at));
   const cover=create('span','Cover: '+historyCoverStatuses[entry.cover.status][0],'sma-history-cover-status');
   cover.dataset.coverStatus=entry.cover.status;meta.append(cover);
   const details=create('details'),toggle=create('summary');toggle.append(heading,meta);
   const detail=create('p',historyStatuses[entry.status][1]);
   let previewLink;
   const window=entry.approval_window||entry.preparation_window;
   if(window){
    previewLink=create('a','Beitragsvorschau öffnen','sma-history-preview-link');
    const previewUrl='/app/publication-preview.html?wide=1&portal='+encodeURIComponent(entry.platform)+'&order='+encodeURIComponent(entry.id);
    previewLink.href=previewUrl;previewLink.target='_top';
    const expire=()=>{
     status.textContent='Vorbereitung abgelaufen';
     detail.textContent='In der Beitragsvorschau kannst du die Vorbereitung neu starten.';
     previewLink.href=previewUrl;previewLink.textContent='Beitragsvorschau öffnen';
    };
    const remaining=Date.parse(window.expires_at)-Date.now();
    if(window.status==='recheck'){status.textContent='Kontoprüfung erforderlich';detail.textContent='Prüfe das Zielkonto in der Beitragsvorschau erneut.';}
    else if(window.status==='expired'||remaining<=0)expire();
    else{
     detail.textContent=entry.status==='preparing'
       ? 'Das Zielkonto ist noch offen. Du kannst diese Vorbereitung bis '+format(window.expires_at)+' Uhr (Wien) fortsetzen.'
       : 'Vorbereitung gültig bis '+format(window.expires_at)+' Uhr (Wien).';
     previewLink.href=previewUrl+'&resume=1';previewLink.textContent='Vorbereitung fortsetzen';
     expiryTimers.push(setTimeout(expire,remaining+1));
    }
   }
   const dates=create('small','Erstellt: '+format(entry.created_at)+' · Stand: '+format(entry.updated_at));
   const coverDetail=create('p',historyCoverStatuses[entry.cover.status][1],'sma-history-cover-detail');
   details.append(toggle,create('p',entry.target_name||'Zielkonto nicht gespeichert'),detail,dates,coverDetail);
   if(entry.cover.updated_at)details.append(create('small','Cover-Stand: '+format(entry.cover.updated_at)));
   if(previewLink)details.append(previewLink);
   row.append(details);list.append(row);
  }
  message.textContent=entries.length?(pageNumber*pageSize+1)+'–'+Math.min((pageNumber+1)*pageSize,entries.length)+' von '+summary.orders+' Aufträgen · Seite '+(pageNumber+1)+' von '+Math.ceil(summary.orders/pageSize)+'.':'Keine Veröffentlichungsaufträge für '+label+' vorhanden.';
  nav.hidden=!entries.length;previous.disabled=pageNumber===0;more.disabled=(pageNumber+1)*pageSize>=entries.length&&!cursor;
 }
 async function load(append=false){
  if(!active()||busy||append&&!cursor)return;
  if(!append)clear();
  const g=generation,input={...(selection!==undefined?{month:selection}:{}),...(append?cursor:{})};
  busy=true;refresh.disabled=true;previous.disabled=true;more.disabled=true;slot.setAttribute('aria-busy','true');message.textContent='Verlauf wird geladen …';
  try{
   const before=await getOwnerId();if(!current(g))return;if(before!==expectedOwnerId){invalidateOwner();return;}
   const response=await request(input);if(!current(g))return;
   const after=await getOwnerId();if(!current(g))return;if(after!==expectedOwnerId){invalidateOwner();return;}
   const result=readPublicationCoverHistory(response);
   if(selection!==undefined&&result.month!==selection)throw Error('INVALID_HISTORY');
   if(append&&result.entries.some(e=>entries.some(old=>old.id===e.id)))throw Error('INVALID_HISTORY');
   const combined=append?[...entries,...result.entries]:result.entries;if(combined.length>result.summary.orders)throw Error('INVALID_HISTORY');
   entries=combined;cursor=result.next;pageNumber=Math.min(pageNumber+(append?1:0),Math.max(0,Math.ceil(entries.length/pageSize)-1));selection=result.month;summary=result.summary;render(result);if(!append){textHistory?.load(result.month);assignmentHistory?.load(result.month);editorHistory?.load(result.month);analysisHistory?.load(result.month);}
  }catch{if(current(g))clear('Der Verlauf konnte nicht geladen werden. Bitte erneut aktualisieren.');}
  finally{if(g===generation&&!disposed){busy=false;refresh.disabled=invalidOwner;previous.disabled=pageNumber===0;more.disabled=(pageNumber+1)*pageSize>=entries.length&&!cursor;slot.setAttribute('aria-busy','false');}}
 }
 const onRefresh=()=>load(),onMore=()=>{if(!active()||busy)return;if((pageNumber+1)*pageSize<entries.length){pageNumber++;render();}else if(cursor)load(true);};
 const onPrevious=()=>{if(active()&&!busy&&pageNumber>0){pageNumber--;render();}};previous.addEventListener('click',onPrevious);
 const onVisibility=()=>{if(active())load();else clear();};
 const onFocus=()=>{if(active())load();};
 refresh.addEventListener('click',onRefresh);more.addEventListener('click',onMore);
 const observer=new doc.defaultView.MutationObserver(onVisibility);observer.observe(page,{attributes:true,attributeFilter:['class']});
 ownerWindow.addEventListener('focus',onFocus);ownerWindow.document.addEventListener('visibilitychange',onVisibility);
 const subscription=watchOwner?.(id=>{if(id!==expectedOwnerId)invalidateOwner();});
 load();
 return {destroy(){disposed=true;clear();observer.disconnect();subscription?.unsubscribe();refresh.removeEventListener('click',onRefresh);more.removeEventListener('click',onMore);ownerWindow.removeEventListener('focus',onFocus);ownerWindow.document.removeEventListener('visibilitychange',onVisibility);slot.replaceChildren();monthSlot?.replaceChildren();chapterTabs?.destroy();textHistory?.destroy();assignmentHistory?.destroy();editorHistory?.destroy();analysisHistory?.destroy();switcher.remove();activityCard.hidden=false;previous.removeEventListener('click',onPrevious);if(analyticsDisclosure){analyticsDisclosure.before(analyticsCard);analyticsDisclosure.remove();}css.remove();}};
}
