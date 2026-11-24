import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from './dom-runtime/node_modules/playwright-core/index.mjs';

const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
try {
  for (const mobile of [false,true]) {
    const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1200,height:800},hasTouch:mobile,
      reducedMotion:mobile?'reduce':'no-preference'});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://sma.example/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="de"><body>
        <button id="preview">Hörprobe</button><button id="cancel">Abbrechen</button><button id="retry">Erneut versuchen</button><button id="tab">Tracks</button>
        <form id="form"><input name="title"><button id="save">Speichern</button></form>
        <div id="region"></div><iframe id="dashboard" srcdoc="<button id='inside'>Im Kapitel speichern</button>"></iframe>
        <script type="module" src="/app/assets/dashboard-feedback-page.mjs"></script></body></html>`});
      assert.match(path,/^\/app\/assets\/dashboard-feedback(?:-page)?\.(?:mjs|css)$/);
      return route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',body:await readFile('.'+path)});
    });
    await page.goto('https://sma.example/');
    await page.evaluate(async()=>{
      const {dashboardAction}=await import('/app/assets/dashboard-feedback.mjs?v=1');
      window.calls={preview:0,form:0,cancel:0,tab:0,inside:0,retry:0};window.finish={};
      const run=key=>{calls[key]++;return new Promise(resolve=>finish[key]=resolve);};
      document.querySelector('#preview').addEventListener('click',dashboardAction(()=>run('preview')));
      document.querySelector('#form').addEventListener('submit',dashboardAction(e=>{e.preventDefault();return run('form');}));
      const attempt=dashboardAction(()=>{calls.retry++;return new Promise((_,reject)=>finish.retry=reject);});
      document.querySelector('#retry').addEventListener('click',event=>attempt(event)?.catch(()=>{}));
      document.querySelector('#tab').onclick=()=>{calls.tab++;};
      document.querySelector('#cancel').onclick=()=>{calls.cancel++;finish.preview();};
      document.querySelector('iframe').contentDocument.querySelector('#inside').onclick=async()=>run('inside');
    });
    const bar=page.locator('.sma-action-feedback');
    const activate=locator=>mobile?locator.tap():locator.click();
    await activate(page.locator('#preview'));
    assert.equal(await bar.getAttribute('data-working'),'');
    assert.equal(await bar.evaluate(el=>getComputedStyle(el,'::before').animationName),mobile?'none':'sma-action-loading');
    await page.locator('#preview').evaluate(el=>{for(let i=0;i<4;i++)el.click();});
    await page.locator('input').focus();await page.keyboard.press('Enter');
    await page.locator('#form').evaluate(el=>{for(let i=0;i<4;i++)el.requestSubmit();});
    await activate(page.locator('#cancel'));
    assert.equal(await bar.getAttribute('data-working'),'');
    await page.evaluate(()=>finish.form());await page.waitForFunction(()=>!document.querySelector('[data-working]'));
    await page.locator('#save').focus();await page.keyboard.press('Enter');await page.evaluate(()=>finish.form());
    for(let i=0;i<2;i++){
      await activate(page.locator('#retry'));
      await page.locator('#retry').evaluate(el=>el.click());
      await page.evaluate(()=>finish.retry(Error('Verbindung unterbrochen')));
      await page.waitForFunction(()=>!document.querySelector('[data-working]'));
    }
    await activate(page.locator('#tab'));await activate(page.locator('#tab'));
    const frame=page.frameLocator('iframe');
    await activate(frame.locator('#inside'));await activate(frame.locator('#inside'));
    assert.equal(await frame.locator('.sma-action-feedback').getAttribute('data-working'),'');
    await page.evaluate(()=>finish.inside());
    await page.locator('#region').evaluate(el=>el.setAttribute('aria-busy','true'));
    // Even an otherwise empty test region must have rendered dimensions.
    await page.locator('#region').evaluate(el=>el.textContent='Dateien werden geladen');
    await page.waitForFunction(()=>document.querySelector('.sma-action-feedback').hasAttribute('data-working'));
    await page.locator('#region').evaluate(el=>el.removeAttribute('aria-busy'));
    await page.waitForFunction(()=>!document.querySelector('.sma-action-feedback').hasAttribute('data-working'));
    assert.deepEqual(await page.evaluate(()=>calls),{preview:1,form:2,cancel:1,tab:2,inside:1,retry:2});
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Dashboard action feedback passed on desktop and touch, including concurrent work, repeated submits, native iframe handlers, cancellation and reduced motion.');
} finally {await browser.close();}
