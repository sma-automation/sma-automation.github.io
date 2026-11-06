import {formatHistoryMonth} from './publication-history-model.mjs?v=3';
import {readPublicationAnalysisHistory,analysisStatuses,analysisErrors} from './publication-analysis-history-model.mjs?v=1';

// Lifecycle and selected month belong to the parent History view. This reader
// has independent pagination and never opens the editing or generation routes.
export function mountPublicationAnalysisHistory({doc,after,request,getOwnerId,expectedOwnerId,isActive,onOwnerLost}){
 const create=(tag,text,className)=>{const e=doc.createElement(tag);if(text)e.textContent=text;if(className)e.className=className;return e;};
 const card=create('div',null,'card'),heading=create('div','Analyseverlauf','card-title');card.id='historyAnalysisCard';
 const intro=create('p','Neue Magic-Effect-Analyseversuche ab Einrichtung dieses Verlaufs. Frühere Versuche wurden nicht nachträglich erfasst. Eine Analyse ist keine Sicherheitsprüfung oder Veröffentlichungsfreigabe.');intro.className='muted';
 const slot=create('div',null,'sma-publication-history'),toolbar=create('div',null,'sma-history-toolbar'),refresh=create('button','Analyseverlauf aktualisieren'),message=create('p'),list=create('ol',null,'sma-history-list'),nav=create('nav',null,'sma-history-pagination'),previous=create('button','‹ Zurück'),more=create('button','Weiter ›');
 refresh.type=previous.type=more.type='button';refresh.disabled=true;nav.hidden=true;previous.setAttribute('aria-label','Vorherige Analyseversuche');more.setAttribute('aria-label','Weitere Analyseversuche');nav.setAttribute('aria-label','Analyseverlaufsseiten');nav.append(previous,more);message.setAttribute('role','status');message.setAttribute('aria-live','polite');
 toolbar.append(refresh);slot.append(toolbar,message,list,nav);card.append(heading,intro,slot);after.after(card);
 const pageSize=5;let pageNumber=0,totalCount=0,entries=[],cursor=null,month,generation=0,busy=false,disposed=false;
 const current=g=>g===generation&&!disposed&&isActive();
 function reset(){generation++;entries=[];cursor=null;pageNumber=0;totalCount=0;busy=false;list.replaceChildren();nav.hidden=true;message.textContent='';refresh.disabled=month===undefined;slot.setAttribute('aria-busy','false');}
 const format=value=>new Intl.DateTimeFormat('de-AT',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Vienna'}).format(new Date(value));
 function render(total=totalCount){
  totalCount=total;
  list.replaceChildren();
  for(const e of entries.slice(pageNumber*pageSize,(pageNumber+1)*pageSize)){
   const row=create('li'),top=create('div',null,'sma-history-heading');
   top.append(create('strong',e.file_name||'Datei'),create('span',analysisStatuses[e.status][0],'sma-history-status'));
   const meta=create('small',(e.media_kind==='video'?'Video':'Bild')+' · '+format(e.started_at));
   const details=create('details'),summary=create('summary');summary.setAttribute('aria-label','Analyseversuch ansehen');summary.append(top,meta);details.append(summary);
   details.append(create('p',analysisStatuses[e.status][1]));
   if(e.finished_at)details.append(create('small','Abgeschlossen: '+format(e.finished_at)));
   if(e.error_code)details.append(create('p',analysisErrors[e.error_code]));
   details.append(create('p','Keine Sicherheitsprüfung oder Veröffentlichungsfreigabe.','muted'));
   row.append(details);list.append(row);
  }
  message.textContent=entries.length?(pageNumber*pageSize+1)+'–'+Math.min((pageNumber+1)*pageSize,entries.length)+' von '+total+' Analyseversuchen · Seite '+(pageNumber+1)+' von '+Math.ceil(total/pageSize)+' · '+formatHistoryMonth(month)+'.':'Keine erfassten Analyseversuche für '+formatHistoryMonth(month)+' vorhanden.';
  nav.hidden=!entries.length;previous.disabled=pageNumber===0;more.disabled=(pageNumber+1)*pageSize>=entries.length&&!cursor;
 }
 async function load(selected=month,append=false){
  if(disposed||!isActive()||selected===undefined||append&&(busy||!cursor))return;
  if(!append){month=selected;reset();}
  const g=generation,input={month,...(append?cursor:{})};busy=true;refresh.disabled=true;previous.disabled=true;more.disabled=true;slot.setAttribute('aria-busy','true');message.textContent='Analyseverlauf wird geladen …';
  try{
   if(await getOwnerId()!==expectedOwnerId){if(current(g))onOwnerLost();return;}if(!current(g))return;
   const response=await request(input);if(!current(g))return;
   if(await getOwnerId()!==expectedOwnerId){if(current(g))onOwnerLost();return;}if(!current(g))return;
   const result=readPublicationAnalysisHistory(response);
   if(result.month!==month||append&&result.entries.some(e=>entries.some(old=>old.id===e.id)))throw Error('INVALID_HISTORY');
   const combined=append?[...entries,...result.entries]:result.entries;if(combined.length>result.total)throw Error('INVALID_HISTORY');
   entries=combined;cursor=result.next;pageNumber=Math.min(pageNumber+(append?1:0),Math.max(0,Math.ceil(entries.length/pageSize)-1));render(result.total);
  }catch{if(current(g)){reset();message.textContent='Der Analyseverlauf konnte nicht geladen werden. Bitte erneut aktualisieren.';}}
  finally{if(current(g)){busy=false;refresh.disabled=false;previous.disabled=pageNumber===0;more.disabled=(pageNumber+1)*pageSize>=entries.length&&!cursor;slot.setAttribute('aria-busy','false');}}
 }
 refresh.addEventListener('click',()=>{if(!busy)load();});more.addEventListener('click',()=>{if(!isActive()||busy)return;if((pageNumber+1)*pageSize<entries.length){pageNumber++;render();}else if(cursor)load(month,true);});
 previous.addEventListener('click',()=>{if(isActive()&&!busy&&pageNumber>0){pageNumber--;render();}});
 return {load,clear(){month=undefined;reset();},destroy(){disposed=true;month=undefined;reset();card.remove();}};
}
