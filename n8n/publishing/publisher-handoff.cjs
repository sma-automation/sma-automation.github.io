'use strict';

// Internal read-only handoff. This is neither an approval nor an upload payload.
const HANDOFF_PLATFORMS = ['youtube', 'instagram', 'facebook', 'tiktok'];
const HANDOFF_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HANDOFF_SHOP = /^https:\/\/sma-automation\.com\/app\/shop\.html\?shop=[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HANDOFF_FAILURES = ['ACCESS_INACTIVE', 'FILE_UNAVAILABLE', 'FILE_CHANGED', 'ASSIGNMENT_UNAVAILABLE', 'ASSIGNMENT_CHANGED'];
const HANDOFF_PENDING = ['DRIVE_RECHECK_REQUIRED', 'MEDIA_APPROVAL_REQUIRED', 'CONTENT_APPROVAL_REQUIRED', 'TARGET_ACCOUNT_REQUIRED', 'PUBLICATION_APPROVAL_REQUIRED', 'PUBLICATION_RESERVATION_REQUIRED'];
const handoffObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);

function requireHandoffRequest(input) {
  const keys = ['version', 'customer_id', 'drive_file_id', 'asset_id', 'asset_revision', 'platform', 'assignment_revision', 'preview_id', 'preview_revision', 'shop_url', 'media_kind'];
  if (!handoffObject(input) || Object.keys(input).sort().join() !== keys.sort().join() || input.version !== 1 ||
      !Number.isSafeInteger(input.customer_id) || input.customer_id < 1 ||
      typeof input.drive_file_id !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(input.drive_file_id) ||
      typeof input.asset_id !== 'string' || !HANDOFF_UUID.test(input.asset_id) ||
      typeof input.preview_id !== 'string' || !HANDOFF_UUID.test(input.preview_id) ||
      typeof input.asset_revision !== 'string' || !/^(?:sha256:[a-f0-9]{64}|md5:[a-f0-9]{32}|version):\d{1,30}$/.test(input.asset_revision) ||
      !HANDOFF_PLATFORMS.includes(input.platform) || !['image', 'video'].includes(input.media_kind) ||
      !Number.isSafeInteger(input.assignment_revision) || input.assignment_revision < 1 ||
      !Number.isSafeInteger(input.preview_revision) || input.preview_revision < 1 ||
      typeof input.shop_url !== 'string' || !HANDOFF_SHOP.test(input.shop_url) || input.shop_url.split('shop=')[1].length > 80) {
    throw Error('INVALID_HANDOFF_INPUT');
  }
  return {...input};
}

function handoffRpcInput(input) {
  const r = requireHandoffRequest(input);
  return {p_customer_id:r.customer_id, p_drive_file_id:r.drive_file_id, p_asset_revision:r.asset_revision, p_platform:r.platform};
}

function handoffFailure(code) {
  return {ok:false, stage:'handoff_preview', can_publish:false, can_upload:false, code};
}

function makeHandoff(response, input, now = Date.now()) {
  const r = requireHandoffRequest(input);
  if (!handoffObject(response) || response.ok !== true) {
    return handoffFailure(HANDOFF_FAILURES.includes(response?.code) ? response.code : 'HANDOFF_UNAVAILABLE');
  }
  // Never select the newest text implicitly: the caller supplies the exact saved selection.
  for (const key of ['asset_id', 'asset_revision', 'platform', 'assignment_revision', 'preview_id', 'preview_revision', 'shop_url', 'media_kind']) {
    if (response[key] !== r[key]) return handoffFailure('HANDOFF_CHANGED');
  }
  if (response.can_publish !== false) return handoffFailure('HANDOFF_UNAVAILABLE');
  const media = response.media_check;
  const verifiedAt = typeof media?.verified_at === 'string' ? Date.parse(media.verified_at) : NaN;
  if (!Number.isFinite(now) || !Number.isFinite(verifiedAt) || verifiedAt > now + 60000 || now - verifiedAt >= 15 * 60000) {
    return handoffFailure('FILE_REFRESH_REQUIRED');
  }
  if (!handoffObject(media) || media.asset_id !== r.asset_id || media.asset_revision !== r.asset_revision ||
      media.can_publish !== false || !['needs_review', 'needs_changes'].includes(media.status) ||
      !Array.isArray(media.checks) || media.checks.length === 0 || media.checks.length > 100 ||
      media.checks.some(c => !handoffObject(c) || typeof c.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,79}$/.test(c.code) || !['pass', 'pending', 'fail'].includes(c.status))) {
    return handoffFailure('MEDIA_CHECK_UNAVAILABLE');
  }
  const d = response.text;
  const text = (s, max, min = 1) => typeof s === 'string' && s.length >= min && s.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(s);
  if (!handoffObject(d) || d.platform !== r.platform || !text(d.title, 80) || !text(d.body, 1200, 10) ||
      !text(d.caption, 5000) || !Array.isArray(d.hashtags) || d.hashtags.length > 3 ||
      d.hashtags.some(t => !text(t, 50) || !/^[\p{L}\p{N}_]+$/u.test(t)) ||
      new Set(d.hashtags.map(t => t.toLocaleLowerCase('de'))).size !== d.hashtags.length ||
      !Array.isArray(d.review_notes) || d.review_notes.length > 5 || d.review_notes.some(t => !text(t, 250))) {
    return handoffFailure('SAVED_TEXT_INVALID');
  }
  // Preserve the stored caption byte for byte; do not regenerate, trim or append a second shop footer.
  const captions = ['🛒 Zum Shop: ', '🛒 Visit our shop: '].map(footer =>
    [d.body, d.hashtags.map(t => '#' + t).join(' '), footer + r.shop_url].filter(Boolean).join('\n\n'));
  if (!captions.includes(d.caption) || d.caption.split(r.shop_url).length !== 2 ||
      /(https?:|www\.|<|>)/i.test(d.title + d.body) || Buffer.byteLength(d.caption, 'utf8') > 5000 ||
      (r.platform === 'tiktok' && d.caption.length > 2200)) return handoffFailure('SAVED_TEXT_INVALID');
  const blockers = [...HANDOFF_PENDING];
  if (media.checks.some(c => c.status === 'fail') || media.status === 'needs_changes') blockers.push('MEDIA_CHANGES_REQUIRED');
  if (d.review_notes.length) blockers.push('TEXT_REVIEW_REQUIRED');
  return {
    ok:true, version:1, stage:'handoff_preview', can_publish:false, can_upload:false,
    binding:{...r},
    draft:{platform:d.platform, title:d.title, body:d.body, caption:d.caption, hashtags:[...d.hashtags], review_notes:[...d.review_notes]},
    checks:{saved_selection:'matched', catalog_verified_at:media.verified_at, media:media.checks.map(c => ({code:c.code, status:c.status}))},
    blockers
  };
}

module.exports = {requireHandoffRequest, handoffRpcInput, makeHandoff};
