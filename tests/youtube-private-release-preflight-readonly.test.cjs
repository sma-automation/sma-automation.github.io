const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const source=readFileSync('supabase/sql/youtube-private-release-preflight-readonly.sql','utf8');
const noComments=source.replace(/^--.*$/gm,'').trim();
const output=noComments.slice(noComments.lastIndexOf('SELECT jsonb_build_object('));

test('YouTube preflight is one aggregated read-only query with no mutation or network call',()=>{
 assert.match(noComments,/^WITH\s+prepared\s+AS\s*\(/i);
 assert.match(noComments,/FROM aggregates a CROSS JOIN media_rollup r CROSS JOIN checked_private c;\s*$/i);
 assert.equal((noComments.match(/;/g)||[]).length,1);
 assert.doesNotMatch(noComments,/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|EXECUTE|PERFORM|MERGE)\b/i);
 assert.doesNotMatch(noComments,/\b(pg_sleep|dblink|http_post|net\.http_post|SECURITY\s+DEFINER)\b/i);
 assert.doesNotMatch(noComments,/\b(sma_publication_order_v1|sma_publication_provider_v1|sma_publication_provider_cover_v1|publication_provider_begin_v1|publication_provider_finish_v1)\s*\(/i);
});

test('reads prepared YouTube accounts, exact catalog revision and the actual pending media codes',()=>{
 assert.match(source,/o\.state\s*=\s*'prepared'/);
 assert.match(source,/o\.binding->>'platform'\s*=\s*'youtube'/);
 assert.match(source,/choices->>'visibility'\s*=\s*'private'/);
 assert.match(source,/f\.customer_id\s*=\s*p\.customer_id\s+AND\s+f\.user_id\s*=\s*p\.user_id/);
 assert.match(source,/f\.revision\s*=\s*p\.binding->>'asset_revision'/);
 assert.match(source,/verified_at\s*>=\s*now\(\)\s*-\s*interval\s*'15 minutes'/);
 assert.match(source,/publication_approval_window_v1\(o\)/);
 assert.match(source,/publication_media_precheck_v1\(f,\s*'youtube'\)/);
 assert.match(source,/publication_provider_permissions_v1/);
 assert.match(source,/publication_provider_attempts_v1/);
 assert.match(source,/status='pending'/);
});

test('operator output reveals counts and code names only; no identities, drafts, access or provider approval',()=>{
 assert.match(output,/'scope',\s*'internal_operator_aggregate_read_only'/);
 assert.match(output,/'provider_e2e',\s*'NOT_VERIFIED_BY_THIS_QUERY'/);
 assert.match(output,/'stored_catalog_match_is_not_fresh_drive_proof',\s*true/);
 assert.match(output,/'current_youtube_oauth_not_verified',\s*true/);
 assert.match(output,/'customer_rights_review_not_verified',\s*true/);
 assert.match(output,/'allows_upload',\s*false/);
 assert.match(output,/'allows_publication',\s*false/);
 assert.match(output,/'initiates_checkout',\s*false/);
 assert.doesNotMatch(output,/'(?:user_id|customer_id|kunde_id|asset_id|drive_file_id|order_id|target_id|account_check|binding|draft|caption|description|token|email|shop_url)'/i);
 assert.doesNotMatch(output,/\bjsonb_agg\s*\(\s*(?:p\.|o\.|j\.|f\.|i\.)/i);
});
