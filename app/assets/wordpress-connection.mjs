const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function readWordpressState(r,website,now=Date.now()){
 if(r?.ok!==true)fail(typeof r?.code==='string'?r.code:'UNAVAILABLE');
 if(!['not_requested','pending','expired','stale','revoked','verified'].includes(r.state)||!Number.isSafeInteger(r.revision)||r.revision<0
  ||r.can_publish!==false||r.can_synchronize!==false||r.website_url!==undefined&&r.website_url!==website)fail('INVALID_RESPONSE');
 if(['pending','verified'].includes(r.state)&&!uuid.test(r.attempt_id))fail('INVALID_RESPONSE');
 let authorizationUrl=null;
 if(r.authorization_url!==undefined){
  const prefix=website+'wp-admin/options-general.php?page=sma-bridge&ticket=';
  if(r.state!=='pending'||typeof r.authorization_url!=='string'||!r.authorization_url.startsWith(prefix)||!/^[a-f0-9]{64}$/.test(r.authorization_url.slice(prefix.length))||!Number.isSafeInteger(r.expires_at))fail('INVALID_RESPONSE');
  if(r.expires_at*1000<=now)fail('REQUEST_STALE');authorizationUrl=r.authorization_url;
 }
 return {state:r.state,revision:r.revision,attemptId:r.attempt_id||null,authorizationUrl};
}
export function createWordpressClient({request,getOwnerId,uuid:makeId=()=>crypto.randomUUID()}){
 let owner,website,state,pending,busy=false,generation=0;
 async function call(action,input={}){
  if(busy)fail('BUSY');if(!owner||await getOwnerId()!==owner)fail('AUTH_REQUIRED');
  busy=true;const current=generation,expectedOwner=owner;
  try{
   const result=await request(action,input);
   if(current!==generation||await getOwnerId()!==expectedOwner)fail('AUTH_REQUIRED');
   state=readWordpressState(result,website);return state;
  }finally{busy=false;}
 }
 return {
  invalidate(){generation++;owner=null;state=null;pending=null;},
  async load(url){if(busy)fail('BUSY');website=url;owner=await getOwnerId();return call('status');},
  async start(){
   if(!state)fail('AUTH_REQUIRED');
   if(state.state==='pending')return call('resume',{attempt_id:state.attemptId});
   if(!pending||pending.action!=='start')pending={action:'start',expected_revision:state.revision,request_id:makeId()};
   const {action,...input}=pending;const r=await call(action,input);pending=null;return r;
  },
  verify(){if(!state?.attemptId)fail('REQUEST_STALE');return call('verify',{attempt_id:state.attemptId});},
  async revoke(){
   if(!state)fail('AUTH_REQUIRED');if(!pending||pending.action!=='revoke')pending={action:'revoke',expected_revision:state.revision,request_id:makeId()};
   const {action,...input}=pending;const r=await call(action,input);pending=null;return r;
  }
 };
}
const messages={
 AUTH_REQUIRED:'Deine Anmeldung oder die gespeicherte Webseite hat sich geändert. Lade den Bereich neu.',
 WEBSITE_REQUIRED:'Speichere zuerst die Adresse deiner WordPress-Webseite.',TARGET_REJECTED:'Verwende die öffentliche HTTPS-Startadresse deiner WordPress-Webseite mit abschließendem Schrägstrich.',
 SHOP_REQUIRED:'Für die Verbindung muss dein SMA-Shop öffentlich freigeschaltet sein.',SHOP_CHANGED:'Deine Shop-Zuordnung hat sich geändert. Starte die Verbindung neu.',
 REQUEST_STALE:'Dieser Vorgang ist abgelaufen oder die Webseite wurde geändert. Lade den Stand neu.',TICKET_UNAVAILABLE:'Die Freigabe ist nicht mehr verfügbar. Lade den Stand neu.',
 PROVIDER_UNAVAILABLE:'Der SMA-Baustein antwortet noch nicht. Prüfe seine Aktivierung und bestätige die Freigabe in WordPress.',
 VERIFICATION_BUSY:'Die Prüfung läuft bereits. Bitte warte kurz.',REQUEST_RATE_LIMITED:'Bitte warte eine Minute, bevor du eine neue Freigabe startest.',
 ACCESS_INACTIVE:'Dein SMA-Zugang ist derzeit nicht aktiv.',REVISION_CONFLICT:'Der Vorgang wurde inzwischen geändert. Lade den Stand neu.'
};
export function mountWordpressConnection({root,request,getOwnerId}){
 const doc=root.ownerDocument,client=createWordpressClient({request,getOwnerId});let website=null,ready=false,busy=false,version=0;
 root.innerHTML='<p class="sma-website-intro">Einmal in WordPress freigeben. Voraussetzung: Der SMA-Baustein ist dort aktiviert.</p><details class="sma-website-embed"><summary>SMA-Baustein für WordPress</summary><p class="sma-website-help">Der Baustein wird einmalig in WordPress eingerichtet. Dafür ist ein WordPress-Administratorzugang erforderlich.</p><a href="https://sma-automation.com/app/downloads/sma-wordpress-bridge.zip" download>WordPress-Baustein herunterladen</a></details><p data-wp-site class="sma-website-help"></p>'+
 '<div class="sma-website-actions"><button type="button" data-wp-start class="sma-website-primary" disabled>Verbindung vorbereiten</button><a data-wp-authorize target="_blank" rel="noopener noreferrer" hidden>In WordPress freigeben ↗</a><button type="button" data-wp-verify hidden>Verbindung prüfen</button><button type="button" data-wp-reload>Stand laden</button><button type="button" data-wp-revoke hidden>Verbindung trennen</button></div>'+
 '<p role="status" aria-live="polite" data-wp-status>Speichere zuerst deine WordPress-Webadresse.</p><p class="sma-website-help">Diese Freigabe veröffentlicht keine Seite. Der Produktbereich wird anschließend als Entwurf eingerichtet.</p>';
 const $=s=>root.querySelector(s),status=$('[data-wp-status]');
 function controls(){for(const b of root.querySelectorAll('button'))b.disabled=busy||!ready;$('[data-wp-reload]').disabled=busy||!website;root.setAttribute('aria-busy',String(busy));}
 function clear(){ready=false;client.invalidate();for(const name of ['authorize','verify','revoke'])$('[data-wp-'+name+']').hidden=true;$('[data-wp-authorize]').removeAttribute('href');controls();}
 function show(s){
  ready=true;$('[data-wp-start]').hidden=s.state==='verified';$('[data-wp-start]').textContent=s.state==='pending'?'Freigabe fortsetzen':'Verbindung vorbereiten';
  $('[data-wp-verify]').hidden=s.state!=='pending';$('[data-wp-revoke]').hidden=s.revision===0||s.state==='revoked';
  $('[data-wp-authorize]').hidden=!s.authorizationUrl;$('[data-wp-authorize]').removeAttribute('href');if(s.authorizationUrl)$('[data-wp-authorize]').href=s.authorizationUrl;
  status.textContent=s.state==='verified'?'WordPress-Zugriff erfolgreich geprüft. Die automatische Einrichtung des Produktentwurfs wird separat angeschlossen.':s.authorizationUrl?'Öffne „In WordPress freigeben“, bestätige dort die Verbindung und klicke anschließend hier auf „Verbindung prüfen“.':s.state==='pending'?'Eine Freigabe ist vorbereitet. Du kannst sie fortsetzen.':s.state==='revoked'?'Die SMA-Verbindung wurde getrennt. Entferne die Freigabe auch in WordPress.':'Du kannst die Verbindung jetzt vorbereiten.';
 }
 async function run(fn){if(busy)return;busy=true;const current=version;controls();status.textContent='Verbindung wird geprüft …';
  try{const s=await fn();if(current===version)show(s);}
  catch(e){if(current===version){status.textContent=messages[e.code]||'Die Verbindung ist gerade nicht erreichbar. Bitte versuche es erneut.';if(['AUTH_REQUIRED','ACCOUNT_CHANGED','ACCESS_INACTIVE'].includes(e.code))clear();}}
  finally{busy=false;controls();}
 }
 $('[data-wp-start]').onclick=()=>run(()=>client.start());$('[data-wp-verify]').onclick=()=>run(()=>client.verify());$('[data-wp-revoke]').onclick=()=>run(()=>client.revoke());
 $('[data-wp-reload]').onclick=()=>website&&run(()=>client.load(website));
 return {
  setDraft(s){version++;clear();website=s?.draft?.mode==='existing'?s.draft.website_url:null;$('[data-wp-site]').textContent=website||'';status.textContent=website?'Lade den Verbindungsstand, um fortzufahren.':'Speichere zuerst deine WordPress-Webadresse.';controls();},
  load(){if(website&&!busy)return run(()=>client.load(website));},
  invalidate(){version++;website=null;clear();status.textContent='Speichere die geänderte Webseite vor dem Verbinden.';},
  destroy(){version++;clear();root.replaceChildren();}
 };
}
