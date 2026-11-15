const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const html=readFileSync('app/dashboard.html','utf8');
const code=html.slice(html.indexOf('function connectionError('),html.indexOf('// Called only by the same-origin'));
const shell='<body data-sma-customer-id="test">Übersicht</body>';

function setup({search='',eligible=false,onboarding=false}={}){
 let owner='first',authFailure=false,fetchFailure=null,switched=null,requests=0;
 const redirects=[];
 const dataset={},regularDashboard={hidden:true};let checks=0;
 const env={AbortController,AbortSignal,setTimeout,clearTimeout,URLSearchParams,location:{search},document:{documentElement:{dataset},getElementById(id){assert.equal(id,'regularDashboard');return regularDashboard;}},dashboardOwnerId:null,signedOut:false,endpoint:'https://fixture.invalid',window:{location:{replace:url=>redirects.push(url)}},
  leaveDashboard:()=>{env.signedOut=true;redirects.push('index.html');},
  supabase:{rpc:(name,params)=>({abortSignal:async signal=>{
   assert.ok(signal instanceof AbortSignal);
   if(name==='sma_onboarding_paused_booking_v1'){assert.equal(params,undefined);return {data:null,error:null};}
   const {p_route,p_owner}=params;
   if(name==='sma_onboarding_plan_choice_v1'){assert.equal(p_owner,'first');return {data:{ok:onboarding}};}
   assert.equal(name,'sma_customer_media_pilot_v1');assert.equal(p_route,'eligible');checks++;return {data:{ok:eligible}};}}),auth:{getSession:async()=>({error:authFailure||null,data:{session:owner?{user:{id:owner},access_token:owner}:null}})}},
  fetch:async(_url,opts)=>{
   requests++;assert.equal(opts.headers.Authorization,'Bearer '+owner);
   if(fetchFailure==='offline')throw Error('offline');
   if(switched)owner=switched;
   return {ok:fetchFailure===null,status:fetchFailure,json:async()=>({html:shell})};
  }
 };
 vm.runInNewContext(code,env);
 return {pilot:()=>dataset.smaCustomerMedia,regularDashboard,checks:()=>checks,read:()=>env.dashboardHtml(),redirects,requests:()=>requests,auth:state=>{authFailure=state;},
  owner:id=>{owner=id;},fail:status=>{fetchFailure=status;},switchDuringRead:id=>{switched=id;}};
}

test('a temporary session error keeps the dashboard route available for reconnect',async()=>{
 const f=setup();f.auth(true);await assert.rejects(f.read(),e=>e.retryOnReconnect===true);
 assert.equal(f.requests(),0);assert.deepEqual(f.redirects,[]);
 f.auth(false);assert.equal(await f.read(),shell);
});

test('transport and server failures allow reconnect while an access refusal needs an explicit retry',async()=>{
 for(const status of ['offline',503,403]){
  const f=setup();f.fail(status);
  await assert.rejects(f.read(),e=>(e.retryOnReconnect===true)===(status!==403));
  assert.deepEqual(f.redirects,[]);f.fail(null);assert.equal(await f.read(),shell);
 }
});

test('a late shell for the previous customer is discarded and a missing session returns to sign-in',async()=>{
 const f=setup();f.switchDuringRead('second');await assert.rejects(f.read(),/Anmeldung wurde gewechselt/);
 assert.deepEqual(f.redirects,['index.html']);assert.equal(f.requests(),1);
 const empty=setup();empty.owner(null);await assert.rejects(empty.read(),/melde dich/);assert.equal(empty.requests(),0);
 assert.deepEqual(empty.redirects,['index.html']);
});

test('only the verified pilot in an opted-in tab selects the combined media routes',async()=>{
 const ordinary=setup({eligible:true});await ordinary.read();
 assert.equal(ordinary.checks(),0);assert.equal(ordinary.pilot(),undefined);
 const denied=setup({search:'?kundenmedien=pilot'});await assert.rejects(denied.read(),/nicht verfügbar/);
 assert.equal(denied.requests(),0);assert.equal(denied.pilot(),undefined);
 assert.equal(denied.regularDashboard.hidden,false);
 assert.equal(ordinary.regularDashboard.hidden,true);
 const switched=setup({search:'?kundenmedien=pilot',eligible:true});switched.switchDuringRead('second');
 await assert.rejects(switched.read(),/Anmeldung wurde gewechselt/);assert.equal(switched.pilot(),undefined);
 const pilot=setup({search:'?kundenmedien=pilot',eligible:true});assert.equal(await pilot.read(),shell);
 assert.equal(pilot.checks(),1);assert.equal(pilot.pilot(),'pilot');
});

test('signed-out dashboard hands just the explicit pilot selection to the login page',async()=>{
 for(const [search,login] of [
  ['?kundenmedien=pilot&portal=youtube','index.html?kundenmedien=pilot&v=291'],
  ['?kundenmedien=anderer-wert','index.html'],
  ['?portal=youtube','index.html']
 ]){
  const f=setup({search});f.owner(null);
  await assert.rejects(f.read(),/melde dich/);
  assert.deepEqual(f.redirects,[login]);assert.equal(f.checks(),0);assert.equal(f.requests(),0);
 }
});

async function openLogin(search,auth,hash=''){
 const {parseHTML}=await import('./dom-runtime/node_modules/linkedom/esm/index.js');
 const loginHtml=readFileSync('app/index.html','utf8');
 const source=loginHtml.split('<script type="module">')[1].split('</script>')[0];
 const script=source.slice(source.indexOf('const SUPABASE_URL'));
 const {document,window}=parseHTML(loginHtml);
 const redirects=[];
 const location={search,hash,replace:href=>redirects.push(href)};
 await vm.runInNewContext('(async()=>{'+script+'})()',{document,window:{location},URLSearchParams,createClient:()=>({auth})});
 async function submit(){
  document.getElementById('authForm').dispatchEvent(new window.Event('submit',{cancelable:true}));
  await new Promise(resolve=>setImmediate(resolve));
 }
 return {document,redirects,submit};
}

test('login returns to the selected dashboard after sign-in or session reuse; recovery stays on the login page',async()=>{
 const {parseHTML}=await import('./dom-runtime/node_modules/linkedom/esm/index.js');
 const regularHref=parseHTML(html).document.getElementById('regularDashboard').getAttribute('href');
 assert.equal(regularHref,'dashboard.html');
 for(const [search,hasSession,expected] of [
  ['?kundenmedien=pilot&v=291',false,'dashboard.html?kundenmedien=pilot'],
  ['?kundenmedien=pilot&portal=youtube',true,'dashboard.html?kundenmedien=pilot'],
  ['',false,regularHref],['?kundenmedien=anderer-wert',true,regularHref],
  ['?type=recovery&kundenmedien=pilot',true,null]
 ]){
  const auth={onAuthStateChange(){},getSession:async()=>({data:{session:hasSession?{}:null}}),
   signInWithPassword:async()=>({error:null})};
  const {document,redirects,submit}=await openLogin(search,auth);
  if(!hasSession){
   assert.deepEqual(redirects,[]);
   await submit();
  }
  assert.deepEqual(redirects,expected?[expected]:[]);
  if(expected===null)assert.equal(document.getElementById('resetView').hidden,false);
 }
});


test('landing page entry links open the matching form and registration only submits on request',async()=>{
 const {parseHTML}=await import('./dom-runtime/node_modules/linkedom/esm/index.js');
 const home=parseHTML(readFileSync('index.html','utf8')).document;
 const entry=name=>new URL([...home.querySelectorAll('#login a')].find(a=>a.textContent.trim()===name).getAttribute('href'),'https://sma.test/');
 const login=entry('Login'),register=entry('Registrieren');
 assert.equal(login.pathname,'/app/index.html');
 assert.equal(login.search,'');
 assert.equal(register.pathname,login.pathname);
 assert.equal(register.search,'?ansicht=registrieren');
 assert.equal(new URL(home.querySelector('header a.btn').getAttribute('href'),login.origin).href,login.href);

 const calls=[];
 let outcome='confirm';
 const auth={onAuthStateChange(){},getSession:async()=>({data:{session:null}}),
  signUp:async args=>{
   calls.push(args);
   if(outcome==='offline')throw Error('offline');
   return {data:{session:outcome==='immediate'?{}:null}};
  },
  signInWithPassword:async()=>{calls.push('unexpected-sign-in');return {error:{message:'unexpected sign-in'}};}
 };
 const {document,redirects,submit}=await openLogin(register.search,auth);
 const field=id=>document.getElementById(id);
 assert.equal(field('authSubmit').textContent,'Konto erstellen');
 assert.equal(field('authSubmit').getAttribute('type'),'submit');
 assert.equal(field('password').getAttribute('autocomplete'),'new-password');
 assert.equal(field('authModeLink').getAttribute('href'),'index.html');
 assert.equal(field('registrationPasswordHint').hidden,false);
 assert.equal(calls.length,0);
 field('email').value='erstkunde@example.invalid';field('password').value='kurz';
 await submit();
 assert.equal(calls.length,0);
 assert.match(field('status').textContent,/10 Zeichen/);
 field('password').value='Beispiel909!';
 outcome='offline';await submit();
 assert.match(field('status').textContent,/erneut/);
 assert.equal(field('authSubmit').disabled,false);
 outcome='confirm';await submit();
 assert.deepEqual(redirects,[]);
 assert.match(field('status').textContent,/Postfach/);
 assert.equal(calls.length,2);
 assert.equal(calls[1].options.emailRedirectTo,'https://sma-automation.com/app/');
 assert.equal(field('forgotEmail').value,'erstkunde@example.invalid');
 assert.equal(field('password').value,'');
 await submit();assert.equal(calls.length,2);
 outcome='immediate';
 const immediate=await openLogin(register.search,auth);
 immediate.document.getElementById('email').value='erstkunde@example.invalid';
 immediate.document.getElementById('password').value='Beispiel909!';
 await immediate.submit();
 assert.deepEqual(immediate.redirects,['dashboard.html']);
});

test('recovery takes priority over a registration link and a verified session returns to the selected dashboard',async()=>{
 let submissions=0;
 const auth={onAuthStateChange(){},getSession:async()=>({data:{session:{}}}),signUp:async()=>{submissions++;}};
 const query='?ansicht=registrieren&kundenmedien=pilot';
 const recovery=await openLogin(query,auth,'#type=recovery');
 assert.equal(recovery.document.getElementById('resetView').hidden,false);
 await recovery.submit();
 assert.equal(submissions,0);
 assert.deepEqual(recovery.redirects,[]);
 const existing=await openLogin(query,auth);
 assert.deepEqual(existing.redirects,['dashboard.html?kundenmedien=pilot']);
 assert.equal(existing.document.getElementById('authModeLink').getAttribute('href'),'index.html?kundenmedien=pilot');
});

test('only the confirmed new customer goes from a regular dashboard refusal to plan selection',async()=>{
 const fresh=setup({onboarding:true});fresh.fail(403);
 await assert.rejects(fresh.read(),/Paketwahl/);
 assert.deepEqual(fresh.redirects,['paketwahl.html']);
 const paid=setup({onboarding:true});assert.equal(await paid.read(),shell);assert.deepEqual(paid.redirects,[]);
 const pilot=setup({search:'?kundenmedien=pilot',eligible:true,onboarding:true});pilot.fail(403);
 await assert.rejects(pilot.read(),/zugeordnet/);assert.deepEqual(pilot.redirects,[]);
 const switched=setup({onboarding:true});switched.switchDuringRead('second');switched.fail(403);
 await assert.rejects(switched.read(),/gewechselt/);assert.deepEqual(switched.redirects,['index.html']);
});
