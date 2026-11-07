const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const model=import('../app/assets/publication-cover-history-model.mjs');
const date='2026-11-06T12:01:00Z';
const row=cover=>({id:'ab660000-0000-4000-8000-000000000001',platform:'youtube',title:'Video',target_name:'Channel',status:'private_complete',created_at:date,updated_at:date,cover});
const response=e=>({ok:true,version:3,month:'2026-11',timezone:'Europe/Vienna',summary:{orders:1,public_confirmed:0,platforms:[e.platform]},months:[],entries:[e],has_more:false,next:null});
test('cover history accepts only projected status and date, keeps video status independent',async()=>{
 const {readPublicationCoverHistory,historyCoverStatuses}=await model;
 for(const status of Object.keys(historyCoverStatuses)){
  const cover={status,updated_at:['not_recorded','not_applicable'].includes(status)?null:date};
  const e=row({...cover,token:'secret',plan:{drive_file_id:'secret'}});if(status==='timestamp_sent')e.platform='tiktok';
  const r=readPublicationCoverHistory(response(e));assert.deepEqual(r.entries[0].cover,cover);assert.equal(r.entries[0].status,'private_complete');assert.equal(r.summary.public_confirmed,0);
 }
 assert.doesNotMatch(historyCoverStatuses.timestamp_sent[0],/bestätigt/);assert.match(historyCoverStatuses.timestamp_sent[1],/nicht separat/);
});
test('order caption keeps exact plain text and ignores unavailable or malformed snapshots',async()=>{
 const {readPublicationCoverHistory}=await model;
 const entry=row({status:'not_recorded',updated_at:null});
 for(const caption of ['Erste Zeile.\n\n#SMA\nhttps://example.test/alt','😀'.repeat(1250)]){
  assert.equal(readPublicationCoverHistory(response({...entry,order_caption:caption})).entries[0].order_caption,caption);
 }
 for(const value of [undefined,null,{},['Text'],'  \n','😀'.repeat(1251)]){
  const result=readPublicationCoverHistory(response({...entry,order_caption:value}));
  assert.equal(result.entries[0].order_caption,null);assert.equal(result.entries[0].status,entry.status);
 }
 const sql=fs.readFileSync('supabase/sql/publication-history-order-caption.sql','utf8');
 const migrations=fs.readdirSync('supabase/migrations').filter(x=>x.endsWith('_publication_history_order_caption_v1.sql'));
 assert.equal(migrations.length,1);assert.equal(fs.readFileSync('supabase/migrations/'+migrations[0],'utf8'),sql);
});
test('cover history rejects missing, wrong-portal, ambiguous and malformed statuses',async()=>{
 const {readPublicationCoverHistory}=await model;
 for(const cover of [null,[],{}, {status:'published',updated_at:date},{status:'__proto__',updated_at:date},{status:'complete',updated_at:null},{status:'none',updated_at:'yesterday'},{status:'not_recorded',updated_at:date},{status:'timestamp_sent',updated_at:date}])assert.throws(()=>readPublicationCoverHistory(response(row(cover))));
 const wrong=row({status:'complete',updated_at:date});wrong.platform='tiktok';assert.throws(()=>readPublicationCoverHistory(response(wrong)));
 const unchecked=row({status:'complete',updated_at:date});unchecked.status='checked';assert.throws(()=>readPublicationCoverHistory(response(unchecked)));
 assert.throws(()=>readPublicationCoverHistory({...response(row({status:'complete',updated_at:date})),version:2}));
});
test('cover history SQL and migration are identical, bounded read-only and grants are explicit',()=>{
 const sql=fs.readFileSync('supabase/sql/publication-cover-history.sql','utf8');
 assert.doesNotMatch(sql,/\b(insert into|update .* set|delete from|http_post|http_get|publication_provider_cover_request_v1|sma_publication_provider_v1)\b/i);
 assert.match(sql,/publication_history_read_v2\(p_input\)/);assert.match(sql,/j\.user_id=uid and j\.customer_id=/);
 const files=fs.readdirSync('supabase/migrations').filter(x=>x.endsWith('_publication_cover_history_v1.sql'));assert.equal(files.length,1);assert.equal(fs.readFileSync('supabase/migrations/'+files[0],'utf8'),sql);
});
