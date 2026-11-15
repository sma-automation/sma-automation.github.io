import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from './dom-runtime/node_modules/playwright-core/index.mjs';

const site = 'https://sma.test';
const pages = new Map([
  [site + '/', await readFile('index.html')],
  [site + '/app/index.html', await readFile('app/index.html')]
]);
const authModule = `export function createClient() {
  return {auth: {
    onAuthStateChange() {},
    async getSession() { return {data: {session: null}}; },
    async signUp() { window.authCalls.push('signUp'); return {data: {session: null}}; },
    async signInWithPassword() { window.authCalls.push('signIn'); return {error: {message: 'Testanmeldung'}}; }
  }};
}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN, channel: process.env.CHROME_BIN ? undefined : 'chrome'
});
try {
  for (const mobile of [false, true]) {
    const viewport = mobile ? {width: 375, height: 812} : {width: 1366, height: 768};
    const context = await browser.newContext({viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block'});
    const page = await context.newPage();
    const unexpected = [];
    await page.addInitScript(() => { window.authCalls = []; });
    page.on('pageerror', error => unexpected.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'GET') {
        const body = pages.get(url.origin + url.pathname);
        if (body) return route.fulfill({contentType: 'text/html; charset=utf-8', body});
        if (url.href === 'https://esm.sh/@supabase/supabase-js@2')
          return route.fulfill({contentType: 'text/javascript', body: authModule});
      }
      unexpected.push(request.method() + ' ' + url.pathname);
      return route.abort();
    });

    for (const registering of [true, false]) {
      await page.goto(site);
      const entry = page.locator('#login').getByRole('link', {name: registering ? 'Registrieren' : 'Login', exact: true});
      if (mobile) await entry.tap();
      else await entry.press('Enter');
      await page.getByRole('heading', {name: registering ? 'SMA-Konto erstellen' : 'Kundenbereich', exact: true}).waitFor();
      assert.deepEqual(await page.evaluate(() => window.authCalls), []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const password = page.getByLabel('Passwort', {exact: true});
      assert.equal(await password.getAttribute('autocomplete'), registering ? 'new-password' : 'current-password');
      await page.getByLabel('E-Mail-Adresse', {exact: true}).fill('erstkunde@example.invalid');
      await password.fill(registering ? 'Beispiel909!' : 'alt');
      if (mobile) await page.getByRole('button', {name: registering ? 'Konto erstellen' : 'Anmelden', exact: true}).tap();
      else await password.press('Enter');
      await page.getByText(registering ? /prüfe dein Postfach/ : 'Testanmeldung').waitFor();
      assert.deepEqual(await page.evaluate(() => window.authCalls), [registering ? 'signUp' : 'signIn']);
    }
    assert.deepEqual(unexpected, []);
    console.log(mobile ? 'Kundeneinstieg auf dem Handy bestanden.' : 'Kundeneinstieg per Tastatur bestanden.');
    await context.close();
  }
} finally {
  await browser.close();
}
