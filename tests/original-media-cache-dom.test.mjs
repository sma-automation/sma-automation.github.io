import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {createSharedOriginalMediaClient,clearSharedOriginalMediaCache} from '../app/assets/original-media-cache.mjs';
import {mountMediaEditor} from '../app/assets/media-editor-view.mjs';
import {editorDefaults} from '../app/assets/media-editor-model.mjs';

const html=await readFile(new URL('../app/media-editor.html',import.meta.url),'utf8');
const original=await readFile(new URL('./fixtures/original-video.mp4',import.meta.url));
const owner='ac890000-0000-4000-8000-000000000091',asset='ac890000-0000-4000-8000-000000000001';
const file={id:asset,revision:'r1',name:'Synthetic original video',media_kind:'video',mime_type:'video/mp4',
 duration_ms:10000,width_px:320,height_px:240,size_bytes:original.length};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(condition,message){for(let n=0;n<150;n++){if(condition())return;await tick();}assert.ok(condition(),message);}

function fixture(){
 const {document:doc,window}=parseHTML(html),host={setTimeout,clearTimeout};
 Object.defineProperty(doc,'visibilityState',{value:'visible',writable:true});
 // Linkedom implements native button events, but not select.value setters.
 for(const select of doc.querySelectorAll('select'))Object.defineProperty(select,'value',{
  get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},
  set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===value);}});
 let saved={revision:0,settings:{...editorDefaults},saved_at:null,changed:false},currentOwner=owner,conflict=false;
 const calls=[],transfers=[],sources=[],renders=[],created=[],revoked=[];
 const state=()=>({ok:true,version:1,can_publish:false,asset_id:asset,asset_revision:file.revision,...saved});
 const client=createSharedOriginalMediaClient({host,endpoint:()=> 'https://synthetic-original.test/source',
  getSession:async()=>({user:{id:currentOwner},access_token:'synthetic-token'}),
  fetcher:async(url,init)=>{
   transfers.push({url,input:JSON.parse(init.body),signal:init.signal});
   assert.deepEqual(transfers.at(-1).input,{asset_id:asset,asset_revision:file.revision});
   return new Response(JSON.stringify({ok:true,can_publish:false,asset_id:asset,asset_revision:file.revision,
    mime_type:'video/mp4',size_bytes:original.length,sha256:createHash('sha256').update(original).digest('hex'),data_base64:original.toString('base64')}),
   {headers:{'Content-Type':'application/json'}});
  }});
 const source=(selected,signal)=>{sources.push({selected,signal});return client.request(selected,{owner,signal});};
 const request=async(action,input)=>{
  calls.push({action,input});assert.ok(['get','save'].includes(action));
  if(conflict&&action==='get')return {ok:false,code:'FILE_CHANGED'};
  if(action==='save')saved={revision:saved.revision+1,settings:{...input.settings},saved_at:'2026-11-17T12:00:00Z',changed:true};
  return state();
 };
 const view=mountMediaEditor({doc,expectedOwnerId:owner,getOwnerId:async()=>currentOwner,request,
  listFiles:async()=>({ok:true,files:[file]}),thumbnail:async()=>new Blob(['synthetic thumbnail']),source,
  uuid:()=>crypto.randomUUID(),createURL:blob=>{const value='blob:synthetic-'+created.length;created.push({value,blob});return value;},
  revokeURL:value=>revoked.push(value),
  exportDependencies:{source,request:async(action,input)=>{calls.push({action:'export-'+action,input});assert.equal(action,'list','This journey never prepares, uploads or completes an export');return {ok:true,version:1,can_publish:false,exports:[]};},
   render:async(args)=>{assert.ok(args.source instanceof Blob);assert.equal(args.source.type,'video/mp4');assert.equal(args.source.size,original.length);renders.push(args);return {media:new Blob([original],{type:'video/mp4'}),cover:new Blob(['synthetic cover'],{type:'image/png'})};},
   upload:async()=>assert.fail('Previewing must never upload any media')}});
 const $=selector=>doc.querySelector(selector);
 return {doc,window,view,$,calls,transfers,sources,renders,created,revoked,
  tab(label){const tab=[...doc.querySelectorAll('[role=tab]')].find(tab=>tab.textContent===label);assert.ok(tab,label);tab.click();},
  set(name,value){const input=$('[name="'+name+'"]');input.value=value;input.dispatchEvent(new window.Event('input',{bubbles:true}));},
  save(){$('#editorForm').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));},
  conflict(){conflict=true;},
  destroy(){view.destroy();client.dispose();clearSharedOriginalMediaCache(host);}};
}

test('actual editor buttons reuse one original transfer for preview, export and chapter return',async()=>{
 const f=fixture();try{
  await until(()=>!f.$('#editor').hidden&&!f.$('#asset').disabled,'Editor should be ready');
  assert.equal(f.transfers.length,0,'Opening the editor fetches no original');
  f.tab('Schnitt & Cover');f.$('#originalVideoPreview button').click();
  await until(()=>!f.$('#originalVideoPreview video').hidden,'Original should be shown');
  assert.equal(f.transfers.length,1);const originalURL=f.$('#originalVideoPreview video').src;
  f.set('cover_ms','0.5');f.save();await until(()=>f.$('#savedInfo').textContent.includes('Version 1'),'Draft save should finish');
  f.tab('Export');assert.ok(f.revoked.includes(originalURL),'Leaving the chapter still releases its player URL');
  f.$('#generateExport').click();await until(()=>!f.$('#exportResult').hidden,'Export preview should finish');
  assert.equal(f.renders.length,1);assert.equal(f.sources.length,2);assert.equal(f.transfers.length,1);
  f.tab('Schnitt & Cover');f.$('#originalVideoPreview button').click();
  await until(()=>!f.$('#originalVideoPreview video').hidden,'Returning original should be shown');
  assert.equal(f.sources.length,3);assert.equal(f.transfers.length,1,'Three real consumers need only one original-source POST');
  assert.notEqual(f.$('#originalVideoPreview video').src,originalURL,'A new player owns a new object URL');
  // Reusing source bytes must never reuse an obsolete render or skip draft reads.
  f.tab('Text');f.set('overlay_text','New saved caption');f.save();
  await until(()=>f.$('#savedInfo').textContent.includes('Version 2'),'Changed draft should save');
  f.tab('Export');f.$('#generateExport').click();await until(()=>!f.$('#exportResult').hidden,'Changed export should finish');
  assert.equal(f.renders.length,2);assert.equal(f.renders[1].settings.overlay_text,'New saved caption');
  assert.equal(f.transfers.length,1);assert.ok(f.calls.filter(call=>call.action==='get').length>=5);
  assert.ok(f.calls.every(call=>['get','save','export-list'].includes(call.action)));
 }finally{f.destroy();}
});

test('a fresh authoritative file conflict blocks export even when its old exact bytes are in RAM',async()=>{
 const f=fixture();try{
  await until(()=>!f.$('#editor').hidden&&!f.$('#asset').disabled,'Editor should be ready');
  f.tab('Schnitt & Cover');f.$('#originalVideoPreview button').click();
  await until(()=>!f.$('#originalVideoPreview video').hidden,'Original should be shown');
  f.set('cover_ms','0.5');f.save();await until(()=>f.$('#savedInfo').textContent.includes('Version 1'),'Draft save should finish');
  f.conflict();f.tab('Export');f.$('#generateExport').click();
  await until(()=>f.$('#exportStatus').textContent.includes('geändert'),'Current file conflict should reach the UI');
  assert.equal(f.transfers.length,1);assert.equal(f.sources.length,1);assert.equal(f.renders.length,0);
  assert.equal(f.$('#exportResult').hidden,true);assert.equal(f.$('#generateExport').disabled,false);
 }finally{f.destroy();}
});
