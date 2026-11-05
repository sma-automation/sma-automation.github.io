const texts={project:'Hosting wird eingerichtet …',deploy:'Webseite wird bereitgestellt …',domain:'Webadresse wird verbunden …',dns:'DNS-Eintrag wird eingerichtet …',verify:'DNS und HTTPS werden geprüft …',active:'Deine SMA-Webadresse ist eingerichtet.'};
const errors={AUTH_REQUIRED:'Bitte melde dich erneut an.',ACCOUNT_CHANGED:'Deine Kundenzuordnung hat sich geändert. Lade das Dashboard neu.',ACCOUNT_UNAVAILABLE:'Dein Zugang konnte nicht zugeordnet werden.',ACCESS_INACTIVE:'Die Einrichtung benötigt einen aktiven Delta-Zugang.',WEBSITE_DRAFT_REQUIRED:'Erstelle zuerst deinen Webseitenentwurf über „Webseite erzeugen / bearbeiten“.',SETUP_UNAVAILABLE:'Die automatische Einrichtung ist gerade nicht verfügbar.',REVIEW_REQUIRED:'Die Adresse muss geprüft werden. Bestehende Einträge wurden nicht überschrieben.'};
export function mountWebsiteSetup({root,request,getOwnerId}){
 if(!root||!request)return {load(){},invalidate(){},destroy(){}};
 root.innerHTML='<h3>SMA-Webadresse</h3><p class="sma-website-help">Ein Klick erstellt bei Bedarf deinen Webseitenentwurf aus deinen gespeicherten Firmendaten und richtet deine SMA-Webadresse ein. Dein Entwurf bleibt bis zu deiner Veröffentlichung privat.</p><div class="sma-website-actions"><button type="button" class="sma-website-primary" data-setup-start disabled>SMA-Webadresse automatisch einrichten</button></div><p class="sma-website-help" data-setup-address hidden></p><p role="status" aria-live="polite" data-setup-status></p>';
 const button=root.querySelector('[data-setup-start]'),status=root.querySelector('[data-setup-status]'),address=root.querySelector('[data-setup-address]'),win=root.ownerDocument.defaultView;
 let owner=null,generation=0,destroyed=false,busy=false,job=null,timer=null;
 function clear(){if(timer)win.clearTimeout(timer);timer=null;}
 function invalidate(){generation++;clear();owner=null;job=null;root.dataset.setupHasJob='false';busy=false;button.disabled=true;address.textContent='';address.hidden=true;status.textContent='';}
 async function load(action='get'){
  if(destroyed||busy)return;clear();const seq=++generation;busy=true;button.disabled=true;
  try{
   const uid=await getOwnerId();if(destroyed||seq!==generation)return;
   if(!uid||owner&&owner!==uid)throw Object.assign(Error(),{code:uid?'ACCOUNT_CHANGED':'AUTH_REQUIRED'});owner=uid;
   if(action!=='get')status.textContent='Einrichtung wird gestartet …';
   const result=await request(action,{});const current=await getOwnerId();if(destroyed||seq!==generation)return;
   if(current!==uid)throw Object.assign(Error(),{code:'ACCOUNT_CHANGED'});
   if(result?.ok!==true)throw Object.assign(Error(),{code:result?.code});
   const previous=job,next=result.job;
   if(next&&(!Object.hasOwn(texts,next.phase)||!/^seite-[1-9][0-9]*-[a-f0-9]{8}\.sma-automation\.com$/.test(next.hostname)))throw Error('INVALID_STATUS');
   job=next;root.dataset.setupHasJob=String(!!job);if(job)root.hidden=false;
   address.textContent=job?'https://'+job.hostname+'/':'';address.hidden=!job;
   status.textContent=job?(job.blocked?'Die Einrichtung wurde angehalten. Du kannst sie erneut prüfen lassen.':texts[job.phase]):(result.available?(result.draft_exists===false?'Bereit. Dein privater Webseitenentwurf wird beim Start automatisch erstellt.':'Bereit zur automatischen Einrichtung.'):errors.SETUP_UNAVAILABLE);
   button.textContent=job?.blocked?'Einrichtung erneut prüfen':job?.phase==='active'?'Adresse eingerichtet':job?'Einrichtung läuft …':'SMA-Webadresse automatisch einrichten';
   button.disabled=!result.available||!!job&&!job.blocked;
   if(job&&!job.blocked&&job.phase!=='active')timer=win.setTimeout(()=>load(),5000);
   // Refresh only the owner-checked summary, never the whole dashboard or forms.
   if(job&&(action==='start'||(previous&&previous.phase!==job.phase&&job.phase==='active')))root.dispatchEvent(new win.CustomEvent('sma:website-setup-changed',{bubbles:true}));
  }catch(error){
   if(destroyed||seq!==generation)return;
   address.textContent='';address.hidden=true;status.textContent=errors[error.code]||'Der Status konnte nicht geladen werden. Die Einrichtung läuft serverseitig weiter.';
   button.textContent='Status erneut laden';button.disabled=!!errors[error.code]&&error.code!=='SETUP_UNAVAILABLE';job=null;
  }finally{if(seq===generation)busy=false;}
 }
 button.addEventListener('click',()=>load(button.textContent==='Status erneut laden'?'get':job?.blocked?'retry':'start'));
 const focus=()=>load();win.addEventListener('focus',focus);
 load();
 return {load,invalidate,destroy(){destroyed=true;invalidate();win.removeEventListener('focus',focus);root.replaceChildren();}};
}
