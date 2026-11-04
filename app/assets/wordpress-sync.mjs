const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function readWordpressSync(r,attempt,website){
 if(r?.ok!==true)fail(r?.code||'UNAVAILABLE');
 if(!uuid.test(attempt)||r.attempt_id!==attempt||r.website_url!==website||!['idle','running','retry','draft','blocked'].includes(r.state)||r.can_publish!==false
  ||r.can_synchronize!==['idle','retry'].includes(r.state)||r.retry_after!==null&&(!Number.isSafeInteger(r.retry_after)||r.retry_after<0))fail('INVALID_RESPONSE');
 const done=r.state==='draft';
 if(done?(!Number.isSafeInteger(r.post_id)||r.post_id<1||!Number.isSafeInteger(r.revision)||r.revision<1||r.edit_url!==website+'wp-admin/post.php?post='+r.post_id+'&action=edit'||typeof r.completed_at!=='string'||!Number.isFinite(Date.parse(r.completed_at))):(r.post_id!==null||r.revision!==null||r.edit_url!==null||r.completed_at!==null))fail('INVALID_RESPONSE');
 return {state:r.state,canSync:r.can_synchronize,editUrl:r.edit_url,completedAt:r.completed_at,error:typeof r.last_error==='string'?r.last_error:null,retryAfter:r.retry_after};
}
export function createWordpressSyncClient({request,getOwnerId}){
 let owner=null,attempt=null,website=null,epoch=0,busy=false;
 async function run(action){if(busy)fail('BUSY');busy=true;const version=epoch,a=attempt,w=website,uid=owner;
  try{if(!uid||!a||await getOwnerId()!==uid)fail('AUTH_REQUIRED');const r=await request(action,{attempt_id:a});
   if(version!==epoch||await getOwnerId()!==uid)fail('AUTH_REQUIRED');return readWordpressSync(r,a,w);
  }finally{busy=false;}
 }
 return {async load(a,w){if(busy)fail('BUSY');attempt=a;website=w;owner=await getOwnerId();return run('status');},sync:()=>run('sync'),invalidate(){epoch++;owner=null;attempt=null;website=null;}};
}
const errors={PAGE_CHANGED:'Der Produktbereich wurde in WordPress verändert oder bereits veröffentlicht. SMA überschreibt ihn nicht.',REVISION_CONFLICT:'Der WordPress-Stand wurde inzwischen geändert. Der bestehende Produktbereich bleibt erhalten.',REQUEST_CONFLICT:'Die gespeicherten Aufträge passen nicht zusammen. Der Produktbereich wurde nicht erneut angelegt.',TRANSACTION_REQUIRED:'Die WordPress-Datenbank unterstützt diesen sicheren Einrichtungsweg noch nicht.',CONTENT_FILTERED:'Eine WordPress-Erweiterung hat den Produktentwurf verändert. Bitte den bestehenden Entwurf prüfen.',NOT_CONNECTED:'Die WordPress-Freigabe ist nicht mehr gültig. Prüfe die Verbindung.',ACCESS_REVOKED:'Die freigebende Person hat in WordPress nicht mehr die nötigen Rechte.',INVALID_PROVIDER_RESULT:'Die WordPress-Antwort konnte nicht eindeutig zugeordnet werden. Bitte den bestehenden Stand prüfen.',TARGET_REJECTED:'Diese Webadresse kann nicht sicher verbunden werden.',WEBSITE_CHANGED:'Die WordPress-Webadresse hat sich geändert. Prüfe die Verbindung.',AUTH_REQUIRED:'Deine SMA-Anmeldung hat sich geändert. Lade den Bereich neu.',REQUEST_STALE:'Die gespeicherte Verbindung wurde geändert. Lade den Verbindungsstand neu.',ACCESS_INACTIVE:'Dein SMA-Zugang ist derzeit nicht aktiv.',SYNC_BUSY:'Der gespeicherte Auftrag läuft noch oder wartet kurz auf die Wiederaufnahme. Lade den Stand gleich erneut.'};
export function mountWordpressSync({root,request,getOwnerId}){
 const client=createWordpressSyncClient({request,getOwnerId});let attempt=null,website=null,state=null,busy=false,epoch=0,destroyed=false;
 root.innerHTML='<h3>Produkte mit deiner Webseite verbinden</h3><p class="sma-website-help">SMA richtet einen eigenen Produktbereich als WordPress-Entwurf ein. Produkte, Preise und Verfügbarkeit kommen beim Aufrufen aus deinem SMA-Shop.</p><div class="sma-website-actions"><button type="button" data-sync-start class="sma-website-primary" disabled>Produktbereich erzeugen</button><button type="button" data-sync-reload>Stand laden</button><a data-sync-edit target="_blank" rel="noopener noreferrer" hidden>Entwurf in WordPress öffnen ↗</a></div><p data-sync-status role="status" aria-live="polite"></p><p class="sma-website-help">Vorhandene Inhalte bleiben erhalten. Die Veröffentlichung entscheidest du anschließend in WordPress.</p>';
 const $=selector=>root.querySelector(selector);
 function controls(){$('[data-sync-start]').disabled=busy||!state?.canSync;$('[data-sync-reload]').disabled=busy||!attempt;root.setAttribute('aria-busy',String(busy));}
 function clear(){client.invalidate();state=null;$('[data-sync-edit]').hidden=true;$('[data-sync-edit]').removeAttribute('href');$('[data-sync-status]').textContent='';controls();}
 function show(s){state=s;$('[data-sync-start]').hidden=['draft','blocked'].includes(s.state);$('[data-sync-start]').textContent=s.state==='idle'?'Produktbereich erzeugen':'Einrichtung fortsetzen';
  $('[data-sync-edit]').hidden=!s.editUrl;$('[data-sync-edit]').removeAttribute('href');if(s.editUrl)$('[data-sync-edit]').href=s.editUrl;
  $('[data-sync-status]').textContent=s.state==='draft'?'Produktentwurf erfolgreich angelegt. Das Ergebnis ist in SMA gespeichert.':s.state==='running'?'Die Einrichtung läuft. Du kannst den gespeicherten Stand erneut laden.':s.state==='retry'?'Die Einrichtung konnte noch nicht bestätigt werden. „Einrichtung fortsetzen“ verwendet denselben Auftrag und vermeidet eine doppelte Seite.':s.state==='blocked'?(errors[s.error]||'Die Einrichtung wurde angehalten. Bitte den bestehenden WordPress-Stand prüfen.'):'Bereit: Erzeuge deinen Produktbereich mit einem Klick.';
 }
 async function run(fn){if(busy||destroyed)return;busy=true;const version=epoch;controls();$('[data-sync-status]').textContent='Gespeicherter Auftrag wird geprüft …';
  try{const r=await fn();if(version===epoch&&!destroyed)show(r);}
  catch(e){if(version===epoch&&!destroyed){if(['AUTH_REQUIRED','REQUEST_STALE','ACCOUNT_CHANGED','NOT_CONNECTED','ACCESS_INACTIVE'].includes(e.code))clear();$('[data-sync-status]').textContent=errors[e.code]||'Das Ergebnis konnte noch nicht geladen werden. Lade den Stand erneut; ein vorhandener Auftrag bleibt gespeichert.';}}
  finally{busy=false;if(!destroyed)controls();}
 }
 $('[data-sync-start]').onclick=()=>{if(state?.canSync)run(()=>client.sync());};$('[data-sync-reload]').onclick=()=>attempt&&run(()=>client.load(attempt,website));
 return {setConnection(s,url){epoch++;clear();attempt=s?.state==='verified'?s.attemptId:null;website=url;root.hidden=!attempt;if(attempt)run(()=>client.load(attempt,website));},invalidate(){epoch++;attempt=null;website=null;clear();root.hidden=true;},destroy(){destroyed=true;epoch++;clear();root.replaceChildren();}};
}
