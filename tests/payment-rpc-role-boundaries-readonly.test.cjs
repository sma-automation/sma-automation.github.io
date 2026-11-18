'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');

const sql=readFileSync(join(__dirname,'../supabase/sql/payment-rpc-role-boundaries-readonly.sql'),'utf8');

test('Payment-role preflight is strictly SELECT-only and does not touch customer rows',()=>{
  const query=sql.replace(/^--.*$/gm,'').trim();
  assert.match(query,/^WITH\s+expected\s*\(/i);
  assert.match(query,/\bLEFT\s+JOIN\s+pg_proc\s+p\b/i);
  assert.match(query,/\bLEFT\s+JOIN\s+pg_namespace\s+n\b/i);
  assert.match(query,/\bhas_function_privilege\(/i);
  assert.match(query,/\bSELECT\s+CASE\s+WHEN\b/i);
  assert.doesNotMatch(query,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|CALL|DO|EXECUTE)\b\s*(?:\w|\()/i);
  assert.doesNotMatch(query,/\b(?:FROM|JOIN)\s+(?:sma_private|auth|storage|public\.sma_)/i);
  assert.equal((query.match(/\('sma_(?:package_\w+|onboarding_booking_v1)','(?:service|customer)'/g)||[]).length,6);
  assert.match(query,/NOT\s+has_function_privilege\('anon'/i);
  assert.match(query,/NOT\s+has_function_privilege\('authenticated'/i);
  assert.match(query,/has_function_privilege\('service_role'/i);
  assert.match(query,/EXPECTED_ROLE_BOUNDARIES_PRESENT_NOT_PAYMENT_E2E/);
  assert.match(query,/REVIEW_REQUIRED/);
});
