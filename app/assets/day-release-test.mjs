import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
const db=createClient('https://bnvnmdxosbnuzedokqgh.supabase.co','sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW');
const id=new URLSearchParams(location.hash.slice(1)).get('kopie');
const field=key=>document.getElementById(key);
const status=field('status'), button=field('confirm'), settings=field('defaults'), ai=field('ai');
const clock=new Intl.DateTimeFormat('de-AT',{timeZone:'Europe/Vienna',hour:'2-digit',minute:'2-digit'});
const labels={SELF_ONLY:'Nur ich',MUTUAL_FOLLOW_FRIENDS:'Freunde',FOLLOWER_OF_CREATOR:'Follower',PUBLIC_TO_EVERYONE:'Öffentlich',private:'Privat',public:'Öffentlich',unlisted:'Nicht gelistet'};
const gaps={FILE_BINDING:'Dateiversion oder Portalzuordnung',TARGET:'Zielkonto',TEXT:'gespeicherte Beitragsfassung',VISIBILITY:'Sichtbarkeit',AI:'KI-Vorgabe',DEFAULTS:'Ordnervorgaben'};
const selects=new Map();
let plan=null;
function node(parent,tag,text){const el=document.createElement(tag);el.textContent=text;parent.append(el);return el;}
function render(data){
 plan=data;
 field('day').textContent=new Intl.DateTimeFormat('de-AT',{dateStyle:'full',timeZone:'Europe/Vienna'}).format(new Date(data.day+'T12:00:00Z'));
 field('items').replaceChildren();selects.clear();
 for(const item of data.items){
  const row=node(field('items'),'article','');row.className='row';
  node(row,'time',clock.format(new Date(item.due_at))).dateTime=item.due_at;
  const content=node(row,'div','');
  node(content,'strong',(item.platform==='youtube'?'YouTube':'TikTok')+' · '+(item.title||item.file));
  const details=node(content,'details','');node(details,'summary','Beitrag ansehen');
  node(details,'p',item.caption||'Der gespeicherte Beitragstext fehlt.');node(details,'small',item.file);
  if(item.platform==='youtube'&&item.defaults){
   const d=item.defaults;
   node(content,'small','Für Kinder: '+(d.made_for_kids?'Ja':'Nein')+' · Realistisch verändert oder KI: '+(d.contains_synthetic_media?'Ja':'Nein')+' · '+(labels[d.visibility]||'Sichtbarkeit offen'));
  }
  if(item.platform==='tiktok'){
   const label=node(content,'label','Sichtbarkeit im Test');
   const select=node(label,'select','');select.append(new Option('Auswählen',''));
   for(const option of item.privacy_options) if(labels[option])select.append(new Option(labels[option],option));
   select.value=data.choices?.[item.key]||'';select.disabled=!!data.receipt;selects.set(item.key,select);
  }
  const result=data.results.find(r=>r.key===item.key);
  if(result?.state==='held')node(content,'small','Zurückgestellt · '+result.reasons.map(code=>gaps[code]||code).join(', '));
  else if(result?.state==='existing')node(content,'small','Vorhandene Freigabe übernommen · '+(result.operation==='technical_check'?'technische Nachprüfung':'Testversand'));
  else if(result)node(content,'small',result.operation==='simulated_transfer'?'Testversand erfolgt':'Tagesfreigabe übernommen · technische Prüfung vorgemerkt');
 }
 settings.hidden=!selects.size;ai.value=typeof data.choices?.tiktok_ai==='boolean'?String(data.choices.tiktok_ai):'';ai.disabled=!!data.receipt;
 button.hidden=!!data.receipt;button.disabled=false;
 status.textContent=data.receipt?'Eine Tagesbestätigung gespeichert · '+data.results.length+' Termine verarbeitet.':'';
}
async function rpc(action,choices={}){
 const {data,error}=await db.rpc('sma_day_release_test_v1',{p_copy:id,p_action:action,p_stamp:plan?.stamp||null,p_choices:choices});
 if(error||!data?.ok||data.mode!=='simulation')throw new Error(data?.code||'REQUEST_FAILED');
 return data;
}
async function show(){
 try{
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id||''))throw new Error('COPY_UNAVAILABLE');
  const {data:{session}}=await db.auth.getSession();
  if(!session){field('login').hidden=false;status.textContent='Melde dich mit deinem SMA-Konto an und öffne danach diesen Testlink erneut.';return;}
  render(await rpc('get'));
 }catch{status.textContent='Die Testkopie ist für dieses Konto nicht verfügbar.';}
}
button.addEventListener('click',async()=>{
 if(!plan||button.disabled||plan.receipt)return;
 button.disabled=true;status.textContent='Tagesfreigabe wird gespeichert …';
 const choices={};
 for(const [key,select] of selects)if(select.value)choices[key]=select.value;
 if(ai.value)choices.tiktok_ai=ai.value==='true';
 try{render(await rpc('confirm',choices));}
 catch{
  try{const saved=await rpc('get');render(saved);if(!saved.receipt)status.textContent='Die Freigabe wurde nicht gespeichert. Prüfe den angezeigten Stand.';}
  catch{status.textContent='Der Freigabestand ist unklar. Lade die Seite erneut.';}
 }
});
void show();
