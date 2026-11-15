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
    async signInWithPassword() { window.authCalls.push('signIn'); return {error: {message: 'Testanmeldung',code:window.loginCode}}; },
    async resend(args) {
      window.authCalls.push(args);
      if(window.resendResult==='pending') return new Promise(resolve => {window.finishResend=()=>resolve({error:null});});
      if(window.resendResult==='offline') throw Error('offline');
      if(window.resendResult==='limited') return {error:{status:429}};
      return {error:null};
    },
    async resetPasswordForEmail(email, options) {window.authCalls.push({reset:email,options});return {error:null};}
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
      if (registering) {
        const resend = page.getByRole('button',{name:'Bestätigungsmail erneut anfordern'});
        const address = page.getByLabel('E-Mail-Adresse deines SMA-Kontos');
        assert.equal(await address.inputValue(),'erstkunde@example.invalid');
        assert.equal(await password.isVisible(),false);
        await page.evaluate(()=>{window.resendResult='pending';});
        if (mobile) await resend.tap(); else await resend.press('Enter');
        await page.waitForFunction(()=>typeof window.finishResend==='function');
        assert.equal(await resend.isDisabled(),true);
        await page.locator('#forgotForm').dispatchEvent('submit');
        await page.evaluate(()=>window.finishResend());
        await page.getByText(/Falls die Bestätigung/).waitFor();
        assert.deepEqual(await page.evaluate(()=>window.authCalls),['signUp',{
          type:'signup',email:'erstkunde@example.invalid',options:{emailRedirectTo:'https://sma-automation.com/app/'}
        }]);
      }
    }

    // Returning customers may arrive from an expired link without a link type.
    await page.goto(site);
    await page.goto(site+'/app/index.html#error=access_denied&error_code=otp_expired');
    await page.getByText(/Dieser Link ist abgelaufen/).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.authCalls),[]);
    await page.getByRole('button',{name:'Bestätigungsmail fehlt?'}).click();
    const mail=page.getByLabel('E-Mail-Adresse deines SMA-Kontos');
    const send=page.getByRole('button',{name:'Bestätigungsmail erneut anfordern'});
    await mail.fill('weiter@example.invalid');
    for (const [result,message] of [['limited',/warte einen Moment/],['offline',/nicht angefordert werden/],['ok',/Falls die Bestätigung/]]) {
      await page.evaluate(value=>{window.resendResult=value;},result);
      await send.click();await page.getByText(message).waitFor();
      assert.equal(await send.isEnabled(),true);
    }
    await page.getByRole('button',{name:'Zur Anmeldung'}).click();
    assert.equal(await page.getByLabel('E-Mail-Adresse',{exact:true}).inputValue(),'weiter@example.invalid');
    await page.evaluate(()=>{window.loginCode='email_not_confirmed';});
    await page.getByLabel('Passwort',{exact:true}).fill('alt');
    await page.getByRole('button',{name:'Anmelden',exact:true}).click();
    await page.getByText('Bitte bestätige zuerst deine E-Mail-Adresse.').waitFor();
    assert.equal(await mail.inputValue(),'weiter@example.invalid');
    assert.equal(await page.evaluate(()=>window.authCalls.length),4);

    await page.goto(site+'/app/index.html?type=recovery&error_code=otp_expired');
    await page.getByText(/Dieser Link ist abgelaufen/).waitFor();
    await mail.fill('reset@example.invalid');
    await page.getByRole('button',{name:'Wiederherstellungslink senden'}).click();
    await page.getByText(/Link zum Zurücksetzen/).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.authCalls),[{reset:'reset@example.invalid',options:{redirectTo:'https://sma-automation.com/app/'}}]);
    assert.deepEqual(unexpected, []);
    console.log(mobile ? 'Kundeneinstieg auf dem Handy bestanden.' : 'Kundeneinstieg per Tastatur bestanden.');
    await context.close();
  }
} finally {
  await browser.close();
}
