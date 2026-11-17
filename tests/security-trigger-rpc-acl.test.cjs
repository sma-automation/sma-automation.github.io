'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const migration=fs.readFileSync(path.resolve(__dirname,
  '../supabase/migrations/20261117130758_restrict_internal_trigger_rpc_execute.sql'),'utf8');
const functions=[
  'handle_new_sma_user',
  'rls_auto_enable',
  'sma_bestellungen_user_id_setzen',
  'sma_produkte_user_id_setzen'
];
const statements=migration.replace(/^\s*--[^\n]*$/gm,'')
  .split(';').map(value=>value.trim()).filter(Boolean);

test('deployed security migration revokes only public trigger RPC access',()=>{
  const expected=[];
  for(const fn of functions){
    expected.push('REVOKE EXECUTE ON FUNCTION public.'+fn+'() FROM PUBLIC, anon, authenticated');
  }
  for(const fn of functions){
    expected.push('GRANT EXECUTE ON FUNCTION public.'+fn+'() TO service_role');
  }
  assert.deepEqual(statements,expected);
  assert.equal(new Set(functions).size,4);
});

test('customer-facing file job and product image RPCs are not affected',()=>{
  for(const name of ['sma_file_job_v1','sma_produktbild_setzen_v1','sma_produktbilder_setzen_v2']){
    assert.equal(migration.includes(name),false,name+' must retain existing grants');
  }
  assert.doesNotMatch(migration,/\b(?:DROP|TRUNCATE|INSERT|UPDATE|DELETE|ALTER\s+TABLE|CREATE\s+TRIGGER)\b/i);
});
