const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const [mobile,dom]=[import('../app/assets/dashboard-mobile-nav.mjs'),
 import('./dom-runtime/node_modules/linkedom/esm/index.js')];
async function fixture({existing=false,visible=['overview','files','history','shop','search']}={}){
 const {parseHTML}=await dom;
 const {document:doc}=parseHTML('<html><head></head><body><header>Dashboard</header>'+
  (existing?'<nav class="mobile-nav">Bestehende Leiste</nav>':'')+
  '<main><div id="content">Kundeninhalt</div></main></body></html>');
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
 assert.match(html,/dashboardChapters\?\.controllers\.get\('publishing'\)\?\.select\('files'\)/);
 assert.match(html,/dashboardQuickFind\.show\(\)/);
 assert.match(html,/dashboardMobileNav\?\.destroy\(\)/);
 assert.doesNotMatch(module,/\bfetch\(|XMLHttpRequest|\.rpc\(|location\.assign|window\.open|localStorage|sessionStorage/);
 assert.match(module,/nav\.mobile-nav,\[data-mobile-navigation\]/);
});
