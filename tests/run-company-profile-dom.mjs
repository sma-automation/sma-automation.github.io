import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {emptyCompanyProfile,companyFields} from '../app/assets/company-profile-model.mjs';
import {mountCompanyProfileEditor} from '../app/assets/company-profile-editor.mjs';
import {mountCompanyProfileDashboard} from '../app/assets/company-profile-dashboard.mjs';
import {mountCustomerWebsiteEditor} from '../app/assets/customer-website-editor.mjs';
import {renderCustomerWebsite} from '../app/assets/customer-website-render.mjs';
import {contentLimits} from '../app/assets/customer-website-model.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
const id='ab770000-0000-4000-8000-000000000071';
const profile={...emptyCompanyProfile(),company_name:'SHK Fixture GmbH',street:'Musterstraße',house_number:'12',postal_code:'1010',city:'Wien',country:'Österreich',public_email:'office@example.com',contact_person:'<img src=x onerror=alert(1)>'};
const response={ok:true,profile,revision:1,can_edit:true,suggested:null};
const content={...Object.fromEntries(Object.keys(contentLimits).map(k=>[k,''])),name:profile.company_name,headline:'Wasser. Wärme. Wohlfühlen.'};
{
 const {document:doc,window}=parseHTML(await readFile(new URL('../app/company-profile.html',import.meta.url),'utf8'));window.confirm=()=>true;const calls=[];
 const view=mountCompanyProfileEditor({doc,getOwnerId:async()=>id,uuid:()=>id,request:async(action,input)=>{calls.push({action,input});return action==='save'?{...response,profile:input.profile,revision:2}:response;}});await view.load();
 assert.equal(doc.querySelectorAll('input,textarea').length,16);assert.equal(doc.querySelector('[data-profile-group="address"]').children.length,5);
 for(const key of Object.keys(companyFields))assert.equal(doc.querySelector('[name="'+key+'"]').value,profile[key]);
 doc.querySelector('[name="city"]').value=' Graz ';doc.getElementById('profileForm').dispatchEvent(new window.Event('input',{bubbles:true}));
 assert.equal(doc.getElementById('profileBadge').textContent,'Ungespeichert');
 doc.getElementById('profileForm').dispatchEvent(new window.Event('submit',{cancelable:true}));await tick();
 assert.equal(calls.at(-1).action,'save');assert.equal(calls.at(-1).input.profile.city,'Graz');assert.equal(calls.at(-1).input.expected_revision,1);
 assert.equal(doc.getElementById('profileBadge').textContent,'Gespeichert');assert(!calls.some(c=>c.action==='publish'));
 view.invalidate();assert.equal(doc.getElementById('profileForm').hidden,true);assert.equal(doc.querySelector('[name="city"]').value,'');view.destroy();
}
{
 const {document:doc}=parseHTML('<html><head></head><body><div id="page-website"><div data-company-profile-dashboard></div></div><div id="page-settings"></div></body></html>');let owner=id,calls=0;
 const view=mountCompanyProfileDashboard({doc,expectedOwnerId:id,getOwnerId:async()=>owner,request:async()=>{calls++;return response;},stylesheetUrl:'./company.css'});await tick();
 assert.equal(doc.querySelectorAll('.company-profile-overview').length,2);for(const p of doc.querySelectorAll('[data-company-summary]'))assert.match(p.textContent,/SHK Fixture GmbH\nMusterstraße 12\n1010 Wien/);
 owner='other';doc.defaultView.dispatchEvent(new doc.defaultView.Event('focus'));await tick();assert.equal(calls,1,'wrong owner never sends profile request');assert(!doc.body.textContent.includes('SHK Fixture GmbH'));
 view.destroy();assert.equal(doc.querySelectorAll('.company-profile-overview').length,0);
}
{
 const {document:doc}=parseHTML('<html><head></head><body><div data-company-profile-dashboard></div></body></html>');let release;
 const view=mountCompanyProfileDashboard({doc,expectedOwnerId:id,getOwnerId:async()=>id,request:()=>new Promise(r=>release=r),stylesheetUrl:'./company.css'});await tick();view.destroy();release(response);await tick();assert(!doc.body.textContent.includes(profile.company_name));
}
{
 const {document:doc,window}=parseHTML(await readFile(new URL('../app/website-builder.html',import.meta.url),'utf8'));let calls=0;
 const state={ok:true,site_id:id,revision:1,content,company_profile:profile,company_revision:1,published:false,publicly_available:false,has_changes:true,can_edit:true,shop_url:null,website_url:'https://sma-automation.com/app/website.html?site='+id};
 const view=mountCustomerWebsiteEditor({doc,getOwnerId:async()=>id,uuid:()=>id,request:async()=>{calls++;return state;}});await view.load();
 for(const key of ['name','contact_email','contact_phone','contact_address'])assert.equal(doc.querySelector('[name="'+key+'"]').readOnly,true);
 doc.querySelector('[name="headline"]').value='Mein eigener Text';doc.getElementById('contentForm').dispatchEvent(new window.Event('input',{bubbles:true}));await view.refresh();assert.equal(calls,1);assert.equal(doc.querySelector('[name="headline"]').value,'Mein eigener Text');view.destroy();
}
{
 const {document:doc}=parseHTML('<html><body><main></main></body></html>'),root=doc.querySelector('main');const view=renderCustomerWebsite({root,content,company:profile,shopURL:null});
 assert.equal(root.querySelector('[data-company-facts]').hidden,false);assert(root.querySelector('.contact-list').textContent.includes(profile.contact_person));assert.equal(root.querySelector('.contact-list img'),null);
 assert(root.querySelector('[data-company-facts]').textContent.includes('Musterstraße 12\n1010 Wien\nÖsterreich'));assert(!root.querySelector('[data-company-facts]').textContent.includes('Registergericht'));view.destroy();
}
console.log('Company profile DOM checks passed: 16 editable fields, save, dashboard reuse, account clearing, shared website fields, safe rendering');
