import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {PGlite} from '../sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import {installWordpressFixture} from '../sql-runtime/wordpress-fixture.mjs';
import {createConnectHandler, createTicketHandler} from '../../supabase/functions/sma-wordpress-connect/handler.mjs';
import {createSyncHandler} from '../../supabase/functions/sma-wordpress-sync/handler.mjs';

export async function checkDraftRoundTrip({worker, website}) {
  const db = new PGlite();
  const owner = crypto.randomUUID();
  const auth = 'Bearer ' + crypto.randomUUID();
  const account = 'customer@example.invalid', shop = 'sma-local-fixture';
  const authenticate = async header => header === auth ? {id: owner} : null;

  // The two RPC adapters execute repository SQL with the role of the corresponding Edge call.
  async function rpc(role, name, args) {
    assert.match(name, /^sma_[a-z_]+_v1$/);
    const names = Object.keys(args);
    const placeholders = names.map((key, index) => {
      assert.match(key, /^p_[a-z_]+$/);
      return key + ' => $' + (index + 1);
    });
    return db.transaction(async tx => {
      if (role === 'authenticated') {
        await tx.exec('SET LOCAL ROLE authenticated');
        await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [owner]);
      } else {
        assert.equal(role, 'service_role');
        await tx.exec('SET LOCAL ROLE service_role');
      }
      const result = await tx.query('SELECT public.' + name + '(' + placeholders.join(', ') + ') AS value', Object.values(args));
      return result.rows[0].value;
    });
  }
  const serviceRpc = (name, args) => rpc('service_role', name, args);
  const userRpc = (header, action, input) => {
    assert.equal(header, auth);
    return rpc('authenticated', 'sma_website_connection_request_v1', {p_action: action, p_input: input});
  };

  const ticketHandler = createTicketHandler({serviceRpc});
  let ticketReads = 0;
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/ticket');
      assert.equal(req.method, 'POST');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = await ticketHandler(new Request('http://localhost/ticket', {
        method: 'POST', body: Buffer.concat(chunks), headers: {'Content-Type': 'application/json'}
      }));
      ticketReads++;
      res.writeHead(response.status, {'Content-Type': 'application/json'}).end(await response.text());
    } catch {
      res.writeHead(500).end();
    }
  });

  let dropNextSyncReply = true;
  const writes = [];
  async function probe(url, command) {
    assert.equal(url, website);
    const result = await worker({operation: 'command', command});
    assert.equal(result.status, 200, 'native WordPress REST must accept the signed command');
    const body = JSON.parse(command.body);
    if (body.action === 'sync_draft') {
      writes.push({requestId: body.request_id, revision: body.expected_revision, postId: result.data.post_id});
      if (dropNextSyncReply) {
        dropNextSyncReply = false;
        throw Error('Simulated loss of the first committed WordPress reply');
      }
    }
    return result.data;
  }
  const connect = createConnectHandler({authenticate, userRpc, serviceRpc, probe});
  const sync = createSyncHandler({authenticate, serviceRpc, probe});
  async function invoke(handler, input) {
    const response = await handler(new Request('https://example.org/edge', {
      method: 'POST', headers: {Authorization: auth, Origin: 'https://sma-automation.com'}, body: JSON.stringify(input)
    }));
    const data = await response.json();
    assert.equal(response.status, 200, data.code);
    assert.equal(data.ok, true);
    assert.equal(data.can_publish, false);
    return data;
  }

  try {
    await installWordpressFixture(db);
    await db.query('INSERT INTO auth.users VALUES ($1,$2)', [owner, account]);
    await db.query("INSERT INTO public.sma_kunden(id,user_id,paket,aktiv,zahlung_bestaetigt,shop_slug,shop_oeffentlich) VALUES (-1,$1,'delta',true,true,$2,true)", [owner, shop]);
    const saved = await rpc('authenticated', 'sma_website_preparation_v1', {p_action: 'save', p_input: {
      mode: 'existing', website_url: website, desired_domain: '', expected_revision: 0, request_id: crypto.randomUUID()
    }});
    assert.equal(saved.ok, true);
    const pending = await invoke(connect, {action: 'start', expected_revision: 0, request_id: crypto.randomUUID()});
    assert.equal(pending.state, 'pending');
    const attempt = {attempt_id: pending.attempt_id};
    const ticket = new URL(pending.authorization_url).searchParams.get('ticket');
    assert.ok(typeof ticket === 'string' && /^[a-f0-9]{64}$/.test(ticket), 'expected a ticket in the admin URL');

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const formInput = {ticket, ticket_port: server.address().port, ticket_labels: {account_label: account, shop_slug: shop}};
    const fields = await worker({operation: 'consent_form', ...formInput});
    const approval = await worker({operation: 'submit_consent', ...formInput, fields});
    assert.equal(approval.redirect, website + 'wp-admin/options-general.php?page=sma-bridge');
    assert.equal(approval.status, 302);
    assert.equal(ticketReads, 2, 'both the form and its submission retrieve the bound ticket from SMA');
    assert.equal((await invoke(connect, {action: 'verify', ...attempt})).state, 'verified');
    assert.equal((await invoke(sync, {action: 'status', ...attempt})).state, 'idle');
    const pages = () => worker({operation: 'product_pages'});
    assert.deepEqual(await pages(), []);

    const retry = await invoke(sync, {action: 'sync', ...attempt});
    assert.equal(retry.state, 'retry');
    assert.equal(retry.last_error, 'PROVIDER_UNAVAILABLE');
    assert.equal(writes.length, 1);
    const draft = [{id: writes[0].postId, status: 'draft'}];
    assert.deepEqual(await pages(), draft, 'WordPress committed before its reply was lost');
    assert.ok(Number.isSafeInteger(retry.retry_after));
    const wait = Math.max(0, retry.retry_after * 1000 - Date.now());
    assert.ok(wait <= 17000, 'unexpected retry interval');
    await delay(wait + 100);
    const completed = await invoke(sync, {action: 'sync', ...attempt});
    assert.equal(completed.state, 'draft');
    assert.equal(completed.post_id, draft[0].id);
    assert.equal(completed.revision, 1);
    assert.equal(completed.edit_url, website + 'wp-admin/post.php?post=' + draft[0].id + '&action=edit');
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1], writes[0], 'retry must reuse the request, baseline and WordPress page');
    assert.deepEqual(await invoke(sync, {action: 'status', ...attempt}), completed);
    assert.deepEqual(await invoke(sync, {action: 'sync', ...attempt}), completed);
    assert.equal(writes.length, 2, 'a completed job must not dispatch again');
    assert.deepEqual(await pages(), draft);
    console.log('PASS SMA ticket, WordPress admin consent, verification, committed draft, lost response and durable retry with one page');
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await db.close();
  }
}
