import assert from 'node:assert/strict';
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
  console.log('Kontozuordnung: Berechtigungen, eindeutige Nachweise, Adresswechsel, Wiederholung, konkurrierende Zuordnung und unveränderte Zugangssperren geprüft.');
  console.log('Paketvormerkung: Neuzugang, drei Paketoptionen, Wiederholung, Konflikt, Kontentrennung und Zugangssperren geprüft.');
} finally {await db.close();}
