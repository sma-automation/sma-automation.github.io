import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
const sha = n => n.toString(16).padStart(64,'0');
const uid = n => '00000000-0000-4000-8000-'+String(n).padStart(12,'0');
async function customer(n, fn) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(n)]);
  await db.exec('set role authenticated');
  try { return await fn(); } finally { await db.exec('reset role'); }
}
const request = async (action,input={}) => (await db.query('select public.sma_music_credits_v1($1,$2) as r',[action,input])).rows[0].r;
const countObjects = async () => (await db.query("select count(*)::int n from storage.objects where bucket_id='sma-katalog'")).rows[0].n;
try {
  await db.exec(await readFile('tests/sql-runtime/music-library-fixture.sql','utf8'));
  await db.exec('grant usage on schema sma_private to service_role; alter table public.sma_kunden add column paket text;');
  await db.exec(await readFile('supabase/sql/music-credits.sql','utf8'));
  await db.exec(await readFile('supabase/sql/music-clip-rights-catalog.sql','utf8'));
  for (const [n,plan] of [[1,'alpha'],[2,'delta']]) {
    await db.query('insert into public.sma_kunden values ($1,$2,true,false,true,$3)',[n,uid(n),plan]);
  }
  for(const [i,state] of [[10,'pending'],[20,'test_only']]) {
    await db.query('insert into sma_private.music_sources_v1(source_sha,title,rights_status) values($1,$2,$3)',[sha(i),'Aufnahme '+i,state]);
  }
  for(const [i,src] of [[1,10],[2,10],[3,20],[4,null]]) {
    if(src) await db.query("insert into sma_private.music_clips_v1 values($1,$2,$3,array['Sport'],'Episch','Intro',2500)",[sha(i),sha(src),'Clip '+i]);
    await db.query("insert into sma_private.music_catalog_v1(sha256,name,mime_type,size_bytes,listed) values($1,$2,'audio/wav',1200,true)",[sha(i),'Clip '+i]);
    await db.query("insert into storage.objects values('sma-katalog',$1,$2)",[sha(i)+'.wav',{size:1200,mimetype:'audio/wav'}]);
  }
  assert.equal((await customer(2,()=>request('overview'))).tracks.length,0);
  assert.equal(await customer(2,countObjects),0);
  assert.equal((await customer(1,()=>request('unlock',{sha256:sha(1)}))).code,'TRACK_UNAVAILABLE');
  await assert.rejects(()=>db.query("update sma_private.music_sources_v1 set rights_status='cleared' where source_sha=$1",[sha(10)]));
  await db.query("update sma_private.music_sources_v1 set rights_status='cleared', evidence_ref='private fixture', customer_clip_and_video_rights=true, cleared_at=now()-interval '2 days' where source_sha=$1",[sha(10)]);
  const visible=await customer(2,()=>request('overview'));
  assert.equal(visible.tracks.length,2);assert.equal(visible.tracks[0].source_title,'Aufnahme 10');
  assert.deepEqual(visible.tracks[0].topics,['Sport']);assert.equal(visible.tracks[0].duration_ms,2500);
  assert.equal(await customer(2,countObjects),2);assert.equal(await customer(1,countObjects),0);
  await db.query("insert into sma_private.music_credit_packs_v1(customer_id,user_id,state) values(1,$1,'paid')",[uid(1)]);
  for(const i of [1,2]) assert.equal((await customer(1,()=>request('unlock',{sha256:sha(i)}))).ok,true);
  assert.equal((await customer(1,()=>request('overview'))).credits,9);
  assert.equal(await customer(1,countObjects),2);
  await db.query("update sma_private.music_sources_v1 set valid_until=now()-interval '1 day' where source_sha=$1",[sha(10)]);
  assert.equal((await customer(1,()=>request('overview'))).tracks.length,0);
  assert.equal(await customer(2,countObjects),0);
  await db.query("update sma_private.music_sources_v1 set rights_status='pending',valid_until=null where source_sha=$1",[sha(10)]);
  assert.equal(await customer(1,countObjects),0);
  console.log('Rights, test-only material, missing evidence, expiry, withdrawal, direct reads, metadata and sibling unlocks passed.');
} finally {await db.close();}
