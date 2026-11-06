const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const model=import('../app/assets/publication-assignment-history-model.mjs');
const id=n=>'ab660000-0000-4000-9000-'+String(n).padStart(12,'0');
const entry=(n=1,extra={})=>({id:id(n),asset_id:id(91),preview_id:id(92),preview_revision:2,assignment_revision:3,asset_revision:'r1',platform:'youtube',file_name:'Saved filename.mp4',title:'Saved title',body:'Saved body',event_kind:'baseline',recorded_at:'2026-11-06T12:00:00Z',source_updated_at:'2026-10-04T09:00:00Z',...extra});
const result=(entries=[entry()],extra={})=>({ok:true,version:1,month:'2026-11',timezone:'Europe/Vienna',total:entries.length,entries,has_more:false,next:null,...extra});
test('assignment history displays snapshot time separately from original save time and strips private fields',async()=>{
 const {readPublicationAssignmentHistory}=await model;
 for(const event_kind of ['baseline','assigned','updated'])assert.deepEqual(readPublicationAssignmentHistory(result([entry(1,{event_kind,token:'private',user_id:id(9)})])).entries,[entry(1,{event_kind})]);
 assert.equal(readPublicationAssignmentHistory(result([],{month:null})).total,0);
 assert.equal(readPublicationAssignmentHistory(result([entry(1,{body:'😀'.repeat(1200)})])).entries.length,1);
});
test('assignment history rejects malformed snapshots, duplicate IDs, wrong-month data and cursor mismatch',async()=>{
 const {readPublicationAssignmentHistory:read}=await model;
 for(const value of [null,result([entry(),entry()]),result([entry(1,{event_kind:'__proto__'})]),result([entry(1,{platform:'unknown'})]),result([entry(1,{asset_id:'bad'})]),result([entry(1,{assignment_revision:0})]),result([entry(1,{preview_revision:1.5})]),result([entry(1,{body:'x'.repeat(1201)})]),result([entry(1,{file_name:'x'.repeat(501)})]),result([entry(1,{asset_revision:''})]),result([entry(1,{recorded_at:'2026-10-31T22:59:59Z'})]),result([entry(1,{source_updated_at:'bad'})]),result([],{month:'2026-13'}),result([],{total:-1}),result([],{next:{}}),result([entry()],{has_more:true,next:{}})])assert.throws(()=>read(value));
 const entries=Array.from({length:20},(_,i)=>entry(i)),last=entries.at(-1),next={before_at:last.recorded_at,before_id:last.id};
 assert.deepEqual(read(result(entries,{total:21,has_more:true,next})).next,next);
 for(const k of Object.keys(next))assert.throws(()=>read(result(entries,{total:21,has_more:true,next:{...next,[k]:'bad'}})));
});
test('assignment history migration is identical to source and the UI uses only its read RPC',()=>{
 const sql=fs.readFileSync('supabase/sql/publication-assignment-history.sql','utf8');
 const files=fs.readdirSync('supabase/migrations').filter(x=>x.endsWith('_publication_assignment_history_v1.sql'));assert.equal(files.length,1);assert.equal(fs.readFileSync('supabase/migrations/'+files[0],'utf8'),sql);
 assert.doesNotMatch(sql,/\b(http_post|http_get|publication_preview_request_v1)\b/);
 assert.doesNotMatch(fs.readFileSync('app/assets/publication-assignment-history-dashboard.mjs','utf8'),/innerHTML|dispatcher|upload\(/);
 assert.match(fs.readFileSync('app/dashboard.html','utf8'),/rpc\/sma_publication_assignment_history_v1/);
});
