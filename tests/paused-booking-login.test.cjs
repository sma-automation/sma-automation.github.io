const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const dashboard=fs.readFileSync('app/dashboard.html','utf8');
const migration=fs.readFileSync('supabase/migrations/20261115201000_onboarding_paused_booking_login_v1.sql','utf8');
const payment=fs.readFileSync('app/assets/onboarding-payment-return.mjs','utf8');

test('403 login checks owned suspended booking before plan choice',()=>{
 const start=dashboard.indexOf("if(response.status===403&&!pilotRequested)");
 const end=dashboard.indexOf("throw Error(response.status===403?",start);
 const block=dashboard.slice(start,end);
 assert.ok(start>0&&end>start);
 assert.ok(block.indexOf("sma_onboarding_paused_booking_v1")<block.indexOf("sma_onboarding_plan_choice_v1"));
 assert.match(block,/current\?\.user\?\.id===owner&&dashboardOwnerId===owner/);
 assert.match(block,/paketwahl\.html\?buchung=/);
 assert.match(block,/encodeURIComponent\(paused\.data\)/);
});

test('paused booking lookup is read-only and bound to authenticated owner',()=>{
 assert.match(migration,/returns uuid language sql stable security definer/);
 assert.match(migration,/b\.user_id=\(select auth\.uid\(\)\)/);
 for(const condition of ["b.automated is true","b.state='active'","b.renewal_suspended is true",
 "c.aktiv is false","c.zahlung_bestaetigt is false","c.demo_delta_aktiv is false",
 "c.paket=b.plan","c.n8n_kunde_id=b.n8n_ref"])assert.ok(migration.includes(condition),condition);
 assert.match(migration,/grant execute on function public\.sma_onboarding_paused_booking_v1\(\) to authenticated/);
 assert.doesNotMatch(migration,/\b(update|insert|delete)\s+(?:public|sma_private)\./i);
});

test('simulated payment states keep pause separate from restoration',()=>{
 const statusFor=({active,suspended,paid,linked=true})=>
  active&&suspended&&!paid&&linked?'renewal_suspended':
  active&&paid&&linked?'active':'unavailable';
 assert.equal(statusFor({active:true,suspended:true,paid:false}),'renewal_suspended');
 assert.equal(statusFor({active:true,suspended:false,paid:true}),'active');
 assert.equal(statusFor({active:false,suspended:true,paid:false}),'unavailable');
 assert.match(payment,/data === 'renewal_suspended'/);
 assert.match(payment,/data === 'active'\) return leave\('dashboard\.html'\)/);
});
