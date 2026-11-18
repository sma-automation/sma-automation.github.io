'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {readFileSync}=require('node:fs');
const {confirmationSql}=require('../n8n/confirm-onboarding-row.cjs');

const reference='kunde_'+'a'.repeat(32);
const dormant=()=>({
  id:42,kunde_id:reference,kunde_email:"o'hara+pilot@example.invalid",paket:null,
  zugang_aktiv:false,zahlung_bestaetigt:false,demo_delta_aktiv:false,
  zugangs_token_vorhanden:false,zugangs_link_vorhanden:false,
  mollie_customer_id_vorhanden:false,mollie_subscription_id_vorhanden:false
});
function evidence(sql){
 const m=/decode\('([0-9a-f]+)', 'hex'\)/.exec(sql);
 assert.ok(m,'Private SQL must encode exact JSON evidence in hex');
 return JSON.parse(Buffer.from(m[1],'hex').toString('utf8'));
}

test('A dormant, uniquely inspected new row preserves the existing seven-field SQL contract',()=>{
 const row=dormant(),sql=confirmationSql(reference,row);
 assert.match(sql,/^select sma_private\.confirm_onboarding_n8n_v1\('kunde_[a-f0-9]{32}', convert_from\(decode\('[0-9a-f]+', 'hex'\), 'UTF8'\)::jsonb\);$/);
 assert.deepEqual(evidence(sql),[{
  id:row.id,kunde_id:row.kunde_id,kunde_email:row.kunde_email,paket:null,
  zugang_aktiv:false,zahlung_bestaetigt:false,demo_delta_aktiv:false
 }]);
 assert.doesNotMatch(sql,/o'hara|pilot@example|zugangs_token|mollie_customer/);
});

test('Missing, unknown and positive hidden references fail before any SQL is issued',()=>{
 const hidden=['zugangs_token','zugangs_link','mollie_customer_id','mollie_subscription_id'];
 for(const key of hidden){
  for(const value of [true,undefined,null,'AUS','',0]){
   const row=dormant();row[key+'_vorhanden']=value;
   assert.throws(()=>confirmationSql(reference,row),/n8n-Zeile ist nicht leer/);
  }
 }
});

test('Legacy tokens, active/demo/payment flags, wrong row or malformed email cannot be linked',()=>{
 const base=dormant();
 for(const change of [
  {kunde_id:'kunde_'+ 'b'.repeat(32)},{id:0},{id:1.5},{id:Number.MAX_SAFE_INTEGER+1},
  {kunde_email:''},{kunde_email:'  '},{paket:'alpha'},
  {zugang_aktiv:true},{zahlung_bestaetigt:true},{demo_delta_aktiv:true},
  {demo_delta_aktiv:null},{zahlung_bestaetigt:undefined}
 ]){
  assert.throws(()=>confirmationSql(reference,{...base,...change}),/Zeilen-ID|Status/);
 }
 assert.throws(()=>confirmationSql('not-a-ref',base),/Zeilen-ID|Status/);
});

test('CLI asks only whether secrets exist, never requests their value or prints private evidence on refusal',()=>{
 const moduleSource=readFileSync('n8n/confirm-onboarding-row.cjs','utf8');
 assert.doesNotMatch(moduleSource,/\bfetch\s*\(|\bhttps?:\/\//);
 const valid=[reference,'42',reference,"o'hara+pilot@example.invalid",'',
  'AUS','AUS','AUS','AUS','AUS','AUS','AUS'].join('\n')+'\n';
 const yes=spawnSync(process.execPath,['n8n/confirm-onboarding-row.cjs'],{
  input:valid,encoding:'utf8',timeout:15000
 });
 assert.equal(yes.status,0,yes.stderr);
 assert.deepEqual(evidence(yes.stdout.trim()),[{
  id:42,kunde_id:reference,kunde_email:"o'hara+pilot@example.invalid",paket:null,
  zugang_aktiv:false,zahlung_bestaetigt:false,demo_delta_aktiv:false
 }]);
 assert.doesNotMatch(yes.stderr,/o'hara|pilot@example/);
 const blocked=valid.split('\n');
 blocked[8]='EIN'; // Access-token-present confirmation
 const no=spawnSync(process.execPath,['n8n/confirm-onboarding-row.cjs'],{
  input:blocked.join('\n'),encoding:'utf8',timeout:15000
 });
 assert.equal(no.status,1);
 assert.equal(no.stdout,'');
 assert.match(no.stderr,/n8n-Zeile ist nicht leer/);
 assert.doesNotMatch(no.stderr,/o'hara|pilot@example/);
});
