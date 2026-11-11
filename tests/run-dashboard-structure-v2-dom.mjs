import assert from 'node:assert/strict';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {mountDashboardStructureV2} from '../app/assets/dashboard-structure-v2.mjs';
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS '+name);}
const names=[
 ['overview','Übersicht'],['publishing','Veröffentlichung'],['social','Social Media'],['content','Content'],
 ['music','Musikbibliothek'],['history','History'],['settings','Einstellungen'],['tutorials','Tutorials'],
 ['seller','24/7 Verkäufer'],['shop','Shop'],['assistant','Kundenassistent'],['website','Webseite & Domain']
];
function fixture(){
 const html='<html lang="de"><head></head><body><aside class="sidebar"><div class="logo" id="realSmaLogo"><svg><polygon points="0,0 8,0 12,8 8,15 0,15"/></svg>S = M = A</div><nav id="mainNav">'
 +names.map(([id,name])=>'<button data-page="'+id+'><span aria-hidden="true">◈</span> '+name+'</button>').join('')
 +'</nav></aside><header class="topbar"><div class="topbar-actions"><button id="profile">Profil</button><button id="package">SMA Paket</button><select id="lang" aria-label="Sprache"><option>DE</option></select><button id="logout">Abmelden</button><button id="smaDashboardCloudUpload">Upload</button></div></header><main><section id="page-publishing"></section></main></body></html>';
 const {document:doc}=parseHTML(html);
 const nav=doc.querySelector('#mainNav'),original=[...nav.children],cloud=doc.querySelector('#smaDashboardCloudUpload'),clicked=[];
 for(const [id] of names)nav.querySelector('[data-page="'+id+'"]').addEventListener('click',()=>clicked.push(id));
 const originalLogo=doc.getElementById('realSmaLogo').outerHTML;
 const mount=()=>mountDashboardStructureV2({doc,cloudButton:cloud,stylesheetUrl:'/nav-v2.css'});
 return {doc,nav,original,cloud,clicked,mount,originalLogo};
}
await test('existing SMA honeycomb logo is not replaced and original live clicks still work',()=>{
 const f=fixture(),controller=f.mount();
 assert.ok(controller);
 assert.equal(f.doc.getElementById('realSmaLogo').outerHTML,f.originalLogo);
 f.nav.querySelector('[data-page="publishing"]').click();
 f.nav.querySelector('[data-page="website"]').click();
 assert.deepEqual(f.clicked,['publishing','website']);
 const groups=[...f.nav.querySelectorAll('.sma-v2-sidebar-section')].map(x=>x.textContent);
 assert.deepEqual(groups,['Start','Erstellen','Verkaufen','Verwalten']);
 assert.deepEqual([...f.nav.querySelectorAll('[data-page]')].map(x=>x.dataset.page),
 ['overview','publishing','content','music','shop','seller','website','social','history','assistant','settings','tutorials']);
 controller.destroy();
 assert.equal(f.doc.getElementById('realSmaLogo').outerHTML,f.originalLogo);
 assert.deepEqual([...f.nav.querySelectorAll('[data-page]')].map(x=>x.dataset.page),names.map(x=>x[0]));
});
await test('upload is directly above Publishing at left, not next to language',()=>{
 const f=fixture(),controller=f.mount();
 const publishing=f.nav.querySelector('[data-page="publishing"]');
 assert.equal(f.cloud.nextElementSibling,publishing);
 assert.equal(f.cloud.parentElement,f.nav);
 assert.equal(f.cloud.classList.contains('sma-v2-cloud-side'),true);
 assert.equal(f.doc.querySelector('.topbar #smaDashboardCloudUpload'),null);
 for(const id of ['profile','package','lang','logout'])
  assert.equal(f.doc.getElementById(id).classList.contains('sma-v2-account-tab'),true);
 controller.destroy();
 assert.equal(f.cloud.parentElement.className,'topbar-actions');
 assert.equal(f.doc.querySelectorAll('.sma-v2-sidebar-section').length,0);
 assert.equal(f.doc.querySelector('link[href="/nav-v2.css"]'),null);
});
await test('double mounts refuse duplicate labels and all existing routes retain identity',()=>{
 const f=fixture(),controller=f.mount(),before=f.doc.querySelectorAll('.sma-v2-sidebar-section').length;
 assert.equal(f.mount(),null);
 assert.equal(f.doc.querySelectorAll('.sma-v2-sidebar-section').length,before);
 const link=f.nav.querySelector('[data-page="history"]');link.click();assert.deepEqual(f.clicked,['history']);
 controller.destroy();
});
await test('unknown sidebar format must never cause unsafe reparenting or remove the real logo',()=>{
 const f=fixture();f.nav.querySelectorAll('[data-page]').forEach((node,i)=>{if(i>2)node.remove();});
 const controller=f.mount();
 assert.ok(controller);
 assert.equal(f.doc.getElementById('realSmaLogo').outerHTML,f.originalLogo);
 assert.equal(f.nav.querySelectorAll('.sma-v2-sidebar-section').length,0);
 controller.destroy();
});
console.log(count+' compact dashboard navigation DOM checks passed.');
