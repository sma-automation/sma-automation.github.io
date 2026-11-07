import assert from 'node:assert/strict';
import {checkExportReference} from './sql-runtime/export-reference-checks.mjs';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
const load = name => readFile(new URL('../supabase/sql/' + name, import.meta.url), 'utf8');
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.value;
const hash = 'a'.repeat(64);
const revision = 'sha256:' + hash + ':2';
const tech = {
  schema: 'sma-video-technical-v1', decode: 'complete', video_codec: 'h264', pixel_format: 'yuv420p',
  width_px: 720, height_px: 1280, frame_rate_num: 30, frame_rate_den: 1, decoded_frames: 90,
  min_frame_interval_us: 33333, max_frame_interval_us: 33334, video_bit_rate_bps: 2100000,
  audio_codec: 'aac', audio_sample_rate_hz: 44100, audio_channels: 1, audio_bit_rate_bps: 63000
};
const probe = {source:'local_ffmpeg', asset_revision:revision, sha256:hash, size_bytes:12000,
  duration_ms:3000, audio_status:'extracted', technical:tech};
const read = () => first('select sma_private.publication_video_technical_v1(f) value from sma_private.publication_files_v1 f');
const save = p => db.query('update sma_private.publication_editor_exports_v1 set local_probe=$1', [JSON.stringify(p)]);

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema sma_private; grant usage on schema sma_private to service_role, authenticated;
    create table public.sma_kunden(id bigint primary key, user_id uuid, aktiv boolean,
      demo_delta_aktiv boolean, zahlung_bestaetigt boolean, n8n_kunde_id text, kunde_email text);
    insert into public.sma_kunden values(1,gen_random_uuid(),true,true,false,'fixture','fixture@example.test');
  `);
  await db.exec((await load('publication-preview.sql')).split('-- Definer is needed only')[0]);
  await db.exec((await load('publication-files.sql')).split('-- Metadata precheck')[0]);
  await db.exec((await load('publication-editor-exports.sql')).split('create or replace function')[0]);
  await db.exec((await load('publication-magic-effect.sql')).split('create or replace function')[0]);
  await db.exec(await load('publication-video-technical.sql'));
  await db.exec(await load('publication-media-profiles.sql'));
  await db.exec(`create function sma_private.publication_review_summary_v1(f sma_private.publication_files_v1)
    returns jsonb language sql as $$ select '{"status":"unreviewed"}'::jsonb $$;`);
  await db.exec(await load('publication-export-probe.sql'));
  await db.query(`insert into sma_private.publication_files_v1(customer_id,user_id,drive_file_id,name,
    media_kind,mime_type,revision,modified_at,size_bytes,duration_ms,width_px,height_px)
    select id,user_id,'fixture-drive','fixture.mp4','video','video/mp4',$1,now(),12000,3000,720,1280 from public.sma_kunden`,[revision]);
  await db.query(`insert into sma_private.publication_editor_exports_v1
    (id,user_id,customer_id,asset_id,asset_revision,draft_revision,settings,outputs,media_asset_id,completed_at)
    select gen_random_uuid(),user_id,customer_id,gen_random_uuid(),'source',1,'{}',$1,id,now()
    from sma_private.publication_files_v1`, [JSON.stringify({media:{sha256:hash,size_bytes:12000}})]);
  assert.equal(await read(),null);
  await save(probe);
  assert.deepEqual(await read(),tech);
  for (const platform of ['youtube','tiktok']) {
    const media=await first('select sma_private.publication_media_precheck_v1(f,$1) value from sma_private.publication_files_v1 f',[platform]);
    assert.equal(media.can_publish,false);
    assert.equal(media.checks.find(c=>c.code==='BINARY_INSPECTION').status,'pass');
    assert.match(media.checks.find(c=>c.code==='BINARY_INSPECTION').message,/Lokale FFmpeg/);
    assert.equal(media.checks.find(c=>c.code==='SEMANTIC_REVIEW_PENDING').status,'pending');
    assert.equal(media.checks.find(c=>c.code==='CONTENT_REVIEW_PENDING').status,'pending');
  }
  for (const bad of [{sha256:'b'.repeat(64)},{size_bytes:1},{source:null},{audio_status:'no_audio_stream'},
                     {technical:{...tech, decoded_frames:0}}]) {
    await assert.rejects(()=>save({...probe,...bad}),/constraint/);
  }
  for (const change of [
    "update sma_private.publication_files_v1 set revision=revision||'0'",
    'update sma_private.publication_files_v1 set size_bytes=size_bytes+1',
    'update sma_private.publication_files_v1 set available=false',
    'update sma_private.publication_editor_exports_v1 set customer_id=2',
    'update sma_private.publication_editor_exports_v1 set user_id=gen_random_uuid()',
    'update public.sma_kunden set aktiv=false',
    `insert into sma_private.publication_magic_results_v1(asset_id,asset_revision,policy_version,
      user_id,customer_id,n8n_kunde_id,kunde_email,status)
      select f.id,f.revision,'magic-video-2026-11-03.1',f.user_id,f.customer_id,
      c.n8n_kunde_id,c.kunde_email,'failed' from sma_private.publication_files_v1 f join public.sma_kunden c on c.id=f.customer_id`
  ]) {
    await db.exec('begin'); await db.exec(change); assert.equal(await read(),null); await db.exec('rollback');
  }
  for (const role of ['authenticated','anon','service_role']) {
    assert.equal(await first("select has_column_privilege($1,'sma_private.publication_editor_exports_v1','local_probe','UPDATE') value",[role]),false);
  }
  assert.equal(await first("select sma_private.publication_video_technical_valid_v1($1,'extracted') value",[JSON.stringify(tech)]),false);
  assert.equal(await first("select sma_private.publication_video_technical_valid_v1($1,'transcribed') value",[JSON.stringify(tech)]),true);
  await checkExportReference({db,load,first,probe,save});
  console.log('Export probe and reference SQL passed for both portals, isolation, stale evidence and legacy validation.');
} finally { await db.close(); }
