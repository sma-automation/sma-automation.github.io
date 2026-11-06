import {readPublicationTextHistory,textHistoryKey,historyPlatforms,formatHistoryMonth} from './publication-history-model.mjs?v=3';

// Lifecycle and selected month belong to the parent History view. This reader
// has independent pagination and never opens the editing or generation routes.
export function mountPublicationTextHistory({doc,after,request,getOwnerId,expectedOwnerId,isActive,onOwnerLost}){
 const create=(tag,text,className)=>{const e=doc.createElement(tag);if(text)e.textContent=text;if(className)e.className=className;return e;};
 const card=create('div',null,'card'),heading=create('div','Gespeicherte Portaltexte','card-title');card.id='historyTextCard';
 const intro=create('p','Deine gespeicherten Textstände je Portal und Entwurf. Der gewählte Monat richtet sich nach der Erfassung. Frühere, nicht gespeicherte Bearbeitungen sind nicht enthalten.');intro.className='muted';
 const slot=create('div',null,'sma-publication-history'),toolbar=create('div',null,'sma-history-toolbar'),refresh=create('button','Textverlauf aktualisieren'),message=create('p'),list=create('ol',null,'sma-history-list'),more=create('button','Weitere Textstände laden');
 refresh.type=more.type='button';refresh.disabled=true;more.hidden=true;message.setAttribute('role','status');message.setAttribute('aria-live','polite');
 toolbar.append(refresh);slot.append(toolbar,message,list,more);card.append(heading,intro,slot);after.after(card);
 let entries=[],cursor=null,month,generation=0,busy=false,disposed=false;
 const current=g=>g===generation&&!disposed&&isActive();
 function reset(){generation++;entries=[];cursor=null;busy=false;list.replaceChildren();more.hidden=true;message.textContent='';refresh.disabled=month===undefined;slot.setAttribute('aria-busy','false');}
 const format=value=>new Intl.DateTimeFormat('de-AT',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Vienna'}).format(new Date(value));
 function render(total){
  list.replaceChildren();
  for(const e of entries){
   const row=create('li'),top=create('div',null,'sma-history-heading');
   const title=e.body.replace(/\s+/g,' ').trim();top.append(create('strong',title.length>90?title.slice(0,90)+'…':title),create('span',historyPlatforms[e.platform],'sma-history-status'));
   const meta=create('p','Version '+e.revision+' · Erfasst: '+format(e.recorded_at));
   const details=create('details'),summary=create('summary','Gespeicherten Text ansehen'),body=create('p',e.body,'sma-history-saved-text'),reference=create('small','Entwurf: '+e.preview_id);
   details.append(summary,body,reference);row.append(top,meta,details);list.append(row);
  }
  message.textContent=entries.length?entries.length+' von '+total+' Textständen geladen · '+formatHistoryMonth(month)+'. Neueste zuerst.':'Keine gespeicherten Textstände für '+formatHistoryMonth(month)+' vorhanden.';
  more.hidden=!cursor;
 }
 async function load(selected=month,append=false){
  if(disposed||!isActive()||selected===undefined||append&&(busy||!cursor))return;
  if(!append){month=selected;reset();}
  const g=generation,input={month,...(append?cursor:{})};busy=true;refresh.disabled=true;more.disabled=true;slot.setAttribute('aria-busy','true');message.textContent='Textverlauf wird geladen …';
  try{
   if(await getOwnerId()!==expectedOwnerId){if(current(g))onOwnerLost();return;}if(!current(g))return;
   const response=await request(input);if(!current(g))return;
   if(await getOwnerId()!==expectedOwnerId){if(current(g))onOwnerLost();return;}if(!current(g))return;
   const result=readPublicationTextHistory(response);
   if(result.month!==month||append&&result.entries.some(e=>entries.some(old=>textHistoryKey(old)===textHistoryKey(e))))throw Error('INVALID_HISTORY');
   const combined=append?[...entries,...result.entries]:result.entries;if(combined.length>result.total)throw Error('INVALID_HISTORY');
   entries=combined;cursor=result.next;render(result.total);
  }catch{if(current(g)){reset();message.textContent='Der Textverlauf konnte nicht geladen werden. Bitte erneut aktualisieren.';}}
  finally{if(current(g)){busy=false;refresh.disabled=false;more.disabled=false;slot.setAttribute('aria-busy','false');}}
 }
 refresh.addEventListener('click',()=>{if(!busy)load();});more.addEventListener('click',()=>load(month,true));
 return {load,clear(){month=undefined;reset();},destroy(){disposed=true;month=undefined;reset();card.remove();}};
}
