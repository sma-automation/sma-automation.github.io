// Real WordPress + native MariaDB, isolated from SMA and all existing databases.
// Usage: node tests/run-wordpress-real.mjs --wordpress=/path/to/clean/wordpress
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, cp, rm, access, chmod} from 'node:fs/promises';
import {tmpdir, userInfo} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {createBridgeKeys, signBridgeCommand} from '../supabase/functions/_shared/wordpress-bridge.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sourceArg = process.argv.find(value => value.startsWith('--wordpress='));
if (!sourceArg || process.argv.length !== 3) throw Error('Pass only --wordpress=/path/to/clean/wordpress (see docs/WORDPRESS_PRACTICAL_TEST.md).');
const source = resolve(sourceArg.slice('--wordpress='.length));
await access(join(source, 'wp-includes/version.php'));
try { await access(join(source, 'wp-config.php')); throw Error('Use a clean WordPress archive, never an existing installation.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const php = process.env.SMA_TEST_PHP || 'php';
const db = process.env.SMA_TEST_MARIADBD || 'mariadbd';
const client = process.env.SMA_TEST_MARIADB || 'mariadb';
const installDb = process.env.SMA_TEST_MARIADB_INSTALL || 'mariadb-install-db';
const baseArgs = process.env.SMA_TEST_MARIADB_BASEDIR ? [`--basedir=${resolve(process.env.SMA_TEST_MARIADB_BASEDIR)}`] : [];

function run(command, args, {input = '', env = process.env, timeout = 60000} = {}) {
  const child = spawn(command, args, {env, stdio: ['pipe', 'pipe', 'pipe']});
  let stdout = '', stderr = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
  return new Promise((resolveRun, reject) => {
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(Error(`${command} failed (${code}): ${stderr}\n${stdout}`));
      else resolveRun({stdout, stderr});
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
// Check requirements before creating any installation. No package install or hosting purchase.
await run(php, ['-r', 'if (!extension_loaded("mysqli") || !extension_loaded("openssl")) {fwrite(STDERR,"PHP mysqli and OpenSSL required"); exit(1);}']);
await run(db, ['--version']);
await run(client, ['--version']);
// Some managed runtimes support TCP listeners but not Unix sockets.
const loopback = process.env.SMA_TEST_DB_TRANSPORT === 'loopback';
let port;
if (loopback) {
  const probe = createServer();
  await new Promise((ok, fail) => { probe.once('error', fail); probe.listen(0, '127.0.0.1', ok); });
  port = probe.address().port;
  await new Promise((ok, fail) => probe.close(error => error ? fail(error) : ok()));
}
const root = await mkdtemp(join(tmpdir(), 'sma-wp-real-'));
await chmod(root, 0o700);
const socket = join(root, 'mysql.sock');
const password = loopback ? crypto.randomUUID() : '';
const clientArgs = loopback ? ['--protocol=tcp', '--host=127.0.0.1', `--port=${port}`] : [`--socket=${socket}`];
const clientEnv = {...process.env, MYSQL_PWD: password};
const datadir = join(root, 'database');
const wordpress = join(root, 'wordpress');
const env = {...process.env, SMA_WP_FIXTURE: root};
let server, serverClosed, serverLog = '';
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
async function worker(input) {
  const result = await run(php, [join(here, 'wordpress-real/worker.php')], {input: JSON.stringify(input), env});
  if (result.stderr) throw Error(result.stderr);
  try { return JSON.parse(result.stdout); } catch { throw Error('Unexpected WordPress output: ' + result.stdout); }
}
try {
  await mkdir(datadir);
  await cp(source, wordpress, {recursive: true});
  // Keep the source archive's bundled themes, but remove other plugins and DB drop-ins.
  await rm(join(wordpress, 'wp-content'), {recursive: true, force: true});
  await mkdir(join(wordpress, 'wp-content/plugins'), {recursive: true});
  await mkdir(join(wordpress, 'wp-content/mu-plugins'), {recursive: true});
  await cp(join(source, 'wp-content/themes'), join(wordpress, 'wp-content/themes'), {recursive: true});
  await cp(join(here, '../wordpress/sma-bridge'), join(wordpress, 'wp-content/plugins/sma-bridge'), {recursive: true});
  await writeFile(join(root, 'sma-test-fixture'), 'Disposable SMA WordPress test\n');
  await writeFile(join(wordpress, 'wp-content/mu-plugins/sma-test-isolation.php'), `<?php
add_filter('pre_wp_mail', fn() => true);
add_filter('pre_http_request', fn() => new WP_Error('sma_test_offline', 'External requests disabled.'), PHP_INT_MAX);
`);
  const phpString = value => "'" + value.replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'";
  await writeFile(join(wordpress, 'wp-config.php'), `<?php
define('DB_NAME', 'sma_wp_test'); define('DB_USER', 'root'); define('DB_PASSWORD', ${phpString(password)});
define('DB_HOST', ${phpString(loopback ? '127.0.0.1:' + port : 'localhost:' + socket)}); define('DB_CHARSET', 'utf8mb4'); define('DB_COLLATE', '');
define('WP_HOME', 'https://sma-wordpress.test'); define('WP_SITEURL', 'https://sma-wordpress.test');
define('WP_ENVIRONMENT_TYPE', 'local'); define('WP_HTTP_BLOCK_EXTERNAL', true);
define('DISABLE_WP_CRON', true); define('AUTOMATIC_UPDATER_DISABLED', true); define('WP_AUTO_UPDATE_CORE', false);
define('WP_DEBUG', true); define('WP_DEBUG_DISPLAY', true); define('WP_DISABLE_FATAL_ERROR_HANDLER', true);
$table_prefix = 'wp_'; if (!defined('ABSPATH')) define('ABSPATH', __DIR__ . '/'); require_once ABSPATH . 'wp-settings.php';
`);
  const user = userInfo().username;
  await run(installDb, ['--no-defaults', ...baseArgs, `--datadir=${datadir}`, `--user=${user}`, '--auth-root-authentication-method=normal', '--skip-test-db']);
  const transportArgs = loopback ? ['--socket=', '--bind-address=127.0.0.1', `--port=${port}`, `--init-file=${join(root, 'init.sql')}`] : [`--socket=${socket}`, '--skip-networking'];
  if (loopback) await writeFile(join(root, 'init.sql'), `ALTER USER 'root'@'localhost' IDENTIFIED BY '${password}';\n`, {mode: 0o600});
  server = spawn(db, ['--no-defaults', ...baseArgs, `--datadir=${datadir}`, ...transportArgs, `--pid-file=${join(root, 'mysql.pid')}`, `--user=${user}`, '--innodb-buffer-pool-size=32M'], {stdio: ['ignore', 'pipe', 'pipe']});
  server.stdout.on('data', value => { serverLog += value; });
  server.stderr.on('data', value => { serverLog += value; });
  serverClosed = new Promise(resolveClose => { server.on('close', resolveClose); server.on('error', resolveClose); });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw Error('MariaDB exited: ' + serverLog);
    try { await run(client, ['--no-defaults', ...clientArgs, '-uroot', '-e', 'SELECT 1'], {timeout: 2000, env: clientEnv}); ready = true; break; }
    catch { await delay(100); }
  }
  if (!ready) throw Error('MariaDB not ready: ' + serverLog);
  await run(client, ['--no-defaults', ...clientArgs, '-uroot', '-e', 'CREATE DATABASE sma_wp_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'], {env: clientEnv});
  const keys = await createBridgeKeys(); // Ephemeral key; private half never written to disk.
  const attemptId = crypto.randomUUID(), requestId = crypto.randomUUID();
  const sign = patch => signBridgeCommand({privateKey: keys.privateKey, attemptId, requestId, ...patch});
  const versions = await worker({operation: 'install'});
  console.log(JSON.stringify({environment: versions, network: `No HTTP listener; MariaDB ${loopback ? '127.0.0.1 with disposable password' : 'Unix socket only'}; WordPress HTTP and mail disabled`}));
  const website = 'https://sma-wordpress.test/';
  const ticket = randomBytes(32).toString('hex');
  const approval = {ok: true, attempt_id: attemptId, website_url: website, shop_slug: 'sma-local-fixture',
    account_label: 'Synthetic local fixture', public_key: keys.publicKey, expires_at: Math.floor(Date.now()/1000) + 300};
  const fields = await worker({operation: 'consent_form', ticket, approval});
  const inspect = await sign({action: 'inspect', requestId: crypto.randomUUID()});
  const beforeConsent = await worker({operation: 'command', command: inspect});
  assert.equal(beforeConsent.status, 403);
  assert.equal(beforeConsent.data.code, 'sma_not_authorized');
  const consent = (form, response = approval) => worker({operation: 'submit_consent', fields: form, ticket, approval: response});
  assert.deepEqual(await consent({...fields, _wpnonce: ''}), {rejected: true, ticket_reads: 0});
  assert.deepEqual(await consent(fields, {...approval, expires_at: 0}), {rejected: true, ticket_reads: 1});
  assert.equal((await worker({operation: 'command', command: inspect})).status, 403);
  const redirect = {redirect: website+'wp-admin/options-general.php?page=sma-bridge', status: 302, ticket_reads: 1};
  assert.deepEqual(await consent(fields), redirect);
  const approved = await worker({operation: 'command', command: inspect});
  assert.equal(approved.status, 200);
  assert.equal(approved.data.revision, 0);
  assert.equal(approved.data.post_id, null);
  assert.equal(approved.data.can_publish, false);
  console.log('Real WordPress consent form and admin action passed with an isolated ticket response.');
  const create = await sign({action: 'sync_draft', expectedRevision: 0});
  const first = worker({operation: 'command', command: create, hold: true});
  // Attach immediately so an early worker failure cannot become an unhandled rejection.
  let firstError;
  first.catch(error => { firstError = error; });
  let locked = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (firstError) throw firstError;
    try { await access(join(root, 'locked')); locked = true; break; } catch { await delay(25); }
  }
  if (!locked) { await first; throw Error('Could not establish concurrent lock test'); }
  const second = worker({operation: 'command', command: create});
  let secondError, secondFinished = false, observedWait = false;
  second.catch(error => { secondError = error; });
  second.then(() => { secondFinished = true; }, () => { secondFinished = true; });
  let waitError;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (firstError || secondError) throw firstError || secondError;
      // MariaDB can report this as Statistics before exposing an INNODB_LOCK_WAITS row.
      // Observe the actual second locking read while the first transaction is held.
      const waits = await run(client, ['--no-defaults', ...clientArgs, '-uroot', '-Nse', "SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE DB='sma_wp_test' AND INFO='SELECT state FROM wp_sma_bridge_v1 WHERE id=1 FOR UPDATE'"], {env: clientEnv, timeout: 2000});
      if (Number(waits.stdout.trim()) > 0) { await delay(100); observedWait = !secondFinished; break; }
      await delay(25);
    }
  } catch (error) { waitError = error; }
  finally { await writeFile(join(root, 'release'), '1'); }
  const completed = await Promise.allSettled([first, second]);
  if (waitError) throw waitError;
  for (const result of completed) if (result.status === 'rejected') throw result.reason;
  const [a, b] = completed.map(result => result.value);
  assert.ok(observedWait, 'Second locking read must remain pending while the first transaction is held');
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.deepEqual(a.data, b.data);
  assert.equal(a.data.revision, 1);
  console.log('Second locking read waited for the first transaction: same page ID and revision, no duplicate');
  assert.deepEqual(await consent(fields), redirect);
  const afterRepeat = await worker({operation: 'command', command: inspect});
  assert.equal(afterRepeat.data.post_id, a.data.post_id);
  assert.equal(afterRepeat.data.revision, a.data.revision);
  const commands = {
    inspect, unsigned: {...inspect, headers: {}}, tampered: {...create, body: create.body.replace('"expected_revision":0', '"expected_revision":1')},
    replay: await sign({action: 'sync_draft', expectedRevision: 0, issuedAt: Math.floor(Date.now()/1000) + 1}),
    changedIntent: await sign({action: 'sync_draft', expectedRevision: 1}),
    oldRevision: await sign({action: 'sync_draft', expectedRevision: 0, requestId: crypto.randomUUID()}),
    update: await sign({action: 'sync_draft', expectedRevision: 1, requestId: crypto.randomUUID()}),
    next: await sign({action: 'sync_draft', expectedRevision: 2, requestId: crypto.randomUUID()})
  };
  const result = await worker({operation: 'scenarios', commands});
  for (const name of result.passed) console.log('PASS ' + name);
  console.log(`Real WordPress/MariaDB: ${result.count} assertions and concurrent request check passed. No live SMA connection or external TLS test.`);
} finally {
  if (server) {
    server.kill('SIGTERM');
    await Promise.race([serverClosed, delay(5000)]);
    if (server.exitCode === null && server.signalCode === null) { server.kill('SIGKILL'); await serverClosed; }
  }
  await rm(root, {recursive: true, force: true});
}
