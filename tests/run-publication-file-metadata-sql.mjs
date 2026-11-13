import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
const owner = randomUUID();
const catalogFile = {
  drive_file_id: 'syntheticVideoFixture', name: 'Fixture.mp4', media_kind: 'video',
  mime_type: 'video/mp4', size_bytes: '1000', revision: 'sha256:' + 'a'.repeat(64) + ':1',
  modified_at: '2026-11-13T12:00:00Z', width_px: null, height_px: null, duration_ms: null
};
const measured = {...catalogFile, width_px: 1280, height_px: 720, duration_ms: 3000};
const measurements = [1280, 720, 3000];
const unknown = [null, null, null];
const sql = name => readFile(new URL('../supabase/' + name, import.meta.url), 'utf8');

async function sync(file) {
  const lease = randomUUID();
  await db.query('update sma_private.publication_file_sync_v1 set lease_id=$1,lease_until=now()+interval \'1 minute\',started_at=now() where user_id=$2', [lease, owner]);
  const {rows} = await db.query('select public.sma_publication_files_finish_v1($1,$2,$3) as result', [owner, lease, JSON.stringify([file])]);
  assert.deepEqual(rows[0].result, {ok:true, count:1});
}
async function dimensions(expected) {
  const {rows} = await db.query('select width_px,height_px,duration_ms from sma_private.publication_files_v1 where customer_id=1 and drive_file_id=$1', [catalogFile.drive_file_id]);
  assert.deepEqual(Object.values(rows[0]), expected);
}

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema sma_private;
    create table public.sma_kunden(id bigint primary key,user_id uuid,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean,n8n_kunde_id text,kunde_email text);
    create table sma_private.publication_previews_v1(id uuid primary key);
  `);
  await db.exec((await sql('sql/publication-files.sql')).split('-- Metadata precheck')[0]);
  await db.exec((await sql('sql/publication-device-upload.sql')).split('create or replace function')[0]);
  await db.exec(await sql('migrations/20261113163000_publication_verified_file_metadata_v1.sql'));
  await db.query("insert into public.sma_kunden values (1,$1,true,true,false,'test','test@example.invalid')", [owner]);
  await db.query("insert into sma_private.publication_file_sync_v1(user_id,customer_id,n8n_kunde_id,kunde_email) values($1,1,'test','test@example.invalid')", [owner]);
  await sync(catalogFile); await dimensions(unknown);
  await sync(measured); await sync(catalogFile); await dimensions(measurements);
  await sync({...catalogFile, width_px:1280}); await dimensions(measurements);
  await sync({...catalogFile, width_px:1920}); await dimensions([1920,null,null]);

  for (const changed of [
    {revision: measured.revision.slice(0,-1) + '2'},
    {revision: 'sha256:' + 'b'.repeat(64) + ':1'},
    {size_bytes:'1001'}, {mime_type:'video/quicktime'}
  ]) {
    await sync(measured);
    await sync({...catalogFile, ...changed});
    await dimensions(unknown);
  }
  for (const revision of ['md5:' + '1'.repeat(32) + ':1', 'version:1']) {
    await sync({...measured, revision});
    await sync({...catalogFile, revision});
    await dimensions(unknown);
  }
  await sync(measured);
  await db.query('update sma_private.publication_files_v1 set user_id=$1', [randomUUID()]);
  await sync(catalogFile); await dimensions(unknown);
  await db.query('update sma_private.publication_files_v1 set user_id=$1', [owner]);

  // The independent device-upload completion can race a catalog refresh.
  await sync(measured);
  const uploadId = randomUUID();
  await db.query(`insert into sma_private.publication_uploads_v1(id,user_id,customer_id,n8n_kunde_id,kunde_email,name,mime_type,size_bytes,status,drive_file_id,folder_id)
    values ($1,$2,1,'test','test@example.invalid',$3,$4,$5,'ready',$6,'testFolder')`,
    [uploadId, owner, catalogFile.name, catalogFile.mime_type, catalogFile.size_bytes, catalogFile.drive_file_id]);
  const file = {...catalogFile, upload_id:uploadId, folder_id:'testFolder'};
  const finish = () => db.query('select public.sma_publication_upload_finish_v1($1,$2) as result', [uploadId, JSON.stringify(file)]);
  const first = (await finish()).rows[0].result;
  assert.equal(first.status, 'completed');
  assert.equal(first.can_publish, false);
  assert.deepEqual((await finish()).rows[0].result, first);
  await dimensions(measurements);
  for (const fn of ['sma_publication_upload_finish_v1(uuid,jsonb)','sma_publication_files_finish_v1(uuid,uuid,jsonb,text)']) {
    const {rows} = await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') as client,has_function_privilege('anon',$1,'EXECUTE') as anonymous,has_function_privilege('service_role',$1,'EXECUTE') as worker", ['public.' + fn]);
    assert.deepEqual(rows[0], {client:false, anonymous:false, worker:true});
  }
  console.log('Catalog refresh and upload completion verified for measured, missing, conflicting, legacy and changed file metadata.');
} finally {
  await db.close();
}
