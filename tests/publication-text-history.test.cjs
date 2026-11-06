const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const model=import('../app/assets/publication-history-model.mjs');
const entry=(n=1,extra={})=>({preview_id:'ab660000-0000-4000-8000-'+String(n).padStart(12,'0'),revision:1,platform:'youtube',body:'A saved portal body',hashtags:null,recorded_at:'2026-11-06T12:00:00Z',...extra});
const result=(entries=[entry()],extra={})=>({ok:true,version:1,month:'2026-11',timezone:'Europe/Vienna',total:entries.length,entries,has_more:false,next:null,...extra});
test('text history distinguishes platforms and revisions and projects only saved text fields',async()=>{
 const {readPublicationTextHistory}=await model;
 const entries=[entry(),entry(1,{revision:2}),entry(1,{platform:'tiktok'})];assert.deepEqual(readPublicationTextHistory(result(entries)).entries,entries);
 assert.deepEqual(readPublicationTextHistory(result([entry(1,{current_title:'not historical',token:'secret'})])).entries,[entry()]);
 assert.equal(readPublicationTextHistory(result([],{month:null})).total,0);
 assert.equal(readPublicationTextHistory(result([entry(1,{body:'😀'.repeat(1200)})])).entries.length,1);
});
test('text history rejects duplicate versions, wrong month, unsafe totals and cursor mismatch',async()=>{
 const {readPublicationTextHistory}=await model;
 for(const value of [null,result([entry(),entry()]),result([entry(1,{platform:'unknown'})]),result([entry(1,{platform:'__proto__'})]),result([entry(1,{revision:0})]),result([entry(1,{revision:1.2})]),result([entry(1,{body:'short'})]),result([entry(1,{body:'x'.repeat(1201)})]),result([entry(1,{recorded_at:'2026-10-31T22:59:59Z'})]),result([],{total:-1}),result([],{month:'2026-13'}),result([],{next:{}}),result([entry()],{has_more:true,next:{}})])assert.throws(()=>readPublicationTextHistory(value));
 const entries=Array.from({length:20},(_,i)=>entry(i+1)),last=entries.at(-1),next={before_at:last.recorded_at,before_id:last.preview_id,before_revision:last.revision,before_platform:last.platform};
 assert.deepEqual(readPublicationTextHistory(result(entries,{has_more:true,total:21,next})).next,next);
 for(const field of Object.keys(next))assert.throws(()=>readPublicationTextHistory(result(entries,{has_more:true,total:21,next:{...next,[field]:'bad'}})));
});
test('historical hashtags distinguish unknown, empty and recorded values without using current tags',async()=>{
 const {readPublicationTextHistory}=await model;
 for(const tags of [null,[],['Café','Welt_1','界'],['x'.repeat(50)]]){
  const raw=entry(1,{hashtags:tags,current_hashtags:['Today']});
  const parsed=readPublicationTextHistory(result([raw])).entries[0];assert.deepEqual(parsed.hashtags,tags);
  if(tags!==null){assert.notEqual(parsed.hashtags,tags);tags.push('Changed');assert.notDeepEqual(parsed.hashtags,tags);}
 }
 const legacy=entry();delete legacy.hashtags;assert.equal(readPublicationTextHistory(result([legacy])).entries[0].hashtags,null);
});
test('historical hashtag validation rejects malformed, unsafe, duplicate and noncanonical snapshots',async()=>{
 const {readPublicationTextHistory}=await model;
 for(const hashtags of [{},'tag',[1],[null],[''],['a','b','c','d'],['A','a'],['Café','Cafe\u0301'],['Cafe\u0301'],['#tag'],['x'.repeat(51)],['<img src=x>'],['a b'],['x\u202e']])assert.throws(()=>readPublicationTextHistory(result([entry(1,{hashtags})])));
});
test('hashtag history migration preserves historical rows and the existing request surface',()=>{
 const sql=fs.readFileSync('supabase/sql/publication-text-history-hashtags.sql','utf8');
 const files=fs.readdirSync('supabase/migrations').filter(x=>x.endsWith('_publication_text_history_hashtags_v1.sql'));assert.equal(files.length,1);assert.equal(fs.readFileSync('supabase/migrations/'+files[0],'utf8'),sql);
 assert.doesNotMatch(sql,/\b(update\s+sma_private|delete from|create.+function public\.|publication_orders_v1|http_post|http_get)\b/i);
 assert.match(sql,/on conflict do nothing/);
});
test('text source matches its generated migration and cannot call generation or provider endpoints',()=>{
 const sql=fs.readFileSync('supabase/sql/publication-text-history.sql','utf8');assert.doesNotMatch(sql,/\b(insert into|update .* set|delete from|http_post|http_get|publication_preview_request_v1)\b/i);
 const files=fs.readdirSync('supabase/migrations').filter(x=>x.endsWith('_publication_text_history_v1.sql'));assert.equal(files.length,1);assert.equal(fs.readFileSync('supabase/migrations/'+files[0],'utf8'),sql);
 const module=fs.readFileSync('app/assets/publication-text-history-dashboard.mjs','utf8');assert.doesNotMatch(module,/innerHTML|dispatcher|upload\(/);assert.match(fs.readFileSync('app/dashboard.html','utf8'),/rpc\/sma_publication_text_history_v1/);
});
