const {test}=require('node:test');
const assert=require('node:assert/strict');
const modulePromise=import('../app/assets/media-export-checkpoint.mjs');
const id=n=>`cd880000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const binding={owner:id(1),asset_id:id(2),asset_revision:'sha256:'+ 'a'.repeat(64)+':1',draft_revision:4,media_kind:'video',
 outputs:{media:{sha256:'b'.repeat(64),size_bytes:1024},cover:{sha256:'c'.repeat(64),size_bytes:512}}};
async function fixture(){
 const {createExportCheckpoints}=await modulePromise;
 const values=new Map(),calls=[];let sequence=100,readError=false,writeError=false,overwrite=false,blocked=false;
 const storage={getItem(key){if(readError)throw Error('Blocked');return values.get(key)??null;},setItem(key,value){if(writeError)throw Error('Full');values.set(key,overwrite?'[]':value);}};
 const held=new Set(),locks={async request(name,options,action){
  calls.push({name,options});assert.equal(options.ifAvailable,true);
  if(blocked||held.has(name))return action(null);
  held.add(name);try{return await action({name});}finally{held.delete(name);}
 }};
 const make=()=>createExportCheckpoints({storage:()=>storage,locks:()=>locks,uuid:()=>id(++sequence)});
 return {client:make(),make,values,calls,readError:value=>{readError=value;},writeError:value=>{writeError=value;},overwrite:value=>{overwrite=value;},blocked:value=>{blocked=value;}};
}

test('metadata survives a fresh checkpoint client and contains only the fixed recovery fields',async()=>{
 const f=await fixture(),first=await f.client.reserve(binding),second=await f.make().reserve(binding);
 assert.equal(first.restored,false);assert.equal(second.restored,true);assert.deepEqual(second.record,first.record);
 assert.deepEqual(Object.keys(first.record).sort(),['owner','asset_id','asset_revision','draft_revision','media_kind','outputs','export_id','expired'].sort());
 assert.equal(first.record.expired,false);
 assert.doesNotMatch([...f.values.values()].join(''),/https:|blob:|access_token|name|upload_url/);
});

test('concurrent same-owner reservations cannot overwrite the identity already acquired in the other tab',async()=>{
 const f=await fixture();
 const results=await Promise.allSettled([f.client.reserve(binding),f.make().reserve(binding)]);
 const fulfilled=results.filter(result=>result.status==='fulfilled');assert.ok(fulfilled.length>=1);
 for(const result of results.filter(result=>result.status==='rejected'))assert.equal(result.reason.code,'EXPORT_CHECKPOINT_BUSY');
 const repeated=await f.make().reserve(binding);
 assert.ok(fulfilled.every(result=>result.value.record.export_id===repeated.record.export_id));
 assert.equal(JSON.parse([...f.values.values()][0]).length,1);
});

test('a new owner, binding, revision or output keeps its own separate identity',async()=>{
 const f=await fixture(),original=await f.client.reserve(binding);
 for(const patch of [{owner:id(9)},{asset_id:id(8)},{asset_revision:'another'},
  {outputs:{...binding.outputs,media:{...binding.outputs.media,size_bytes:1025}}},{draft_revision:5}]){
  const changed=await f.client.reserve({...binding,...patch});
  assert.notEqual(changed.record.export_id,original.record.export_id);assert.equal(changed.restored,false);
 }
 assert.equal((await f.client.reserve(binding)).record.export_id,original.record.export_id);
});

test('a known pending record remains reusable when the browser cannot accept a new write',async()=>{
 const f=await fixture(),first=await f.client.reserve(binding);f.writeError(true);
 assert.equal((await f.client.reserve(binding)).record.export_id,first.record.export_id);
 await assert.rejects(f.client.reserve({...binding,draft_revision:5}),error=>error.code==='EXPORT_CHECKPOINT_UNAVAILABLE');
 assert.equal(f.client.current(first.record).export_id,first.record.export_id);
});

test('read errors, corrupt metadata and overwrites fail closed without a replacement',async()=>{
 const f=await fixture(),first=await f.client.reserve(binding),key=[...f.values.keys()][0],original=f.values.get(key);
 f.readError(true);await assert.rejects(f.client.reserve(binding),error=>error.code==='EXPORT_CHECKPOINT_UNAVAILABLE');
 f.readError(false);f.values.set(key,'not json');await assert.rejects(f.client.reserve(binding),error=>error.code==='EXPORT_CHECKPOINT_UNAVAILABLE');
 assert.equal(f.values.get(key),'not json');
 f.values.set(key,original);f.overwrite(true);
 await assert.rejects(f.client.reserve({...binding,draft_revision:5}),error=>error.code==='EXPORT_CHECKPOINT_CHANGED');
 assert.throws(()=>f.client.current(first.record),error=>error.code==='EXPORT_CHECKPOINT_CHANGED');
});

test('the bounded pending list never evicts an unresolved earlier attempt',async()=>{
 const f=await fixture(),records=[];
 for(let n=0;n<32;n++)records.push((await f.client.reserve({...binding,draft_revision:n})).record);
 await assert.rejects(f.client.reserve({...binding,draft_revision:32}),error=>error.code==='EXPORT_CHECKPOINT_LIMIT');
 assert.equal(JSON.parse([...f.values.values()][0]).length,32);
 assert.equal((await f.client.reserve({...binding,draft_revision:0})).record.export_id,records[0].export_id);
 await f.client.complete(records[0]);await f.client.reserve({...binding,draft_revision:32});
 assert.equal(JSON.parse([...f.values.values()][0]).length,32);
});

test('a confirmed newer draft replaces 32 superseded checkpoints of the same asset',async()=>{
 const f=await fixture();
 for(let n=0;n<32;n++)await f.client.reserve({...binding,draft_revision:n});
 const latest=await f.client.reserve({...binding,draft_revision:32},undefined,{confirmedDraftRevision:32});
 const stored=JSON.parse([...f.values.values()][0]);
 assert.deepEqual(stored,[latest.record]);assert.equal(latest.restored,false);
});

test('absent or mismatching draft confirmation cannot evict superseded checkpoints',async()=>{
 const f=await fixture();
 for(let n=0;n<32;n++)await f.client.reserve({...binding,draft_revision:n});
 const original=[...f.values.values()][0];
 for(const options of [undefined,{}, {confirmedDraftRevision:31},{confirmedDraftRevision:'32'},{confirmedDraftRevision:32.5}]){
  await assert.rejects(f.client.reserve({...binding,draft_revision:32},undefined,options),error=>error.code==='EXPORT_CHECKPOINT_LIMIT');
  assert.equal([...f.values.values()][0],original);
 }
});

test('confirmed pruning preserves current output variants, other assets, asset revisions and owners',async()=>{
 const f=await fixture(),old=[];
 for(const draft_revision of [0,1])old.push((await f.client.reserve({...binding,draft_revision})).record);
 const retained=[];
 for(const patch of [{outputs:{...binding.outputs,media:{...binding.outputs.media,sha256:'d'.repeat(64)}}},
  {asset_id:id(90),draft_revision:0},{asset_revision:'another',draft_revision:0},{owner:id(99),draft_revision:0}]){
  retained.push((await f.client.reserve({...binding,...patch})).record);
 }
 const newest=await f.client.reserve(binding,undefined,{confirmedDraftRevision:binding.draft_revision});
 const all=[...f.values.values()].flatMap(value=>JSON.parse(value));
 for(const previous of old)assert.ok(!all.some(record=>record.export_id===previous.export_id));
 for(const previous of [...retained,newest.record])assert.deepEqual(all.find(record=>record.export_id===previous.export_id),previous);
 assert.equal(all.length,5);
});

test('an exact identity remains restorable when optional superseded cleanup cannot write',async()=>{
 const f=await fixture(),old=await f.client.reserve({...binding,draft_revision:0}),current=await f.client.reserve(binding);
 const original=[...f.values.values()][0];f.writeError(true);
 const restored=await f.client.reserve(binding,undefined,{confirmedDraftRevision:binding.draft_revision});
 assert.equal(restored.restored,true);assert.equal(restored.record.export_id,current.record.export_id);
 await assert.rejects(f.client.reserve({...binding,draft_revision:5},undefined,{confirmedDraftRevision:5}),error=>error.code==='EXPORT_CHECKPOINT_UNAVAILABLE');
 assert.equal([...f.values.values()][0],original);assert.equal(f.client.current(old.record).export_id,old.record.export_id);
});

test('a higher stored draft blocks stale new identities and cannot be pruned by them',async()=>{
 const f=await fixture();await f.client.reserve({...binding,draft_revision:5},undefined,{confirmedDraftRevision:5});
 const original=[...f.values.values()][0];
 for(const options of [undefined,{confirmedDraftRevision:binding.draft_revision}]){
  await assert.rejects(f.client.reserve(binding,undefined,options),error=>error.code==='EXPORT_CHECKPOINT_CHANGED');
  assert.equal([...f.values.values()][0],original);
 }
});

test('replacement requires the exact expired record and late completion cannot erase its successor',async()=>{
 const f=await fixture(),first=await f.client.reserve(binding);
 await assert.rejects(f.client.replaceExpired(first.record),error=>error.code==='EXPORT_CHECKPOINT_CHANGED');
 const expired=await f.client.expire(first.record),next=await f.client.replaceExpired(expired);
 assert.equal(next.expired,false);assert.notEqual(next.export_id,first.record.export_id);
 await f.client.complete(first.record);
 assert.equal(f.client.current(next).export_id,next.export_id);
 await assert.rejects(f.client.replaceExpired(expired),error=>error.code==='EXPORT_CHECKPOINT_CHANGED');
 assert.ok(f.calls.every(call=>call.options.mode==='exclusive'&&call.options.ifAvailable===true));
});

test('abort and a busy metadata lock cannot create a recovery record',async()=>{
 const f=await fixture(),controller=new AbortController();controller.abort(new DOMException('Stopped','AbortError'));
 await assert.rejects(f.client.reserve(binding,controller.signal),error=>error.name==='AbortError');
 f.blocked(true);await assert.rejects(f.client.reserve(binding),error=>error.code==='EXPORT_CHECKPOINT_BUSY');
 assert.equal(f.values.size,0);
});

test('malformed persisted records cannot become an accepted recovery reference',async()=>{
 const f=await fixture(),first=await f.client.reserve(binding),key=[...f.values.keys()][0];
 for(const patch of [{owner:id(99)},{asset_id:[binding.asset_id]},{export_id:'not a UUID'},{export_id:[first.record.export_id]},{expired:'true'},{token:'must not be stored'},
  {outputs:{...binding.outputs,media:{sha256:'invalid',size_bytes:1024}}},
  {outputs:{...binding.outputs,media:{sha256:[binding.outputs.media.sha256],size_bytes:1024}}}]){
  f.values.set(key,JSON.stringify([{...first.record,...patch}]));
  await assert.rejects(f.client.reserve(binding),error=>error.code==='EXPORT_CHECKPOINT_UNAVAILABLE');
 }
});
