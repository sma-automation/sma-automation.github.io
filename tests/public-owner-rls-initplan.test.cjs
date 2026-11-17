'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sql = fs.readFileSync(path.resolve(__dirname,
  '../supabase/migrations/20261117133306_optimize_public_owner_rls_initplans.sql'), 'utf8');
const commands = sql.replace(/^\s*--[^\n]*$/gm, '').split(';')
  .map(command => command.trim().replace(/\s+/g, ' ')).filter(Boolean);
const expected = [
  'ALTER POLICY "Kunde liest eigene Daten" ON public.sma_kunden USING ((SELECT auth.uid()) = user_id)',
  'ALTER POLICY "Kunde liest eigene Produkte" ON public.sma_produkte USING ((SELECT auth.uid()) = user_id)',
  'ALTER POLICY "Kunde liest eigene Bestellungen" ON public.sma_bestellungen USING ((SELECT auth.uid()) = user_id)',
];

test('only the three existing authenticated customer SELECT policies are optimized', () => {
  assert.deepEqual(commands, expected);
});

test('tenant ownership, login and business RPCs remain unchanged', () => {
  for (const command of commands) {
    assert.match(command, /\bUSING \(\(SELECT auth\.uid\(\)\) = user_id\)$/);
    assert.doesNotMatch(command, /\b(?:TO|WITH CHECK|FOR ALL|SECURITY DEFINER)\b/i);
  }
  assert.doesNotMatch(commands.join('; '),
    /\b(?:CREATE|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE|DISABLE|ENABLE)\b/i);
});
