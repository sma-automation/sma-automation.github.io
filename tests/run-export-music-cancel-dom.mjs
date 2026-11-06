import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {mountMediaEditor} from '../app/assets/media-editor-view.mjs';
import {mountMediaMusic} from '../app/assets/media-music-view.mjs';
import {editorDefaults} from '../app/assets/media-editor-model.mjs';
import {inspectMusic} from '../app/assets/media-music-model.mjs';

const html=await readFile(new URL('../app/media-editor.html',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let n=0;n<200;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,1));}assert.ok(check(),'expected asynchronous result');}
const id=n=>'ca110000-0000-4000-9000-'+String(n).padStart(12,'0'),uid=id(90);
const file={id:id(1),name:'Example.mp4',revision:'r1',media_kind:'video',mime_type:'video/mp4',size_bytes:1000,duration_ms:3000,width_px:320,height_px:240};
const wav=new File([Buffer.from('RIFFabcdWAVE1234')],'Test.wav');
const music={...await inspectMusic(wav),volume:38,start_ms:125},settings={...editorDefaults,music};
const reply={ok:true,version:1,can_publish:false,asset_id:file.id,asset_revision:file.revision,revision:1,settings,saved_at:'2026-11-06T12:00:00Z',changed:false};

function fixture({editor=true}={}){
 const {document:doc}=parseHTML(html);Object.defineProperty(doc,'visibilityState',{value:'visible',writable:true});
 // Match native select setters, which linkedom does not implement.
 for(const select of doc.querySelectorAll('select'))Object.defineProperty(select,'value',{get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(v){for(const o of this.querySelectorAll('option'))o.toggleAttribute('selected',o.value===v);}});
 const $=id=>doc.getElementById(id),loads=[],sources=[],renders=[],writes=[],urls=[],revoked=[],changes=[];let serial=100;
 const createURL=blob=>{const url='blob:cancel-'+urls.length;urls.push({blob,url});return url;},revokeURL=url=>revoked.push(url);
 const library={list:async()=>[],source:(setting,signal)=>new Promise(resolve=>loads.push({setting,signal,resolve})),upload:async()=>{writes.push('music');throw Error('unexpected upload');}};
 const view=editor?mountMediaEditor({doc,expectedOwnerId:uid,getOwnerId:async()=>uid,request:async action=>{assert.equal(action,'get');return structuredClone(reply);},listFiles:async()=>({ok:true,files:[file]}),thumbnail:async()=>new Blob(['thumbnail']),musicLibrary:library,uuid:()=>id(serial++),createURL,revokeURL,exportDependencies:{request:async action=>{if(action!=='list'){writes.push(action);throw Error('unexpected write');}return {ok:true,version:1,can_publish:false,exports:[]};},source:async(f,signal)=>{sources.push({f,signal});return new Blob(['source']);},render:async args=>{renders.push(args);return {media:new Blob(['rendered']),cover:null};},upload:async()=>{writes.push('export');throw Error('unexpected upload');}}}):mountMediaMusic({doc,library,onChange:()=>changes.push(true),setBusy:()=>{},createURL,revokeURL});
 if(!editor)view.setContext(file,music);
 return {doc,$,view,loads,sources,renders,writes,urls,revoked,changes};
}
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}

await test('real editor cancellation aborts pending stored music and unlocks before delayed bytes arrive; retry ignores the old result',async()=>{
 const f=fixture();await until(()=>f.loads.length===1&&!f.$('generateExport').disabled);
 f.$('generateExport').click();await tick();f.$('cancelExport').click();
 assert.equal(f.loads[0].signal.aborted,true);await until(()=>!f.$('generateExport').disabled);
 assert.match(f.$('exportStatus').textContent,/abgebrochen/);assert.equal(f.$('exportResult').hidden,true);assert.equal(f.sources.length,0);assert.equal(f.renders.length,0);
 f.$('generateExport').click();await until(()=>f.loads.length===2);assert.equal(f.loads[1].signal.aborted,false);
 f.loads[0].resolve(wav);await tick();await tick();assert.equal(f.sources.length,0);assert.equal(f.$('musicPlayer').hidden,true);
 f.loads[1].resolve(wav);await until(()=>!f.$('exportResult').hidden);
 assert.equal(f.sources.length,1);assert.equal(f.renders.length,1);assert.equal(f.renders[0].music,wav);assert.deepEqual(f.renders[0].settings.music,music);assert.equal(f.loads.length,2);assert.deepEqual(f.writes,[]);
 f.view.destroy();assert.deepEqual(new Set(f.revoked),new Set(f.urls.map(x=>x.url)));
});

await test('closing the editor or losing the owner during music loading aborts work and ignores late bytes',async()=>{
 for(const end of ['destroy','owner']){
  const f=fixture();await until(()=>f.loads.length===1&&!f.$('generateExport').disabled);f.$('generateExport').click();await tick();
  if(end==='destroy')f.view.destroy();else f.view.invalidateOwner('other');
  assert.equal(f.loads[0].signal.aborted,true);f.loads[0].resolve(wav);await tick();await tick();
  assert.equal(f.$('app').hidden,true);assert.equal(f.$('musicPlayer').hidden,true);assert.equal(f.$('exportResult').hidden,true);assert.equal(f.sources.length,0);assert.equal(f.renders.length,0);assert.deepEqual(f.writes,[]);f.view.destroy();
 }
});

await test('already cancelled callers leave background music intact; completed callers cannot cancel another selection',async()=>{
 const f=fixture({editor:false}),cancelled=new AbortController();cancelled.abort();
 await assert.rejects(f.view.getSource(music,cancelled.signal),{name:'AbortError'});assert.equal(f.loads.length,1);assert.equal(f.loads[0].signal.aborted,false);
 const first=new AbortController(),result=f.view.getSource(music,first.signal);f.loads[0].resolve(wav);assert.equal(await result,wav);
 f.view.setContext({...file,id:id(2)},music);assert.equal(f.loads.length,2);first.abort();assert.equal(f.loads[1].signal.aborted,false);
 f.loads[1].resolve(wav);assert.equal(await f.view.getSource(music),wav);assert.deepEqual(f.view.getSetting(),music);assert.deepEqual(f.changes,[]);f.view.destroy();
});

await test('cancellation preserves verified cached music and its recipe for the next export',async()=>{
 const f=fixture({editor:false});f.loads[0].resolve(wav);assert.equal(await f.view.getSource(music),wav);
 const controller=new AbortController(),pending=f.view.getSource(music,controller.signal);controller.abort();await assert.rejects(pending,{name:'AbortError'});
 assert.equal(await f.view.getSource(music),wav);assert.equal(f.loads.length,1);assert.equal(f.$('musicPlayer').hidden,false);assert.deepEqual(f.view.getSetting(),music);assert.deepEqual(f.changes,[]);assert.deepEqual(f.writes,[]);f.view.destroy();
});
console.log(`${passed} integrated export/music cancellation scenarios passed.`);
