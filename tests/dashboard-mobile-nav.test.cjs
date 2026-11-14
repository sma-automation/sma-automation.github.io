const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const [mobile,dom]=[import('../app/assets/dashboard-mobile-nav.mjs'),
 import('./dom-runtime/node_modules/linkedom/esm/index.js')];
async function fixture({existing=false,initialPage=null,visible=['overview','files','history','shop','search']}={}){
 const {parseHTML}=await dom;
 const {document:doc}=parseHTML('<html><head></head><body><header>Dashboard</header>'+
  (existing?'<nav class="mobile-nav">Bestehende Leiste</nav>':'')+
  '<main><div id="content">Kundeninhalt</div>'+
  ['overview','publishing','history','shop'].map(key=>'<section id="page-'+key+'"'+(key===initialPage?' class="active"':'')+'></section>').join('')+
  '<button id="sma-publishing-tab-files" role="tab" aria-selected="false">Dateien</button>'+
  '</main></body></html>');
 const calls=[],{mountDashboardMobileNav}=await mobile;
 const view=mountDashboardMobileNav({doc,
  available:key=>visible.includes(key),
  onNavigate:key=>{calls.push('goto:'+key);return true;},
  onSearch:()=>{calls.push('search');return true;}
 });
 return {doc,view,calls,get:key=>doc.querySelector('button[data-sma-mobile-target="'+key+'"]')};
}
test('only existing customer areas appear as compact mobile shortcuts',async()=>{
 const f=await fixture();
 assert(f.view);
 assert.equal(f.doc.querySelectorAll('#smaMobileQuickNav button').length,5);
 assert.equal(f.doc.querySelector('#smaMobileQuickNav').getAttribute('aria-label'),'SMA Schnellnavigation');
 assert(f.doc.body.classList.contains('sma-mobile-quick-mounted'));
 assert.match(f.doc.querySelector('#smaMobileQuickNavCss').textContent,/max-width:700px/);
 f.get('files').click();f.get('history').click();f.get('shop').click();f.get('search').click();
 assert.deepEqual(f.calls,['goto:files','goto:history','goto:shop','search']);
 assert.equal(f.get('history').getAttribute('aria-current'),null,'The clicked destination should not remain selected after a different page was chosen');
 f.view.destroy();assert.equal(f.doc.getElementById('smaMobileQuickNav'),null);
 assert.equal(f.doc.getElementById('smaMobileQuickNavCss'),null);
 assert.equal(f.doc.body.classList.contains('sma-mobile-quick-mounted'),false);
});
const tick=()=>new Promise(r=>setImmediate(r));
test('mobile quick bar follows the actual dashboard page after sidebar or global search navigation',async()=>{
 const f=await fixture({initialPage:'overview'});
 assert.equal(f.get('overview').getAttribute('aria-current'),'page');
 f.get('history').click();
 assert.equal(f.get('overview').getAttribute('aria-current'),'page','Do not preselect History before the dashboard changes page');
 assert.equal(f.get('history').getAttribute('aria-current'),null,'History becomes active only after the original page transition');
 f.doc.getElementById('page-overview').classList.remove('active');
 f.doc.getElementById('page-history').classList.add('active');
 await tick();
 assert.equal(f.get('history').getAttribute('aria-current'),'page');
 assert.equal(f.get('overview').getAttribute('aria-current'),null);
 f.doc.getElementById('page-history').classList.remove('active');
 f.doc.getElementById('page-publishing').classList.add('active');
 f.doc.getElementById('sma-publishing-tab-files').setAttribute('aria-selected','true');
 await tick();
 assert.equal(f.get('files').getAttribute('aria-current'),'page');
 f.doc.getElementById('sma-publishing-tab-files').setAttribute('aria-selected','false');
 await tick();
 assert.equal(f.get('files').getAttribute('aria-current'),null,'Portale should not highlight Dateien');
 f.doc.getElementById('page-publishing').classList.remove('active');
 f.doc.getElementById('page-shop').classList.add('active');
 await tick();
 assert.equal(f.get('shop').getAttribute('aria-current'),'page');
 f.view.destroy();
});
test('Dateien is current only while the file gallery is visible, including browser back',async()=>{
 const f=await fixture({initialPage:'publishing'});
 const page=f.doc.getElementById('page-publishing');
 f.doc.getElementById('sma-publishing-tab-files').setAttribute('aria-selected','true');
 await tick();assert.equal(f.get('files').getAttribute('aria-current'),'page');
 page.classList.add('sma-optimizing');await tick();
 assert.equal(f.get('files').getAttribute('aria-current'),null);
 page.classList.remove('sma-optimizing');await tick();
 assert.equal(f.get('files').getAttribute('aria-current'),'page');
 f.view.destroy();
});
test('unavailable package pages are never displayed as active navigation items',async()=>{
 const f=await fixture({visible:['overview','files','search']});
 assert.equal(f.doc.querySelectorAll('#smaMobileQuickNav button').length,3);
 assert.equal(f.get('shop'),null);
 assert.equal(f.get('history'),null);
 f.get('files').click();assert.deepEqual(f.calls,['goto:files']);
 f.view.destroy();
});
test('existing mobile dashboard navigation remains untouched and is not duplicated',async()=>{
 const f=await fixture({existing:true});
 assert.equal(f.view,null);
 assert.equal(f.doc.querySelectorAll('nav.mobile-nav').length,1);
 assert.equal(f.doc.getElementById('smaMobileQuickNav'),null);
});
test('mobile navigation reuses authenticated dashboard routes, no new endpoints or posting',()=>{
 const html=readFileSync('app/dashboard.html','utf8');
 const module=readFileSync('app/assets/dashboard-mobile-nav.mjs','utf8');
 assert.match(html,/mountDashboardMobileNav/);
 assert.match(html,/dashboard-mobile-nav\.mjs\?v=3/,'Updated mobile navigation must use a fresh module URL');
 assert.match(html,/if\(!navigateDashboardArea\(key\)\)return false/);
 assert.match(html,/dashboardQuickFind\.show\(\)/);
 assert.match(html,/dashboardMobileNav\?\.destroy\(\)/);
 assert.doesNotMatch(module,/\bfetch\(|XMLHttpRequest|\.rpc\(|location\.assign|window\.open|localStorage|sessionStorage/);
 assert.match(module,/nav\.mobile-nav,\[data-mobile-navigation\]/);
 assert.match(module,/MutationObserver/);
 assert.match(module,/attributeFilter:\['class','hidden'\]/);
 assert.match(module,/observer\?\.disconnect\(\)/);
});
