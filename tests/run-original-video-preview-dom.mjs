import assert from 'node:assert/strict';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {mountOriginalVideo,originalVideoSupported} from '../app/assets/original-video-preview.mjs';
const file={id:'synthetic-video',revision:'sha256:'+'a'.repeat(64)+':1',media_kind:'video',mime_type:'video/mp4',size_bytes:12,duration_ms:10000};
const blob=()=>new Blob([new Uint8Array(12)],{type:'video/mp4'});let n=0;const eq=(a,b)=>{assert.deepEqual(a,b);n++;};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const {document:doc}=parseHTML('<html><body><figure><div id="thumb">Thumbnail</div></figure></body></html>'),create=doc.createElement.bind(doc),pending=[],created=[],revoked=[];let owner='customer-1',paused=0;
 doc.createElement=tag=>{const e=create(tag);e.handlers={};e.addEventListener=(name,fn)=>e.handlers[name]=fn;if(tag==='video'){e.pause=()=>paused++;e.load=()=>{};}return e;};
 const thumb=doc.getElementById('thumb');const view=mountOriginalVideo({doc,host:doc.querySelector('figure'),thumbnailHost:thumb,expectedOwnerId:'customer-1',getOwnerId:async()=>owner,source:(selected,signal)=>new Promise((resolve,reject)=>pending.push({selected,signal,resolve,reject})),createURL:b=>{created.push(b);return 'blob:synthetic-'+created.length;},revokeURL:u=>revoked.push(u)});
 view.setContext(file);return {view,thumb,pending,created,revoked,box:doc.getElementById('originalVideoPreview'),button:doc.querySelector('button'),video:doc.querySelector('video'),status:doc.querySelector('p'),owner:x=>owner=x,paused:()=>paused};
}
for(const bad of [null,{}, {...file,media_kind:'image'},{...file,mime_type:'video/quicktime'},{...file,size_bytes:24000001},{...file,duration_ms:null},{...file,duration_ms:60001}])eq(originalVideoSupported(bad),false);
{
 const t=fixture();eq(t.pending.length,0);eq(t.box.hidden,false);eq(t.video.hidden,true);const job=t.button.handlers.click();await tick();eq(t.pending.length,1);eq(t.pending[0].selected,file);eq(t.button.disabled,true);await t.button.handlers.click();eq(t.pending.length,1);
 t.pending[0].resolve(blob());await job;eq(t.video.hidden,false);eq(t.thumb.style.display,'none');eq(t.video.controls,true);eq(t.video.autoplay,undefined);eq(t.button.hidden,true);eq(t.created.length,1);eq(t.status.textContent.includes('keine Prüfbestätigung'),true);
 t.view.setContext({...file});eq(t.created.length,1);eq(t.revoked,[]);t.view.stop();eq(t.paused()>0,true);t.view.setContext({...file,revision:'changed'});eq(t.video.hidden,true);eq(t.revoked,['blob:synthetic-1']);eq(t.thumb.style.display,'');
}
{
 const t=fixture(),job=t.button.handlers.click();await tick();t.view.setContext({...file,id:'other-video'});eq(t.pending[0].signal.aborted,true);t.pending[0].resolve(blob());await job;eq(t.created,[]);eq(t.video.hidden,true);eq(t.button.disabled,false);
}
for(const notified of [true,false]){
 const t=fixture(),job=t.button.handlers.click();await tick();t.owner('customer-2');if(notified)t.view.invalidateOwner('customer-2');t.pending[0].resolve(blob());await job;eq(t.created,[]);eq(t.video.hidden,true);eq(t.box.hidden,true);
}
{
 const t=fixture();t.owner(null);await t.button.handlers.click();eq(t.pending,[]);eq(t.box.hidden,true);
}
for(const bad of [new Blob([new Uint8Array(12)],{type:'image/png'}),new Blob([new Uint8Array(13)],{type:'video/mp4'})]){
 const t=fixture(),job=t.button.handlers.click();await tick();t.pending[0].resolve(bad);await job;eq(t.created,[]);eq(t.button.disabled,false);eq(t.video.hidden,true);eq(t.status.textContent.includes('nicht geladen'),true);
}
{
 const t=fixture(),job=t.button.handlers.click();await tick();t.pending[0].reject(Error('FILE_CHANGED'));await job;eq(t.status.textContent.includes('Datei wurde geändert'),true);const retry=t.button.handlers.click();await tick();eq(t.pending.length,2);t.pending[1].resolve(blob());await retry;eq(t.video.hidden,false);
 t.video.handlers.error();eq(t.video.hidden,true);eq(t.revoked.length,1);eq(t.button.hidden,false);eq(t.status.textContent.includes('nicht abspielen'),true);
}
{
 const t=fixture(),job=t.button.handlers.click();await tick();t.view.destroy();t.pending[0].resolve(blob());await job;eq(t.pending[0].signal.aborted,true);eq(t.created,[]);eq(t.box.hidden,true);await t.button.handlers.click();eq(t.pending.length,1);
}
{
 const t=fixture();t.view.setContext({...file,mime_type:'video/quicktime'});await t.button.handlers.click();eq(t.pending,[]);eq(t.box.hidden,true);
}
console.log(n+' original-video DOM checks passed. No network requests or approvals.');
