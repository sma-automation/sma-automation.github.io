const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=import('../app/assets/publication-history-find.mjs');
const id='ab660000-0000-4000-9000-000000000091';
const result=()=>({ok:true,version:1,entries:[{id,title:'Hotel-Türgriff Demo',platform:'youtube',status:'prepared',created_at:'2026-11-06T12:00:00Z'}],has_more:false,can_upload:false,can_publish:false});
test('history find parser accepts only bounded, owner-authorized server output shapes',async()=>{
 const {readHistoryFind:read}=await load;
 assert.deepEqual(read(result()).entries.map(x=>x.id),[id]);
 assert.equal(read({...result(),has_more:true}).has_more,true);
 assert.equal(read({...result(),entries:[]}).entries.length,0);
 for(const patch of [{ok:false},{version:2},{can_upload:true},{can_publish:true},{has_more:null},{entries:null},{entries:[...result().entries,...result().entries]}])
  assert.throws(()=>read({...result(),...patch}),/HISTORY_FIND_INVALID/);
});
test('history search never renders arbitrary status or malformed IDs',async()=>{
 const {readHistoryFind:read}=await load;
 for(const patch of [{id:'insecure'},{title:3},{title:'x'.repeat(181)},{platform:'twitter'},{status:'published'},{created_at:'yesterday'}]){
  assert.throws(()=>read({...result(),entries:[{...result().entries[0],...patch}]}),/HISTORY_FIND_INVALID/);
 }
 assert.throws(()=>read({...result(),entries:Array.from({length:21},(_,i)=>({...result().entries[0],id:'ab660000-0000-4000-9000-'+String(i).padStart(12,'0')}))}),/HISTORY_FIND_INVALID/);
});

test('search accepts 180 Unicode characters as returned by the database',async()=>{
 const {readHistoryFind:read}=await load;
 const title='🎬'.repeat(180),row={...result().entries[0],title,status:'uncertain'};
 assert.equal(read({...result(),entries:[row]}).entries[0].title,title);
 assert.throws(()=>read({...result(),entries:[{...row,title:title+'a'}]}),/HISTORY_FIND_INVALID/);
});

test('search preparation windows are optional and only accepted for matching order states',async()=>{
 const {readHistoryFind}=await load;
 const parse=(status,window)=>readHistoryFind({...result(),entries:[{...result().entries[0],status,window}]}).entries[0];
 const deadline={status:'recheck',expires_at:'2026-11-13T17:44:00+00:00'};
 assert.deepEqual(parse('prepared',deadline).window,deadline);
 assert.equal(parse('prepared',undefined).window,undefined);
 for(const [status,window] of [['checked',deadline],['preparing',deadline],['prepared',{...deadline,status:'confirmed'}],['prepared',{...deadline,expires_at:'yesterday'}]]){
  assert.throws(()=>parse(status,window),/HISTORY_FIND_INVALID/);
 }
});
