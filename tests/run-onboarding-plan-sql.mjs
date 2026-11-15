import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
  console.log('Paketvormerkung: Neuzugang, drei Paketoptionen, Wiederholung, Konflikt, Kontentrennung und Zugangssperren geprüft.');
} finally {await db.close();}
