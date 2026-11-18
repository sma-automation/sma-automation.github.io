const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const source=readFileSync('supabase/sql/launch-readiness-readonly.sql','utf8');
const noComments=source.replace(/^\s*--.*$/gm,'').trim();

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
 assert.match(source,/sma_private\.onboarding_n8n_accounts_v1/);
 assert.match(source,/sma_private\.onboarding_payment_settings_v1/);
 assert.match(source,/sma_private\.publication_orders_v1/);
 assert.match(source,/sma_private\.publication_provider_permissions_v1/);
 assert.match(source,/sma_private\.publication_gallery_technical_v1/);
 assert.match(source,/sma_private\.customer_websites_v1/);
 assert.match(source,/public\.sma_bestellungen/);
 // Owner IDs are legitimate internal join predicates, never report output keys.
 assert.doesNotMatch(noComments,/\b(kunde_id|shop_slug|access_token|refresh_token|caption|description|file_path|drive_file_id)\b/i);
 assert.doesNotMatch(noComments,/['"](?:user_id|kunde_id|shop_slug|access_token|refresh_token|caption|description|file_path|drive_file_id)['"]\s*,/i);
});
test('report never upgrades preflight counts into permission to publish or pay',()=>{
 assert.match(source,/'allows_publication',false/);
 assert.match(source,/'initiates_checkout',false/);
 assert.match(source,/'external_e2e_status','NOT_VERIFIED_BY_THIS_QUERY'/);
 assert.match(source,/'payment_mode','VERIFY_SHOPIFY_PAYMENTS_EXTERNALLY'/);
 assert.match(source,/'requires_personal_approval',true/);
 assert.match(source,/'BLOCKED_NO_EXPLICIT_APPROVAL'/);
 assert.match(source,/verified_at >= now\(\)-interval '15 minutes'/);
 for(const field of ['with_n8n_reference','entitled_with_n8n_reference','entitled_without_n8n_reference',
   'new_onboarding_profiles','new_profiles_waiting_for_n8n_link',
   'new_profiles_with_n8n_link','automatic_first_payment_setting','onboarding_state'])
  assert.ok(source.includes("'"+field+"'"),field);
 for(const field of ['drive_folder_access','first_paid_customer_e2e'])
  assert.ok(source.includes("'"+field+"','NOT_VERIFIED_BY_THIS_QUERY'"),field);
});
test('gallery counts separate pending work from completed clips and never call a renderer or evidence writer',()=>{
 for(const field of ['gallery_completed_jobs','gallery_pending_jobs','gallery_pending_due_jobs',
  'gallery_pending_scheduled_jobs','gallery_pending_unscheduled_jobs','gallery_other_jobs',
  'gallery_completed_without_record','music_listed_tracks','music_ready_tracks','music_aac_ready_tracks',
  'gallery_pending_without_track','gallery_pending_with_failures',
  'music_customer_state','music_customer_e2e'])assert.ok(source.includes("'"+field+"'"),field);
 assert.match(noComments,/g\.state='completed' AND NOT EXISTS/);
 assert.match(noComments,/e\.gallery_job_id=g\.id/);
 for (const field of ['gallery_current_revision_evidence_jobs',
  'gallery_completed_without_current_evidence','gallery_evidence_state']) {
  assert.ok(source.includes("'"+field+"'"),field);
 }
 for (const check of [
  /JOIN sma_private\.publication_files_v1 s ON s\.id=g\.source_id/,
  /JOIN sma_private\.publication_files_v1 f ON f\.id=g\.result_id/,
  /e\.asset_id=f\.id AND e\.source_asset_id=s\.id/,
  /e\.asset_revision=f\.revision AND e\.source_revision=s\.revision/,
  /e\.sha256=split_part\(f\.revision,':',2\)/,
  /e\.source_sha256=split_part\(s\.revision,':',2\)/,
  /e\.size_bytes=f\.size_bytes/,
  /e\.user_id=g\.user_id AND e\.customer_id=g\.customer_id/,
  /g\.source_key='sha256:'\|\|e\.source_sha256/,
  /CURRENT_GALLERY_EVIDENCE_REQUIRED/,
  /REVISION_BOUND_EVIDENCE_PRESENT_NOT_PUBLISH_PERMISSION/
 ]) assert.match(source,check);
 assert.ok(source.includes('count(DISTINCT g.id) FROM sma_private.gallery_music_v1 g'));
 assert.match(source,/gallery_completed_jobs-gallery_current_revision_evidence_jobs/);
 assert.match(noComments,/'version',6/);
 assert.match(noComments,/'NO_LISTED_TRACK_FOR_PENDING_JOBS'/);
 assert.match(noComments,/'LISTED_TRACKS_NOT_READY_FOR_PENDING_JOBS'/);
 assert.match(noComments,/'READY_MASTER_WITHOUT_AAC_FOR_PENDING_JOBS'/);
 assert.match(noComments,/'AAC_BACKED_TRACK_NOT_LICENSE_OR_MEDIA_E2E_VERIFIED'/);
 assert.match(noComments,/a\.metadata->>'mimetype'='audio\/aac'/);
 assert.match(noComments,/sma_private\.music_catalog_ready_v1/);
 assert.match(noComments,/'music_customer_e2e','NOT_VERIFIED_BY_THIS_QUERY'/);
 assert.match(noComments,/nullif\(btrim\(track_sha\),''\) IS NULL/);
 assert.match(noComments,/ENTITLED_N8N_REFERENCE_REVIEW_REQUIRED/);
 assert.match(noComments,/entitled_accounts-entitled_accounts_without_n8n_reference/);
 assert.doesNotMatch(noComments,/\b(?:gallery_background_(?:tick|pick)|gallery_music_(?:request|enqueue)|publication_gallery_technical_register|gallery_worker_snapshot)_v1\s*\(/i);
});
