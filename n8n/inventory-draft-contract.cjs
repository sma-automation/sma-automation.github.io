'use strict';

// Embedded in the private n8n draft by patch-inventory-draft.cjs.
// Shopify is read-only here; stock is accepted by the existing inventory RPC.
const inventoryNames = {
  product: 'SMA – Produkt – Shopify Sync – Produkt prüfen',
  mapping: 'SMA – Produkt – Shopify Sync – Marktzuordnung prüfen',
  account: 'SMA – Produkt – Shopify Sync – Marktkonto prüfen',
  read: 'SMA – Produkt – Shopify Sync – Bestand abrufen',
  prepare: 'SMA – Bestand – Abgleich vorbereiten',
  claim: 'SMA – Bestand – Sperre anfordern',
  claimed: 'SMA – Bestand – Sperre prüfen',
  reread: 'SMA – Bestand – Unter Sperre lesen',
  evaluate: 'SMA – Produkt – Shopify Sync – Bestand auswerten',
  commit: 'SMA – Supabase – Shopify-Bestand speichern',
  canonical: 'SMA – Bestand – Übernahme prüfen',
  mirror: 'SMA – Produkt – Shopify Sync – Bestand speichern',
  finishBody: 'SMA – Bestand – Spiegelung prüfen',
  finish: 'SMA – Bestand – Abgleich abschließen',
  done: 'SMA – Bestand – Abschluss prüfen',
};
function inventoryFail(code) { throw new Error('Bestandsabgleich: ' + code); }
function inventorySingle(items) {
  if (!Array.isArray(items) || items.length !== 1 || !items[0]?.json || typeof items[0].json !== 'object') inventoryFail('SINGLE_ITEM_REQUIRED');
  return items[0].json;
}
function inventoryText(value) { return typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value; }
function inventoryId(value, type) { return typeof value === 'string' && new RegExp('^gid://shopify/' + type + '/[1-9][0-9]*$').test(value); }
function inventoryUUID(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function inventoryVariant(response, job) {
  if (!response || response.errors !== undefined && (!Array.isArray(response.errors) || response.errors.length)) inventoryFail('SHOPIFY_RESPONSE_ERROR');
  const v = response.data?.productVariant;
  if (!v || v.id !== job.variant_id || v.product?.id !== job.external_product_id || !inventoryId(v.inventoryItem?.id, 'InventoryItem')) inventoryFail('VARIANT_MISMATCH');
  return v;
}
function inventoryPrepare({product, mapping, account, response, workflowId, executionId}, crypto) {
  if (!inventoryText(product?.kunde_id) || !inventoryText(product?.produkt_id) || !Number.isSafeInteger(product.id) || product.id <= 0) inventoryFail('PRODUCT_IDENTITY');
  if (mapping?.markt !== 'shopify' || mapping.kunde_id !== product.kunde_id || mapping.produkt_id !== product.produkt_id || !inventoryText(mapping.markt_konto_id)) inventoryFail('MAPPING_MISMATCH');
  if (account?.markt !== 'shopify' || account.kunde_id !== product.kunde_id || account.markt_konto_id !== mapping.markt_konto_id) inventoryFail('ACCOUNT_MISMATCH');
  const raw = String(account.shop_url || account.shop_domain || '').trim();
  const domain = /^(?:https:\/\/)?([a-z0-9][a-z0-9-]*\.myshopify\.com)\/?$/.exec(raw)?.[1];
  if (!domain || !inventoryId(mapping.externe_variant_id, 'ProductVariant') || !inventoryId(mapping.externe_produkt_id, 'Product')) inventoryFail('SHOP_OR_VARIANT_INVALID');
  if (!inventoryText(workflowId) || !inventoryText(executionId)) inventoryFail('EXECUTION_ID_REQUIRED');
  const job = {kunde_id: product.kunde_id, produkt_id: product.produkt_id, n8n_produkt_zeile_id: product.id,
    markt_konto_id: mapping.markt_konto_id, shop_domain: domain, variant_id: mapping.externe_variant_id,
    external_product_id: mapping.externe_produkt_id};
  const variant = inventoryVariant(response, job);
  if (variant.inventoryItem.tracked !== true) inventoryFail('INVENTORY_NOT_TRACKED');
  job.inventory_item_id = variant.inventoryItem.id;
  // One operation per workflow execution; retries cannot create another delivery.
  const identity = JSON.stringify(['sma-product-draft-inventory-v1', workflowId, executionId, job]);
  const hash = crypto.createHash('sha256').update(identity).digest('hex');
  const bytes = Buffer.from(hash.slice(0, 32), 'hex');
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  job.delivery_id = [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
  job.payload_hash = hash;
  return job;
}
function inventoryBody(action, job, extra = {}) {
  return {p_action: action, p_shop_domain: job.shop_domain, p_n8n_kunde_id: job.kunde_id,
    p_markt_konto_id: job.markt_konto_id, p_delivery_id: job.delivery_id,
    p_inventory_item_id: job.inventory_item_id, p_payload_hash: job.payload_hash, ...extra};
}
function inventoryLease(job, now = Date.now(), maxAge = 90000) {
  const started = Date.parse(job?.read_started_at);
  if (!inventoryUUID(job?.lease_id) || !Number.isFinite(started) || started > now + 2000 || now - started >= maxAge) inventoryFail('LEASE_TOO_OLD_OR_INVALID');
}
function inventoryClaim(response, job, now = Date.now()) {
  if (response?.ok === true && response.action === 'duplicate' && ['done','ignored'].includes(response.status)) return null;
  if (response?.ok !== true || response.action !== 'process') inventoryFail('LEASE_NOT_ACQUIRED');
  const claimed = {...job, lease_id: response.lease_id, read_started_at: response.read_started_at};
  inventoryLease(claimed, now);
  return claimed;
}
function inventoryEvaluate(response, job, now = Date.now()) {
  inventoryLease(job, now);
  const v = inventoryVariant(response, job), item = v.inventoryItem;
  if (item.id !== job.inventory_item_id || item.tracked !== true) inventoryFail('INVENTORY_CHANGED');
  const levels = item.inventoryLevels;
  if (!Array.isArray(levels?.nodes) || levels.pageInfo?.hasNextPage !== false) inventoryFail('INCOMPLETE_LOCATIONS');
  const seen = new Set(); let stock = 0, eligible = 0;
  for (const level of levels.nodes) {
    const location = level?.location;
    if (!inventoryId(location?.id, 'Location') || seen.has(location.id) || typeof location.isActive !== 'boolean' || typeof location.fulfillsOnlineOrders !== 'boolean') inventoryFail('INVALID_LOCATION');
    seen.add(location.id);
    if (!location.isActive || !location.fulfillsOnlineOrders) continue;
    const q = Array.isArray(level.quantities) ? level.quantities.filter(q => q?.name === 'available') : [];
    if (q.length !== 1 || !Number.isSafeInteger(q[0].quantity)) inventoryFail('INVALID_QUANTITY');
    stock += q[0].quantity; eligible++;
    if (!Number.isSafeInteger(stock)) inventoryFail('QUANTITY_OVERFLOW');
  }
  if (!eligible) inventoryFail('NO_ONLINE_LOCATION');
  return {...job, bestand: Math.max(0, stock)};
}
function inventoryCanonical(response, job, now = Date.now()) {
  inventoryLease(job, now);
  if (response?.ok !== true || response.applied !== true || response.n8n_kunde_id !== job.kunde_id || response.sma_produkt_id !== job.produkt_id ||
      !inventoryText(response.kunde_id) || !Number.isSafeInteger(response.row_id) || response.row_id <= 0 ||
      response.bestand !== job.bestand || Date.parse(response.erfasst_am) !== Date.parse(job.read_started_at)) inventoryFail('CANONICAL_WRITE_NOT_CONFIRMED');
  return {...job, canonical_row_id: response.row_id, canonical_kunde_id: response.kunde_id};
}
function inventoryMirror(row, job, now = Date.now()) {
  inventoryLease(job, now, 110000);
  if (row?.id !== job.n8n_produkt_zeile_id || row.kunde_id !== job.kunde_id || row.produkt_id !== job.produkt_id || row.bestand !== job.bestand) inventoryFail('MIRROR_NOT_CONFIRMED');
  return inventoryBody('finish', job, {p_lease_id: job.lease_id});
}
function inventoryDone(response, job) {
  if (response?.ok !== true || response.status !== 'done') inventoryFail('FINISH_NOT_CONFIRMED');
  const result = response.result;
  if (result?.ok !== true || result.applied !== true || result.row_id !== job.canonical_row_id || result.kunde_id !== job.canonical_kunde_id ||
      result.n8n_kunde_id !== job.kunde_id || result.sma_produkt_id !== job.produkt_id || result.bestand !== job.bestand || Date.parse(result.erfasst_am) !== Date.parse(job.read_started_at)) inventoryFail('FINISH_RESULT_MISMATCH');
  return {ok: true, bestand: job.bestand, produkt_id: job.produkt_id};
}
module.exports = {inventoryNames, inventorySingle, inventoryPrepare, inventoryBody, inventoryLease,
  inventoryClaim, inventoryEvaluate, inventoryCanonical, inventoryMirror, inventoryDone};
