import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {editorDefaults,readEditorFiles} from '../app/assets/media-editor-model.mjs';
import {missingVideoMetadata} from '../app/assets/media-metadata.mjs';

// The actual click handler and its existing lock/failure/owner-invalidation
// helpers execute unchanged. Only DOM primitives, owner reads and the adapter
// are synthetic. No HTTP, upload, payment or publication is possible here.
const source=await readFile(new URL('../app/assets/media-editor-view.mjs',import.meta.url),'utf8');
const sourceLine=prefix=>{
 const line=source.split('\n').find(row=>row.startsWith(prefix));assert.ok(line,'Missing production helper: '+prefix);return line;
};
const begin=source.indexOf(' async function refreshFileMetadata(){');
const end=source.indexOf(" $('refreshMetadata').addEventListener('click',refreshFileMetadata);",begin);
assert.ok(begin>=0&&end>begin);
const body=[sourceLine('const errors='),sourceLine(' const say='),sourceLine(' const current='),
 sourceLine(' function lock('),sourceLine(' function unavailable('),sourceLine(' function fail('),
 source.slice(begin,end),'refreshFileMetadata'].join('\n');
const owner='cd110000-0000-4000-8000-000000000091',otherOwner='cd110000-0000-4000-8000-000000000092';
const knownFile={id:'cd110000-0000-4000-8000-000000000001',name:'Known video.mp4',revision:'r1',
 media_kind:'video',mime_type:'video/mp4',duration_ms:null,width_px:null,height_px:null};
const freshFile={...knownFile,duration_ms:10000,width_px:320,height_px:240};
const reply=()=>({ok:true,files:[freshFile]});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

function fixture({hold=[],refreshError=null}={}){
 let clock=1000,next=0,ownerReadsInAttempt=0,currentOwner=owner;
 const timers=new Map(),gates=new Map(hold.map(phase=>[phase,deferred()])),nodes=new Map(),inputs=new Map();
 const calls=[],refreshes=[],invalidations=[],renders=[],previewReads=[];
 function element(){return {value:'',textContent:'',hidden:false,disabled:false,dataset:{},children:[],replaceChildren(...children){this.children=children;}};}
 const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 for(const [name,value] of Object.entries(editorDefaults))inputs.set(name,{value:String(value??'')});
 inputs.get('overlay_text').value='Ungespeicherter Kundentext';inputs.get('format').value='9:16';
 class Clock extends Date {static now(){return clock;}}
 const phase=(name,value)=>{calls.push(name);return gates.has(name)?gates.get(name).promise:Promise.resolve(value);};
 const env={AbortController,Date:Clock,
  setTimeout(fn,ms){const id=++next;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timers.delete(id),
  $,control:key=>inputs.get(key),editorDefaults,readEditorFiles,missingVideoMetadata,
  initialAssetId:null,initialAssetPortal:null,expectedOwnerId:owner,
  files:[knownFile],file:knownFile,saved:{revision:3,settings:{...editorDefaults,overlay_text:'Gespeicherter Text'}},
  attempt:null,busy:false,disposed:false,invalidOwner:false,dirty:true,generation:0,metadataController:null,fileStale:false,
  original:{setContext:value=>invalidations.push(value)},music:{clear(){}},
  exportView:{setContext(){},destroy(){}},releasePreview(){},setDirty:value=>{env.dirty=value;},clearDiscard(){},
  renderOptions:()=>renders.push('options'),fileFields:()=>renders.push('fields'),paint:()=>renders.push('paint'),
  loadPreview:(_g,file)=>{previewReads.push(file.id);return Promise.resolve();},
  getOwnerId:()=>phase(++ownerReadsInAttempt===1?'owner-before':'owner-after',currentOwner),
  refreshMetadata:signal=>{
   refreshes.push({signal});if(refreshError)throw Error(refreshError);return phase('adapter',reply());
  }
 };
 const run=vm.runInNewContext(body,env);
 function release(name,value){const gate=gates.get(name);assert.ok(gate,'Missing held stage: '+name);gates.delete(name);gate.resolve(value===undefined?(name==='adapter'?reply():currentOwner):value);}
 return {env,nodes,inputs,timers,calls,refreshes,invalidations,renders,previewReads,$,
  run(){if(!env.busy)ownerReadsInAttempt=0;return run();},
  owner:value=>{currentOwner=value;},gate:name=>gates.get(name),hold:name=>{const gate=deferred();gates.set(name,gate);return gate;},
  release,detachHold:name=>{const gate=gates.get(name);gates.delete(name);return gate;},
  abort(){env.metadataController?.abort();},jump:ms=>{clock+=ms;},
  async advance(ms){
   const target=clock+ms;
   for(;;){const due=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!due)break;clock=Math.max(clock,due[1].at);timers.delete(due[0]);due[1].fn();await flush();}
   clock=target;await flush();
  },
  close(){env.metadataController?.abort();for(const [name] of [...gates])release(name);}
 };
}
function assertPreserved(f){
 assert.equal(f.env.file,knownFile);assert.deepEqual(f.env.files,[knownFile]);assert.equal(f.env.invalidOwner,false);
 assert.equal(f.inputs.get('overlay_text').value,'Ungespeicherter Kundentext');assert.equal(f.inputs.get('format').value,'9:16');
 assert.equal(f.env.dirty,true);assert.equal(f.env.saved.revision,3);assert.equal(f.invalidations.length,0);
}
function assertReleased(f){
 assert.equal(f.env.busy,false);assert.equal(f.$('refreshMetadata').disabled,false);assert.equal(f.$('fields').disabled,false);
 assert.equal(f.env.metadataController,null);assert.equal(f.timers.size,0);
}

test('the real metadata click confirms both owners, updates metadata once and preserves unsaved form inputs',async()=>{
 const f=fixture();try{
  await f.run();assert.deepEqual(f.calls,['owner-before','adapter','owner-after']);assert.equal(f.refreshes.length,1);
  assert.equal(f.env.file.duration_ms,10000);assert.equal(f.env.file.id,knownFile.id);
  assert.equal(f.inputs.get('overlay_text').value,'Ungespeicherter Kundentext');assert.equal(f.inputs.get('format').value,'9:16');
  assert.equal(f.env.dirty,true);assert.equal(f.env.saved.revision,3);assertReleased(f);
  assert.match(f.$('status').textContent,/Dateiangaben aktualisiert.*Eingaben bleiben erhalten/);
 }finally{f.close();}
});

for(const stage of ['owner-before','adapter','owner-after'])test('a stalled '+stage+' releases the actual editor at the click deadline and keeps its inputs',async()=>{
 const f=fixture({hold:[stage]});let settled=false;
 try{
  const pending=f.run().then(()=>{settled=true;});await flush();assert.equal(f.calls.at(-1),stage);assert.equal(f.env.busy,true);
  await f.advance(89999);assert.equal(settled,false);await f.advance(1);await pending;
  assertReleased(f);assertPreserved(f);assert.equal(f.refreshes.length,stage==='owner-before'?0:1);
  for(const call of f.refreshes)assert.equal(call.signal.aborted,true);
  assert.match(f.$('metadataStatus').textContent,/zu lange.*Eingaben bleiben erhalten.*erneut/);
  assert.equal(f.$('status').textContent,f.$('metadataStatus').textContent);assert.equal(f.$('status').dataset.error,'true');
  const calls=f.calls.length;f.release(stage,stage==='adapter'?reply():otherOwner);await flush();
  assert.equal(f.calls.length,calls);assertReleased(f);assertPreserved(f);assert.equal(f.renders.length,0);
 }finally{f.close();}
});

test('both owner reads and the adapter consume the same 90 seconds from the click',async()=>{
 const f=fixture({hold:['owner-before','adapter','owner-after']});let settled=false;
 try{
  const pending=f.run().then(()=>{settled=true;});await flush();await f.advance(10000);f.release('owner-before');await flush();
  assert.equal(f.refreshes.length,1);assert.equal(f.refreshes[0].signal,f.env.metadataController.signal);
  await f.advance(60000);f.release('adapter');await flush();assert.equal(f.calls.at(-1),'owner-after');
  await f.advance(19999);assert.equal(settled,false);await f.advance(1);await pending;
  assertReleased(f);assertPreserved(f);assert.equal(f.refreshes[0].signal.aborted,true);assert.equal(f.refreshes.length,1);
  f.release('owner-after',otherOwner);await flush();assertPreserved(f);
 }finally{f.close();}
});

for(const stage of ['owner-before','adapter','owner-after'])test('an explicit consumer abort during '+stage+' cannot let a late owner result clear the editor',async()=>{
 const f=fixture({hold:[stage]});try{
  const pending=f.run();await flush();f.abort();await pending;assertReleased(f);assertPreserved(f);
  const before=f.calls.length;f.release(stage,stage==='adapter'?reply():otherOwner);await flush();
  assert.equal(f.calls.length,before);assertReleased(f);assertPreserved(f);
 }finally{f.close();}
});

test('a timed-out owner result cannot clear or unlock a newer metadata attempt',async()=>{
 const f=fixture({hold:['owner-before']});let old;
 try{
  const first=f.run();await flush();await f.advance(90000);await first;assertReleased(f);
  old=f.detachHold('owner-before');f.hold('adapter');const second=f.run();await flush();
  assert.equal(f.env.busy,true);assert.equal(f.refreshes.length,1);old.resolve(otherOwner);await flush();
  assert.equal(f.env.busy,true);assert.equal(f.$('refreshMetadata').disabled,true);assertPreserved(f);
  f.release('adapter');await second;assertReleased(f);assert.equal(f.env.file.duration_ms,10000);assert.equal(f.refreshes.length,1);
 }finally{old?.resolve(owner);f.close();}
});

test('a delayed browser timer cannot authorize refresh after an expired initial owner check',async()=>{
 const f=fixture({hold:['owner-before']});try{
  const pending=f.run();await flush();f.jump(90000);f.release('owner-before');await pending;
  assertReleased(f);assertPreserved(f);assert.equal(f.refreshes.length,0);assert.match(f.$('metadataStatus').textContent,/zu lange/);
 }finally{f.close();}
});

for(const stage of ['owner-before','owner-after'])test('a timely changed owner during '+stage+' still invokes the real privacy invalidation',async()=>{
 const f=fixture({hold:[stage]});try{
  const pending=f.run();await flush();f.release(stage,otherOwner);await pending;
  assert.equal(f.env.invalidOwner,true);assert.equal(f.env.file,null);assert.equal(f.env.files.length,0);
  assert.equal(f.inputs.get('overlay_text').value,'');assert.equal(f.$('login').hidden,false);
  assert.equal(f.refreshes.length,stage==='owner-before'?0:1);assert.equal(f.timers.size,0);
 }finally{f.close();}
});

test('a repeated click during the first owner read never starts another adapter request',async()=>{
 const f=fixture({hold:['owner-before']});try{
  const first=f.run();await flush();await f.run();await f.run();assert.deepEqual(f.calls,['owner-before']);
  f.release('owner-before');await first;assert.equal(f.refreshes.length,1);assertReleased(f);
 }finally{f.close();}
});

test('a known running rejection keeps the existing explanatory message and editable customer inputs',async()=>{
 const f=fixture({refreshError:'FILE_SYNC_RUNNING'});try{
  await f.run();assertReleased(f);assertPreserved(f);assert.equal(f.refreshes.length,1);
  assert.match(f.$('metadataStatus').textContent,/bereits aktualisiert/);assert.equal(f.calls.includes('owner-after'),false);
 }finally{f.close();}
});
