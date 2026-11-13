import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';

const sql = name => readFile(new URL('../supabase/sql/' + name, import.meta.url), 'utf8');
const report = await sql('launch-readiness-readonly.sql');
const db = new PGlite();
const blocked = 'BLOCKED_NO_EXPLICIT_APPROVAL';
const manual = 'MANUAL_PROVIDER_E2E_REVIEW_REQUIRED';

async function check(total, current, state) {
  const { rows: [{ readiness }] } = await db.query(report);
  assert.equal(readiness.publishing.operator_permissions, total);
  assert.equal(readiness.publishing.current_bound_operator_permissions, current);
  assert.equal(readiness.publishing.state, state);
  assert.equal(readiness.allows_publication, false);
  assert.equal(readiness.initiates_checkout, false);
}

try {
  await db.exec(`
    CREATE SCHEMA sma_private;
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE TABLE public.sma_kunden (
      id bigint PRIMARY KEY, aktiv boolean, zahlung_bestaetigt boolean, demo_delta_aktiv boolean
    );
    CREATE TABLE public.sma_bestellungen (ist_testbestellung boolean);
    CREATE TABLE sma_private.publication_files_v1 (available boolean, verified_at timestamptz);
    CREATE TABLE sma_private.publication_gallery_technical_v1 ();
    CREATE TABLE sma_private.gallery_music_v1 ();
    CREATE TABLE sma_private.customer_websites_v1 (published_at timestamptz);
    CREATE TABLE sma_private.website_provider_connections_v1 ();
  `);
  await db.exec((await sql('publication-orders.sql')).split('-- Only an order has')[0]);
  const journal = await sql('publication-provider-journal.sql');
  await db.exec(journal.split('create or replace function sma_private.publication_provider_session_valid_v1')[0]);

  // One transaction fixes now() so both edges of the permission interval can be checked exactly.
  await db.exec(`
    BEGIN;
    INSERT INTO public.sma_kunden VALUES (1, true, false, true);
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
  console.log('8 launch readiness SQL scenarios passed.');
} finally {
  await db.close();
}
