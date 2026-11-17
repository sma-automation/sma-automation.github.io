'use strict';

// This function is embedded in the existing private dashboard renderer. Keep
// it self-contained: no provider data, credentials, modules or persistent state.
function installDashboardOAuthRefresh({window,document,
 requestDashboard=()=>window.parent.smaDashboardResponse(),
 setLanguage=()=>{},currentLanguage=()=> 'de',now=()=>Date.now()}){
 const platforms=['YouTube','TikTok','Instagram','Facebook'];
 const origins=['https://sma-automation.com','https://johnmusic.app.n8n.cloud'];
 const app=()=>document.querySelector('.app[data-sma-customer-id]');
 const customer=app()?.getAttribute('data-sma-customer-id');
 const social=document.getElementById('page-social');
 const list=social?.querySelector('.platform-list');
 if(!customer||!social||!list)return {destroy(){}};
 let embedding=null;try{embedding=window.frameElement;}catch{}

 // Outside .platform-list: replacing server-rendered cards must not replace
 // this button or move its keyboard focus back to the connection link.
 const panel=document.createElement('div');panel.className='sma-oauth-status';panel.hidden=true;
 panel.style.setProperty('display','none','important');
 const message=document.createElement('p');message.className='sma-oauth-status-message';
 message.setAttribute('role','status');message.setAttribute('aria-live','polite');
 const check=document.createElement('button');check.type='button';check.className='button sma-oauth-status-check';
 check.setAttribute('data-de','Verbindungsstatus prüfen');check.setAttribute('data-en','Check connection status');
 panel.append(message,check);list.after(panel);
 let attempt=null,sequence=0,running=null,queued=null,timer=null,disposed=false,suspended=false;
 // At most one timestamp per supported platform. The same success delivered
 // through message and storage is one hint, including across another click.
 const successes=new Map();

 function live(){
  if(disposed||suspended||window.closed||app()?.getAttribute('data-sma-customer-id')!==customer)return false;
  try{return !embedding||(embedding.isConnected&&embedding.contentDocument===document);}catch{return false;}
 }
 function current(work){return live()&&work?.attempt===attempt&&work.revision===attempt.revision;}
 function label(node,de,en){
  node.setAttribute('data-de',de);node.setAttribute('data-en',en);
  node.textContent=currentLanguage()==='en'?en:de;
 }
 function render(){
  if(!live())return;
  panel.hidden=!attempt;
  // Existing dashboard-chapters.css hides every direct non-list child of the
  // moved social page with !important. Override only our own panel, keeping
  // its hidden state in sync instead of revealing any original social content.
  panel.style.setProperty('display',attempt?'block':'none','important');
  if(!attempt)return;
  check.setAttribute('data-sma-platform',attempt.platform);
  label(check,'Verbindungsstatus prüfen','Check connection status');
  const prefix=attempt.platform+': ';
  const text=attempt.status==='checking'
   ?['Der Verbindungsstatus wird geprüft …','Checking the connection status …']
   :attempt.status==='failed'
    ?['Der Verbindungsstatus konnte gerade nicht geprüft werden. Bitte versuche es erneut.','The connection status could not be checked. Please try again.']
    :attempt.status==='disconnected'
     ?['Noch keine Verbindung bestätigt. Du kannst den Status nach der Anmeldung erneut prüfen.','No connection has been confirmed yet. You can check again after signing in.']
     :attempt.status==='checked'
      ?['Der aktuelle Verbindungsstatus wurde geladen.','The current connection status has been loaded.']
      :['Prüfe den Verbindungsstatus nach der Anmeldung.','Check the connection status after signing in.'];
  label(message,prefix+text[0],prefix+text[1]);
  check.disabled=Boolean(running||timer);
 }
 function stopTimer(){if(timer){window.clearTimeout(timer.id);timer=null;}}
 function connected(platform){
  return Array.from(document.querySelectorAll('#page-social .platform-card[data-sma-platform]'))
   .some(card=>card.getAttribute('data-sma-platform')===platform&&card.classList.contains('connected'));
 }
 async function read(work){
  if(!current(work))return;
  if(running){
   if(running.attempt!==work.attempt||running.revision!==work.revision)queued=work;
   return;
  }
  running=work;attempt.status='checking';render();
  try{
   const response=await requestDashboard();
   if(!current(work))return;
   if(!response?.ok)throw new Error('DASHBOARD_UNAVAILABLE');
   const html=await response.text();
   if(!current(work))return;
   const fresh=new window.DOMParser().parseFromString(html,'text/html');
   if(fresh.querySelector('.app[data-sma-customer-id]')?.getAttribute('data-sma-customer-id')!==customer)
    throw new Error('DASHBOARD_OWNER_CHANGED');
   if(!current(work))return;
   for(const selector of ['#page-social .platform-list','#page-publishing .platform-list']){
    const target=document.querySelector(selector),source=fresh.querySelector(selector);
    if(target&&source)target.innerHTML=source.innerHTML;
   }
   const counts=document.querySelectorAll('[data-sma-social-count]');
   const freshCounts=fresh.querySelectorAll('[data-sma-social-count]');
   if(counts.length===freshCounts.length)counts.forEach((count,index)=>{count.textContent=freshCounts[index].textContent;});
   setLanguage(currentLanguage());
   // A connected card may predate a reconnect attempt. Keep its correlation so
   // a later real success hint can request a fresh snapshot, without polling.
   attempt.status=connected(attempt.platform)?'checked':'disconnected';
  }catch{
   if(current(work))attempt.status='failed';
  }finally{
   if(running===work)running=null;
   if(live()){
    render();
    const next=queued;queued=null;
    if(current(next))void read(next);
   }
  }
 }
 function schedule(delay){
  if(!live()||!attempt)return;
  stopTimer();
  const work={attempt,revision:attempt.revision};
  const scheduled={id:null,work};timer=scheduled;
  scheduled.id=window.setTimeout(()=>{
   if(timer!==scheduled)return;
   timer=null;
   if(current(work))void read(work);else render();
  },delay);
  render();
 }
 function clicked(event){
  if(!live()||event.defaultPrevented||event.button>0)return;
  const link=event.target?.closest?.('#page-social .platform-action a[href]');
  const platform=link?.closest('.platform-card[data-sma-platform]')?.getAttribute('data-sma-platform');
  if(!platforms.includes(platform))return;
  stopTimer();queued=null;
  attempt={id:++sequence,platform,revision:0,passiveUsed:false,status:'pending'};
  render();
 }
 function returned(){
  if(!live()||document.hidden||!attempt||attempt.passiveUsed)return;
  // Consume before scheduling: focus and visibilitychange are the same return,
  // and an aborted popup must not make every later tab visit a new backend read.
  attempt.passiveUsed=true;schedule(350);
 }
 function success(result){
  if(!live()||!attempt||result?.type!=='sma-oauth-success'||!platforms.includes(result.platform)
   ||result.platform!==attempt.platform)return;
  const stamp=Number(result.zeit);
  if(!Number.isFinite(stamp)||Math.abs(now()-stamp)>120000||stamp<=(successes.get(result.platform)??-Infinity))return;
  successes.set(result.platform,stamp);attempt.passiveUsed=true;attempt.revision++;
  // A newer outcome supersedes an already-running snapshot. Its single queued
  // follow-up is not lost even if that older snapshot still says connected.
  schedule(250);
 }
 function storage(event){
  if(event.key!=='sma_oauth_success'||!event.newValue)return;
  try{success(JSON.parse(event.newValue));}catch{}
 }
 function reported(event){if(origins.includes(event.origin))success(event.data);}
 function visible(){if(!document.hidden)returned();}
 function manual(){
  if(!live()||!attempt||check.disabled)return;
  // A deliberate status check can replace a still-unused passive return.
  attempt.passiveUsed=true;attempt.revision++;schedule(0);
 }
 function pagehide(event){
  if(event.persisted!==true){destroy();return;}
  // BFCache restores the same document without running this script again.
  // Retain its controls, but no old timer, snapshot or passive return survives.
  suspended=true;stopTimer();queued=null;
  if(attempt){attempt.revision++;attempt.passiveUsed=true;attempt.status='pending';}
  // Keep running until its parent's existing 45-second read actually settles.
 }
 function pageshow(){
  if(disposed||!suspended)return;
  suspended=false;render();
 }
 function destroy(){
  if(disposed)return;disposed=true;stopTimer();queued=null;attempt=null;
  document.removeEventListener('click',clicked,true);
  document.removeEventListener('visibilitychange',visible);
  window.removeEventListener('focus',returned);window.removeEventListener('storage',storage);
  window.removeEventListener('message',reported);window.removeEventListener('pagehide',pagehide);
  window.removeEventListener('pageshow',pageshow);
  check.removeEventListener('click',manual);panel.remove();
 }
 document.addEventListener('click',clicked,true);document.addEventListener('visibilitychange',visible);
 window.addEventListener('focus',returned);window.addEventListener('storage',storage);
 window.addEventListener('message',reported);window.addEventListener('pagehide',pagehide);
 window.addEventListener('pageshow',pageshow);
 check.addEventListener('click',manual);
 return {destroy};
}

module.exports={installDashboardOAuthRefresh};
