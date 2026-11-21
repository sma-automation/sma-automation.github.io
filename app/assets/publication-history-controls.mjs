import {validHistoryMonth} from './publication-history-model.mjs?v=5';

const language=doc=>doc.documentElement.lang==='en'?'en':'de-AT';

function label(element,de,en){
 element.dataset.de=de;element.dataset.en=en;
 element.textContent=language(element.ownerDocument)==='en'?en:de;
}

export function historyRefreshHeading(doc,heading,de,en){
 const row=doc.createElement('div'),button=doc.createElement('button'),name=doc.createElement('span');
 row.className='sma-history-title-row';
 button.type='button';button.className='sma-history-refresh sma-refresh';
 name.className='sma-history-visually-hidden';label(name,de,en);
 button.append(name);
 heading.before(row);row.append(heading,button);
 return button;
}

export function mountHistoryMonths(slot,chooseMonth){
 const doc=slot.ownerDocument;
 const create=(tag,name)=>{const node=doc.createElement(tag);if(name)node.className=name;return node;};
 const control=(de,en)=>{const b=create('button');b.type='button';label(b,de,en);return b;};
 const picker=control('Zeitraum ändern','Change period'),calendar=create('div','sma-history-calendar');
 const archive=control('Monate mit Aufträgen','Months with orders'),links=create('div','sma-history-month-links');
 const years=create('div','sma-history-years'),year=create('select'),grid=create('div','sma-history-month-grid');
 const prev=control('‹','‹'),next=control('›','›');
 const yearLabel=create('label'),yearCaption=create('span','sma-history-visually-hidden');
 label(yearCaption,'Jahr','Year');yearLabel.append(yearCaption,year);
 prev.setAttribute('aria-label',language(doc)==='en'?'Previous year':'Vorheriges Jahr');
 next.setAttribute('aria-label',language(doc)==='en'?'Next year':'Nächstes Jahr');
 years.append(prev,yearLabel,next);calendar.append(years,grid);
 for(let n=2000;n<=2099;n++){const option=create('option');option.value=String(n);option.textContent=String(n);year.append(option);}
 calendar.id='sma-history-calendar';links.id='sma-history-month-links';
 function open(button,panel,visible){button.setAttribute('aria-expanded',String(visible));panel.hidden=!visible;}
 for(const [button,panel] of [[picker,calendar],[archive,links]]){
  button.setAttribute('aria-controls',panel.id);open(button,panel,false);
 }
 picker.className='sma-history-period-button';archive.className='sma-history-archive-button';
 slot.replaceChildren(picker,calendar,archive,links);
 let selected=null;
 function setYear(value){
  const n=Number(value);
  if(!Number.isInteger(n)||n<2000||n>2099)return;
  year.options[n-2000].selected=true;
  prev.disabled=n===2000;next.disabled=n===2099;
  const full=new Intl.DateTimeFormat(language(doc),{month:'long',year:'numeric',timeZone:'UTC'});
  const short=new Intl.DateTimeFormat(language(doc),{month:'short',timeZone:'UTC'});
  grid.replaceChildren();
  for(let m=1;m<=12;m++){
   const key=n+'-'+String(m).padStart(2,'0'),date=new Date(key+'-01T12:00Z'),button=create('button');
   button.type='button';button.value=key;button.textContent=short.format(date).replace(/\.$/,'');
   button.setAttribute('aria-label',full.format(date));button.setAttribute('aria-pressed',String(key===selected));
   button.addEventListener('click',()=>select(key,picker));grid.append(button);
  }
 }
 function close(){open(picker,calendar,false);open(archive,links,false);}
 function select(value,opener){
  if(!validHistoryMonth(value))return;
  close();opener.focus();chooseMonth(value);
 }
 picker.addEventListener('click',()=>{
  const show=calendar.hidden;close();
  if(!show)return;
  const initial=selected?.slice(0,4)||new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'Europe/Vienna'}).format(new Date());
  setYear(initial);open(picker,calendar,true);
  (grid.querySelector('[aria-pressed="true"]')||year).focus();
 });
 year.addEventListener('change',()=>setYear(year.value));
 prev.addEventListener('click',()=>setYear(Number(year.value)-1));
 next.addEventListener('click',()=>setYear(Number(year.value)+1));
 archive.addEventListener('click',()=>{const show=links.hidden;close();open(archive,links,show);});
 slot.addEventListener('keydown',escape);
 function escape(event){
  if(event.key!=='Escape'||calendar.hidden&&links.hidden)return;
  const trigger=calendar.hidden?archive:picker;close();trigger.focus();
 }
 return {
  update(month,months){
   selected=month;links.replaceChildren();
   const full=new Intl.DateTimeFormat(language(doc),{month:'long',year:'numeric',timeZone:'UTC'});
   for(const item of months){
    const b=create('button');b.type='button';b.textContent=full.format(new Date(item.month+'-01T12:00Z'))+' · '+item.orders;
    b.setAttribute('aria-pressed',String(month===item.month));b.addEventListener('click',()=>select(item.month,archive));links.append(b);
   }
   if(!months.length){const empty=create('span');label(empty,'Keine Monate mit Aufträgen.','No months with orders.');links.append(empty);}
  },
  clear(){links.replaceChildren();},
  disable(){close();grid.replaceChildren();links.replaceChildren();selected=null;picker.disabled=true;archive.disabled=true;},
  destroy(){slot.removeEventListener('keydown',escape);slot.replaceChildren();}
 };
}
