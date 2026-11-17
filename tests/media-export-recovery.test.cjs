const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFile}=require('node:fs/promises');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const {parseHTML}=require('./dom-runtime/node_modules/linkedom');
const id=n=>`bd770000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ownerId=id(1);
const sourceRoot=process.env.SMA_EXPORT_RECOVERY_SOURCE_ROOT||path.resolve(__dirname,'..');
const modules=Promise.all([
 import(pathToFileURL(path.join(sourceRoot,'app/assets/media-export-view.mjs'))),
 import('../app/assets/media-editor-model.mjs'),
 readFile(path.join(sourceRoot,'app/media-editor.html'),'utf8'),
]);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let n=0;n<300;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,1));}assert.ok(check(),'The synthetic export did not settle');}
function storage(){
 const values=new Map();let mode=null;
 return {values,mode:value=>{mode=value;},getItem(key){if(mode==='read')throw Error('Blocked storage');return values.get(key)??null;},
  setItem(key,value){if(mode==='write')throw Object.assign(Error('Full storage'),{name:'QuotaExceededError'});values.set(key,value);}};
}
const locks={request:async(_key,options,callback)=>{assert.equal(options.ifAvailable,true);return callback({});}};
function backend(){
 const rows=new Map(),uploaded=new Set(),uploads=[],writes=[],reads=[];let completeLoss=null,prepareLoss=null,uploadError=null,completeReply=null,sequence=10000,lateComplete=null;
 function receipt(row){
  return {ok:true,version:1,can_publish:false,export_id:row.input.export_id,draft_revision:row.input.draft_revision,
   status:row.completed?'completed':'prepared',
   media:{upload_id:row.input.export_id,name:'SMA-Export-'+row.input.export_id+'.mp4',mime_type:'video/mp4',asset_id:row.completed?row.mediaAsset:null},
   cover:row.input.outputs.cover?{upload_id:row.coverId,name:'SMA-Export-'+row.input.export_id+'-Cover.png',mime_type:'image/png',asset_id:row.completed?row.coverAsset:null}:null};
 }
 async function request(action,input){
  if(action==='list'){
   reads.push(input);return {ok:true,version:1,can_publish:false,exports:[...rows.values()].filter(row=>row.completed).map(row=>({
    export_id:row.input.export_id,draft_revision:row.input.draft_revision,completed_at:'2026-11-17T01:00:00Z',
    media:{asset_id:row.mediaAsset,asset_revision:'sha256:'+row.input.outputs.media.sha256+':1',name:'Media'},
    cover:row.input.outputs.cover?{asset_id:row.coverAsset,asset_revision:'sha256:'+row.input.outputs.cover.sha256+':1',name:'Cover'}:null}))};
  }
  writes.push({action,input:structuredClone(input)});
  if(action==='prepare'){
   if(prepareLoss==='before'){prepareLoss=null;throw Error('Lost prepare request');}
   let row=rows.get(input.export_id);
   if(!row){row={input:structuredClone(input),coverId:id(sequence++),mediaAsset:id(sequence++),coverAsset:id(sequence++),completed:false};rows.set(input.export_id,row);}
   else assert.deepEqual(row.input,input,'An existing export ID must keep its exact request');
   if(prepareLoss==='after'){prepareLoss=null;throw Error('Lost prepare reply');}
   return receipt(row);
  }
  assert.equal(action,'complete');
  if(completeReply)return completeReply();
  const row=rows.get(input.export_id);assert.ok(row);
  if(completeLoss==='before'){completeLoss=null;throw Error('Lost complete request');}
  if(!uploaded.has(row.input.export_id)||row.input.outputs.cover&&!uploaded.has(row.coverId))return {ok:false,code:'EXPORT_INCOMPLETE'};
  if(lateComplete){const deferred=lateComplete;lateComplete=null;await deferred.promise;}
  row.completed=true;
  if(completeLoss==='after'){completeLoss=null;throw Error('Lost complete reply');}
  return receipt(row);
 }
 return {rows,uploaded,uploads,writes,reads,request,
  prepareLoss:value=>{prepareLoss=value;},completeLoss:value=>{completeLoss=value;},completeReply:value=>{completeReply=value;},
  uploadError:value=>{uploadError=value;},lateComplete:value=>{lateComplete=value;},
  upload:async(_blob,artifact)=>{
   uploads.push(artifact.upload_id);
   if(uploadError)throw Object.assign(Error(uploadError),{code:uploadError});
   uploaded.add(artifact.upload_id);return artifact.upload_id;
  }};
}
async function fixture(t,{savedStorage=storage(),server=backend(),expectedOwnerId=ownerId,owner=expectedOwnerId,asset=id(2),revision='version:1',draftRevision=1,media='identical rendered media',cover='identical rendered cover',lockManager=locks,getOwnerId,draftReply=reply=>reply}={}){
 const [{mountMediaExport},{editorDefaults},html]=await modules;
 const {document:doc}=parseHTML(html);let sequence=fixture.sequence+=100,currentOwner=owner,view,closed=false;
 const file={id:asset,revision,name:'Synthetic.mp4',media_kind:'video',mime_type:'video/mp4',width_px:320,height_px:240,duration_ms:3000,size_bytes:1000};
 const saved={revision:draftRevision,settings:{...editorDefaults,cover_ms:cover===null?null:500},saved_at:'2026-11-17T01:00:00Z',changed:false};
 view=mountMediaExport({doc,expectedOwnerId,getOwnerId:getOwnerId|| (async()=>currentOwner),onAuthLost:()=>{closed=true;view.destroy();},
  setBusy:value=>{doc.body.dataset.busy=String(value);},
  getDraft:async()=>draftReply({ok:true,version:1,can_publish:false,asset_id:file.id,asset_revision:file.revision,revision:saved.revision,settings:saved.settings,saved_at:saved.saved_at,changed:false}),
  request:server.request,source:async()=>new Blob(['synthetic source']),upload:server.upload,uuid:()=>id(++sequence),
  checkpointStorage:()=>savedStorage,checkpointLocks:()=>lockManager,
  createURL:()=>`blob:synthetic-${++sequence}`,revokeURL:()=>{},
  render:async()=>({media:new Blob([media]),cover:cover===null?null:new Blob([cover])})});
 view.setContext(file,saved,false);t.after(()=>view.destroy());await tick();
 const $=name=>doc.getElementById(name);
 const click=async name=>{$(name).click();await until(()=>closed||doc.body.dataset.busy!=='true');await tick();};
 return {doc,view,$,server,savedStorage,click,setOwner:value=>{currentOwner=value;},
  generate:()=>click('generateExport'),save:()=>click('storeExport'),restart:()=>click('restartExpiredExport'),
  notice:()=>$('exportStatus').textContent,records:()=>[...savedStorage.values.values()].flatMap(value=>JSON.parse(value))};
}
fixture.sequence=1000;

for(const point of ['before','after'])test(`a lost prepare ${point==='before'?'request':'reply'} resumes the same export after reload`,async t=>{
 const server=backend(),savedStorage=storage();server.prepareLoss(point);
 const first=await fixture(t,{server,savedStorage});await first.generate();await first.save();
 const original=server.writes.find(write=>write.action==='prepare').input;
 assert.equal(first.records().length,1);assert.equal(server.uploads.length,0);first.view.destroy();
 const second=await fixture(t,{server,savedStorage});
 assert.equal(server.writes.length,1,'Opening must only list existing results');
 await second.generate();await second.save();
 const prepares=server.writes.filter(write=>write.action==='prepare');
 assert.deepEqual(prepares.map(write=>write.input),[original,original]);
 assert.equal(new Set(server.uploads).size,2);assert.equal(server.rows.size,1);
 assert.match(second.notice(),/im Kundenordner gespeichert/);
 assert.equal(second.records().length,0);
});

for(const point of ['before','after'])test(`a lost completion ${point==='before'?'request':'reply'} is reconciled after reload without another upload`,async t=>{
 const server=backend(),savedStorage=storage();server.completeLoss(point);
 const first=await fixture(t,{server,savedStorage});await first.generate();await first.save();
 assert.equal(server.uploads.length,2);const original=first.records()[0].export_id;first.view.destroy();
 const second=await fixture(t,{server,savedStorage});await second.generate();await second.save();
 assert.equal(server.rows.size,1);assert.equal(server.uploads.length,2,'Recovery must not ask for any upload when completion is already possible');
 assert.ok(server.writes.filter(write=>write.action==='prepare').every(write=>write.input.export_id===original));
 assert.equal(server.rows.get(original).completed,true);assert.match(second.notice(),/im Kundenordner gespeichert/);
});

test('a late completion from a destroyed view cannot replace the recovered view or its checkpoint',async t=>{
 const server=backend(),savedStorage=storage();let release;server.lateComplete({promise:new Promise(resolve=>{release=resolve;})});
 const first=await fixture(t,{server,savedStorage});await first.generate();first.$('storeExport').click();
 await until(()=>server.writes.some(write=>write.action==='complete'));
 first.view.destroy();
 const second=await fixture(t,{server,savedStorage});await second.generate();await second.save();
 const notice=second.notice();release();await tick();await tick();
 assert.equal(second.notice(),notice);assert.equal(server.rows.size,1);assert.equal(server.uploads.length,2);
 assert.equal(second.records().length,0);
});

test('a completed tab can remove its checkpoint while another tab still reconciles that same export',async t=>{
 const server=backend(),savedStorage=storage();server.prepareLoss('after');
 const pending=await fixture(t,{server,savedStorage});await pending.generate();await pending.save();
 const original=pending.records()[0].export_id;
 const completed=await fixture(t,{server,savedStorage});await completed.generate();await completed.save();
 assert.equal(completed.records().length,0);assert.ok(server.rows.get(original).completed);
 const prepares=server.writes.filter(write=>write.action==='prepare').length,uploads=server.uploads.length;
 await pending.save();
 assert.match(pending.notice(),/im Kundenordner gespeichert/);
 assert.equal(server.writes.filter(write=>write.action==='prepare').length,prepares,'A removed checkpoint must not authorize a prepare');
 assert.equal(server.writes.at(-1).action,'complete');assert.equal(server.writes.at(-1).input.export_id,original);
 assert.equal(server.uploads.length,uploads);assert.equal(server.rows.size,1);assert.equal(pending.records().length,0);
});

for(const completed of [false,true])test(`a replaced checkpoint only reconciles its original identity (${completed?'completed':'incomplete'})`,async t=>{
 const server=backend(),savedStorage=storage();server.uploadError('UPLOAD_EXPIRED');
 const pending=await fixture(t,{server,savedStorage});await pending.generate();await pending.save();
 const original=pending.records()[0].export_id;
 const replacement=await fixture(t,{server,savedStorage});await replacement.generate();await replacement.save();
 server.completeReply(()=>{server.completeReply(null);server.prepareLoss('after');return {ok:false,code:'EXPORT_INCOMPLETE'};});
 await replacement.restart();
 const current=replacement.records()[0].export_id;assert.notEqual(current,original);
 if(completed){server.uploaded.add(original);server.uploaded.add(server.rows.get(original).coverId);}
 const prepares=server.writes.filter(write=>write.action==='prepare').length,uploads=server.uploads.length;
 await pending.save();
 assert.equal(server.writes.filter(write=>write.action==='prepare').length,prepares);
 assert.equal(server.uploads.length,uploads);assert.equal(pending.records()[0].export_id,current);
 assert.equal(server.writes.at(-1).action,'complete');assert.equal(server.writes.at(-1).input.export_id,original);
 assert.match(pending.notice(),completed?/im Kundenordner gespeichert/:/anderen Fenster geändert/);
});

test('unknown completion after reload remains on the original identity without another upload',async t=>{
 const server=backend(),savedStorage=storage();server.completeLoss('before');
 const first=await fixture(t,{server,savedStorage});await first.generate();await first.save();const original=first.records()[0].export_id;first.view.destroy();
 server.completeReply(()=>{throw Error('Offline status');});
 const second=await fixture(t,{server,savedStorage});await second.generate();await second.save();await second.save();
 assert.equal(server.uploads.length,2);assert.equal(server.rows.size,1);assert.equal(second.records()[0].export_id,original);
 assert.equal(second.$('restartExpiredExport').hidden,true);
});

test('a malformed incomplete response after reload cannot authorize an upload',async t=>{
 const server=backend(),savedStorage=storage();server.prepareLoss('after');
 const first=await fixture(t,{server,savedStorage});await first.generate();await first.save();first.view.destroy();
 server.completeReply(()=>({ok:false,code:'EXPORT_INCOMPLETE',can_publish:true}));
 const second=await fixture(t,{server,savedStorage});await second.generate();await second.save();
 assert.equal(server.uploads.length,0);assert.equal(second.$('restartExpiredExport').hidden,true);
});

for(const change of [{asset:id(90)},{revision:'version:2'},{draftRevision:2},{media:'changed media bytes'},{cover:'changed cover bytes'},{cover:null}]){
 test(`changed output or binding cannot reuse an open export: ${JSON.stringify(change)}`,async t=>{
  const server=backend(),savedStorage=storage();server.prepareLoss('after');
  const first=await fixture(t,{server,savedStorage});await first.generate();await first.save();const original=first.records()[0].export_id;first.view.destroy();
  const second=await fixture(t,{server,savedStorage,...change});await second.generate();await second.save();
  const latest=server.writes.filter(write=>write.action==='prepare').at(-1).input;
  assert.notEqual(latest.export_id,original);
  assert.equal(second.records().filter(record=>record.export_id===original).length,change.draftRevision>1?0:1,
   'Only a freshly confirmed newer draft may remove a superseded identity; changed output or other bindings must preserve it');
 });
}

async function seedEarlierDrafts(savedStorage){
 const {createExportCheckpoints}=await import('../app/assets/media-export-checkpoint.mjs');let sequence=50000;
 const client=createExportCheckpoints({storage:()=>savedStorage,locks:()=>locks,uuid:()=>id(++sequence)});
 for(let draft_revision=0;draft_revision<32;draft_revision++)await client.reserve({owner:ownerId,asset_id:id(2),asset_revision:'version:1',draft_revision,media_kind:'video',
  outputs:{media:{sha256:'a'.repeat(64),size_bytes:100},cover:{sha256:'b'.repeat(64),size_bytes:20}}});
}

test('explicit Save freshly verifies the current draft before pruning superseded recovery records',async t=>{
 const savedStorage=storage();await seedEarlierDrafts(savedStorage);let saving=false,verifiedForSave=false;
 const write=savedStorage.setItem;savedStorage.setItem=(key,value)=>{assert.ok(verifiedForSave,'Pruning requires a fresh Save-time draft read');write(key,value);};
 const f=await fixture(t,{savedStorage,draftRevision:32,draftReply:reply=>{if(saving)verifiedForSave=true;return reply;}});
 await f.generate();assert.equal(f.records().length,32);assert.equal(f.server.writes.length,0);
 f.server.prepareLoss('before');saving=true;await f.save();
 assert.equal(verifiedForSave,true);assert.equal(f.records().length,1);assert.equal(f.records()[0].draft_revision,32);
 assert.equal(f.server.writes.length,1);assert.equal(f.server.writes[0].action,'prepare');assert.equal(f.server.uploads.length,0);
});

for(const mode of ['changed','unavailable'])test(`Save cannot prune when its fresh draft verification is ${mode}`,async t=>{
 const savedStorage=storage();await seedEarlierDrafts(savedStorage);let saving=false;
 const original=[...savedStorage.values.values()][0];
 const f=await fixture(t,{savedStorage,draftRevision:32,draftReply:reply=>{
  if(!saving)return reply;
  if(mode==='changed')return {...reply,revision:33};
  throw Error('Draft unavailable');
 }});
 await f.generate();saving=true;await f.save();
 assert.equal([...savedStorage.values.values()][0],original);assert.equal(f.server.writes.length,0);assert.equal(f.server.uploads.length,0);
 if(mode==='changed')assert.match(f.notice(),/Entwurf wurde inzwischen geändert/);
});

test('logout preserves only the old owner metadata; another owner cannot resume that export',async t=>{
 const savedStorage=storage(),firstServer=backend();firstServer.prepareLoss('after');
 const first=await fixture(t,{savedStorage,server:firstServer});await first.generate();await first.save();const original=first.records()[0];
 first.setOwner(id(99));await first.save();
 assert.equal(firstServer.writes.length,1);
 const other=await fixture(t,{savedStorage,expectedOwnerId:id(99)});await other.generate();await other.save();
 assert.notEqual(other.server.writes[0].input.export_id,original.export_id);
 assert.ok(other.records().some(record=>record.export_id===original.export_id&&record.owner===ownerId));
 const returned=await fixture(t,{savedStorage,server:firstServer});await returned.generate();await returned.save();
 assert.equal(firstServer.rows.size,1);assert.ok(firstServer.rows.get(original.export_id).completed);
});

for(const mode of ['read','write'])test(`unavailable browser ${mode} prevents an untracked prepare or upload`,async t=>{
 const savedStorage=storage();savedStorage.mode(mode);
 const f=await fixture(t,{savedStorage});await f.generate();await f.save();
 assert.equal(f.server.writes.length,0);assert.equal(f.server.uploads.length,0);
 assert.match(f.notice(),/Wiederaufnahme.*nicht sicher/);assert.equal(f.$('downloadExport').hasAttribute('href'),true);
 savedStorage.mode(null);await f.save();assert.equal(f.server.rows.size,1);
});

test('a corrupted prior checkpoint blocks a new identity without deleting the evidence',async t=>{
 const savedStorage=storage();savedStorage.values.set('sma.media-export.pending.v1.'+ownerId,'{broken');
 const f=await fixture(t,{savedStorage});await f.generate();await f.save();
 assert.equal(f.server.writes.length,0);assert.equal(savedStorage.values.values().next().value,'{broken');
 assert.match(f.notice(),/nicht sicher/);
});

test('missing and busy browser locks fail before any preparation',async t=>{
 for(const lockManager of [null,{request:async(_name,_options,callback)=>callback(null)}]){
  const f=await fixture(t,{lockManager});await f.generate();await f.save();
  assert.equal(f.server.writes.length,0);assert.equal(f.server.uploads.length,0);
  assert.match(f.notice(),lockManager?/anderen SMA-Fenster/:/aktuellen Browser/);
 }
});

test('a local file-job deadline is not evidence for a new upload identity',async t=>{
 const f=await fixture(t);f.server.uploadError('FILE_JOB_EXPIRED');await f.generate();await f.save();
 const original=f.records()[0].export_id;await f.save();
 assert.equal(f.records()[0].export_id,original);assert.equal(f.$('restartExpiredExport').hidden,true);
 assert.match(f.notice(),/Lade den Editor neu/);
});

test('confirmed upload expiry offers an explicit replacement only after a fresh incomplete response',async t=>{
 const f=await fixture(t);f.server.uploadError('UPLOAD_EXPIRED');await f.generate();await f.save();
 const original=f.records()[0].export_id;
 assert.equal(f.records()[0].expired,true);assert.equal(f.$('restartExpiredExport').hidden,false);
 assert.match(f.notice(),/Bereits übertragene Dateien können/);
 await f.save();assert.equal(f.records()[0].export_id,original,'Ordinary retry must keep the expired identity');
 f.server.uploadError(null);await f.restart();
 const latest=f.server.writes.filter(write=>write.action==='prepare').at(-1).input.export_id;
 assert.notEqual(latest,original);assert.equal(f.server.rows.size,2);assert.equal(f.records().length,0);
 assert.ok(f.server.rows.get(latest).completed);
});

test('unknown expiry reconciliation cannot offer or create a replacement',async t=>{
 const f=await fixture(t);f.server.uploadError('UPLOAD_EXPIRED');f.server.completeReply(()=>{throw Error('Offline');});
 await f.generate();await f.save();
 assert.equal(f.records()[0].expired,false);assert.equal(f.$('restartExpiredExport').hidden,true);
 assert.equal(f.server.rows.size,1);
});

test('an expired attempt that completed elsewhere is recovered before replacing its identity',async t=>{
 const f=await fixture(t);f.server.uploadError('UPLOAD_EXPIRED');await f.generate();await f.save();
 const original=f.records()[0].export_id,row=f.server.rows.get(original);
 f.server.uploaded.add(original);f.server.uploaded.add(row.coverId);f.server.uploadError(null);
 await f.restart();
 assert.equal(f.server.rows.size,1);assert.ok(row.completed);assert.equal(f.records().length,0);
 assert.equal(f.$('restartExpiredExport').hidden,true);
});
