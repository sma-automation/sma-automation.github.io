import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';

const sql = name => readFile(new URL('../supabase/sql/' + name, import.meta.url), 'utf8');
const report = await sql('launch-readiness-readonly.sql');
const db = new PGlite();
const blocked = 'BLOCKED_NO_EXPLICIT_APPROVAL';
const manual = 'MANUAL_PROVIDER_E2E_REVIEW_REQUIRED';
let galleryChecks = 0;

async function check(total, current, state) {
  const { rows: [{ readiness }] } = await db.query(report);
  assert.equal(readiness.publishing.operator_permissions, total);
  assert.equal(readiness.publishing.current_bound_operator_permissions, current);
  assert.equal(readiness.publishing.state, state);
  assert.equal(readiness.allows_publication, false);
  assert.equal(readiness.initiates_checkout, false);
}

async function checkGallery(expected) {
  await db.exec('BEGIN READ ONLY');
  try {
    const snapshot = async () => (await db.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM sma_private.gallery_music_v1 g) AS jobs,
      (SELECT jsonb_agg(to_jsonb(e)) FROM sma_private.publication_gallery_technical_v1 e) AS evidence,
      (SELECT jsonb_agg(to_jsonb(t)) FROM sma_private.music_catalog_v1 t) AS tracks`)).rows;
    const before = await snapshot();
    const {rows:[{readiness}]} = await db.query(report);
    assert.equal(readiness.version,6);
    const media=readiness.media;
    for (const [key,value] of Object.entries(expected)) assert.equal(media[key],value,key);
    assert.equal(media.gallery_music_jobs,media.gallery_completed_jobs+media.gallery_pending_jobs+media.gallery_other_jobs);
    assert.equal(media.gallery_pending_jobs,media.gallery_pending_due_jobs+media.gallery_pending_scheduled_jobs+media.gallery_pending_unscheduled_jobs);
    assert.ok(media.gallery_pending_without_track<=media.gallery_pending_jobs);
    assert.ok(media.gallery_pending_with_failures<=media.gallery_pending_jobs);
    assert.equal(media.music_customer_state,media.music_listed_tracks===0
      ? (media.gallery_pending_jobs>0?'NO_LISTED_TRACK_FOR_PENDING_JOBS':'NO_LISTED_TRACK')
      : (media.gallery_pending_due_jobs>0?'GALLERY_DUE_WORK_NEEDS_REVIEW':
          'LISTED_TRACK_NOT_AUDIO_OR_LICENSE_E2E_VERIFIED'));
    assert.equal(media.music_customer_e2e,'NOT_VERIFIED_BY_THIS_QUERY');
    assert.ok(media.gallery_completed_without_record<=media.gallery_completed_jobs);
    assert.equal(media.gallery_completed_without_current_evidence,
      media.gallery_completed_jobs-media.gallery_current_revision_evidence_jobs);
    assert.ok(media.gallery_completed_without_current_evidence>=media.gallery_completed_without_record);
    assert.equal(media.gallery_evidence_state,media.gallery_completed_jobs===0?
      'NO_COMPLETED_GALLERY_JOB':media.gallery_current_revision_evidence_jobs<media.gallery_completed_jobs?
      'CURRENT_GALLERY_EVIDENCE_REQUIRED':'REVISION_BOUND_EVIDENCE_PRESENT_NOT_PUBLISH_PERMISSION');
    assert.equal(readiness.allows_publication,false);
    assert.equal(readiness.initiates_checkout,false);
    assert.equal(readiness.requires_personal_approval,true);
    assert.equal(readiness.external_e2e_status,'NOT_VERIFIED_BY_THIS_QUERY');
    assert.doesNotMatch(JSON.stringify(readiness),/60600000|gallery_job_id|next_attempt|access_token|drive_file_id/);
    assert.deepEqual(await snapshot(),before);
    galleryChecks++;
  } finally {await db.exec('ROLLBACK');}
}

try {
  await db.exec(`
    CREATE SCHEMA sma_private;
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE TABLE public.sma_kunden (
      id bigint PRIMARY KEY, aktiv boolean, zahlung_bestaetigt boolean,
      demo_delta_aktiv boolean, n8n_kunde_id text
    );
    CREATE TABLE sma_private.onboarding_n8n_accounts_v1 (n8n_row_id bigint);
    CREATE TABLE sma_private.onboarding_payment_settings_v1 (enabled boolean);
    CREATE TABLE public.sma_bestellungen (ist_testbestellung boolean);
    CREATE TABLE sma_private.publication_files_v1 (
      id uuid PRIMARY KEY, customer_id bigint, user_id uuid, revision text, size_bytes bigint,
      available boolean, verified_at timestamptz);
    CREATE TABLE sma_private.publication_gallery_technical_v1 (
      gallery_job_id uuid, asset_id uuid, source_asset_id uuid, user_id uuid,
      customer_id bigint, asset_revision text, source_revision text,
      sha256 text, source_sha256 text, size_bytes bigint);
    CREATE TABLE sma_private.gallery_music_v1 (
      id uuid PRIMARY KEY, state text, next_attempt timestamptz,
      source_id uuid, result_id uuid, user_id uuid, customer_id bigint,
      source_key text, expected_sha text, expected_size bigint,
      track_sha text, failures integer);
    CREATE TABLE sma_private.music_catalog_v1 (listed boolean);
    CREATE TABLE sma_private.customer_websites_v1 (published_at timestamptz);
    CREATE TABLE sma_private.website_provider_connections_v1 ();
  `);
  await db.exec((await sql('publication-orders.sql')).split('-- Only an order has')[0]);
  const journal = await sql('publication-provider-journal.sql');
  await db.exec(journal.split('create or replace function sma_private.publication_provider_session_valid_v1')[0]);

  // One transaction fixes now() so both edges of the permission interval can be checked exactly.
  await db.exec(`
    BEGIN;
    INSERT INTO public.sma_kunden (id,aktiv,zahlung_bestaetigt,demo_delta_aktiv) VALUES (1, true, false, true);
    INSERT INTO sma_private.publication_orders_v1
      (id, user_id, customer_id, binding, draft, choices, state, approved_at)
    VALUES
      ('00000000-0000-4000-8000-000000000001', gen_random_uuid(), 1, '{}', '{}', '{}', 'checked', now()),
      ('00000000-0000-4000-8000-000000000002', gen_random_uuid(), 1, '{}', '{}', '{}', 'prepared', NULL);
  `);
  await check(0, 0, blocked);
  // An unrelated approved order cannot activate a permission on an unapproved order.
  await db.exec(`
    INSERT INTO sma_private.publication_provider_permissions_v1 (order_id, fingerprint, expires_at)
    SELECT o.id, sma_private.publication_provider_fingerprint_v1(o), now() + interval '5 minutes'
    FROM sma_private.publication_orders_v1 o WHERE o.state = 'prepared'
  `);
  await check(1, 0, blocked);
  await db.exec(`
    INSERT INTO sma_private.publication_provider_permissions_v1 (order_id, fingerprint, expires_at)
    SELECT o.id, sma_private.publication_provider_fingerprint_v1(o), now() + interval '5 minutes'
    FROM sma_private.publication_orders_v1 o WHERE o.state = 'checked'
  `);
  await check(2, 1, manual);
  const variations = [
    "UPDATE sma_private.publication_provider_permissions_v1 SET expires_at = now()",
    "UPDATE sma_private.publication_provider_permissions_v1 SET created_at = now() + interval '1 minute'",
    "UPDATE sma_private.publication_orders_v1 SET choices = '{\"visibility\":\"private\"}'",
    "UPDATE sma_private.publication_orders_v1 SET state = 'cancelled'",
    "UPDATE sma_private.publication_orders_v1 SET approved_at = NULL"
  ];
  for (const change of variations) {
    await db.exec('SAVEPOINT variant');
    await db.exec(change);
    await check(2, 0, blocked);
    await db.exec('ROLLBACK TO SAVEPOINT variant');
  }
  await db.exec('ROLLBACK');

  // Isolated metadata fixtures only; never render media or call a registration function.
  await checkGallery({gallery_music_jobs:0,gallery_completed_without_record:0,
    gallery_current_revision_evidence_jobs:0,gallery_completed_without_current_evidence:0,
    gallery_evidence_state:'NO_COMPLETED_GALLERY_JOB',music_listed_tracks:0,
    gallery_pending_without_track:0,gallery_pending_with_failures:0,
    music_customer_state:'NO_LISTED_TRACK'});
  const completed='60600000-0000-4000-8000-000000000001';
  const pending='60600000-0000-4000-8000-000000000002';
  await db.exec(`INSERT INTO sma_private.gallery_music_v1 (id,state,next_attempt) VALUES
    ('${completed}','completed',NULL),('${pending}','pending',now()-interval '1 hour'),
    ('60600000-0000-4000-8000-000000000003','pending',now()+interval '1 hour'),
    ('60600000-0000-4000-8000-000000000004','pending',now()+interval '2 hours');
    INSERT INTO sma_private.music_catalog_v1 VALUES(false);`);
  await checkGallery({gallery_music_jobs:4,gallery_completed_jobs:1,gallery_pending_jobs:3,
    gallery_pending_due_jobs:1,gallery_pending_scheduled_jobs:2,gallery_pending_unscheduled_jobs:0,
    gallery_other_jobs:0,gallery_completed_without_record:1,gallery_current_revision_evidence_jobs:0,
    gallery_completed_without_current_evidence:1,gallery_evidence_state:'CURRENT_GALLERY_EVIDENCE_REQUIRED',
    gallery_technical_records:0,music_listed_tracks:0,
    gallery_pending_without_track:3,gallery_pending_with_failures:0,
    music_customer_state:'NO_LISTED_TRACK_FOR_PENDING_JOBS'});
  await db.exec("INSERT INTO sma_private.publication_gallery_technical_v1 (gallery_job_id) VALUES('60600000-0000-4000-8000-000000000099')");
  await checkGallery({gallery_technical_records:1,gallery_completed_without_record:1});
  await db.query('INSERT INTO sma_private.publication_gallery_technical_v1 (gallery_job_id) VALUES($1)',[completed]);
  await checkGallery({gallery_technical_records:2,gallery_completed_without_record:0,gallery_completed_jobs:1});
  // Duplicate synthetic evidence cannot multiply the completed-job count.
  await db.query('INSERT INTO sma_private.publication_gallery_technical_v1 (gallery_job_id) VALUES($1)',[completed]);
  await checkGallery({gallery_technical_records:3,gallery_completed_without_record:0,
    gallery_completed_jobs:1,gallery_current_revision_evidence_jobs:0,
    gallery_completed_without_current_evidence:1});
  // Historical job-ID-only evidence is not sufficient; both CURRENT files,
  // owner, SHA, size and the saved receipt must still agree.
  const sourceId='60600000-0000-4000-8000-000000000091';
  const resultId='60600000-0000-4000-8000-000000000092';
  const ownerId='60600000-0000-4000-8000-000000000090';
  const sourceSha='b'.repeat(64),resultSha='a'.repeat(64);
  const sourceRevision='sha256:'+sourceSha+':1';
  const resultRevision='sha256:'+resultSha+':2';
  await db.query(`INSERT INTO sma_private.publication_files_v1
    (id,customer_id,user_id,revision,size_bytes,available)
    VALUES ($1,1,$2,$3,100,true),($4,1,$2,$5,120,true)`,
    [sourceId,ownerId,sourceRevision,resultId,resultRevision]);
  await db.query(`UPDATE sma_private.gallery_music_v1
    SET source_id=$1,result_id=$2,customer_id=1,user_id=$3,
    source_key=$4,expected_sha=$5,expected_size=120 WHERE id=$6`,
    [sourceId,resultId,ownerId,'sha256:'+sourceSha,resultSha,completed]);
  await db.query(`UPDATE sma_private.publication_gallery_technical_v1
    SET asset_id=$1,source_asset_id=$2,customer_id=1,user_id=$3,
    asset_revision=$4,source_revision=$5,sha256=$6,source_sha256=$7,
    size_bytes=120 WHERE gallery_job_id=$8`,
    [resultId,sourceId,ownerId,resultRevision,sourceRevision,resultSha,sourceSha,completed]);
  await checkGallery({gallery_completed_jobs:1,
    gallery_current_revision_evidence_jobs:1,gallery_completed_without_current_evidence:0,
    gallery_evidence_state:'REVISION_BOUND_EVIDENCE_PRESENT_NOT_PUBLISH_PERMISSION'});
  await db.query('UPDATE sma_private.publication_files_v1 SET revision=$2 WHERE id=$1',
    [resultId,'sha256:'+'c'.repeat(64)+':3']);
  await checkGallery({gallery_current_revision_evidence_jobs:0,
    gallery_completed_without_current_evidence:1,gallery_completed_without_record:0});
  await db.query('UPDATE sma_private.publication_files_v1 SET revision=$2 WHERE id=$1',
    [resultId,resultRevision]);
  await db.query('UPDATE sma_private.publication_files_v1 SET revision=$2 WHERE id=$1',
    [sourceId,'sha256:'+'d'.repeat(64)+':4']);
  await checkGallery({gallery_current_revision_evidence_jobs:0,
    gallery_completed_without_current_evidence:1,gallery_completed_without_record:0});
  await db.query('UPDATE sma_private.publication_files_v1 SET revision=$2 WHERE id=$1',
    [sourceId,sourceRevision]);
  await db.query('UPDATE sma_private.publication_files_v1 SET customer_id=2 WHERE id=$1',
    [resultId]);
  await checkGallery({gallery_current_revision_evidence_jobs:0,
    gallery_completed_without_current_evidence:1});
  await db.query('UPDATE sma_private.publication_files_v1 SET customer_id=1 WHERE id=$1',
    [resultId]);
  await db.query('UPDATE sma_private.publication_files_v1 SET available=false WHERE id=$1',
    [resultId]);
  await checkGallery({gallery_current_revision_evidence_jobs:0,
    gallery_completed_without_current_evidence:1});
  await db.query('UPDATE sma_private.publication_files_v1 SET available=true WHERE id=$1',
    [resultId]);
  await checkGallery({gallery_current_revision_evidence_jobs:1,
    gallery_completed_without_current_evidence:0});
  await db.query("UPDATE sma_private.gallery_music_v1 SET state='pending',next_attempt=now()-interval '1 hour' WHERE id=$1",[completed]);
  await checkGallery({gallery_completed_jobs:0,gallery_pending_jobs:4,gallery_pending_due_jobs:2,gallery_completed_without_record:0});
  await db.query("UPDATE sma_private.gallery_music_v1 SET state='completed',next_attempt=NULL WHERE id=$1",[completed]);
  await db.query('UPDATE sma_private.gallery_music_v1 SET next_attempt=NULL WHERE id=$1',[pending]);
  await checkGallery({gallery_pending_jobs:3,gallery_pending_due_jobs:0,gallery_pending_scheduled_jobs:2,gallery_pending_unscheduled_jobs:1});
  await db.query("UPDATE sma_private.gallery_music_v1 SET state='check_upload' WHERE id=$1",[pending]);
  await checkGallery({gallery_pending_jobs:2,gallery_other_jobs:1,gallery_pending_unscheduled_jobs:0});
  await db.query('UPDATE sma_private.gallery_music_v1 SET state=NULL WHERE id=$1',[pending]);
  await checkGallery({gallery_pending_jobs:2,gallery_other_jobs:1});
  await db.exec('UPDATE sma_private.music_catalog_v1 SET listed=true');
  await checkGallery({music_listed_tracks:1,gallery_completed_without_record:0,
    music_customer_state:'GALLERY_DUE_WORK_NEEDS_REVIEW'});
  await db.exec("UPDATE sma_private.gallery_music_v1 SET failures=2 WHERE state='pending'");
  await checkGallery({gallery_pending_with_failures:2,music_customer_state:'GALLERY_DUE_WORK_NEEDS_REVIEW'});
  await db.exec('INSERT INTO sma_private.music_catalog_v1 VALUES(false),(NULL)');
  await checkGallery({music_listed_tracks:1});
  await db.query('DELETE FROM sma_private.gallery_music_v1 WHERE id=$1',[completed]);
  await checkGallery({gallery_music_jobs:3,gallery_completed_jobs:0,gallery_completed_without_record:0,gallery_technical_records:3});
  // The publication-permission account was rolled back above. Set up an
  // independent, eligible synthetic fixture for the account coverage checks.
  await db.exec(`INSERT INTO public.sma_kunden (id,aktiv,zahlung_bestaetigt,demo_delta_aktiv)
    VALUES (1,true,false,true)`);
  const accountReadiness=async()=> (await db.query(report)).rows[0].readiness;
  let onboarding=(await accountReadiness()).accounts;
  assert.equal(onboarding.new_onboarding_profiles,0);
  assert.equal(onboarding.new_profiles_waiting_for_n8n_link,0);
  assert.equal(onboarding.new_profiles_with_n8n_link,0);
  assert.equal(onboarding.with_n8n_reference,0);
  assert.equal(onboarding.entitled_with_n8n_reference,0);
  assert.equal(onboarding.entitled_without_n8n_reference,1);
  assert.equal(onboarding.automatic_first_payment_setting,null);
  assert.equal(onboarding.onboarding_state,'ENTITLED_N8N_REFERENCE_REVIEW_REQUIRED');

  await db.exec(`INSERT INTO sma_private.onboarding_n8n_accounts_v1 VALUES(NULL),(12);
    INSERT INTO sma_private.onboarding_payment_settings_v1 VALUES(true);
    INSERT INTO public.sma_kunden (id,aktiv,zahlung_bestaetigt,demo_delta_aktiv,n8n_kunde_id)
    VALUES (7,false,false,false,'kunde_synthetic_not_a_real_account');`);
  onboarding=(await accountReadiness()).accounts;
  assert.equal(onboarding.new_onboarding_profiles,2);
  assert.equal(onboarding.new_profiles_waiting_for_n8n_link,1);
  assert.equal(onboarding.new_profiles_with_n8n_link,1);
  assert.equal(onboarding.with_n8n_reference,1);
  assert.equal(onboarding.entitled_with_n8n_reference,0); // Inactive reference is not eligible.
  assert.equal(onboarding.entitled_without_n8n_reference,1);
  assert.equal(onboarding.automatic_first_payment_setting,true);
  assert.equal(onboarding.onboarding_state,'MANUAL_N8N_LINK_PENDING');
  assert.equal(onboarding.drive_folder_access,'NOT_VERIFIED_BY_THIS_QUERY');
  assert.equal(onboarding.first_paid_customer_e2e,'NOT_VERIFIED_BY_THIS_QUERY');
  assert.doesNotMatch(JSON.stringify(await accountReadiness()),/kunde_synthetic_not_a_real_account/);
  await db.exec('UPDATE sma_private.onboarding_n8n_accounts_v1 SET n8n_row_id=13 WHERE n8n_row_id IS NULL');
  onboarding=(await accountReadiness()).accounts;
  assert.equal(onboarding.new_profiles_waiting_for_n8n_link,0);
  assert.equal(onboarding.new_profiles_with_n8n_link,2);
  assert.equal(onboarding.onboarding_state,'ENTITLED_N8N_REFERENCE_REVIEW_REQUIRED');
  // A reference fixes only the aggregate coverage warning, not Drive access or E2E.
  await db.exec("UPDATE public.sma_kunden SET n8n_kunde_id='synthetic_linked_01' WHERE id=1");
  onboarding=(await accountReadiness()).accounts;
  assert.equal(onboarding.entitled_without_n8n_reference,0);
  assert.equal(onboarding.entitled_with_n8n_reference,1);
  assert.equal(onboarding.onboarding_state,'N8N_LINK_COUNTS_REQUIRE_MANUAL_E2E_CHECK');
  assert.equal(onboarding.drive_folder_access,'NOT_VERIFIED_BY_THIS_QUERY');
  assert.doesNotMatch(JSON.stringify(await accountReadiness()),/synthetic_linked_01/);
  await db.exec('UPDATE sma_private.onboarding_payment_settings_v1 SET enabled=false');
  assert.equal((await accountReadiness()).accounts.automatic_first_payment_setting,false);
  await db.exec('DELETE FROM sma_private.onboarding_payment_settings_v1');
  assert.equal((await accountReadiness()).accounts.automatic_first_payment_setting,null);
  await db.exec('INSERT INTO sma_private.onboarding_payment_settings_v1 VALUES(false),(true)');
  assert.equal((await accountReadiness()).accounts.automatic_first_payment_setting,null);
  assert.equal((await accountReadiness()).allows_publication,false);
  assert.equal((await accountReadiness()).initiates_checkout,false);

  for(const role of ['anon','authenticated']){
    await db.exec('BEGIN READ ONLY; SET LOCAL ROLE '+role);
    try{await assert.rejects(db.query(report),/permission denied/);}
    finally{await db.exec('ROLLBACK');}
  }
  console.log(`8 publication-permission and ${galleryChecks} read-only gallery/catalog SQL scenarios passed; browser roles denied.`);
} finally {
  await db.close();
}
