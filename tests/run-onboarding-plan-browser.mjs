// Regular dashboard shell and real package form, with all service responses supplied here.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from './dom-runtime/node_modules/playwright-core/index.mjs';

const site = 'https://sma.test';
const fakeClient = `export function createClient(){return {
 auth:{getSession:async()=>({data:{session:sessionStorage.signedOut?null:{user:{id:'fixture'},access_token:'fixture'}}}),
   onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},
   signInWithPassword:async()=>{sessionStorage.removeItem('signedOut');return {data:{session:{user:{id:'fixture'}}}};} },
 functions:{invoke:async(name,options)=>({data:await (await fetch('/fixture/'+name,{method:'POST',body:JSON.stringify(options.body)})).json()})},
 rpc: async(name,params) => ({data:await (await fetch('/fixture/'+name,{method:'POST',body:JSON.stringify(params)})).json()})
};}`;
const browser = await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
try {
  for (const mobile of [false,true]) {
    const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
    const page=await context.newPage();
    const errors=[];
    let saved=null, writes=0, sessionReads=0, linked=false, offer=null, bookings=0, paymentCalls=0;
    const order='80000000-0000-4000-8000-000000000001';
    const returnUrl=site+'/app/paketwahl.html?buchung='+order;
    let paymentState='booked',statusReads=0;
    page.on('pageerror',err=>errors.push(err.message));
    await page.route('**/*',async route=>{
      const req=route.request(), url=new URL(req.url());
      if (req.method()==='GET' && url.origin===site && /^\/app\/(dashboard\.html|index\.html|paketwahl\.html|assets\/[\w.-]+\.m?js)$/.test(url.pathname))
        return route.fulfill({contentType:url.pathname.endsWith('.html')?'text/html; charset=utf-8':'text/javascript',body:await readFile(new URL('..'+url.pathname,import.meta.url))});
      if (req.method()==='GET' && url.origin==='https://esm.sh' && /^\/@supabase\/supabase-js@2(?:\.57\.4)?$/.test(url.pathname))
        return route.fulfill({contentType:'text/javascript',body:fakeClient});
      if (req.method()==='POST' && url.href==='https://johnmusic.app.n8n.cloud/webhook/sma-dashboard-session') {
        sessionReads++;
        if(paymentState==='active') return route.fulfill({json:{html:'<body data-sma-customer-id="fixture"><p>Mein Kundenbereich</p></body>'}});
        return route.fulfill({status:403,json:{error:'Zugang nicht freigeschaltet oder Anmeldung abgelaufen.'}});
      }
      if (req.method()==='POST' && url.href===site+'/fixture/sma_onboarding_plan_choice_v1') {
        const {p_owner,p_plan,p_expected_plan}=req.postDataJSON();
        assert.equal(p_owner,'fixture');
        if (p_plan && p_expected_plan!==saved && p_plan!==saved)
          return route.fulfill({json:{ok:false,code:'CONFLICT',plan:saved}});
        if (p_plan) {saved=p_plan;writes++;}
        return route.fulfill({json:{ok:true,plan:saved,linked}});
      }
      if(req.method()==='POST' && url.href===site+'/fixture/sma_onboarding_booking_v1'){
        const {p_offer,p_plan,p_terms}=req.postDataJSON();
        if(p_offer){
          assert.equal(p_offer,offer.id);assert.equal(p_plan,saved);assert.equal(p_terms,offer.terms);bookings++;
          offer={...offer,state:'booked',id:offer.automated?'actual-booking':offer.id,checkout:offer.automated?null:'https://www.mollie.com/checkout/fixture'};
        }
        return route.fulfill({json:{ok:true,offer}});
      }
      if(req.method()==='POST' && url.href===site+'/fixture/sma-package-payment'){
        assert.deepEqual(req.postDataJSON(),{owner:'fixture',order:'actual-booking'});
        paymentCalls++;
        offer={...offer,checkout:'https://www.mollie.com/checkout/fixture'};
        return route.fulfill({json:{code:'BOOKED'}});
      }
      if(req.method()==='POST' && url.href===site+'/fixture/sma_onboarding_payment_status_v1'){
        assert.deepEqual(req.postDataJSON(),{p_order:order});statusReads++;
        if(paymentState==='offline') return route.fulfill({status:503,body:'unavailable'});
        return route.fulfill({body:JSON.stringify(paymentState),contentType:'application/json'});
      }
      errors.push(req.method()+' '+url.pathname);return route.abort();
    });

    await page.goto(site+'/app/dashboard.html');
    const save=page.getByRole('button',{name:'Auswahl vormerken'}), radios=page.getByRole('radio');
    await page.getByText('Du hast noch kein Paket vorgemerkt.').waitFor();
    assert.equal(new URL(page.url()).pathname,'/app/paketwahl.html');
    assert.equal(await radios.count(),3);
    assert.equal(await page.locator('input:checked').count(),0);
    assert.equal(await save.isDisabled(),true);
    assert.equal(sessionReads,1);assert.equal(writes,0);
    const beta=page.getByRole('radio',{name:/Beta 300/});
    if (mobile) {await beta.tap();await save.tap();}
    else {await beta.focus();await beta.press('Space');await beta.press('Tab');await page.keyboard.press('Enter');}
    await page.getByText('Beta ist für dein Konto vorgemerkt.').waitFor();
    assert.equal(writes,1);assert.equal(await save.isDisabled(),true);
    await page.reload();
    await page.getByText('Beta ist für dein Konto vorgemerkt.').waitFor();
    assert.equal(await beta.isChecked(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    linked=true;
    await page.reload();
    await page.getByText('Beta ist für dein Konto vorgemerkt. Dein SMA-Kundenkonto ist zugeordnet.').waitFor();
    assert.equal(await beta.isChecked(),true);
    saved='delta'; // A second tab saved a newer preference.
    await page.getByRole('radio',{name:/Alpha 100/}).check();await save.click();
    await page.getByText(/zwischenzeitlich geändert/).waitFor();
    assert.equal(await page.getByRole('radio',{name:/Delta 500/}).isChecked(),true);
    assert.equal(writes,1);
    offer={id:'fixture-order',plan:'delta',terms:'2026-11-15-v1',state:'offered',checkout:null};
    await page.reload();
    const book=page.getByRole('button',{name:'Zahlungspflichtig buchen'});
    await book.waitFor();assert.equal(await page.locator('#checkout').isHidden(),true);
    assert.equal(bookings,0);
    await page.getByRole('radio',{name:/Alpha 100/}).check();assert.equal(await book.isHidden(),true);
    await page.getByRole('radio',{name:/Delta 500/}).check();
    if(mobile)await book.tap();else{await book.focus();await book.press('Enter');}
    await page.getByRole('link',{name:'Bei Mollie bezahlen'}).waitFor();
    assert.equal(bookings,1);assert.equal(await radios.first().isDisabled(),true);
    await page.reload();await page.getByRole('link',{name:'Bei Mollie bezahlen'}).waitFor();
    assert.equal(bookings,1);assert.equal(await book.isHidden(),true);
    offer={...offer,state:'paid',checkout:null};await page.reload();
    await page.getByText(/Deine Zahlung ist bestätigt/).waitFor();
    assert.equal(await page.locator('#checkout').isHidden(),true);
    offer={id:'virtual',plan:saved,terms:'2026-11-15-v1',state:'offered',automated:true,checkout:null};
    await page.reload();await book.waitFor();assert.equal(paymentCalls,0);
    await book.click();await page.getByRole('link',{name:'Bei Mollie bezahlen'}).waitFor();
    assert.equal(paymentCalls,1);assert.equal(bookings,2);
    await page.reload();const refresh=page.getByRole('button',{name:'Zahlungsstand erneut abrufen'});
    await refresh.waitFor();assert.equal(paymentCalls,1);await refresh.click();
    await page.getByRole('link',{name:'Bei Mollie bezahlen'}).waitFor();assert.equal(paymentCalls,2);assert.equal(bookings,2);
    const countsBeforeReturn={bookings,paymentCalls,writes};
    await page.clock.install();
    await page.goto(returnUrl);await page.getByText(/warten auf die Zahlungsbestätigung/).waitFor();
    assert.equal(await book.isHidden(),true);assert.equal(await page.locator('#checkout').isHidden(),true);
    paymentState='paid';await page.clock.fastForward(3001);
    await page.getByText(/Deine Zahlung ist bestätigt/).waitFor();
    paymentState='active';await page.clock.fastForward(7001);
    await page.frameLocator('#dashboard').getByText('Mein Kundenbereich').waitFor();
    assert.equal(statusReads,3);
    await page.goto(returnUrl);await page.frameLocator('#dashboard').getByText('Mein Kundenbereich').waitFor();
    assert.equal(statusReads,4);
    paymentState='booked';await page.goto(returnUrl);
    await page.getByText(/warten auf die Zahlungsbestätigung/).waitFor();
    for(const delay of [3000,7000,15000,30000]){
      const next=page.waitForResponse(r=>r.url().endsWith('/fixture/sma_onboarding_payment_status_v1'));
      await page.clock.fastForward(delay+1);await next;
      await page.getByRole('button',{name:'Zahlungsstand erneut prüfen'}).waitFor({state:'visible'});
      await page.waitForFunction(()=>!document.querySelector('#retry').disabled);
    }
    await page.getByText(/Du kannst den Stand erneut prüfen/).waitFor();
    const lastRead=statusReads;await page.clock.fastForward(120000);assert.equal(statusReads,lastRead);
    paymentState='closed';await page.getByRole('button',{name:'Zahlungsstand erneut prüfen'}).click();
    await page.getByText('Diese Zahlung wurde nicht abgeschlossen.').waitFor();
    assert.equal(await page.getByRole('link',{name:'Zur Paketwahl'}).getAttribute('href'),'paketwahl.html');
    paymentState='offline';await page.goto(returnUrl);await page.getByText(/konnte gerade nicht geladen werden/).waitFor();
    paymentState='unavailable';await page.getByRole('button',{name:'Zahlungsstand erneut prüfen'}).click();
    await page.getByText('Diese Buchung ist für dein Konto nicht verfügbar.').waitFor();
    const validReads=statusReads;await page.goto(site+'/app/paketwahl.html?buchung=falsch');
    await page.getByText('Dieser Zahlungslink ist ungültig.').waitFor();assert.equal(statusReads,validReads);
    await page.evaluate(()=>{sessionStorage.signedOut='1';});paymentState='reversed';
    await page.goto(returnUrl);await page.waitForURL(site+'/app/index.html?buchung='+order);
    await page.locator('#email').fill('test@example.invalid');await page.locator('#password').fill('SMA-Testpasswort-12345!');
    await page.getByRole('button',{name:'Anmelden',exact:true}).click();
    await page.getByText(/Zugang aus dieser Buchung ist gesperrt/).waitFor();
    assert.equal(page.url(),returnUrl);assert.deepEqual({bookings,paymentCalls,writes},countsBeforeReturn);
    assert.deepEqual(errors,[]);
    console.log((mobile?'Handy':'Desktop')+': Mollie-Rückkehr, verspätete und sofortige Freischaltung, Abbruch, Wiederanmeldung und begrenzte Statusabfragen bestanden.');
    console.log((mobile?'Handy':'Tastatur')+': Dashboard → Paketvormerkung, Neuladen und Konflikt bestanden.');
    await context.close();
  }
} finally {await browser.close();}
