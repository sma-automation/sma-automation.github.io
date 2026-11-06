import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {mountMediaEditor} from '../app/assets/media-editor-view.mjs';
import {mountMediaEditorEntry} from '../app/assets/media-editor-dashboard.mjs';
import {editorDefaults as defaults} from '../app/assets/media-editor-model.mjs';
const html=await readFile(new URL('../app/media-editor.html',import.meta.url),'utf8'),tick=()=>new Promise(r=>setImmediate(r));
const id=n=>'ab660000-0000-4000-9000-'+String(n).padStart(12,'0'),uid=id(91);
const files=[{id:id(1),name:'Example.mp4',revision:'r1',media_kind:'video',mime_type:'video/mp4',duration_ms:10000,width_px:1080,height_px:1920},{id:id(2),name:'Image.jpg',revision:'r1',media_kind:'image',mime_type:'image/jpeg',duration_ms:null,width_px:1200,height_px:800}];
const reply=(input,settings=defaults,revision=0)=>({ok:true,version:1,can_publish:false,asset_id:input.asset_id,asset_revision:input.asset_revision,revision,settings,saved_at:revision?'2026-11-06T12:00:00Z':null,changed:revision>0});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function fixture({refreshMetadata=null,request=(a,i)=>reply(i,a==='save'?i.settings:defaults,a==='save'?i.revision+1:0),listFiles=()=>({ok:true,files}),thumbnail=()=>new Blob(['fixture'])}={}){
 const {document:doc,window}=parseHTML(html);Object.defineProperty(doc,'visibilityState',{value:'visible',writable:true});
 // Linkedom lacks native select.value setters; model the selected option through attributes.
 for(const select of doc.querySelectorAll('select'))Object.defineProperty(select,'value',{get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(v){for(const o of this.querySelectorAll('option'))o.toggleAttribute('selected',o.value===v);}});
 let owner=uid,serial=100;const calls=[],urls=[],revoked=[],thumbs=[];
 const view=mountMediaEditor({doc,expectedOwnerId:uid,getOwnerId:async()=>owner,request:(a,i)=>{calls.push({a,i});return request(a,i);},listFiles,refreshMetadata,thumbnail:(f,s)=>{thumbs.push({f,s});return thumbnail(f,s);},uuid:()=>id(serial++),createURL:()=>{const url='blob:fixture-'+urls.length;urls.push(url);return url;},revokeURL:url=>revoked.push(url)});
 const $=s=>doc.querySelector(s),set=(key,value)=>{$('[name="'+key+'"]').value=value;$('[name="'+key+'"]').dispatchEvent(new window.Event('input',{bubbles:true}));};
 return {doc,window,view,$,calls,urls,revoked,thumbs,set,owner(v,notify=true){owner=v;if(notify)view.invalidateOwner(v);},save(){$('#editorForm').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));},choose(n){$('#asset').value=files[n].id;$('#asset').dispatchEvent(new window.Event('change'));},tab(name){[...doc.querySelectorAll('[role=tab]')].find(t=>t.textContent===name).click();},visibility(value){doc.visibilityState=value;doc.dispatchEvent(new window.Event('visibilitychange'));}};
}
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
const leave=f=>{const event=new f.window.Event('beforeunload',{cancelable:true});f.window.dispatchEvent(event);return event;};
await test('leaving warns only for unsaved edits and retains them until a save response confirms success',async()=>{
 const gate=deferred();let pending;
 const f=fixture({request:(a,i)=>{if(a==='get')return reply(i);pending=i;return gate.promise;}});await tick();
 assert.equal(leave(f).defaultPrevented,false);f.tab('Text');assert.equal(leave(f).defaultPrevented,false);f.set('overlay_text','Keep this edit');
 for(let n=0;n<2;n++){const event=leave(f);assert.equal(event.defaultPrevented,true);assert.equal(event.returnValue,true);assert.equal(f.$('[name=overlay_text]').value,'Keep this edit');}
 assert.deepEqual(f.calls.map(x=>x.a),['get']);f.save();await tick();assert.equal(leave(f).defaultPrevented,true);
 gate.resolve(reply(pending,pending.settings,1));await tick();assert.equal(leave(f).defaultPrevented,false);assert.equal(f.$('[name=overlay_text]').value,'Keep this edit');f.view.destroy();
});
await test('invalid settings, failed saves and revision conflicts keep the navigation warning active',async()=>{
 for(const failure of ['offline','conflict','invalid']){
  const f=fixture({request:(a,i)=>{if(a==='get')return reply(i);if(failure==='offline')throw Error('offline');return {ok:false,code:'REVISION_CONFLICT'};}});await tick();
  f.set('overlay_text',failure==='invalid'?'x'.repeat(161):'Keep my changes');f.save();await tick();
  assert.equal(leave(f).defaultPrevented,true);assert.equal(f.$('[name=overlay_text]').value,failure==='invalid'?'x'.repeat(161):'Keep my changes');
  assert.equal(f.calls.filter(c=>c.a==='save').length,failure==='invalid'?0:1);f.view.destroy();assert.equal(leave(f).defaultPrevented,false);
 }
});
await test('keeping edits retains the warning; explicit discard, owner loss and teardown remove it',async()=>{
 for(const end of ['discard','owner','destroy']){
  const f=fixture();await tick();f.set('format','9:16');f.$('#reload').click();f.$('#keepEditing').click();assert.equal(leave(f).defaultPrevented,true);
  if(end==='discard'){f.$('#reload').click();f.$('#confirmDiscard').click();await tick();assert.equal(f.$('[name=format]').value,'original');}
  if(end==='owner')f.owner('other');if(end==='destroy')f.view.destroy();
  assert.equal(leave(f).defaultPrevented,false);f.view.destroy();
 }
});
await test('music edits and metadata refresh preserve the warning without saving the recipe',async()=>{
 const music={name:'Test.wav',sha256:'a'.repeat(64),size_bytes:16,mime_type:'audio/wav',volume:25,start_ms:0};
 const f=fixture({request:(a,i)=>reply(i,{...defaults,music},1),refreshMetadata:()=>({ok:true,files})});await tick();
 assert.equal(leave(f).defaultPrevented,false);f.$('#musicVolume').value='38';f.$('#musicVolume').dispatchEvent(new f.window.Event('input',{bubbles:true}));assert.equal(leave(f).defaultPrevented,true);
 f.$('#refreshMetadata').click();await tick();f.visibility('hidden');assert.equal(leave(f).defaultPrevented,true);f.visibility('visible');await tick();
 assert.equal(leave(f).defaultPrevented,true);assert.deepEqual(f.calls.map(c=>c.a),['get']);f.view.destroy();assert.equal(leave(f).defaultPrevented,false);
});
await test('opening is read-only and exact chapter switching retains unsaved settings and safe preview text',async()=>{
 const f=fixture();await tick();assert.deepEqual(f.calls.map(c=>c.a),['get']);assert.equal(f.$('#editor').hidden,false);assert.equal(f.$('#image').hidden,false);
 f.set('format','9:16');f.set('fit','cover');f.set('position_x','75');f.tab('Text');f.set('overlay_text','<img src=x onerror=bad()>');f.tab('Format & Ausschnitt');
 assert.equal(f.$('[name=format]').value,'9:16');assert.equal(f.$('#image').style.objectFit,'cover');assert.equal(f.$('#image').style.objectPosition,'75% 50%');assert.equal(f.$('#overlay img'),null);assert.match(f.$('#overlay').textContent,/<img/);assert.equal(f.calls.length,1);
 f.save();await tick();assert.equal(f.calls.at(-1).a,'save');assert.equal(f.calls.at(-1).i.revision,0);assert.equal(f.calls.at(-1).i.settings.position_x,75);assert.match(f.$('#status').textContent,/Entwurf gespeichert/);f.view.destroy();assert.deepEqual(f.revoked,f.urls);
});
await test('video timing converts seconds to milliseconds, validates ranges and saves muted original audio',async()=>{
 const f=fixture();await tick();f.tab('Schnitt & Cover');f.set('start_ms','1.125');f.set('end_ms','9.5');f.set('cover_ms','9.6');f.save();await tick();assert.equal(f.calls.length,1);assert.match(f.$('#status').textContent,/prüfe/);
 f.set('cover_ms','2.005');f.tab('Ton');f.set('audio_volume','0');f.save();await tick();assert.deepEqual([f.calls[1].i.settings.start_ms,f.calls[1].i.settings.end_ms,f.calls[1].i.settings.cover_ms,f.calls[1].i.settings.audio_volume],[1125,9500,2005,0]);f.view.destroy();
});
await test('file switching protects unsaved values; discard is explicit; image and unknown-duration controls stay unavailable',async()=>{
 const f=fixture();await tick();f.set('overlay_text','Keep me');f.choose(1);await tick();assert.equal(f.calls.length,1);assert.equal(f.$('#asset').value,files[0].id);f.$('#reload').click();assert.equal(f.$('#discard').hidden,false);f.$('#keepEditing').click();assert.equal(f.$('[name=overlay_text]').value,'Keep me');f.$('#reload').click();f.$('#confirmDiscard').click();await tick();assert.equal(f.$('[name=overlay_text]').value,'');f.choose(1);await tick();assert.equal(f.$('[name=start_ms]').disabled,true);assert.equal(f.$('[name=audio_volume]').disabled,true);assert.ok(f.revoked.length>=2);f.view.destroy();
 const g=fixture({listFiles:()=>({ok:true,files:[{...files[0],duration_ms:null}]})});await tick();assert.equal(g.$('[name=start_ms]').disabled,true);assert.equal(g.$('[name=audio_volume]').disabled,false);g.view.destroy();
});
await test('a lost save response retries the same request ID and cannot silently replace a newer draft',async()=>{
 let saves=0;const f=fixture({request:(a,i)=>{if(a==='get')return reply(i);if(++saves===1)throw Error('offline');return {...reply(i,i.settings,1),changed:false};}});await tick();f.set('overlay_text','Once');f.save();await tick();assert.match(f.$('#status').textContent,/erneut versuchen/);f.save();await tick();assert.deepEqual(f.calls[1].i,f.calls[2].i);assert.match(f.$('#status').textContent,/kein doppelter/);f.view.destroy();
 const g=fixture({request:(a,i)=>a==='get'?reply(i):{ok:false,code:'REVISION_CONFLICT'}});await tick();g.set('overlay_text','My changes');g.save();await tick();assert.equal(g.$('[name=overlay_text]').value,'My changes');assert.match(g.$('#status').textContent,/inzwischen geändert/);g.view.destroy();
});
await test('ownership is checked before saving and again after pending requests; late previews are discarded',async()=>{
 const f=fixture();await tick();f.set('overlay_text','Private');f.owner('other',false);f.save();await tick();assert.equal(f.calls.length,1);assert.equal(f.$('#app').hidden,true);assert.equal(f.$('[name=overlay_text]').value,'');assert.deepEqual(f.revoked,f.urls);f.view.destroy();
 for(const action of ['get','save','thumbnail']){
  const gate=deferred();let pending;
  const g=fixture({request:(a,i)=>{if(a===action){pending=i;return gate.promise;}return reply(i);},thumbnail:()=>action==='thumbnail'?gate.promise:new Blob(['fixture'])});await tick();if(action==='save'){g.set('overlay_text','Private');g.save();await tick();}g.owner('other',false);gate.resolve(action==='thumbnail'?new Blob(['late']):reply(pending,pending.settings||defaults,action==='save'?1:0));await tick();assert.equal(g.$('#app').hidden,true);assert.equal(g.$('#image').hasAttribute('src'),false);g.view.destroy();
 }
});
await test('source version mismatch, empty list, offline listing and retry never render untrusted stale state',async()=>{
 const f=fixture({request:(a,i)=>({...reply(i),asset_revision:'old'})});await tick();assert.equal(f.$('#editor').hidden,true);assert.match(f.$('#status').textContent,/erneut versuchen/);f.view.destroy();
 const g=fixture({listFiles:()=>({ok:true,files:[]})});await tick();assert.equal(g.calls.length,0);assert.match(g.$('#status').textContent,/Noch keine/);g.view.destroy();
 let offline=true;const h=fixture({listFiles:()=>{if(offline)throw Error('offline');return {ok:true,files};}});await tick();assert.equal(h.$('#retry').hidden,false);offline=false;h.$('#retry').click();await tick();assert.equal(h.$('#editor').hidden,false);h.view.destroy();
});
await test('visibility and teardown preserve unsaved text for the owner and abort pending thumbnail callbacks',async()=>{
 const f=fixture();await tick();f.set('overlay_text','Unsaved');f.visibility('hidden');assert.equal(f.$('#app').hidden,true);f.visibility('visible');await tick();assert.equal(f.$('#app').hidden,false);assert.equal(f.$('[name=overlay_text]').value,'Unsaved');assert.equal(f.calls.length,1);f.view.destroy();
 const gate=deferred(),g=fixture({thumbnail:()=>gate.promise});await tick();g.view.destroy();assert.equal(g.thumbs[0].s.aborted,true);gate.resolve(new Blob(['late']));await tick();assert.equal(g.urls.length,0);assert.equal(g.$('#app').hidden,true);
});
await test('dashboard replaces only the inactive optimizer and restores exact original nodes on teardown',()=>{
 const {document:doc}=parseHTML('<section id="sma-content-panel-optimizer"><div class="card"><p>Original</p><button disabled>Content optimieren</button></div></section><p id="sibling">Unchanged</p>');const old=doc.querySelector('button');
 const view=mountMediaEditorEntry({doc,href:'https://example.test/app/media-editor.html'});assert.equal(doc.querySelector('a').href,'https://example.test/app/media-editor.html');assert.match(doc.querySelector('.card').textContent,/Medienexport/);assert.equal(doc.querySelector('#sibling').textContent,'Unchanged');view.destroy();assert.equal(doc.querySelector('button'),old);
});
await test('metadata refresh preserves unsaved recipe, enables timing and does not reload or save the draft',async()=>{
 const pending={...files[0],duration_ms:null,width_px:null,height_px:null};let count=0;
 const f=fixture({listFiles:()=>({ok:true,files:[pending]}),refreshMetadata:()=>{count++;return {ok:true,files};}});await tick();
 assert.equal(f.$('#metadataPanel').hidden,false);assert.match(f.$('#metadataStatus').textContent,/Videolänge und Bildgröße/);f.set('overlay_text','Keep this text');f.set('format','9:16');f.$('#refreshMetadata').click();await tick();
 assert.equal(count,1);assert.equal(f.$('#metadataPanel').hidden,true);assert.equal(f.$('[name=start_ms]').disabled,false);assert.equal(f.$('[name=overlay_text]').value,'Keep this text');assert.equal(f.$('[name=format]').value,'9:16');assert.deepEqual(f.calls.map(c=>c.a),['get']);f.save();await tick();assert.equal(f.calls.at(-1).i.settings.overlay_text,'Keep this text');f.view.destroy();
});
await test('pending metadata, rate limiting and changed source retain edits; source change blocks save until reload',async()=>{
 for(const outcome of ['pending','rate','changed']){
  const pending={...files[0],duration_ms:null};const f=fixture({listFiles:()=>({ok:true,files:[pending]}),refreshMetadata:()=>{if(outcome==='rate')throw Error('FILE_SYNC_RATE_LIMITED');return {ok:true,files:[outcome==='pending'?pending:{...files[0],revision:'r2'}]};}});await tick();f.set('overlay_text','Unsaved');f.$('#refreshMetadata').click();await tick();assert.equal(f.$('[name=overlay_text]').value,'Unsaved');assert.equal(f.$('#metadataPanel').hidden,false);assert.equal(f.$('#refreshMetadata').disabled,false);
  assert.match(f.$('#status').textContent,outcome==='pending'?/noch nicht bereitgestellt/:outcome==='rate'?/warte kurz/:/geändert/);
  if(outcome==='changed'){f.save();await tick();assert.deepEqual(f.calls.map(c=>c.a),['get']);f.$('#reload').click();assert.equal(f.$('#discard').hidden,false);f.$('#confirmDiscard').click();await tick();assert.equal(f.calls.at(-1).i.asset_revision,'r2');assert.equal(f.$('[name=overlay_text]').value,'');}
  f.view.destroy();
 }
});
await test('only one metadata request runs; owner changes and teardown discard late results and abort work',async()=>{
 for(const end of ['success','owner','destroy']){
  const gate=deferred();let count=0,signal;const f=fixture({listFiles:()=>({ok:true,files:[{...files[0],duration_ms:null}]}),refreshMetadata:s=>{count++;signal=s;return gate.promise;}});await tick();f.set('overlay_text','Private');f.$('#refreshMetadata').click();f.$('#refreshMetadata').click();await tick();assert.equal(count,1);assert.equal(f.$('#refreshMetadata').disabled,true);
  if(end==='owner')f.owner('other');if(end==='destroy')f.view.destroy();if(end!=='success')assert.equal(signal.aborted,true);gate.resolve({ok:true,files});await tick();
  if(end==='success'){assert.equal(f.$('#metadataPanel').hidden,true);assert.equal(f.$('[name=overlay_text]').value,'Private');}else assert.equal(f.$('#app').hidden,true);f.view.destroy();
 }
});
console.log(`${passed} editor DOM scenarios passed.`);
