import {readCompanyState,companyAddress} from './company-profile-model.mjs?v=1';
export function mountCompanyProfileDashboard({doc,request,getOwnerId,expectedOwnerId,ownerWindow=doc.defaultView,stylesheetUrl}){
 const targets=[doc.querySelector('[data-company-profile-dashboard]'),doc.getElementById('page-settings')].filter(Boolean);
 if(!targets.length)return {destroy(){}};
 const css=doc.createElement('link');css.rel='stylesheet';css.href=stylesheetUrl;doc.head.append(css);
 const panels=targets.map(target=>{const p=doc.createElement('section');p.className='company-profile-overview';p.setAttribute('aria-label','Zentrale Firmendaten');
  p.innerHTML='<h2>Firmendaten</h2><p data-company-summary>Firmendaten werden geladen …</p><a href="https://sma-automation.com/app/company-profile.html" target="_top">Firmendaten bearbeiten →</a>';
  target.append(p);return p;
 });
 let busy=false,disposed=false,generation=0;
 const set=text=>{for(const p of panels)p.querySelector('[data-company-summary]').textContent=text;};
 async function load(){if(busy||disposed)return;busy=true;const current=generation;
  try{if(await getOwnerId()!==expectedOwnerId)throw Error('owner');const result=await request('get',{});
   if(disposed||current!==generation)return;if(await getOwnerId()!==expectedOwnerId)throw Error('owner');
   const {profile}=readCompanyState(result);set(profile?[profile.company_name,companyAddress(profile),[profile.public_email,profile.phone].filter(Boolean).join(' · ')].filter(Boolean).join('\n'):'Firmenname, Firmensitz und Kontaktdaten einmal erfassen. Dashboard und Webseitenentwurf übernehmen diese Angaben.');
  }catch{if(!disposed&&current===generation)set('Firmendaten konnten nicht geladen werden. Öffne die Bearbeitung, um deinen Stand zu prüfen.');}
  finally{busy=false;}
 }
 const refresh=()=>{if(ownerWindow.document.visibilityState!=='hidden')load();};
 ownerWindow.addEventListener('focus',refresh);ownerWindow.document.addEventListener('visibilitychange',refresh);
 const observer=new doc.defaultView.MutationObserver(()=>load());for(const target of targets){const page=target.closest('[id^="page-"]');if(page)observer.observe(page,{attributes:true,attributeFilter:['class']});}
 load();return {destroy(){disposed=true;generation++;observer.disconnect();ownerWindow.removeEventListener('focus',refresh);ownerWindow.document.removeEventListener('visibilitychange',refresh);for(const p of panels){p.textContent='';p.remove();}css.remove();}};
}
