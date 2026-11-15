import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from '../dom-runtime/node_modules/linkedom/esm/index.js';
import { mountCustomerWebsiteDomain } from '../../app/assets/customer-website-domain-view.mjs';

export async function verifyDomainLifecycle({ db, owner, hostname, siteId, profile, repeatSetup }) {
  const origin = 'https://' + hostname;
  const binding = { origin, siteId };
  const html = await readFile(new URL('../../hosting/customer-website/index.html', import.meta.url), 'utf8');
  const offlineMessage = 'Diese Webseite ist derzeit nicht verfügbar.';

  async function asOwner(sql, args) {
    await db.exec('set role authenticated');
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
      return (await db.query(sql, args)).rows[0].result;
    } finally {
      await db.exec('reset role');
    }
  }

  const website = (action, data = {}) =>
    asOwner('select public.sma_customer_website_v1($1, $2) as result', [action, data]);
  const revision = (siteRevision, companyRevision) => ({
    request_id: crypto.randomUUID(), expected_revision: siteRevision, expected_company_revision: companyRevision
  });

  async function visit(expected = null) {
    const { document } = parseHTML(html);
    let reads = 0;
    let snapshot;
    const page = mountCustomerWebsiteDomain({
      doc: document, href: origin + '/', binding,
      publicWebsiteRequest: async id => {
        assert.equal(id, siteId);
        reads++;
        await db.exec('set role anon');
        try {
          await db.query("select set_config('request.jwt.claim.sub', '', false)");
          await db.query("select set_config('request.headers', $1, false)", [JSON.stringify({ origin })]);
          snapshot = (await db.query('select public.sma_customer_website_public_v1($1) as result', [id])).rows[0].result;
          return snapshot;
        } finally {
          await db.exec('reset role');
        }
      }
    });
    try {
      await page.load();
      assert.equal(reads, 1);
      const root = document.getElementById('site');
      const error = document.getElementById('pageError');
      assert.equal(root.hidden, expected === null);
      assert.equal(error.hidden, expected !== null);
      if (expected === null) {
        assert.deepEqual(snapshot, { ok: false, code: 'NOT_AVAILABLE' });
        assert.equal(error.textContent, offlineMessage);
        assert.equal(root.children.length, 0);
      } else {
        assert.equal(snapshot.ok, true);
        assert.equal(snapshot.content.headline, expected.headline);
        assert.equal(snapshot.company_profile.city, expected.city);
        assert.equal(root.querySelector('[data-headline]').textContent, expected.headline);
        assert.ok(root.querySelector('[data-company-facts]').textContent.includes(expected.city));
      }
    } finally {
      page.destroy();
    }
  }

  const draft = await website('get');
  assert.equal(draft.site_id, siteId);
  assert.equal(draft.custom_domain.hostname, hostname);
  assert.equal(draft.published, false);
  await visit();

  const first = await website('publish', revision(draft.revision, draft.company_revision));
  assert.equal(first.publicly_available, true);
  const original = { headline: draft.content.headline, city: profile.city };
  await visit(original);
  await repeatSetup();
  assert.equal((await website('get')).revision, first.revision);
  await visit(original);

  const edited = { headline: 'Heizung und Sanitär im Test', city: 'Linz' };
  const changedCompany = await asOwner('select public.sma_company_profile_v1($1, $2) as result', [
    'save', { request_id: crypto.randomUUID(), expected_revision: draft.company_revision, profile: { ...profile, city: edited.city } }
  ]);
  assert.equal(changedCompany.ok, true);
  const editedDraft = await website('save', {
    ...revision(first.revision, changedCompany.revision), content: { ...first.content, headline: edited.headline }
  });
  assert.equal(editedDraft.has_changes, true);
  await visit(original);
  assert.equal((await website('publish', revision(editedDraft.revision, draft.company_revision))).code, 'COMPANY_PROFILE_CHANGED');
  await visit(original);

  const published = await website('publish', revision(editedDraft.revision, changedCompany.revision));
  assert.equal(published.publicly_available, true);
  await visit(edited);
  const offline = await website('unpublish', { request_id: crypto.randomUUID(), expected_revision: published.revision });
  assert.equal(offline.published, false);
  assert.equal(offline.custom_domain.hostname, hostname);
  assert.equal(offline.content.headline, edited.headline);
  await visit();
}
