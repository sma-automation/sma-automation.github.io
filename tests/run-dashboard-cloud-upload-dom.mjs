import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {mountDashboardCloudUpload} from '../app/assets/dashboard-cloud-upload.mjs';

let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
function fixture({lang='de',withLanguage=true,fail=false}={}){
 const html=`<html lang="${lang}"><head></head><body>
 <header class="topbar"><div class="topbar-title">SMA Dashboard</div>
 <div class="topbar-actions"><span id="profileName">Profilname</span><button id="smaPackage">SMA Paket</button>${withLanguage?'<select id="languageSwitcher" aria-label="Sprache"><option value="de">Deutsch</option><option value="en">English</option></select>':''}<button id="signOut">Abmelden</button></div></header>
 <nav class="workspace-navigation"><button id="fakePublishingNav">Veröffentlichung</button></nav>
 <aside class="sidebar"><button id="navigatePublishing">Veröffentlichung</button></aside>
 <main><section id="page-overview"></section><section id="page-publishing" hidden>
 <div class="platform-card"><button>Optimieren</button></div><section id="smaOptimizationPage" hidden></section></section></main>
 </body></html>`;
 const {document:doc,window}=parseHTML(html),clicked=[];
 const sidebar=doc.getElementById('navigatePublishing');
 sidebar.addEventListener('click',()=>{clicked.push('navigation');doc.getElementById('page-publishing').hidden=false;});
 const controller=mountDashboardCloudUpload({doc,stylesheetUrl:'/cloud-upload.css',onPortal:(portal,button)=>{
  sidebar.click();
  if(fail)return false;
  clicked.push(portal);
  assert.equal(button.id,'smaDashboardCloudUpload');
  assert.equal(doc.getElementById('page-publishing').hidden,false);
  return true;
 }});
 return {doc,window,controller,clicked,sidebar,$:selector=>doc.querySelector(selector)};
}

await test('upload cloud is directly ABOVE the original Publishing link on the left',()=>{
 const f=fixture();
 const button=f.$('#smaDashboardCloudUpload'),language=f.$('#languageSwitcher');
 assert.ok(button);assert.equal(button.nextElementSibling,f.sidebar);
 assert.equal(button.parentElement,f.sidebar.parentElement);
 assert.equal(f.$('.topbar #smaDashboardCloudUpload'),null);
 assert.equal(language.parentElement.className,'topbar-actions');
 assert.equal(button.classList.contains('sma-cloud-sidebar-upload'),true);
 assert.equal(button.closest('aside.sidebar'),f.$('aside.sidebar'),'Cloud must live inside dark sidebar');
 assert.equal(f.$('#fakePublishingNav').previousElementSibling,null,
  'The white workspace navigation must not receive the Upload button');
 assert.equal(button.querySelector('svg')?.getAttribute('viewBox'),'0 0 24 24');
 assert.equal(button.getAttribute('aria-haspopup'),'dialog');
 assert.equal(f.$('#smaDashboardCloudDialog').hidden,true);
 assert.equal(f.$('link[href="/cloud-upload.css"]')?.rel,'stylesheet');
 f.controller.destroy();
});

await test('nested sidebar list gets a valid sibling row above Publishing, never a loose button in UL',()=>{
 const {document:doc}=parseHTML('<html><head></head><body>'+
  '<header class="topbar"><select aria-label="Sprache"><option>DE</option></select></header>'+
  '<main><nav><button>Veröffentlichung</button></nav></main>'+
  '<aside class="sidebar"><ul class="menu">'+
  '<li><a href="#overview">Übersicht</a></li>'+
  '<li id="publishingRow"><a data-page="publishing">Veröffentlichung</a></li>'+
  '</ul></aside></body></html>');
 const widget=mountDashboardCloudUpload({doc,stylesheetUrl:'/cloud-upload.css',onPortal:()=>true});
 assert.ok(widget);
 const host=doc.querySelector('li.sma-cloud-sidebar-host');
 assert.ok(host);assert.equal(host.nextElementSibling,doc.getElementById('publishingRow'));
 assert.equal(host.parentElement.tagName,'UL');
 assert.equal(widget.button.parentElement,host);
 assert.equal(doc.querySelector('main #smaDashboardCloudUpload'),null);
 widget.destroy();
 assert.equal(doc.querySelector('.sma-cloud-sidebar-host'),null);
 assert.equal(doc.getElementById('publishingRow').parentElement.tagName,'UL');
});
await test('no black sidebar means no misplaced upload in the white workspace',()=>{
 const {document:doc}=parseHTML('<html><head></head><body>'+
  '<header><button>DE</button></header><nav><button>Veröffentlichung</button></nav>'+
  '<main><button>Veröffentlichung</button></main></body></html>');
 const widget=mountDashboardCloudUpload({doc,stylesheetUrl:'/cloud-upload.css',onPortal:()=>true});
 assert.equal(widget,null);
 assert.equal(doc.getElementById('smaDashboardCloudUpload'),null);
 assert.equal(doc.getElementById('smaDashboardCloudDialog'),null);
 assert.equal(doc.querySelector('link[href="/cloud-upload.css"]'),null);
});

await test('profile, package, language and sign-out appear as flat tabs without new controls',()=>{
 const f=fixture();
 const top=f.$('.topbar-actions');
 const nodes=['profileName','smaPackage','languageSwitcher','signOut'].map(id=>f.$('#'+id));
 assert.equal(top.children.length,4);
 assert.deepEqual(nodes.map(n=>n.dataset.smaAccountTab),['profile','package','language','logout']);
 assert.ok(nodes.every(n=>n.classList.contains('sma-dashboard-account-tab')));
 const packageButton=nodes[1];let clicks=0;packageButton.addEventListener('click',()=>clicks++);
 packageButton.click();assert.equal(clicks,1);
 f.controller.destroy();
 assert.ok(nodes.every(n=>!n.classList.contains('sma-dashboard-account-tab')));
 assert.equal(top.children.length,4);
});

await test('one cloud entry offers all four portals and opens existing Publishing route',()=>{
 const f=fixture();
 f.$('#smaDashboardCloudUpload').click();
 assert.equal(f.$('#smaDashboardCloudDialog').hidden,false);
 assert.equal(f.$('#smaDashboardCloudUpload').getAttribute('aria-expanded'),'true');
 assert.deepEqual([...f.doc.querySelectorAll('.sma-cloud-portal')].map(b=>b.dataset.portal),
  ['youtube','tiktok','instagram','facebook']);
 assert.match(f.$('#smaCloudInstructions').textContent,/Datei.*Inhalt und Ziel/);
 f.$('button[data-portal="instagram"]').click();
 assert.deepEqual(f.clicked,['navigation','instagram']);
 assert.equal(f.$('#smaDashboardCloudDialog').hidden,true);
 f.$('#smaDashboardCloudUpload').click();
 f.$('button[data-portal="facebook"]').click();
 assert.deepEqual(f.clicked,['navigation','instagram','navigation','facebook']);
 f.controller.destroy();
});

await test('escape, close, backdrop and failed route are reversible, never publish',()=>{
 const f=fixture({fail:true});
 const button=f.$('#smaDashboardCloudUpload'),overlay=f.$('#smaDashboardCloudDialog');
 button.click();f.$('button[data-portal="youtube"]').click();
 assert.equal(overlay.hidden,false);
 assert.match(f.$('.sma-cloud-error').textContent,/Veröffentlichung/);
 f.$('.sma-cloud-close').click();
 assert.equal(overlay.hidden,true);
 button.click();
 const e=new f.window.Event('keydown',{bubbles:true,cancelable:true});e.key='Escape';f.doc.dispatchEvent(e);
 assert.equal(overlay.hidden,true);
 button.click();overlay.dispatchEvent(new f.window.Event('click',{bubbles:true}));
 assert.equal(overlay.hidden,true);
 assert.match(f.$('.sma-cloud-no-post').textContent,/nichts automatisch veröffentlicht/);
 f.controller.destroy();
});

await test('language setting changes the chooser without altering its four actual routes',()=>{
 const f=fixture({lang:'en'});
 f.$('#smaDashboardCloudUpload').click();
 assert.equal(f.$('#smaCloudHeading').textContent,'Upload & optimize');
 assert.match(f.$('#smaCloudInstructions').textContent,/Content & goal/);
 f.$('button[data-portal="tiktok"]').click();
 assert.deepEqual(f.clicked,['navigation','tiktok']);
 f.controller.destroy();
});

await test('header without language remains usable; repeated mount and teardown are safe',()=>{
 const f=fixture({withLanguage:false});
 const button=f.$('#smaDashboardCloudUpload');
 assert.ok(button);
 assert.equal(button.parentElement.tagName,'ASIDE');
 assert.equal(button.nextElementSibling,f.sidebar);
 assert.equal(f.$('#profileName').classList.contains('sma-dashboard-account-tab'),true);
 assert.equal(f.$('#signOut').classList.contains('sma-dashboard-account-tab'),true);
 assert.equal(mountDashboardCloudUpload({doc:f.doc,onPortal:()=>true,stylesheetUrl:'/cloud-upload.css'}),null);
 assert.equal(f.doc.querySelectorAll('#smaDashboardCloudUpload').length,1);
 f.controller.destroy();
 assert.equal(f.$('#smaDashboardCloudUpload'),null);
 assert.equal(f.$('#smaDashboardCloudDialog'),null);
 assert.equal(f.$('link[href="/cloud-upload.css"]'),null);
});

await test('dashboard integration routes through existing optimization, never new upload endpoints',async()=>{
 const source=await readFile(new URL('../app/dashboard.html',import.meta.url),'utf8');
 assert.match(source,/mountDashboardCloudUpload\(/);
 assert.match(source,/nav\.click\(\);/);
 assert.match(source,/openOptimizer\(portal,trigger\)/);
 assert.match(source,/dashboardCloudUpload\?\.destroy\(\)/);
 const module=await readFile(new URL('../app/assets/dashboard-cloud-upload.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(module,/supabase\.rpc|fetch\(|\.upload\(|provider|approval_token|credit_pack/i);
 assert.match(module,/publishing\.before\(button\)/);
 assert.match(module,/styleAccountTabs\(header\)/);
 assert.match(module,/onPortal\(item\.dataset\.portal,button\)/);
});

console.log(passed+' dashboard cloud upload DOM checks passed.');
