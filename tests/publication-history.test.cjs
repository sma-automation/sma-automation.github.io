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
 assert.match(source,/rpc\/sma_publication_history_v2/);assert.equal((source.match(/publicationHistory\?\.destroy\(\)/g)||[]).length,3);
 assert.doesNotMatch(module,/innerHTML|sma_publication_order|dispatcher|upload\(/);assert.match(module,/textContent/);
 const sql=fs.readFileSync('supabase/sql/publication-history.sql','utf8');assert.doesNotMatch(sql,/\b(insert into|update .* set|delete from|http_post|http_get|publication_order_view_v1)\b/i);
 const migrations=fs.readdirSync('supabase/migrations').filter(x=>x.endsWith('_publication_history_v1.sql'));assert.equal(migrations.length,1);assert.equal(fs.readFileSync('supabase/migrations/'+migrations[0],'utf8'),sql);
});

const monthly=(entries=[entry()],extra={})=>({...result(entries),version:2,month:'2026-11',timezone:'Europe/Vienna',summary:{orders:entries.length,public_confirmed:0,platforms:entries.length?['youtube']:[]},months:entries.length?[{month:'2026-11',orders:entries.length}]:[],...extra});
test('monthly history validates totals independently of a loaded page and keeps v1 readable',async()=>{
 const {readPublicationHistoryMonths,readPublicationHistory}=await model;
 const r=readPublicationHistoryMonths(monthly([entry()],{summary:{orders:40,public_confirmed:2,platforms:['youtube','tiktok']}}));assert.equal(r.summary.orders,40);assert.equal(r.entries.length,1);assert.equal(readPublicationHistory(result()).entries.length,1);
 assert.equal(readPublicationHistoryMonths(monthly([],{month:null})).month,null);
});
test('monthly history rejects malformed counts, shortcuts, filters and unrelated rows',async()=>{
 const {readPublicationHistoryMonths}=await model;
 for(const change of [{month:'2026-13'},{month:undefined},{timezone:'UTC'},{summary:{orders:-1,public_confirmed:0,platforms:[]}},{summary:{orders:1,public_confirmed:2,platforms:['youtube']}},{summary:{orders:1,public_confirmed:0,platforms:['tiktok']}},{summary:{orders:5,public_confirmed:0,platforms:['youtube','youtube']}},{months:[{month:'2026-11',orders:0}]},{months:[{month:'2026-11',orders:1},{month:'2026-11',orders:1}]},{months:[{month:'2026-10',orders:1},{month:'2026-11',orders:1}]},{months:[{month:'<script>',orders:1}]}])assert.throws(()=>readPublicationHistoryMonths(monthly([entry()],change)));
});
test('monthly client applies the same Vienna winter and DST month boundaries as SQL',async()=>{
 const {readPublicationHistoryMonths}=await model;
 assert.equal(readPublicationHistoryMonths(monthly([entry(1,{created_at:'2026-10-31T23:00:00Z'})])).entries.length,1);
 assert.throws(()=>readPublicationHistoryMonths(monthly([entry(1,{created_at:'2026-10-31T22:59:59Z'})])));
 assert.equal(readPublicationHistoryMonths(monthly([entry(1,{created_at:'2026-03-31T22:00:00Z'})],{month:'2026-04'})).entries.length,1);
 assert.throws(()=>readPublicationHistoryMonths(monthly([entry(1,{created_at:'2026-03-31T22:00:00Z'})],{month:'2026-03'})));
});
test('monthly source and generated migration match and use only the existing journals',()=>{
 const sql=fs.readFileSync('supabase/sql/publication-history-months.sql','utf8');assert.doesNotMatch(sql,/\b(insert into|update .* set|delete from|http_post|http_get|publication_order_view_v1)\b/i);
 const files=fs.readdirSync('supabase/migrations').filter(x=>x.endsWith('_publication_history_months_v1.sql'));assert.equal(files.length,1);assert.equal(fs.readFileSync('supabase/migrations/'+files[0],'utf8'),sql);
});
