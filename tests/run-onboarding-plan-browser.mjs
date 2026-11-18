// Regular dashboard shell and real package form, with all service responses supplied here.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from './dom-runtime/node_modules/playwright-core/index.mjs';

const site = 'https://sma.test';
const fakeClient = `export function createClient(){return {
 auth:{getSession:async()=>({data:{session:sessionStorage.signedOut?null:{user:{id:sessionStorage.fixtureOwner||'fixture'},access_token:'fixture'}}}),
   onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},
   signInWithPassword:async()=>{sessionStorage.removeItem('signedOut');return {data:{session:{user:{id:'fixture'}}}};},
   signOut:async()=>{
    window.fixtureSignOutCalls=(window.fixtureSignOutCalls||0)+1;
    if(window.fixtureSignOutMode==='pending') return new Promise((resolve,reject)=>{
      window.finishFixtureSignOut=result=>{
        if(result==='reject') return reject(Error('simulated interrupted sign-out'));
        sessionStorage.signedOut='1';resolve({error:null});
      };
    });
    sessionStorage.signedOut='1';return {error:null};
   } },
 functions:{invoke:async(name,options)=>{
  const response=await fetch('/fixture/'+name,{method:'POST',body:JSON.stringify(options.body)});
  const result=response.ok?{data:await response.json()}:{error:{status:response.status}};
  window.fixturePaymentsFinished=(window.fixturePaymentsFinished||0)+1;
  return result;
 }},
 rpc:(name,params)=>{
  let signal;
  return {
   abortSignal(value){signal=value;return this;},
   then(resolve,reject){return fetch('/fixture/'+name,{method:'POST',body:JSON.stringify(params),signal:window.ignoreRpcAbort?undefined:signal})
    .then(response=>response.json()).then(data=>{
      const finished=window.fixtureRpcFinished??={};finished[name]=(finished[name]||0)+1;
      return {data};
    }).then(resolve,reject);}
  };
 }
};}`;
async function waitForFixture(promise) {
  let timer;
  try {
    return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Expected fixture request or response did not complete')),30000);})]);
  } finally {clearTimeout(timer);}
}
function heldReply() {
  let arrive,release,finish,fail;
  const arrived=new Promise(resolve=>{arrive=resolve;}), response=new Promise(resolve=>{release=resolve;});
  const finished=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
  return {
    wait:()=>waitForFixture(arrived),
    async send(route,value){
      arrive();const replacement=await response;
      try {await route.fulfill({json:replacement??value});finish();} catch(error){fail(error);}
    },
    async release(value){release(value);await waitForFixture(finished);}
  };
}
const browser = await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
try {
  for (const mobile of [false,true]) {
    const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
    const page=await context.newPage();
    const errors=[];
    let saved=null, writes=0, choiceReads=0, sessionReads=0, linked=false, offer=null, bookings=0, paymentCalls=0;
    const order='80000000-0000-4000-8000-000000000001';
    const returnUrl=site+'/app/paketwahl.html?buchung='+order;
    let paymentState='booked',statusReads=0,closeOnRefresh=false,pausedReads=0;
    let holdBooking=null,holdPayment=null,holdChoiceRead=null,holdOfferRead=null,captureOwnerRedirect=false,paymentUnavailableOnce=false;
    page.on('pageerror',err=>errors.push(err.message));
    await page.route('**/*',async route=>{
      const req=route.request(), url=new URL(req.url());
      if(req.method()==='GET' && url.href===site+'/app/dashboard.html' && captureOwnerRedirect)
        return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><h1>Aktuelle Anmeldung erneut prüfen</h1>'});
      if (req.method()==='GET' && url.origin===site && /^\/app\/(dashboard\.html|index\.html|paketwahl\.html|assets\/[\w.-]+\.m?js)$/.test(url.pathname))
        return route.fulfill({contentType:url.pathname.endsWith('.html')?'text/html; charset=utf-8':'text/javascript',body:await readFile(new URL('..'+url.pathname,import.meta.url))});
      if (req.method()==='GET' && url.origin==='https://esm.sh' && /^\/@supabase\/supabase-js@2(?:\.57\.4)?$/.test(url.pathname))
        return route.fulfill({contentType:'text/javascript',body:fakeClient});
      if (req.method()==='POST' && url.href==='https://johnmusic.app.n8n.cloud/webhook/sma-dashboard-session') {
        sessionReads++;
        if(paymentState==='active') return route.fulfill({json:{html:'<body data-sma-customer-id="fixture"><p>Mein Kundenbereich</p></body>'}});
        return route.fulfill({status:403,json:{error:'Zugang nicht freigeschaltet oder Anmeldung abgelaufen.'}});
      }
      if (req.method()==='POST' && url.href===site+'/fixture/sma_onboarding_paused_booking_v1') {
        assert.equal(req.postData(),null);pausedReads++;
        return route.fulfill({body:JSON.stringify(paymentState==='renewal_suspended'?order:null),contentType:'application/json'});
      }
      if (req.method()==='POST' && url.href===site+'/fixture/sma_onboarding_plan_choice_v1') {
        const {p_owner,p_plan,p_expected_plan}=req.postDataJSON();
        assert.equal(p_owner,'fixture');
        if (p_plan && p_expected_plan!==saved && p_plan!==saved)
          return route.fulfill({json:{ok:false,code:'CONFLICT',plan:saved}});
        if (p_plan) {saved=p_plan;writes++;}
        else choiceReads++;
        if(!p_plan && holdChoiceRead){const held=holdChoiceRead;holdChoiceRead=null;return held.send(route,{ok:true,plan:saved,linked});}
        return route.fulfill({json:{ok:true,plan:saved,linked}});
      }
      if(req.method()==='POST' && url.href===site+'/fixture/sma_onboarding_booking_v1'){
        const {p_offer,p_plan,p_terms}=req.postDataJSON();
        if(p_offer){
          if(p_offer!==offer.id) return route.fulfill({json:{ok:false,code:'OFFER_CHANGED'}});
          assert.equal(p_plan,saved);assert.equal(p_terms,offer.terms);bookings++;
          offer={...offer,state:'booked',id:offer.automated?(p_offer==='retry-offer'?'retry-booking':'actual-booking'):offer.id,checkout:offer.automated?null:'https://www.mollie.com/checkout/fixture'};
          if(holdBooking){const held=holdBooking;holdBooking=null;return held.send(route,{ok:true,offer:{...offer}});}
        } else if(holdOfferRead){const held=holdOfferRead;holdOfferRead=null;return held.send(route,{ok:true,offer:{...offer}});}
        return route.fulfill({json:{ok:true,offer}});
      }
      if(req.method()==='POST' && url.href===site+'/fixture/sma-package-payment'){
        assert.deepEqual(req.postDataJSON(),{owner:'fixture',order:offer.id});
        assert.ok(['actual-booking','retry-booking'].includes(offer.id));
        paymentCalls++;
        if(paymentUnavailableOnce){paymentUnavailableOnce=false;return route.fulfill({status:503,json:{code:'RETRY'}});}
        if(offer.state==='paid') return route.fulfill({status:503,json:{code:'RETRY'}});
        if(closeOnRefresh){
          closeOnRefresh=false;
          offer={...offer,id:'next-offer',state:'offered',checkout:null};
          return route.fulfill({json:{code:'CLOSED'}});
        }
        offer={...offer,checkout:'https://www.mollie.com/checkout/'+(offer.id==='retry-booking'?'second':'fixture')};
        if(holdPayment){const held=holdPayment;holdPayment=null;return held.send(route,{code:'BOOKED'});}
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
    assert.equal(sessionReads,1);assert.equal(writes,0);assert.equal(pausedReads,1);
    const beta=page.getByRole('radio',{name:/Beta 300/});
    if (mobile) {await beta.tap();await save.tap();}
    else {await beta.focus();await beta.press('Space');await beta.press('Tab');await page.keyboard.press('Enter');}
    await page.getByText('Beta ist für dein Konto vorgemerkt.').waitFor();
    assert.equal(writes,1);assert.equal(await save.isDisabled(),true);
    const linkCheck=page.getByRole('button',{name:'Kontozuordnung prüfen'});
    await linkCheck.waitFor();
    assert.match(await page.locator('#status').innerText(),/Kundenkonto wird eingerichtet/);
    assert.match(await page.locator('#status').innerText(),/noch nichts bezahlen/);
    assert.equal(bookings,0);assert.equal(paymentCalls,0);
    await linkCheck.click();
    await linkCheck.waitFor();
    assert.equal(writes,1,'link status must not change the reserved plan');
    assert.equal(bookings,0,'link status must not accept a booking');
    assert.equal(paymentCalls,0,'link status must not start a payment');
    await page.reload();
    await page.getByText('Beta ist für dein Konto vorgemerkt.').waitFor();
    assert.equal(await beta.isChecked(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    linked=true;
    await linkCheck.click();
    await page.getByText('Beta ist für dein Konto vorgemerkt. Dein SMA-Kundenkonto ist zugeordnet.').waitFor();
    assert.equal(await linkCheck.isHidden(),true);
    assert.equal(writes,1);assert.equal(bookings,0);assert.equal(paymentCalls,0);
    await page.reload();
    await page.getByText('Beta ist für dein Konto vorgemerkt. Dein SMA-Kundenkonto ist zugeordnet.').waitFor();
    assert.equal(await beta.isChecked(),true);
    saved='delta'; // A second tab saved a newer preference.
    const readsBeforeConflict=choiceReads;
    await page.getByRole('radio',{name:/Alpha 100/}).check();await save.click();
    await page.getByText(/zwischenzeitlich geändert/).waitFor();
    assert.equal(await page.getByRole('radio',{name:/Delta 500/}).isChecked(),true);
    assert.equal(choiceReads,readsBeforeConflict+1,'a conflict needs exactly one read-only ownership check');
    assert.equal(writes,1,'a conflict must not repeat the package write');
    assert.equal(bookings,0);assert.equal(paymentCalls,0);
    assert.equal(await linkCheck.isHidden(),true,'linked accounts must not show a false n8n setup notice');
    assert.doesNotMatch(await page.locator('#status').innerText(),/Kundenkonto wird eingerichtet|noch nichts bezahlen/);
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
    assert.equal(await page.getByRole('link',{name:'Zur bezahlten Buchung'}).getAttribute('href'),'paketwahl.html');
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
    paymentState='renewal_suspended';await page.goto(returnUrl);await page.getByText(/Dein Zugang pausiert/).waitFor();
    assert.equal(await book.isHidden(),true);assert.equal(await page.locator('#checkout').isHidden(),true);
    await page.getByRole('button',{name:'Zahlungsstand erneut prüfen'}).waitFor();
    const pausedBeforeLogin=pausedReads;
    await page.evaluate(()=>{sessionStorage.signedOut='1';});
    await page.goto(site+'/app/index.html');
    await page.locator('#email').fill('test@example.invalid');await page.locator('#password').fill('SMA-Testpasswort-12345!');
    await page.getByRole('button',{name:'Anmelden',exact:true}).click();
    await page.getByText(/Dein Zugang pausiert/).waitFor();
    assert.equal(page.url(),returnUrl);assert.equal(pausedReads,pausedBeforeLogin+1);
    assert.equal(await book.isHidden(),true);assert.equal(await page.locator('#checkout').isHidden(),true);
    await page.getByRole('button',{name:'Zahlungsstand erneut prüfen'}).click();
    await page.waitForFunction(()=>!document.querySelector('#retry').disabled);
    assert.equal(page.url(),returnUrl);
    paymentState='active';await page.getByRole('button',{name:'Zahlungsstand erneut prüfen'}).click();
    await page.frameLocator('#dashboard').getByText('Mein Kundenbereich').waitFor();
    assert.equal(pausedReads,pausedBeforeLogin+1);
    assert.deepEqual({bookings,paymentCalls,writes},countsBeforeReturn);
    console.log((mobile?'Handy':'Desktop')+': Normaler Login führt zur eigenen pausierten Buchung; bestätigte Ersatzzahlung öffnet Dashboard ohne neue Buchung.');
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
    paymentState='booked';await page.goto(returnUrl);
    await page.getByRole('link',{name:'Zur offenen Buchung'}).click();
    const pay=page.getByRole('link',{name:'Bei Mollie bezahlen'});
    await pay.waitFor();assert.equal(await pay.getAttribute('href'),'https://www.mollie.com/checkout/fixture');
    assert.deepEqual({bookings,paymentCalls,writes},countsBeforeReturn);
    offer={...offer,checkout:null};await page.reload();
    await page.getByRole('button',{name:'Zahlungsstand erneut abrufen'}).waitFor();assert.equal(await pay.isHidden(),true);
    paymentState='closed';offer={id:'old-offer',plan:saved,terms:'2026-11-15-v1',state:'offered',automated:true,checkout:null};
    await page.goto(returnUrl);await page.getByRole('link',{name:'Zur Paketwahl'}).click();await book.waitFor();
    assert.deepEqual({bookings,paymentCalls,writes},countsBeforeReturn);
    offer={...offer,id:'retry-offer'};await book.click();
    await page.getByText(/Dein Zahlungsangebot hat sich geändert/).waitFor();
    assert.deepEqual({bookings,paymentCalls,writes},countsBeforeReturn);
    await book.click();await pay.waitFor();await page.reload();await pay.waitFor();
    assert.equal(await pay.getAttribute('href'),'https://www.mollie.com/checkout/second');
    assert.equal(bookings,countsBeforeReturn.bookings+1);assert.equal(paymentCalls,countsBeforeReturn.paymentCalls+1);
    closeOnRefresh=true;await page.getByRole('button',{name:'Zahlungsstand erneut abrufen'}).click();
    await page.getByText(/Die vorherige Zahlung wurde nicht abgeschlossen/).waitFor();
    assert.equal(await pay.isHidden(),true);assert.equal(await book.isVisible(),true);
    assert.equal(bookings,countsBeforeReturn.bookings+1);
    console.log((mobile?'Handy':'Desktop')+': Offene Buchung fortgesetzt, veraltetes Angebot abgewiesen und neuen Zahlungsversuch einmal gebucht.');
    offer={id:'retry-booking',state:'paid',plan:saved,terms:'2026-11-15-v1',automated:true,checkout:null};
    await page.reload();await page.getByText(/Deine Zahlung ist bestätigt/).waitFor();
    const done=page.waitForResponse(r=>r.url()===site+'/fixture/sma-package-payment' && r.status()===503);
    await page.getByRole('button',{name:'Zahlungsstand erneut abrufen'}).click();await done;
    await page.waitForFunction(()=>!document.querySelector('#booking').hidden);
    assert.match(await page.locator('#status').innerText(),/Deine Zahlung ist bestätigt/);
    assert.equal(await pay.isHidden(),true);assert.equal(await book.isHidden(),true);
    assert.equal(bookings,countsBeforeReturn.bookings+1);
    console.log((mobile?'Handy':'Desktop')+': Bestätigte Zahlung bleibt bei unterbrochener Abo-Prüfung sichtbar.');

    // Booking and payment share one deadline. The server has already stored
    // both results while the client is still waiting for the payment reply.
    offer={id:'timeout-offer',state:'offered',plan:saved,terms:'2026-11-15-v1',automated:true,checkout:null};
    await page.goto(site+'/app/paketwahl.html');await book.waitFor();
    const beforeTimeout={bookings,paymentCalls,writes,sessionReads};
    const delayedBooking=heldReply(),delayedPayment=heldReply();
    holdBooking=delayedBooking;holdPayment=delayedPayment;
    if(mobile)await book.tap();else await book.press('Enter');
    await delayedBooking.wait();
    assert.equal(bookings,beforeTimeout.bookings+1);assert.equal(paymentCalls,beforeTimeout.paymentCalls);
    await page.clock.fastForward(10000);
    await delayedBooking.release();await delayedPayment.wait();
    await page.clock.fastForward(35001);
    const reloadState=page.getByRole('button',{name:'Erneut laden',exact:true});
    assert.equal(await reloadState.isVisible(),true);
    assert.equal(await reloadState.isEnabled(),true);
    assert.equal(await book.isVisible(),false);
    const delayedRead=heldReply();holdChoiceRead=delayedRead;
    await reloadState.click();await delayedRead.wait();
    await delayedPayment.release({code:'ACTIVE'});
    await page.waitForFunction(()=>window.fixturePaymentsFinished===1);
    assert.equal(page.url(),site+'/app/paketwahl.html');
    assert.equal(sessionReads,beforeTimeout.sessionReads);
    await delayedRead.release();await pay.waitFor();
    assert.equal(await pay.getAttribute('href'),'https://www.mollie.com/checkout/fixture');
    assert.deepEqual({bookings,paymentCalls,writes,sessionReads},{
      ...beforeTimeout,bookings:beforeTimeout.bookings+1,paymentCalls:beforeTimeout.paymentCalls+1
    });

    // A transport may ignore abort after the booking has been stored. Retry
    // reads that booking; its eventual old reply must not start payment work.
    offer={id:'timeout-booking-offer',state:'offered',plan:saved,terms:'2026-11-15-v1',automated:true,checkout:null};
    await page.reload();await book.waitFor();
    await page.evaluate(()=>{window.ignoreRpcAbort=true;});
    const beforeBookingTimeout={bookings,paymentCalls,writes,sessionReads};
    const lostBooking=heldReply();holdBooking=lostBooking;
    if(mobile)await book.tap();else await book.press('Enter');
    await lostBooking.wait();await page.clock.fastForward(45001);
    assert.equal(await reloadState.isVisible(),true);
    await reloadState.click();
    await page.getByText('Deine Buchung ist gespeichert. Ein offener Zahlungslink ist derzeit nicht verfügbar.').waitFor();
    assert.equal(await refresh.isVisible(),true);assert.equal(await pay.isHidden(),true);
    const completedBookingReplies=await page.evaluate(()=>window.fixtureRpcFinished.sma_onboarding_booking_v1);
    await lostBooking.release();
    await page.waitForFunction(expected=>window.fixtureRpcFinished.sma_onboarding_booking_v1===expected,completedBookingReplies+1);
    assert.equal(page.url(),site+'/app/paketwahl.html');
    assert.equal(await refresh.isVisible(),true);assert.equal(await pay.isHidden(),true);
    assert.deepEqual({bookings,paymentCalls,writes,sessionReads},{
      ...beforeBookingTimeout,bookings:beforeBookingTimeout.bookings+1
    });
    console.log((mobile?'Handy':'Desktop')+': Hängende Buchungs-/Zahlungsantworten enden nach gemeinsamem Zeitlimit; erneutes Laden bleibt lesend und verspätete Antworten wirkungslos.');

    // Storage can change before the cross-tab auth event reaches this page.
    // The old offer must never become a usable checkout for the new account.
    offer={id:'first-owner-booking',state:'booked',plan:saved,terms:'2026-11-15-v1',automated:true,
      checkout:'https://www.mollie.com/checkout/first-owner-fixture'};
    const delayedOwnerOffer=heldReply();holdOfferRead=delayedOwnerOffer;captureOwnerRedirect=true;
    const beforeOwnerChange={bookings,paymentCalls,writes,sessionReads};
    await page.goto(site+'/app/paketwahl.html',{waitUntil:'commit'});
    await delayedOwnerOffer.wait();
    await page.evaluate(()=>{sessionStorage.fixtureOwner='second';});
    await delayedOwnerOffer.release();
    await page.getByRole('heading',{name:'Aktuelle Anmeldung erneut prüfen'}).waitFor();
    assert.equal(page.url(),site+'/app/dashboard.html');
    assert.equal(await page.locator('#checkout').count(),0);
    assert.deepEqual({bookings,paymentCalls,writes,sessionReads},beforeOwnerChange);
    await page.evaluate(()=>{sessionStorage.removeItem('fixtureOwner');});
    captureOwnerRedirect=false;

    // Choosing sign-out must stop the continuation immediately, even if both
    // the booking reply and sign-out itself are still outstanding.
    offer={id:'logout-pending-offer',state:'offered',plan:saved,terms:'2026-11-15-v1',automated:true,checkout:null};
    await page.goto(site+'/app/paketwahl.html');await book.waitFor();
    await page.evaluate(()=>{window.ignoreRpcAbort=true;window.fixtureSignOutMode='pending';});
    const abandonedBooking=heldReply();holdBooking=abandonedBooking;
    const beforeLogout={bookings,paymentCalls,writes,sessionReads};
    if(mobile)await book.tap();else await book.press('Enter');
    await abandonedBooking.wait();
    const logout=page.getByRole('button',{name:'Abmelden',exact:true});
    if(mobile)await logout.tap();else await logout.press('Enter');
    await page.waitForFunction(()=>typeof window.finishFixtureSignOut==='function');
    assert.equal(await logout.isDisabled(),true);
    assert.equal(await page.locator('#choice').isHidden(),true);
    assert.equal(await page.locator('#booking').isHidden(),true);
    assert.equal(await page.locator('#checkout').getAttribute('href'),null);
    await page.locator('#logout').dispatchEvent('click');
    await page.locator('#book').dispatchEvent('click');
    await page.locator('#retry').dispatchEvent('click');
    assert.equal(await page.evaluate(()=>window.fixtureSignOutCalls),1);
    const beforeAbandonedReply=await page.evaluate(()=>window.fixtureRpcFinished.sma_onboarding_booking_v1);
    await abandonedBooking.release();
    await page.waitForFunction(expected=>window.fixtureRpcFinished.sma_onboarding_booking_v1===expected,beforeAbandonedReply+1);
    assert.equal(await logout.isDisabled(),true);
    assert.equal(await page.locator('#booking').isHidden(),true);
    assert.equal(paymentCalls,beforeLogout.paymentCalls);
    assert.deepEqual({bookings,paymentCalls,writes,sessionReads},{...beforeLogout,bookings:beforeLogout.bookings+1});
    await page.evaluate(()=>window.finishFixtureSignOut('reject'));
    await page.waitForFunction(()=>!document.querySelector('#logout').disabled && !document.querySelector('#retry').hidden);
    assert.match(await page.locator('#status').innerText(),/Abmeldung/);
    if(mobile)await reloadState.tap();else await reloadState.press('Enter');
    await page.getByText('Deine Buchung ist gespeichert. Ein offener Zahlungslink ist derzeit nicht verfügbar.').waitFor();
    assert.equal(await refresh.isVisible(),true);assert.equal(await pay.isHidden(),true);
    assert.deepEqual({bookings,paymentCalls,writes,sessionReads},{...beforeLogout,bookings:beforeLogout.bookings+1});
    console.log((mobile?'Handy':'Desktop')+': Kontowechsel verwirft alte Zahlungslinks; Abmelden stoppt eine laufende Buchung und Wiederholung liest nur den gespeicherten Stand.');
    // A real booking may be persisted before the payment backend can return
    // a checkout link (for example, because customer folders are not ready).
    // Never tell the customer that payment confirmation is merely pending;
    // do not create a second booking when they explicitly retry its status.
    offer={id:'no-link-offer',state:'offered',plan:saved,terms:'2026-11-15-v1',automated:true,checkout:null};
    paymentUnavailableOnce=true;
    await page.reload();await book.waitFor();
    const beforeUnavailable={bookings,paymentCalls};
    await book.click();
    await page.getByText(/Ein offener Zahlungslink ist derzeit nicht verfügbar/).waitFor();
    assert.match(await page.locator('#status').innerText(),/Zahlungsprüfung konnte noch nicht abgeschlossen/);
    assert.equal(await pay.isHidden(),true);
    assert.equal(await book.isHidden(),true);
    assert.equal(bookings,beforeUnavailable.bookings+1);
    assert.equal(paymentCalls,beforeUnavailable.paymentCalls+1);
    await page.reload();await page.getByText(/Ein offener Zahlungslink ist derzeit nicht verfügbar/).waitFor();
    assert.equal(await pay.isHidden(),true);
    paymentUnavailableOnce=true;
    await refresh.click();await page.getByText(/Zahlungsprüfung konnte noch nicht abgeschlossen/).waitFor();
    assert.equal(await pay.isHidden(),true);
    assert.equal(bookings,beforeUnavailable.bookings+1);
    await refresh.click();await pay.waitFor();
    assert.equal(await pay.getAttribute('href'),'https://www.mollie.com/checkout/fixture');
    assert.equal(bookings,beforeUnavailable.bookings+1);
    assert.equal(paymentCalls,beforeUnavailable.paymentCalls+3);
    console.log((mobile?'Handy':'Desktop')+': Gespeicherte Buchung ohne Zahlungslink wird korrekt erklärt und ohne zweite Buchung wiederaufgenommen.');
    assert.deepEqual(errors,[]);
    console.log((mobile?'Handy':'Desktop')+': Mollie-Rückkehr, verspätete und sofortige Freischaltung, Abbruch, Wiederanmeldung und begrenzte Statusabfragen bestanden.');
    console.log((mobile?'Handy':'Tastatur')+': Dashboard → Paketvormerkung, Neuladen und Konflikt bestanden.');
    await context.close();
  }
} finally {await browser.close();}
