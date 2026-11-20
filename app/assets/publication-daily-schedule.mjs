const portals = {youtube:'YouTube', tiktok:'TikTok', instagram:'Instagram', facebook:'Facebook'};
const errors = {
  VERSION_CONFLICT:'Die Zeiten wurden inzwischen geändert. Lade den aktuellen Stand.',
  INVALID_TIMES:'Jedes Portal benötigt drei unterschiedliche, aufsteigende Uhrzeiten.',
  SAVE_FIRST:'Speichere zuerst die Zeiten für dein Kundenkonto.',
  ACCESS_INACTIVE:'Für dieses Kundenkonto ist die Planung derzeit gesperrt.',
  AUTH_REQUIRED:'Bitte melde dich erneut an.',
  INVALID_DAY:'Wähle einen Tag innerhalb von 31 Tagen vor oder nach heute.',
};
const viennaDate = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Vienna',year:'numeric',month:'2-digit',day:'2-digit'});
const viennaTime = new Intl.DateTimeFormat('de-AT',{timeZone:'Europe/Vienna',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function nextViennaDay(now = new Date()) {
  const date = new Date(viennaDate.format(new Date(now))+'T12:00:00Z');
  date.setUTCDate(date.getUTCDate()+1);
  return date.toISOString().slice(0,10);
}

export function mountDailySchedule(doc,panel,request) {
  panel.classList.add('sma-daily-schedule');
  const node = (tag,text,parent) => {
    const el=doc.createElement(tag);
    if(text) el.textContent=text;
    parent?.append(el);
    return el;
  };
  node('h2','Tägliche Veröffentlichungszeiten',panel);
  node('p','Drei Dateien pro Tag. Lege für jedes Portal drei Uhrzeiten in Wiener Zeit fest.',panel);
  const form=node('form',null,panel);
  const fields=new Map();
  for(const [key,name] of Object.entries(portals)){
    const group=node('fieldset',null,form);
    node('legend',name,group);
    const row=node('div',null,group);
    const inputs=[1,2,3].map(slot=>{
      const label=node('label','Datei '+slot,row);
      const input=node('input',null,label);
      input.type='time'; input.step='60'; input.required=true; input.disabled=true;
      input.setAttribute('aria-label',name+' · Datei '+slot);
      return input;
    });
    fields.set(key,inputs);
  }
  const save=node('button','Zeiten speichern',form); save.type='submit';
  node('p','Mit dem ersten Speichern beginnt die tägliche Entwurfsplanung. Neue Zeiten gelten für neu zugeteilte Dateien. Die Veröffentlichung braucht eine eigene Freigabe.',form);
  const dayLabel=node('label','Private Tagesentwürfe',panel);
  const day=node('input',null,dayLabel); day.type='date'; day.value=nextViennaDay();
  const entries=node('ul',null,panel);
  const fill=node('button','Freie Plätze füllen',panel); fill.type='button';
  const refresh=node('button','Gespeicherten Stand laden',panel); refresh.type='button';
  const status=node('p',null,panel); status.setAttribute('role','status');
  let record=null, busy=false, dirty=false, destroyed=false;
  function controls(){
    for(const inputs of fields.values()) for(const field of inputs) field.disabled=busy||!record;
    save.disabled=busy||!record||(!dirty&&record.version>0);
    day.disabled=busy||dirty||!record;
    fill.disabled=busy||dirty||!record?.version||record.files.length>=3||
      ![viennaDate.format(new Date()),nextViennaDay()].includes(day.value);
    refresh.disabled=busy;
  }
  function render(data){
    record=data; dirty=false;
    for(const [key,inputs] of fields) inputs.forEach((input,i)=>{input.value=data.times[key][i];});
    entries.replaceChildren();
    for(const file of data.files){
      const entry=node('li',null,entries);
      node('strong',file.name,entry);
      node('span',Object.entries(portals).filter(([key])=>file.times[key]).map(([key,name])=>name+' '+viennaTime.format(new Date(file.times[key]))).join(' · '),entry);
      const pending=Object.keys(file.times).filter(key=>!file.texts.includes(key)).map(key=>portals[key]);
      node('span',pending.length?'Beitragstext offen für '+pending.join(', '):'Beitragstexte vorhanden',entry);
      if(!file.current) node('span','Dateiversion prüfen',entry);
    }
    const free=Math.max(0,3-data.files.length);
    if(free) node('li',free===1?'1 freier Dateiplatz':free+' freie Dateiplätze',entries);
  }
  async function run(action){
    if(busy||destroyed) return;
    const args={p_action:action,p_day:day.value};
    if(action==='save'){
      args.p_times=Object.fromEntries([...fields].map(([key,inputs])=>[key,inputs.map(el=>el.value)]));
      if(Object.values(args.p_times).some(([a,b,c])=>!a||!b||!c||a>=b||b>=c)){
        status.textContent=errors.INVALID_TIMES; return;
      }
      args.p_version=record.version;
    }
    busy=true; controls(); status.textContent='Tagesplanung wird geladen …';
    try {
      const data=await request(args);
      if(destroyed) return;
      if(!data?.ok) throw Object.assign(new Error(),{code:data?.code});
      render(data);
      status.textContent=action==='save'?'Zeiten für dein Kundenkonto gespeichert.':
        action==='fill'?'Tagesentwürfe aktualisiert.':record.version?'Gespeicherte Planung geladen.':'Standardzeiten für dieses Kundenkonto.';
    } catch(error) {
      if(destroyed) return;
      record=null;
      entries.replaceChildren();
      status.textContent=errors[error.code]||'Die Planung konnte nicht bestätigt werden. Lade den gespeicherten Stand.';
    } finally { busy=false; if(!destroyed) controls(); }
  }
  form.addEventListener('input',()=>{dirty=true; controls();});
  form.addEventListener('submit',event=>{event.preventDefault();if(!save.disabled)void run('save');});
  day.addEventListener('change',()=>{if(day.value)void run('get');});
  fill.addEventListener('click',()=>run('fill'));
  refresh.addEventListener('click',()=>run('get'));
  controls();
  return {open(){if(!record)void run('get');},destroy(){destroyed=true;panel.replaceChildren();}};
}
