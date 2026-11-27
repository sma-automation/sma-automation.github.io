import {dashboardAction} from './dashboard-feedback.mjs?v=1';
const portals = {youtube:'YouTube', tiktok:'TikTok', instagram:'Instagram', facebook:'Facebook'};
const errors = {
  VERSION_CONFLICT:['Die Zeiten wurden inzwischen geändert. Lade den aktuellen Stand.','The times have changed. Load the current schedule.'],
  INVALID_TIMES:['Bitte drei verschiedene Uhrzeiten wählen.','Choose three different times.'],
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

export function mountDailySchedule(doc,panel,request,media,editorUrl) {
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
  panel.classList.add('sma-daily-schedule');
  const head=node(panel,'header'),logo=node(head,'h2'),dayInfo=node(head,'div');
  const dayPicker=node(dayInfo,'input');dayPicker.type='date';
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
  const entries=node(panel,'ul'),status=node(panel,'p');status.setAttribute('role','status');
  const retry=button(panel,'Gespeicherten Stand laden','Reload saved schedule');retry.hidden=true;
  let portal='youtube',day=offsetViennaDay(0,new Date()),record=null,busy=false,destroyed=false;
  const edits=new Map();
  let saveTimer;
  function controls(){
    inputs.forEach(input=>{input.disabled=!record||busy==='get';});
    save.disabled=busy||!record||(!edits.has(portal)&&record.version>0);
    dayPicker.disabled=Boolean(busy)||edits.size>0;
    retry.disabled=busy;
  }
  function renderHeader(){
    const name=portals[portal];
    dayPicker.min=offsetViennaDay(-31,new Date());dayPicker.max=offsetViennaDay(31,new Date());
    dayPicker.value=day;dayPicker.setAttribute('aria-label',words('Planungstag','Schedule date'));
    const card=[...doc.querySelectorAll('#page-publishing .platform-card')].find(el=>el.querySelector('.platform-info strong')?.textContent.trim()===name);
    const icon=card?.querySelector('.platform-icon');
    logo.replaceChildren();
    if(icon){const brand=icon.cloneNode(true);brand.setAttribute('aria-hidden','true');logo.append(brand);}
    else logo.textContent=name;
    logo.setAttribute('aria-label',name);
    const values=edits.get(portal)||record?.times[portal]||[];
    inputs.forEach((input,i)=>{input.value=values[i]||'';});
    controls();
  }
  function renderVideos(){
    media?.reset();entries.replaceChildren();
    if(!record)return;
    const files=record.files.filter(file=>file.times[portal]).sort((a,b)=>Date.parse(a.times[portal])-Date.parse(b.times[portal]));
    for(const file of files){
      const li=node(entries,'li');
      const summary=node(li,'div');summary.className='sma-schedule-file';
      const time=node(summary,'time',viennaTime.format(new Date(file.times[portal])));time.dateTime=file.times[portal];
      const visual=node(summary,'span');visual.className='sma-schedule-thumbnail';visual.setAttribute('aria-hidden','true');
      const title=file.current?media?.show(visual,file,portal):null;
      if(!title)visual.hidden=true;
      const caption=node(summary,'div');node(caption,'strong',title||file.name);
      if(file.slot&&record.times[portal]?.[file.slot-1]!==time.textContent){
        node(caption,'small','Fester Termin für diesen Beitrag','Fixed time for this post');
      }
      const note=node(caption,'small');
      if(!file.current)translate(note,'Geplante Dateiversion nicht mehr verfügbar','Scheduled file version is no longer available');
      else if(file.texts.includes(portal))translate(note,'Beitragstext vorhanden','Post text available');
      else translate(note,'Beitragstext offen','Post text pending');
      const label=file.media_kind==='image'?['Bild bearbeiten','Edit image']:['Video bearbeiten','Edit video'];
      if(file.current&&file.asset_id&&file.asset_revision&&editorUrl){
        const edit=node(li,'a',...label),url=new URL(editorUrl);
        url.hash=new URLSearchParams({asset:file.asset_id,revision:file.asset_revision,portal}).toString();
        edit.href=url.href;edit.target='_blank';edit.rel='noopener';edit.className='sma-schedule-edit';
        edit.setAttribute('aria-label',words(...label)+' · '+(title||file.name)+' · '+time.textContent);
      }else{
        const edit=button(li,...label);edit.className='sma-schedule-edit';edit.disabled=true;
      }
    }
    if(!files.length)node(entries,'li','Für diesen Tag sind keine Beiträge geplant.','No posts are scheduled for this day.');
  }
  dayPicker.addEventListener('change',dashboardAction(()=>{
    const selected=dayPicker.value;
    if(busy||edits.size||!selected||selected<dayPicker.min||selected>dayPicker.max){dayPicker.value=day;return;}
    if(selected===day)return;
    day=selected;record=null;renderVideos();renderHeader();return run('get');
  }));
  async function run(action,target=portal){
    if(busy||destroyed)return;
    const args={p_action:action,p_day:day};
    let sent;
    if(action==='save'){
      sent=edits.get(target)||record.times[target];
      if(!validTimes(sent)){if(target===portal)translate(status,...errors.INVALID_TIMES);return;}
      args.p_times={...record.times,[target]:sent};args.p_version=record.version;
    }
    busy=action;retry.hidden=true;controls();
    if(action==='save')translate(status,'Uhrzeit wird gespeichert …','Saving time …');
    else translate(status,'Tagesplanung wird geladen …','Loading daily schedule …');
    try{
      const data=await request(args);
      if(destroyed)return;
      if(!data?.ok)throw Object.assign(new Error(),{code:data?.code});
      record=data;
      if(action==='save'&&edits.get(target)===sent)edits.delete(target);
      renderHeader();renderVideos();
      if(action==='save'&&data.fixed_slots>0)translate(status,'Standardzeiten gespeichert. Bereits fest gebuchte oder abgelaufene Termine stehen unten mit ihrer gültigen Uhrzeit.','Standard times saved. Fixed or elapsed posts are shown below with their actual times.');
      else if(action==='save')translate(status,'Zeiten gespeichert.','Times saved.');
      else translate(status,'','');
    }catch(error){
      if(destroyed)return;
      record=null;media?.reset();entries.replaceChildren();retry.hidden=false;
      translate(status,...(errors[error.code]||['Die Planung konnte nicht geladen werden.','The schedule could not be loaded.']));
    }finally{
      busy=false;
      if(!destroyed){controls();if(record&&action==='save')flushEdits();}
    }
  }
  function validTimes(values){return values.length===3&&values.every(v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v))&&new Set(values).size===3;}
  function flushEdits(){
    clearTimeout(saveTimer);
    if(!record||busy||destroyed)return;
    for(const [target,values] of edits){if(validTimes(values)){void run('save',target);return;}}
    if(edits.has(portal))translate(status,...errors.INVALID_TIMES);
  }
  function trackEdit(){
    if(!record||busy==='get')return;
    const values=inputs.map(input=>input.value);
    if(!busy&&values.every((value,i)=>value===record.times[portal][i]))edits.delete(portal);
    else if(!edits.get(portal)?.every((v,i)=>v===values[i]))edits.set(portal,values);
    translate(status,'','');controls();
  }
  form.addEventListener('input',()=>{trackEdit();clearTimeout(saveTimer);saveTimer=setTimeout(flushEdits,650);});
  form.addEventListener('change',()=>{trackEdit();flushEdits();});
  const beforeLeave=event=>{if(edits.size||busy==='save'){event.preventDefault();event.returnValue='';}};
  doc.defaultView?.addEventListener('beforeunload',beforeLeave);
  form.addEventListener('submit',dashboardAction(event=>{event.preventDefault();if(!save.disabled)return run('save');}));
  retry.addEventListener('click',dashboardAction(()=>run('get')));
  const Observer=doc.defaultView?.MutationObserver;
  const languageObserver=Observer?new Observer(()=>{if(!destroyed){renderHeader();renderVideos();}}):null;
  languageObserver?.observe(doc.documentElement,{attributes:true,attributeFilter:['lang']});
  media?.ready?.then(()=>{if(!destroyed&&record&&!panel.hidden)renderVideos();});
  controls();
  return {
    open(selected){portal=Object.hasOwn(portals,selected)?selected:'youtube';renderHeader();renderVideos();if(!record)void run('get');},
    destroy(){destroyed=true;languageObserver?.disconnect();media?.reset();clearTimeout(saveTimer);doc.defaultView?.removeEventListener('beforeunload',beforeLeave);edits.clear();panel.replaceChildren();}
  };
}
