import {readPublicationTextHistory,textHistoryKey,historyPlatforms,formatHistoryMonth} from './publication-history-model.mjs?v=4';

// Lifecycle and selected month belong to the parent History view. This reader
// has independent pagination and never opens the editing or generation routes.
export function mountPublicationTextHistory({doc,after,request,getOwnerId,expectedOwnerId,isActive,onOwnerLost}){
 const create=(tag,text,className)=>{const e=doc.createElement(tag);if(text)e.textContent=text;if(className)e.className=className;return e;};
 const card=create('div',null,'card'),heading=create('div','Gespeicherte Portaltexte','card-title');card.id='historyTextCard';
 const intro=create('p','Deine gespeicherten Textstände je Portal und Entwurf. Der gewählte Monat richtet sich nach der Erfassung. Frühere, nicht gespeicherte Bearbeitungen sind nicht enthalten.');intro.className='muted';
 const slot=create('div',null,'sma-publication-history'),toolbar=create('div',null,'sma-history-toolbar'),refresh=create('button','Textverlauf aktualisieren'),message=create('p'),list=create('ol',null,'sma-history-list'),nav=create('nav',null,'sma-history-pagination'),previous=create('button','‹ Zurück'),more=create('button','Weiter ›');
 refresh.type=previous.type=more.type='button';refresh.disabled=true;nav.hidden=true;previous.setAttribute('aria-label','Vorherige Textstände');more.setAttribute('aria-label','Weitere Textstände');nav.setAttribute('aria-label','Textseiten');nav.append(previous,more);message.setAttribute('role','status');message.setAttribute('aria-live','polite');
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
   const title=e.body.replace(/\s+/g,' ').trim();top.append(create('strong',title.length>90?title.slice(0,90)+'…':title),create('span',historyPlatforms[e.platform],'sma-history-status'));
   const meta=create('small','Version '+e.revision+' · '+format(e.recorded_at));
   const details=create('details'),summary=create('summary'),body=create('p',e.body,'sma-history-saved-text'),reference=create('small','Entwurf: '+e.preview_id);
   const hashtags=create('p',e.hashtags===null?'Hashtags: Für diesen Textstand nicht erfasst.':e.hashtags.length?'Hashtags: '+e.hashtags.map(tag=>'#'+tag).join(' '):'Hashtags: Keine gespeichert.','sma-history-saved-text');
   summary.setAttribute('aria-label','Gespeicherten Text ansehen');summary.append(top,meta);details.append(summary,body,hashtags,reference);row.append(details);list.append(row);
  }
  message.textContent=entries.length?(pageNumber*pageSize+1)+'–'+Math.min((pageNumber+1)*pageSize,entries.length)+' von '+total+' Textständen · Seite '+(pageNumber+1)+' von '+Math.ceil(total/pageSize)+' · '+formatHistoryMonth(month)+'.':'Keine gespeicherten Textstände für '+formatHistoryMonth(month)+' vorhanden.';
  nav.hidden=!entries.length;previous.disabled=pageNumber===0;more.disabled=(pageNumber+1)*pageSize>=entries.length&&!cursor;
 }
 async function load(selected=month,append=false){
  if(disposed||!isActive()||selected===undefined||append&&(busy||!cursor))return;
  if(!append){month=selected;reset();}
  const g=generation,input={month,...(append?cursor:{})};busy=true;refresh.disabled=true;previous.disabled=true;more.disabled=true;slot.setAttribute('aria-busy','true');message.textContent='Textverlauf wird geladen …';
  try{
   if(await getOwnerId()!==expectedOwnerId){if(current(g))onOwnerLost();return;}if(!current(g))return;
   const response=await request(input);if(!current(g))return;
   if(await getOwnerId()!==expectedOwnerId){if(current(g))onOwnerLost();return;}if(!current(g))return;
   const result=readPublicationTextHistory(response);
   if(result.month!==month||append&&result.entries.some(e=>entries.some(old=>textHistoryKey(old)===textHistoryKey(e))))throw Error('INVALID_HISTORY');
   const combined=append?[...entries,...result.entries]:result.entries;if(combined.length>result.total)throw Error('INVALID_HISTORY');
   entries=combined;cursor=result.next;pageNumber=Math.min(pageNumber+(append?1:0),Math.max(0,Math.ceil(entries.length/pageSize)-1));render(result.total);
  }catch{if(current(g)){reset();message.textContent='Der Textverlauf konnte nicht geladen werden. Bitte erneut aktualisieren.';}}
  finally{if(current(g)){busy=false;refresh.disabled=false;previous.disabled=pageNumber===0;more.disabled=(pageNumber+1)*pageSize>=entries.length&&!cursor;slot.setAttribute('aria-busy','false');}}
 }
 refresh.addEventListener('click',()=>{if(!busy)load();});more.addEventListener('click',()=>{if(!isActive()||busy)return;if((pageNumber+1)*pageSize<entries.length){pageNumber++;render();}else if(cursor)load(month,true);});
 previous.addEventListener('click',()=>{if(isActive()&&!busy&&pageNumber>0){pageNumber--;render();}});
 return {load,clear(){month=undefined;reset();},destroy(){disposed=true;month=undefined;reset();card.remove();}};
}
