const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const dashboard=fs.readFileSync('app/dashboard.html','utf8');
const migration=fs.readFileSync('supabase/migrations/20261115201000_onboarding_paused_booking_login_v1.sql','utf8');
const payment=fs.readFileSync('app/assets/onboarding-payment-return.mjs','utf8');
const code=dashboard.slice(dashboard.indexOf('function connectionError('),dashboard.indexOf('// Called only by the same-origin'));
const order='60600000-0000-4000-8000-000000000011';
const shell='<body data-sma-customer-id="fixture">Dashboard</body>';

function login({paused=order,error=null,afterLookup=null,status=403,onboarding=false,search=''}={}){
 let owner='first';
 const redirects=[],calls=[];
 const env={AbortSignal,URLSearchParams,location:{search},signedOut:false,dashboardOwnerId:null,
  document:{documentElement:{dataset:{}},getElementById(){return {hidden:true};}},
  endpoint:'https://fixture.invalid/dashboard',window:{location:{replace:path=>redirects.push(path)}},
  leaveDashboard(){env.signedOut=true;redirects.push('index.html');},
  supabase:{auth:{getSession:async()=>({data:{session:owner?{user:{id:owner},access_token:'fixture'}:null}})},
   rpc:async(name,args)=>{
    calls.push(name);
    if(name==='sma_onboarding_paused_booking_v1'){
     assert.equal(args,undefined);
     if(afterLookup==='owner')owner='second';
     if(afterLookup==='logout')env.signedOut=true;
     return {data:paused,error};
    }
    if(name==='sma_onboarding_plan_choice_v1'){assert.equal(args.p_owner,'first');return {data:{ok:onboarding}};}
    assert.equal(name,'sma_customer_media_pilot_v1');assert.equal(args.p_route,'eligible');return {data:{ok:true}};
   }},
  fetch:async(url,options)=>{
   assert.equal(url,env.endpoint);assert.equal(options.method,'POST');
   assert.equal(options.headers.Authorization,'Bearer fixture');assert.equal(options.credentials,'omit');
   return {ok:status===200,status,json:async()=>({html:shell})};
  }
 };
 vm.runInNewContext(code,env);
 return {read:()=>env.dashboardHtml(),redirects,calls};
}

test('actual normal login opens the owned paused booking before offering any new plan',async()=>{
 const f=login({onboarding:true});
 await assert.rejects(f.read(),/pausierter Zahlungsstand/);
 assert.deepEqual(f.redirects,['paketwahl.html?buchung='+order]);
 assert.deepEqual(f.calls,['sma_onboarding_paused_booking_v1']);
});

test('absent or malformed paused IDs cannot become a payment destination; new-customer login remains available',async()=>{
 for(const paused of [null,undefined,{},'https://foreign.invalid','../other','bad-id']){
  const f=login({paused:paused===undefined?false:paused});
  await assert.rejects(f.read(),/zugeordnet/);assert.deepEqual(f.redirects,[]);
  assert.deepEqual(f.calls,['sma_onboarding_paused_booking_v1','sma_onboarding_plan_choice_v1']);
 }
 const fresh=login({paused:null,onboarding:true});
 await assert.rejects(fresh.read(),/Paketwahl/);assert.deepEqual(fresh.redirects,['paketwahl.html']);
});

test('failed lookup, sign-out and an account switch never expose the previous booking',async()=>{
 const failed=login({error:{message:'fixture outage'}});
 await assert.rejects(failed.read(),error=>error.retryOnReconnect===true);
 assert.deepEqual(failed.redirects,[]);assert.deepEqual(failed.calls,['sma_onboarding_paused_booking_v1']);
 for(const afterLookup of ['owner','logout']){
  const f=login({afterLookup});await assert.rejects(f.read(),/gewechselt/);
  assert.deepEqual(f.redirects,afterLookup==='owner'?['index.html']:[]);
 }
});

test('active customers and the explicit media pilot do not use the paused-booking lookup',async()=>{
 const active=login({status:200});assert.equal(await active.read(),shell);
 assert.deepEqual(active.calls,[]);assert.deepEqual(active.redirects,[]);
 const pilot=login({search:'?kundenmedien=pilot'});await assert.rejects(pilot.read(),/zugeordnet/);
 assert.deepEqual(pilot.calls,['sma_customer_media_pilot_v1']);assert.deepEqual(pilot.redirects,[]);
});

async function paymentPage({initial='renewal_suspended',search='?buchung='+order,owner='first'}={}){
 let state=initial,account=owner;
 const nodes=new Map(),redirects=[],calls=[];
 const node=selector=>{
  if(!nodes.has(selector))nodes.set(selector,{hidden:false,disabled:false,textContent:'',listeners:{},
   addEventListener(name,fn){this.listeners[name]=fn;}});
  return nodes.get(selector);
 };
 const client={auth:{getSession:async()=>({data:{session:account?{user:{id:account}}:null}}),
  onAuthStateChange(){},signOut:async()=>({error:null})},
  rpc:(name,args)=>({abortSignal:async signal=>{
   assert.ok(signal instanceof AbortSignal);
   assert.equal(name,'sma_onboarding_payment_status_v1');assert.equal(args.p_order,order);
   calls.push(name);return {data:state,error:null};
  }})};
 const env={AbortController,URLSearchParams,location:{search,replace:path=>redirects.push(path)},
  document:{querySelector:node,addEventListener(){},hidden:false},window:{addEventListener(){}},
  navigator:{onLine:true},createClient:()=>client,setTimeout:()=>1,clearTimeout(){}};
 const source=payment.replace(/^import[^\n]*\n/,'');
 await vm.runInNewContext('(async()=>{'+source+'})()',env);
 return {node,redirects,calls,setState:value=>{state=value;},
  async retry(){node('#retry').listeners.click();await new Promise(resolve=>setImmediate(resolve));}};
}

test('actual payment page retains the pause until a simulated confirmed replacement opens the dashboard',async()=>{
 const f=await paymentPage();
 assert.match(f.node('#status').textContent,/Zugang pausiert/);
 assert.equal(f.node('#retry').hidden,false);assert.deepEqual(f.redirects,[]);
 await f.retry();assert.deepEqual(f.redirects,[]);
 f.setState('active');await f.retry();assert.deepEqual(f.redirects,['dashboard.html']);
 assert.equal(f.calls.length,3);
 const restored=login({status:200});assert.equal(await restored.read(),shell);assert.deepEqual(restored.calls,[]);
});

test('unconfirmed, reversed, closed or foreign payment states never open the dashboard',async()=>{
 for(const initial of ['booked','paid','closed','reversed','unavailable']){
  const f=await paymentPage({initial});assert.deepEqual(f.redirects,[]);assert.equal(f.calls.length,1);
 }
 const signedOut=await paymentPage({owner:null});
 assert.deepEqual(signedOut.redirects,['index.html?buchung='+order]);assert.equal(signedOut.calls.length,0);
 const invalid=await paymentPage({search:'?buchung=foreign'});
 assert.match(invalid.node('#status').textContent,/ungültig/);assert.equal(invalid.calls.length,0);
});

test('lookup is a read-only private implementation behind an authenticated invoker wrapper',()=>{
 assert.match(migration,/create function sma_private\.onboarding_paused_booking_v1\(\)/);
 assert.match(migration,/returns uuid language sql stable security definer/);
 assert.match(migration,/returns uuid language sql stable security invoker/);
 assert.match(migration,/b\.user_id=\(select auth\.uid\(\)\)/);
 assert.match(migration,/grant execute on function public\.sma_onboarding_paused_booking_v1\(\) to authenticated/);
 assert.doesNotMatch(migration,/\b(update|insert|delete)\s+(?:public|sma_private)\./i);
});

// The publication CI installs pinned PGlite; the dashboard-only CI has DOM dependencies only.
const sqlRuntime='./sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
test('actual SQL isolates paused bookings and restores only after the verified simulated renewal and mirror',
 {skip:!fs.existsSync('tests/'+sqlRuntime)?'SQL runtime runs in Publication history checks':false},async()=>{
 const {PGlite}=await import(sqlRuntime);
 const {assessRenewal}=await import('../supabase/functions/sma-package-payment/renewal.mjs');
 const db=new PGlite();
 const first='60600000-0000-4000-8000-000000000001',second='60600000-0000-4000-8000-000000000002';
 const lease='60600000-0000-4000-8000-000000000021';
 const one=async(sql,values=[])=>(await db.query(sql,values)).rows[0];
 const session=async id=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);
 const lookup=async()=>(await one('select public.sma_onboarding_paused_booking_v1() as id')).id;
 const paymentStatus=async()=>(await one('select public.sma_onboarding_payment_status_v1($1) as state',[order])).state;
 const row={id:101,kunde_id:'kunde_fixture',kunde_email:'fixture@example.invalid',mollie_customer_id:'cst_fixture',
  mollie_subscription_id:'sub_fixture',paket:'alpha',demo_delta_aktiv:false,has_access_token:true,zugang_aktiv:true,zahlung_bestaetigt:true};
 const renewal=async(action,r=row)=>(await one('select public.sma_package_renewal_v1($1,$2,$3,$4::jsonb) as result',
  [order,lease,action,JSON.stringify({row:r})])).result;
 try{
  await db.exec(`create schema auth;create schema sma_private;
   create role anon;create role authenticated;create role service_role;
   grant usage on schema auth,sma_private to authenticated;
   create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table public.sma_kunden(id bigint primary key,user_id uuid,kunde_email text,aktiv boolean,
    zahlung_bestaetigt boolean,demo_delta_aktiv boolean,paket text,n8n_kunde_id text);
   create table sma_private.onboarding_plan_choices_v1(customer_id bigint,user_id uuid,n8n_ref text,n8n_row_id bigint,n8n_link_email text);
   create table sma_private.onboarding_package_bookings_v1(id uuid primary key,customer_id bigint,user_id uuid,
    automated boolean,state text,subscription_id text,lease uuid,leased_until timestamptz,n8n_ref text,n8n_row_id bigint,email text,plan text,merchant_customer text);
   create table sma_private.onboarding_payment_tickets_v1(id uuid primary key default gen_random_uuid(),job jsonb,until_at timestamptz);`);
  for(const name of ['20261115174345_onboarding_payment_status_v1.sql','20261115183148_onboarding_subscription_renewal_v1.sql'])
   await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
  await db.exec(migration);
  await db.query("insert into public.sma_kunden values (1,$1,'fixture@example.invalid',true,true,false,'alpha','kunde_fixture'),(2,$2,'other@example.invalid',false,false,false,null,null)",[first,second]);
  await db.query("insert into sma_private.onboarding_plan_choices_v1 values(1,$1,'kunde_fixture',101,'fixture@example.invalid')",[first]);
  await db.query("insert into sma_private.onboarding_package_bookings_v1(id,customer_id,user_id,automated,state,subscription_id,lease,leased_until,n8n_ref,n8n_row_id,email,plan,merchant_customer) values($1,1,$2,true,'active','sub_fixture',$3,clock_timestamp()+interval '5 minutes','kunde_fixture',101,'fixture@example.invalid','alpha','cst_fixture')",[order,first,lease]);
  await db.exec('set role authenticated');await session(first);
  assert.equal(await lookup(),null);assert.equal(await paymentStatus(),'active');
  await assert.rejects(renewal('suspend'),/permission denied/);
  await assert.rejects(db.query('select * from sma_private.onboarding_package_bookings_v1'),/permission denied/);
  for(const role of ['anon','service_role']){await db.exec('set role '+role);await assert.rejects(lookup(),/permission denied/);}
  await db.exec('reset role');
  const amount={currency:'EUR',value:'100.00'};
  const binding={id:order,merchant_customer:'cst_fixture',subscription_id:'sub_fixture',plan:'alpha',n8n_ref:'kunde_fixture',payment_id:'tr_first'};
  const sub={startDate:'2028-01-31',amount,status:'canceled'};
  const failed={id:'tr_failed',customerId:'cst_fixture',subscriptionId:'sub_fixture',sequenceType:'recurring',mode:'live',amount,createdAt:'2028-01-31T12:00:00Z',status:'failed'};
  const paid={...failed,id:'tr_retry',createdAt:'2028-02-03T12:00:00Z',paidAt:'2028-02-03T12:00:00Z',status:'paid'};
  const assess=async payments=>assessRenewal({order:binding,sub,today:'2028-02-05',event:null,readPage:async()=>({payments,next:null})});
  assert.equal((await assess([failed])).decision,'SUSPEND');
  assert.equal((await renewal('suspend')).state,'SUSPEND');
  const before=await one('select to_jsonb(c) as customer from public.sma_kunden c where id=1');
  await db.exec('set role authenticated');await session(first);
  assert.equal(await lookup(),order);assert.equal(await paymentStatus(),'renewal_suspended');
  await session(second);assert.equal(await lookup(),null);assert.equal(await paymentStatus(),'unavailable');
  await session(null);assert.equal(await lookup(),null);
  await db.exec('reset role');
  assert.deepEqual(await one('select to_jsonb(c) as customer from public.sma_kunden c where id=1'),before);
  for(const change of [
   "update public.sma_kunden set kunde_email='changed@example.invalid' where id=1",
   "update public.sma_kunden set aktiv=true where id=1",
   "update public.sma_kunden set zahlung_bestaetigt=true where id=1",
   "update public.sma_kunden set demo_delta_aktiv=true where id=1",
   "update public.sma_kunden set paket='beta' where id=1",
   "update public.sma_kunden set n8n_kunde_id='foreign' where id=1",
   "update sma_private.onboarding_plan_choices_v1 set n8n_row_id=999",
   "update sma_private.onboarding_package_bookings_v1 set automated=false",
   "update sma_private.onboarding_package_bookings_v1 set renewal_suspended=false",
   "update sma_private.onboarding_package_bookings_v1 set state='reversed'",
   "insert into public.sma_kunden select 3,user_id,kunde_email,aktiv,zahlung_bestaetigt,demo_delta_aktiv,paket,n8n_kunde_id from public.sma_kunden where id=1"
  ]){
   await db.exec('begin');await db.exec(change);await db.exec('set local role authenticated');await session(first);
   assert.equal(await lookup(),null,change);await db.exec('rollback');
  }
  assert.equal((await assess([failed,paid])).decision,'ACTIVE');
  const restored=await renewal('restore',{...row,zugang_aktiv:false,zahlung_bestaetigt:false});
  assert.equal(restored.state,'RESTORE');assert.ok(restored.ticket);
  await db.exec('set role authenticated');await session(first);
  assert.equal(await lookup(),order);assert.equal(await paymentStatus(),'renewal_suspended');
  await db.exec('reset role');
  assert.equal((await renewal('restore')).state,'ACTIVE');
  await db.exec('set role authenticated');await session(first);
  assert.equal(await lookup(),null);assert.equal(await paymentStatus(),'active');
  await db.exec('reset role');
  const result=await one('select aktiv,zahlung_bestaetigt from public.sma_kunden where id=1');
  assert.deepEqual(result,{aktiv:true,zahlung_bestaetigt:true});
 }finally{await db.close();}
});
