import {companyFields,emptyCompanyProfile,createCompanyProfileClient} from './company-profile-model.mjs?v=1';
const messages={AUTH_REQUIRED:'Bitte melde dich bei SMA an.',ACCOUNT_CHANGED:'Die Kontozuordnung wurde geändert. Bitte lade das Dashboard neu.',ACCOUNT_UNAVAILABLE:'Dein SMA-Konto konnte nicht zugeordnet werden.',ACCESS_INACTIVE:'Dein SMA-Zugang ist derzeit nicht aktiv. Die gespeicherten Firmendaten bleiben erhalten.',INVALID_PROFILE:'Prüfe den Firmennamen, die öffentliche E-Mail-Adresse und die Textlängen.',REVISION_CONFLICT:'Die Firmendaten wurden inzwischen geändert. Lade den gespeicherten Stand, bevor du weiterarbeitest.',REQUEST_CONFLICT:'Dieser Speicherversuch enthält inzwischen andere Angaben. Lade den gespeicherten Stand.'};
export function mountCompanyProfileEditor({doc=document,request,getOwnerId,uuid}){
 const $=id=>doc.getElementById(id),client=createCompanyProfileClient({request,getOwnerId,uuid});let state=null,busy=false,dirty=false,epoch=0,destroyed=false;
 for(const [key,field] of Object.entries(companyFields)){
  const label=doc.createElement('label');label.textContent=field.label+(field.required?' *':'');const input=doc.createElement(field.multiline?'textarea':'input');
  input.name=key;input.maxLength=field.max;if(!field.multiline)input.type=field.type||'text';else input.rows=4;if(field.required)input.required=true;if(field.autocomplete)input.autocomplete=field.autocomplete;
  label.append(input);doc.querySelector('[data-profile-group="'+field.group+'"]').append(label);
 }
 function controls(){$('profileFields').disabled=busy||!state?.canEdit;$('profileSave').disabled=busy||!state?.canEdit;$('profileReload').disabled=busy;$('profileRetry').disabled=busy;doc.querySelector('main').setAttribute('aria-busy',String(busy));}
 function clear(){client.invalidate();state=null;dirty=false;$('profileForm').hidden=true;$('previousAddress').textContent='';for(const el of doc.querySelectorAll('input,textarea'))el.value='';controls();}
 function show(s){state=s;dirty=false;$('profileForm').hidden=false;$('profileRetry').hidden=true;$('profileLogin').hidden=true;$('profileBadge').textContent=s.revision?'Gespeichert':'Noch nicht gespeichert';
  const value=s.profile||{...emptyCompanyProfile(),...Object.fromEntries(Object.entries(s.suggested||{}).filter(([k])=>Object.hasOwn(companyFields,k)))};
  for(const key of Object.keys(companyFields))doc.querySelector('[name="'+key+'"]').value=value[key];
  $('previousAddress').hidden=!s.suggested?.previous_address;$('previousAddress').textContent=s.suggested?.previous_address?'Bisherige Webseitenadresse – bitte den Feldern oben zuordnen:\n'+s.suggested.previous_address:'';
  $('profileStatus').textContent=s.canEdit?(s.revision?'Firmendaten gespeichert. Dashboard und Webseitenentwurf verwenden diesen Stand.':'Ergänze deine Firmendaten. Angaben aus deinem bisherigen Webseitenentwurf sind, soweit zuordenbar, bereits vorausgefüllt.'):messages.ACCESS_INACTIVE;controls();
 }
 async function run(fn,message){if(busy||destroyed)return;busy=true;const version=epoch;controls();$('profileStatus').textContent=message;
  try{const s=await fn();if(version===epoch&&!destroyed)show(s);}
  catch(e){if(version!==epoch||destroyed)return;$('profileStatus').textContent=messages[e.code]||'Speichern oder Laden gerade nicht möglich. Deine Eingaben bleiben stehen; versuche es erneut.';$('profileRetry').hidden=false;if(['AUTH_REQUIRED','ACCOUNT_CHANGED','ACCOUNT_UNAVAILABLE'].includes(e.code)){clear();$('profileLogin').hidden=e.code!=='AUTH_REQUIRED';}}
  finally{busy=false;if(!destroyed)controls();}
 }
 const load=()=>run(()=>client.load(),'Firmendaten werden geladen …');
 $('profileForm').oninput=()=>{dirty=true;$('profileBadge').textContent='Ungespeichert';};
 $('profileForm').onsubmit=e=>{e.preventDefault();const value=Object.fromEntries(Object.keys(companyFields).map(k=>[k,doc.querySelector('[name="'+k+'"]').value.trim()]));run(()=>client.save(value),'Firmendaten werden gespeichert …');};
 $('profileReload').onclick=$('profileRetry').onclick=()=>{if(!dirty||doc.defaultView.confirm('Ungespeicherte Firmendaten verwerfen und gespeicherten Stand laden?'))load();};
 const warn=e=>{if(dirty){e.preventDefault();e.returnValue='';}};doc.defaultView.addEventListener('beforeunload',warn);
 return {load,invalidate(){epoch++;clear();$('profileStatus').textContent=messages.AUTH_REQUIRED;$('profileLogin').hidden=false;$('profileRetry').hidden=false;},destroy(){destroyed=true;epoch++;clear();doc.defaultView.removeEventListener('beforeunload',warn);}};
}
