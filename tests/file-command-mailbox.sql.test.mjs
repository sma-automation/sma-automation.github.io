// Real repository PostgreSQL functions, disposable PGlite, synthetic records only.
// No n8n/provider/Supabase network endpoint is called.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';

const uuid = n => 'bc770000-0000-4000-8000-' + String(n).padStart(12, '0');
const owner = uuid(9001), other = uuid(9002);
const shop = 'https://sma-automation.com/app/shop.html?shop=command-fixture';
const consent = platform => ({ policy_version: 'media-consent-2026-11-03.1', content_checked: true,
  media_rights: true, music_rights: true, tiktok_music_terms: platform === 'tiktok', tiktok_branded_terms: false });

await test('generic file command mailbox uses the original authenticated business RPCs', async t => {
  const db = new PGlite();
  const source = name => readFile(new URL('../supabase/sql/' + name + '.sql', import.meta.url), 'utf8');
  const fixture = name => readFile(new URL('./sql-runtime/' + name, import.meta.url), 'utf8');
  const value = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.v;
  const asRole = async (role, fn) => {
    await db.exec('set role ' + role);
    try { const result = await fn(); await db.exec('reset role'); return result; }
    catch (error) { try { await db.exec('reset role'); } catch {} throw error; }
  };
  const user = async (action, input, uid = owner) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
    return asRole('authenticated', () => value('select public.sma_file_job_v1($1,$2) v', [action, input]));
  };
  const worker = (action, input) => asRole('service_role', () => value('select public.sma_file_job_worker_v1($1,$2) v', [action, input]));
  const realRpc = (name, args) => asRole('service_role', () => value('select public.' + name + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') v', args));
  let counter, tick, phases;
  const next = () => uuid(++counter);
  async function file(kind = 'video') {
    const id = next();
    await db.query(`insert into sma_private.publication_files_v1
      (id,user_id,customer_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,width_px,height_px,duration_ms)
      values($1,$2,1,$3,$4,$5,$6,'version:1',now(),2048,720,1280,$7)`,
      [id, owner, 'synthetic_file_' + counter, kind === 'video' ? 'Synthetic.mp4' : 'Synthetic.png', kind, kind === 'video' ? 'video/mp4' : 'image/png', kind === 'video' ? 10000 : null]);
    return { id, revision: 'version:1', kind };
  }
  const assetAnchor = f => ({ kind: 'asset', asset_id: f.id, asset_revision: f.revision });
  const start = async (anchor, requestId = next()) => {
    const result = await user('start', { request_id: requestId, anchor });
    assert.equal(result.ok, true, JSON.stringify(result));
    return { ...result, request_id: requestId, anchor };
  };
  async function bind(job) {
    const claim = await worker('claim_start', { job_id: job.job_id });
    assert.ok(claim.start, JSON.stringify(claim));
    const input = { job_id: job.job_id, start_ticket: claim.start.start_ticket, execution_id: 'parent_' + ++counter };
    assert.equal((await worker('bind', input)).already_bound, false);
    job.execution_id = input.execution_id; job.start_ticket = input.start_ticket;
    return input;
  }
  async function enqueue(job, operation, input, commandId = next()) {
    const request = { job_id: job.job_id, command_id: commandId, operation, input };
    const result = await user('command', request);
    assert.equal(result.ok, true, JSON.stringify(result));
    return { request, command_id: result.commands[0].command_id };
  }
  async function accept(job, command) {
    const phase = (phases.get(job.job_id) || 0) + 1; phases.set(job.job_id, phase);
    const wait = { job_id: job.job_id, execution_id: job.execution_id, phase_seq: phase,
      resume_url: 'https://johnmusic.app.n8n.cloud/webhook-waiting/' + job.execution_id + '/file-command-' + phase + '?signature=synthetic_signature_value' };
    const waiting = await worker('wait', wait); assert.equal(waiting.ok, true, JSON.stringify(waiting));
    let a;
    if (waiting.wait === false) {
      a = waiting.dispatch; phases.set(job.job_id, waiting.phase_seq);
      assert.equal(a.command_id, command.command_id);
    } else {
      const claimed = await worker('claim_delivery', { job_id: job.job_id });
      assert.ok(claimed.delivery, JSON.stringify(claimed)); const d = claimed.delivery;
      assert.equal(d.event_id, command.command_id);
      a = await worker('accept', { job_id: job.job_id, event_id: d.event_id, phase_seq: phase, execution_id: job.execution_id, ticket: d.ticket });
    }
    assert.equal(a.already_accepted, false, JSON.stringify(a));
    return { job_id: job.job_id, command_id: command.command_id, command_ticket: a.command_ticket,
      parent_execution_id: job.execution_id, child_execution_id: 'child_' + ++counter };
  }
  const childKey = claim => ({ job_id: claim.job_id, command_id: claim.command_id,
    command_ticket: claim.command_ticket, child_execution_id: claim.child_execution_id });
  async function run(job, operation, input) {
    const command = await enqueue(job, operation, input), claim = await accept(job, command);
    const context = await worker('claim', claim);
    assert.equal(context.operation, operation, JSON.stringify(context));
    const expectedSeconds = { upload_start: 120, upload_finish: 120, magic_photo: 210, magic_video: 600,
      review: 210, preview_prepare: 150, account: 150, order_prepare: 600, order_approve: 600 }[operation];
    assert.equal(await value('select extract(epoch from (operation_deadline-now()))::int v from sma_private.file_commands_v1 where id=$1', [command.command_id]), expectedSeconds);
    const key = childKey(claim), reservation = await worker('reserve', key);
    return { command, claim, key, context, reservation };
  }
  async function finish(c, body, outcome = 'completed') {
    assert.equal((await worker('result', { ...c.key, status: 200, body })).ok, true);
    assert.equal((await worker('completed', { ...c.key, outcome })).ok, true);
  }
  async function preparedOrderInput(f, platform = 'youtube') {
    const preview = next(), id = next();
    const draft = { platform, title: 'Synthetischer Test', body: 'Eine blaue Fläche im synthetischen Testvideo.',
      caption: 'Eine blaue Fläche im synthetischen Testvideo.\n\n🛒 Zum Shop: ' + shop, hashtags: [], review_notes: [] };
    await db.query(`insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,preview)
      values($1,$2,1,$3,$4,'completed',$5)`, [preview, owner, { platforms: [platform], media_kind: 'video', language: 'de' }, shop, { can_publish: false, drafts: [draft] }]);
    await db.query(`insert into sma_private.publication_assignments_v1(asset_id,platform,preview_id,preview_revision,asset_revision,draft)
      values($1,$2,$3,1,$4,$5)`, [f.id, platform, preview, f.revision, draft]);
    const choices = platform === 'youtube' ? { visibility: 'private', made_for_kids: false, contains_synthetic_media: false }
      : platform === 'tiktok' ? { visibility: 'SELF_ONLY', disable_comment: false, disable_duet: false, disable_stitch: false,
        brand_content_toggle: false, brand_organic_toggle: false, is_aigc: false } : { visibility: 'public' };
    return { id, asset_id: f.id, asset_revision: f.revision, platform, assignment_revision: 1, preview_id: preview, preview_revision: 1, choices };
  }
  async function bindTarget(input) {
    const p = input.platform, target = { platform: p, id: 'synthetic_' + p, name: 'Synthetic target', source_revision: 'a'.repeat(64) };
    const account_check = { version: 1, platform: p, target_id: target.id, target_revision: target.source_revision,
      display_name: 'Synthetic target', permissions: p === 'tiktok' ? ['video.publish', 'user.info.basic'] : ['youtube.upload'],
      policy: p === 'tiktok' ? { privacy_levels: ['SELF_ONLY'], comment_disabled: false, duet_disabled: false, stitch_disabled: false, max_duration_sec: 60 } : {},
      checked_at: new Date(tick).toISOString(), expires_at: new Date(tick + 240_000).toISOString() };
    return realRpc('sma_publication_order_worker_v1', ['bind_target', input.id, null, { target, account_check }]);
  }
  async function scenario(name, fn) {
    await t.test(name, async () => {
      await db.exec('begin'); counter = 100; phases = new Map(); tick = Number(await value('select extract(epoch from now())*1000 v'));
      try { await fn(); } finally { await db.exec('rollback'); }
    });
  }
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;grant usage on schema auth to authenticated,service_role;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.sma_kunden(id bigint primary key,user_id uuid,n8n_kunde_id text,kunde_email text,aktiv boolean,
        demo_delta_aktiv boolean,zahlung_bestaetigt boolean,shop_slug text,shop_oeffentlich boolean);
      grant select on public.sma_kunden to service_role;`);
    for (const name of ['publication-preview', 'publication-files', 'publication-media-precheck', 'publication-content-review',
      'publication-magic-effect', 'publication-video-technical', 'publication-video-magic', 'publication-media-profiles',
      'publication-accounts', 'publication-content-comparison', 'publication-orders', 'publication-comparison-queue', 'publication-asset-preview', 'publication-device-upload',
      'publication-editor-history', 'publication-editor-exports', 'publication-caption-history', 'publication-text-edits']) {
      await db.exec(await source(name));
    }
    for (const fn of JSON.parse(await fixture('manual-review-live-baseline.json'))) await db.exec(fn.definition);
    await db.exec(await fixture('provider-cover-pr57-journal.sql'));
    await db.exec(await source('publication-manual-review'));
    await db.exec(await source('publication-provider-cover'));
    for (const name of ['publication-history', 'publication-history-months', 'publication-cover-history', 'publication-approval-window',
      'publication-pending-preparation', 'publication-history-order-caption', 'publication-history-order-page', 'publication-existing-approval',
      'publication-cancel-preparation', 'publication-tiktok-aigc', 'file-command-mailbox']) await db.exec(await source(name));
    await db.query(`insert into public.sma_kunden values
      (1,$1,'synthetic_owner','owner@example.invalid',true,true,false,'command-fixture',true),
      (2,$2,'synthetic_other','other@example.invalid',true,true,false,'other-fixture',true)`, [owner, other]);

    await scenario('exact live original function bodies, signatures, provider columns and service grants match', async () => {
      // Read-only metadata snapshot from the production project on 2026-11-16.
      // Contains no customer rows, credentials, URLs or provider payloads.
      const live = JSON.parse(await fixture('file-job-live-schema-20261116.json'));
      const names = live.functions.map(f => f.name);
      const functions = (await db.query(`select n.nspname as schema,p.proname as name,pg_get_function_identity_arguments(p.oid) as arguments,
        md5(p.prosrc) as hash,p.prosecdef as definer,p.provolatile as volatility,p.proconfig as config,p.proacl::text as acl
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sma_private' and p.proname=any($1) order by p.proname`, [names])).rows;
      assert.deepEqual(functions, live.functions);
      const columns = (await db.query(`select table_name as table,column_name as column,udt_name as type,is_nullable as nullable
        from information_schema.columns where table_schema='sma_private' and table_name in
        ('publication_provider_attempts_v1','publication_provider_permissions_v1','publication_provider_covers_v1') order by table_name,ordinal_position`)).rows;
      assert.deepEqual(columns, live.columns);
      const grants = (await db.query(`select p.proname as name,pg_get_function_identity_arguments(p.oid) as arguments,
        has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') as service_role,
        has_function_privilege('anon',p.oid,'EXECUTE') as anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname=any($1) order by p.proname`, [live.public_grants.map(f => f.name)])).rows;
      assert.deepEqual(grants, live.public_grants);
    });

    // Run the existing single-file/transport regression cases against the
    // upgraded family contract after checking the original business baseline.
    await db.exec(await source('file-job-export-family'));

    await scenario('same request and active asset join, immutable keys and owner isolation', async () => {
      const f = await file(), j = await start(assetAnchor(f));
      assert.equal((await start(assetAnchor(f), j.request_id)).job_id, j.job_id);
      const joined = await start(assetAnchor(f)); assert.equal(joined.job_id, j.job_id);
      const otherFile = await file();
      assert.equal((await user('start', { request_id: j.request_id, anchor: assetAnchor(otherFile) })).code, 'REQUEST_CONFLICT');
      assert.equal((await user('get', { job_id: j.job_id }, other)).code, 'JOB_UNAVAILABLE');
      assert.equal((await user('get', { job_id: j.job_id }, '')).code, 'AUTH_REQUIRED');
      for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal(await value("select has_table_privilege($1,'sma_private.file_commands_v1','SELECT') v", [role]), false);
      }
      assert.equal(await value("select has_function_privilege('authenticated','public.sma_file_job_worker_v1(text,jsonb)','EXECUTE') v"), false);
      assert.doesNotMatch(JSON.stringify(await user('get', { job_id: j.job_id })), /ticket|resume_url|lease_id|execution_id|user_id/);
    });

    await scenario('one start claim, lost-start receipt, late first binding and no second parent', async () => {
      const j = await start(assetAnchor(await file())), s = (await worker('claim_start', { job_id: j.job_id })).start;
      const key = { job_id: j.job_id, start_ticket: s.start_ticket };
      assert.equal((await worker('claim_start', { job_id: j.job_id })).start, null);
      assert.equal((await worker('start_receipt', key)).bound, false);
      assert.equal((await worker('start_uncertain', key)).bound, false);
      assert.equal((await worker('claim_start', { job_id: j.job_id })).start, null);
      assert.equal((await worker('bind', { ...key, execution_id: 'parent_one' })).already_bound, false);
      assert.equal((await worker('bind', { ...key, execution_id: 'parent_one' })).already_bound, true);
      assert.equal((await worker('bind', { ...key, execution_id: 'parent_two' })).code, 'EXECUTION_MISMATCH');
      assert.equal((await worker('start_receipt', key)).execution_id, 'parent_one');
    });

    await scenario('upload reserves once before asset exists; verified finish attaches the real owned file', async () => {
      const anchor = { kind: 'upload', upload_id: next(), name: 'Synthetic.mp4', mime_type: 'video/mp4', size_bytes: 2048 };
      const j = await start(anchor); assert.equal(j.asset_id, null);
      assert.equal((await start(anchor)).job_id, j.job_id);
      await bind(j);
      const input = { ...anchor }; delete input.kind;
      const c = await run(j, 'upload_start', input), r = c.reservation;
      assert.equal(r.initialize, true); assert.ok(r.lease_id);
      assert.deepEqual(await worker('reserve', c.key), r);
      const upload_url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=synthetic_upload_12345';
      const ready = await realRpc('sma_publication_upload_bind_v1', [anchor.upload_id, r.lease_id, 'synthetic_drive_12345', 'synthetic_folder_12345', upload_url]);
      assert.equal(ready.status, 'ready'); await finish(c, ready);
      const duplicate = await enqueue(j, 'upload_start', input); assert.equal(duplicate.command_id, c.command.command_id);
      assert.notEqual(duplicate.request.command_id, duplicate.command_id);
      // Lost Edge response: the browser still only knows its original requested
      // UUID, which must resolve the durable alias without another Edge call.
      const recovered = await user('get', { job_id: j.job_id, command_id: duplicate.request.command_id });
      assert.equal(recovered.commands.length, 1); assert.equal(recovered.commands[0].command_id, c.command.command_id);
      assert.equal((await user('command', duplicate.request)).commands[0].command_id, c.command.command_id);
      assert.equal(await value('select count(*)::int v from sma_private.file_commands_v1 where job_id=$1', [j.job_id]), 1);
      const done = await run(j, 'upload_finish', { upload_id: anchor.upload_id });
      assert.equal(done.reservation.status, 'ready');
      const fileResult = await realRpc('sma_publication_upload_finish_v1', [anchor.upload_id, {
        drive_file_id: 'synthetic_drive_12345', folder_id: 'synthetic_folder_12345', upload_id: anchor.upload_id,
        name: anchor.name, mime_type: anchor.mime_type, size_bytes: anchor.size_bytes, media_kind: 'video',
        revision: 'sha256:' + 'a'.repeat(64) + ':1', modified_at: new Date(tick).toISOString(), width_px: 720, height_px: 1280, duration_ms: 10000,
      }]);
      assert.equal(fileResult.status, 'completed');
      const completedAnchor = { kind: 'asset', asset_id: fileResult.asset_id, asset_revision: 'sha256:' + 'a'.repeat(64) + ':1' };
      // A parallel catalog read may expose the finished file even before the
      // worker captures its public response. Join the real completed upload.
      await db.exec('savepoint catalog_join');
      assert.equal((await start(completedAnchor)).job_id, j.job_id);
      await db.exec('rollback to savepoint catalog_join');
      assert.equal((await user('get', { job_id: j.job_id })).asset_id, null);
      assert.equal((await worker('result', { ...done.key, status: 200, body: fileResult })).ok, true);
      const betweenResponseAndCompletion = await user('get', { job_id: j.job_id, command_id: done.command.command_id });
      assert.equal(betweenResponseAndCompletion.asset_id, fileResult.asset_id);
      assert.equal(betweenResponseAndCompletion.commands[0].state, 'running');
      assert.equal((await start(completedAnchor)).job_id, j.job_id);
      assert.equal(await value('select count(*)::int v from sma_private.file_jobs_v1'), 1);
      assert.equal((await worker('completed', { ...done.key, outcome: 'completed' })).ok, true);
      const attached = await user('get', { job_id: j.job_id });
      assert.equal(attached.asset_id, fileResult.asset_id);
      assert.equal(attached.asset_revision, 'sha256:' + 'a'.repeat(64) + ':1');
      assert.equal((await start({ kind: 'asset', asset_id: attached.asset_id, asset_revision: attached.asset_revision })).job_id, j.job_id);
      assert.equal(attached.commands[0].response.body.upload_url, undefined);
      assert.equal(attached.commands[0].response.body.status, 'completed');
      assert.equal(attached.commands[0].response.body.asset_id, attached.asset_id);
      // Existing UI retries begin with upload_start after a lost finish reply.
      // It must discover completed, never re-upload through an old capability.
      assert.equal((await start(anchor)).job_id, j.job_id);
      const retriedStart = await user('get', { job_id: j.job_id, command_id: duplicate.request.command_id });
      assert.equal(retriedStart.commands[0].response.body.status, 'completed');
    });

    await scenario('private child claim is bound once; reserve cannot replace owner, operation or input', async () => {
      const f = await file(), j = await start(assetAnchor(f)); await bind(j);
      const command = await enqueue(j, 'account', { id: next(), platform: 'youtube' }), claim = await accept(j, command);
      assert.equal((await worker('claim', { ...claim, command_ticket: 'a'.repeat(64) })).code, 'INVALID_COMMAND_TICKET');
      const ctx = await worker('claim', claim); assert.deepEqual(ctx.request.headers, {}); assert.equal(ctx.action, 'account');
      assert.equal((await worker('claim', { ...claim, child_execution_id: 'other_child' })).code, 'COMMAND_ALREADY_CLAIMED');
      const key = childKey(claim);
      assert.equal((await worker('reserve', { ...key, input: { platform: 'tiktok' } })).code, 'INVALID_INPUT');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
      const r = await worker('reserve', key);
      assert.equal(r.binding.customer_id, 1); assert.equal(r.binding.platform, 'youtube');
      assert.equal(await value("select current_setting('request.jwt.claim.sub') v"), other);
      assert.deepEqual(await worker('reserve', key), r);
    });

    await scenario('all three early responses preserve processing until actual worker completion', async () => {
      for (const [operation, kind, resultKey] of [['magic_photo', 'image', 'analysis'], ['magic_video', 'video', 'analysis'], ['review', 'image', 'review']]) {
        await db.exec('savepoint early_response');
        const f = await file(kind);f.revision = 'sha256:' + 'a'.repeat(64) + ':1';
        await db.query('update sma_private.publication_files_v1 set revision=$2 where id=$1', [f.id, f.revision]);
        const j = await start(assetAnchor(f)); await bind(j);
        const c = await run(j, operation, { asset_id: f.id, asset_revision: f.revision });
        assert.equal(c.reservation.ok, true, JSON.stringify(c.reservation));
        assert.equal(c.reservation[resultKey].status, 'processing');
        const body = { ok: true, [resultKey]: c.reservation[resultKey] };
        assert.equal((await worker('result', { ...c.key, status: 200, body })).ok, true);
        const view = await user('get', { job_id: j.job_id, command_id: c.command.command_id });
        assert.equal(view.commands[0].state, 'running'); assert.deepEqual(view.commands[0].response, { status: 200, body });
        assert.equal((await worker('finish', { job_id: j.job_id, execution_id: j.execution_id })).code, 'COMMANDS_PENDING');
        const finishRpc = operation === 'magic_photo' ? 'sma_publication_magic_finish_v1'
          : operation === 'magic_video' ? 'sma_publication_video_magic_finish_v1' : 'sma_publication_review_finish_v1';
        const stored = await realRpc(finishRpc, [f.id, c.reservation.lease_id, null, null, 'SYNTHETIC_FAILURE']);
        assert.equal(stored.ok, false);
        assert.equal(stored.code, operation === 'review' ? 'REVIEW_UNAVAILABLE' : 'MAGIC_UNAVAILABLE');
        assert.equal((await worker('completed', { ...c.key, outcome: 'failed', error_code: 'WORKER_FAILED' })).ok, true);
        assert.equal((await user('get', { job_id: j.job_id })).commands[0].state, 'failed');
        await db.exec('rollback to savepoint early_response');
      }
    });

    await scenario('preview is reserved once for the requested portals through the real text RPC', async () => {
      const f = await file(), j = await start(assetAnchor(f)); await bind(j);
      const input = { request_id: next(), source_text: 'Im synthetischen Video bewegt sich eine blaue Fläche.', audience: 'Testpublikum', goal: 'Sachlich informieren', language: 'de', media_kind: 'video', platforms: ['youtube', 'instagram', 'facebook', 'tiktok'] };
      const c = await run(j, 'preview_prepare', input);
      assert.equal(c.reservation.status, 'processing', JSON.stringify(c.reservation));
      assert.deepEqual(await worker('reserve', c.key), c.reservation);
      assert.equal(await value('select count(*)::int v from sma_private.publication_previews_v1'), 1);
      assert.equal((await user('command', { ...c.command.request, input: { ...input, goal: 'Changed' } })).code, 'COMMAND_CONFLICT');
      assert.equal((await user('command', { ...c.command.request, command_id: next(), operation: 'arbitrary_rpc' })).code, 'INVALID_INPUT');
    });

    await scenario('order prepare/approve use real per-portal consent and never create provider permission', async () => {
      const f = await file(), j = await start(assetAnchor(f)); await bind(j);
      for (const platform of ['youtube', 'tiktok', 'instagram', 'facebook']) {
        const input = await preparedOrderInput(f, platform), prep = await run(j, 'order_prepare', input);
        assert.equal(prep.reservation.state, 'preparing');
        const prepared = await bindTarget(input); assert.equal(prepared.state, 'prepared'); await finish(prep, prepared);
        const invalid = await run(j, 'order_approve', { id: input.id, approval_token: prepared.approval_token, confirm: true, review: {} });
        assert.equal(invalid.reservation.code, 'FINAL_APPROVAL_REQUIRED'); await finish(invalid, invalid.reservation, 'failed');
        const valid = await run(j, 'order_approve', { id: input.id, approval_token: prepared.approval_token, confirm: true, review: consent(platform) });
        assert.equal(valid.reservation.state, 'approved', JSON.stringify(valid.reservation));
        assert.deepEqual(await worker('reserve', valid.key), valid.reservation);
        const continued = await worker('order_continue', valid.key);
        assert.equal(continued.order.id, input.id); assert.equal(continued.order.state, 'approved');
        assert.equal(continued.provider.state, 'not_started'); assert.equal(continued.provider.permission_valid, false);
        assert.doesNotMatch(JSON.stringify(continued.provider), /session_url|provider_id":\s*"|lease_id|token/);
        assert.equal((await worker('order_continue', { ...valid.key, id: next() })).code, 'INVALID_INPUT');
        await finish(valid, valid.reservation);
        assert.equal((await worker('order_continue', valid.key)).code, 'COMMAND_UNAVAILABLE');
      }
      assert.equal(await value('select count(*)::int v from sma_private.publication_journal_v1'), 4);
      assert.equal(await value('select count(*)::int v from sma_private.publication_provider_permissions_v1'), 0);
      assert.equal(await value('select count(*)::int v from sma_private.publication_provider_attempts_v1'), 0);
      assert.equal((await worker('finish', { job_id: j.job_id, execution_id: j.execution_id })).ok, true);
    });

    await scenario('result freezes original body, rejects private fields and permits pre-reservation validation errors', async () => {
      const f = await file(), j = await start(assetAnchor(f)); await bind(j);
      const c = await run(j, 'account', { id: next(), platform: 'youtube' });
      assert.equal((await worker('result', { ...c.key, status: 200, body: c.reservation })).code, 'INVALID_PUBLIC_RESULT');
      const body = { ok: false, code: 'TARGET_ACCOUNT_REQUIRED' };
      await finish(c, body, 'failed');
      assert.equal((await worker('result', { ...c.key, status: 200, body })).ok, true);
      assert.equal((await worker('result', { ...c.key, status: 200, body: { ok: true } })).code, 'RESULT_CONFLICT');
      const q = await enqueue(j, 'preview_prepare', { request_id: next(), source_text: 'too short', audience: 'x', goal: 'x', language: 'de', media_kind: 'video', platforms: ['youtube'] });
      const claim = await accept(j, q); await worker('claim', claim);
      const key = childKey(claim);
      assert.equal((await worker('result', { ...key, status: 200, body: { ok: true } })).code, 'COMMAND_NOT_RESERVED');
      assert.equal((await worker('result', { ...key, status: 400, body: { ok: false, code: 'INVALID_INPUT' } })).ok, true);
      assert.equal((await worker('completed', { ...key, outcome: 'failed' })).ok, true);
    });

    await scenario('independent fixed job and operation deadlines cannot be renewed by join or claim', async () => {
      const a = await start(assetAnchor(await file())), b = await start(assetAnchor(await file())); await bind(a); await bind(b);
      const c = await run(a, 'account', { id: next(), platform: 'youtube' });
      const original = c.context.deadline_at;
      assert.equal((await worker('claim', c.claim)).deadline_at, original);
      await db.query("update sma_private.file_commands_v1 set operation_deadline=now()-interval '1 second' where id=$1", [c.command.command_id]);
      assert.equal((await worker('reserve', c.key)).code, 'OPERATION_EXPIRED');
      await db.query("update sma_private.file_jobs_v1 set created_at=now()-interval '24 hours 1 minute',deadline_at=now()-interval '1 minute' where id=$1", [a.job_id]);
      assert.equal((await start(a.anchor, a.request_id)).state, 'expired');
      assert.equal((await user('command', { job_id: a.job_id, command_id: next(), operation: 'account', input: { id: next(), platform: 'youtube' } })).code, 'JOB_EXPIRED');
      assert.equal((await user('get', { job_id: b.job_id })).state, 'running');
    });

    await scenario('changed revision or access blocks any new reservation; no customer gate is weakened', async () => {
      const f = await file(), j = await start(assetAnchor(f)); await bind(j);
      const q = await enqueue(j, 'account', { id: next(), platform: 'youtube' }), claim = await accept(j, q); await worker('claim', claim);
      for (const mutation of ["update public.sma_kunden set aktiv=false where id=1", "update public.sma_kunden set demo_delta_aktiv=false,zahlung_bestaetigt=false where id=1",
        "update public.sma_kunden set n8n_kunde_id=null where id=1", "update sma_private.publication_files_v1 set revision='version:2'"]) {
        await db.exec('savepoint changed'); await db.exec(mutation);
        assert.equal((await worker('reserve', childKey(claim))).code, 'JOB_UNAVAILABLE');
        await db.exec('rollback to savepoint changed');
      }
      assert.equal((await worker('reserve', childKey(claim))).ok, true);
    });

    await scenario('both queue/Wait orderings progress in the same parent with no second wake for queued work', async () => {
      const j = await start(assetAnchor(await file())); await bind(j);
      const parent = { job_id: j.job_id, execution_id: j.execution_id };
      const wait1 = { ...parent, phase_seq: 1, resume_url: 'https://johnmusic.app.n8n.cloud/webhook-waiting/' + j.execution_id + '/file-command-1?signature=synthetic_signature_value' };
      // Ordering A: the transaction registers Wait first, then enqueue sees it.
      const waiting = await worker('wait', wait1); assert.equal(waiting.wait, true);
      const first = await enqueue(j, 'account', { id: next(), platform: 'youtube' });
      const d = (await worker('claim_delivery', { job_id: j.job_id })).delivery;
      assert.equal(d.event_id, first.command_id);
      const acceptBody = { job_id: j.job_id, event_id: d.event_id, phase_seq: 1, execution_id: j.execution_id, ticket: d.ticket };
      const accepted = await worker('accept', acceptBody); assert.equal(accepted.already_accepted, false);
      const replay = await worker('accept', acceptBody); assert.equal(replay.already_accepted, true); assert.equal(replay.command_ticket, undefined);
      const recovered = await worker('context', { ...parent, command_id: first.command_id });
      assert.equal(recovered.command_ticket, accepted.command_ticket);
      const claim = { job_id: j.job_id, command_id: first.command_id, command_ticket: recovered.command_ticket,
        parent_execution_id: j.execution_id, child_execution_id: 'queue_first_child' };
      await worker('claim', claim); const key = childKey(claim); await worker('reserve', key);
      // Ordering B: enqueue happens while the prior child is still running.
      const second = await enqueue(j, 'account', { id: next(), platform: 'tiktok' });
      assert.equal((await worker('claim_delivery', { job_id: j.job_id })).delivery, null);
      const wait2 = { ...parent, phase_seq: 2, resume_url: wait1.resume_url.replace('file-command-1?', 'file-command-2?') };
      assert.equal((await worker('wait', wait2)).code, 'PHASE_CONFLICT');
      await finish({ key }, { ok: false, code: 'TARGET_ACCOUNT_REQUIRED' }, 'failed');
      const inline = await worker('wait', wait2);
      assert.equal(inline.wait, false); assert.equal(inline.phase_seq, 1);
      assert.equal(inline.dispatch.command_id, second.command_id); assert.equal(inline.dispatch.parent_execution_id, j.execution_id);
      assert.equal((await worker('parent_context', parent)).phase_seq, 1);
      assert.equal((await worker('claim_delivery', { job_id: j.job_id })).delivery, null);
      const secondClaim = { job_id: j.job_id, command_id: second.command_id, command_ticket: inline.dispatch.command_ticket,
        parent_execution_id: j.execution_id, child_execution_id: 'queue_second_child' };
      await worker('claim', secondClaim); const secondKey = childKey(secondClaim); await worker('reserve', secondKey);
      await finish({ key: secondKey }, { ok: false, code: 'TARGET_ACCOUNT_REQUIRED' }, 'failed');
      const nextWait = await worker('wait', wait2); assert.equal(nextWait.wait, true); assert.equal(nextWait.phase_seq, 2);
      const receipt = await worker('receipt', { job_id: j.job_id, event_id: first.command_id });
      assert.equal(receipt.state, 'accepted'); assert.equal(receipt.execution_id, j.execution_id);
    });

    await scenario('parent failure freezes active work, preserves receipts and cannot restart automatically', async () => {
      const j = await start(assetAnchor(await file())); await bind(j);
      const c = await run(j, 'account', { id: next(), platform: 'youtube' });
      const parent = { job_id: j.job_id, execution_id: j.execution_id };
      assert.equal((await worker('parent_context', { ...parent, execution_id: 'wrong' })).code, 'EXECUTION_MISMATCH');
      assert.equal((await worker('fail', { ...parent, error_code: 'SECRET_RAW_ERROR' })).code, 'INVALID_INPUT');
      assert.equal((await worker('fail', { ...parent, error_code: 'WORKER_FAILED' })).ok, true);
      const context = await worker('parent_context', parent); assert.equal(context.state, 'uncertain'); assert.equal(context.terminal, true);
      assert.equal((await user('get', { job_id: j.job_id })).commands[0].state, 'uncertain');
      assert.equal((await worker('claim_start', { job_id: j.job_id })).start, null);
      assert.equal((await worker('reserve', c.key)).code, 'COMMAND_FINISHED');
      assert.equal((await user('command', { job_id: j.job_id, command_id: next(), operation: 'account', input: { id: next(), platform: 'youtube' } })).code, 'JOB_UNCERTAIN');
      assert.equal((await worker('completed', { ...c.key, outcome: 'completed' })).code, 'RESULT_REQUIRED');
      assert.equal((await worker('receipt', { job_id: j.job_id, event_id: c.command.command_id })).accepted, true);
    });

    await scenario('signed Wait identity, negative receipt and original delivery lease fence acceptance', async () => {
      const j = await start(assetAnchor(await file())); await bind(j);
      const parent = { job_id: j.job_id, execution_id: j.execution_id };
      const w = { ...parent, phase_seq: 1, resume_url: 'https://johnmusic.app.n8n.cloud/webhook-waiting/' + j.execution_id + '/file-command-1?signature=synthetic_signature_value' };
      for (const patch of [{ execution_id: 'other_parent' }, { phase_seq: 2 }, { resume_url: 'https://example.invalid/receive' },
        { resume_url: w.resume_url.split('?')[0] }, { resume_url: w.resume_url + '&second=value' }]) {
        assert.equal((await worker('wait', { ...w, ...patch })).ok, false);
      }
      assert.equal((await worker('wait', w)).wait, true);
      const q = await enqueue(j, 'account', { id: next(), platform: 'youtube' });
      const d = (await worker('claim_delivery', { job_id: j.job_id })).delivery;
      const acceptBody = { ...parent, event_id: d.event_id, phase_seq: 1, ticket: d.ticket };
      const receipt = await worker('receipt', { job_id: j.job_id, event_id: q.command_id });
      assert.deepEqual([receipt.accepted, receipt.state, receipt.phase_seq, receipt.execution_id], [false, 'offered', 1, null]);
      for (const patch of [{ execution_id: 'other_parent' }, { phase_seq: 2 }, { event_id: next() }, { ticket: '0'.repeat(64) }]) {
        assert.equal((await worker('accept', { ...acceptBody, ...patch })).ok, false);
      }
      assert.equal((await worker('uncertain', { job_id: j.job_id, event_id: q.command_id, lease_id: d.lease_id })).accepted, false);
      assert.equal((await worker('claim_delivery', { job_id: j.job_id })).delivery, null);
      await db.exec('savepoint lease_expiry');
      await db.query("update sma_private.file_jobs_v1 set delivery_until=now()-interval '1 second' where id=$1", [j.job_id]);
      assert.equal((await worker('accept', acceptBody)).code, 'INVALID_TICKET');
      await db.exec('rollback to savepoint lease_expiry');
      assert.equal((await worker('accept', acceptBody)).accepted, true);
      assert.equal((await worker('receipt', { job_id: j.job_id, event_id: q.command_id })).execution_id, j.execution_id);
    });

    await scenario('a lost pre-bind start becomes visibly uncertain after its original deadline without replacement', async () => {
      const j = await start(assetAnchor(await file())), s = (await worker('claim_start', { job_id: j.job_id })).start;
      await db.query("update sma_private.file_jobs_v1 set start_claimed_at=now()-interval '61 seconds' where id=$1", [j.job_id]);
      assert.equal((await user('get', { job_id: j.job_id })).state, 'uncertain');
      assert.equal((await worker('claim_start', { job_id: j.job_id })).state, 'uncertain');
      assert.equal((await worker('bind', { job_id: j.job_id, start_ticket: s.start_ticket, execution_id: 'late_parent' })).code, 'START_EXPIRED');
      assert.equal((await start(j.anchor, j.request_id)).job_id, j.job_id);
      assert.equal((await worker('start_receipt', { job_id: j.job_id, start_ticket: s.start_ticket })).bound, false);
    });
  } finally { await db.close(); }
});
