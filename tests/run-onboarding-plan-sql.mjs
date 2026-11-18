import assert from 'node:assert/strict';
import {prepareRenewalCheck} from '../n8n/sync-onboarding-payment.mjs';
import {checkScheduledSubscription} from './check-onboarding-subscription.mjs';
import {createRequire} from 'node:module';
const {confirmationSql}=createRequire(import.meta.url)('../n8n/confirm-onboarding-row.cjs');
import {readFile, readdir} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
const first='60600000-0000-4000-8000-000000000001', second='60600000-0000-4000-8000-000000000002';
const one=async(sql,values=[]) => (await db.query(sql,values)).rows[0];
const call=async(owner,plan=null,expected=null) =>
  (await one('select public.sma_onboarding_plan_choice_v1($1,$2,$3) as result',[owner,plan,expected])).result;
async function session(id) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
}
try {
  await db.exec(`create schema auth; create schema sma_private; create role anon; create role authenticated; create role service_role;
    grant usage on schema sma_private to authenticated;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.sma_kunden(id bigint primary key,user_id uuid,kunde_email text,aktiv boolean default false,
      demo_delta_aktiv boolean default false,zahlung_bestaetigt boolean default false,paket text,n8n_kunde_id text);
  `);
  for (const [index,id] of [first,second].entries()) {
    const email='kunde'+index+'@example.invalid';
    await db.query('insert into auth.users values ($1,$2,now())',[id,email]);
    await db.query('insert into public.sma_kunden(id,user_id,kunde_email) values ($1,$2,$3)',[index+1,id,email]);
  }
  await db.exec(await readFile('supabase/migrations/20261115144202_onboarding_plan_choice_v1.sql','utf8'));
  const [linkMigration] = (await readdir('supabase/migrations')).filter(name => name.endsWith('_onboarding_n8n_link_v1.sql'));
  await db.exec(await readFile('supabase/migrations/' + linkMigration, 'utf8'));
  const [bookingMigration]=(await readdir('supabase/migrations')).filter(name=>name.endsWith('_onboarding_package_booking_v1.sql'));
  await db.exec(await readFile('supabase/migrations/'+bookingMigration,'utf8'));
  const [automationMigration]=(await readdir('supabase/migrations')).filter(name=>name.endsWith('_onboarding_payment_automation_v1.sql'));
  await db.exec(await readFile('supabase/migrations/'+automationMigration,'utf8'));
  const statusMigration=(await readdir('supabase/migrations')).find(name=>name.endsWith('_onboarding_payment_status_v1.sql'));
  await db.exec(await readFile('supabase/migrations/'+statusMigration,'utf8'));
  const retryMigration=(await readdir('supabase/migrations')).find(name=>name.endsWith('_onboarding_booking_retry_v1.sql'));
  await db.exec(await readFile('supabase/migrations/'+retryMigration,'utf8'));
  const settingsGuardMigration=(await readdir('supabase/migrations'))
    .find(name=>name.endsWith('_onboarding_absent_payment_setting_fail_closed_v1.sql'));
  assert.ok(settingsGuardMigration,'The fail-closed payment settings migration must be present');
  await db.exec(await readFile('supabase/migrations/'+settingsGuardMigration,'utf8'));
  const renewalMigration=(await readdir('supabase/migrations')).find(name=>name.endsWith('_onboarding_subscription_renewal_v1.sql'));
  await db.exec(await readFile('supabase/migrations/'+renewalMigration,'utf8'));
  // The scheduler and HTTP transport are captured locally; the application SQL runs unmodified.
  await db.exec(`create schema cron; create schema net;
    create table cron.jobs(name text primary key, schedule text, command text);
    create function cron.schedule(text,text,text) returns bigint language sql as $$
      insert into cron.jobs values ($1,$2,$3) returning 1::bigint $$;
    create table net.requests(id bigint generated always as identity, url text, headers jsonb, body jsonb, timeout_ms integer);
    create function net.http_post(url text,body jsonb,params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 5000)
      returns bigint language sql as $$insert into net.requests(url,body,headers,timeout_ms) values ($1,$2,$4,$5) returning id$$;`);
  const dueMigration=(await readdir('supabase/migrations')).find(name=>name.endsWith('_onboarding_renewal_schedule_v1.sql'));
  await db.exec(await readFile('supabase/migrations/'+dueMigration,'utf8'));
  assert.deepEqual(await one('select * from cron.jobs'),{name:'sma-package-renewal-due-v1',schedule:'*/5 * * * *',command:'select sma_private.package_renewal_tick_v1()'});
  assert.equal((await one('select sma_private.package_renewal_tick_v1() as sent')).sent,0);
  assert.equal((await one('select count(*)::int as n from net.requests')).n,0);
  for(const role of ['anon','authenticated']){
    await db.exec('set role '+role);
    for(const sql of ["select public.sma_package_schedule_claim_v1(null)","select public.sma_package_schedule_result_v1(null,null,'ACTIVE',null)",
      "select sma_private.package_renewal_tick_v1()"])await assert.rejects(db.query(sql),/permission denied/);
    await assert.rejects(db.query("select public.sma_package_renewal_v1(null,null,'restore','{}')"),/permission denied/);
    await db.exec('reset role');
  }
  const baseline=(await one('select jsonb_agg(to_jsonb(c) order by id) as customers from public.sma_kunden c')).customers;
  await db.exec('set role authenticated');await session(first);
  assert.deepEqual(await call(first),{ok:true,plan:null});
  assert.deepEqual(await call(first,'alpha'),{ok:true,plan:'alpha'});
  assert.deepEqual(await call(first,'alpha'),{ok:true,plan:'alpha'}); // Lost response, same request
  assert.deepEqual(await call(first,'delta'),{ok:false,code:'CONFLICT',plan:'alpha'});
  assert.deepEqual(await call(first,'beta','alpha'),{ok:true,plan:'beta'});
  assert.deepEqual(await call(first),{ok:true,plan:'beta'});
  assert.equal((await call(first,'other','beta')).code,'INVALID_PLAN');
  assert.equal((await call(second)).code,'ACCOUNT_UNAVAILABLE');
  await session(second);assert.deepEqual(await call(second),{ok:true,plan:null});
  assert.equal((await call(first,'delta','beta')).code,'ACCOUNT_UNAVAILABLE');
  await assert.rejects(db.query('select * from sma_private.onboarding_plan_choices_v1'),/permission denied/);
  await db.exec('set role anon');await assert.rejects(call(second),/permission denied/);
  await db.exec('reset role');
  assert.deepEqual((await one('select jsonb_agg(to_jsonb(c) order by id) as customers from public.sma_kunden c')).customers,baseline);
  assert.equal((await one('select count(*)::int n from sma_private.onboarding_plan_choices_v1')).n,1);
  for (const change of [
    "update auth.users set email_confirmed_at=null", "update auth.users set email='mismatch@example.invalid'",
    'update public.sma_kunden set aktiv=true', 'update public.sma_kunden set zahlung_bestaetigt=true',
    'update public.sma_kunden set demo_delta_aktiv=true', "update public.sma_kunden set paket='alpha'",
    "update public.sma_kunden set n8n_kunde_id='linked'", 'delete from public.sma_kunden',
    'insert into public.sma_kunden(id,user_id,kunde_email) select 3,user_id,kunde_email from public.sma_kunden where id=2'
  ]) {
    await db.exec('begin');await db.exec(change);await db.exec('set local role authenticated');
    assert.deepEqual(await call(second,'alpha'),{ok:false,code:'ACCOUNT_UNAVAILABLE'});
    await db.exec('rollback');
  }
  await db.exec('set role authenticated');await session(second);
  assert.deepEqual(await call(second,'delta'),{ok:true,plan:'delta'});
  await db.exec('reset role');
  const queue = async () => (await db.query('select * from sma_private.onboarding_n8n_accounts_v1 order by customer_id')).rows;
  const [alpha, beta] = await queue();
  assert.notEqual(alpha.n8n_ref, beta.n8n_ref);
  const evidence = (account, id) => ({
    id, kunde_id:account.n8n_ref, kunde_email:account.kunde_email,
    paket:null, zugang_aktiv:false, demo_delta_aktiv:false, zahlung_bestaetigt:false
  });
  const confirm = async (ref, rows) => (await one(
    'select sma_private.confirm_onboarding_n8n_v1($1,$2::jsonb) as state', [ref, JSON.stringify(rows)]
  )).state;
  const entry = evidence(alpha, 123);
  for (const role of ['anon','authenticated','service_role']) {
    await db.exec('set role '+role);
    await assert.rejects(confirm(alpha.n8n_ref,[entry]), /permission denied/);
    await assert.rejects(queue(), /permission denied/);
    await db.exec('reset role');
  }
  assert.equal(await confirm(alpha.n8n_ref, []), 'MATCH_NOT_UNIQUE');
  assert.equal(await confirm(alpha.n8n_ref, [entry,entry]), 'MATCH_NOT_UNIQUE');
  assert.equal(await confirm(beta.n8n_ref, [entry]), 'INVALID_EVIDENCE');
  assert.equal(await confirm(alpha.n8n_ref, [{...entry,kunde_email:beta.kunde_email}]), 'ACCOUNT_UNAVAILABLE');
  for (const invalid of [
    {...entry,id:0}, {...entry,id:'123'}, {...entry,zugang_aktiv:true}, {...entry,demo_delta_aktiv:true},
    {...entry,zahlung_bestaetigt:true}, {...entry,paket:'alpha'}, {...entry,zugang_aktiv:null},
    {...entry,demo_delta_aktiv:undefined}, {...entry,unexpected:'extra'}, null
  ]) assert.equal(await confirm(alpha.n8n_ref, [invalid]), 'INVALID_EVIDENCE');
  for (const sql of [
    "update auth.users set email_confirmed_at=null where id=$1",
    "update auth.users set email='changed@example.invalid' where id=$1",
    "update public.sma_kunden set kunde_email='changed@example.invalid' where user_id=$1",
    "update public.sma_kunden set aktiv=true where user_id=$1",
    "update public.sma_kunden set demo_delta_aktiv=true where user_id=$1",
    "update public.sma_kunden set zahlung_bestaetigt=true where user_id=$1",
    "update public.sma_kunden set paket='delta' where user_id=$1",
    "update public.sma_kunden set n8n_kunde_id='existing' where user_id=$1",
    "update public.sma_kunden set kunde_email='KUNDE0@example.invalid' where user_id<>$1"
  ]) {
    await db.exec('begin');
    await db.query(sql,[first]);
    assert.equal(await confirm(alpha.n8n_ref,[entry]),'ACCOUNT_UNAVAILABLE');
    await db.exec('rollback');
  }
  const profile = async id => (await one('select to_jsonb(c) as profile from public.sma_kunden c where user_id=$1',[id])).profile;
  const original = await profile(first), untouched = await profile(second);
  assert.equal(await confirm(alpha.n8n_ref, [entry]), 'LINKED');
  assert.equal(await confirm(alpha.n8n_ref, [entry]), 'ALREADY_LINKED');
  assert.equal(await confirm(alpha.n8n_ref, [{...entry,id:124}]), 'LINK_CONFLICT');
  assert.equal(await confirm(beta.n8n_ref, [evidence(beta,123)]), 'LINK_CONFLICT');
  assert.deepEqual(await profile(first), {...original,n8n_kunde_id:alpha.n8n_ref});
  assert.deepEqual(await profile(second), untouched);
  assert.deepEqual((await queue()).map(c=>c.n8n_row_id),[123,null]);
  await db.exec('set role authenticated'); await session(first);
  assert.deepEqual(await call(first), {ok:true,plan:'beta',linked:true});
  assert.deepEqual(await call(first,'alpha','beta'), {ok:true,plan:'alpha',linked:true});
  await db.exec('reset role');
  assert.equal(await confirm(alpha.n8n_ref,[entry]), 'ALREADY_LINKED');
  await db.exec('begin');
  await db.query("update auth.users set email='updated@example.invalid' where id=$1",[first]);
  await db.query("update public.sma_kunden set kunde_email='updated@example.invalid' where user_id=$1",[first]);
  assert.equal(await confirm(alpha.n8n_ref,[{...entry,kunde_email:'updated@example.invalid'}]), 'ACCOUNT_UNAVAILABLE');
  await db.exec('set local role authenticated');
  assert.equal((await call(first)).code, 'ACCOUNT_UNAVAILABLE');
  await db.exec('rollback');
  // Run the operator's real entry point. A quoted address remains data in the SQL editor.
  const address = "o'brien+pilot@example.invalid";
  await db.query('update public.sma_kunden set kunde_email=$1 where user_id=$2',[address,second]);
  await db.query('update auth.users set email=$1 where id=$2',[address,second]);
  // The SQL integration remains synthetic: test the exact existing seven-field
  // payload without a live Google request. Actual operator CLI issuance is
  // separately gated on the verified SMA Drive metadata in its own tests.
  const rowEvidence={id:124,kunde_id:beta.n8n_ref,kunde_email:address,paket:null,
    zugang_aktiv:false,zahlung_bestaetigt:false,demo_delta_aktiv:false,
    zugangs_token_vorhanden:false,zugangs_link_vorhanden:false,
    mollie_customer_id_vorhanden:false,mollie_subscription_id_vorhanden:false};
  assert.throws(()=>confirmationSql(beta.n8n_ref,{...rowEvidence,zugang_aktiv:true}),/Status/);
  assert.throws(()=>confirmationSql(beta.n8n_ref,{...rowEvidence,zugangs_token_vorhanden:true}),/n8n-Zeile/);
  const checkedSql=confirmationSql(beta.n8n_ref,rowEvidence);
  assert.equal(checkedSql.includes(address),false);
  assert.equal((await one(checkedSql)).confirm_onboarding_n8n_v1,'LINKED');
  assert.equal((await one(checkedSql)).confirm_onboarding_n8n_v1,'ALREADY_LINKED');
  const booking=async(owner,offer=null,plan=null,terms=offer?'2026-11-15-v1':null)=>(await one('select public.sma_onboarding_booking_v1($1,$2,$3,$4) as result',[owner,offer,plan,terms])).result;
  const sync=async(p,row=null)=>(await one('select sma_private.sync_onboarding_booking_v1($1,$2) as result',[p,row])).result;
  const future=new Date(Date.now()+3600_000).toISOString();
  const receipt={id:'tr_initial',ref:alpha.n8n_ref,plan:'alpha',customer:'cst_example',mode:'live',sequence:'first',
    currency:'EUR',value:'100.00',status:'open',expires:future,checkout:'https://www.mollie.com/checkout/select-method/fixture',reversed:false};
  const paid={...receipt,status:'paid',paid_at:new Date(Date.now()+5000).toISOString()};
  for(const role of ['anon','authenticated','service_role']){
    await db.exec('set role '+role);await assert.rejects(sync(receipt),/permission denied/);
    await assert.rejects(db.query('select * from sma_private.onboarding_package_bookings_v1'),/permission denied/);
    if(role!=='authenticated') await assert.rejects(booking(first),/permission denied/);
    await db.exec('reset role');
  }
  for(const change of [{mode:'test'},{sequence:'recurring'},{currency:'USD'},{value:'99.99'},{reversed:null}]){
    assert.equal(await sync({...receipt,...change}),'INVALID_RECEIPT');
  }
  assert.equal(await sync({...receipt,checkout:'https://example.invalid/checkout/bad'}),'INVALID_OFFER');
  assert.equal(await sync({...receipt,expires:'2020-01-01T00:00:00Z'}),'INVALID_OFFER');
  assert.equal(await sync(paid),'NO_BOOKING');
  assert.equal(await sync(receipt),'OFFERED');
  assert.equal(await sync(receipt),'OFFERED');
  assert.equal(await sync({...receipt,id:'tr_other'}),'OFFER_CONFLICT');
  await db.exec('set role authenticated');await session(first);
  const offer=(await booking(first)).offer; assert.equal(offer.checkout,null);
  assert.equal((await booking(second,offer.id,'alpha')).code,'ACCOUNT_UNAVAILABLE');
  await session(second);assert.equal((await booking(second,offer.id,'alpha')).code,'OFFER_CHANGED');await session(first);
  assert.equal((await booking(first,offer.id,'beta')).code,'OFFER_CHANGED');
  assert.equal((await booking(first,offer.id,'alpha','old')).code,'OFFER_CHANGED');
  await db.exec('begin');await call(first,'delta','alpha');assert.equal((await booking(first,offer.id,'alpha')).code,'OFFER_CHANGED');await db.exec('rollback');
  await db.exec('reset role');await db.exec('begin');assert.equal(await sync(paid),'UNMATCHED_PAYMENT');
  assert.equal(await sync(paid),'CLOSED');await db.exec('rollback');
  await db.exec('set role authenticated');await session(first);
  const confirmed=(await booking(first,offer.id,'alpha')).offer;
  assert.equal(confirmed.state,'booked');assert.equal(confirmed.checkout,receipt.checkout);
  assert.deepEqual((await booking(first,offer.id,'alpha')).offer,confirmed);
  await assert.rejects(call(first,'delta','alpha'),/BOOKING_IN_PROGRESS/);await db.exec('reset role');
  assert.equal((await profile(first)).aktiv,false);
  assert.equal(await sync({...paid,paid_at:'2000-01-01T00:00:00Z'}),'UNMATCHED_PAYMENT');
  assert.equal(await sync({...paid,customer:'cst_different'}),'RECEIPT_CONFLICT');
  assert.equal(await sync({...receipt,status:'pending'}),'BOOKED');
  assert.equal(await sync(paid),'PAID');
  const activeRow={id:123,kunde_id:alpha.n8n_ref,kunde_email:alpha.kunde_email,paket:'alpha',mollie_customer_id:'cst_example',
    mollie_subscription_id:'sub_example',zugang_aktiv:true,zahlung_bestaetigt:true,demo_delta_aktiv:false,has_access_token:true};
  for(const change of [{id:124},{kunde_email:'else@example.invalid'},{has_access_token:false},{demo_delta_aktiv:true}]){
    assert.equal(await sync(paid,{...activeRow,...change}),'N8N_PENDING');assert.equal((await profile(first)).aktiv,false);
  }
  assert.equal(await sync(paid,activeRow),'ACTIVE');assert.equal(await sync(paid,activeRow),'ACTIVE');
  assert.deepEqual(await profile(first),{...original,n8n_kunde_id:alpha.n8n_ref,aktiv:true,zahlung_bestaetigt:true,paket:'alpha'});
  assert.equal((await profile(second)).aktiv,false);
  assert.equal(await sync({...paid,reversed:true}),'REVERSED');assert.equal(await sync(paid,activeRow),'REVERSED');
  assert.equal((await profile(first)).aktiv,false);
  await db.exec('set role authenticated');await session(second);
  assert.equal((await booking(second)).offer,null);
  await db.exec('reset role');
  await db.exec('update sma_private.onboarding_payment_settings_v1 set enabled=true');
  // An absent settings singleton must NOT silently enable a payable first booking.
  // Each negative case uses a rolled-back synthetic transaction: no provider calls.
  await db.exec('begin');
  await db.exec('delete from sma_private.onboarding_payment_settings_v1');
  await db.exec('set local role authenticated');
  assert.equal((await booking(second)).offer,null);
  assert.equal((await booking(second,'00000000-0000-4000-8000-000000000001','delta','2026-11-15-v1')).code,'OFFER_CHANGED');
  await db.exec('rollback');
  // Even after table drift, a linked account without a saved plan gets no offer.
  await db.exec('begin');
  await db.exec('alter table sma_private.onboarding_plan_choices_v1 alter column plan drop not null');
  await db.query('update sma_private.onboarding_plan_choices_v1 set plan=null where user_id=$1',[second]);
  await db.exec('set local role authenticated');
  assert.equal((await booking(second)).offer,null);
  assert.equal((await booking(second,'00000000-0000-4000-8000-000000000001',null,'2026-11-15-v1')).code,'OFFER_CHANGED');
  await db.exec('rollback');
  await db.exec('set role authenticated');
  const virtual=(await booking(second)).offer;
  assert.deepEqual([virtual.plan,virtual.automated,virtual.state],['delta',true,'offered']);
  assert.equal((await booking(second,virtual.id,'beta')).code,'OFFER_CHANGED');
  const legacyOffer='00000000-0000-4000-8000-000000000001';
  assert.equal((await booking(second,legacyOffer,'delta')).code,'OFFER_CHANGED');
  await session(first);
  assert.equal((await booking(first,virtual.id,'alpha')).code,'OFFER_CHANGED');
  await session(second);
  await db.exec('reset role');
  const bookingsForSecond=async()=>Number((await one('select count(*) as n from sma_private.onboarding_package_bookings_v1 where user_id=$1',[second])).n);
  assert.equal(await bookingsForSecond(),0);
  await db.exec('set role authenticated');
  const booked=(await booking(second,virtual.id,'delta')).offer;
  assert.notEqual(booked.id,virtual.id);assert.equal(booked.state,'booked');assert.equal(booked.automated,true);
  assert.deepEqual((await booking(second,virtual.id,'delta')).offer,booked);
  await db.exec('reset role');assert.equal(await bookingsForSecond(),1);
  await db.exec('begin');
  await db.query('update sma_private.onboarding_package_bookings_v1 set accepted_offer_id=null where id=$1',[booked.id]);
  await db.exec('set local role authenticated');assert.equal((await booking(second,legacyOffer,'delta')).offer.id,booked.id);
  await db.exec('rollback');
  const status=async order=>(await one('select public.sma_onboarding_payment_status_v1($1) as state',[order])).state;
  const readAsCustomer=async(id)=> {
    await db.exec('begin read only');await db.exec('set local role authenticated');await session(id);
    try {return await status(booked.id);} finally {await db.exec('rollback');}
  };
  assert.equal(await readAsCustomer(second),'booked');
  assert.equal(await readAsCustomer(first),'unavailable');
  for(const role of ['anon','service_role']){
    await db.exec('set role '+role);await assert.rejects(status(booked.id),/permission denied/);await db.exec('reset role');
  }
  await db.exec('begin');await db.query("update sma_private.onboarding_package_bookings_v1 set state='closed' where id=$1",[booked.id]);
  await db.exec('set local role authenticated');await session(second);assert.equal(await status(booked.id),'closed');await db.exec('rollback');
  const lease='60700000-0000-4000-8000-000000000001';
  const work=async(action,data={})=>(await one('select public.sma_package_worker_v1($1,$2,$3,$4) as r',[booked.id,lease,action,data])).r;
  const ticket=async(id,job)=>(await one('select public.sma_package_ticket_v1($1,$2) as r',[id,job])).r;
  for(const role of ['anon','authenticated']){
    await db.exec('set role '+role);await assert.rejects(work('lock'),/permission denied/);
    await assert.rejects(ticket(null,{op:'lookup'}),/permission denied/);await db.exec('reset role');
  }
  await db.exec('set role service_role');const once=await ticket(null,{op:'lookup'});
  assert.deepEqual(await ticket(once,null),{op:'lookup'});assert.deepEqual(await ticket(once,null),{});
  assert.equal((await work('lock')).id,booked.id);assert.equal((await work('lock')).error,'BUSY');
  await work('customer',{id:'cst_auto'});await work('payment',{id:'tr_auto',expires:future,checkout:receipt.checkout});
  assert.equal((await work('payment',{id:'tr_other'})).error,'INVALID_TRANSITION');
  const automatic={...receipt,id:'tr_auto',plan:'delta',value:'500.00',customer:'cst_auto',ref:beta.n8n_ref};
  assert.deepEqual(await work('receipt',{receipt:automatic}),{state:'BOOKED'});
  assert.equal((await work('begin_subscription')).error,'INVALID_TRANSITION');
  for(const terminal of ['canceled','expired','failed']){
    await db.exec('begin');await db.exec('set local role service_role');
    assert.deepEqual(await work('receipt',{receipt:{...automatic,status:terminal}}),{state:'CLOSED'});
    await db.exec('set local role authenticated');await session(second);
    // A delayed repeat from the old tab must never start the next order.
    assert.equal((await booking(second,virtual.id,'delta')).code,'OFFER_CHANGED');
    assert.equal((await booking(second,booked.id,'delta')).code,'OFFER_CHANGED');
    const fresh=(await booking(second)).offer;
    assert.equal(fresh.state,'offered');assert.notEqual(fresh.id,virtual.id);
    assert.deepEqual((await booking(second)).offer,fresh);
    await db.exec('reset role');assert.equal(await bookingsForSecond(),1);
    await db.exec('set local role authenticated');
    const next=(await booking(second,fresh.id,'delta')).offer;
    assert.notEqual(next.id,booked.id);assert.equal(next.state,'booked');assert.equal(next.checkout,null);
    assert.deepEqual((await booking(second,fresh.id,'delta')).offer,next);
    assert.equal((await booking(second,virtual.id,'delta')).code,'OFFER_CHANGED');
    assert.equal(await status(booked.id),'closed');
    await db.exec('reset role');assert.equal(await bookingsForSecond(),2);
    assert.equal((await profile(second)).aktiv,false);await db.exec('rollback');
  }
  const paidAuto={...automatic,status:'paid',paid_at:new Date(Date.now()+1000).toISOString()};
  assert.deepEqual(await work('receipt',{receipt:paidAuto}),{state:'PAID'});
  assert.equal(await readAsCustomer(second),'paid');
  await db.exec('begin');
  assert.deepEqual(await work('release'),{ok:true});
  await checkScheduledSubscription({db,order:booked.id,receipt:paidAuto,account:{id:124,kunde_id:beta.n8n_ref,kunde_email:address}});
  await db.exec('set local role authenticated');await session(second);assert.equal(await status(booked.id),'active');
  await db.exec('rollback');
  console.log('Terminierte Folgezahlung im Zusammenspiel von Edge Function, n8n-Antwort und SQL geprüft.');
  assert.ok((await work('begin_subscription')).sub_started);
  await work('subscription',{id:'sub_auto'});
  const rowAuto={...activeRow,id:124,kunde_id:beta.n8n_ref,kunde_email:address,paket:'delta',mollie_customer_id:'cst_auto',mollie_subscription_id:'sub_auto'};
  assert.equal((await work('receipt',{receipt:paidAuto,row:{...rowAuto,mollie_subscription_id:'sub_foreign'}})).error,'SUBSCRIPTION_CONFLICT');
  assert.deepEqual(await work('receipt',{receipt:paidAuto,row:rowAuto}),{state:'ACTIVE'});
  assert.equal(await readAsCustomer(second),'active');
  await db.exec('reset role');
  const renewal={id:'tr_cycle',mode:'live',sequenceType:'recurring',customerId:'cst_auto',subscriptionId:'sub_auto',
    amount:{currency:'EUR',value:'500.00'},createdAt:new Date(Date.now()+3600_000).toISOString(),status:'pending'};
  const matchingSub={id:'sub_auto',mode:'live',customerId:'cst_auto',interval:'1 month',amount:renewal.amount,
    metadata:{order:booked.id,kunde_id:beta.n8n_ref,paket:'delta'}};
  const inspect=(payment=renewal,sub=matchingSub)=>prepareRenewalCheck(payment.id,
    async path=>path.startsWith('/payments/')?payment:sub).then(sql=>one(sql));
  await db.exec('begin read only');
  for(const state of ['open','pending','authorized','failed','expired','canceled','paid']){
    const paidAt=state==='paid'?renewal.createdAt:null;
    const result=await inspect({...renewal,status:state,paidAt});
    assert.deepEqual(result,{zuordnung:'ZUGEORDNET',zahlungsstatus:state,zahlung_erstellt_utc:renewal.createdAt,
      zahlung_bezahlt_utc:paidAt,erstattet_eur:'0.00',rueckgebucht_eur:'0.00',buchungsstatus:'active',website_zugang:'AKTIV'});
  }
  const refunded={...renewal,status:'paid',paidAt:renewal.createdAt,amountRefunded:{value:'2.50',currency:'EUR'},
    amountChargedBack:{value:'10.00',currency:'EUR'}};
  const review=await inspect(refunded);
  assert.deepEqual([review.erstattet_eur,review.rueckgebucht_eur],['2.50','10.00']);
  assert.deepEqual(await inspect(refunded),review);
  for(const [p,s] of [
    [renewal,{...matchingSub,metadata:{...matchingSub.metadata,order:offer.id}}],
    [renewal,{...matchingSub,metadata:{...matchingSub.metadata,kunde_id:alpha.n8n_ref}}],
    [{...renewal,id:'tr_auto'},matchingSub],
    [{...renewal,createdAt:'2020-01-01T00:00:00Z'},matchingSub],
    [{...renewal,customerId:'cst_else'},{...matchingSub,customerId:'cst_else'}],
    [{...renewal,subscriptionId:'sub_else'},{...matchingSub,id:'sub_else'}]
  ]){
    const invalid=await inspect(p,s);
    assert.equal(invalid.zuordnung,'NICHT_ZUGEORDNET');
    assert.ok(Object.entries(invalid).every(([key,v])=>key==='zuordnung'||v===null));
  }
  await db.exec('rollback');
  console.log('Folgezahlungen, Teilrückerstattung, Rückbuchung und fremde Belege im schreibgeschützten Betreiberabgleich geprüft.');
  await db.exec('begin');
  await db.query("update public.sma_kunden set aktiv=false where user_id=$1",[second]);
  assert.equal((await inspect()).website_zugang,'PRUEFEN');
  await db.exec('set local role authenticated');await session(second);assert.equal(await status(booked.id),'unavailable');
  await db.exec('rollback');await db.exec('set role service_role');
  assert.deepEqual(await work('release'),{ok:true});assert.equal((await work('lock')).state,'active');
  assert.deepEqual(await work('receipt',{receipt:{...paidAuto,reversed:true}}),{state:'REVERSED'});
  await db.exec('reset role');assert.equal((await profile(second)).aktiv,false);
  assert.equal(await readAsCustomer(second),'reversed');
  const locked=await inspect(refunded);assert.equal(locked.buchungsstatus,'reversed');assert.equal(locked.website_zugang,'GESPERRT');
  console.log('Abbruch, Ablauf und Fehlschlag geprüft: Alte Angebote bleiben verbraucht, nur eine neue Bestätigung erzeugt den nächsten Auftrag.');
  console.log('Zahlungsrückkehr mit eigenen und fremden Buchungen sowie allen Status in lesenden Transaktionen geprüft.');
  console.log('Automatische Buchung, Einmalaufträge, Wiederholungen, Erstzahlung, Abo, Freischaltung und Rückbuchung in PostgreSQL geprüft.');
  console.log('Paketbuchung: ausdrücklicher Auftrag, Kontentrennung, Erstzahlung, n8n-Nachweis, Wiederholung und Rückbuchung geprüft.');
  console.log('Kontozuordnung: Berechtigungen, eindeutige Nachweise, Adresswechsel, Wiederholung, konkurrierende Zuordnung und unveränderte Zugangssperren geprüft.');
  console.log('Paketvormerkung: Neuzugang, drei Paketoptionen, Wiederholung, Konflikt, Kontentrennung und Zugangssperren geprüft.');
} finally {await db.close();}
