import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {contentLimits} from '../app/assets/customer-website-model.mjs';
import {renderCustomerWebsite} from '../app/assets/customer-website-render.mjs';
import {mountCustomerWebsiteEditor} from '../app/assets/customer-website-editor.mjs';
const content={...Object.fromEntries(Object.keys(contentLimits).map(k=>[k,''])),name:'SHK Fixture',headline:'Wasser. Wärme. Wohlfühlen.',about:'<img src=x onerror=alert(1)>',service_1_title:'Sanitär',service_1_text:'Bad und Wasser.'};
{
 const {document}=parseHTML('<html><body><main id="site"></main></body></html>'),root=document.getElementById('site');
 const view=renderCustomerWebsite({root,content,shopURL:'https://evil.example'});
 assert.equal(root.querySelectorAll('.service').length,1);assert.equal(root.querySelector('[data-about]').textContent,content.about);assert.equal(root.querySelector('[data-about] img'),null);
 assert.equal(root.querySelector('#produkte').hidden,true);assert.equal(root.querySelector('[data-email]').hidden,true);
 assert.equal(root.querySelector('[data-legal]').hidden,true);view.destroy();assert.equal(root.children.length,0);
}
{
 const html=await readFile(new URL('../app/website-builder.html',import.meta.url),'utf8');const {document,window}=parseHTML(html);window.confirm=()=>true;
 const id='ab660000-0000-4000-8000-000000000061';let calls=[],revision=1,published=false;
 const request=async(action,input)=>{calls.push({action,input});if(action!=='get')revision++;if(action==='publish')published=true;return {ok:true,site_id:id,revision,content,published,publicly_available:published,has_changes:!published,can_edit:true,shop_url:null,website_url:'https://sma-automation.com/app/website.html?site='+id};};
 const view=mountCustomerWebsiteEditor({doc:document,request,getOwnerId:async()=>id,uuid:()=>id});await view.load();
 assert.equal(document.getElementById('editor').hidden,false);assert.equal(document.getElementById('publicLink').hidden,true);
 assert.equal(document.querySelector('[name="about"]').value,content.about);
 document.querySelector('[name="headline"]').value='Bearbeitet';document.getElementById('contentForm').dispatchEvent(new window.Event('input',{bubbles:true}));
 assert.equal(document.getElementById('publish').disabled,true,'unsaved content cannot be published');
 document.getElementById('contentForm').dispatchEvent(new window.Event('submit',{cancelable:true}));await new Promise(r=>setImmediate(r));
 assert.equal(calls.at(-1).action,'save');assert.equal(calls.at(-1).input.content.headline,'Bearbeitet');assert(!calls.some(c=>c.action==='publish'));
 assert.equal(document.getElementById('publish').disabled,false);document.getElementById('publish').click();await new Promise(r=>setImmediate(r));
 assert.equal(calls.at(-1).action,'publish');assert.equal(document.getElementById('publicLink').hidden,false);
 view.invalidate();assert.equal(document.getElementById('editor').hidden,true);assert.equal(document.querySelector('[name="about"]').value,'');view.destroy();
}
console.log('Customer website DOM checks passed: text-only rendering, service visibility, private draft, explicit publish and account clearing');
