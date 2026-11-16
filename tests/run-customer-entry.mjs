import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from './dom-runtime/node_modules/playwright-core/index.mjs';

const site = 'https://sma.test';
const pages = new Map([
  [site + '/', await readFile('index.html')],
  [site + '/app/index.html', await readFile('app/index.html')]
]);
const authModule = `export function createClient() {
  const query = new URLSearchParams(location.search);
  let session = query.get('type') === 'recovery' && !query.has('error_code')
    ? {user:{id:'recovery-customer',email:'reset@example.invalid'}} : null;
  let authChange;
  function signedOut(result = {error:null}) {
    if (!result.error) { session = null; authChange?.('SIGNED_OUT', null); }
    return result;
  }
  return {auth: {
    onAuthStateChange(callback) {
      authChange = callback;
      window.emitAuthEvent = event => callback(event, session);
    },
    async getSession() {
      window.recoveryCalls.session++;
      if (query.get('bootstrap') === 'pending' && window.recoveryCalls.session === 1) {
        return new Promise((resolve, reject) => {
          window.finishInitialSession = result => result === 'reject'
            ? reject(Error('simulated late initial session failure'))
            : resolve({data:{session:result === 'session'
              ? {user:{id:'late-initial-customer',email:'entry@example.invalid'}} : null}});
        });
      }
      if (window.sessionResult === 'offline') throw Error('simulated session interruption');
      return {data:{session:window.sessionResult === 'missing' ? null : session}};
    },
    async updateUser(args) {
      window.recoveryCalls.update++;
      window.recoveryCalls.passwordMatches = args.password === 'Recovery909!';
      if (window.updateResult === 'offline') throw Error('simulated update interruption');
      if (window.updateResult === 'pending') return new Promise(resolve => {
        window.finishUpdate = () => resolve({data:{user:session.user},error:null});
      });
      return {data:{user:session.user},error:null};
    },
    async signOut() {
      window.recoveryCalls.signOut++;
      if (window.signOutResult === 'pending') return new Promise(resolve => {
        window.finishSignOut = result => resolve(signedOut(result));
      });
      return signedOut();
    },
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
    await page.addInitScript(() => {
      window.authCalls = [];
      window.recoveryCalls = {session:0,update:0,signOut:0,passwordMatches:false};
    });
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

    const newPassword = page.getByLabel('Neues Passwort', {exact:true});
    const confirmation = page.getByLabel('Neues Passwort wiederholen', {exact:true});
    const savePassword = page.getByRole('button', {name:'Neues Passwort speichern', exact:true});
    async function openRecovery() {
      await page.goto(site+'/app/index.html?type=recovery#type=recovery');
      await page.getByRole('heading', {name:'Neues Passwort', exact:true}).waitFor();
      await page.waitForFunction(() => window.recoveryCalls.session === 1 && !document.getElementById('authSubmit').disabled);
      await newPassword.fill('Recovery909!');
      await confirmation.fill('Recovery909!');
    }
    async function activate(button) {
      if (mobile) await button.tap();
      else await button.press('Enter');
    }

    // A link may expire after the password form is already open. The visible
    // replacement-link form must work without a password write or a page reload.
    await openRecovery();
    await page.evaluate(() => {window.sessionResult = 'missing';});
    await activate(savePassword);
    await page.locator('#forgotView').waitFor({state:'visible'});
    assert.equal(await page.locator('#resetView').isVisible(), false);
    assert.deepEqual(await page.evaluate(() => window.recoveryCalls), {
      session:2,update:0,signOut:0,passwordMatches:false
    });
    await mail.fill('reset@example.invalid');
    await activate(page.getByRole('button', {name:'Wiederherstellungslink senden', exact:true}));
    await page.getByText(/Link zum Zurücksetzen/).waitFor();
    assert.deepEqual(await page.evaluate(() => window.authCalls), [{
      reset:'reset@example.invalid',options:{redirectTo:'https://sma-automation.com/app/'}
    }]);

    // Both reads and writes can reject. Inputs stay available until the write
    // is confirmed; a failed sign-out must then retry only that remaining step.
    await openRecovery();
    for (const stage of ['session', 'update']) {
      await page.evaluate(stage => {
        window.sessionResult = stage === 'session' ? 'offline' : 'ok';
        window.updateResult = stage === 'update' ? 'offline' : 'ok';
      }, stage);
      await activate(savePassword);
      await page.waitForFunction(() => !document.getElementById('savePasswordButton').disabled && document.getElementById('status').classList.contains('error'));
      assert.equal(await newPassword.inputValue(), 'Recovery909!');
      assert.equal(await confirmation.inputValue(), 'Recovery909!');
      assert.equal(await savePassword.isEnabled(), true);
      assert.equal(await page.locator('#loginView').isVisible(), false);
      assert.equal(await page.evaluate(() => window.recoveryCalls.signOut), 0);
    }
    assert.deepEqual(await page.evaluate(() => window.recoveryCalls), {
      session:3,update:1,signOut:0,passwordMatches:true
    });

    await page.evaluate(() => {window.updateResult='pending';window.signOutResult='pending';});
    await activate(savePassword);
    await page.waitForFunction(() => typeof window.finishUpdate === 'function');
    assert.equal(await savePassword.isDisabled(), true);
    await page.locator('#resetForm').dispatchEvent('submit');
    assert.equal(await page.evaluate(() => window.recoveryCalls.update), 2);
    await page.evaluate(() => window.finishUpdate());
    await page.waitForFunction(() => typeof window.finishSignOut === 'function');
    await page.locator('#resetForm').dispatchEvent('submit');
    assert.equal(await page.evaluate(() => window.recoveryCalls.signOut), 1);
    await page.evaluate(() => window.finishSignOut({error:{message:'simulated sign-out interruption'}}));
    const retrySignOut = page.getByRole('button', {name:'Abmeldung erneut versuchen', exact:true});
    await page.waitForFunction(() => !document.getElementById('savePasswordButton').disabled);
    const confirmedStatus = await page.locator('#status').textContent();
    await page.evaluate(() => window.emitAuthEvent('PASSWORD_RECOVERY'));
    assert.equal(await page.locator('#status').textContent(), confirmedStatus);
    assert.equal(await retrySignOut.isVisible(), true);
    assert.equal(await newPassword.inputValue(), '');
    assert.equal(await confirmation.inputValue(), '');
    assert.equal(await newPassword.isDisabled(), true);
    assert.equal(await confirmation.isDisabled(), true);
    assert.match(await page.locator('#status').textContent(), /Passwort.*geändert/);
    assert.equal(await page.locator('#loginView').isVisible(), false);
    await page.evaluate(() => {window.signOutResult='ok';});
    await activate(retrySignOut);
    await page.getByRole('heading', {name:'Kundenbereich', exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(() => window.recoveryCalls), {
      session:4,update:2,signOut:2,passwordMatches:true
    });
    assert.equal(new URL(page.url()).search, '');
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(await page.getByLabel('Passwort', {exact:true}).inputValue(), '');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    // The first session read can stall before any button listener used to be
    // attached. Exercise the rendered page while that promise is still pending.
    await page.clock.install();
    await page.goto(site + '/app/index.html?bootstrap=pending', {waitUntil:'commit'});
    await page.waitForFunction(() => typeof window.finishInitialSession === 'function');
    await page.getByLabel('E-Mail-Adresse', {exact:true}).fill('entry@example.invalid');
    await activate(page.getByRole('button', {name:'Passwort vergessen?', exact:true}));
    assert.equal(await mail.inputValue(), 'entry@example.invalid');
    await activate(page.getByRole('button', {name:'Wiederherstellungslink senden', exact:true}));
    await page.getByText(/Link zum Zurücksetzen/).waitFor();
    const helpStatus = await page.locator('#status').textContent();
    await page.evaluate(() => {
      window.emitAuthEvent('PASSWORD_RECOVERY');
      window.finishInitialSession('session');
    });
    await page.clock.runFor(1);
    assert.equal(await page.locator('#status').textContent(), helpStatus);
    assert.equal(await page.locator('#forgotView').isVisible(), true);
    assert.deepEqual(await page.evaluate(() => window.authCalls), [{
      reset:'entry@example.invalid',options:{redirectTo:'https://sma-automation.com/app/'}
    }]);
    await activate(page.getByRole('button', {name:'Zur Anmeldung', exact:true}));
    assert.equal(await page.getByRole('button', {name:'Anmelden', exact:true}).isEnabled(), true);

    for (const late of ['session', 'reject']) {
      await page.goto(site + '/app/index.html?bootstrap=pending', {waitUntil:'commit'});
      await page.waitForFunction(() => typeof window.finishInitialSession === 'function');
      await page.clock.fastForward(15001);
      assert.equal(await page.getByRole('button', {name:'Anmelden', exact:true}).isEnabled(), true);
      assert.match(await page.locator('#status').textContent(), /lange|erreichbar|erneut|geprüft/i);
      await page.getByLabel('E-Mail-Adresse', {exact:true}).fill('entry@example.invalid');
      await page.getByLabel('Passwort', {exact:true}).fill('EntryExample909!');
      await activate(page.getByRole('button', {name:'Anmelden', exact:true}));
      await page.getByText('Testanmeldung', {exact:true}).waitFor();
      await page.evaluate(result => window.finishInitialSession(result), late);
      await page.clock.runFor(1);
      assert.equal(await page.locator('#status').textContent(), 'Testanmeldung');
      assert.equal(await page.locator('#loginView').isVisible(), true);
      assert.deepEqual(await page.evaluate(() => window.authCalls), ['signIn']);
      assert.equal(new URL(page.url()).pathname, '/app/index.html');
    }

    await page.goto(site + '/app/index.html?type=recovery&bootstrap=pending#type=recovery', {waitUntil:'commit'});
    await page.waitForFunction(() => typeof window.finishInitialSession === 'function');
    await newPassword.fill('Recovery909!');
    await confirmation.fill('Recovery909!');
    await page.clock.fastForward(15001);
    const stalledRecoveryStatus = await page.locator('#status').textContent();
    assert.match(stalledRecoveryStatus, /lange|erneut|geprüft/i);
    await page.evaluate(() => {
      window.emitAuthEvent('PASSWORD_RECOVERY');
      window.finishInitialSession('missing');
    });
    await page.clock.runFor(1);
    assert.equal(await page.locator('#status').textContent(), stalledRecoveryStatus);
    assert.equal(await newPassword.inputValue(), 'Recovery909!');
    assert.equal(await confirmation.inputValue(), 'Recovery909!');
    assert.equal(await savePassword.isEnabled(), true);
    assert.equal(new URL(page.url()).hash, '#type=recovery');
    await activate(savePassword);
    await page.getByRole('heading', {name:'Kundenbereich', exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(() => window.recoveryCalls), {
      session:2,update:1,signOut:1,passwordMatches:true
    });
    console.log(mobile ? 'Hängender Kundeneinstieg auf dem Handy sicher abgefangen.' : 'Hängender Kundeneinstieg per Tastatur sicher abgefangen.');
    console.log(mobile ? 'Passwort-Wiederherstellung auf dem Handy bestanden.' : 'Passwort-Wiederherstellung per Tastatur bestanden.');
    assert.deepEqual(unexpected, []);
    console.log(mobile ? 'Kundeneinstieg auf dem Handy bestanden.' : 'Kundeneinstieg per Tastatur bestanden.');
    await context.close();
  }
} finally {
  await browser.close();
}
