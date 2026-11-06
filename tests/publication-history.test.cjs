const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const model=import('../app/assets/publication-history-model.mjs');
const entry=(n=1,extra={})=>({id:'ab660000-0000-4000-8000-'+String(n).padStart(12,'0'),platform:'youtube',title:'A saved title',target_name:'Fixture channel',status:'checked',created_at:'2026-11-06T12:00:00+00:00',updated_at:'2026-11-06T12:01:00+00:00',...extra});
const result=(entries=[entry()],next=null)=>({ok:true,version:1,entries,has_more:!!next,next});
test('history accepts bounded pages and projects only visible fields',async()=>{
 const {readPublicationHistory}=await model;assert.deepEqual(readPublicationHistory(result([entry(1,{approval_token:'secret',session_url:'secret'})])),{entries:[entry()],next:null});
 assert.deepEqual(readPublicationHistory(result([])),{entries:[],next:null});
 const entries=Array.from({length:20},(_,i)=>entry(i+1));const next={before_at:entries[19].created_at,before_id:entries[19].id};assert.deepEqual(readPublicationHistory(result(entries,next)),{entries,next});
});
test('history rejects malformed, duplicated and ambiguous results',async()=>{
 const {readPublicationHistory}=await model;
 for(const value of [null,{ok:false},result([entry(),entry()]),result([entry(1,{status:'published'})]),result([entry(1,{platform:'__proto__'})]),result([entry(1,{created_at:'yesterday'})]),result([entry(1,{title:'x'.repeat(401)})]),result(Array.from({length:21},(_,i)=>entry(i+1))),result([entry()],{before_at:entry().created_at,before_id:entry().id}),{...result(),next:{}},{...result(),has_more:'false'}])assert.throws(()=>readPublicationHistory(value));
 const entries=Array.from({length:20},(_,i)=>entry(i+1));assert.throws(()=>readPublicationHistory(result(entries,{before_at:entry().created_at,before_id:entry().id})));
});
test('history never labels check success or uncertain completion as public',async()=>{
 const {historyStatuses}=await model;for(const status of ['prepared','approved','checked','complete_unknown','uncertain','needs_review'])assert.doesNotMatch(historyStatuses[status][0],/Öffentlich bestätigt/);
 assert.match(historyStatuses.checked[1],/keine Veröffentlichung bestätigt/);assert.match(historyStatuses.private_complete[0],/Privat/);assert.match(historyStatuses.public_confirmed[0],/Öffentlich bestätigt/);
});
test('history dashboard uses its own read-only endpoint and tears down on all auth paths',()=>{
 const source=fs.readFileSync('app/dashboard.html','utf8'),module=fs.readFileSync('app/assets/publication-history-dashboard.mjs','utf8');
 assert.match(source,/rpc\/sma_publication_history_v1/);assert.equal((source.match(/publicationHistory\?\.destroy\(\)/g)||[]).length,3);
 assert.doesNotMatch(module,/innerHTML|sma_publication_order|dispatcher|upload\(/);assert.match(module,/textContent/);
 const sql=fs.readFileSync('supabase/sql/publication-history.sql','utf8');assert.doesNotMatch(sql,/\b(insert into|update .* set|delete from|http_post|http_get|publication_order_view_v1)\b/i);
 const migrations=fs.readdirSync('supabase/migrations').filter(x=>x.endsWith('_publication_history_v1.sql'));assert.equal(migrations.length,1);assert.equal(fs.readFileSync('supabase/migrations/'+migrations[0],'utf8'),sql);
});
