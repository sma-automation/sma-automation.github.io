// Execute the repository's real PostgreSQL functions in disposable PGlite.
// All users, files and lease timestamps are synthetic; no HTTP call is involved.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';

const source = name => readFile(new URL('../supabase/sql/' + name + '.sql', import.meta.url), 'utf8');
const uuid = n => 'bc790000-0000-4000-8000-' + String(n).padStart(12, '0');
const owner = uuid(9001), other = uuid(9002), absent = uuid(9003), lease = uuid(7001);
const privateName = 'sma_private.publication_files_request_v1';
const publicName = 'public.sma_publication_files_v1';
const responseKeys = ['can_publish', 'ok', 'retry_after_ms', 'sync_state', 'synced_at', 'version'];

await test('catalogue sync preflight preserves the authenticated SQL contract', async t => {
  const db = new PGlite();
  const value = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
  const asRole = async (role, fn) => {
    await db.exec('set role ' + role);
    try { return await fn(); } finally { await db.exec('reset role'); }
  };
  const call = async ({name = publicName, action = 'sync_status', input = {}, user = owner} = {}) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    return asRole('authenticated', () => value('select ' + name + '($1,$2) result', [action, JSON.stringify(input)]));
  };
  const transaction = async fn => {
    await db.exec('begin');
    try { return await fn(); } finally { await db.exec('rollback'); }
  };
  const setSync = async ({user = owner, customer = 1, leaseId = null,
    until = null, started = null, finished = null} = {}) => {
    await db.query(`insert into sma_private.publication_file_sync_v1
      (user_id,customer_id,n8n_kunde_id,kunde_email,lease_id,lease_until,started_at,finished_at)
      values($1,$2,'synthetic-private-customer','private@example.invalid',$3,
        now()+$4::interval,now()+$5::interval,now()+$6::interval)
      on conflict(user_id) do update set customer_id=excluded.customer_id,
        lease_id=excluded.lease_id,lease_until=excluded.lease_until,
        started_at=excluded.started_at,finished_at=excluded.finished_at`,
    [user, customer, leaseId, until, started, finished]);
  };
  const syncedAt = () => value('select to_jsonb(finished_at) result from sma_private.publication_file_sync_v1 where user_id=$1', [owner]);
  const expectStatus = (result, state, retry, synced = null) => {
    assert.deepEqual(Object.keys(result).sort(), responseKeys);
    assert.deepEqual(result, {ok:true, version:1, can_publish:false,
      sync_state:state, retry_after_ms:retry, synced_at:synced});
    assert.ok(Number.isInteger(result.retry_after_ms));
    assert.ok(result.retry_after_ms >= 0 && result.retry_after_ms <= 120000);
    if (result.synced_at !== null) {
      assert.match(result.synced_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/);
      assert.ok(Number.isFinite(Date.parse(result.synced_at)));
    }
  };
  const functions = async () => (await db.query(`select p.oid::text,p.pronamespace::regnamespace::text as schema,
    p.proname,pg_get_functiondef(p.oid) as definition,p.proowner::regrole::text as owner,
    p.proacl::text as acl,p.prosecdef,p.proconfig,p.provolatile,p.proparallel,
    obj_description(p.oid,'pg_proc') as comment
    from pg_proc p where p.pronamespace in ('public'::regnamespace,'sma_private'::regnamespace)
    order by p.oid`)).rows;
  const relations = async () => (await db.query(`select oid::text,relname,relowner::regrole::text as owner,
    relacl::text as acl,relrowsecurity,relforcerowsecurity from pg_class
    where relnamespace in ('public'::regnamespace,'sma_private'::regnamespace) order by oid`)).rows;
  const snapshot = () => value(`select jsonb_build_object(
    'customers',(select jsonb_agg(to_jsonb(k) order by id) from public.sma_kunden k),
    'sync',(select jsonb_agg(to_jsonb(s) order by user_id) from sma_private.publication_file_sync_v1 s),
    'files',(select jsonb_agg(to_jsonb(f) order by id) from sma_private.publication_files_v1 f),
    'assignments',(select jsonb_agg(to_jsonb(a) order by asset_id,platform) from sma_private.publication_assignments_v1 a)
    ) result`);
  let baselineFunctions, baselineRelations, originalDefinition, patch;

  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      grant usage on schema auth to authenticated,service_role;
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.sma_kunden(id bigint primary key,user_id uuid,n8n_kunde_id text,kunde_email text,
        aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean,
        shop_slug text,shop_oeffentlich boolean,kunde_id text);
      grant select on public.sma_kunden to service_role;`);
    // Include the current private action handler and the enriched public wrapper.
    // No replacement business handler or authentication shortcut is installed.
    for (const name of ['publication-preview', 'publication-files', 'publication-caption-history',
      'publication-assignment-history', 'publication-text-edits', 'publication-file-catalog-status',
      'publication-file-catalog-pages', 'publication-product-context']) {
      await db.exec(await source(name));
    }
    // Optional offline rollout proof against an already captured read-only export.
    // This path only reads local definitions; it never contacts a live database.
    if (process.env.SMA_FILE_SYNC_PREFLIGHT_BASELINE) {
      const exported = JSON.parse(await readFile(process.env.SMA_FILE_SYNC_PREFLIGHT_BASELINE, 'utf8'));
      await db.exec((await source('publication-optimizer-file-labels')).split('-- Extend only')[0]);
      for (const name of [privateName, publicName]) {
        const [schema, functionName] = name.split('.');
        const matches = exported.functions.filter(f => f.schema === schema && f.name === functionName);
        assert.equal(matches.length, 1, 'exactly one captured definition for ' + name);
        const captured = matches[0];
        assert.equal(createHash('md5').update(captured.definition).digest('hex'), captured.md5);
        assert.ok(captured.definition.startsWith('CREATE OR REPLACE FUNCTION ' + name + '('));
        await db.exec(captured.definition);
        const installed = (await db.query(`select md5(pg_get_functiondef(oid)) as md5,
          proowner::regrole::text as owner,proacl::text[] as acl,proconfig as config,
          prosecdef as security_definer from pg_proc where oid=$1::regprocedure`, [name + '(text,jsonb)'])).rows[0];
        assert.deepEqual(installed, {md5:captured.md5, owner:captured.owner, acl:captured.acl,
          config:captured.config, security_definer:captured.security_definer});
        t.diagnostic('Captured offline baseline: ' + name + ' ' + captured.md5);
      }
    }
    await db.query(`insert into public.sma_kunden values
      (1,$1,'synthetic-owner','owner@example.invalid',true,true,false,'owner-fixture',true,'owner'),
      (2,$2,'synthetic-other','other@example.invalid',true,false,true,'other-fixture',true,'other')`, [owner, other]);
    for (const [id, user, customer] of [[uuid(1), owner, 1], [uuid(2), other, 2]]) {
      await db.query(`insert into sma_private.publication_files_v1
        (id,user_id,customer_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes)
        values($1,$2,$3,'synthetic-drive-secret-'||$3::bigint,'Synthetic private file.mp4','video','video/mp4','version:1',now(),1000)`,
      [id, user, customer]);
    }
    baselineFunctions = await functions();
    baselineRelations = await relations();
    originalDefinition = baselineFunctions.find(f => f.schema === 'sma_private' && f.proname === 'publication_files_request_v1').definition;
    const beforeList = await call({action:'list'});
    patch = await source('publication-file-sync-preflight');
    await db.exec(patch);

    await t.test('only the new private action is added; wrapper, old branches and privileges are exact', async () => {
      const after = await functions();
      assert.equal(after.length, baselineFunctions.length);
      for (let i = 0; i < after.length; i++) {
        const previous = baselineFunctions[i], current = after[i];
        if (current.schema === 'sma_private' && current.proname === 'publication_files_request_v1') {
          const statusBranch = /\n if p_action='sync_status' then[\s\S]*?\n elsif p_action='list' then\n/;
          assert.equal((current.definition.match(/\n if p_action='sync_status' then\n/g) || []).length, 1);
          assert.deepEqual({...current, definition:current.definition.replace(statusBranch, "\n if p_action='list' then\n")}, previous);
          if (process.env.SMA_FILE_SYNC_PREFLIGHT_BASELINE) {
            t.diagnostic('Patched offline private definition: ' + createHash('md5').update(current.definition).digest('hex'));
          }
        } else assert.deepEqual(current, previous);
      }
      assert.deepEqual(await relations(), baselineRelations);
      assert.deepEqual(await call({action:'list'}), beforeList);
      for (const name of [privateName, publicName]) {
        const acl = await db.query(`select has_function_privilege('authenticated',$1,'EXECUTE') as client,
          has_function_privilege('anon',$1,'EXECUTE') as anonymous,
          has_function_privilege('service_role',$1,'EXECUTE') as worker`, [name + '(text,jsonb)']);
        assert.deepEqual(acl.rows[0], {client:true, anonymous:false, worker:false});
        expectStatus(await call({name}), 'idle', 0);
        await assert.rejects(() => asRole('anon', () => value('select ' + name + "('sync_status','{}') result")), /permission denied/);
      }
      await assert.rejects(() => asRole('authenticated', () => db.query('select * from sma_private.publication_file_sync_v1')), /permission denied/);
      assert.equal(after.find(f => f.schema === 'public' && f.proname === 'sma_publication_files_v1').prosecdef, false);
    });

    await t.test('the real public and private functions enforce authentication, owner and exact input', async () => {
      for (const name of [publicName, privateName]) {
        assert.deepEqual(await call({name, user:''}), {ok:false, code:'AUTH_REQUIRED'});
        assert.deepEqual(await call({name, user:absent}), {ok:false, code:'ACCOUNT_UNAVAILABLE'});
        for (const input of [null, [], ['sync_status'], false, 1, 'sync_status',
          {user_id:other}, {customer_id:2}, {lease_id:lease}, {dashboard_labels:true}, {unexpected:null}]) {
          assert.deepEqual(await call({name, input}), {ok:false, code:'INVALID_INPUT'});
        }
        assert.deepEqual(await asRole('authenticated', () => value('select ' + name + "('sync_status',null) result")),
          {ok:false, code:'INVALID_INPUT'});
        await transaction(async () => {
          await setSync({user:other, customer:2, leaseId:lease, until:'120 seconds', started:'0 seconds'});
          expectStatus(await call({name}), 'idle', 0);
          expectStatus(await call({name, user:other}), 'running', 120000);
          await db.query('insert into public.sma_kunden(id,user_id,aktiv,demo_delta_aktiv) values(3,$1,true,true)', [owner]);
          assert.deepEqual(await call({name}), {ok:false, code:'ACCOUNT_UNAVAILABLE'});
        });
      }
    });

    await t.test('all existing access conditions remain in front of the status lookup', async () => {
      for (const [active, demo, paid, allowed] of [
        [true, true, false, true], [true, false, true, true], [true, true, true, true],
        [true, false, false, false], [false, true, true, false], [null, true, true, false],
        [true, null, false, false], [true, false, null, false], [true, null, null, false]
      ]) await transaction(async () => {
        await db.query('update public.sma_kunden set aktiv=$1,demo_delta_aktiv=$2,zahlung_bestaetigt=$3 where id=1', [active, demo, paid]);
        for (const name of [publicName, privateName]) {
          const result = await call({name});
          if (allowed) expectStatus(result, 'idle', 0);
          else assert.deepEqual(result, {ok:false, code:'ACCESS_INACTIVE'});
        }
      });
    });

    await t.test('status and integer retry delay match lease and 15-second boundaries', async states => {
      const cases = [
        ['empty row', {}, 'idle', 0],
        ['new two-minute lease', {leaseId:lease, until:'120 seconds', started:'0 seconds'}, 'running', 120000],
        ['lease without ID', {until:'44.25 seconds', started:'-60 seconds', finished:'-10 seconds'}, 'running', 44250],
        ['lease takes priority over longer cooldown', {leaseId:lease, until:'1 second', started:'0 seconds'}, 'running', 1000],
        ['fractional lease rounds up', {until:'0.0001 seconds'}, 'running', 1],
        ['expired lease is interrupted', {leaseId:lease, until:'-1 second', started:'-60 seconds', finished:'-120 seconds'}, 'interrupted', 0],
        ['lease expires exactly now', {leaseId:lease, until:'0 seconds', started:'-15 seconds'}, 'interrupted', 0],
        ['failed start without lease ID', {started:'-60 seconds'}, 'interrupted', 0],
        ['new failed start waits', {started:'-1 second', finished:'-2 seconds'}, 'interrupted', 14000],
        ['completed fast scan waits', {started:'-4.25 seconds', finished:'-1 second'}, 'complete', 10750],
        ['fractional cooldown rounds up', {started:'-0.0001 seconds'}, 'interrupted', 15000],
        ['cooldown expires exactly', {started:'-15 seconds', finished:'-1 second'}, 'complete', 0],
        ['cooldown has expired', {started:'-15.0001 seconds', finished:'-1 second'}, 'complete', 0],
        ['finished scan remains complete', {started:'-120 seconds', finished:'-60 seconds'}, 'complete', 0],
        ['finish without a start', {finished:'-60 seconds'}, 'complete', 0],
        ['future start remains bounded', {started:'30 seconds'}, 'interrupted', 45000],
        ['long lease is capped', {until:'3 minutes'}, 'running', 120000],
        ['far future cooldown is capped', {started:'3 minutes'}, 'interrupted', 120000]
      ];
      for (const [label, row, state, retry] of cases) await states.test(label, () => transaction(async () => {
        await setSync(row);
        const finished = await syncedAt();
        for (const name of [publicName, privateName]) expectStatus(await call({name}), state, retry, finished);
      }));
      await transaction(async () => {
        await setSync();
        await db.exec("update sma_private.publication_file_sync_v1 set lease_until='infinity',finished_at='infinity'");
        expectStatus(await call(), 'running', 120000);
        await db.exec("update sma_private.publication_file_sync_v1 set lease_until='-infinity',started_at='infinity',finished_at=null");
        expectStatus(await call(), 'interrupted', 120000);
      });
    });

    await t.test('customer remapping preserves the user gate without returning an old completion', async () => {
      for (const [row, state, retry] of [
        [{leaseId:lease, until:'90 seconds', started:'-30 seconds', finished:'-60 seconds'}, 'running', 90000],
        [{started:'-5 seconds', finished:'-1 second'}, 'idle', 10000],
        [{started:'-120 seconds', finished:'-60 seconds'}, 'idle', 0],
        [{leaseId:lease, until:'-1 second', started:'-60 seconds'}, 'idle', 0]
      ]) await transaction(async () => {
        await setSync({...row, customer:2});
        for (const name of [publicName, privateName]) expectStatus(await call({name}), state, retry);
      });
    });

    await t.test('a status read creates no row and never renews, writes or locks an existing lease', async () => {
      for (const existing of [false, true]) {
        if (existing) await setSync({leaseId:lease, until:'120 seconds', started:'0 seconds', finished:'-60 seconds'});
        const before = await snapshot();
        await db.exec('begin read only');
        try {
          for (let i = 0; i < 3; i++) for (const name of [publicName, privateName]) {
            const result = await call({name});
            assert.deepEqual(Object.keys(result).sort(), responseKeys);
            assert.equal(result.ok, true);
            assert.equal(result.sync_state, existing ? 'running' : 'idle');
          }
        } finally { await db.exec('rollback'); }
        assert.deepEqual(await snapshot(), before);
      }
      await db.query('delete from sma_private.publication_file_sync_v1 where user_id=$1', [owner]);
    });

    await t.test('the unchanged start action still owns reservation and rejects overlap or fast retry', () => transaction(async () => {
      expectStatus(await call(), 'idle', 0);
      const started = await call({action:'sync_start'});
      assert.equal(started.ok, true);
      assert.match(started.lease_id, /^[a-f0-9-]{36}$/);
      expectStatus(await call(), 'running', 120000);
      assert.deepEqual(await call({action:'sync_start'}), {ok:false, code:'FILE_SYNC_RUNNING'});
      await db.query('update sma_private.publication_file_sync_v1 set lease_id=null,lease_until=null,finished_at=now() where user_id=$1', [owner]);
      expectStatus(await call(), 'complete', 15000, await syncedAt());
      assert.deepEqual(await call({action:'sync_start'}), {ok:false, code:'FILE_SYNC_RATE_LIMITED'});
    }));

    await t.test('reapplication and unexpected gate or anchor changes fail without replacing anything', async () => {
      const installed = await functions();
      await assert.rejects(() => db.exec(patch), /PUBLICATION_FILE_SYNC_PREFLIGHT_BASELINE_CHANGED/);
      assert.deepEqual(await functions(), installed);
      const changedSources = [
        originalDefinition.replace("\n if p_action='list' then\n", "\n if p_action = 'list' then\n"),
        originalDefinition.replace("if uid is null then", "if false then"),
        originalDefinition.replace("s.started_at>now()-interval '15 seconds'", "s.started_at>now()-interval '30 seconds'"),
        originalDefinition.replace('\nbegin\n', "\n/*\n if p_action='list' then\n*/\nbegin\n")
      ];
      for (const definition of changedSources) {
        assert.notEqual(definition, originalDefinition);
        await db.exec('begin');
        try {
          await db.exec(definition);
          await assert.rejects(() => db.exec(patch), /PUBLICATION_FILE_SYNC_PREFLIGHT_BASELINE_CHANGED/);
        } finally { await db.exec('rollback'); }
        assert.deepEqual(await functions(), installed);
      }
    });
  } finally {
    await db.close();
  }
});
