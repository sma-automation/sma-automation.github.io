const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const source=readFileSync('supabase/sql/launch-readiness-readonly.sql','utf8');
const noComments=source.replace(/^--.*$/gm,'').trim();

test('SMA launch preflight consists only of one read-only SELECT statement',()=>{
 assert.match(noComments,/^WITH\s+snapshot\s+AS\s*\(/i);
 assert.match(noComments,/SELECT\s+jsonb_build_object\(/i);
 assert.equal((noComments.match(/;/g)||[]).length,1);
 assert.match(noComments,/FROM\s+snapshot;\s*$/i);
 assert.doesNotMatch(noComments,/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|EXECUTE|PERFORM|MERGE)\b/i);
 assert.doesNotMatch(noComments,/\b(SECURITY\s+DEFINER|pg_sleep|dblink|http_post|net\.http_post)\b/i);
});
test('preflight counts aggregate statuses without selecting customer identities or private media',()=>{
 assert.match(source,/count\(\*\)/i);
 assert.match(source,/public\.sma_kunden/);
 assert.match(source,/sma_private\.publication_orders_v1/);
 assert.match(source,/sma_private\.publication_provider_permissions_v1/);
 assert.match(source,/sma_private\.publication_gallery_technical_v1/);
 assert.match(source,/sma_private\.customer_websites_v1/);
 assert.match(source,/public\.sma_bestellungen/);
 assert.doesNotMatch(noComments,/\b(user_id|kunde_id|shop_slug|access_token|refresh_token|caption|description|file_path|drive_file_id)\b/i);
});
test('report never upgrades preflight counts into permission to publish or pay',()=>{
 assert.match(source,/'allows_publication',false/);
 assert.match(source,/'initiates_checkout',false/);
 assert.match(source,/'external_e2e_status','NOT_VERIFIED_BY_THIS_QUERY'/);
 assert.match(source,/'payment_mode','VERIFY_SHOPIFY_PAYMENTS_EXTERNALLY'/);
 assert.match(source,/'requires_personal_approval',true/);
 assert.match(source,/'BLOCKED_NO_EXPLICIT_APPROVAL'/);
 assert.match(source,/verified_at >= now\(\)-interval '15 minutes'/);
});
