const test=require('node:test'),assert=require('node:assert/strict');
const id=n=>'ab115000-0000-4000-9000-'+String(n).padStart(12,'0');
const row=(n=1,extra={})=>({id:id(n),file_name:'Test.mp4',media_kind:'video',started_at:'2026-11-05T12:00:00Z',finished_at:'2026-11-05T12:01:00Z',status:'completed',error_code:null,...extra});
const response=(entries=[row()],extra={})=>({ok:true,version:1,timezone:'Europe/Vienna',month:'2026-11',can_publish:false,total:entries.length,entries,has_more:false,next:null,...extra});
test('analysis history accepts only coherent states and strips internal evidence',async()=>{
 const {readPublicationAnalysisHistory:read}=await import('../app/assets/publication-analysis-history-model.mjs');
 for(const status of ['completed','failed','processing','timed_out']){const entry=row(1,{status,finished_at:['completed','failed'].includes(status)?'2026-11-05T12:01:00Z':null,error_code:status==='failed'?'MAGIC_UNAVAILABLE':null,result:'private',attempt_id:id(22),content_sha256:'private'});const out=read(response([entry]));assert.equal(out.entries[0].status,status);assert.equal(out.entries[0].result,undefined);assert.equal(out.entries[0].attempt_id,undefined);assert.equal(out.entries[0].content_sha256,undefined);}
 for(const patch of [{status:'published'},{finished_at:null},{finished_at:'2026-11-05T11:00:00Z'},{error_code:'MAGIC_UNAVAILABLE'},{status:'timed_out'},{status:'failed',error_code:'raw provider message'},{file_name:'x'.repeat(501)},{id:'bad'},{media_kind:'audio'},{started_at:'2026-10-05T12:00:00Z'}])assert.throws(()=>read(response([row(1,patch)])),/INVALID_HISTORY/);
 for(const patch of [{can_publish:true},{can_publish:undefined},{version:2},{timezone:'UTC'},{total:-1},{has_more:true},{next:{}},{month:'bad'}])assert.throws(()=>read(response(undefined,patch)),/INVALID_HISTORY/);
 assert.throws(()=>read(response([row(),row()])),/INVALID_HISTORY/);
});
test('analysis history validates composite pagination and Vienna month boundaries',async()=>{
 const {readPublicationAnalysisHistory:read}=await import('../app/assets/publication-analysis-history-model.mjs');const rows=Array.from({length:20},(_,n)=>row(n));const next={before_at:rows.at(-1).started_at,before_id:rows.at(-1).id};assert.deepEqual(read(response(rows,{total:21,has_more:true,next})).next,next);
 assert.throws(()=>read(response(rows,{total:21,has_more:true,next:{...next,before_id:id(22)}})),/INVALID_HISTORY/);assert.throws(()=>read(response(rows.slice(1),{total:21,has_more:true,next})),/INVALID_HISTORY/);
 assert.equal(read(response([row(1,{started_at:'2026-10-31T23:00:00Z',finished_at:'2026-10-31T23:01:00Z'})])).entries.length,1);
 assert.equal(read(response([row(1,{started_at:'2026-03-31T22:00:00Z',finished_at:'2026-04-01T00:01:00Z'})],{month:'2026-04'})).entries.length,1);
});
