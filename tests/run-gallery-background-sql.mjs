import {checkSoundtrackProduct} from './sql-runtime/gallery-product-context-checks.mjs';
import {backgroundFlow} from './sql-runtime/gallery-background-flow.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';

const db=new PGlite(),sql=name=>readFile('supabase/sql/'+name+'.sql','utf8');
const value=async(query,args=[])=>(await db.query(query,args)).rows[0]?.v;
const uid=randomUUID(),sha='a'.repeat(64),render='render/'+sha+'/'+'b'.repeat(64)+'.aac';
const rpc=(action,input)=>value('select public.sma_gallery_background_v1($1,$2) v',[action,input]);
const pick=()=>value('select sma_private.gallery_background_pick_v1() v');
async function file(n,name='clip.mp4'){
 return value(`insert into sma_private.publication_files_v1(customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes)
 values(1,$1,$2,$4,'video','video/mp4',$3,now(),2048) returning id v`,[uid,'file_fixture_'+n,'sha256:'+sha+':1',name]);
}
try{
 await db.exec(await readFile('tests/sql-runtime/music-library-fixture.sql','utf8'));
 await db.exec("alter table public.sma_kunden add column paket text,add column n8n_kunde_id text,add column kunde_email text;grant select on public.sma_kunden to service_role;");
 await db.exec((await sql('publication-preview')).split('-- Definer is needed')[0]);
 await db.exec((await sql('publication-files')).split('-- Metadata precheck')[0]);
 for(const n of ['publication-device-upload','publication-asset-preview','music-credits','gallery-music','gallery-music-receipt'])await db.exec(await sql(n));
 // Only the scheduler and network transport are local substitutes.
 await db.exec(`create schema cron;create schema net;create table net.sent(body jsonb,url text);
 create function cron.schedule(text,text,text) returns int language sql as 'select 1';
 create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds int) returns bigint language sql as
 $$insert into net.sent values($2,$1) returning 1::bigint$$;`);
 await db.exec(await sql('gallery-music-background'));
 await db.exec(await sql('gallery-music-windows-aac-mime'));
 assert.equal(await value("select 'audio/vnd.dlna.adts'=any(allowed_mime_types) v from storage.buckets where id='sma-katalog'"),true);
 await db.exec(await sql('gallery-music-scheduled-probe'));
 await db.exec('insert into sma_private.gallery_background_probe_v1(singleton) values(true)');
 assert.equal(Number(await value('select sma_private.gallery_background_tick_v1() v')),1);
 assert.equal(await value('select sma_private.gallery_background_tick_v1() v'),null);
 const smoke=await value('select body v from net.sent');const takenProbe=await rpc('take',smoke);
 assert.equal(takenProbe.probe,true);assert.equal((await rpc('take',smoke)).ok,false);
 const evidence={id:takenProbe.id,receipt:takenProbe.receipt};
 assert.equal((await rpc('probe_receipt',{...evidence,sha256:sha})).ok,false);
 const fixture=JSON.parse(await readFile('n8n/publishing/fixtures/gallery-music-probe.json'));
 assert.equal((await rpc('probe_receipt',{...evidence,sha256:fixture.expected})).ok,true);
 await db.exec('truncate net.sent');
 await db.query("insert into public.sma_kunden values(1,$1,true,false,true,'Alpha','fixture','owner@example.invalid')",[uid]);
 await file(1);assert.equal(await pick(),null);
 await db.query("insert into sma_private.music_catalog_v1(sha256,name,mime_type,size_bytes,listed) values($1,'Test','audio/wav',200,true)",[sha]);
 await db.query("insert into storage.objects values('sma-katalog',$1,$2)",[sha+'.wav',{size:200,mimetype:'audio/wav'}]);
 await db.query("insert into storage.objects values('sma-katalog',$1,$2)",[render,{size:10000,mimetype:'audio/aac'}]);
 assert.equal(await value('select sma_private.gallery_background_tick_v1() v'),null);
 assert.equal(await value('select count(*)::int v from net.sent'),0);
 // The Windows browser reports ADTS bytes as audio/vnd.dlna.adts. It is still
 // the same hash-bound .aac sidecar, not a new format or a broader wildcard.
 await db.query("update storage.objects set metadata=jsonb_set(metadata,'{mimetype}',to_jsonb($1::text)) where bucket_id='sma-katalog' and name=$2",['audio/vnd.dlna.adts',render]);
 await db.exec("update public.sma_kunden set paket='Delta'");
 await db.exec('set role authenticated');
 await assert.rejects(()=>rpc('take',{id:randomUUID(),ticket:randomUUID()}),/permission denied/);
 await assert.rejects(()=>pick(),/permission denied/);
 await db.exec('reset role');
 assert.equal(Number(await value('select sma_private.gallery_background_tick_v1() v')),1);
 // Existing audio/aac sidecars must still work for subsequent customers/jobs.
 await db.query("update storage.objects set metadata=jsonb_set(metadata,'{mimetype}',to_jsonb($1::text)) where bucket_id='sma-katalog' and name=$2",['audio/aac',render]);
 const ticket=await value('select body v from net.sent');
 assert.equal(await pick(),null);
 const take=()=>rpc('take',ticket);
 assert.equal((await rpc('take',{...ticket,ticket:randomUUID()})).ok,false);
 await db.exec('set role service_role');
 const first=await take();assert.equal(first.can_publish,false);assert.equal(first.audio_path,render);assert.equal(first.drive_file_id,'file_fixture_1');
 assert.equal((await take()).ok,false);
 const bound={id:first.id,lease:first.lease};
 assert.equal((await rpc('check',{...bound,lease:randomUUID()})).ok,false);
 assert.equal((await rpc('check',bound)).ok,true);
 await db.exec('reset role');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
 assert.equal((await value("select public.sma_gallery_music_v1('claim','{}') v")).state,'busy');
 await db.exec("update public.sma_kunden set paket='Beta'");
 assert.equal((await rpc('reserve',{...bound,sha256:sha,size_bytes:5000})).ok,false);
 await db.exec("update public.sma_kunden set paket='Delta'");
 const u=await rpc('reserve',{...bound,sha256:sha,size_bytes:5000});assert.equal(u.initialize,true);assert.equal(u.upload_id,first.id);
 assert.equal((await rpc('reserve',{...bound,sha256:'c'.repeat(64),size_bytes:5000})).code,'OUTPUT_CHANGED');
 assert.equal((await rpc('fallback',bound)).ok,false);
 await db.exec("update sma_private.gallery_music_v1 set lease_until=now()-interval '1 second'");
 assert.equal((await value("select public.sma_gallery_music_v1('claim','{}') v")).state,'idle');
 const retry=await pick();const taken=await rpc('take',retry);assert.equal(taken.id,first.id);assert.equal(taken.audio_path,render);assert.notEqual(taken.lease,first.lease);
 await db.exec("update sma_private.gallery_music_v1 set background_attempts=5,lease_until=now()-interval '1 second'");
 assert.equal(await pick(),null);assert.equal(await value('select state v from sma_private.gallery_music_v1 where id=$1',[first.id]),'check_upload');
 await file(2);const second=await rpc('take',await pick());assert.equal((await rpc('fallback',{id:second.id,lease:second.lease})).ok,true);
 assert.equal(await pick(),null);const browser=await value("select public.sma_gallery_music_v1('claim','{}') v");
 assert.equal(browser.id,second.id);assert.equal(await value('select background_audio v from sma_private.gallery_music_v1 where id=$1',[second.id]),null);
 assert.equal((await value("select public.sma_music_credits_v1('overview','{}') v")).credits,0);
 const jobId=await backgroundFlow({db,value,pick,uid,sha,file,browserJob:browser});
 await checkSoundtrackProduct({db,value,sql,uid,jobId});
 // Test-only titles are withdrawn once the first technical gallery proof is done.
 // A new silent customer file may remain pending, but must not trigger n8n
 // or spend credits while no official catalogue title is listed.
 const third=await file(27,'no-published-music.mp4');
 assert.equal(await value("select count(*)::int v from sma_private.gallery_music_v1 where source_id=$1 and state='pending'",[third]),1);
 const sentBefore=await value('select count(*)::int v from net.sent');
 await db.exec("update sma_private.music_catalog_v1 set listed=false where sha256='"+sha+"'");
 assert.equal(await value("select count(*)::int v from sma_private.music_catalog_ready_v1"),0);
 assert.equal(await value('select sma_private.gallery_background_tick_v1() v'),null);
 assert.equal(await value('select count(*)::int v from net.sent'),sentBefore);
 assert.equal(await value("select background_attempts v from sma_private.gallery_music_v1 where source_id=$1",[third]),0);
 assert.equal(await value("select state v from sma_private.gallery_music_v1 where source_id=$1",[third]),'pending');
 console.log('Background dispatch, package rights, ticket replay, cross-renderer retries, quota, fallback and unlisted-track gate passed.');
}finally{await db.close();}
