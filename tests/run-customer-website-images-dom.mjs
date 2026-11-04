import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {contentLimits} from '../app/assets/customer-website-model.mjs';
import {mountCustomerWebsiteEditor} from '../app/assets/customer-website-editor.mjs';
import {mountWebsiteImageFields} from '../app/assets/customer-website-images.mjs';
import {renderCustomerWebsite} from '../app/assets/customer-website-render.mjs';
import {mountCustomerWebsitePage} from '../app/assets/customer-website-view.mjs';
const id='ab660000-0000-4000-8000-000000000061',other='ab660000-0000-4000-8000-000000000062';
const html=await readFile(new URL('../app/website-builder.html',import.meta.url),'utf8'),pageHTML=await readFile(new URL('../app/website.html',import.meta.url),'utf8');
const content={...Object.fromEntries(Object.keys(contentLimits).map(k=>[k,''])),name:'Bild-Testbetrieb',headline:'Privater Bildtest',about:'Gespeicherter Text'};
const blob=new Blob([await readFile(new URL('./fixtures/website-images/logo.png',import.meta.url))],{type:'image/png'});
const tick=()=>new Promise(r=>setImmediate(r)),deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
let passed=0;const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
const select=(doc,kind)=>{const input=doc.getElementById(kind+'ImageFile');input.files=[blob];return input.onchange();};
function fixture(options={}){
 const {document:doc,window}=parseHTML(html);window.confirm=()=>true;let owner=id;
 let saved={ok:true,site_id:id,revision:1,content:{...content},published:false,publicly_available:false,has_changes:true,can_edit:true,shop_url:null,website_url:'https://sma-automation.com/app/website.html?site='+id};
 const calls=[],uploads=[],prepare=options.prepare||(async()=>blob);
 const request=async(action,input)=>{calls.push({action,input});if(action==='save')saved={...saved,content:input.content,revision:saved.revision+1};return saved;};
 const editor=mountCustomerWebsiteEditor({doc,request,getOwnerId:async()=>owner,uuid:()=>id,prepareImage:prepare,uploadImage:async(...args)=>{uploads.push(args);return options.upload?options.upload(...args):{id:args[1]};},imageRequest:async()=>blob});
 return {doc,window,editor,calls,uploads,get saved(){return saved;},set owner(v){owner=v;},submit(){doc.getElementById('contentForm').dispatchEvent(new window.Event('submit',{cancelable:true}));return tick();}};
}
await test('select and normalize, preserve unsaved text, save and reload privately',async()=>{
 const f=fixture();await f.editor.load();const about=f.doc.querySelector('[name="about"]');about.value='Noch ungespeicherter Text';about.dispatchEvent(new f.window.Event('input',{bubbles:true}));
 await select(f.doc,'hero');assert.equal(f.uploads[0][3],id);assert.equal(f.doc.querySelector('[name="hero"]').value,'image');assert.equal(about.value,'Noch ungespeicherter Text');assert.equal(f.doc.getElementById('publish').disabled,true);assert.equal(f.calls.length,1);
 await f.submit();assert.equal(f.saved.content.hero_image_id,id);assert.equal(f.saved.content.about,about.value);await f.editor.load();await tick();assert.equal(f.doc.querySelector('[name="hero_image_id"]').value,id);assert(!f.doc.getElementById('heroImagePreview').hidden);assert(!f.calls.some(c=>c.action==='publish'));f.editor.destroy();
});
await test('removing a hero resets its mode and alt text only on an explicit save',async()=>{
 const f=fixture();await f.editor.load();await select(f.doc,'hero');await f.submit();f.doc.querySelector('[name="hero_image_alt"]').value='Test';f.doc.getElementById('heroImageRemove').click();assert.equal(f.saved.content.hero_image_id,id);assert.equal(f.doc.querySelector('[name="hero"]').value,'shk');assert.equal(f.doc.querySelector('[name="hero_image_alt"]').value,'');await f.submit();assert.equal(f.saved.content.hero_image_id,'');f.editor.destroy();
});
await test('pending uploads lock save/publication and cannot overwrite a new account',async()=>{
 const delayed=deferred(),f=fixture({upload:()=>delayed.promise});await f.editor.load();const selecting=select(f.doc,'logo');await tick();assert.equal(f.doc.getElementById('save').disabled,true);assert.equal(f.doc.getElementById('publish').disabled,true);await f.submit();assert.equal(f.calls.length,1);
 f.owner=other;f.editor.invalidate();delayed.resolve({id});await selecting;assert.equal(f.doc.getElementById('editor').hidden,true);assert.equal(f.doc.querySelector('[name="logo_image_id"]').value,'');assert.equal(f.doc.getElementById('logoImagePreview').getAttribute('src'),null);f.editor.destroy();
});
await test('an account change during image preparation sends no upload',async()=>{
 const delayed=deferred(),f=fixture({prepare:()=>delayed.promise});await f.editor.load();const selecting=select(f.doc,'logo');await tick();f.owner=other;delayed.resolve(blob);await selecting;assert.equal(f.uploads.length,0);assert.equal(f.doc.querySelector('[name="logo_image_id"]').value,'');f.editor.destroy();
});
await test('a failed replacement retains the previously selected image',async()=>{
 let fail=false;const f=fixture({upload:async()=>{if(fail)throw Error('offline');return {id};}});await f.editor.load();await select(f.doc,'logo');await f.submit();fail=true;await select(f.doc,'logo');assert.equal(f.doc.querySelector('[name="logo_image_id"]').value,id);assert.match(f.doc.getElementById('logoImageStatus').textContent,/bisherige Auswahl/);f.editor.destroy();
});
await test('a late thumbnail cannot revive a removed image',async()=>{
 const {document:doc}=parseHTML(html),delayed=deferred(),made=[],revoked=[];doc.querySelector('[name="logo_image_id"]').value=id;
 const fields=mountWebsiteImageFields({doc,request:()=>delayed.promise,getOwnerId:async()=>id,canEdit:()=>true,onDirty(){},onBusy(){},makeURL:()=>{made.push('blob:test');return 'blob:test';},revokeURL:v=>revoked.push(v)});fields.load({logo_image_id:id});await tick();doc.getElementById('logoImageRemove').click();delayed.resolve(blob);await tick();assert.deepEqual(made,[]);assert(doc.getElementById('logoImagePreview').hidden);fields.destroy();assert.deepEqual(revoked,[]);
});
await test('invalidation while an owner check is pending prevents thumbnail reattachment',async()=>{
 const {document:doc}=parseHTML(html),delayed=deferred(),made=[];let checks=0;doc.querySelector('[name="logo_image_id"]').value=id;
 const fields=mountWebsiteImageFields({doc,request:async()=>blob,getOwnerId:()=>++checks===1?Promise.resolve(id):delayed.promise,canEdit:()=>true,onDirty(){},onBusy(){},makeURL:()=>{made.push('blob:test');return 'blob:test';}});fields.load({logo_image_id:id});await tick();fields.clear();delayed.resolve(id);await tick();assert.deepEqual(made,[]);fields.destroy();
});
await test('renderer uses safe blob URLs, alt text and revokes both image copies',async()=>{
 const {document:doc}=parseHTML('<main></main>'),root=doc.querySelector('main'),revoked=[],requests=[];
 const view=renderCustomerWebsite({root,content:{...content,logo_image_id:id,hero_image_id:other,hero:'image',hero_image_alt:'<script>keine Ausführung</script>'},imageRequest:async(id,signal)=>{requests.push({id,signal});return blob;},makeURL:()=>`blob:test-${requests.length}-${Math.random()}`,revokeURL:url=>revoked.push(url)});await tick();const images=[...root.querySelectorAll('img')];assert.equal(images.length,2);for(const image of images){assert.match(image.src,/^blob:/);image.onload();assert.equal(image.hidden,false);}assert.equal(root.querySelector('script'),null);assert.equal(images[1].alt,'<script>keine Ausführung</script>');assert(root.querySelector('.brand-mark').hidden);view.destroy();assert.equal(revoked.length,2);assert(requests.every(r=>r.signal.aborted));assert.equal(root.children.length,0);
});
await test('destroyed renderer ignores late images and keeps no object URL',async()=>{
 const {document:doc}=parseHTML('<main></main>'),delayed=deferred(),made=[];const view=renderCustomerWebsite({root:doc.querySelector('main'),content:{...content,logo_image_id:id},imageRequest:()=>delayed.promise,makeURL:()=>made.push('blob:test')});await tick();view.destroy();delayed.resolve(blob);await tick();assert.deepEqual(made,[]);
});
await test('public images carry the published site ID; private previews require the owner session',async()=>{
 for(const preview of [true,false]){const {document:doc}=parseHTML(pageHTML),calls=[];const page=mountCustomerWebsitePage({doc,search:preview?'?preview=1':'?site='+id,getOwnerId:async()=>id,watchOwner:async()=>({unsubscribe(){}}),customerWebsiteRequest:async()=>({ok:true,site_id:id,revision:1,content,published:false,publicly_available:false,has_changes:true,can_edit:true,shop_url:null,website_url:'https://sma-automation.com/app/website.html?site='+id}),publicWebsiteRequest:async()=>({ok:true,site_id:id,content}),websiteImageRequest:async(...args)=>calls.push(args),renderWebsite:options=>{options.imageRequest(other);return {destroy(){}};}});await page.load();assert.equal(calls[0][0],other);assert.equal(calls[0][1],preview?null:id);page.destroy();}
});
console.log(`Customer website images: ${passed} DOM scenarios passed.`);
