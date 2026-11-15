import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
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
  const prepare = state => spawnSync(process.execPath,['n8n/confirm-onboarding-row.cjs'],{
    input: [beta.n8n_ref,'124',beta.n8n_ref,address,'',state,'AUS','AUS'].join('\n')+'\n', encoding:'utf8'
  });
  const denied = prepare('EIN');
  assert.equal(denied.status,1); assert.equal(denied.stdout,'');
  const checked = prepare('AUS');
  assert.equal(checked.status,0,checked.stderr);
  assert.equal(checked.stdout.includes(address),false);
  assert.equal((await one(checked.stdout)).confirm_onboarding_n8n_v1,'LINKED');
  assert.equal((await one(checked.stdout)).confirm_onboarding_n8n_v1,'ALREADY_LINKED');
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
  console.log('Paketbuchung: ausdrücklicher Auftrag, Kontentrennung, Erstzahlung, n8n-Nachweis, Wiederholung und Rückbuchung geprüft.');
  console.log('Kontozuordnung: Berechtigungen, eindeutige Nachweise, Adresswechsel, Wiederholung, konkurrierende Zuordnung und unveränderte Zugangssperren geprüft.');
  console.log('Paketvormerkung: Neuzugang, drei Paketoptionen, Wiederholung, Konflikt, Kontentrennung und Zugangssperren geprüft.');
} finally {await db.close();}
