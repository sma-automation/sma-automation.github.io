import {dashboardAction} from './dashboard-feedback.mjs?v=1';
const portals = {youtube:'YouTube', tiktok:'TikTok', instagram:'Instagram', facebook:'Facebook'};
const errors = {
  VERSION_CONFLICT:['Die Zeiten wurden inzwischen geändert. Lade den aktuellen Stand.','The times have changed. Load the current schedule.'],
  INVALID_TIMES:['Bitte drei aufsteigende Uhrzeiten wählen.','Choose three times in ascending order.'],
  ACCESS_INACTIVE:['Für dieses Kundenkonto ist die Planung derzeit gesperrt.','Planning is currently unavailable for this account.'],
  AUTH_REQUIRED:['Bitte melde dich erneut an.','Please sign in again.'],
  INVALID_DAY:['Wähle einen Tag innerhalb von 31 Tagen vor oder nach heute.','Choose a day within 31 days of today.']
};
const viennaDate = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Vienna',year:'numeric',month:'2-digit',day:'2-digit'});
const viennaTime = new Intl.DateTimeFormat('de-AT',{timeZone:'Europe/Vienna',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const isoDay = date => date.toISOString().slice(0,10);
function offsetViennaDay(offset, now) {
  const date = new Date(viennaDate.format(new Date(now))+'T12:00:00Z');
  date.setUTCDate(date.getUTCDate()+offset);
  return isoDay(date);
}
export function nextViennaDay(now = new Date()) {return offsetViennaDay(1,now);}

export function mountDailySchedule(doc,panel,request,media) {
  const language=()=>/^en/i.test(doc.documentElement.lang)?'en':'de';
  const words=(de,en)=>language()==='en'?en:de;
  const translate=(element,de,en)=>{
    element.dataset.de=de; element.dataset.en=en; element.textContent=words(de,en);
  };
  const node=(parent,tag,de,en)=>{
    const el=doc.createElement(tag);
    if(en)translate(el,de,en);else if(de)el.textContent=de;
    parent.append(el);return el;
  };
  const button=(parent,de,en)=>{
    const el=node(parent,'button',de,en);el.type='button';return el;
  };
  function dateLabel(date,options) {
    return new Intl.DateTimeFormat(words('de-AT','en-GB'),{timeZone:'UTC',...options}).format(date);
  }
  panel.classList.add('sma-daily-schedule');
  const head=node(panel,'header'),logo=node(head,'h2'),dayInfo=node(head,'div'),dayTitle=node(dayInfo,'strong');
  node(dayInfo,'span','Wiener Zeit','Vienna time');
  const details=node(panel,'details');details.open=true;
  node(details,'summary','Standardzeiten anpassen','Adjust standard times');
  const form=node(details,'form'),row=node(form,'div');row.className='sma-schedule-times';
  const labels=[['Erster Beitrag','First post'],['Zweiter Beitrag','Second post'],['Dritter Beitrag','Third post']];
  const inputs=labels.map(([de,en])=>{
    const label=node(row,'label');node(label,'span',de,en);
    const input=node(label,'input');input.type='time';input.step='60';input.required=true;
    return input;
  });
  const save=node(form,'button','Zeiten speichern','Save times');save.type='submit';
  const release=node(panel,'a','Gemeinsame Tagesfreigabe öffnen','Open daily approval');
  release.target='_top';
  const dateTrigger=button(panel,'Private Tagesentwürfe','Private daily drafts');
  dateTrigger.className='sma-schedule-date';dateTrigger.setAttribute('aria-controls','sma-daily-calendar');dateTrigger.setAttribute('aria-expanded','false');
  const calendar=node(panel,'div');calendar.id='sma-daily-calendar';calendar.hidden=true;
  const monthNav=node(calendar,'div'),prev=button(monthNav,'‹'),monthTitle=node(monthNav,'strong'),next=button(monthNav,'›');
  const weeks=node(calendar,'div'),days=node(calendar,'div');weeks.className=days.className='sma-calendar-grid';
  const entries=node(panel,'ul'),status=node(panel,'p');status.setAttribute('role','status');
  const retry=button(panel,'Gespeicherten Stand laden','Reload saved schedule');retry.hidden=true;
  let portal='youtube',day=nextViennaDay(),monthShown,record=null,busy=false,destroyed=false;
  const edits=new Map();
  function controls(){
    inputs.forEach(input=>{input.disabled=busy||!record;});
    save.disabled=busy||!record||(!edits.has(portal)&&record.version>0);
    dateTrigger.disabled=busy||!record||edits.has(portal);
    retry.disabled=busy;
  }
  function renderHeader(){
    const name=portals[portal];
    const today=offsetViennaDay(0,new Date()),last=offsetViennaDay(2,new Date());
    release.hidden=day<today||day>last||!['youtube','tiktok'].includes(portal);
    release.href=new URL('../tagesplan.html?tag='+encodeURIComponent(day),import.meta.url).href;
    const card=[...doc.querySelectorAll('#page-publishing .platform-card')].find(el=>el.querySelector('.platform-info strong')?.textContent.trim()===name);
    const icon=card?.querySelector('.platform-icon');
    logo.replaceChildren();
    if(icon){const brand=icon.cloneNode(true);brand.setAttribute('aria-hidden','true');logo.append(brand);}
    else logo.textContent=name;
    logo.setAttribute('aria-label',name);
    dayTitle.textContent=dateLabel(new Date(day+'T12:00:00Z'),{weekday:'long',day:'numeric',month:'long'});
    const values=edits.get(portal)||record?.times[portal]||[];
    inputs.forEach((input,i)=>{input.value=values[i]||'';});
    controls();
  }
  function renderDrafts(){
    media?.reset();entries.replaceChildren();
    if(!record)return;
    const files=record.files.filter(file=>file.times[portal]).sort((a,b)=>Date.parse(a.times[portal])-Date.parse(b.times[portal]));
    for(const file of files){
      const li=node(entries,'li');
      const time=node(li,'time',viennaTime.format(new Date(file.times[portal])));time.dateTime=file.times[portal];
      const visual=node(li,'span');visual.className='sma-schedule-thumbnail';visual.setAttribute('aria-hidden','true');
      const title=file.current?media?.show(visual,file.name,portal):null;
      if(!title)visual.hidden=true;
      node(li,'strong',title||file.name);
      const note=node(li,'small');
      if(!file.current)translate(note,'Dateiversion prüfen','Check file version');
      else if(file.texts.includes(portal))translate(note,'Beitragstext vorhanden','Post text available');
      else translate(note,'Beitragstext offen','Post text pending');
    }
    if(!files.length)node(entries,'li','Für diesen Tag gibt es keine privaten Entwürfe.','There are no private drafts for this day.');
  }
  function closeCalendar(focus=false){
    calendar.hidden=true;dateTrigger.setAttribute('aria-expanded','false');if(focus)dateTrigger.focus();
  }
  function renderCalendar(){
    const first=monthShown.getUTCMonth(),year=monthShown.getUTCFullYear(),now=new Date();
    const min=offsetViennaDay(-31,now),max=offsetViennaDay(31,now);
    monthTitle.textContent=dateLabel(monthShown,{year:'numeric',month:'long'});
    prev.setAttribute('aria-label',words('Vorheriger Monat','Previous month'));
    next.setAttribute('aria-label',words('Nächster Monat','Next month'));
    const last=new Date(Date.UTC(year,first+1,0));
    prev.disabled=isoDay(monthShown)<=min;next.disabled=isoDay(last)>=max;
    weeks.replaceChildren();days.replaceChildren();
    for(let i=0;i<7;i++)node(weeks,'span',dateLabel(new Date(Date.UTC(2024,0,i+1)),{weekday:'short'}));
    for(let i=1;i<=last.getUTCDate();i++){
      const value=new Date(Date.UTC(year,first,i)),iso=isoDay(value);
      const pick=button(days,String(i));pick.dataset.day=iso;pick.disabled=iso<min||iso>max;
      pick.setAttribute('aria-label',dateLabel(value,{dateStyle:'full'}));pick.setAttribute('aria-pressed',String(iso===day));
      if(i===1)pick.style.gridColumnStart=String((value.getUTCDay()+6)%7+1);
    }
  }
  dateTrigger.addEventListener('click',()=>{
    if(!calendar.hidden){closeCalendar();return;}
    monthShown=new Date(day.slice(0,7)+'-01T00:00:00Z');calendar.hidden=false;dateTrigger.setAttribute('aria-expanded','true');
    renderCalendar();days.querySelector('[aria-pressed=true]')?.focus();
  });
  for(const [control,step] of [[prev,-1],[next,1]])control.addEventListener('click',()=>{
    monthShown.setUTCMonth(monthShown.getUTCMonth()+step);renderCalendar();
  });
  days.addEventListener('click',dashboardAction(event=>{
    const pick=event.target.closest('button[data-day]');
    if(!pick||pick.disabled||busy)return;
    closeCalendar(true);if(pick.dataset.day!==day){day=pick.dataset.day;void run('get');}
  }));
  calendar.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeCalendar(true);}});
  async function run(action){
    if(busy||destroyed)return;
    const target=portal,args={p_action:action,p_day:day};
    if(action==='save'){
      const [a,b,c]=inputs.map(el=>el.value);
      if(!a||!b||!c||a>=b||b>=c){translate(status,...errors.INVALID_TIMES);return;}
      args.p_times={...record.times,[target]:[a,b,c]};args.p_version=record.version;
    }
    busy=true;retry.hidden=true;controls();translate(status,'Tagesplanung wird geladen …','Loading daily schedule …');
    try{
      const data=await request(args);
      if(destroyed)return;
      if(!data?.ok)throw Object.assign(new Error(),{code:data?.code});
      record=data;if(action==='save')edits.delete(target);
      renderHeader();renderDrafts();
      if(action==='save')translate(status,'Zeiten gespeichert.','Times saved.');
      else translate(status,'','');
    }catch(error){
      if(destroyed)return;
      record=null;media?.reset();entries.replaceChildren();retry.hidden=false;
      translate(status,...(errors[error.code]||['Die Planung konnte nicht geladen werden.','The schedule could not be loaded.']));
    }finally{busy=false;if(!destroyed)controls();}
  }
  form.addEventListener('input',()=>{
    if(!record||busy)return;
    const values=inputs.map(input=>input.value);
    if(values.every((value,i)=>value===record.times[portal][i]))edits.delete(portal);else edits.set(portal,values);
    translate(status,'','');controls();
  });
  form.addEventListener('submit',dashboardAction(event=>{event.preventDefault();if(!save.disabled)return run('save');}));
  retry.addEventListener('click',dashboardAction(()=>run('get')));
  const Observer=doc.defaultView?.MutationObserver;
  const languageObserver=Observer?new Observer(()=>{if(!destroyed){renderHeader();if(!calendar.hidden)renderCalendar();}}):null;
  languageObserver?.observe(doc.documentElement,{attributes:true,attributeFilter:['lang']});
  media?.ready?.then(()=>{if(!destroyed&&record&&!panel.hidden)renderDrafts();});
  controls();
  return {
    open(selected){portal=Object.hasOwn(portals,selected)?selected:'youtube';closeCalendar();renderHeader();renderDrafts();if(!record)void run('get');},
    destroy(){destroyed=true;languageObserver?.disconnect();media?.reset();edits.clear();panel.replaceChildren();}
  };
}
