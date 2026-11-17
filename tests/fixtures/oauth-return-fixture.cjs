'use strict';

// Synthetic markup only. No private renderer export, signed link or credential.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const platforms=['YouTube','TikTok','Instagram','Facebook'];
const origin='https://sma-automation.com';
const endpoint='https://johnmusic.app.n8n.cloud/webhook/synthetic-dashboard-read';
const owner='oauth-fixture-owner-a',otherOwner='oauth-fixture-owner-b';
const customer='oauth-fixture-customer-a',otherCustomer='oauth-fixture-customer-b';

function shell({customerId=customer,connected=[],revision='initial'}={}){
 const card=(platform,social)=>'<article class="platform-card'+(connected.includes(platform)?' connected':'')+'" data-sma-platform="'+platform+'" data-fixture-revision="'+revision+'">'+
  '<div class="platform-info"><strong>'+platform+'</strong><span class="status-label">'+(connected.includes(platform)?'Verbunden':'Nicht verbunden')+'</span></div>'+
  (social?'<div class="platform-action"><a href="'+origin+'/synthetic-connect/'+platform.toLowerCase()+'" target="_blank" rel="noopener"><span>'+platform+' verbinden</span></a></div>':
   '<button type="button" class="sma-optimize" data-portal="'+platform.toLowerCase()+'">'+platform+' optimieren</button>')+'</article>';
 return '<!doctype html><html lang="de"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Synthetic OAuth return</title>'+
  '<style>[hidden]{display:none!important}.page{display:none}.page.active{display:block}.platform-card{padding:8px}.platform-action{display:flex;gap:8px}.sma-oauth-status{padding:12px}button,a{min-height:32px}</style></head><body>'+
  '<div class="app" data-sma-customer-id="'+customerId+'"><nav><button data-page="publishing">Veröffentlichung</button><button data-page="social">Verbindungen</button></nav>'+
  '<label>Lokale Eingabe<input id="unsaved" value="Noch nicht gespeicherter Text"></label><span data-sma-social-count>'+connected.length+'</span><main>'+
  '<section class="page active" id="page-publishing"><div class="page-head"><h1>Veröffentlichung</h1></div><div class="card"><div class="platform-list">'+platforms.map(p=>card(p,false)).join('')+'</div></div>'+
  '<div class="page-head"><h1>Dateien</h1></div><div id="publishingFilesSlot">Gespeicherte Dateien</div></section>'+
  '<section class="page" id="page-social"><div class="platform-list">'+platforms.map(p=>card(p,true)).join('')+'</div></section></main></div></body></html>';
}

function dashboardReadSource(){
 const html=fs.readFileSync(path.join(root,'app/dashboard.html'),'utf8');
 const start=html.indexOf('function connectionError('),end=html.indexOf('async function load(){',start);
 if(start<0||end<=start)throw Error('The real dashboard read wrapper was not found');
 const source=html.slice(start,end);
 if(!source.includes('window.smaDashboardResponse=')||!source.includes('async function dashboardHtml('))throw Error('Dashboard wrapper extraction is incomplete');
 return source;
}

function controlledClock(initial=1_800_000_000_000){
 let clock=initial,serial=0;
 const timers=new Map(),callbacks=new Map();
 return {
  now:()=>clock,timers,callbacks,
  setTimeout(fn,ms=0){const id=++serial;timers.set(id,{at:clock+Number(ms),fn});callbacks.set(id,fn);return id;},
  clearTimeout(id){timers.delete(id);},
  async advance(ms,settle=async()=>{}){
   const target=clock+ms;let steps=0;
   for(;;){
    const next=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
    if(!next)break;if(++steps>100)throw Error('Unexpected timer polling loop');
    clock=next[1].at;timers.delete(next[0]);next[1].fn();await settle();
   }
   clock=target;await settle();
  }
 };
}

module.exports={root,platforms,origin,endpoint,owner,otherOwner,customer,otherCustomer,shell,dashboardReadSource,controlledClock};
